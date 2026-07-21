from types import SimpleNamespace

from app.services import device


def test_missing_torch_falls_back_to_cpu(monkeypatch) -> None:
    def missing_torch():
        raise ImportError

    monkeypatch.setattr(device, "_import_torch", missing_torch)
    device.detect_device.cache_clear()

    result = device.detect_device()

    assert result.selected_device == "cpu"
    assert result.torch_available is False
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
    device.detect_device.cache_clear()

    result = device.detect_device()

    assert result.selected_device == "cuda"
    assert result.cuda_available is True
    assert result.device_name == "Test GPU"
    assert result.cuda_device_count == 2
    assert result.total_memory_mb == 8192


def teardown_module() -> None:
    device.detect_device.cache_clear()
