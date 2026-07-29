import hashlib
import json
import os
import struct
from pathlib import Path

import pytest

from app.ml.artifacts import (
    ArtifactExportError,
    publish_checkpoint_manifest,
    save_trained_artifact,
    validate_safetensors_file,
)
from app.ml.checkpoint import (
    ARTIFACT_POINTER_FILE,
    CHECKPOINT_FILE,
    CheckpointInvalidError,
    load_manifest,
    model_artifact_directory,
)
from app.ml.contracts import MODEL_ID, load_model_config
from app.ml.dataset import (
    DATA_MANIFEST_FILE,
    CompileOptions,
    DatasetCompileError,
    compile_dataset,
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
) -> Path:
    path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "deterministic": True,
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
