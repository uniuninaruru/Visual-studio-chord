import math
from types import SimpleNamespace

import pytest

from app.schemas.api import RankCandidate
from app.services.runtime import (
    BUILTIN_ONNX_MODEL_BYTES,
    AcceleratorOutOfMemoryError,
    DeterministicBackend,
    InferenceBackend,
    MockDeterministicBackend,
    ModelUnavailableError,
    OnnxPairwiseRuntime,
    RuntimeInferenceError,
    TorchPairwiseRuntime,
    _message_is_accelerator_oom,
    execute_bounded_batches,
    select_onnx_providers,
    vectorize_features,
)


class _OomThenCpuRuntime:
    def __init__(self, device_name: str = "cuda") -> None:
        self.device = device_name
        self.calls: list[tuple[str, int]] = []
        self.cache_clears = 0

    def score_batch(self, candidates: list[RankCandidate]) -> list[float]:
        self.calls.append((self.device, len(candidates)))
        if self.device != "cpu":
            raise AcceleratorOutOfMemoryError
        return [float(index) for index, _ in enumerate(candidates)]

    def clear_accelerator_cache(self) -> None:
        self.cache_clears += 1

    def move_to_cpu(self) -> None:
        self.device = "cpu"


class _ShrinkableRuntime(_OomThenCpuRuntime):
    def score_batch(self, candidates: list[RankCandidate]) -> list[float]:
        self.calls.append((self.device, len(candidates)))
        if self.device == "cuda" and len(candidates) > 2:
            raise AcceleratorOutOfMemoryError
        return [1.0] * len(candidates)


class _NonFiniteRuntime(_ShrinkableRuntime):
    def score_batch(self, candidates: list[RankCandidate]) -> list[float]:
        return [math.inf] * len(candidates)


def _candidates(count: int) -> list[RankCandidate]:
    return [RankCandidate(id=f"candidate-{index}") for index in range(count)]


def test_cuda_oom_shrinks_then_falls_back_to_cpu() -> None:
    runtime = _OomThenCpuRuntime()

    result = execute_bounded_batches(
        runtime,
        _candidates(4),
        batch_size=4,
        allow_cpu_fallback=True,
    )

    assert runtime.calls == [("cuda", 4), ("cuda", 2), ("cuda", 1), ("cpu", 4)]
    assert runtime.cache_clears == 3
    assert result.device == "cpu"
    assert result.batch_size == 4
    assert result.fallback_reason == "cudaOomCpuFallback"


def test_cuda_oom_can_succeed_after_batch_shrink() -> None:
    runtime = _ShrinkableRuntime()

    result = execute_bounded_batches(
        runtime,
        _candidates(5),
        batch_size=4,
        allow_cpu_fallback=True,
    )

    assert runtime.calls == [("cuda", 4), ("cuda", 2), ("cuda", 2), ("cuda", 1)]
    assert result.device == "cuda"
    assert result.batch_size == 2
    assert result.fallback_reason is None


def test_accelerator_oom_can_disable_cpu_fallback() -> None:
    runtime = _OomThenCpuRuntime("mps")

    with pytest.raises(RuntimeInferenceError, match="accelerator memory"):
        execute_bounded_batches(
            runtime,
            _candidates(2),
            batch_size=2,
            allow_cpu_fallback=False,
        )

    assert runtime.device == "mps"


def test_non_finite_runtime_scores_are_rejected() -> None:
    with pytest.raises(RuntimeInferenceError, match="non-finite"):
        execute_bounded_batches(
            _NonFiniteRuntime("cpu"),
            _candidates(1),
            batch_size=1,
            allow_cpu_fallback=True,
        )


def test_common_accelerator_allocation_errors_trigger_oom_handling() -> None:
    assert _message_is_accelerator_oom(RuntimeError("Failed to allocate memory for tensor"))
    assert _message_is_accelerator_oom(RuntimeError("E_OUTOFMEMORY"))


def test_common_backend_protocol_has_explicit_lifecycle() -> None:
    candidate = RankCandidate(id="one", features={"fit": 1.0})
    for backend in (DeterministicBackend(), MockDeterministicBackend()):
        assert isinstance(backend, InferenceBackend)
        assert backend.health().loaded is False
        backend.load()
        first = backend.score_batch([candidate])
        second = backend.score_batch([candidate])
        assert first == second
        assert backend.health().healthy is True
        backend.unload()
        assert backend.health().loaded is False


def test_provider_priority_is_platform_specific() -> None:
    all_providers = [
        "CPUExecutionProvider",
        "DmlExecutionProvider",
        "CoreMLExecutionProvider",
        "CUDAExecutionProvider",
    ]

    assert select_onnx_providers(all_providers, platform="darwin") == [
        "CUDAExecutionProvider",
        "CoreMLExecutionProvider",
        "CPUExecutionProvider",
    ]
    assert select_onnx_providers(all_providers[0:3], platform="darwin") == [
        "CoreMLExecutionProvider",
        "CPUExecutionProvider",
    ]
    assert select_onnx_providers(all_providers[0:2], platform="win32") == [
        "DmlExecutionProvider",
        "CPUExecutionProvider",
    ]
    assert select_onnx_providers(all_providers[0:3], platform="linux") == [
        "CPUExecutionProvider"
    ]


def test_provider_selection_rejects_unsupported_only() -> None:
    with pytest.raises(ModelUnavailableError):
        select_onnx_providers(["SomeFutureExecutionProvider"], platform="linux")


def test_feature_vectorization_is_stable_and_fixed_size() -> None:
    first = vectorize_features({"cadence": 1.0, "novelty": -0.5})
    second = vectorize_features({"novelty": -0.5, "cadence": 1.0})

    assert first == second
    assert len(first) == 128
    assert any(value != 0 for value in first)


def test_embedded_onnx_model_is_passed_as_bytes_with_native_provider_order() -> None:
    captured: dict[str, object] = {}

    class FakeSession:
        def __init__(self, model: bytes, providers: list[str]) -> None:
            captured["model"] = model
            captured["providers"] = providers

    fake_ort = SimpleNamespace(
        get_available_providers=lambda: ["CoreMLExecutionProvider", "CPUExecutionProvider"],
        InferenceSession=FakeSession,
    )

    runtime = OnnxPairwiseRuntime(fake_ort)
    runtime.load()

    assert len(BUILTIN_ONNX_MODEL_BYTES) == 378
    assert captured["model"] == BUILTIN_ONNX_MODEL_BYTES
    assert captured["providers"] in (
        ["CoreMLExecutionProvider", "CPUExecutionProvider"],
        ["CPUExecutionProvider"],
    )
    assert runtime.device in {"coreml", "cpu"}


def test_onnx_runtime_reports_actual_cpu_fallback_provider() -> None:
    class FakeSession:
        def __init__(self, model: bytes, providers: list[str]) -> None:
            pass

        def get_providers(self) -> list[str]:
            return ["CPUExecutionProvider"]

    fake_ort = SimpleNamespace(
        get_available_providers=lambda: ["CoreMLExecutionProvider", "CPUExecutionProvider"],
        InferenceSession=FakeSession,
    )

    runtime = OnnxPairwiseRuntime(fake_ort)
    runtime.load()

    assert runtime.device == "cpu"


def test_embedded_onnx_model_executes_when_runtime_is_installed() -> None:
    onnxruntime = pytest.importorskip("onnxruntime")
    runtime = OnnxPairwiseRuntime(onnxruntime)
    runtime.load()

    scores = runtime.score_batch(
        [
            RankCandidate(id="a", features={"fit": 1.0}),
            RankCandidate(id="b", features={"fit": -1.0}),
        ]
    )

    assert len(scores) == 2
    assert all(isinstance(score, float) for score in scores)


def test_torch_mlp_executes_on_cpu_when_torch_is_installed() -> None:
    torch = pytest.importorskip("torch")
    runtime = TorchPairwiseRuntime(torch, "cpu")
    runtime.load()
    candidates = [
        RankCandidate(id="a", features={"fit": 1.0}),
        RankCandidate(id="b", features={"fit": -1.0}),
    ]

    first = runtime.score_batch(candidates)
    second = runtime.score_batch(candidates)

    assert first == second
    assert len(first) == 2


def test_torch_load_failure_is_reported_as_optional_runtime_error(monkeypatch) -> None:
    runtime = TorchPairwiseRuntime(SimpleNamespace(), "cuda")

    def broken_model():
        raise RuntimeError("driver initialization failed")

    monkeypatch.setattr(runtime, "_build_model", broken_model)

    with pytest.raises(ModelUnavailableError, match="could not be loaded"):
        runtime.load()
