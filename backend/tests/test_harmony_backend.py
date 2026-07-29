from pathlib import Path
from threading import Event

from app.ml.backends.torch_backend import TorchHarmonyBackend


def _backend(tmp_path: Path) -> TorchHarmonyBackend:
    backend = TorchHarmonyBackend(
        model_directory=tmp_path / "models",
        config_path=tmp_path / "config.yaml",
        allow_research=True,
    )
    backend._model = object()
    backend._torch = object()
    backend._device = "cpu"
    return backend


def test_loaded_cpu_model_re_resolves_auto_device_each_request(
    tmp_path,
    monkeypatch,
) -> None:
    backend = _backend(tmp_path)
    moves: list[tuple[str, bool]] = []
    monkeypatch.setattr(
        "app.ml.backends.torch_backend._preferred_device",
        lambda _torch: "cuda",
    )

    def move(requested, *, allow_cpu_fallback):
        moves.append((requested, allow_cpu_fallback))
        backend._device = requested
        backend._fallback_reason = None

    monkeypatch.setattr(backend, "_move_loaded_model", move)

    backend._ensure_loaded(
        preferred_device="auto",
        allow_cpu_fallback=False,
    )

    assert moves == [("cuda", False)]
    assert backend._device == "cuda"


def test_oom_cpu_fallback_is_reprobed_on_next_auto_request(
    tmp_path,
    monkeypatch,
) -> None:
    backend = _backend(tmp_path)
    backend._fallback_reason = "cudaOomCpuFallback"
    moves: list[str] = []
    monkeypatch.setattr(
        "app.ml.backends.torch_backend._preferred_device",
        lambda _torch: "cuda",
    )

    def move(requested, *, allow_cpu_fallback):
        moves.append(requested)
        assert allow_cpu_fallback is True
        backend._device = requested
        backend._fallback_reason = None

    monkeypatch.setattr(backend, "_move_loaded_model", move)

    backend._ensure_loaded(
        preferred_device="auto",
        allow_cpu_fallback=True,
    )

    assert moves == ["cuda"]
    assert backend._fallback_reason is None


def test_generic_accelerator_inference_failure_reloads_clean_cpu(
    tmp_path,
    monkeypatch,
) -> None:
    backend = _backend(tmp_path)
    backend._device = "mps"
    backend._loaded_checkpoint = object()
    clean_cpu = object()
    forwards: list[str] = []

    def forward(_windows, _cancel_event, _on_progress):
        forwards.append(backend._device)
        if len(forwards) == 1:
            raise RuntimeError("MPS operator is not implemented")
        return ["cpu-result"]

    def build(_checkpoint, device):
        assert device == "cpu"
        return clean_cpu, "float32"

    monkeypatch.setattr(backend, "_forward", forward)
    monkeypatch.setattr(backend, "_build_loaded_model", build)
    monkeypatch.setattr(backend, "_clear_cache", lambda **_kwargs: None)

    result = backend._forward_with_cpu_fallback(
        [],
        Event(),
        lambda _stage, _progress: None,
        allow_cpu_fallback=True,
    )

    assert result == ["cpu-result"]
    assert forwards == ["mps", "cpu"]
    assert backend._model is clean_cpu
    assert backend.health().device == "cpu"
    assert backend.health().fallback_reason == "mpsInferenceFailedCpuFallback"


def test_generic_accelerator_failure_does_not_fallback_when_disallowed(
    tmp_path,
    monkeypatch,
) -> None:
    backend = _backend(tmp_path)
    backend._device = "cuda"
    backend._loaded_checkpoint = object()
    reloads = 0

    def fail(_windows, _cancel_event, _on_progress):
        raise RuntimeError("CUDA driver failure")

    def reload_cpu(_reason):
        nonlocal reloads
        reloads += 1

    monkeypatch.setattr(backend, "_forward", fail)
    monkeypatch.setattr(backend, "_reload_clean_cpu", reload_cpu)

    try:
        backend._forward_with_cpu_fallback(
            [],
            Event(),
            lambda _stage, _progress: None,
            allow_cpu_fallback=False,
        )
    except RuntimeError as exc:
        assert str(exc) == "CUDA driver failure"
    else:
        raise AssertionError("accelerator failure should propagate")

    assert reloads == 0


def test_partial_accelerator_move_never_mutates_installed_model(
    tmp_path,
    monkeypatch,
) -> None:
    backend = _backend(tmp_path)
    original = backend._model
    backend._device = "mps"
    backend._loaded_checkpoint = object()
    partial_candidate = object()
    clean_cpu = object()
    builds: list[str] = []

    monkeypatch.setattr(
        "app.ml.backends.torch_backend._probe_or_fallback",
        lambda _torch, _requested, *, allow_cpu_fallback: ("cuda", None),
    )

    def build(_checkpoint, device):
        builds.append(device)
        if device == "cuda":
            assert backend._model is original
            _ = partial_candidate
            raise RuntimeError("partial model.to(cuda) failure")
        assert device == "cpu"
        return clean_cpu, "float32"

    monkeypatch.setattr(backend, "_build_loaded_model", build)
    monkeypatch.setattr(backend, "_clear_cache", lambda **_kwargs: None)

    backend._move_loaded_model("cuda", allow_cpu_fallback=True)

    assert builds == ["cuda", "cpu"]
    assert backend._model is clean_cpu
    assert backend._model is not partial_candidate
    assert backend._device == "cpu"
    assert backend._fallback_reason == "cudaMoveFailedCpuFallback"
