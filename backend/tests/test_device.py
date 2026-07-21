from types import SimpleNamespace

from app.services import device


def _missing_runtime():
    raise ImportError


def test_missing_optional_runtimes_fall_back_to_cpu(monkeypatch) -> None:
    monkeypatch.setattr(device, "_import_torch", _missing_runtime)
    monkeypatch.setattr(device, "_import_onnxruntime", _missing_runtime)
    device.detect_device.cache_clear()

    result = device.detect_device()

    assert result.selected_device == "cpu"
    assert result.torch_available is False
    assert result.onnx_runtime_available is False
    assert result.cuda_available is False


def test_cuda_is_selected_when_available(monkeypatch) -> None:
    fake_cuda = SimpleNamespace(
        is_available=lambda: True,
        device_count=lambda: 2,
        get_device_name=lambda index: "Test GPU",
        get_device_properties=lambda index: SimpleNamespace(total_memory=8 * 1024**3),
    )
    fake_torch = SimpleNamespace(
        cuda=fake_cuda,
        backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False)),
    )
    monkeypatch.setattr(device, "_import_torch", lambda: fake_torch)
    monkeypatch.setattr(device, "_import_onnxruntime", _missing_runtime)
    device.detect_device.cache_clear()

    result = device.detect_device()

    assert result.selected_device == "cuda"
    assert result.cuda_available is True
    assert result.torch_cuda_available is True
    assert result.device_name == "Test GPU"
    assert result.cuda_device_count == 2
    assert result.total_memory_mb == 8192


def test_mps_has_priority_over_coreml_on_macos(monkeypatch) -> None:
    fake_torch = SimpleNamespace(
        cuda=SimpleNamespace(is_available=lambda: False),
        backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: True)),
    )
    fake_ort = SimpleNamespace(
        get_available_providers=lambda: [
            "CoreMLExecutionProvider",
            "CPUExecutionProvider",
        ]
    )
    monkeypatch.setattr(device, "_import_torch", lambda: fake_torch)
    monkeypatch.setattr(device, "_import_onnxruntime", lambda: fake_ort)
    monkeypatch.setattr(device.sys, "platform", "darwin")
    device.detect_device.cache_clear()

    result = device.detect_device()

    assert result.selected_device == "mps"
    assert result.mps_available is True
    assert result.coreml_available is True
    assert device.selected_torch_device(result) == "mps"


def test_coreml_is_selected_without_torch_mps(monkeypatch) -> None:
    fake_ort = SimpleNamespace(
        get_available_providers=lambda: [
            "CoreMLExecutionProvider",
            "CPUExecutionProvider",
        ]
    )
    monkeypatch.setattr(device, "_import_torch", _missing_runtime)
    monkeypatch.setattr(device, "_import_onnxruntime", lambda: fake_ort)
    monkeypatch.setattr(device.sys, "platform", "darwin")
    device.detect_device.cache_clear()

    result = device.detect_device()

    assert result.selected_device == "coreml"
    assert device.selected_onnx_device(result) == "coreml"
    assert device.selected_torch_device(result) == "cpu"


def test_directml_does_not_leak_into_torch_device_selection(monkeypatch) -> None:
    fake_torch = SimpleNamespace(
        cuda=SimpleNamespace(is_available=lambda: False),
        backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False)),
    )
    fake_ort = SimpleNamespace(
        get_available_providers=lambda: ["DmlExecutionProvider", "CPUExecutionProvider"]
    )
    monkeypatch.setattr(device, "_import_torch", lambda: fake_torch)
    monkeypatch.setattr(device, "_import_onnxruntime", lambda: fake_ort)
    monkeypatch.setattr(device.sys, "platform", "win32")
    device.detect_device.cache_clear()

    result = device.detect_device()

    assert result.selected_device == "directml"
    assert result.directml_available is True
    assert device.selected_onnx_device(result) == "directml"
    assert device.selected_torch_device(result) == "cpu"


def teardown_module() -> None:
    device.detect_device.cache_clear()
