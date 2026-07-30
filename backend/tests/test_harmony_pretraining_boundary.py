"""The serving path must not accept weights trained at a different objective.

Harmony-only pre-training produces a checkpoint for the same architecture, the
same tokenizer, and the same config. Every structural check the loader performs
passes on it. The declared task is the only thing that separates a model which
can harmonize a melody from one which has never been conditioned on a melody at
all, so these tests pin two properties: the objective must be declarable, and
declaring it must keep the artifact out of inference.
"""

from __future__ import annotations

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
    CheckpointUnavailableError,
    load_manifest,
)
from app.ml.contracts import MODEL_ID, load_model_config
from app.ml.dataset import DATA_MANIFEST_FILE
from tests.test_harmony_checkpoint import _config_path, _write_manifest
from tests.test_training_dataset import (
    _compile,
    _compile_harmony_only,
    _harmony_only_record,
    _record,
    _write_minimal_safetensors,
    _write_training_run,
)


def _staged_artifact(tmp_path, compiled):
    """Lay out one exportable artifact directory against a compiled dataset."""

    artifact = tmp_path / "models" / MODEL_ID
    artifact.mkdir(parents=True)
    checkpoint = artifact / CHECKPOINT_FILE
    _write_minimal_safetensors(checkpoint)
    validate_safetensors_file(checkpoint)
    training_run_path = _write_training_run(
        artifact / "source-training-run.json",
        compiled / DATA_MANIFEST_FILE,
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
    assert PRETRAINING_TASK in str(manifest["unavailableReason"])


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
        )


def test_a_harmony_only_dataset_exports_the_pretraining_task(tmp_path) -> None:
    compiled, _ = _compile_harmony_only(
        tmp_path,
        [_harmony_only_record("first", source_id="fixture-a")],
        "harmony-only",
    )
    artifact, training_run_path = _staged_artifact(tmp_path, compiled)
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
