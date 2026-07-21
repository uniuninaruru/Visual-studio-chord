from app.schemas.api import RankCandidate
from app.services import models
from app.services.device import DeviceInfo
from app.services.runtime import (
    AcceleratorOutOfMemoryError,
    BackendHealth,
    ModelUnavailableError,
)


class _FakeRuntime:
    model_id = "local-onnx-v1"
    backend_kind = "onnx"
    mock = False

    def __init__(self, runtime_device: str) -> None:
        self.device = runtime_device
        self._loaded = False

    def load(self) -> None:
        self._loaded = True

    def score_batch(self, candidates: list[RankCandidate]) -> list[float]:
        return [float(candidate.features.get("fit", 0.0)) for candidate in candidates]

    def clear_accelerator_cache(self) -> None:
        return None

    def move_to_cpu(self) -> None:
        self.device = "cpu"

    def restore_preferred_device(self) -> None:
        return None

    def unload(self) -> None:
        self._loaded = False

    def health(self) -> BackendHealth:
        return BackendHealth(
            healthy=self._loaded,
            loaded=self._loaded,
            model_id=self.model_id,
            backend=self.backend_kind,
            device=self.device,
            mock=self.mock,
        )


class _UnrestorableOomRuntime(_FakeRuntime):
    def score_batch(self, candidates: list[RankCandidate]) -> list[float]:
        if self.device == "cuda":
            raise AcceleratorOutOfMemoryError
        return [0.0] * len(candidates)


def _device(**overrides) -> DeviceInfo:
    values = {
        "selectedDevice": "cpu",
        "torchAvailable": False,
        "onnxRuntimeAvailable": False,
        "cudaAvailable": False,
        "torchCudaAvailable": False,
        "onnxCudaAvailable": False,
        "mpsAvailable": False,
        "coremlAvailable": False,
        "directmlAvailable": False,
        "deviceName": "CPU",
        "cudaDeviceCount": 0,
    }
    values.update(overrides)
    return DeviceInfo(**values)


def test_auto_prefers_gpu_onnx_and_caches_it(monkeypatch) -> None:
    calls: list[str] = []
    coreml_device = _device(
        selectedDevice="coreml",
        onnxRuntimeAvailable=True,
        coremlAvailable=True,
        deviceName="Apple Core ML",
    )
    monkeypatch.setattr(models, "detect_device", lambda: coreml_device)
    monkeypatch.setattr(models, "_module_available", lambda name: name == "onnxruntime")

    def load_runtime(self, model_id):
        calls.append(model_id)
        return _FakeRuntime("coreml")

    monkeypatch.setattr(models.ModelManager, "_load_optional_runtime", load_runtime)

    manager = models.ModelManager("auto")
    manager.load(models.ONNX_MODEL_ID)

    assert manager.active_model == models.ONNX_MODEL_ID
    assert manager.cache_size == 1
    assert calls == [models.ONNX_MODEL_ID]


def test_auto_prefers_mps_over_coreml(monkeypatch) -> None:
    accelerated = _device(
        selectedDevice="mps",
        torchAvailable=True,
        onnxRuntimeAvailable=True,
        mpsAvailable=True,
        coremlAvailable=True,
        deviceName="Apple Metal (MPS)",
    )
    monkeypatch.setattr(models, "detect_device", lambda: accelerated)
    monkeypatch.setattr(models, "_module_available", lambda name: True)

    def load_runtime(self, model_id):
        return _FakeRuntime("mps")

    monkeypatch.setattr(models.ModelManager, "_load_optional_runtime", load_runtime)

    manager = models.ModelManager("auto")

    assert manager.active_model == models.MLP_MODEL_ID
    assert manager.model_info(models.MLP_MODEL_ID, accelerated).runtime == "mps"
    assert manager.fallback_reason is None


def test_auto_rejects_onnx_provider_that_silently_fell_back_to_cpu(monkeypatch) -> None:
    accelerated = _device(
        selectedDevice="cuda",
        torchAvailable=True,
        onnxRuntimeAvailable=True,
        cudaAvailable=True,
        torchCudaAvailable=True,
        onnxCudaAvailable=True,
        deviceName="CUDA device",
    )
    calls: list[str] = []
    monkeypatch.setattr(models, "detect_device", lambda: accelerated)
    monkeypatch.setattr(models, "_module_available", lambda name: True)

    def load_runtime(self, model_id):
        calls.append(model_id)
        return _FakeRuntime("cpu" if model_id == models.ONNX_MODEL_ID else "cuda")

    monkeypatch.setattr(models.ModelManager, "_load_optional_runtime", load_runtime)

    manager = models.ModelManager("auto")

    assert calls == [models.ONNX_MODEL_ID, models.MLP_MODEL_ID]
    assert manager.active_model == models.MLP_MODEL_ID
    assert manager.fallback_reason == "OnnxAutoLoadFailedMlpFallback"


def test_auto_uses_linear_when_only_cpu_is_available(monkeypatch) -> None:
    monkeypatch.setattr(models, "detect_device", lambda: _device())
    monkeypatch.setattr(models, "_module_available", lambda name: False)

    manager = models.ModelManager("auto")

    assert manager.active_model == models.LOCAL_MODEL_ID
    assert manager.cache_size == 0
    assert manager.fallback_reason is None


def test_windows_cuda_has_priority_over_directml(monkeypatch) -> None:
    windows_device = _device(
        selectedDevice="cuda",
        torchAvailable=True,
        onnxRuntimeAvailable=True,
        cudaAvailable=True,
        torchCudaAvailable=True,
        directmlAvailable=True,
        deviceName="CUDA device",
    )
    calls: list[str] = []
    monkeypatch.setattr(models, "detect_device", lambda: windows_device)
    monkeypatch.setattr(models, "_module_available", lambda name: True)

    def load_runtime(self, model_id):
        calls.append(model_id)
        runtime = _FakeRuntime("cuda" if model_id == models.MLP_MODEL_ID else "directml")
        runtime.backend_kind = "pytorch" if model_id == models.MLP_MODEL_ID else "onnx"
        return runtime

    monkeypatch.setattr(models.ModelManager, "_load_optional_runtime", load_runtime)

    manager = models.ModelManager("auto")

    assert calls == [models.MLP_MODEL_ID]
    assert manager.active_model == models.MLP_MODEL_ID


def test_mlp_never_receives_onnx_only_device_names(monkeypatch) -> None:
    directml_device = _device(
        selectedDevice="directml",
        torchAvailable=True,
        onnxRuntimeAvailable=True,
        directmlAvailable=True,
        deviceName="Windows DirectML",
    )
    captured: list[str] = []
    monkeypatch.setattr(models, "detect_device", lambda: directml_device)
    monkeypatch.setattr(models, "import_torch", lambda: object())

    def make_runtime(torch, runtime_device):
        captured.append(runtime_device)
        return _FakeRuntime(runtime_device)

    monkeypatch.setattr(models, "TorchPairwiseRuntime", make_runtime)

    manager = models.ModelManager("mlp")

    assert manager.active_model == models.MLP_MODEL_ID
    assert captured == ["cpu"]
    assert manager.model_info(models.MLP_MODEL_ID, directml_device).runtime == "cpu"


def test_explicit_missing_optional_model_falls_back_without_breaking_startup(
    monkeypatch,
) -> None:
    def unavailable(self, model_id):
        raise ModelUnavailableError("missing optional dependency")

    monkeypatch.setattr(models.ModelManager, "_load_optional_runtime", unavailable)

    manager = models.ModelManager("onnx")

    assert manager.active_model == models.LOCAL_MODEL_ID
    assert manager.fallback_reason == "onnxUnavailableCpuFallback"


def test_successful_explicit_rank_clears_stale_startup_fallback(monkeypatch) -> None:
    def unavailable(self, model_id):
        raise ModelUnavailableError("missing optional dependency")

    monkeypatch.setattr(models.ModelManager, "_load_optional_runtime", unavailable)
    manager = models.ModelManager("onnx")

    outcome = manager.rank(
        models.LOCAL_MODEL_ID,
        [RankCandidate(id="one")],
        {},
        batch_size=1,
        allow_cpu_fallback=True,
    )

    assert outcome.backend == "linear"
    assert manager.fallback_reason is None


def test_mock_backend_load_and_unload_lifecycle() -> None:
    manager = models.ModelManager("mock-deterministic")
    device = _device()

    loaded = manager.model_info(models.MOCK_MODEL_ID, device)
    manager.unload(models.MOCK_MODEL_ID)
    unloaded = manager.model_info(models.MOCK_MODEL_ID, device)

    assert loaded.loaded is True
    assert loaded.backend == "mock"
    assert loaded.mock is True
    assert unloaded.loaded is False
    assert manager.active_model == models.LOCAL_MODEL_ID


def test_optional_ranker_uses_cached_runtime_and_bounded_batches(monkeypatch) -> None:
    calls = 0

    def load_runtime(self, model_id):
        nonlocal calls
        calls += 1
        return _FakeRuntime("directml")

    monkeypatch.setattr(models.ModelManager, "_load_optional_runtime", load_runtime)
    manager = models.ModelManager("linear")
    candidates = [
        RankCandidate(id="b", features={"fit": 0.25}),
        RankCandidate(id="a", features={"fit": 1.0}),
    ]

    first = manager.rank(
        models.ONNX_MODEL_ID,
        candidates,
        {},
        batch_size=1,
        allow_cpu_fallback=True,
    )
    second = manager.rank(
        models.ONNX_MODEL_ID,
        candidates,
        {},
        batch_size=1,
        allow_cpu_fallback=True,
    )

    assert calls == 1
    assert [candidate.id for candidate in first.ranked] == ["a", "b"]
    assert first.device == "directml"
    assert first.batch_size == 1
    assert second.ranked == first.ranked


def test_failed_accelerator_restore_keeps_fallback_explanation(monkeypatch) -> None:
    monkeypatch.setattr(
        models.ModelManager,
        "_load_optional_runtime",
        lambda self, model_id: _UnrestorableOomRuntime("cuda"),
    )
    manager = models.ModelManager("linear")
    candidates = [RankCandidate(id="one")]

    first = manager.rank(
        models.ONNX_MODEL_ID,
        candidates,
        {},
        batch_size=1,
        allow_cpu_fallback=True,
    )
    second = manager.rank(
        None,
        candidates,
        {},
        batch_size=1,
        allow_cpu_fallback=True,
    )

    assert first.fallback_reason == "cudaOomCpuFallback"
    assert second.runtime == "cpu"
    assert manager.fallback_reason == "cudaOomCpuFallback"


def test_service_layer_rejects_non_allowlisted_ids() -> None:
    manager = models.ModelManager("linear")

    try:
        manager.model_info("../../unsafe.pkl", _device())
    except ModelUnavailableError as exc:
        assert str(exc) == "Unknown model id"
    else:
        raise AssertionError("non-allowlisted id was accepted")
