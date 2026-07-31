import hashlib
import json
import os
import struct
from pathlib import Path

import pytest

from app.ml import dataset as dataset_module
from app.ml import training_runtime
from app.ml.artifacts import (
    ArtifactExportError,
    publish_checkpoint_manifest,
    save_trained_artifact,
    validate_safetensors_file,
)
from app.ml.checkpoint import (
    ARTIFACT_POINTER_FILE,
    CHECKPOINT_FILE,
    INFERENCE_TASK,
    CheckpointInvalidError,
    load_manifest,
    model_artifact_directory,
)
from app.ml.contracts import MODEL_ID, ROLE_VOCABULARY, load_model_config
from app.ml.dataset import (
    DATA_MANIFEST_FILE,
    PRIVATE_HARMONY_TRAINING_PURPOSE,
    CompileOptions,
    DatasetCompileError,
    compile_dataset,
    iter_compiled_split,
    load_compiled_dataset_snapshot,
    load_data_manifest,
)
from app.ml.masking import MASK_KINDS, curriculum_mask
from app.ml.training_runtime import (
    TrainingRuntimeError,
    prepare_deterministic_environment,
    validate_compiled_rows,
)


def _config_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "configs"
        / "models"
        / "harmonyforge-bimask-base-v1.yaml"
    )


def _ledger(input_sha256: str) -> dict:
    return {
        "schemaVersion": 1,
        "rawDataInGit": False,
        "sources": [
            {
                "sourceId": "fixture",
                "version": "1",
                "license": "CC0-1.0",
                "allowedPurposes": ["researchTraining"],
                "checksumSha256": input_sha256,
                "removalProcedure": "Delete fixture source and rebuild.",
            }
        ],
    }


def _record(
    record_id: str,
    *,
    work_id: str | None = None,
    duplicate_group_id: str | None = None,
    root: int = 0,
    quality: str = "major",
    chord_start: int = 0,
) -> dict:
    record = {
        "recordId": record_id,
        "workId": work_id or record_id,
        "sourceId": "fixture",
        "sourceItemId": f"source-{record_id}",
        "ppq": 480,
        "ticksPerBar": 1920,
        "timeSignature": "4/4",
        "startTick": 0,
        "endTick": 1920,
        "melody": [
            {
                "startTick": 0,
                "durationTick": 960,
                "midi": 60 + root,
                "velocity": 96,
                "role": "chordTone",
            }
        ],
        "harmony": [
            {
                "startTick": chord_start,
                "durationTick": 960 - chord_start,
                "rootOffsetFromKey": root,
                "quality": quality,
                "inversion": 0,
                "bassOffsetFromRoot": 0,
                "extensions": [],
                "originalLabel": quality,
            },
            {
                "startTick": 960,
                "durationTick": 960,
                "rootOffsetFromKey": (root + 7) % 12,
                "quality": "major",
                "inversion": 0,
                "bassOffsetFromRoot": 0,
                "extensions": ["9"],
            },
        ],
        "tonalities": [
            {
                "startTick": 0,
                "endTick": 1920,
                "keyRoot": root,
                "mode": "major",
            }
        ],
        "style": "fixture",
        "synthetic": True,
    }
    if duplicate_group_id is not None:
        record["duplicateGroupId"] = duplicate_group_id
    return record


def _write_inputs(tmp_path: Path, records: list[dict]) -> tuple[Path, Path]:
    input_path = tmp_path / "records.jsonl"
    input_bytes = "".join(
        json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n"
        for record in records
    ).encode()
    input_path.write_bytes(input_bytes)
    input_sha256 = hashlib.sha256(input_bytes).hexdigest()
    ledger_path = tmp_path / "ledger.json"
    ledger_path.write_text(
        json.dumps(
            _ledger(input_sha256),
            separators=(",", ":"),
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    return input_path, ledger_path


def _write_harmony_only_inputs(
    tmp_path: Path,
    records: list[dict],
    *,
    review_status: str = "approved",
) -> tuple[Path, Path]:
    input_path = tmp_path / "harmony-only-records.jsonl"
    input_bytes = "".join(
        json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n"
        for record in records
    ).encode()
    input_path.write_bytes(input_bytes)
    records_by_source: dict[str, list[dict]] = {}
    for record in records:
        records_by_source.setdefault(record["sourceId"], []).append(record)
    sources = []
    for source_id, source_records in sorted(records_by_source.items()):
        canonical_source_bytes = "".join(
            json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n"
            for record in sorted(source_records, key=lambda item: item["recordId"])
        ).encode()
        sources.append(
            {
                "sourceId": source_id,
                "version": "fixture-v1",
                "canonicalUrl": f"https://example.test/{source_id}",
                "citation": f"Fixture source {source_id}.",
                "retrievedAt": "2026-07-30T00:00:00Z",
                "sourceMaterialSha256": hashlib.sha256(
                    f"source:{source_id}".encode()
                ).hexdigest(),
                "normalizedRecordsSha256": hashlib.sha256(
                    canonical_source_bytes
                ).hexdigest(),
                "review": {
                    "status": review_status,
                    "basis": "license",
                    "licenseId": "CC0-1.0",
                    "reviewedSourceInputs": [
                        "harmony",
                        "key",
                        "meter",
                        "beatTiming",
                    ],
                    "emittedTrainingContent": [
                        "harmony",
                        "key",
                        "meter",
                    ],
                    "reviewedAt": "2026-07-30T00:00:00Z",
                },
                "attribution": f"Fixture source {source_id}.",
                "removalProcedure": f"Remove {source_id} and recompile.",
            }
        )
    ledger_path = tmp_path / "harmony-only-ledger.json"
    ledger_path.write_text(
        json.dumps(
            {
                "schemaVersion": 2,
                "policyId": "harmony-only-private-v1",
                "purpose": PRIVATE_HARMONY_TRAINING_PURPOSE,
                "distributionScope": "privateLocalOnly",
                "rawDataInGit": False,
                "normalizedInputSha256": hashlib.sha256(input_bytes).hexdigest(),
                "preparation": None,
                "sources": sources,
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    return input_path, ledger_path


def _harmony_only_record(record_id: str, *, source_id: str = "fixture-a") -> dict:
    record = _record(record_id)
    record["sourceId"] = source_id
    record["sourceItemId"] = f"{source_id}:{record_id}"
    record.pop("melody")
    record.pop("style")
    return record


def _compile_harmony_only(
    tmp_path: Path,
    records: list[dict],
    output_name: str,
    *,
    review_status: str = "approved",
) -> tuple[Path, dict]:
    input_path, ledger_path = _write_harmony_only_inputs(
        tmp_path,
        records,
        review_status=review_status,
    )
    output = tmp_path / output_name
    manifest = compile_dataset(
        input_path,
        ledger_path,
        output,
        options=CompileOptions(
            dataset_id="harmony-only-fixture",
            dataset_version="v1",
            purpose=PRIVATE_HARMONY_TRAINING_PURPOSE,
            content_profile="harmonyOnlyV1",
        ),
    )
    return output, manifest


def _compile(
    tmp_path: Path,
    records: list[dict],
    output_name: str,
    **overrides,
) -> tuple[Path, dict]:
    input_path, ledger_path = _write_inputs(tmp_path, records)
    output = tmp_path / output_name
    options = CompileOptions(
        dataset_id="fixture",
        dataset_version="v1",
        **overrides,
    )
    manifest = compile_dataset(
        input_path,
        ledger_path,
        output,
        options=options,
    )
    return output, manifest


def _write_training_run(
    path: Path,
    data_manifest_path: Path,
    *,
    task: str = INFERENCE_TASK,
) -> Path:
    path.write_text(
        json.dumps(
            {
                "schemaVersion": 2,
                "deterministic": True,
                "task": task,
                "initialCheckpoint": None,
                "sourceCommit": "b" * 40,
                "configSha256": hashlib.sha256(
                    _config_path().read_bytes()
                ).hexdigest(),
                "dataManifestSha256": hashlib.sha256(
                    data_manifest_path.read_bytes()
                ).hexdigest(),
                "pytorchVersion": "2.13.0",
                "cublasWorkspaceConfig": ":4096:8",
                "seed": "1729",
                "optimizer": {"name": "AdamW"},
                "epochs": 1,
                "steps": 1,
                "actualDevice": "cpu",
                "dtype": "float32",
                "fallbackReason": None,
                "meanTrainingLoss": 1.0,
                "metrics": {"validation": {}},
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    return path


def test_compiler_is_byte_deterministic_and_keeps_groups_in_one_split(
    tmp_path,
) -> None:
    records = [
        _record("section-a", work_id="work-a", root=0),
        _record("section-b", work_id="work-a", root=2),
        _record("arrangement-a", duplicate_group_id="dup-x", root=4),
        _record("arrangement-b", duplicate_group_id="dup-x", root=6),
        *[_record(f"song-{index}", root=index % 12) for index in range(8)],
    ]
    source_alias_a = _record("source-alias-a", work_id="mistyped-a", root=8)
    source_alias_b = _record("source-alias-b", work_id="mistyped-b", root=11)
    source_alias_a["sourceItemId"] = "same-source-item"
    source_alias_b["sourceItemId"] = "same-source-item"
    records.extend((source_alias_a, source_alias_b))
    first, first_manifest = _compile(tmp_path, records, "first")
    second, second_manifest = _compile(tmp_path, records, "second")

    assert first_manifest == second_manifest
    assert {
        path.name: path.read_bytes() for path in first.iterdir()
    } == {
        path.name: path.read_bytes() for path in second.iterdir()
    }
    loaded = load_data_manifest(first / DATA_MANIFEST_FILE)
    assignments = {
        item["recordId"]: item for item in loaded["assignments"]
    }
    assert assignments["section-a"]["splitGroupId"] == assignments["section-b"][
        "splitGroupId"
    ]
    assert assignments["arrangement-a"]["splitGroupId"] == assignments[
        "arrangement-b"
    ]["splitGroupId"]
    assert assignments["source-alias-a"]["splitGroupId"] == assignments[
        "source-alias-b"
    ]["splitGroupId"]
    assert loaded["splitBeforeWindowing"] is True


def test_compiler_bundle_install_preserves_last_known_good_on_failure(
    tmp_path,
    monkeypatch,
) -> None:
    records = [_record(f"bundle-{index}") for index in range(8)]
    previous, _ = _compile(tmp_path, records, "bundle-v1")
    previous_snapshot = {
        path.name: path.read_bytes() for path in previous.iterdir()
    }

    input_path, ledger_path = _write_inputs(tmp_path, records)
    with pytest.raises(DatasetCompileError, match="already exists"):
        compile_dataset(
            input_path,
            ledger_path,
            previous,
            options=CompileOptions(
                dataset_id="fixture",
                dataset_version="v1",
            ),
        )
    assert {
        path.name: path.read_bytes() for path in previous.iterdir()
    } == previous_snapshot

    failed = tmp_path / "bundle-v2"
    original_write = dataset_module._write_bytes
    writes = 0

    def fail_on_third(path: Path, payload: bytes) -> None:
        nonlocal writes
        writes += 1
        if writes == 3:
            raise OSError("simulated third-file failure")
        original_write(path, payload)

    monkeypatch.setattr(dataset_module, "_write_bytes", fail_on_third)
    with pytest.raises(
        DatasetCompileError,
        match="could not be atomically installed",
    ):
        compile_dataset(
            input_path,
            ledger_path,
            failed,
            options=CompileOptions(
                dataset_id="fixture",
                dataset_version="v2",
            ),
        )

    assert writes == 3
    assert not failed.exists()
    assert list(tmp_path.glob(".bundle-v2.stage-*")) == []
    assert {
        path.name: path.read_bytes() for path in previous.iterdir()
    } == previous_snapshot


def test_compiler_rejects_unclear_rights_off_grid_chords_and_tampering(
    tmp_path,
) -> None:
    input_path, ledger_path = _write_inputs(tmp_path, [_record("safe")])
    unsafe = json.loads(ledger_path.read_text(encoding="utf-8"))
    unsafe["sources"][0]["license"] = "unknown"
    ledger_path.write_text(json.dumps(unsafe), encoding="utf-8")
    with pytest.raises(DatasetCompileError, match="unclear license"):
        compile_dataset(
            input_path,
            ledger_path,
            tmp_path / "unsafe",
            options=CompileOptions(dataset_id="fixture", dataset_version="v1"),
        )

    checksum_mismatch = _ledger("0" * 64)
    ledger_path.write_text(json.dumps(checksum_mismatch), encoding="utf-8")
    with pytest.raises(DatasetCompileError, match="does not match"):
        compile_dataset(
            input_path,
            ledger_path,
            tmp_path / "checksum-mismatch",
            options=CompileOptions(dataset_id="fixture", dataset_version="v1"),
        )

    with pytest.raises(DatasetCompileError, match="align"):
        _compile(
            tmp_path,
            [_record("off-grid", chord_start=1)],
            "off-grid",
            harmony_gap_policy="allowNoChord",
        )

    output, _ = _compile(tmp_path, [_record("valid")], "valid")
    split_file = next(
        path
        for path in output.glob("*.index.jsonl")
        if path.read_bytes()
    )
    split_file.write_bytes(split_file.read_bytes() + b" ")
    with pytest.raises(DatasetCompileError, match="checksum mismatch"):
        load_data_manifest(output / DATA_MANIFEST_FILE)


def test_dataset_snapshot_parses_the_same_bytes_it_hashes(
    tmp_path,
    monkeypatch,
) -> None:
    output, manifest = _compile(
        tmp_path,
        [_record(f"snapshot-{index}") for index in range(12)],
        "snapshot",
    )
    split = next(
        name
        for name, descriptor in manifest["splits"].items()
        if descriptor["windowCount"]
    )
    manifest_path = output / DATA_MANIFEST_FILE
    split_path = output / manifest["splits"][split]["file"]
    original_manifest_bytes = manifest_path.read_bytes()
    original_split_bytes = split_path.read_bytes()
    expected_rows = [
        json.loads(line)
        for line in original_split_bytes.decode("utf-8").splitlines()
    ]
    original_read_bytes = dataset_module._read_bytes
    mutated_paths: set[Path] = set()

    def read_then_mutate(path: Path, label: str) -> bytes:
        payload = original_read_bytes(path, label)
        resolved = path.resolve()
        if resolved == manifest_path.resolve() and resolved not in mutated_paths:
            manifest_path.write_bytes(b"{}\n")
            mutated_paths.add(resolved)
        elif resolved == split_path.resolve() and resolved not in mutated_paths:
            split_path.write_bytes(b'{"tampered":true}\n')
            mutated_paths.add(resolved)
        return payload

    monkeypatch.setattr(dataset_module, "_read_bytes", read_then_mutate)

    snapshot = load_compiled_dataset_snapshot(manifest_path)

    assert snapshot.manifest_sha256 == hashlib.sha256(
        original_manifest_bytes
    ).hexdigest()
    assert list(snapshot.rows(split)) == expected_rows
    assert manifest_path.read_bytes() == b"{}\n"
    assert split_path.read_bytes() == b'{"tampered":true}\n'


def test_compiler_records_declared_quality_and_gap_exclusions(tmp_path) -> None:
    gap = _record("gap", chord_start=120)
    unsupported = _record("unsupported", root=3, quality="quartal")
    output, manifest = _compile(
        tmp_path,
        [_record("valid"), gap, unsupported],
        "exclusions",
    )

    statistics = json.loads(
        (output / manifest["statistics"]["file"]).read_text(encoding="utf-8")
    )
    assert statistics["eligibleRecordCount"] == 1
    assert statistics["excludedByReason"] == {
        "harmonyGap": 1,
        "unsupportedQuality": 1,
    }
    assert manifest["normalization"]["harmonyGapPolicy"] == "excludeRecord"


def test_harmony_only_profile_compiles_private_provenance_and_sentinels(
    tmp_path,
) -> None:
    records = [
        _harmony_only_record("first", source_id="fixture-a"),
        _harmony_only_record("second", source_id="fixture-b"),
    ]
    output, manifest = _compile_harmony_only(
        tmp_path,
        records,
        "harmony-only",
    )

    assert manifest["schemaVersion"] == 2
    assert manifest["contentProfile"] == "harmonyOnlyV1"
    assert manifest["distributionScope"] == "privateLocalOnly"
    assert manifest["ledger"]["sourceChecksumScope"] == (
        "perSourceCanonicalNormalizedRecords"
    )
    assert manifest["ledger"]["reviewedSourceInputs"] == [
        "harmony",
        "key",
        "meter",
        "beatTiming",
    ]
    assert manifest["ledger"]["emittedTrainingContent"] == [
        "harmony",
        "key",
        "meter",
    ]
    assert manifest["ledger"]["preparation"] is None
    loaded = load_data_manifest(output / DATA_MANIFEST_FILE)
    provenance = json.loads(
        (output / loaded["provenance"]["file"]).read_text(encoding="utf-8")
    )
    assert provenance["policyId"] == "harmony-only-private-v1"
    assert [source["sourceId"] for source in provenance["sources"]] == [
        "fixture-a",
        "fixture-b",
    ]
    rows = [
        row
        for split in ("train", "validation", "test")
        for row in iter_compiled_split(output / DATA_MANIFEST_FILE, split)
    ]
    assert rows
    assert all(row["contentProfile"] == "harmonyOnlyV1" for row in rows)
    assert all(
        set(row["inputs"]["melodyMidi"]) == {128}
        and set(row["inputs"]["melodyRole"])
        == {ROLE_VOCABULARY.index("unknown")}
        for row in rows
    )
    validate_compiled_rows(rows, load_model_config(_config_path()))


def test_old_harmony_only_manifest_requires_explicit_recompile(tmp_path) -> None:
    output, _ = _compile_harmony_only(
        tmp_path,
        [_harmony_only_record("old-v2")],
        "old-v2",
    )
    manifest_path = output / DATA_MANIFEST_FILE
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["compilerVersion"] = "1.1.0"
    manifest["ledger"].pop("reviewedSourceInputs")
    manifest["ledger"].pop("emittedTrainingContent")
    manifest["ledger"].pop("preparation")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(
        DatasetCompileError,
        match="harmony-only provenance requires compiler 1.2.0",
    ):
        load_data_manifest(manifest_path, verify_files=False)


def test_harmony_only_profile_rejects_forbidden_content_and_unapproved_source(
    tmp_path,
) -> None:
    with_melody = _harmony_only_record("melody")
    with_melody["melody"] = []
    input_path, ledger_path = _write_harmony_only_inputs(
        tmp_path,
        [with_melody],
    )
    with pytest.raises(DatasetCompileError, match="forbids source content"):
        compile_dataset(
            input_path,
            ledger_path,
            tmp_path / "forbidden",
            options=CompileOptions(
                dataset_id="harmony-only-fixture",
                dataset_version="v1",
                purpose=PRIVATE_HARMONY_TRAINING_PURPOSE,
                content_profile="harmonyOnlyV1",
            ),
        )

    with pytest.raises(DatasetCompileError, match="review status"):
        _compile_harmony_only(
            tmp_path,
            [_harmony_only_record("pending")],
            "pending",
            review_status="pending",
        )


def test_harmony_only_ledger_hashes_each_source_independently(tmp_path) -> None:
    records = [
        _harmony_only_record("first", source_id="fixture-a"),
        _harmony_only_record("second", source_id="fixture-b"),
    ]
    input_path, ledger_path = _write_harmony_only_inputs(tmp_path, records)
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    ledger["sources"][0]["normalizedRecordsSha256"] = "0" * 64
    ledger_path.write_text(json.dumps(ledger), encoding="utf-8")

    with pytest.raises(
        DatasetCompileError,
        match="fixture-a normalized record checksum does not match",
    ):
        compile_dataset(
            input_path,
            ledger_path,
            tmp_path / "source-mismatch",
            options=CompileOptions(
                dataset_id="harmony-only-fixture",
                dataset_version="v1",
                purpose=PRIVATE_HARMONY_TRAINING_PURPOSE,
                content_profile="harmonyOnlyV1",
            ),
        )


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        (
            "reviewedSourceInputs",
            ["harmony", "key", "meter"],
            "reviewed inputs",
        ),
        (
            "emittedTrainingContent",
            ["harmony", "key", "meter", "beatTiming"],
            "emitted content",
        ),
    ],
)
def test_harmony_only_ledger_separates_reviewed_and_emitted_content(
    tmp_path,
    field,
    value,
    message,
) -> None:
    input_path, ledger_path = _write_harmony_only_inputs(
        tmp_path,
        [_harmony_only_record("scope")],
    )
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    ledger["sources"][0]["review"][field] = value
    ledger_path.write_text(json.dumps(ledger), encoding="utf-8")

    with pytest.raises(DatasetCompileError, match=message):
        compile_dataset(
            input_path,
            ledger_path,
            tmp_path / f"invalid-{field}",
            options=CompileOptions(
                dataset_id="harmony-only-fixture",
                dataset_version="v1",
                purpose=PRIVATE_HARMONY_TRAINING_PURPOSE,
                content_profile="harmonyOnlyV1",
            ),
        )


def test_compiled_events_preserve_change_and_hold_boundaries(tmp_path) -> None:
    output, manifest = _compile(tmp_path, [_record("events")], "events")
    split = next(
        descriptor
        for descriptor in manifest["splits"].values()
        if descriptor["windowCount"]
    )
    row = json.loads(
        (output / split["file"]).read_text(encoding="utf-8").splitlines()[0]
    )

    assert row["targets"]["event"][:8] == [2, 1, 1, 1, 1, 1, 1, 1]
    assert row["targets"]["event"][8:] == [2, 1, 1, 1, 1, 1, 1, 1]


def test_training_validator_rejects_out_of_vocabulary_compiled_values(
    tmp_path,
) -> None:
    output, manifest = _compile(tmp_path, [_record("range")], "range")
    split = next(
        descriptor
        for descriptor in manifest["splits"].values()
        if descriptor["windowCount"]
    )
    row = json.loads(
        (output / split["file"]).read_text(encoding="utf-8").splitlines()[0]
    )
    row["inputs"]["melodyMidi"][0] = 999

    with pytest.raises(TrainingRuntimeError, match="melodyMidi"):
        validate_compiled_rows([row], load_model_config(_config_path()))


def test_cublas_determinism_is_configured_before_device_use(
    monkeypatch,
) -> None:
    monkeypatch.delenv("CUBLAS_WORKSPACE_CONFIG", raising=False)

    assert prepare_deterministic_environment() == ":4096:8"
    assert os.environ["CUBLAS_WORKSPACE_CONFIG"] == ":4096:8"

    monkeypatch.setenv("CUBLAS_WORKSPACE_CONFIG", "unsafe")
    with pytest.raises(TrainingRuntimeError, match="CUBLAS_WORKSPACE_CONFIG"):
        prepare_deterministic_environment()


@pytest.mark.parametrize("kind", MASK_KINDS)
def test_masking_curriculum_is_deterministic_and_never_empty(kind) -> None:
    first = curriculum_mask(
        [0, 0, 1, 1, 2, 2],
        seed="1729",
        epoch=3,
        example_id="example",
        kind=kind,
    )
    second = curriculum_mask(
        [0, 0, 1, 1, 2, 2],
        seed="1729",
        epoch=3,
        example_id="example",
        kind=kind,
    )

    assert first == second
    assert first.kind == kind
    assert any(first.masked)


def test_artifact_manifest_verifies_real_data_manifest_without_torch(
    tmp_path,
) -> None:
    compiled, _ = _compile(tmp_path, [_record("valid")], "compiled")
    model_directory = tmp_path / "models"
    artifact = model_directory / MODEL_ID
    artifact.mkdir(parents=True)
    checkpoint = artifact / CHECKPOINT_FILE
    _write_minimal_safetensors(checkpoint)
    validate_safetensors_file(checkpoint)
    config = load_model_config(_config_path())
    training_run_path = _write_training_run(
        artifact / "source-training-run.json",
        compiled / DATA_MANIFEST_FILE,
    )

    exported = publish_checkpoint_manifest(
        artifact,
        config=config,
        config_path=_config_path(),
        data_manifest_path=compiled / DATA_MANIFEST_FILE,
        training_run_path=training_run_path,
        source_commit="b" * 40,
        pytorch_version="2.13.0",
    )

    assert exported.trained is True
    assert exported.data_manifest_file == DATA_MANIFEST_FILE
    assert exported.training_run_file == "training-run.json"
    assert (artifact / DATA_MANIFEST_FILE).is_file()
    with pytest.raises(ArtifactExportError, match="cannot promote"):
        publish_checkpoint_manifest(
            artifact,
            config=config,
            config_path=_config_path(),
            data_manifest_path=compiled / DATA_MANIFEST_FILE,
            training_run_path=training_run_path,
            source_commit="b" * 40,
            pytorch_version="2.13.0",
            evaluation_status="validated",  # type: ignore[arg-type]
        )
    load_manifest(
        model_directory,
        config,
        config_path=_config_path(),
        allow_research=True,
    )
    (artifact / DATA_MANIFEST_FILE).write_bytes(b"tampered")
    with pytest.raises(CheckpointInvalidError, match="data manifest checksum"):
        load_manifest(
            model_directory,
            config,
            config_path=_config_path(),
            allow_research=True,
        )


def test_artifact_writer_rejects_training_run_task_mismatch(tmp_path) -> None:
    compiled, _ = _compile(tmp_path, [_record("task-mismatch")], "compiled")
    artifact = tmp_path / "models" / MODEL_ID
    artifact.mkdir(parents=True)
    _write_minimal_safetensors(artifact / CHECKPOINT_FILE)
    training_run_path = _write_training_run(
        artifact / "source-training-run.json",
        compiled / DATA_MANIFEST_FILE,
        task="harmony_only_pretraining",
    )

    with pytest.raises(ArtifactExportError, match="training run task"):
        publish_checkpoint_manifest(
            artifact,
            config=load_model_config(_config_path()),
            config_path=_config_path(),
            data_manifest_path=compiled / DATA_MANIFEST_FILE,
            training_run_path=training_run_path,
            source_commit="b" * 40,
            pytorch_version="2.13.0",
        )


def test_artifact_writer_rejects_non_safetensors_bytes(tmp_path) -> None:
    checkpoint = tmp_path / CHECKPOINT_FILE
    checkpoint.write_bytes(b"not-a-checkpoint")

    with pytest.raises(ArtifactExportError, match="safetensors"):
        validate_safetensors_file(checkpoint)


def test_atomic_artifact_pointer_preserves_last_known_good_on_failure(
    tmp_path,
    monkeypatch,
) -> None:
    import app.ml.artifacts as artifacts

    compiled, _ = _compile(tmp_path, [_record("atomic")], "atomic-compiled")
    data_manifest = compiled / DATA_MANIFEST_FILE
    training_run = _write_training_run(
        tmp_path / "atomic-training-run.json",
        data_manifest,
    )
    model_directory = tmp_path / "atomic-models"

    class FakeTensor:
        def detach(self):
            return self

        def cpu(self):
            return self

        def contiguous(self):
            return self

    class FakeModel:
        def state_dict(self):
            return {"weight": FakeTensor()}

    class FakeSafetensors:
        @staticmethod
        def save_file(_state, path):
            _write_minimal_safetensors(Path(path))

    monkeypatch.setattr(
        artifacts.importlib,
        "import_module",
        lambda _name: FakeSafetensors,
    )
    config = load_model_config(_config_path())
    first = save_trained_artifact(
        FakeModel(),
        model_directory,
        config=config,
        config_path=_config_path(),
        data_manifest_path=data_manifest,
        training_run_path=training_run,
        source_commit="b" * 40,
        pytorch_version="2.13.0",
    )
    pointer_path = model_directory / MODEL_ID / ARTIFACT_POINTER_FILE
    pointer_before = pointer_path.read_bytes()

    assert model_artifact_directory(model_directory).is_dir()
    assert load_manifest(
        model_directory,
        config,
        config_path=_config_path(),
        allow_research=True,
    ).checkpoint_sha256 == first.checkpoint_sha256

    def fail_publish(*_args, **_kwargs):
        raise ArtifactExportError("staged validation failed")

    monkeypatch.setattr(artifacts, "publish_checkpoint_manifest", fail_publish)
    with pytest.raises(ArtifactExportError, match="staged validation"):
        save_trained_artifact(
            FakeModel(),
            model_directory,
            config=config,
            config_path=_config_path(),
            data_manifest_path=data_manifest,
            training_run_path=training_run,
            source_commit="b" * 40,
            pytorch_version="2.13.0",
        )

    assert pointer_path.read_bytes() == pointer_before
    assert load_manifest(
        model_directory,
        config,
        config_path=_config_path(),
        allow_research=True,
    ).checkpoint_sha256 == first.checkpoint_sha256


def test_failed_same_root_export_preserves_legacy_training_run(
    tmp_path,
    monkeypatch,
) -> None:
    model_directory = tmp_path / "models"
    legacy_artifact = model_directory / MODEL_ID
    legacy_artifact.mkdir(parents=True)
    legacy_training_run = legacy_artifact / "training-run.json"
    original = b'{"legacy":"still-active"}\n'
    legacy_training_run.write_bytes(original)

    def fail_export(
        _model,
        _model_directory,
        *,
        training_run_path,
        **_kwargs,
    ):
        assert training_run_path.parent != legacy_artifact
        assert json.loads(training_run_path.read_text()) == {"new": "run"}
        raise ArtifactExportError("staged validation failed")

    monkeypatch.setattr(
        training_runtime,
        "save_trained_artifact",
        fail_export,
    )

    with pytest.raises(ArtifactExportError, match="staged validation"):
        training_runtime._save_artifact_with_staged_training_run(
            object(),
            model_directory=model_directory,
            config=load_model_config(_config_path()),
            config_path=_config_path(),
            data_manifest_path=tmp_path / "data-manifest.json",
            training_run={"new": "run"},
            source_commit="b" * 40,
            pytorch_version="2.13.0",
            task=INFERENCE_TASK,
        )

    assert legacy_training_run.read_bytes() == original


def _write_minimal_safetensors(path: Path) -> None:
    header = json.dumps(
        {
            "weight": {
                "dtype": "F32",
                "shape": [1],
                "data_offsets": [0, 4],
            }
        },
        separators=(",", ":"),
    ).encode()
    padding = b" " * ((8 - len(header) % 8) % 8)
    padded_header = header + padding
    path.write_bytes(
        len(padded_header).to_bytes(8, "little")
        + padded_header
        + struct.pack("<f", 1.0)
    )
