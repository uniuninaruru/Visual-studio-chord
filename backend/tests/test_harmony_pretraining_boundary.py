"""The serving path must not accept weights trained at a different objective.

Harmony-only pre-training produces a checkpoint for the same architecture, the
same tokenizer, and the same config. Every structural check the loader performs
passes on it. The declared task is the only thing that separates a model which
can harmonize a melody from one which has never been conditioned on a melody at
all, so these tests pin two properties: the objective must be declarable, and
declaring it must keep the artifact out of inference.
"""

from __future__ import annotations

import json

import pytest

from app.ml.artifacts import (
    ArtifactExportError,
    publish_checkpoint_manifest,
    validate_safetensors_file,
)
from app.ml.backends.torch_backend import TorchHarmonyBackend
from app.ml.checkpoint import (
    CHECKPOINT_FILE,
    INFERENCE_TASK,
    PRETRAINING_TASK,
    CheckpointInvalidError,
    CheckpointUnavailableError,
    load_manifest,
)
from app.ml.contracts import MODEL_ID, load_model_config
from app.ml.dataset import DATA_MANIFEST_FILE
from app.ml.training_runtime import (
    TrainingRuntimeError,
    evaluate_checkpoint,
    load_initial_checkpoint_for_training,
)
from tests.test_harmony_checkpoint import _config_path, _sha256, _write_manifest
from tests.test_training_dataset import (
    _compile,
    _compile_harmony_only,
    _harmony_only_record,
    _record,
    _write_minimal_safetensors,
    _write_training_run,
)


def _staged_artifact(tmp_path, compiled, *, task=INFERENCE_TASK):
    """Lay out one exportable artifact directory against a compiled dataset."""

    artifact = tmp_path / "models" / MODEL_ID
    artifact.mkdir(parents=True)
    checkpoint = artifact / CHECKPOINT_FILE
    _write_minimal_safetensors(checkpoint)
    validate_safetensors_file(checkpoint)
    training_run_path = _write_training_run(
        artifact / "source-training-run.json",
        compiled / DATA_MANIFEST_FILE,
        task=task,
    )
    return artifact, training_run_path


def test_pretraining_objective_is_expressible_in_a_manifest() -> None:
    """Without a second permitted value the only loadable manifest is a lie.

    A harmony-only checkpoint would have to declare the melody-conditioned task
    to be written at all, which is the failure this whole boundary exists to
    prevent. The vocabulary has to come first.
    """

    assert PRETRAINING_TASK != INFERENCE_TASK


def test_inference_rejects_a_harmony_only_checkpoint(tmp_path) -> None:
    _write_manifest(tmp_path, task=PRETRAINING_TASK)
    config = load_model_config(_config_path())

    with pytest.raises(CheckpointUnavailableError) as error:
        load_manifest(
            tmp_path,
            config,
            config_path=_config_path(),
            allow_research=False,
        )

    assert PRETRAINING_TASK in str(error.value)


def test_research_mode_does_not_open_the_task_boundary(tmp_path) -> None:
    """The decisive property: the two gates are independent.

    `MTC_ENABLE_RESEARCH_CHECKPOINT` exists to admit a checkpoint that is not
    yet validated *at the inference task*. If it also admitted checkpoints
    trained at another task, one environment variable would put a model that
    cannot harmonize a melody behind an interface that says it can.
    """

    _write_manifest(tmp_path, task=PRETRAINING_TASK, evaluationStatus="researchOnly")
    config = load_model_config(_config_path())

    for allow_research in (False, True):
        with pytest.raises(CheckpointUnavailableError):
            load_manifest(
                tmp_path,
                config,
                config_path=_config_path(),
                allow_research=allow_research,
            )


def test_relabelling_only_the_manifest_cannot_hide_pretraining_provenance(
    tmp_path,
) -> None:
    _write_manifest(tmp_path, task=PRETRAINING_TASK)
    manifest_path = tmp_path / MODEL_ID / "manifest.json"
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    payload["task"] = INFERENCE_TASK
    manifest_path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(CheckpointInvalidError, match="task disagrees"):
        load_manifest(
            tmp_path,
            load_model_config(_config_path()),
            config_path=_config_path(),
            allow_research=True,
        )


def test_training_run_task_mismatch_is_rejected(tmp_path) -> None:
    _write_manifest(tmp_path, task=INFERENCE_TASK)
    artifact = tmp_path / MODEL_ID
    training_run_path = artifact / "training-run.json"
    training_run = json.loads(training_run_path.read_text(encoding="utf-8"))
    training_run["task"] = PRETRAINING_TASK
    training_run_path.write_text(json.dumps(training_run), encoding="utf-8")
    manifest_path = artifact / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["trainingRunSha256"] = _sha256(training_run_path)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(CheckpointInvalidError, match="task disagrees"):
        load_manifest(
            tmp_path,
            load_model_config(_config_path()),
            config_path=_config_path(),
            allow_research=True,
        )


def test_impossible_initial_checkpoint_transition_is_rejected(tmp_path) -> None:
    _write_manifest(tmp_path, task=PRETRAINING_TASK)
    artifact = tmp_path / MODEL_ID
    training_run_path = artifact / "training-run.json"
    training_run = json.loads(training_run_path.read_text(encoding="utf-8"))
    training_run["initialCheckpoint"] = {
        "modelId": MODEL_ID,
        "task": INFERENCE_TASK,
        "manifestSha256": "c" * 64,
        "checkpointSha256": "d" * 64,
    }
    training_run_path.write_text(json.dumps(training_run), encoding="utf-8")
    manifest_path = artifact / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["trainingRunSha256"] = _sha256(training_run_path)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(
        CheckpointInvalidError,
        match="provenance contract",
    ) as error:
        load_manifest(
            tmp_path,
            load_model_config(_config_path()),
            config_path=_config_path(),
            allow_research=True,
            permit_pretraining_task=True,
        )
    assert isinstance(error.value.__cause__, CheckpointInvalidError)
    assert "task transition" in str(error.value.__cause__)


def test_a_validated_pretraining_artifact_is_still_rejected(tmp_path) -> None:
    """Evaluation status cannot substitute for the right objective.

    A pre-training checkpoint can legitimately be evaluated and marked
    `validated` on the objective it was trained for. That says nothing about
    melody-conditioned harmonization, so it must not be a route in.
    """

    _write_manifest(tmp_path, task=PRETRAINING_TASK, evaluationStatus="validated")
    config = load_model_config(_config_path())

    with pytest.raises(CheckpointUnavailableError):
        load_manifest(
            tmp_path,
            config,
            config_path=_config_path(),
            allow_research=True,
        )


def test_training_and_export_paths_may_load_a_pretraining_checkpoint(
    tmp_path,
) -> None:
    """The boundary must not make pre-trained weights useless.

    Warm-starting and evaluating them is the entire point of producing them;
    only the serving path is closed.
    """

    _write_manifest(tmp_path, task=PRETRAINING_TASK)
    config = load_model_config(_config_path())

    manifest = load_manifest(
        tmp_path,
        config,
        config_path=_config_path(),
        allow_research=True,
        permit_pretraining_task=True,
    )

    assert manifest.task == PRETRAINING_TASK


def test_inference_training_can_explicitly_warm_start_pretraining_weights(
    tmp_path,
    monkeypatch,
) -> None:
    _write_manifest(tmp_path, task=PRETRAINING_TASK)
    loaded = []
    monkeypatch.setattr(
        "app.ml.training_runtime.load_weights",
        lambda model, checkpoint, *, device: loaded.append(
            (model, checkpoint.manifest.task, device)
        ),
    )
    model = object()

    provenance = load_initial_checkpoint_for_training(
        model,
        model_directory=tmp_path,
        config=load_model_config(_config_path()),
        config_path=_config_path(),
        destination_task=INFERENCE_TASK,
        device="cpu",
        pytorch_version="2.13.0",
    )

    assert loaded == [(model, PRETRAINING_TASK, "cpu")]
    assert provenance["task"] == PRETRAINING_TASK
    assert len(provenance["manifestSha256"]) == 64
    assert len(provenance["checkpointSha256"]) == 64


def test_inference_weights_cannot_be_relabelled_as_pretraining(
    tmp_path,
    monkeypatch,
) -> None:
    _write_manifest(tmp_path, task=INFERENCE_TASK)
    monkeypatch.setattr(
        "app.ml.training_runtime.load_weights",
        lambda *_args, **_kwargs: pytest.fail("weights must not be loaded"),
    )

    with pytest.raises(TrainingRuntimeError, match="cannot warm-start"):
        load_initial_checkpoint_for_training(
            object(),
            model_directory=tmp_path,
            config=load_model_config(_config_path()),
            config_path=_config_path(),
            destination_task=PRETRAINING_TASK,
            device="cpu",
            pytorch_version="2.13.0",
        )


def test_evaluation_receipt_preserves_warm_start_lineage(
    tmp_path,
    monkeypatch,
) -> None:
    _write_manifest(tmp_path, task=INFERENCE_TASK)
    artifact = tmp_path / MODEL_ID
    training_run_path = artifact / "training-run.json"
    training_run = json.loads(training_run_path.read_text(encoding="utf-8"))
    initial_checkpoint = {
        "modelId": MODEL_ID,
        "task": PRETRAINING_TASK,
        "manifestSha256": "c" * 64,
        "checkpointSha256": "d" * 64,
    }
    training_run["initialCheckpoint"] = initial_checkpoint
    training_run_path.write_text(json.dumps(training_run), encoding="utf-8")
    manifest_path = artifact / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["trainingRunSha256"] = _sha256(training_run_path)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    data_manifest_path = artifact / DATA_MANIFEST_FILE

    class FakeTorch:
        __version__ = "2.13.0"

    class FakeDatasetSnapshot:
        manifest = {}
        manifest_sha256 = _sha256(data_manifest_path)

        @staticmethod
        def rows(_split):
            return ({},)

    monkeypatch.setattr(
        "app.ml.training_runtime.load_compiled_dataset_snapshot",
        lambda _path: FakeDatasetSnapshot(),
    )
    monkeypatch.setattr(
        "app.ml.training_runtime.validate_compiled_rows",
        lambda _rows, _config: None,
    )
    monkeypatch.setattr(
        "app.ml.training_runtime._import_torch",
        lambda: FakeTorch(),
    )
    monkeypatch.setattr(
        "app.ml.training_runtime._select_device",
        lambda _torch, _choice: ("cpu", None),
    )
    monkeypatch.setattr(
        "app.ml.training_runtime.build_harmony_forge_model",
        lambda _config, *, torch_module: object(),
    )
    monkeypatch.setattr(
        "app.ml.training_runtime.load_weights",
        lambda _model, _checkpoint, *, device: None,
    )
    monkeypatch.setattr(
        "app.ml.training_runtime.evaluate_model_rows",
        lambda *_args, **_kwargs: {"meanActiveHeadNll": 0.5},
    )

    receipt = evaluate_checkpoint(
        config_path=_config_path(),
        data_manifest_path=data_manifest_path,
        model_directory=tmp_path,
        split="validation",
    )

    assert receipt["task"] == INFERENCE_TASK
    assert receipt["initialCheckpoint"] == initial_checkpoint


def test_melody_conditioned_checkpoints_still_load(tmp_path) -> None:
    _write_manifest(tmp_path, task=INFERENCE_TASK)
    config = load_model_config(_config_path())

    manifest = load_manifest(
        tmp_path,
        config,
        config_path=_config_path(),
        allow_research=False,
    )

    assert manifest.task == INFERENCE_TASK


def test_serving_backend_reports_a_pretraining_artifact_as_unavailable(
    tmp_path,
) -> None:
    """Exercised through the real serving entry point, not the loader alone.

    `TorchHarmonyBackend` is what `main.py` constructs, and it is built here the
    way the most permissive configuration builds it — `allow_research=True`,
    which is all `MTC_ENABLE_RESEARCH_CHECKPOINT=1` does. The backend never
    forwards `permit_pretraining_task`, so no setting reaches the argument and
    the artifact stays out.
    """

    model_directory = tmp_path / "models"
    model_directory.mkdir()
    _write_manifest(model_directory, task=PRETRAINING_TASK)
    backend = TorchHarmonyBackend(
        model_directory=model_directory,
        config_path=_config_path(),
        allow_research=True,
    )

    manifest = backend.manifest()

    assert manifest["available"] is False
    assert manifest["task"] == PRETRAINING_TASK
    assert manifest["trained"] is True
    assert manifest["evaluationStatus"] == "validated"
    assert isinstance(manifest["checkpointSha256"], str)
    assert "installed and valid" in str(manifest["unavailableReason"])
    assert backend._cached_validated_checkpoint is None


def test_serving_does_not_claim_a_tampered_pretraining_checkpoint_is_valid(
    tmp_path,
) -> None:
    model_directory = tmp_path / "models"
    model_directory.mkdir()
    checkpoint_path = _write_manifest(
        model_directory,
        task=PRETRAINING_TASK,
    )
    checkpoint_path.write_bytes(b"tampered-after-manifest")
    backend = TorchHarmonyBackend(
        model_directory=model_directory,
        config_path=_config_path(),
        allow_research=True,
    )

    manifest = backend.manifest()

    assert manifest["available"] is False
    assert manifest["task"] == PRETRAINING_TASK
    assert manifest["trained"] is False
    assert manifest["evaluationStatus"] == "notEvaluated"
    assert manifest["checkpointSha256"] is None
    assert "checksum" in str(manifest["unavailableReason"])


def test_serving_backend_accepts_the_inference_task_from_the_same_fixture(
    tmp_path,
) -> None:
    """Pins the rejection above to the task, not to the fixture being broken."""

    model_directory = tmp_path / "models"
    model_directory.mkdir()
    _write_manifest(model_directory, task=INFERENCE_TASK)
    backend = TorchHarmonyBackend(
        model_directory=model_directory,
        config_path=_config_path(),
        allow_research=True,
    )

    manifest = backend.manifest()

    assert manifest["available"] is True
    assert manifest["task"] == INFERENCE_TASK
    assert manifest["modelId"] == MODEL_ID


def test_a_harmony_only_dataset_cannot_export_the_inference_task(tmp_path) -> None:
    """The declared objective is checked against the data, not merely accepted.

    This is the failure that matters most in practice: the export default is the
    inference task, so mislabelling a pre-training run requires no deliberate
    act at all — just omitting an argument. A harmony-only corpus carries no
    melody, so weights trained on it cannot have learned melody-conditioned
    harmonization, and the export says so instead of taking the label on trust.
    """

    compiled, _ = _compile_harmony_only(
        tmp_path,
        [_harmony_only_record("first", source_id="fixture-a")],
        "harmony-only",
    )
    artifact, training_run_path = _staged_artifact(
        tmp_path,
        compiled,
        task=PRETRAINING_TASK,
    )
    config = load_model_config(_config_path())

    with pytest.raises(ArtifactExportError, match="content profile"):
        publish_checkpoint_manifest(
            artifact,
            config=config,
            config_path=_config_path(),
            data_manifest_path=compiled / DATA_MANIFEST_FILE,
            training_run_path=training_run_path,
            source_commit="b" * 40,
            pytorch_version="2.13.0",
        )


def test_a_harmony_only_dataset_exports_the_pretraining_task(tmp_path) -> None:
    compiled, _ = _compile_harmony_only(
        tmp_path,
        [_harmony_only_record("first", source_id="fixture-a")],
        "harmony-only",
    )
    artifact, training_run_path = _staged_artifact(
        tmp_path,
        compiled,
        task=PRETRAINING_TASK,
    )
    config = load_model_config(_config_path())

    exported = publish_checkpoint_manifest(
        artifact,
        config=config,
        config_path=_config_path(),
        data_manifest_path=compiled / DATA_MANIFEST_FILE,
        training_run_path=training_run_path,
        source_commit="b" * 40,
        pytorch_version="2.13.0",
        task=PRETRAINING_TASK,
    )

    assert exported.task == PRETRAINING_TASK


def test_a_melody_corpus_cannot_export_the_pretraining_task(tmp_path) -> None:
    """The check binds in both directions, so the label cannot drift either way."""

    compiled, _ = _compile(tmp_path, [_record("valid")], "compiled")
    artifact, training_run_path = _staged_artifact(tmp_path, compiled)
    config = load_model_config(_config_path())

    with pytest.raises(ArtifactExportError, match="content profile"):
        publish_checkpoint_manifest(
            artifact,
            config=config,
            config_path=_config_path(),
            data_manifest_path=compiled / DATA_MANIFEST_FILE,
            training_run_path=training_run_path,
            source_commit="b" * 40,
            pytorch_version="2.13.0",
            task=PRETRAINING_TASK,
        )
