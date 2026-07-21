"""Optional native GPU integration test with an explicit no-GPU skip."""

import pytest

from app.schemas.api import RankCandidate
from app.services.device import detect_device
from app.services.models import ModelManager


def test_auto_backend_executes_on_a_native_accelerator_when_available() -> None:
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

    manager = ModelManager("auto")
    outcome = manager.rank(
        None,
        [RankCandidate(id="gpu-smoke", features={"fit": 1.0})],
        {},
        batch_size=1,
        allow_cpu_fallback=True,
    )

    assert manager.active_model != "local-deterministic-v1"
    assert outcome.runtime in {"cuda", "mps", "coreml", "directml"}
    assert len(outcome.ranked) == 1
