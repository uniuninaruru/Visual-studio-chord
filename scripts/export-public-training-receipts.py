#!/usr/bin/env python3
"""Export non-reconstructive public receipts from one private training artifact.

The source checkpoint, compiled data, and complete local manifests remain
private.  This script verifies their content-addressed binding, then writes
three allowlist-built JSON receipts beneath ``docs/model-reports``.  It never
copies model weights, split assignments, record identifiers, source-item
identifiers, raw content, or local filesystem paths.

Only the Python standard library is used so the same command works on Windows,
macOS, and Linux.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import math
import os
import re
import sys
import tempfile
from collections.abc import Mapping, Sequence
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_REPORTS_ROOT = PROJECT_ROOT / "docs" / "model-reports"
# Public receipts are write-only artifacts; this exporter does not ingest or
# migrate older receipts.  Schema v2 replaces the ambiguous
# ``weightsDistributed`` flag with ``weightsIncludedInThisReceipt`` and states
# the deliberately unsigned scope of every hash binding.
RECEIPT_SCHEMA_VERSION = 2
HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")
FULL_GIT_COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}$")
SAFE_METRIC_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9._-]{0,127}$")
SAFE_PUBLIC_TOKEN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
PYTORCH_VERSION_PATTERN = re.compile(r"^\d+\.\d+(?:\.\d+)?(?:[+-][A-Za-z0-9.]+)?$")
APP_VERSION_PATTERN = re.compile(r"^\d+\.\d+(?:\.\d+)?$")
METRIC_HEADS = (
    "event",
    "root",
    "quality",
    "inversion",
    "bass",
    "extensions",
)

ARCHITECTURE_FIELDS = (
    "family",
    "layers",
    "hiddenSize",
    "attentionHeads",
    "feedForwardSize",
    "dropout",
    "normalization",
    "activation",
    "positionalEncoding",
    "barSummaryTokens",
    "maximumBars",
    "maximumFramesPerWindow",
    "factorizedOutputHeads",
    "extensionConditioning",
)
NORMALIZATION_FIELDS = (
    "ppq",
    "frame",
    "rootEncoding",
    "bassEncoding",
    "unsupportedQualityPolicy",
    "harmonyGapPolicy",
    "normalizedFingerprint",
)
OPTIMIZER_FIELDS = (
    "name",
    "learningRate",
    "weightDecay",
    "gradientClippingNorm",
    "batchSize",
    "maximumSteps",
)
SPLIT_NAMES = ("train", "validation", "test")
COUNT_FIELDS = ("windowCount", "recordCount", "splitGroupCount")
INFERENCE_TASK = "melody_conditioned_variable_rhythm_harmonization"
PRETRAINING_TASK = "harmony_only_pretraining"
KNOWN_TASKS = {INFERENCE_TASK, PRETRAINING_TASK}
TOKENIZER_SHA256 = "bab9f471275a090fa09256e23103f8cdecd8492e8e708a6ef1560538b6aeaaa9"
ARTIFACT_MANIFEST_FIELDS = {
    "schemaVersion",
    "modelId",
    "task",
    "trained",
    "evaluationStatus",
    "architecture",
    "architectureConfigSha256",
    "checkpointFile",
    "checkpointSha256",
    "dataManifestFile",
    "trainingRunFile",
    "tokenizerSha256",
    "dataManifestSha256",
    "trainingRunSha256",
    "sourceCommit",
    "pytorchVersion",
    "minimumAppVersion",
    "minimumApiVersion",
    "supportedPrecisions",
}
TRAINING_RUN_COMMON_FIELDS = {
    "schemaVersion",
    "deterministic",
    "sourceCommit",
    "configSha256",
    "dataManifestSha256",
    "pytorchVersion",
    "cublasWorkspaceConfig",
    "seed",
    "optimizer",
    "epochs",
    "steps",
    "actualDevice",
    "dtype",
    "fallbackReason",
    "meanTrainingLoss",
    "metrics",
}
DATA_MANIFEST_V1_FIELDS = {
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
DATA_MANIFEST_V2_FIELDS = DATA_MANIFEST_V1_FIELDS | {
    "contentProfile",
    "distributionScope",
    "provenance",
}
PREPARE_RUN_FIELDS = {
    "schemaVersion",
    "preparer",
    "source",
    "reviewedSourceInputs",
    "emittedTrainingContent",
    "options",
    "counts",
    "excludedByReason",
    "normalizedRecordsSha256",
}
PREPARE_RUN_PREPARER_FIELDS = {"script", "scriptSha256"}
PREPARE_RUN_SOURCE_FIELDS = {
    "sourceId",
    "sourceCommit",
    "sourceMaterialSha256",
}
PREPARE_RUN_OPTION_FIELDS = {
    "gapPolicy",
    "compilerHarmonyGapPolicy",
    "maximumBarsPerRecord",
    "quantization",
}
PREPARE_RUN_QUANTIZATION_FIELDS = {
    "ppq",
    "frameTicks",
    "beatUnit",
    "rounding",
    "adjacentJitterRepair",
}
PREPARE_RUN_COUNT_FIELDS = {
    "discoveredSourceItemCount",
    "eligibleSourceItemCount",
    "excludedSourceItemCount",
    "emittedRecordCount",
}


class ReceiptExportError(RuntimeError):
    """Private artifact metadata is unsafe, inconsistent, or incomplete."""


def export_public_training_receipts(
    manifest_path: Path,
    training_run_path: Path,
    data_manifest_path: Path,
    output_directory: Path,
    *,
    prepare_run_path: Path | None = None,
    project_root: Path = PROJECT_ROOT,
    public_reports_root: Path = PUBLIC_REPORTS_ROOT,
) -> dict[str, Path]:
    """Validate a private artifact and atomically write three public receipts."""

    manifest_bytes, manifest = _read_json_object(manifest_path, "artifact manifest")
    _validate_artifact_manifest_contract(manifest)
    training_bytes, raw_training_run = _read_json_object(
        training_run_path,
        "training run",
    )
    training_run = _normalize_training_run_contract(raw_training_run)
    data_bytes, data_manifest = _read_json_object(
        data_manifest_path,
        "data manifest",
    )
    data_task = _task_for_data_manifest(data_manifest)
    prepare_bytes: bytes | None = None
    prepare_run: dict[str, Any] | None = None
    ledger = _required_mapping(
        data_manifest.get("ledger"),
        "data manifest ledger",
    )
    if data_task == PRETRAINING_TASK:
        if prepare_run_path is None:
            raise ReceiptExportError(
                "schema v2 harmony-only data requires --prepare-run"
            )
        prepare_bytes, raw_prepare_run = _read_json_object(
            prepare_run_path,
            "preparation run",
        )
        prepare_run = _normalize_prepare_run_contract(raw_prepare_run)
    else:
        if prepare_run_path is not None:
            raise ReceiptExportError(
                "schema v1 melody-conditioned data must not use --prepare-run"
            )
        if "preparation" in ledger:
            raise ReceiptExportError(
                "schema v1 data manifest must not contain a preparation descriptor"
            )
    binding = _validate_artifact_binding(
        manifest_path=manifest_path,
        manifest_bytes=manifest_bytes,
        manifest=manifest,
        training_bytes=training_bytes,
        training_run=training_run,
        data_bytes=data_bytes,
        data_manifest=data_manifest,
        data_task=data_task,
        prepare_bytes=prepare_bytes,
        prepare_run=prepare_run,
    )
    output = _validate_output_directory(
        output_directory,
        project_root=project_root,
        public_reports_root=public_reports_root,
    )

    public_manifest = _public_manifest(manifest, binding)
    public_training_run = _public_training_run(training_run, binding)
    public_data_manifest = _public_data_manifest(
        data_manifest,
        prepare_run,
        binding,
    )

    payloads = {
        "manifest.json": public_manifest,
        "training-run.json": public_training_run,
        "data-manifest.json": public_data_manifest,
    }
    return _install_receipt_bundle_atomically(output, payloads)


def _validate_artifact_binding(
    *,
    manifest_path: Path,
    manifest_bytes: bytes,
    manifest: Mapping[str, Any],
    training_bytes: bytes,
    training_run: Mapping[str, Any],
    data_bytes: bytes,
    data_manifest: Mapping[str, Any],
    data_task: str,
    prepare_bytes: bytes | None,
    prepare_run: Mapping[str, Any] | None,
) -> dict[str, str]:
    manifest_sha256 = _sha256_bytes(manifest_bytes)
    training_sha256 = _sha256_bytes(training_bytes)
    data_sha256 = _sha256_bytes(data_bytes)

    expected_training_sha256 = _required_sha256(
        manifest,
        "trainingRunSha256",
        "artifact manifest",
    )
    expected_data_sha256 = _required_sha256(
        manifest,
        "dataManifestSha256",
        "artifact manifest",
    )
    _require_hash_match(
        expected_training_sha256,
        training_sha256,
        "training run does not match artifact manifest",
    )
    _require_hash_match(
        expected_data_sha256,
        data_sha256,
        "data manifest does not match artifact manifest",
    )
    _require_hash_match(
        _required_sha256(training_run, "dataManifestSha256", "training run"),
        data_sha256,
        "training run and artifact manifest bind different data manifests",
    )
    _require_hash_match(
        _required_sha256(training_run, "configSha256", "training run"),
        _required_sha256(
            manifest,
            "architectureConfigSha256",
            "artifact manifest",
        ),
        "training run and artifact manifest bind different model configs",
    )
    _require_hash_match(
        _required_sha256(data_manifest, "tokenizerSha256", "data manifest"),
        _required_sha256(manifest, "tokenizerSha256", "artifact manifest"),
        "data manifest and artifact manifest bind different tokenizers",
    )
    manifest_task = _required_task(manifest, "artifact manifest")
    training_task = _required_task(training_run, "training run")
    if training_task != manifest_task:
        raise ReceiptExportError(
            "training run and artifact manifest declare different tasks"
        )
    if data_task != manifest_task:
        raise ReceiptExportError(
            "data content profile and artifact manifest declare different tasks"
        )
    prepare_sha256: str | None = None
    if data_task == PRETRAINING_TASK:
        if prepare_bytes is None or prepare_run is None:
            raise ReceiptExportError("harmony-only preparation binding is incomplete")
        prepare_sha256 = _sha256_bytes(prepare_bytes)
        _validate_prepare_run_binding(
            prepare_run=prepare_run,
            prepare_sha256=prepare_sha256,
            data_manifest=data_manifest,
            manifest=manifest,
        )
    elif prepare_bytes is not None or prepare_run is not None:
        raise ReceiptExportError(
            "melody-conditioned data cannot bind a harmony-only preparation run"
        )
    _require_equal_string(
        training_run,
        manifest,
        "sourceCommit",
        "training run and artifact manifest declare different source commits",
    )
    _require_equal_string(
        training_run,
        manifest,
        "pytorchVersion",
        "training run and artifact manifest declare different PyTorch runtimes",
    )

    checkpoint_file = _required_string(
        manifest,
        "checkpointFile",
        "artifact manifest",
    )
    _validate_local_file_name(checkpoint_file, "checkpointFile")
    artifact_directory = manifest_path.resolve().parent
    checkpoint_path = (artifact_directory / checkpoint_file).resolve()
    if checkpoint_path.parent != artifact_directory:
        raise ReceiptExportError("checkpointFile escapes the artifact directory")
    if not checkpoint_path.is_file():
        raise ReceiptExportError("checkpoint file is missing")
    checkpoint_sha256 = _sha256_file(checkpoint_path)
    _require_hash_match(
        _required_sha256(manifest, "checkpointSha256", "artifact manifest"),
        checkpoint_sha256,
        "checkpoint does not match artifact manifest",
    )

    if manifest.get("trained") is not True:
        raise ReceiptExportError("only a trained artifact may produce a public receipt")

    binding = {
        "manifestSha256": manifest_sha256,
        "trainingRunSha256": training_sha256,
        "dataManifestSha256": data_sha256,
        "checkpointSha256": checkpoint_sha256,
    }
    if prepare_sha256 is not None:
        binding["prepareRunSha256"] = prepare_sha256
    return binding


def _validate_artifact_manifest_contract(
    manifest: Mapping[str, Any],
) -> None:
    if set(manifest) != ARTIFACT_MANIFEST_FIELDS:
        raise ReceiptExportError("artifact manifest fields do not match schema v1")
    if manifest.get("schemaVersion") != 1:
        raise ReceiptExportError("artifact manifest schemaVersion must be 1")
    if manifest.get("modelId") != "harmonyforge-bimask-base-v1":
        raise ReceiptExportError("artifact manifest modelId is invalid")
    _required_task(manifest, "artifact manifest")
    if manifest.get("trained") is not True:
        raise ReceiptExportError("only a trained artifact may produce a public receipt")
    if manifest.get("evaluationStatus") not in {
        "researchOnly",
        "validated",
    }:
        raise ReceiptExportError(
            "artifact manifest evaluationStatus is not publishable"
        )
    _validated_public_architecture(manifest.get("architecture"))
    for field in (
        "architectureConfigSha256",
        "checkpointSha256",
        "tokenizerSha256",
        "dataManifestSha256",
        "trainingRunSha256",
    ):
        _required_sha256(manifest, field, "artifact manifest")
    if manifest.get("tokenizerSha256") != TOKENIZER_SHA256:
        raise ReceiptExportError(
            "artifact manifest tokenizerSha256 does not match the runtime"
        )
    expected_files = {
        "checkpointFile": "harmonyforge-bimask-base-v1.safetensors",
        "dataManifestFile": "data-manifest.json",
        "trainingRunFile": "training-run.json",
    }
    for field, expected in expected_files.items():
        if manifest.get(field) != expected:
            raise ReceiptExportError(f"artifact manifest {field} is not allowlisted")
    source_commit = _required_string(
        manifest,
        "sourceCommit",
        "artifact manifest",
    )
    if re.fullmatch(r"[0-9a-f]{7,64}", source_commit) is None:
        raise ReceiptExportError("artifact manifest sourceCommit is invalid")
    pytorch_version = _required_string(
        manifest,
        "pytorchVersion",
        "artifact manifest",
    )
    if PYTORCH_VERSION_PATTERN.fullmatch(pytorch_version) is None:
        raise ReceiptExportError("artifact manifest pytorchVersion is invalid")
    minimum_app_version = _required_string(
        manifest,
        "minimumAppVersion",
        "artifact manifest",
    )
    if APP_VERSION_PATTERN.fullmatch(minimum_app_version) is None:
        raise ReceiptExportError("artifact manifest minimumAppVersion is invalid")
    if manifest.get("minimumApiVersion") != "2":
        raise ReceiptExportError("artifact manifest minimumApiVersion must be 2")
    _public_supported_precisions(manifest.get("supportedPrecisions"))


def _validated_public_architecture(value: Any) -> dict[str, Any]:
    architecture = _required_exact_mapping(
        value,
        set(ARCHITECTURE_FIELDS),
        "artifact manifest architecture",
    )
    expected_literals = {
        "family": "bidirectional_masked_transformer",
        "normalization": "pre_norm",
        "activation": "gelu",
        "positionalEncoding": "learned_window_plus_bar_and_meter",
    }
    for field, expected in expected_literals.items():
        if architecture.get(field) != expected:
            raise ReceiptExportError(
                f"artifact manifest architecture.{field} is invalid"
            )
    for field in (
        "barSummaryTokens",
        "factorizedOutputHeads",
        "extensionConditioning",
    ):
        if architecture.get(field) is not True:
            raise ReceiptExportError(
                f"artifact manifest architecture.{field} must be true"
            )

    ranges = {
        "layers": (1, 48),
        "hiddenSize": (32, 4096),
        "attentionHeads": (1, 4096),
        "maximumBars": (1, 128),
        "maximumFramesPerWindow": (16, 2048),
    }
    integers: dict[str, int] = {}
    for field, (minimum, maximum) in ranges.items():
        parsed = _required_integer(
            architecture,
            field,
            "artifact manifest architecture",
        )
        if not minimum <= parsed <= maximum:
            raise ReceiptExportError(
                f"artifact manifest architecture.{field} is out of range"
            )
        integers[field] = parsed
    feed_forward_size = _required_integer(
        architecture,
        "feedForwardSize",
        "artifact manifest architecture",
    )
    if feed_forward_size < integers["hiddenSize"] or feed_forward_size > 65536:
        raise ReceiptExportError(
            "artifact manifest architecture.feedForwardSize is out of range"
        )
    if integers["hiddenSize"] % integers["attentionHeads"] != 0:
        raise ReceiptExportError(
            "artifact manifest hiddenSize must be divisible by attentionHeads"
        )
    dropout = architecture.get("dropout")
    if (
        not isinstance(dropout, (int, float))
        or isinstance(dropout, bool)
        or not math.isfinite(dropout)
        or not 0 <= dropout < 1
    ):
        raise ReceiptExportError("artifact manifest architecture.dropout is invalid")
    return dict(architecture)


def _normalize_training_run_contract(
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    """Mirror the runtime's v1 migration and strict v2 task contract."""

    schema_version = payload.get("schemaVersion")
    if schema_version == 1:
        if set(payload) != TRAINING_RUN_COMMON_FIELDS:
            raise ReceiptExportError(
                "legacy training run fields do not match schema v1"
            )
        normalized = {
            **payload,
            "task": INFERENCE_TASK,
            "initialCheckpoint": None,
        }
    elif schema_version == 2:
        if set(payload) != TRAINING_RUN_COMMON_FIELDS | {
            "task",
            "initialCheckpoint",
        }:
            raise ReceiptExportError("training run fields do not match schema v2")
        normalized = dict(payload)
        task = _required_task(normalized, "training run")
        initial_checkpoint = _public_initial_checkpoint(normalized["initialCheckpoint"])
        if initial_checkpoint is not None and not _task_transition_is_allowed(
            initial_checkpoint["task"],
            task,
        ):
            raise ReceiptExportError(
                "training run initial checkpoint task transition is invalid"
            )
        normalized["initialCheckpoint"] = initial_checkpoint
    else:
        raise ReceiptExportError("unsupported training run schema version")

    if normalized["deterministic"] is not True:
        raise ReceiptExportError("training run must be deterministic")
    for field in (
        "sourceCommit",
        "configSha256",
        "dataManifestSha256",
        "pytorchVersion",
        "cublasWorkspaceConfig",
        "seed",
        "actualDevice",
        "dtype",
    ):
        _required_string(normalized, field, "training run")
    if re.fullmatch(r"[0-9a-f]{7,64}", normalized["sourceCommit"]) is None:
        raise ReceiptExportError("training run sourceCommit is invalid")
    _required_sha256(normalized, "configSha256", "training run")
    _required_sha256(normalized, "dataManifestSha256", "training run")
    if PYTORCH_VERSION_PATTERN.fullmatch(normalized["pytorchVersion"]) is None:
        raise ReceiptExportError("training run pytorchVersion is invalid")
    if normalized["cublasWorkspaceConfig"] not in {":4096:8", ":16:8"}:
        raise ReceiptExportError("training run cublasWorkspaceConfig is invalid")
    _required_safe_token(normalized, "seed", "training run")
    if normalized["actualDevice"] not in {"cpu", "cuda", "mps"}:
        raise ReceiptExportError("training run actualDevice is invalid")
    if normalized["dtype"] != "float32":
        raise ReceiptExportError("training run dtype must be float32")
    _validate_optimizer_contract(normalized["optimizer"])
    _required_mapping(normalized["metrics"], "training run metrics")
    for field in ("epochs", "steps"):
        value = normalized[field]
        if not isinstance(value, int) or isinstance(value, bool) or value < 1:
            raise ReceiptExportError(f"training run {field} is invalid")
    mean_loss = normalized["meanTrainingLoss"]
    if (
        not isinstance(mean_loss, (int, float))
        or isinstance(mean_loss, bool)
        or not math.isfinite(mean_loss)
    ):
        raise ReceiptExportError("training run meanTrainingLoss is invalid")
    fallback_reason = normalized["fallbackReason"]
    if fallback_reason not in {
        None,
        "acceleratorProbeFailedCpuFallback",
    }:
        raise ReceiptExportError("training run fallbackReason is invalid")
    return normalized


def _validate_optimizer_contract(value: Any) -> dict[str, Any]:
    optimizer = _required_exact_mapping(
        value,
        set(OPTIMIZER_FIELDS),
        "training run optimizer",
    )
    if optimizer.get("name") != "AdamW":
        raise ReceiptExportError("training run optimizer name is invalid")
    for field, minimum, maximum, include_minimum in (
        ("learningRate", 0.0, 1.0, False),
        ("weightDecay", 0.0, 1.0, True),
        ("gradientClippingNorm", 0.0, math.inf, False),
    ):
        number = optimizer.get(field)
        if (
            not isinstance(number, (int, float))
            or isinstance(number, bool)
            or not math.isfinite(number)
            or number > maximum
            or (number < minimum if include_minimum else number <= minimum)
        ):
            raise ReceiptExportError(f"training run optimizer.{field} is invalid")
    batch_size = _required_integer(
        optimizer,
        "batchSize",
        "training run optimizer",
    )
    if not 1 <= batch_size <= 1024:
        raise ReceiptExportError("training run optimizer.batchSize is out of range")
    maximum_steps = optimizer.get("maximumSteps")
    if maximum_steps is not None and (
        not isinstance(maximum_steps, int)
        or isinstance(maximum_steps, bool)
        or maximum_steps < 1
    ):
        raise ReceiptExportError("training run optimizer.maximumSteps is invalid")
    return dict(optimizer)


def _normalize_prepare_run_contract(
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    """Accept only the path-free preparation receipt schema reviewed for v1."""

    if set(payload) != PREPARE_RUN_FIELDS or payload.get("schemaVersion") != 1:
        raise ReceiptExportError("preparation run fields do not match schema v1")
    preparer = _required_exact_mapping(
        payload.get("preparer"),
        PREPARE_RUN_PREPARER_FIELDS,
        "preparation run preparer",
    )
    if preparer.get("script") != "scripts/prepare-pop909-harmony-only.py":
        raise ReceiptExportError("preparation run preparer script is invalid")
    _required_sha256(preparer, "scriptSha256", "preparation run preparer")

    source = _required_exact_mapping(
        payload.get("source"),
        PREPARE_RUN_SOURCE_FIELDS,
        "preparation run source",
    )
    if source.get("sourceId") != "pop909":
        raise ReceiptExportError("preparation run sourceId is invalid")
    source_commit = _required_string(
        source,
        "sourceCommit",
        "preparation run source",
    )
    if FULL_GIT_COMMIT_PATTERN.fullmatch(source_commit) is None:
        raise ReceiptExportError(
            "preparation run sourceCommit must be a full lowercase Git commit"
        )
    _required_sha256(
        source,
        "sourceMaterialSha256",
        "preparation run source",
    )

    if payload.get("reviewedSourceInputs") != [
        "harmony",
        "key",
        "meter",
        "beatTiming",
    ]:
        raise ReceiptExportError("preparation run reviewedSourceInputs are invalid")
    if payload.get("emittedTrainingContent") != [
        "harmony",
        "key",
        "meter",
    ]:
        raise ReceiptExportError("preparation run emittedTrainingContent is invalid")

    options = _required_exact_mapping(
        payload.get("options"),
        PREPARE_RUN_OPTION_FIELDS,
        "preparation run options",
    )
    gap_policy = options.get("gapPolicy")
    compiler_gap_policy = options.get("compilerHarmonyGapPolicy")
    expected_compiler_policy = {
        "reject": "excludeRecord",
        "allow-no-chord": "allowNoChord",
    }.get(gap_policy)
    if expected_compiler_policy is None:
        raise ReceiptExportError("preparation run gapPolicy is invalid")
    if compiler_gap_policy != expected_compiler_policy:
        raise ReceiptExportError("preparation run gap policies are inconsistent")
    maximum_bars = _required_non_negative_integer(
        options,
        "maximumBarsPerRecord",
        "preparation run options",
    )
    if maximum_bars < 1:
        raise ReceiptExportError(
            "preparation run maximumBarsPerRecord must be positive"
        )
    quantization = _required_exact_mapping(
        options.get("quantization"),
        PREPARE_RUN_QUANTIZATION_FIELDS,
        "preparation run quantization",
    )
    if dict(quantization) != {
        "ppq": 480,
        "frameTicks": 120,
        "beatUnit": "quarter",
        "rounding": "nearestTiesAwayFromZero",
        "adjacentJitterRepair": "snapWhenAbsoluteDeltaIsBelowOneFrame",
    }:
        raise ReceiptExportError("preparation run quantization profile is invalid")

    counts = _required_exact_mapping(
        payload.get("counts"),
        PREPARE_RUN_COUNT_FIELDS,
        "preparation run counts",
    )
    public_counts = {
        field: _required_non_negative_integer(
            counts,
            field,
            "preparation run counts",
        )
        for field in PREPARE_RUN_COUNT_FIELDS
    }
    if (
        public_counts["eligibleSourceItemCount"]
        + public_counts["excludedSourceItemCount"]
        != public_counts["discoveredSourceItemCount"]
    ):
        raise ReceiptExportError("preparation run source-item counts are inconsistent")

    exclusions = _required_mapping(
        payload.get("excludedByReason"),
        "preparation run excludedByReason",
    )
    exclusion_total = 0
    for reason, value in exclusions.items():
        if not isinstance(reason, str) or SAFE_METRIC_KEY.fullmatch(reason) is None:
            raise ReceiptExportError(
                "preparation run contains an unsafe exclusion reason"
            )
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ReceiptExportError(
                "preparation run exclusion counts must be non-negative integers"
            )
        exclusion_total += value
    if exclusion_total != public_counts["excludedSourceItemCount"]:
        raise ReceiptExportError("preparation run exclusion counts are inconsistent")
    _required_sha256(
        payload,
        "normalizedRecordsSha256",
        "preparation run",
    )
    return dict(payload)


def _validate_prepare_run_binding(
    *,
    prepare_run: Mapping[str, Any],
    prepare_sha256: str,
    data_manifest: Mapping[str, Any],
    manifest: Mapping[str, Any],
) -> None:
    ledger = _required_mapping(
        data_manifest.get("ledger"),
        "data manifest ledger",
    )
    descriptor = _required_exact_mapping(
        ledger.get("preparation"),
        {"schemaVersion", "sha256"},
        "data manifest ledger preparation",
    )
    if descriptor.get("schemaVersion") != prepare_run.get("schemaVersion"):
        raise ReceiptExportError(
            "data manifest and preparation run declare different schemas"
        )
    _require_hash_match(
        _required_sha256(
            descriptor,
            "sha256",
            "data manifest ledger preparation",
        ),
        prepare_sha256,
        "preparation run does not match the data manifest descriptor",
    )

    input_descriptor = _required_mapping(
        data_manifest.get("input"),
        "data manifest input",
    )
    _require_hash_match(
        _required_sha256(
            prepare_run,
            "normalizedRecordsSha256",
            "preparation run",
        ),
        _required_sha256(
            input_descriptor,
            "sha256",
            "data manifest input",
        ),
        "preparation run and data manifest bind different normalized records",
    )
    source = _required_mapping(
        prepare_run.get("source"),
        "preparation run source",
    )
    if source.get("sourceCommit") != data_manifest.get("datasetVersion"):
        raise ReceiptExportError(
            "preparation run and data manifest declare different source commits"
        )
    source_ids = ledger.get("sourceIds")
    if not isinstance(source_ids, list) or source.get("sourceId") not in source_ids:
        raise ReceiptExportError(
            "preparation run source is absent from the data manifest ledger"
        )
    if ledger.get("reviewedSourceInputs") != prepare_run.get("reviewedSourceInputs"):
        raise ReceiptExportError(
            "preparation run and data manifest declare different reviewed inputs"
        )
    if ledger.get("emittedTrainingContent") != prepare_run.get(
        "emittedTrainingContent"
    ):
        raise ReceiptExportError(
            "preparation run and data manifest declare different emitted content"
        )

    options = _required_mapping(
        prepare_run.get("options"),
        "preparation run options",
    )
    normalization = _required_mapping(
        data_manifest.get("normalization"),
        "data manifest normalization",
    )
    if options.get("compilerHarmonyGapPolicy") != normalization.get("harmonyGapPolicy"):
        raise ReceiptExportError(
            "preparation run and data manifest use different harmony gap policies"
        )
    counts = _required_mapping(
        prepare_run.get("counts"),
        "preparation run counts",
    )
    if counts.get("emittedRecordCount") != input_descriptor.get("recordCount"):
        raise ReceiptExportError(
            "preparation run and data manifest declare different record counts"
        )
    architecture = _required_mapping(
        manifest.get("architecture"),
        "artifact manifest architecture",
    )
    if options.get("maximumBarsPerRecord") != architecture.get("maximumBars"):
        raise ReceiptExportError(
            "preparation run and artifact use different maximum bar limits"
        )


def _task_for_data_manifest(data_manifest: Mapping[str, Any]) -> str:
    schema_version = data_manifest.get("schemaVersion")
    if schema_version == 1:
        if set(data_manifest) != DATA_MANIFEST_V1_FIELDS:
            raise ReceiptExportError("data manifest fields do not match schema v1")
        if data_manifest.get("compilerVersion") not in {"1.0.0", "1.1.0"}:
            raise ReceiptExportError(
                "schema v1 data manifest requires compiler 1.0.0 or 1.1.0"
            )
        if data_manifest.get("purpose") != "researchTraining":
            raise ReceiptExportError("schema v1 data manifest purpose is invalid")
        _required_exact_mapping(
            data_manifest.get("ledger"),
            {"sha256", "sourceIds", "sourceChecksumScope"},
            "schema v1 data manifest ledger",
        )
        task = INFERENCE_TASK
    elif schema_version == 2:
        if set(data_manifest) != DATA_MANIFEST_V2_FIELDS:
            raise ReceiptExportError("data manifest fields do not match schema v2")
        if data_manifest.get("compilerVersion") != "1.2.0":
            raise ReceiptExportError(
                "harmony-only provenance requires compiler 1.2.0; "
                "recompile the private dataset"
            )
        if data_manifest.get("contentProfile") != "harmonyOnlyV1":
            raise ReceiptExportError(
                "schema v2 data manifest requires harmonyOnlyV1 content"
            )
        if data_manifest.get("distributionScope") != "privateLocalOnly":
            raise ReceiptExportError(
                "schema v2 data manifest must stay private and local"
            )
        if data_manifest.get("purpose") != "privateLocalHarmonyOnlyTraining":
            raise ReceiptExportError("schema v2 data manifest purpose is invalid")
        ledger = _required_exact_mapping(
            data_manifest.get("ledger"),
            {
                "sha256",
                "sourceIds",
                "sourceChecksumScope",
                "reviewedSourceInputs",
                "emittedTrainingContent",
                "preparation",
            },
            "schema v2 data manifest ledger",
        )
        if ledger.get("reviewedSourceInputs") != [
            "harmony",
            "key",
            "meter",
            "beatTiming",
        ]:
            raise ReceiptExportError("schema v2 reviewed source-input scope is invalid")
        if ledger.get("emittedTrainingContent") != [
            "harmony",
            "key",
            "meter",
        ]:
            raise ReceiptExportError(
                "schema v2 emitted training-content scope is invalid"
            )
        normalization = _required_mapping(
            data_manifest.get("normalization"),
            "data manifest normalization",
        )
        if (
            normalization.get("normalizedFingerprint")
            != "sha256-relative-harmony-key-meter-v1"
        ):
            raise ReceiptExportError(
                "schema v2 data manifest normalization profile is invalid"
            )
        task = PRETRAINING_TASK
    else:
        raise ReceiptExportError("unsupported data manifest schema version")
    if data_manifest.get("deterministic") is not True:
        raise ReceiptExportError("data manifest must declare deterministic compilation")
    if data_manifest.get("splitBeforeWindowing") is not True:
        raise ReceiptExportError("data manifest must split records before windowing")
    _validate_public_data_manifest_values(data_manifest, schema_version)
    return task


def _validate_public_data_manifest_values(
    data_manifest: Mapping[str, Any],
    schema_version: int,
) -> None:
    _required_safe_token(data_manifest, "datasetId", "data manifest")
    dataset_version = _required_safe_token(
        data_manifest,
        "datasetVersion",
        "data manifest",
    )
    if (
        schema_version == 2
        and FULL_GIT_COMMIT_PATTERN.fullmatch(dataset_version) is None
    ):
        raise ReceiptExportError(
            "schema v2 datasetVersion must be a full lowercase Git commit"
        )
    _required_safe_token(data_manifest, "splitSeed", "data manifest")

    split_basis = _public_named_counts(
        data_manifest.get("splitBasisPoints"),
        SPLIT_NAMES,
        "data manifest splitBasisPoints",
    )
    if sum(split_basis.values()) != 10_000:
        raise ReceiptExportError("data manifest splitBasisPoints must sum to 10000")
    input_descriptor = _required_exact_mapping(
        data_manifest.get("input"),
        {"sha256", "recordCount"},
        "data manifest input",
    )
    _required_sha256(input_descriptor, "sha256", "data manifest input")
    _required_non_negative_integer(
        input_descriptor,
        "recordCount",
        "data manifest input",
    )

    ledger = _required_mapping(
        data_manifest.get("ledger"),
        "data manifest ledger",
    )
    _required_sha256(ledger, "sha256", "data manifest ledger")
    expected_checksum_scope = {
        1: "completeCompilerInputJsonlBytes",
        2: "perSourceCanonicalNormalizedRecords",
    }[schema_version]
    if ledger.get("sourceChecksumScope") != expected_checksum_scope:
        raise ReceiptExportError("data manifest sourceChecksumScope is invalid")
    source_ids = ledger.get("sourceIds")
    if (
        not isinstance(source_ids, list)
        or not source_ids
        or len(set(source_ids)) != len(source_ids)
    ):
        raise ReceiptExportError("data manifest sourceIds are invalid")
    for source_id in source_ids:
        if (
            not isinstance(source_id, str)
            or SAFE_PUBLIC_TOKEN.fullmatch(source_id) is None
        ):
            raise ReceiptExportError(
                "data manifest sourceIds contain an unsafe identifier"
            )

    _validate_file_descriptor(
        data_manifest.get("vocabulary"),
        "data manifest vocabulary",
        "vocabulary.json",
    )
    _validate_file_descriptor(
        data_manifest.get("statistics"),
        "data manifest statistics",
        "statistics.json",
    )
    if schema_version == 2:
        _validate_file_descriptor(
            data_manifest.get("provenance"),
            "data manifest provenance",
            "provenance.json",
        )

    normalization = _required_exact_mapping(
        data_manifest.get("normalization"),
        set(NORMALIZATION_FIELDS),
        "data manifest normalization",
    )
    expected_normalization = {
        "ppq": 480,
        "frame": "sixteenth",
        "rootEncoding": "keyRelativePitchClass",
        "bassEncoding": "rootRelativePitchClass",
    }
    for field, expected in expected_normalization.items():
        if normalization.get(field) != expected:
            raise ReceiptExportError(f"data manifest normalization.{field} is invalid")
    if normalization.get("unsupportedQualityPolicy") not in {
        "excludeRecord",
        "mapOther",
    }:
        raise ReceiptExportError("data manifest unsupportedQualityPolicy is invalid")
    if normalization.get("harmonyGapPolicy") not in {
        "excludeRecord",
        "allowNoChord",
    }:
        raise ReceiptExportError("data manifest harmonyGapPolicy is invalid")
    expected_fingerprint = (
        "sha256-relative-harmony-key-meter-v1"
        if schema_version == 2
        else "sha256-relative-melody-harmony-v1"
    )
    if normalization.get("normalizedFingerprint") != expected_fingerprint:
        raise ReceiptExportError("data manifest normalizedFingerprint is invalid")

    splits = _required_mapping(
        data_manifest.get("splits"),
        "data manifest splits",
    )
    expected_files = {
        "train": "train.index.jsonl",
        "validation": "validation.index.jsonl",
        "test": "test.index.jsonl",
    }
    if set(splits) != set(expected_files):
        raise ReceiptExportError("data manifest split names are invalid")
    descriptor_fields = {"file", "sha256", *COUNT_FIELDS}
    for split_name, expected_file in expected_files.items():
        descriptor = _required_exact_mapping(
            splits[split_name],
            descriptor_fields,
            f"data manifest split {split_name}",
        )
        if descriptor.get("file") != expected_file:
            raise ReceiptExportError(
                f"data manifest split {split_name} file is not allowlisted"
            )
        _required_sha256(
            descriptor,
            "sha256",
            f"data manifest split {split_name}",
        )
        for field in COUNT_FIELDS:
            _required_non_negative_integer(
                descriptor,
                field,
                f"data manifest split {split_name}",
            )
    if not isinstance(data_manifest.get("assignments"), list):
        raise ReceiptExportError("data manifest assignments must be a list")


def _validate_file_descriptor(
    value: Any,
    label: str,
    expected_file: str,
) -> None:
    descriptor = _required_exact_mapping(
        value,
        {"file", "sha256"},
        label,
    )
    if descriptor.get("file") != expected_file:
        raise ReceiptExportError(f"{label} file is not allowlisted")
    _required_sha256(descriptor, "sha256", label)


def _required_task(payload: Mapping[str, Any], label: str) -> str:
    task = _required_string(payload, "task", label)
    if task not in KNOWN_TASKS:
        raise ReceiptExportError(f"{label} task is invalid")
    return task


def _task_transition_is_allowed(
    source_task: str,
    destination_task: str,
) -> bool:
    return source_task == destination_task or (
        source_task == PRETRAINING_TASK and destination_task == INFERENCE_TASK
    )


def _public_manifest(
    manifest: Mapping[str, Any],
    binding: Mapping[str, str],
) -> dict[str, Any]:
    architecture = _validated_public_architecture(manifest.get("architecture"))
    supported_precisions = _public_supported_precisions(
        manifest.get("supportedPrecisions")
    )
    return {
        "schemaVersion": RECEIPT_SCHEMA_VERSION,
        "receiptType": "publicTrainingManifest",
        "sourceSchemaVersion": _required_integer(
            manifest,
            "schemaVersion",
            "artifact manifest",
        ),
        "modelId": _required_string(manifest, "modelId", "artifact manifest"),
        "task": _required_string(manifest, "task", "artifact manifest"),
        "trained": True,
        "evaluationStatus": _required_string(
            manifest,
            "evaluationStatus",
            "artifact manifest",
        ),
        "architecture": architecture,
        "architectureConfigSha256": _required_sha256(
            manifest,
            "architectureConfigSha256",
            "artifact manifest",
        ),
        "tokenizerSha256": _required_sha256(
            manifest,
            "tokenizerSha256",
            "artifact manifest",
        ),
        "sourceCommit": _required_string(
            manifest,
            "sourceCommit",
            "artifact manifest",
        ),
        "pytorchVersion": _required_string(
            manifest,
            "pytorchVersion",
            "artifact manifest",
        ),
        "minimumAppVersion": _required_string(
            manifest,
            "minimumAppVersion",
            "artifact manifest",
        ),
        "minimumApiVersion": _required_string(
            manifest,
            "minimumApiVersion",
            "artifact manifest",
        ),
        "supportedPrecisions": supported_precisions,
        "artifactBinding": dict(binding),
        **_public_receipt_integrity_fields(),
    }


def _public_training_run(
    training_run: Mapping[str, Any],
    binding: Mapping[str, str],
) -> dict[str, Any]:
    deterministic = training_run.get("deterministic")
    if not isinstance(deterministic, bool):
        raise ReceiptExportError("training run deterministic must be boolean")
    actual_device = _required_string(
        training_run,
        "actualDevice",
        "training run",
    )
    # One run configured for deterministic execution is not evidence that an
    # independent rerun produced the same bytes.  Schema v2 has no
    # caller-controlled escape hatch: a future bitwise claim must carry two-run
    # hash evidence plus an exact runtime fingerprint.
    reproducibility_level = "deterministicConfigured"
    runtime = {
        "framework": "pytorch",
        "version": _required_string(
            training_run,
            "pytorchVersion",
            "training run",
        ),
        "device": actual_device,
        "dtype": _required_string(training_run, "dtype", "training run"),
    }
    workspace_config = training_run.get("cublasWorkspaceConfig")
    if workspace_config is not None:
        if not isinstance(workspace_config, str) or len(workspace_config) > 128:
            raise ReceiptExportError("training run cublasWorkspaceConfig is invalid")
        runtime["cublasWorkspaceConfig"] = workspace_config

    optimizer = _validate_optimizer_contract(training_run.get("optimizer"))
    optimizer = {
        key: _public_scalar(value, f"training run optimizer.{key}")
        for key, value in optimizer.items()
    }
    metrics = _public_metrics(training_run.get("metrics"), "training run metrics")
    return {
        "schemaVersion": RECEIPT_SCHEMA_VERSION,
        "receiptType": "publicTrainingRun",
        "sourceSchemaVersion": _required_integer(
            training_run,
            "schemaVersion",
            "training run",
        ),
        "task": _required_string(training_run, "task", "training run"),
        "initialCheckpoint": _public_initial_checkpoint(
            training_run.get("initialCheckpoint")
        ),
        "initialCheckpointBindingVerified": False,
        "deterministic": deterministic,
        "reproducibilityLevel": reproducibility_level,
        "crossDeviceBitIdentityClaimed": False,
        "runtime": runtime,
        "sourceCommit": _required_string(
            training_run,
            "sourceCommit",
            "training run",
        ),
        "configSha256": _required_sha256(
            training_run,
            "configSha256",
            "training run",
        ),
        "seed": _required_safe_token(
            training_run,
            "seed",
            "training run",
        ),
        "optimizer": optimizer,
        "epochs": _required_non_negative_integer(
            training_run,
            "epochs",
            "training run",
        ),
        "steps": _required_non_negative_integer(
            training_run,
            "steps",
            "training run",
        ),
        "meanTrainingLoss": _public_optional_number(
            training_run.get("meanTrainingLoss"),
            "training run meanTrainingLoss",
        ),
        "metrics": metrics,
        "artifactBinding": dict(binding),
        **_public_receipt_integrity_fields(),
    }


def _public_initial_checkpoint(value: Any) -> dict[str, str] | None:
    if value is None:
        return None
    checkpoint = _required_mapping(value, "training run initialCheckpoint")
    required = {
        "modelId",
        "task",
        "manifestSha256",
        "checkpointSha256",
    }
    if set(checkpoint) != required:
        raise ReceiptExportError("training run initialCheckpoint fields are invalid")
    model_id = _required_string(
        checkpoint,
        "modelId",
        "training run initialCheckpoint",
    )
    if model_id != "harmonyforge-bimask-base-v1":
        raise ReceiptExportError("training run initialCheckpoint modelId is invalid")
    task = _required_string(
        checkpoint,
        "task",
        "training run initialCheckpoint",
    )
    if task not in {
        "melody_conditioned_variable_rhythm_harmonization",
        "harmony_only_pretraining",
    }:
        raise ReceiptExportError("training run initialCheckpoint task is invalid")
    return {
        "modelId": model_id,
        "task": task,
        "manifestSha256": _required_sha256(
            checkpoint,
            "manifestSha256",
            "training run initialCheckpoint",
        ),
        "checkpointSha256": _required_sha256(
            checkpoint,
            "checkpointSha256",
            "training run initialCheckpoint",
        ),
    }


def _public_data_manifest(
    data_manifest: Mapping[str, Any],
    prepare_run: Mapping[str, Any] | None,
    binding: Mapping[str, str],
) -> dict[str, Any]:
    split_basis_points = _public_named_counts(
        data_manifest.get("splitBasisPoints"),
        SPLIT_NAMES,
        "data manifest splitBasisPoints",
    )
    input_descriptor = _required_mapping(
        data_manifest.get("input"),
        "data manifest input",
    )
    ledger = _required_mapping(
        data_manifest.get("ledger"),
        "data manifest ledger",
    )
    source_ids = ledger.get("sourceIds")
    if not isinstance(source_ids, list) or not all(
        isinstance(value, str) and value for value in source_ids
    ):
        raise ReceiptExportError("data manifest ledger.sourceIds is invalid")
    normalization = _copy_allowlisted_mapping(
        data_manifest.get("normalization"),
        NORMALIZATION_FIELDS,
        "data manifest normalization",
        require_all=True,
    )
    normalization = {
        key: _public_scalar(value, f"data manifest normalization.{key}")
        for key, value in normalization.items()
    }
    splits = _public_splits(data_manifest.get("splits"))
    public_ledger: dict[str, Any] = {
        "sha256": _required_sha256(
            ledger,
            "sha256",
            "data manifest ledger",
        ),
        "sourceCount": len(source_ids),
        "sourceChecksumScope": _required_string(
            ledger,
            "sourceChecksumScope",
            "data manifest ledger",
        ),
    }
    if prepare_run is not None:
        preparation_descriptor = _required_exact_mapping(
            ledger.get("preparation"),
            {"schemaVersion", "sha256"},
            "data manifest ledger preparation",
        )
        public_ledger["preparation"] = {
            "schemaVersion": _required_integer(
                preparation_descriptor,
                "schemaVersion",
                "data manifest ledger preparation",
            ),
            "sha256": _required_sha256(
                preparation_descriptor,
                "sha256",
                "data manifest ledger preparation",
            ),
        }
        public_ledger["reviewedSourceInputs"] = list(
            prepare_run["reviewedSourceInputs"]
        )
        public_ledger["emittedTrainingContent"] = list(
            prepare_run["emittedTrainingContent"]
        )

    payload: dict[str, Any] = {
        "schemaVersion": RECEIPT_SCHEMA_VERSION,
        "receiptType": "publicDataManifest",
        "sourceSchemaVersion": _required_integer(
            data_manifest,
            "schemaVersion",
            "data manifest",
        ),
        "compilerVersion": _required_string(
            data_manifest,
            "compilerVersion",
            "data manifest",
        ),
        "datasetId": _required_safe_token(
            data_manifest,
            "datasetId",
            "data manifest",
        ),
        "datasetVersion": _required_safe_token(
            data_manifest,
            "datasetVersion",
            "data manifest",
        ),
        "purpose": _required_string(
            data_manifest,
            "purpose",
            "data manifest",
        ),
        "deterministic": _required_boolean(
            data_manifest,
            "deterministic",
            "data manifest",
        ),
        "splitBeforeWindowing": _required_boolean(
            data_manifest,
            "splitBeforeWindowing",
            "data manifest",
        ),
        "splitSeed": _required_safe_token(
            data_manifest,
            "splitSeed",
            "data manifest",
        ),
        "splitBasisPoints": split_basis_points,
        "input": {
            "sha256": _required_sha256(
                input_descriptor,
                "sha256",
                "data manifest input",
            ),
            "recordCount": _required_non_negative_integer(
                input_descriptor,
                "recordCount",
                "data manifest input",
            ),
        },
        "ledger": public_ledger,
        "tokenizerSha256": _required_sha256(
            data_manifest,
            "tokenizerSha256",
            "data manifest",
        ),
        "vocabularySha256": _descriptor_sha256(
            data_manifest.get("vocabulary"),
            "data manifest vocabulary",
        ),
        "statisticsSha256": _descriptor_sha256(
            data_manifest.get("statistics"),
            "data manifest statistics",
        ),
        "normalization": normalization,
        "splits": splits,
        "prepareRun": (
            _public_prepare_run(prepare_run, binding)
            if prepare_run is not None
            else None
        ),
        "preparationBinding": {
            "prepareRunIncluded": prepare_run is not None,
            "dataManifestDescriptorPresent": "preparation" in ledger,
            "dataManifestDescriptorVerified": prepare_run is not None,
        },
        "artifactBinding": dict(binding),
        **_public_receipt_integrity_fields(),
    }
    if "contentProfile" in data_manifest:
        payload["contentProfile"] = _required_string(
            data_manifest,
            "contentProfile",
            "data manifest",
        )
    if "distributionScope" in data_manifest:
        payload["sourceDistributionScope"] = _required_string(
            data_manifest,
            "distributionScope",
            "data manifest",
        )
    if "provenance" in data_manifest:
        payload["provenanceSha256"] = _descriptor_sha256(
            data_manifest.get("provenance"),
            "data manifest provenance",
        )
    return payload


def _public_prepare_run(
    prepare_run: Mapping[str, Any],
    binding: Mapping[str, str],
) -> dict[str, Any]:
    """Copy only safe aggregate preparation provenance."""

    preparer = _required_mapping(
        prepare_run.get("preparer"),
        "preparation run preparer",
    )
    source = _required_mapping(
        prepare_run.get("source"),
        "preparation run source",
    )
    options = _required_mapping(
        prepare_run.get("options"),
        "preparation run options",
    )
    counts = _required_mapping(
        prepare_run.get("counts"),
        "preparation run counts",
    )
    quantization = _required_mapping(
        options.get("quantization"),
        "preparation run quantization",
    )
    return {
        "sourceSchemaVersion": _required_integer(
            prepare_run,
            "schemaVersion",
            "preparation run",
        ),
        "preparer": {
            "script": _required_string(
                preparer,
                "script",
                "preparation run preparer",
            ),
            "scriptSha256": _required_sha256(
                preparer,
                "scriptSha256",
                "preparation run preparer",
            ),
        },
        "source": {
            "sourceId": _required_string(
                source,
                "sourceId",
                "preparation run source",
            ),
            "sourceCommit": _required_string(
                source,
                "sourceCommit",
                "preparation run source",
            ),
            "sourceMaterialSha256": _required_sha256(
                source,
                "sourceMaterialSha256",
                "preparation run source",
            ),
        },
        "reviewedSourceInputs": list(prepare_run["reviewedSourceInputs"]),
        "emittedTrainingContent": list(prepare_run["emittedTrainingContent"]),
        "options": {
            "gapPolicy": _required_string(
                options,
                "gapPolicy",
                "preparation run options",
            ),
            "compilerHarmonyGapPolicy": _required_string(
                options,
                "compilerHarmonyGapPolicy",
                "preparation run options",
            ),
            "maximumBarsPerRecord": _required_non_negative_integer(
                options,
                "maximumBarsPerRecord",
                "preparation run options",
            ),
            "quantization": {
                field: _public_scalar(
                    quantization[field],
                    f"preparation run quantization.{field}",
                )
                for field in PREPARE_RUN_QUANTIZATION_FIELDS
            },
        },
        "counts": {
            field: _required_non_negative_integer(
                counts,
                field,
                "preparation run counts",
            )
            for field in PREPARE_RUN_COUNT_FIELDS
        },
        "normalizedRecordsSha256": _required_sha256(
            prepare_run,
            "normalizedRecordsSha256",
            "preparation run",
        ),
        "binding": {
            "prepareRunSha256": binding["prepareRunSha256"],
            "dataManifestDescriptorVerified": True,
            "normalizedRecordsHashDeclarationMatched": True,
            "sourceCommitDeclarationMatched": True,
            "sourceLedgerBytesVerified": False,
            "preparerScriptBytesVerified": False,
            "sourceMaterialBytesVerified": False,
        },
    }


def _public_supported_precisions(value: Any) -> dict[str, list[str]]:
    mapping = _required_mapping(value, "artifact manifest supportedPrecisions")
    if set(mapping) != {"cuda", "mps", "cpu"}:
        raise ReceiptExportError(
            "artifact manifest supportedPrecisions fields are invalid"
        )
    result: dict[str, list[str]] = {}
    allowed = {
        "cuda": {"bfloat16", "float16", "float32"},
        "mps": {"float16", "float32"},
        "cpu": {"bfloat16", "float32"},
    }
    for runtime in ("cuda", "mps", "cpu"):
        precisions = mapping[runtime]
        if (
            not isinstance(precisions, list)
            or not precisions
            or len(set(precisions)) != len(precisions)
        ):
            raise ReceiptExportError(
                f"artifact manifest supportedPrecisions.{runtime} is invalid"
            )
        if not all(
            isinstance(precision, str) and precision in allowed[runtime]
            for precision in precisions
        ):
            raise ReceiptExportError(
                f"artifact manifest supportedPrecisions.{runtime} is invalid"
            )
        result[runtime] = list(precisions)
    return result


def _public_receipt_integrity_fields() -> dict[str, str | bool]:
    """Describe exactly what the unsigned public receipt can establish."""

    return {
        "integrityScope": "unsignedInternalConsistency",
        "authenticityClaimed": False,
        "weightsIncludedInThisReceipt": False,
        "checkpointIncluded": False,
    }


def _public_splits(value: Any) -> dict[str, dict[str, int | str]]:
    splits = _required_mapping(value, "data manifest splits")
    if set(splits) != set(SPLIT_NAMES):
        raise ReceiptExportError("data manifest split names are invalid")
    result: dict[str, dict[str, int | str]] = {}
    for split_name in SPLIT_NAMES:
        descriptor = _required_mapping(
            splits[split_name],
            f"data manifest split {split_name}",
        )
        public_descriptor: dict[str, int | str] = {
            "sha256": _required_sha256(
                descriptor,
                "sha256",
                f"data manifest split {split_name}",
            )
        }
        for field in COUNT_FIELDS:
            public_descriptor[field] = _required_non_negative_integer(
                descriptor,
                field,
                f"data manifest split {split_name}",
            )
        result[split_name] = public_descriptor
    return result


def _public_named_counts(
    value: Any,
    names: Sequence[str],
    label: str,
) -> dict[str, int]:
    mapping = _required_mapping(value, label)
    if set(mapping) != set(names):
        raise ReceiptExportError(f"{label} fields are invalid")
    return {
        name: _required_non_negative_integer(mapping, name, label) for name in names
    }


def _descriptor_sha256(value: Any, label: str) -> str:
    descriptor = _required_mapping(value, label)
    return _required_sha256(descriptor, "sha256", label)


def _public_metrics(value: Any, label: str) -> dict[str, Any]:
    """Copy only the aggregate metrics emitted by the reference runtime.

    A generic recursive JSON copier would allow someone to hide note sequences
    or record-level values under a field named ``metrics``.  The public receipt
    therefore accepts only per-head aggregate count/NLL/accuracy values and the
    aggregate primary NLL.
    """

    metrics = _required_mapping(value, label)
    # Optional rather than required: it was introduced after the first local
    # training runs, and a receipt for one of those should still be exportable
    # instead of failing on a field that did not exist when it was produced.
    optional = {"meanNormalizedActiveHeadNll"}
    allowed = {*METRIC_HEADS, "meanActiveHeadNll", *optional}
    fields = set(metrics)
    unknown = fields - allowed
    if unknown:
        unsafe = next(iter(unknown))
        if not isinstance(unsafe, str) or SAFE_METRIC_KEY.fullmatch(unsafe) is None:
            raise ReceiptExportError(f"{label} contains an unsafe metric name")
        raise ReceiptExportError(
            f"{label} contains metrics not approved for publication: "
            + ", ".join(sorted(unknown))
        )
    missing = allowed - optional - fields
    if missing:
        raise ReceiptExportError(
            f"{label} is missing runtime metrics: " + ", ".join(sorted(missing))
        )

    result: dict[str, Any] = {}
    active_nll: list[int | float] = []
    counts: dict[str, int] = {}
    for head in METRIC_HEADS:
        aggregate = _required_mapping(metrics[head], f"{label}.{head}")
        if set(aggregate) != {"count", "nll", "accuracy"}:
            raise ReceiptExportError(
                f"{label}.{head} must contain count, nll, and accuracy"
            )
        count = _required_non_negative_integer(
            aggregate,
            "count",
            f"{label}.{head}",
        )
        counts[head] = count
        nll = aggregate.get("nll")
        accuracy = aggregate.get("accuracy")
        if count == 0:
            if nll is not None or accuracy is not None:
                raise ReceiptExportError(
                    f"{label}.{head} must use null nll and accuracy when count is zero"
                )
        else:
            nll = _required_bounded_number(
                nll,
                f"{label}.{head}.nll",
                minimum=0,
            )
            accuracy = _required_bounded_number(
                accuracy,
                f"{label}.{head}.accuracy",
                minimum=0,
                maximum=1,
            )
            active_nll.append(nll)
        result[head] = {
            "count": count,
            "nll": nll,
            "accuracy": accuracy,
        }

    factor_counts = {counts[head] for head in METRIC_HEADS if head != "event"}
    if len(factor_counts) != 1:
        raise ReceiptExportError(
            f"{label} factor-head counts must match the runtime change mask"
        )
    factor_count = next(iter(factor_counts))
    if factor_count > counts["event"]:
        raise ReceiptExportError(f"{label} factor-head count cannot exceed event count")

    primary = metrics["meanActiveHeadNll"]
    if not active_nll:
        if primary is not None:
            raise ReceiptExportError(
                f"{label}.meanActiveHeadNll must be null when no head is active"
            )
    else:
        primary = _required_bounded_number(
            primary,
            f"{label}.meanActiveHeadNll",
            minimum=0,
        )
        expected_primary = sum(active_nll) / len(active_nll)
        if not math.isclose(
            primary,
            expected_primary,
            rel_tol=1e-12,
            abs_tol=1e-12,
        ):
            raise ReceiptExportError(
                f"{label}.meanActiveHeadNll does not match "
                "the mean of active head NLL values"
            )
    result["meanActiveHeadNll"] = primary
    # Copied only when the run recorded it, so a receipt for an older run
    # keeps the shape that run actually had.
    if "meanNormalizedActiveHeadNll" in metrics:
        result["meanNormalizedActiveHeadNll"] = _required_bounded_number(
            metrics["meanNormalizedActiveHeadNll"],
            f"{label}.meanNormalizedActiveHeadNll",
            minimum=0,
        ) if active_nll else None
    return result


def _required_bounded_number(
    value: Any,
    label: str,
    *,
    minimum: float,
    maximum: float | None = None,
) -> int | float:
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(value)
        or value < minimum
        or (maximum is not None and value > maximum)
    ):
        bounds = f"[{minimum}, {maximum}]" if maximum is not None else f">= {minimum}"
        raise ReceiptExportError(f"{label} must be finite and {bounds}")
    return value


def _copy_allowlisted_mapping(
    value: Any,
    allowed_fields: Sequence[str],
    label: str,
    *,
    require_all: bool,
) -> dict[str, Any]:
    mapping = _required_mapping(value, label)
    unknown = set(mapping) - set(allowed_fields)
    if unknown:
        raise ReceiptExportError(
            f"{label} contains fields not approved for publication: "
            + ", ".join(sorted(unknown))
        )
    if require_all:
        missing = set(allowed_fields) - set(mapping)
        if missing:
            raise ReceiptExportError(
                f"{label} is missing required fields: " + ", ".join(sorted(missing))
            )
    return {
        field: _public_scalar(mapping[field], f"{label}.{field}")
        for field in allowed_fields
        if field in mapping
    }


def _public_scalar(value: Any, label: str) -> str | int | float | bool | None:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return value
    raise ReceiptExportError(f"{label} is not a safe scalar")


def _public_optional_number(value: Any, label: str) -> int | float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ReceiptExportError(f"{label} must be numeric or null")
    if isinstance(value, float) and not math.isfinite(value):
        raise ReceiptExportError(f"{label} must be finite")
    return value


def _required_mapping(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ReceiptExportError(f"{label} must be an object")
    return value


def _required_exact_mapping(
    value: Any,
    fields: set[str],
    label: str,
) -> Mapping[str, Any]:
    mapping = _required_mapping(value, label)
    if set(mapping) != fields:
        raise ReceiptExportError(f"{label} fields are invalid")
    return mapping


def _required_string(
    mapping: Mapping[str, Any],
    field: str,
    label: str,
) -> str:
    value = mapping.get(field)
    if not isinstance(value, str) or not value or len(value) > 512:
        raise ReceiptExportError(f"{label} {field} must be a non-empty string")
    return value


def _required_safe_token(
    mapping: Mapping[str, Any],
    field: str,
    label: str,
) -> str:
    value = _required_string(mapping, field, label)
    if SAFE_PUBLIC_TOKEN.fullmatch(value) is None:
        raise ReceiptExportError(f"{label} {field} must be an ASCII safe token")
    return value


def _required_boolean(
    mapping: Mapping[str, Any],
    field: str,
    label: str,
) -> bool:
    value = mapping.get(field)
    if not isinstance(value, bool):
        raise ReceiptExportError(f"{label} {field} must be boolean")
    return value


def _required_integer(
    mapping: Mapping[str, Any],
    field: str,
    label: str,
) -> int:
    value = mapping.get(field)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ReceiptExportError(f"{label} {field} must be an integer")
    return value


def _required_non_negative_integer(
    mapping: Mapping[str, Any],
    field: str,
    label: str,
) -> int:
    value = _required_integer(mapping, field, label)
    if value < 0:
        raise ReceiptExportError(f"{label} {field} must be non-negative")
    return value


def _required_sha256(
    mapping: Mapping[str, Any],
    field: str,
    label: str,
) -> str:
    value = mapping.get(field)
    if not isinstance(value, str) or HASH_PATTERN.fullmatch(value) is None:
        raise ReceiptExportError(f"{label} {field} must be a lowercase SHA-256")
    return value


def _require_equal_string(
    left: Mapping[str, Any],
    right: Mapping[str, Any],
    field: str,
    message: str,
) -> None:
    left_value = _required_string(left, field, "training run")
    right_value = _required_string(right, field, "artifact manifest")
    if left_value != right_value:
        raise ReceiptExportError(message)


def _require_hash_match(expected: str, actual: str, message: str) -> None:
    if not hmac.compare_digest(expected, actual):
        raise ReceiptExportError(message)


def _validate_local_file_name(value: str, label: str) -> None:
    posix = PurePosixPath(value)
    windows = PureWindowsPath(value)
    if (
        value in {".", ".."}
        or posix.is_absolute()
        or windows.is_absolute()
        or posix.name != value
        or windows.name != value
    ):
        raise ReceiptExportError(f"{label} must be a local file name")


def _validate_output_directory(
    output_directory: Path,
    *,
    project_root: Path,
    public_reports_root: Path,
) -> Path:
    output = output_directory.resolve()
    project = project_root.resolve()
    forbidden = (
        project / "models",
        project / "datasets",
        project / "training" / "runs",
    )
    for private_root in forbidden:
        private = private_root.resolve()
        if output == private or private in output.parents:
            raise ReceiptExportError(
                "public receipts cannot be written inside "
                f"{private_root.relative_to(project).as_posix()}/"
            )

    reports = public_reports_root.resolve()
    if output != reports and reports not in output.parents:
        raise ReceiptExportError(
            "public receipts must be written beneath docs/model-reports"
        )
    if output.exists() and not output.is_dir():
        raise ReceiptExportError("public receipt output exists but is not a directory")
    return output


def _read_json_object(path: Path, label: str) -> tuple[bytes, dict[str, Any]]:
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise ReceiptExportError(f"{label} could not be read") from exc
    try:
        value = json.loads(payload, object_pairs_hook=_object_without_duplicates)
    except (UnicodeDecodeError, json.JSONDecodeError, ReceiptExportError) as exc:
        raise ReceiptExportError(f"{label} is invalid JSON") from exc
    if not isinstance(value, dict):
        raise ReceiptExportError(f"{label} must be a JSON object")
    return payload, value


def _object_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ReceiptExportError(f"duplicate JSON field: {key}")
        value[key] = item
    return value


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise ReceiptExportError("checkpoint file could not be read") from exc
    return digest.hexdigest()


def _canonical_json_bytes(payload: Mapping[str, Any]) -> bytes:
    return (
        json.dumps(
            payload,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")


def _install_receipt_bundle_atomically(
    output: Path,
    payloads: Mapping[str, Mapping[str, Any]],
) -> dict[str, Path]:
    """Validate a sibling staging bundle, then install it as one directory."""

    try:
        output.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise ReceiptExportError(
            "public receipt parent directory could not be created"
        ) from exc
    _require_missing_or_empty_output(output)

    try:
        staging = Path(
            tempfile.mkdtemp(
                prefix=f".{output.name}.",
                suffix=".tmp",
                dir=output.parent,
            )
        )
    except OSError as exc:
        raise ReceiptExportError(
            "public receipt staging directory could not be created"
        ) from exc

    try:
        for file_name, payload in payloads.items():
            _write_staged_json(staging / file_name, payload)
        _verify_staged_receipt_bundle(staging, payloads)

        # Windows cannot atomically replace an existing directory.  An empty
        # destination carries no receipt data, so remove only that exact empty
        # directory immediately before the atomic rename.
        _remove_empty_output_for_install(output)
        os.replace(staging, output)
    except ReceiptExportError:
        _cleanup_staging_directory(staging)
        raise
    except OSError as exc:
        _cleanup_staging_directory(staging)
        raise ReceiptExportError(
            "public receipt bundle could not be installed atomically"
        ) from exc

    return {file_name: output / file_name for file_name in payloads}


def _require_missing_or_empty_output(output: Path) -> None:
    if not output.exists():
        return
    if not output.is_dir():
        raise ReceiptExportError("public receipt output exists but is not a directory")
    try:
        next(output.iterdir())
    except StopIteration:
        return
    except OSError as exc:
        raise ReceiptExportError(
            "public receipt output directory could not be inspected"
        ) from exc
    raise ReceiptExportError(
        "public receipt output directory already exists and is not empty"
    )


def _remove_empty_output_for_install(output: Path) -> None:
    _require_missing_or_empty_output(output)
    if output.exists():
        try:
            output.rmdir()
        except OSError as exc:
            raise ReceiptExportError(
                "public receipt output directory is no longer empty"
            ) from exc


def _write_staged_json(path: Path, payload: Mapping[str, Any]) -> None:
    try:
        with path.open("xb") as handle:
            handle.write(_canonical_json_bytes(payload))
            handle.flush()
            os.fsync(handle.fileno())
    except OSError as exc:
        raise ReceiptExportError(
            f"public receipt staging write failed for {path.name}"
        ) from exc


def _verify_staged_receipt_bundle(
    staging: Path,
    payloads: Mapping[str, Mapping[str, Any]],
) -> None:
    try:
        staged_names = {path.name for path in staging.iterdir()}
    except OSError as exc:
        raise ReceiptExportError(
            "public receipt staging directory could not be inspected"
        ) from exc
    if staged_names != set(payloads):
        raise ReceiptExportError("public receipt staging bundle is incomplete")

    for file_name, expected in payloads.items():
        payload, parsed = _read_json_object(
            staging / file_name,
            f"staged public receipt {file_name}",
        )
        if payload != _canonical_json_bytes(expected) or parsed != expected:
            raise ReceiptExportError(
                f"staged public receipt {file_name} failed read-back validation"
            )


def _cleanup_staging_directory(staging: Path) -> None:
    """Best-effort cleanup limited to the staging directory we created."""

    if not staging.exists():
        return
    try:
        for child in staging.iterdir():
            if child.is_file() or child.is_symlink():
                child.unlink(missing_ok=True)
        staging.rmdir()
    except OSError:
        # Preserve the original export failure.  A hidden sibling staging
        # directory is never treated as a successfully installed receipt.
        pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Verify one private HarmonyForge artifact and export three "
            "non-reconstructive receipts beneath docs/model-reports."
        )
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        required=True,
        help="Local private artifact manifest.json.",
    )
    parser.add_argument(
        "--training-run",
        type=Path,
        required=True,
        help="Local private training-run.json.",
    )
    parser.add_argument(
        "--data-manifest",
        type=Path,
        required=True,
        help="Local private data-manifest.json.",
    )
    parser.add_argument(
        "--prepare-run",
        type=Path,
        help=(
            "Local private prepare-run.json required for schema v2 "
            "harmony-only data; omit for schema v1 melody-conditioned data."
        ),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        required=True,
        help="Public destination beneath docs/model-reports.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    invocation_directory = Path.cwd()
    manifest_path = _resolve_cli_input(
        arguments.manifest,
        invocation_directory,
    )
    training_run_path = _resolve_cli_input(
        arguments.training_run,
        invocation_directory,
    )
    data_manifest_path = _resolve_cli_input(
        arguments.data_manifest,
        invocation_directory,
    )
    prepare_run_path = (
        _resolve_cli_input(
            arguments.prepare_run,
            invocation_directory,
        )
        if arguments.prepare_run is not None
        else None
    )
    output_directory = arguments.output_dir
    if not output_directory.is_absolute():
        output_directory = PROJECT_ROOT / output_directory
    try:
        destinations = export_public_training_receipts(
            manifest_path,
            training_run_path,
            data_manifest_path,
            output_directory,
            prepare_run_path=prepare_run_path,
        )
    except ReceiptExportError as exc:
        print(f"Training receipt export failed: {exc}", file=sys.stderr)
        return 2
    output = next(iter(destinations.values())).parent
    print(f"Public training receipts written to: {output}")
    print(
        "Checkpoint bytes matched the supplied unsigned manifest; "
        "no weights or private data were copied."
    )
    return 0


def _resolve_cli_input(path: Path, invocation_directory: Path) -> Path:
    """Resolve relative private inputs against the caller's working directory."""

    if path.is_absolute():
        return path.resolve()
    return (invocation_directory / path).resolve()


if __name__ == "__main__":
    raise SystemExit(main())
