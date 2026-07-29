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


def test_auto_prefers_the_corpus_over_an_accelerator_when_one_is_installed(
    tmp_path,
) -> None:
    """With a corpus present, `auto` takes it and ranks on the CPU.

    That is deliberate: the empirical corpus is trained and the optional
    MLP/ONNX runtimes are not, so the better model wins over the faster device.
    The consequence is worth stating in a test rather than leaving implied,
    because the shipped tree contains a corpus — a machine with a working GPU
    therefore ranks on the CPU under the default preference, and reaching the
    accelerator means asking for it by name.

    The previous version of this file asserted the opposite and only ever ran on
    accelerated machines, so it passed by being skipped on every CI runner.
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

    assert manager.active_model == CORPUS_MODEL_ID
    assert outcome.runtime == "cpu"
    assert outcome.fallback_reason is None
    assert len(outcome.ranked) == 1
