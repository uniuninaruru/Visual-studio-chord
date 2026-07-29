import hashlib
import json
import shutil
from pathlib import Path

import pytest

from app.ml.backends.torch_backend import _select_dtype
from app.ml.checkpoint import (
    ARTIFACT_POINTER_FILE,
    ARTIFACT_VERSIONS_DIRECTORY,
    CheckpointInvalidError,
    CheckpointUnavailableError,
    load_manifest,
    load_validated_checkpoint,
    load_weights,
    validate_pytorch_compatibility,
)
from app.ml.contracts import MODEL_ID, load_model_config
from app.ml.tokenizer import TOKENIZER_SHA256


def _config_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "configs"
        / "models"
        / "harmonyforge-bimask-base-v1.yaml"
    )


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_manifest(model_directory: Path, **overrides) -> Path:
    artifact = model_directory / MODEL_ID
    artifact.mkdir(parents=True, exist_ok=True)
    checkpoint = artifact / "harmonyforge-bimask-base-v1.safetensors"
    checkpoint.write_bytes(b"safe-test-fixture")
    data_manifest = artifact / "data-manifest.json"
    data_manifest.write_bytes(b'{"fixture":true}\n')
    training_run = artifact / "training-run.json"
    training_run.write_bytes(b'{"fixture":true}\n')
    config = load_model_config(_config_path())
    payload = {
        "schemaVersion": 1,
        "modelId": MODEL_ID,
        "task": "melody_conditioned_variable_rhythm_harmonization",
        "trained": True,
        "evaluationStatus": "validated",
        "architecture": config.architecture_dict(),
        "architectureConfigSha256": _sha256(_config_path()),
        "checkpointFile": checkpoint.name,
        "checkpointSha256": _sha256(checkpoint),
        "dataManifestFile": data_manifest.name,
        "trainingRunFile": training_run.name,
        "tokenizerSha256": TOKENIZER_SHA256,
        "dataManifestSha256": _sha256(data_manifest),
        "trainingRunSha256": _sha256(training_run),
        "sourceCommit": "b" * 40,
        "pytorchVersion": "2.13.0",
        "minimumAppVersion": "0.4.0",
        "minimumApiVersion": "2",
        "supportedPrecisions": {
            "cuda": ["bfloat16", "float16", "float32"],
            "mps": ["float32"],
            "cpu": ["float32"],
        },
    }
    payload.update(overrides)
    (artifact / "manifest.json").write_text(
        json.dumps(payload),
        encoding="utf-8",
    )
    return checkpoint


def test_manifest_requires_trained_hash_matched_artifact(tmp_path) -> None:
    _write_manifest(tmp_path)
    config = load_model_config(_config_path())

    manifest = load_manifest(
        tmp_path,
        config,
        config_path=_config_path(),
        allow_research=False,
    )

    assert manifest.model_id == MODEL_ID
    assert manifest.trained is True
    assert manifest.tokenizer_sha256 == TOKENIZER_SHA256


def test_pointer_switch_after_validation_cannot_change_loaded_checkpoint(
    tmp_path,
    monkeypatch,
) -> None:
    import app.ml.checkpoint as checkpoint_module

    source_a = tmp_path / "source-a"
    source_b = tmp_path / "source-b"
    _write_manifest(source_a)
    _write_manifest(source_b)
    model_directory = tmp_path / "active"
    artifact_root = model_directory / MODEL_ID
    versions = artifact_root / ARTIFACT_VERSIONS_DIRECTORY
    version_a = "a" * 64
    version_b = "b" * 64
    shutil.copytree(source_a / MODEL_ID, versions / version_a)
    shutil.copytree(source_b / MODEL_ID, versions / version_b)
    pointer = artifact_root / ARTIFACT_POINTER_FILE
    pointer.write_text(
        json.dumps({"schemaVersion": 1, "artifactVersion": version_a}),
        encoding="utf-8",
    )
    config = load_model_config(_config_path())
    validated = load_validated_checkpoint(
        model_directory,
        config,
        config_path=_config_path(),
        allow_research=False,
    )

    pointer.write_text(
        json.dumps({"schemaVersion": 1, "artifactVersion": version_b}),
        encoding="utf-8",
    )
    loaded_paths: list[Path] = []

    class FakeSafetensors:
        @staticmethod
        def load_file(path, *, device):
            assert device == "cpu"
            loaded_paths.append(Path(path))
            return {}

    class FakeModel:
        def load_state_dict(self, _state, *, strict):
            assert strict is True

        def to(self, device):
            assert device == "cpu"

        def eval(self):
            return None

    monkeypatch.setattr(
        checkpoint_module.importlib,
        "import_module",
        lambda _name: FakeSafetensors,
    )

    load_weights(FakeModel(), validated, device="cpu")

    assert validated.artifact_directory == (versions / version_a).resolve()
    assert loaded_paths[0].parent == (versions / version_a).resolve()


def test_manifest_rejects_checksum_and_unknown_fields(tmp_path) -> None:
    checkpoint = _write_manifest(tmp_path, unexpected=True)
    config = load_model_config(_config_path())
    with pytest.raises(CheckpointInvalidError):
        load_manifest(
            tmp_path,
            config,
            config_path=_config_path(),
            allow_research=False,
        )

    payload_path = tmp_path / MODEL_ID / "manifest.json"
    payload = json.loads(payload_path.read_text())
    payload.pop("unexpected")
    payload_path.write_text(json.dumps(payload), encoding="utf-8")
    checkpoint.write_bytes(b"tampered")
    with pytest.raises(CheckpointInvalidError, match="checksum"):
        load_manifest(
            tmp_path,
            config,
            config_path=_config_path(),
            allow_research=False,
        )


def test_manifest_rejects_empty_or_unusable_precision_contracts(tmp_path) -> None:
    _write_manifest(
        tmp_path,
        supportedPrecisions={
            "cuda": [],
            "mps": ["float32"],
            "cpu": ["float32"],
        },
    )
    config = load_model_config(_config_path())
    with pytest.raises(CheckpointInvalidError, match="manifest is invalid"):
        load_manifest(
            tmp_path,
            config,
            config_path=_config_path(),
            allow_research=False,
        )

    _write_manifest(
        tmp_path,
        supportedPrecisions={
            "cuda": ["float32"],
            "mps": ["float32"],
            "cpu": ["bfloat16"],
        },
    )
    manifest = load_manifest(
        tmp_path,
        config,
        config_path=_config_path(),
        allow_research=False,
    )
    with pytest.raises(CheckpointUnavailableError, match="usable cpu precision"):
        _select_dtype(object(), "cpu", manifest)


def test_untrained_and_research_only_are_not_silently_available(tmp_path) -> None:
    _write_manifest(tmp_path, trained=False)
    config = load_model_config(_config_path())
    with pytest.raises(CheckpointUnavailableError, match="untrained"):
        load_manifest(
            tmp_path,
            config,
            config_path=_config_path(),
            allow_research=False,
        )

    _write_manifest(tmp_path, evaluationStatus="researchOnly")
    with pytest.raises(CheckpointUnavailableError, match="research mode"):
        load_manifest(
            tmp_path,
            config,
            config_path=_config_path(),
            allow_research=False,
        )
    assert load_manifest(
        tmp_path,
        config,
        config_path=_config_path(),
        allow_research=True,
    ).evaluation_status == "researchOnly"


def test_newer_app_and_different_pytorch_family_are_rejected(tmp_path) -> None:
    _write_manifest(tmp_path, minimumAppVersion="999.0.0")
    config = load_model_config(_config_path())
    with pytest.raises(CheckpointUnavailableError, match="newer application"):
        load_manifest(
            tmp_path,
            config,
            config_path=_config_path(),
            allow_research=False,
        )

    _write_manifest(tmp_path)
    manifest = load_manifest(
        tmp_path,
        config,
        config_path=_config_path(),
        allow_research=False,
    )
    with pytest.raises(CheckpointUnavailableError, match="major/minor"):
        validate_pytorch_compatibility(manifest, "2.12.1")
