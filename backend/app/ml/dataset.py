"""Deterministic, provenance-gated dataset compiler for HarmonyForge.

The compiler accepts normalized source records rather than downloading or
bundling copyrighted corpora. It assigns work and duplicate groups to a split
before creating windows, then records every content hash needed to reproduce
the processed dataset. Schema v2 adds a strict harmony-only/private-local
profile for reproducible pretraining without accepting melody, MIDI, audio,
lyrics, titles, arrangement, voicing, or performance data.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

from app.ml.contracts import (
    EVENT_VOCABULARY,
    EXTENSION_VOCABULARY,
    MODE_VOCABULARY,
    QUALITY_VOCABULARY,
    ROLE_VOCABULARY,
)
from app.ml.tokenizer import TOKENIZER_SHA256

LEGACY_DATASET_SCHEMA_VERSION = 1
DATASET_SCHEMA_VERSION = 2
COMPILER_VERSION = "1.1.0"
SUPPORTED_COMPILER_VERSIONS = {"1.0.0", COMPILER_VERSION}
DATA_MANIFEST_FILE = "data-manifest.json"
VOCABULARY_FILE = "vocabulary.json"
STATISTICS_FILE = "statistics.json"
PROVENANCE_FILE = "provenance.json"
SPLIT_FILES = {
    "train": "train.index.jsonl",
    "validation": "validation.index.jsonl",
    "test": "test.index.jsonl",
}
SUPPORTED_TIME_SIGNATURES = {
    "4/4": 4,
    "3/4": 3,
    "6/8": 3,
}
TRAINING_PURPOSE = "researchTraining"
PRIVATE_HARMONY_TRAINING_PURPOSE = "privateLocalHarmonyOnlyTraining"
PRIVATE_HARMONY_POLICY_ID = "harmony-only-private-v1"
PRIVATE_LOCAL_DISTRIBUTION_SCOPE = "privateLocalOnly"
HARMONY_ONLY_FORBIDDEN_FIELDS = {
    "artist",
    "audio",
    "lyrics",
    "melody",
    "midi",
    "notes",
    "performance",
    "rawMidi",
    "title",
    "track",
    "voicing",
}
UnsupportedQualityPolicy = Literal["excludeRecord", "mapOther"]
HarmonyGapPolicy = Literal["excludeRecord", "allowNoChord"]
ContentProfile = Literal["melodyHarmonyV1", "harmonyOnlyV1"]


class DatasetCompileError(ValueError):
    """Input data or its provenance contract is unsafe or inconsistent."""


class _ExcludedRecord(Exception):
    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


@dataclass(frozen=True, slots=True)
class CompileOptions:
    dataset_id: str
    dataset_version: str
    split_seed: str = "1729"
    train_basis_points: int = 8_000
    validation_basis_points: int = 1_000
    maximum_frames_per_window: int = 256
    unsupported_quality_policy: UnsupportedQualityPolicy = "excludeRecord"
    harmony_gap_policy: HarmonyGapPolicy = "excludeRecord"
    purpose: str = TRAINING_PURPOSE
    content_profile: ContentProfile = "melodyHarmonyV1"

    @property
    def test_basis_points(self) -> int:
        return 10_000 - self.train_basis_points - self.validation_basis_points

    def validate(self) -> None:
        for field_name, value in (
            ("dataset_id", self.dataset_id),
            ("dataset_version", self.dataset_version),
            ("split_seed", self.split_seed),
            ("purpose", self.purpose),
        ):
            if not value or len(value) > 128:
                raise DatasetCompileError(
                    f"{field_name} must contain between 1 and 128 characters"
                )
        if self.train_basis_points <= 0:
            raise DatasetCompileError("train split must be non-empty")
        if self.validation_basis_points < 0 or self.test_basis_points < 0:
            raise DatasetCompileError("split basis points must sum to at most 10000")
        if self.maximum_frames_per_window < 16:
            raise DatasetCompileError(
                "maximum_frames_per_window must be at least 16"
            )
        if self.maximum_frames_per_window > 2048:
            raise DatasetCompileError(
                "maximum_frames_per_window must not exceed 2048"
            )
        if self.unsupported_quality_policy not in {"excludeRecord", "mapOther"}:
            raise DatasetCompileError("unsupported quality policy")
        if self.harmony_gap_policy not in {"excludeRecord", "allowNoChord"}:
            raise DatasetCompileError("unsupported harmony gap policy")
        if self.content_profile not in {"melodyHarmonyV1", "harmonyOnlyV1"}:
            raise DatasetCompileError("unsupported content profile")
        if (
            self.content_profile == "harmonyOnlyV1"
            and self.purpose != PRIVATE_HARMONY_TRAINING_PURPOSE
        ):
            raise DatasetCompileError(
                "harmonyOnlyV1 requires privateLocalHarmonyOnlyTraining purpose"
            )


def compile_dataset(
    input_jsonl: Path,
    ledger_path: Path,
    output_directory: Path,
    *,
    options: CompileOptions,
) -> dict[str, Any]:
    """Compile one canonical dataset and return its persisted manifest."""

    options.validate()
    source_bytes = _read_bytes(input_jsonl, "input JSONL")
    ledger_bytes = _read_bytes(ledger_path, "dataset ledger")
    ledger = _parse_json_object(ledger_bytes, "dataset ledger")
    input_sha256 = _sha256_bytes(source_bytes)
    raw_records = _parse_jsonl(source_bytes)
    allowed_sources = _validate_ledger(
        ledger,
        purpose=options.purpose,
        input_sha256=input_sha256,
        raw_records=raw_records,
        content_profile=options.content_profile,
    )
    schema_version = (
        DATASET_SCHEMA_VERSION
        if options.content_profile == "harmonyOnlyV1"
        else LEGACY_DATASET_SCHEMA_VERSION
    )

    normalized: list[dict[str, Any]] = []
    excluded: dict[str, int] = {}
    seen_record_ids: set[str] = set()
    for raw in raw_records:
        record_id = _required_string(raw, "recordId")
        if record_id in seen_record_ids:
            raise DatasetCompileError(f"duplicate recordId: {record_id}")
        seen_record_ids.add(record_id)
        try:
            record = _normalize_record(
                raw,
                allowed_sources=allowed_sources,
                options=options,
            )
        except _ExcludedRecord as exc:
            excluded[exc.reason] = excluded.get(exc.reason, 0) + 1
            continue
        normalized.append(record)

    if not normalized:
        raise DatasetCompileError("no eligible records remained after validation")

    group_keys = _split_group_keys(normalized)
    split_rows: dict[str, list[dict[str, Any]]] = {
        split: [] for split in SPLIT_FILES
    }
    split_groups: dict[str, set[str]] = {split: set() for split in SPLIT_FILES}
    record_splits: dict[str, str] = {}
    for record in sorted(normalized, key=lambda item: item["recordId"]):
        group_key = group_keys[record["recordId"]]
        split = _assign_split(group_key, options)
        split_group_id = _sha256_bytes(group_key.encode("utf-8"))
        split_groups[split].add(split_group_id)
        record_splits[record["recordId"]] = split
        split_rows[split].extend(
            _window_record(
                record,
                split_group_id=split_group_id,
                maximum_frames=options.maximum_frames_per_window,
                schema_version=schema_version,
                content_profile=options.content_profile,
            )
        )

    output_directory.mkdir(parents=True, exist_ok=True)
    vocabulary = _vocabulary_payload(schema_version=schema_version)
    vocabulary_bytes = _canonical_json_bytes(vocabulary)
    _write_bytes(output_directory / VOCABULARY_FILE, vocabulary_bytes)

    provenance_descriptor: dict[str, Any] | None = None
    if schema_version == DATASET_SCHEMA_VERSION:
        provenance = _provenance_payload(ledger)
        provenance_bytes = _canonical_json_bytes(provenance)
        _write_bytes(output_directory / PROVENANCE_FILE, provenance_bytes)
        provenance_descriptor = {
            "file": PROVENANCE_FILE,
            "sha256": _sha256_bytes(provenance_bytes),
        }

    split_manifests: dict[str, dict[str, Any]] = {}
    for split, file_name in SPLIT_FILES.items():
        ordered_rows = sorted(
            split_rows[split],
            key=lambda item: (item["recordId"], item["windowIndex"]),
        )
        payload = b"".join(_canonical_json_bytes(row) for row in ordered_rows)
        _write_bytes(output_directory / file_name, payload)
        split_manifests[split] = {
            "file": file_name,
            "sha256": _sha256_bytes(payload),
            "windowCount": len(ordered_rows),
            "recordCount": sum(
                1 for record_split in record_splits.values() if record_split == split
            ),
            "splitGroupCount": len(split_groups[split]),
        }

    fingerprint_counts: dict[str, int] = {}
    for record in normalized:
        fingerprint = record["normalizedFingerprint"]
        fingerprint_counts[fingerprint] = fingerprint_counts.get(fingerprint, 0) + 1
    collision_groups = sum(count > 1 for count in fingerprint_counts.values())
    statistics = {
        "schemaVersion": schema_version,
        "contentProfile": options.content_profile,
        "eligibleRecordCount": len(normalized),
        "excludedRecordCount": sum(excluded.values()),
        "excludedByReason": dict(sorted(excluded.items())),
        "windowCount": sum(
            split["windowCount"] for split in split_manifests.values()
        ),
        "frameCount": sum(
            row["frameCount"]
            for rows in split_rows.values()
            for row in rows
        ),
        "normalizedFingerprintCollisionGroups": collision_groups,
    }
    statistics_bytes = _canonical_json_bytes(statistics)
    _write_bytes(output_directory / STATISTICS_FILE, statistics_bytes)

    assignments = [
        {
            "recordId": record["recordId"],
            "split": record_splits[record["recordId"]],
            "splitGroupId": _sha256_bytes(
                group_keys[record["recordId"]].encode("utf-8")
            ),
        }
        for record in sorted(normalized, key=lambda item: item["recordId"])
    ]
    manifest = {
        "schemaVersion": schema_version,
        "compilerVersion": COMPILER_VERSION,
        "datasetId": options.dataset_id,
        "datasetVersion": options.dataset_version,
        "purpose": options.purpose,
        "deterministic": True,
        "splitBeforeWindowing": True,
        "splitSeed": options.split_seed,
        "splitBasisPoints": {
            "train": options.train_basis_points,
            "validation": options.validation_basis_points,
            "test": options.test_basis_points,
        },
        "input": {
            "sha256": input_sha256,
            "recordCount": len(raw_records),
        },
        "ledger": {
            "sha256": _sha256_bytes(ledger_bytes),
            "sourceIds": sorted(allowed_sources),
            "sourceChecksumScope": (
                "perSourceCanonicalNormalizedRecords"
                if schema_version == DATASET_SCHEMA_VERSION
                else "completeCompilerInputJsonlBytes"
            ),
        },
        "tokenizerSha256": TOKENIZER_SHA256,
        "vocabulary": {
            "file": VOCABULARY_FILE,
            "sha256": _sha256_bytes(vocabulary_bytes),
        },
        "statistics": {
            "file": STATISTICS_FILE,
            "sha256": _sha256_bytes(statistics_bytes),
        },
        "normalization": {
            "ppq": 480,
            "frame": "sixteenth",
            "rootEncoding": "keyRelativePitchClass",
            "bassEncoding": "rootRelativePitchClass",
            "unsupportedQualityPolicy": options.unsupported_quality_policy,
            "harmonyGapPolicy": options.harmony_gap_policy,
            "normalizedFingerprint": (
                "sha256-relative-harmony-key-meter-v1"
                if options.content_profile == "harmonyOnlyV1"
                else "sha256-relative-melody-harmony-v1"
            ),
        },
        "splits": split_manifests,
        "assignments": assignments,
    }
    if schema_version == DATASET_SCHEMA_VERSION:
        manifest.update(
            {
                "contentProfile": options.content_profile,
                "distributionScope": PRIVATE_LOCAL_DISTRIBUTION_SCOPE,
                "provenance": provenance_descriptor,
            }
        )
    manifest_bytes = _canonical_json_bytes(manifest)
    _write_bytes(output_directory / DATA_MANIFEST_FILE, manifest_bytes)
    return manifest


def load_data_manifest(
    manifest_path: Path,
    *,
    verify_files: bool = True,
) -> dict[str, Any]:
    """Load a compiled manifest and optionally verify every output hash."""

    payload = _parse_json_object(
        _read_bytes(manifest_path, "data manifest"),
        "data manifest",
    )
    return _validate_data_manifest_payload(
        payload,
        manifest_path=manifest_path,
        verify_files=verify_files,
    )


def load_data_manifest_bytes(data: bytes) -> dict[str, Any]:
    """Validate one in-memory manifest snapshot without reopening its path."""

    payload = _parse_json_object(data, "data manifest")
    return _validate_data_manifest_payload(
        payload,
        manifest_path=None,
        verify_files=False,
    )


def _validate_data_manifest_payload(
    payload: dict[str, Any],
    *,
    manifest_path: Path | None,
    verify_files: bool,
) -> dict[str, Any]:
    legacy_required = {
        "schemaVersion",
        "compilerVersion",
        "datasetId",
        "datasetVersion",
        "purpose",
        "deterministic",
        "splitBeforeWindowing",
        "splitSeed",
        "splitBasisPoints",
        "input",
        "ledger",
        "tokenizerSha256",
        "vocabulary",
        "statistics",
        "normalization",
        "splits",
        "assignments",
    }
    schema_version = payload.get("schemaVersion")
    if schema_version == LEGACY_DATASET_SCHEMA_VERSION:
        required = legacy_required
    elif schema_version == DATASET_SCHEMA_VERSION:
        required = legacy_required | {
            "contentProfile",
            "distributionScope",
            "provenance",
        }
    else:
        raise DatasetCompileError("unsupported data manifest schema version")
    if set(payload) != required:
        raise DatasetCompileError(
            f"data manifest fields do not match schema v{schema_version}"
        )
    if payload["compilerVersion"] not in SUPPORTED_COMPILER_VERSIONS:
        raise DatasetCompileError("unsupported data compiler version")
    if payload["deterministic"] is not True:
        raise DatasetCompileError("dataset must declare deterministic compilation")
    if payload["splitBeforeWindowing"] is not True:
        raise DatasetCompileError("dataset must split records before windowing")
    if payload["tokenizerSha256"] != TOKENIZER_SHA256:
        raise DatasetCompileError("dataset tokenizer hash does not match runtime")
    if schema_version == DATASET_SCHEMA_VERSION:
        if payload["contentProfile"] != "harmonyOnlyV1":
            raise DatasetCompileError("schema v2 requires harmonyOnlyV1 content")
        if payload["distributionScope"] != PRIVATE_LOCAL_DISTRIBUTION_SCOPE:
            raise DatasetCompileError("schema v2 dataset must stay private and local")
        normalization = payload.get("normalization")
        if (
            not isinstance(normalization, dict)
            or normalization.get("normalizedFingerprint")
            != "sha256-relative-harmony-key-meter-v1"
        ):
            raise DatasetCompileError("schema v2 normalization profile is invalid")

    splits = payload["splits"]
    if not isinstance(splits, dict) or set(splits) != set(SPLIT_FILES):
        raise DatasetCompileError("data manifest split set is invalid")
    assignments = payload["assignments"]
    if not isinstance(assignments, list):
        raise DatasetCompileError("data manifest assignments must be a list")
    group_splits: dict[str, str] = {}
    for assignment in assignments:
        if not isinstance(assignment, dict):
            raise DatasetCompileError("data manifest assignment is invalid")
        group = _required_string(assignment, "splitGroupId")
        split = _required_string(assignment, "split")
        if split not in SPLIT_FILES:
            raise DatasetCompileError("assignment names an unknown split")
        previous = group_splits.setdefault(group, split)
        if previous != split:
            raise DatasetCompileError("one split group crosses dataset splits")

    if verify_files:
        if manifest_path is None:
            raise DatasetCompileError(
                "data manifest artifact verification requires a source path"
            )
        directory = manifest_path.resolve().parent
        artifacts = [
            payload["vocabulary"],
            payload["statistics"],
            *splits.values(),
        ]
        if schema_version == DATASET_SCHEMA_VERSION:
            artifacts.append(payload["provenance"])
        for artifact in artifacts:
            _verify_manifest_artifact(directory, artifact)
    return payload


def iter_compiled_split(
    manifest_path: Path,
    split: Literal["train", "validation", "test"],
) -> Iterable[dict[str, Any]]:
    manifest = load_data_manifest(manifest_path)
    descriptor = manifest["splits"][split]
    split_path = _safe_child(manifest_path.resolve().parent, descriptor["file"])
    for line_number, line in enumerate(
        split_path.read_text(encoding="utf-8").splitlines(),
        start=1,
    ):
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise DatasetCompileError(
                f"compiled split has invalid JSON at line {line_number}"
            ) from exc
        if not isinstance(value, dict):
            raise DatasetCompileError("compiled split rows must be objects")
        yield value


def _validate_ledger(
    ledger: dict[str, Any],
    *,
    purpose: str,
    input_sha256: str,
    raw_records: Sequence[dict[str, Any]],
    content_profile: ContentProfile,
) -> dict[str, dict[str, Any]]:
    schema_version = ledger.get("schemaVersion")
    if content_profile == "melodyHarmonyV1":
        if schema_version != LEGACY_DATASET_SCHEMA_VERSION:
            raise DatasetCompileError(
                "melodyHarmonyV1 requires dataset ledger schema v1"
            )
        return _validate_legacy_ledger(
            ledger,
            purpose=purpose,
            input_sha256=input_sha256,
        )
    if schema_version != DATASET_SCHEMA_VERSION:
        raise DatasetCompileError(
            "harmonyOnlyV1 requires dataset ledger schema v2"
        )
    return _validate_harmony_only_ledger(
        ledger,
        purpose=purpose,
        input_sha256=input_sha256,
        raw_records=raw_records,
    )


def _validate_legacy_ledger(
    ledger: dict[str, Any],
    *,
    purpose: str,
    input_sha256: str,
) -> dict[str, dict[str, Any]]:
    expected = {"schemaVersion", "rawDataInGit", "sources"}
    if set(ledger) != expected:
        raise DatasetCompileError("dataset ledger fields do not match schema v1")
    if ledger["schemaVersion"] != LEGACY_DATASET_SCHEMA_VERSION:
        raise DatasetCompileError("unsupported dataset ledger schema version")
    if ledger["rawDataInGit"] is not False:
        raise DatasetCompileError("raw source data must stay outside Git")
    sources = ledger["sources"]
    if not isinstance(sources, list) or not sources:
        raise DatasetCompileError("dataset ledger requires at least one source")
    allowed: dict[str, dict[str, Any]] = {}
    required = {
        "sourceId",
        "version",
        "license",
        "allowedPurposes",
        "checksumSha256",
        "removalProcedure",
    }
    for source in sources:
        if not isinstance(source, dict) or set(source) != required:
            raise DatasetCompileError("dataset source fields do not match schema v1")
        source_id = _required_string(source, "sourceId")
        license_name = _required_string(source, "license")
        if license_name.lower() in {"unknown", "unverified", "none"}:
            raise DatasetCompileError(f"source {source_id} has an unclear license")
        purposes = source["allowedPurposes"]
        if (
            not isinstance(purposes, list)
            or not all(isinstance(item, str) for item in purposes)
            or purpose not in purposes
        ):
            raise DatasetCompileError(
                f"source {source_id} is not approved for {purpose}"
            )
        checksum = _required_string(source, "checksumSha256")
        if not _is_sha256(checksum):
            raise DatasetCompileError(f"source {source_id} checksum is invalid")
        if checksum != input_sha256:
            raise DatasetCompileError(
                f"source {source_id} checksum does not match input JSONL bytes"
            )
        _required_string(source, "version")
        _required_string(source, "removalProcedure")
        if source_id in allowed:
            raise DatasetCompileError(f"duplicate sourceId in ledger: {source_id}")
        allowed[source_id] = source
    return allowed


def _validate_harmony_only_ledger(
    ledger: dict[str, Any],
    *,
    purpose: str,
    input_sha256: str,
    raw_records: Sequence[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    expected = {
        "schemaVersion",
        "policyId",
        "purpose",
        "distributionScope",
        "rawDataInGit",
        "normalizedInputSha256",
        "sources",
    }
    if set(ledger) != expected:
        raise DatasetCompileError("dataset ledger fields do not match schema v2")
    if ledger["schemaVersion"] != DATASET_SCHEMA_VERSION:
        raise DatasetCompileError("unsupported dataset ledger schema version")
    if ledger["policyId"] != PRIVATE_HARMONY_POLICY_ID:
        raise DatasetCompileError("dataset ledger policy is not approved")
    if ledger["purpose"] != purpose or purpose != PRIVATE_HARMONY_TRAINING_PURPOSE:
        raise DatasetCompileError("dataset ledger purpose is not approved")
    if ledger["distributionScope"] != PRIVATE_LOCAL_DISTRIBUTION_SCOPE:
        raise DatasetCompileError("harmony-only dataset must stay private and local")
    if ledger["rawDataInGit"] is not False:
        raise DatasetCompileError("raw source data must stay outside Git")
    normalized_input_sha256 = ledger["normalizedInputSha256"]
    if not _is_sha256(normalized_input_sha256):
        raise DatasetCompileError("normalized input checksum is invalid")
    if normalized_input_sha256 != input_sha256:
        raise DatasetCompileError(
            "normalized input checksum does not match input JSONL bytes"
        )

    sources = ledger["sources"]
    if not isinstance(sources, list) or not sources:
        raise DatasetCompileError("dataset ledger requires at least one source")
    records_by_source: dict[str, list[dict[str, Any]]] = {}
    for record in raw_records:
        source_id = _required_string(record, "sourceId")
        records_by_source.setdefault(source_id, []).append(record)

    allowed: dict[str, dict[str, Any]] = {}
    required_source_fields = {
        "sourceId",
        "version",
        "canonicalUrl",
        "citation",
        "retrievedAt",
        "sourceMaterialSha256",
        "normalizedRecordsSha256",
        "review",
        "attribution",
        "removalProcedure",
    }
    required_review_fields = {
        "status",
        "basis",
        "licenseId",
        "allowedContent",
        "reviewedAt",
    }
    allowed_bases = {
        "license",
        "publicDomain",
        "contract",
        "ownerProvided",
        "statutoryException",
    }
    required_content = {"harmony", "key", "meter"}
    for source in sources:
        if not isinstance(source, dict) or set(source) != required_source_fields:
            raise DatasetCompileError("dataset source fields do not match schema v2")
        source_id = _required_string(source, "sourceId")
        if source_id in allowed:
            raise DatasetCompileError(f"duplicate sourceId in ledger: {source_id}")
        _required_string(source, "version")
        _validate_https_url(_required_string(source, "canonicalUrl"))
        _required_string(source, "citation")
        _validate_utc_timestamp(_required_string(source, "retrievedAt"))
        source_material_sha256 = _required_string(source, "sourceMaterialSha256")
        if not _is_sha256(source_material_sha256):
            raise DatasetCompileError(
                f"source {source_id} material checksum is invalid"
            )
        normalized_records_sha256 = _required_string(
            source,
            "normalizedRecordsSha256",
        )
        if not _is_sha256(normalized_records_sha256):
            raise DatasetCompileError(
                f"source {source_id} normalized record checksum is invalid"
            )
        source_records = records_by_source.get(source_id)
        if not source_records:
            raise DatasetCompileError(
                f"source {source_id} has no normalized input records"
            )
        actual_records_sha256 = _source_records_sha256(source_records)
        if normalized_records_sha256 != actual_records_sha256:
            raise DatasetCompileError(
                f"source {source_id} normalized record checksum does not match"
            )
        review = source["review"]
        if not isinstance(review, dict) or set(review) != required_review_fields:
            raise DatasetCompileError("dataset source review does not match schema v2")
        if review["status"] != "approved":
            raise DatasetCompileError(
                f"source {source_id} review status is not approved"
            )
        if review["basis"] not in allowed_bases:
            raise DatasetCompileError(
                f"source {source_id} review basis is not supported"
            )
        license_id = review["licenseId"]
        if license_id is not None and (
            not isinstance(license_id, str)
            or not license_id
            or len(license_id) > 128
        ):
            raise DatasetCompileError(
                f"source {source_id} licenseId is invalid"
            )
        if review["basis"] == "license" and license_id is None:
            raise DatasetCompileError(
                f"source {source_id} license review requires licenseId"
            )
        allowed_content = review["allowedContent"]
        if (
            not isinstance(allowed_content, list)
            or not all(isinstance(item, str) for item in allowed_content)
            or set(allowed_content) != required_content
        ):
            raise DatasetCompileError(
                f"source {source_id} must allow only harmony, key, and meter"
            )
        _validate_utc_timestamp(_required_string(review, "reviewedAt"))
        _required_string(source, "attribution")
        _required_string(source, "removalProcedure")
        allowed[source_id] = source

    unknown_sources = set(records_by_source) - set(allowed)
    if unknown_sources:
        raise DatasetCompileError(
            "normalized records reference sources absent from the ledger: "
            + ", ".join(sorted(unknown_sources))
        )
    return allowed


def _normalize_record(
    raw: dict[str, Any],
    *,
    allowed_sources: Mapping[str, dict[str, Any]],
    options: CompileOptions,
) -> dict[str, Any]:
    legacy_allowed_fields = {
        "recordId",
        "workId",
        "duplicateGroupId",
        "sourceId",
        "sourceItemId",
        "ppq",
        "ticksPerBar",
        "timeSignature",
        "startTick",
        "endTick",
        "melody",
        "harmony",
        "tonalities",
        "style",
        "synthetic",
    }
    harmony_only_allowed_fields = legacy_allowed_fields - {"melody", "style"}
    if options.content_profile == "harmonyOnlyV1":
        forbidden = set(raw) & HARMONY_ONLY_FORBIDDEN_FIELDS
        if forbidden:
            raise DatasetCompileError(
                "harmonyOnlyV1 forbids source content fields: "
                + ", ".join(sorted(forbidden))
            )
        allowed_fields = harmony_only_allowed_fields
    else:
        allowed_fields = legacy_allowed_fields
    unknown = set(raw) - allowed_fields
    if unknown:
        raise DatasetCompileError(
            f"record contains unknown fields: {', '.join(sorted(unknown))}"
        )
    record_id = _required_string(raw, "recordId")
    work_id = _required_string(raw, "workId")
    source_id = _required_string(raw, "sourceId")
    if source_id not in allowed_sources:
        raise DatasetCompileError(
            f"record {record_id} references an unapproved source"
        )
    source_item_id = _required_string(raw, "sourceItemId")
    duplicate_group_id = raw.get("duplicateGroupId")
    if duplicate_group_id is not None and (
        not isinstance(duplicate_group_id, str) or not duplicate_group_id
    ):
        raise DatasetCompileError("duplicateGroupId must be a non-empty string")
    ppq = _required_integer(raw, "ppq", minimum=24, maximum=9600)
    if ppq != 480:
        raise DatasetCompileError("v1 compiler requires normalized PPQ 480")
    if ppq % 4:
        raise DatasetCompileError("ppq must be divisible by four")
    frame_ticks = ppq // 4
    time_signature = _required_string(raw, "timeSignature")
    if time_signature not in SUPPORTED_TIME_SIGNATURES:
        raise DatasetCompileError("unsupported time signature")
    ticks_per_bar = _required_integer(
        raw,
        "ticksPerBar",
        minimum=96,
        maximum=38_400,
    )
    if ticks_per_bar != ppq * SUPPORTED_TIME_SIGNATURES[time_signature]:
        raise DatasetCompileError("ticksPerBar is inconsistent with PPQ")
    start_tick = _required_integer(raw, "startTick", minimum=0)
    end_tick = _required_integer(raw, "endTick", minimum=1)
    if end_tick <= start_tick:
        raise DatasetCompileError("record endTick must be after startTick")
    if start_tick % frame_ticks or end_tick % frame_ticks:
        raise DatasetCompileError("record range must align to sixteenth frames")
    if end_tick - start_tick > 128 * ticks_per_bar:
        raise DatasetCompileError("record exceeds the 128-bar model contract")

    tonalities = _normalize_tonalities(
        raw.get("tonalities"),
        start_tick=start_tick,
        end_tick=end_tick,
        frame_ticks=frame_ticks,
    )
    melody = (
        []
        if options.content_profile == "harmonyOnlyV1"
        else _normalize_melody(raw.get("melody"), start_tick, end_tick)
    )
    harmony = _normalize_harmony(
        raw.get("harmony"),
        start_tick=start_tick,
        end_tick=end_tick,
        policy=options.unsupported_quality_policy,
        gap_policy=options.harmony_gap_policy,
        frame_ticks=frame_ticks,
    )
    style = (
        "harmonyOnly"
        if options.content_profile == "harmonyOnlyV1"
        else raw.get("style", "unknown")
    )
    if not isinstance(style, str) or not style or len(style) > 64:
        raise DatasetCompileError("style must contain between 1 and 64 characters")
    synthetic = raw.get("synthetic", False)
    if not isinstance(synthetic, bool):
        raise DatasetCompileError("synthetic must be boolean")

    frames = _frame_record(
        melody=melody,
        harmony=harmony,
        tonalities=tonalities,
        start_tick=start_tick,
        end_tick=end_tick,
        frame_ticks=frame_ticks,
        ticks_per_bar=ticks_per_bar,
    )
    fingerprint = _normalized_fingerprint(
        melody=melody,
        harmony=harmony,
        tonalities=tonalities,
        start_tick=start_tick,
        frame_ticks=frame_ticks,
        content_profile=options.content_profile,
    )
    return {
        "recordId": record_id,
        "workId": work_id,
        "duplicateGroupId": duplicate_group_id,
        "sourceId": source_id,
        "sourceItemId": source_item_id,
        "ppq": ppq,
        "ticksPerBar": ticks_per_bar,
        "timeSignature": time_signature,
        "startTick": start_tick,
        "endTick": end_tick,
        "style": style,
        "synthetic": synthetic,
        "normalizedFingerprint": fingerprint,
        "frames": frames,
    }


def _normalize_tonalities(
    value: Any,
    *,
    start_tick: int,
    end_tick: int,
    frame_ticks: int,
) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise DatasetCompileError("tonalities must be a non-empty list")
    if not all(isinstance(item, dict) for item in value):
        raise DatasetCompileError("tonality spans must be objects")
    result: list[dict[str, Any]] = []
    cursor = start_tick
    for raw in sorted(value, key=lambda item: item.get("startTick", -1)):
        if set(raw) != {"startTick", "endTick", "keyRoot", "mode"}:
            raise DatasetCompileError("tonality fields do not match schema v1")
        span_start = _required_integer(raw, "startTick", minimum=0)
        span_end = _required_integer(raw, "endTick", minimum=1)
        if span_start != cursor or span_end <= span_start or span_end > end_tick:
            raise DatasetCompileError(
                "tonalities must cover the record without gaps or overlaps"
            )
        if span_start % frame_ticks or span_end % frame_ticks:
            raise DatasetCompileError("tonalities must align to sixteenth frames")
        key_root = _required_integer(raw, "keyRoot", minimum=0, maximum=11)
        mode = _required_string(raw, "mode")
        if mode not in MODE_VOCABULARY:
            raise DatasetCompileError(f"unsupported mode: {mode}")
        result.append(
            {
                "startTick": span_start,
                "endTick": span_end,
                "keyRoot": key_root,
                "mode": mode,
            }
        )
        cursor = span_end
    if cursor != end_tick:
        raise DatasetCompileError(
            "tonalities must cover the record without gaps or overlaps"
        )
    return result


def _normalize_melody(
    value: Any,
    start_tick: int,
    end_tick: int,
) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise DatasetCompileError("melody must be a list")
    result: list[dict[str, Any]] = []
    for raw in value:
        if not isinstance(raw, dict):
            raise DatasetCompileError("melody notes must be objects")
        allowed = {"startTick", "durationTick", "midi", "velocity", "role"}
        if set(raw) - allowed:
            raise DatasetCompileError("melody note fields do not match schema v1")
        note_start = _required_integer(raw, "startTick", minimum=0)
        duration = _required_integer(raw, "durationTick", minimum=1)
        if note_start < start_tick or note_start + duration > end_tick:
            raise DatasetCompileError("melody note extends beyond the record")
        midi = _required_integer(raw, "midi", minimum=0, maximum=127)
        role = raw.get("role", "unknown")
        if role not in ROLE_VOCABULARY:
            raise DatasetCompileError(f"unsupported melody role: {role}")
        velocity = raw.get("velocity", 96)
        if (
            not isinstance(velocity, int)
            or isinstance(velocity, bool)
            or not 1 <= velocity <= 127
        ):
            raise DatasetCompileError("melody velocity must be between 1 and 127")
        result.append(
            {
                "startTick": note_start,
                "durationTick": duration,
                "midi": midi,
                "velocity": velocity,
                "role": role,
            }
        )
    return sorted(
        result,
        key=lambda item: (item["startTick"], item["midi"], item["durationTick"]),
    )


def _normalize_harmony(
    value: Any,
    *,
    start_tick: int,
    end_tick: int,
    policy: UnsupportedQualityPolicy,
    gap_policy: HarmonyGapPolicy,
    frame_ticks: int,
) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise DatasetCompileError("harmony must be a list")
    if not all(isinstance(item, dict) for item in value):
        raise DatasetCompileError("harmony events must be objects")
    result: list[dict[str, Any]] = []
    previous_end = start_tick
    for raw in sorted(value, key=lambda item: item.get("startTick", -1)):
        allowed = {
            "startTick",
            "durationTick",
            "rootOffsetFromKey",
            "quality",
            "inversion",
            "bassOffsetFromRoot",
            "extensions",
            "originalLabel",
        }
        if set(raw) - allowed:
            raise DatasetCompileError("harmony event fields do not match schema v1")
        event_start = _required_integer(raw, "startTick", minimum=0)
        duration = _required_integer(raw, "durationTick", minimum=1)
        event_end = event_start + duration
        if event_start < start_tick or event_end > end_tick:
            raise DatasetCompileError("harmony event extends beyond the record")
        if event_start % frame_ticks or event_end % frame_ticks:
            raise DatasetCompileError(
                "harmony events must align to sixteenth frames"
            )
        if event_start < previous_end:
            raise DatasetCompileError("harmony events must not overlap")
        if event_start > previous_end and gap_policy == "excludeRecord":
            raise _ExcludedRecord("harmonyGap")
        previous_end = event_end
        root = _required_integer(
            raw,
            "rootOffsetFromKey",
            minimum=0,
            maximum=11,
        )
        raw_quality = _required_string(raw, "quality")
        quality = raw_quality
        if quality not in QUALITY_VOCABULARY:
            if policy == "excludeRecord":
                raise _ExcludedRecord("unsupportedQuality")
            quality = "other"
        if quality == "other" and policy == "excludeRecord":
            raise _ExcludedRecord("unsupportedQuality")
        inversion = raw.get("inversion", 0)
        if (
            not isinstance(inversion, int)
            or isinstance(inversion, bool)
            or not 0 <= inversion <= 4
        ):
            raise DatasetCompileError("harmony inversion must be between 0 and 4")
        bass = raw.get("bassOffsetFromRoot", 0)
        if (
            not isinstance(bass, int)
            or isinstance(bass, bool)
            or not 0 <= bass <= 11
        ):
            raise DatasetCompileError(
                "bassOffsetFromRoot must be between 0 and 11"
            )
        extensions = raw.get("extensions", [])
        if (
            not isinstance(extensions, list)
            or len(extensions) != len(set(extensions))
            or any(item not in EXTENSION_VOCABULARY for item in extensions)
        ):
            raise DatasetCompileError("harmony extensions are invalid")
        original_label = raw.get("originalLabel", raw_quality)
        if not isinstance(original_label, str) or len(original_label) > 128:
            raise DatasetCompileError("originalLabel is invalid")
        result.append(
            {
                "startTick": event_start,
                "durationTick": duration,
                "rootOffsetFromKey": root,
                "quality": quality,
                "inversion": inversion,
                "bassOffsetFromRoot": bass,
                "extensions": sorted(
                    extensions,
                    key=EXTENSION_VOCABULARY.index,
                ),
                "originalLabel": original_label,
            }
        )
    if previous_end < end_tick and gap_policy == "excludeRecord":
        raise _ExcludedRecord("harmonyGap")
    return result


def _frame_record(
    *,
    melody: Sequence[dict[str, Any]],
    harmony: Sequence[dict[str, Any]],
    tonalities: Sequence[dict[str, Any]],
    start_tick: int,
    end_tick: int,
    frame_ticks: int,
    ticks_per_bar: int,
) -> dict[str, list[Any]]:
    frames: dict[str, list[Any]] = {
        "melodyMidi": [],
        "melodyRole": [],
        "metricalSlot": [],
        "barIndex": [],
        "keyRoot": [],
        "mode": [],
        "event": [],
        "root": [],
        "quality": [],
        "inversion": [],
        "bass": [],
        "extensions": [],
    }
    previous_chord: dict[str, Any] | None = None
    for tick in range(start_tick, end_tick, frame_ticks):
        active_notes = [
            note
            for note in melody
            if note["startTick"] <= tick
            < note["startTick"] + note["durationTick"]
        ]
        note = (
            max(active_notes, key=lambda item: (item["midi"], -item["startTick"]))
            if active_notes
            else None
        )
        tonality = next(
            span
            for span in tonalities
            if span["startTick"] <= tick < span["endTick"]
        )
        active_chords = [
            chord
            for chord in harmony
            if chord["startTick"] <= tick
            < chord["startTick"] + chord["durationTick"]
        ]
        chord = active_chords[0] if active_chords else None
        frames["melodyMidi"].append(128 if note is None else note["midi"])
        frames["melodyRole"].append(
            ROLE_VOCABULARY.index("unknown" if note is None else note["role"])
        )
        frames["metricalSlot"].append(
            min(15, ((tick % ticks_per_bar) * 16) // ticks_per_bar)
        )
        frames["barIndex"].append((tick - start_tick) // ticks_per_bar)
        frames["keyRoot"].append(tonality["keyRoot"])
        frames["mode"].append(MODE_VOCABULARY.index(tonality["mode"]))
        if chord is None:
            frames["event"].append(EVENT_VOCABULARY.index("noChord"))
            frames["root"].append(-100)
            frames["quality"].append(-100)
            frames["inversion"].append(-100)
            frames["bass"].append(-100)
            frames["extensions"].append([0] * len(EXTENSION_VOCABULARY))
            previous_chord = None
            continue
        event_name = "hold" if previous_chord is chord else "change"
        frames["event"].append(EVENT_VOCABULARY.index(event_name))
        frames["root"].append(chord["rootOffsetFromKey"])
        frames["quality"].append(QUALITY_VOCABULARY.index(chord["quality"]))
        frames["inversion"].append(chord["inversion"])
        frames["bass"].append(chord["bassOffsetFromRoot"])
        frames["extensions"].append(
            [
                int(extension in chord["extensions"])
                for extension in EXTENSION_VOCABULARY
            ]
        )
        previous_chord = chord
    return frames


def _normalized_fingerprint(
    *,
    melody: Sequence[dict[str, Any]],
    harmony: Sequence[dict[str, Any]],
    tonalities: Sequence[dict[str, Any]],
    start_tick: int,
    frame_ticks: int,
    content_profile: ContentProfile,
) -> str:
    relative_melody = []
    for note in melody:
        tonality = next(
            span
            for span in tonalities
            if span["startTick"] <= note["startTick"] < span["endTick"]
        )
        relative_melody.append(
            [
                (note["midi"] - tonality["keyRoot"]) % 12,
                (note["startTick"] - start_tick) // frame_ticks,
                max(1, round(note["durationTick"] / frame_ticks)),
            ]
        )
    relative_harmony = [
        [
            (chord["startTick"] - start_tick) // frame_ticks,
            max(1, round(chord["durationTick"] / frame_ticks)),
            chord["rootOffsetFromKey"],
            chord["quality"],
            chord["inversion"],
            chord["bassOffsetFromRoot"],
            chord["extensions"],
        ]
        for chord in harmony
    ]
    payload: dict[str, Any] = {"harmony": relative_harmony}
    if content_profile == "harmonyOnlyV1":
        payload["tonalities"] = [
            [
                (span["startTick"] - start_tick) // frame_ticks,
                max(1, round((span["endTick"] - span["startTick"]) / frame_ticks)),
                span["mode"],
            ]
            for span in tonalities
        ]
    else:
        payload["melody"] = relative_melody
    return _sha256_bytes(_canonical_json_bytes(payload))


def _split_group_keys(records: Sequence[dict[str, Any]]) -> dict[str, str]:
    parent = list(range(len(records)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[max(left_root, right_root)] = min(left_root, right_root)

    owners: dict[str, int] = {}
    identities: list[list[str]] = []
    for index, record in enumerate(records):
        source_item_identity = _sha256_bytes(
            _canonical_json_bytes(
                {
                    "sourceId": record["sourceId"],
                    "sourceItemId": record["sourceItemId"],
                }
            )
        )
        record_identities = [
            f"work:{record['workId']}",
            f"fingerprint:{record['normalizedFingerprint']}",
            f"source-item:{source_item_identity}",
        ]
        if record["duplicateGroupId"] is not None:
            record_identities.append(f"duplicate:{record['duplicateGroupId']}")
        identities.append(record_identities)
        for identity in record_identities:
            previous = owners.setdefault(identity, index)
            union(index, previous)

    component_identities: dict[int, set[str]] = {}
    for index, values in enumerate(identities):
        component_identities.setdefault(find(index), set()).update(values)
    result: dict[str, str] = {}
    for index, record in enumerate(records):
        component = component_identities[find(index)]
        result[record["recordId"]] = min(component)
    return result


def _assign_split(group_key: str, options: CompileOptions) -> str:
    value = int.from_bytes(
        hashlib.sha256(
            f"{options.split_seed}:{group_key}".encode()
        ).digest()[:8],
        "big",
    ) % 10_000
    if value < options.train_basis_points:
        return "train"
    if value < options.train_basis_points + options.validation_basis_points:
        return "validation"
    return "test"


def _window_record(
    record: dict[str, Any],
    *,
    split_group_id: str,
    maximum_frames: int,
    schema_version: int,
    content_profile: ContentProfile,
) -> list[dict[str, Any]]:
    frames = record["frames"]
    frame_count = len(frames["event"])
    rows: list[dict[str, Any]] = []
    for window_index, first in enumerate(range(0, frame_count, maximum_frames)):
        last = min(frame_count, first + maximum_frames)
        start_tick = record["startTick"] + first * (record["ppq"] // 4)
        row = {
                "schemaVersion": schema_version,
                "recordId": record["recordId"],
                "windowId": f"{record['recordId']}:{window_index:04d}",
                "windowIndex": window_index,
                "workId": record["workId"],
                "splitGroupId": split_group_id,
                "sourceId": record["sourceId"],
                "sourceItemId": record["sourceItemId"],
                "style": record["style"],
                "synthetic": record["synthetic"],
                "startTick": start_tick,
                "frameTicks": record["ppq"] // 4,
                "ticksPerBar": record["ticksPerBar"],
                "frameCount": last - first,
                "inputs": {
                    key: frames[key][first:last]
                    for key in (
                        "melodyMidi",
                        "melodyRole",
                        "metricalSlot",
                        "barIndex",
                        "keyRoot",
                        "mode",
                    )
                },
                "targets": {
                    key: frames[key][first:last]
                    for key in (
                        "event",
                        "root",
                        "quality",
                        "inversion",
                        "bass",
                        "extensions",
                    )
                },
            }
        if schema_version == DATASET_SCHEMA_VERSION:
            row["contentProfile"] = content_profile
        rows.append(row)
    return rows


def _vocabulary_payload(*, schema_version: int) -> dict[str, Any]:
    return {
        "schemaVersion": schema_version,
        "tokenizerSha256": TOKENIZER_SHA256,
        "events": list(EVENT_VOCABULARY),
        "qualities": list(QUALITY_VOCABULARY),
        "modes": list(MODE_VOCABULARY),
        "roles": list(ROLE_VOCABULARY),
        "extensions": list(EXTENSION_VOCABULARY),
        "roots": {
            "classes": 12,
            "encoding": "keyRelativePitchClass",
        },
        "bass": {
            "classes": 12,
            "encoding": "rootRelativePitchClass",
        },
        "inversion": {
            "classes": 5,
            "analysisOnlyClass": 4,
        },
    }


def _provenance_payload(ledger: Mapping[str, Any]) -> dict[str, Any]:
    """Return dataset-level provenance without song or record identifiers."""

    return {
        "schemaVersion": DATASET_SCHEMA_VERSION,
        "policyId": ledger["policyId"],
        "purpose": ledger["purpose"],
        "distributionScope": ledger["distributionScope"],
        "rawDataInGit": False,
        "sources": [
            {
                key: source[key]
                for key in (
                    "sourceId",
                    "version",
                    "canonicalUrl",
                    "citation",
                    "retrievedAt",
                    "sourceMaterialSha256",
                    "normalizedRecordsSha256",
                    "review",
                    "attribution",
                    "removalProcedure",
                )
            }
            for source in sorted(
                ledger["sources"],
                key=lambda item: item["sourceId"],
            )
        ],
    }


def _source_records_sha256(records: Sequence[dict[str, Any]]) -> str:
    ordered = sorted(records, key=lambda item: _required_string(item, "recordId"))
    return _sha256_bytes(
        b"".join(_canonical_json_bytes(record) for record in ordered)
    )


def _validate_https_url(value: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username is not None:
        raise DatasetCompileError("source canonicalUrl must be an HTTPS URL")


def _validate_utc_timestamp(value: str) -> None:
    if not value.endswith("Z"):
        raise DatasetCompileError("provenance timestamps must use UTC with Z")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise DatasetCompileError("provenance timestamp is invalid") from exc
    if parsed.tzinfo != timezone.utc:
        raise DatasetCompileError("provenance timestamp must use UTC")


def _verify_manifest_artifact(
    directory: Path,
    descriptor: Any,
) -> None:
    if (
        not isinstance(descriptor, dict)
        or not isinstance(descriptor.get("file"), str)
        or not _is_sha256(descriptor.get("sha256"))
    ):
        raise DatasetCompileError("data manifest artifact descriptor is invalid")
    path = _safe_child(directory, descriptor["file"])
    if _sha256_bytes(_read_bytes(path, "compiled dataset artifact")) != descriptor["sha256"]:
        raise DatasetCompileError(f"compiled artifact checksum mismatch: {path.name}")


def _safe_child(directory: Path, name: str) -> Path:
    if not name or Path(name).name != name:
        raise DatasetCompileError("dataset artifact filename is unsafe")
    path = (directory / name).resolve()
    if path.parent != directory:
        raise DatasetCompileError("dataset artifact path escapes its directory")
    return path


def _parse_jsonl(payload: bytes) -> list[dict[str, Any]]:
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise DatasetCompileError("input JSONL must be UTF-8") from exc
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        if len(line.encode("utf-8")) > 8 * 1024 * 1024:
            raise DatasetCompileError(f"input line {line_number} is too large")
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise DatasetCompileError(
                f"input JSONL has invalid JSON at line {line_number}"
            ) from exc
        if not isinstance(value, dict):
            raise DatasetCompileError(
            f"input JSONL line {line_number} must be an object"
            )
        records.append(value)
    if not records:
        raise DatasetCompileError("input JSONL is empty")
    return records


def _parse_json_object(payload: bytes, label: str) -> dict[str, Any]:
    try:
        value = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DatasetCompileError(f"{label} is not valid UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise DatasetCompileError(f"{label} must be a JSON object")
    return value


def _required_string(mapping: Mapping[str, Any], field: str) -> str:
    value = mapping.get(field)
    if not isinstance(value, str) or not value or len(value) > 512:
        raise DatasetCompileError(f"{field} must be a non-empty string")
    return value


def _required_integer(
    mapping: Mapping[str, Any],
    field: str,
    *,
    minimum: int,
    maximum: int | None = None,
) -> int:
    value = mapping.get(field)
    if not isinstance(value, int) or isinstance(value, bool):
        raise DatasetCompileError(f"{field} must be an integer")
    if value < minimum or (maximum is not None and value > maximum):
        raise DatasetCompileError(f"{field} is outside the supported range")
    return value


def _canonical_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    ).encode()


def _read_bytes(path: Path, label: str) -> bytes:
    try:
        if not path.is_file():
            raise OSError
        return path.read_bytes()
    except OSError as exc:
        raise DatasetCompileError(f"{label} could not be read") from exc


def _write_bytes(path: Path, payload: bytes) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    try:
        temporary.write_bytes(payload)
        temporary.replace(path)
    except OSError as exc:
        raise DatasetCompileError(f"could not write {path.name}") from exc


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _is_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )
