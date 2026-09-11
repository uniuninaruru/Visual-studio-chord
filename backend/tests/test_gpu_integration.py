"""Optional native GPU integration test with an explicit no-GPU skip."""

import json

import pytest

from app.schemas.api import RankCandidate
from app.services.device import detect_device
from app.services.models import ModelManager

CORPUS_MODEL_ID = "harmony-corpus-ngram-v1"
THEORY_MODEL_ID = "local-deterministic-v1"


def _requires_accelerator() -> None:
    detect_device.cache_clear()
    device = detect_device()
    accelerated = any(
        (
            device.torch_cuda_available,
            device.mps_available,
            device.onnx_cuda_available,
            device.coreml_available,
            device.directml_available,
        )
    )
    if not accelerated:
        pytest.skip("GPU integration skipped: no supported native accelerator runtime")


def _write_corpus(model_directory) -> None:
    model_directory.mkdir(parents=True, exist_ok=True)
    (model_directory / "harmony-corpus-v1.json").write_text(
        json.dumps(
            {
                "modelId": CORPUS_MODEL_ID,
                "modelVersion": "test",
                "schemaVersion": 1,
                "orders": {"1": {"0:major": 4, "7:major": 2}},
            }
        ),
        encoding="utf-8",
    )


def test_auto_reaches_a_native_accelerator_when_no_corpus_is_installed(tmp_path) -> None:
    """Without a corpus, `auto` must actually use the accelerator it detected.

    This is the guarantee the acceleration setup scripts, the CUDA image and the
    device diagnostics exist to deliver, so it is asserted on the machines that
    can observe it.
    """

    _requires_accelerator()

    manager = ModelManager("auto", model_directory=tmp_path / "empty-models")
    outcome = manager.rank(
        None,
        [RankCandidate(id="gpu-smoke", features={"fit": 1.0})],
        {},
        batch_size=1,
        allow_cpu_fallback=True,
    )

    assert manager.active_model != THEORY_MODEL_ID
    assert outcome.runtime in {"cuda", "mps", "coreml", "directml"}
    assert len(outcome.ranked) == 1


def test_auto_ignores_legacy_corpus_when_an_accelerator_is_installed(
    tmp_path,
) -> None:
    """A legacy corpus file must not make `auto` fall back to CPU ranking.

    Corpus use is an explicit research choice. The default still follows the
    detected accelerator path even when the retired POP909 artifact is present.
    """

    _requires_accelerator()

    model_directory = tmp_path / "models"
    _write_corpus(model_directory)

    manager = ModelManager("auto", model_directory=model_directory)
    outcome = manager.rank(
        None,
        [RankCandidate(id="corpus-smoke", features={"fit": 1.0})],
        {},
        batch_size=1,
        allow_cpu_fallback=True,
    )

    assert manager.active_model != CORPUS_MODEL_ID
    assert outcome.runtime in {"cuda", "mps", "coreml", "directml"}
    assert outcome.fallback_reason is None
    assert len(outcome.ranked) == 1
