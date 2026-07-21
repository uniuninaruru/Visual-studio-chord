"""Lazy optional inference runtimes and bounded batch execution."""

from __future__ import annotations

import base64
import hashlib
import importlib
import math
import sys
from dataclasses import dataclass
from typing import Any, Literal, Protocol, runtime_checkable

from app.schemas.api import BackendKind, RankCandidate, RuntimeDevice

FEATURE_DIMENSION = 128
MAX_BATCH_SIZE = 128

# 378-byte ONNX graph generated with ``onnx.helper`` (opset 17, IR v9).
# Architecture: float[batch,128] -> MatMul -> ReLU(32) -> MatMul -> float[batch,1].
# ConstantOfShape creates the deterministic 0.01 and 0.03125 weights, keeping the
# reviewed model self-contained and preventing caller-controlled model paths.
_BUILTIN_ONNX_MODEL_BASE64 = (
    "CAkSFW11c2ljLXRoZW9yeS1jb21wb3NlcjrYAgo8CgZzaGFwZTESAncxIg9Db25zdGFudE9m"
    "U2hhcGUqHQoFdmFsdWUqEQgBEAEiBArXIzxCBWZpbGwxoAEECiEKCGZlYXR1cmVzCgJ3MRIJ"
    "aGlkZGVuUmF3IgZNYXRNdWwKGQoJaGlkZGVuUmF3EgZoaWRkZW4iBFJlbHUKPAoGc2hhcGUy"
    "EgJ3MiIPQ29uc3RhbnRPZlNoYXBlKh0KBXZhbHVlKhEIARABIgQAAAA9QgVmaWxsMqABBAoc"
    "CgZoaWRkZW4KAncyEgZzY29yZXMiBk1hdE11bBIYUHJlZmVyZW5jZVJhbmtlcjEyOHgzMngx"
    "KhEIAhAHOgOAASBCBnNoYXBlMSoQCAIQBzoCIAFCBnNoYXBlMlogCghmZWF0dXJlcxIUChII"
    "ARIOCgcSBWJhdGNoCgMIgAFiHQoGc2NvcmVzEhMKEQgBEg0KBxIFYmF0Y2gKAggBQgQKABAR"
)
BUILTIN_ONNX_MODEL_BYTES = base64.b64decode(_BUILTIN_ONNX_MODEL_BASE64)


class ModelUnavailableError(RuntimeError):
    """An allow-listed optional runtime cannot be used on this machine."""


class RuntimeInferenceError(RuntimeError):
    """Inference failed without exposing implementation or filesystem details."""


class AcceleratorOutOfMemoryError(RuntimeError):
    """Internal signal used to trigger bounded retry and CPU fallback."""


@dataclass(frozen=True, slots=True)
class BackendHealth:
    healthy: bool
    loaded: bool
    model_id: str
    backend: BackendKind
    device: RuntimeDevice
    mock: bool


@runtime_checkable
class InferenceBackend(Protocol):
    model_id: str
    backend_kind: BackendKind
    mock: bool
    device: RuntimeDevice

    def load(self) -> None: ...

    def score_batch(self, candidates: list[RankCandidate]) -> list[float]: ...

    def unload(self) -> None: ...

    def health(self) -> BackendHealth: ...

    def clear_accelerator_cache(self) -> None: ...

    def move_to_cpu(self) -> None: ...

    def restore_preferred_device(self) -> None: ...


BatchRuntime = InferenceBackend


@dataclass(frozen=True, slots=True)
class RuntimeExecution:
    scores: list[float]
    device: RuntimeDevice
    batch_size: int
    fallback_reason: str | None = None


def execute_bounded_batches(
    runtime: BatchRuntime,
    candidates: list[RankCandidate],
    *,
    batch_size: int,
    allow_cpu_fallback: bool,
) -> RuntimeExecution:
    """Score with shrinking accelerator batches, then retry on CPU if necessary."""

    if not candidates:
        raise ValueError("at least one candidate is required")
    if not 1 <= batch_size <= MAX_BATCH_SIZE:
        raise ValueError(f"batch_size must be between 1 and {MAX_BATCH_SIZE}")

    requested_batch_size = min(batch_size, len(candidates))
    effective_batch_size = requested_batch_size
    fallback_reason: str | None = None

    while True:
        try:
            scores: list[float] = []
            for start in range(0, len(candidates), effective_batch_size):
                batch = candidates[start : start + effective_batch_size]
                batch_scores = runtime.score_batch(batch)
                if len(batch_scores) != len(batch):
                    raise RuntimeInferenceError("ranker returned an invalid score count")
                numeric_scores = [float(score) for score in batch_scores]
                if not all(math.isfinite(score) for score in numeric_scores):
                    raise RuntimeInferenceError("ranker returned a non-finite score")
                scores.extend(numeric_scores)
            return RuntimeExecution(
                scores=scores,
                device=runtime.device,
                batch_size=effective_batch_size,
                fallback_reason=fallback_reason,
            )
        except AcceleratorOutOfMemoryError:
            if runtime.device == "cpu":
                raise RuntimeInferenceError("inference failed on the CPU runtime") from None
            accelerator = runtime.device
            runtime.clear_accelerator_cache()
            if effective_batch_size > 1:
                effective_batch_size = max(1, effective_batch_size // 2)
                continue
            if not allow_cpu_fallback:
                raise RuntimeInferenceError("accelerator memory was exhausted") from None
            runtime.move_to_cpu()
            effective_batch_size = requested_batch_size
            fallback_reason = f"{accelerator}OomCpuFallback"


def vectorize_features(features: dict[str, float]) -> list[float]:
    """Map named features into a stable signed-hash vector without Python hash()."""

    vector = [0.0] * FEATURE_DIMENSION
    for name in sorted(features):
        digest = hashlib.blake2s(name.encode("utf-8"), digest_size=4).digest()
        bucket = int.from_bytes(digest[:2], "big") % FEATURE_DIMENSION
        sign = 1.0 if digest[2] & 1 else -1.0
        vector[bucket] += sign * features[name]
    return vector


class DeterministicBackend:
    """Always-available CPU baseline; linear preferences are merged by the manager."""

    model_id = "local-deterministic-v1"
    backend_kind: BackendKind = "linear"
    mock = False
    device: RuntimeDevice = "cpu"

    def __init__(self) -> None:
        self._loaded = False

    def load(self) -> None:
        self._loaded = True

    def score_batch(self, candidates: list[RankCandidate]) -> list[float]:
        if not self._loaded:
            raise RuntimeInferenceError("deterministic backend is not loaded")
        return [0.0] * len(candidates)

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

    def clear_accelerator_cache(self) -> None:
        return None

    def move_to_cpu(self) -> None:
        return None

    def restore_preferred_device(self) -> None:
        return None


class MockDeterministicBackend(DeterministicBackend):
    """Reproducible development backend that is visibly marked as MOCK."""

    model_id = "mock-deterministic-v1"
    backend_kind: BackendKind = "mock"
    mock = True

    def score_batch(self, candidates: list[RankCandidate]) -> list[float]:
        if not self._loaded:
            raise RuntimeInferenceError("mock backend is not loaded")
        return [_mock_score(candidate) for candidate in candidates]


def _mock_score(candidate: RankCandidate) -> float:
    digest = hashlib.blake2s(digest_size=4)
    digest.update(candidate.id.encode("utf-8"))
    for name in sorted(candidate.features):
        digest.update(b"\0")
        digest.update(name.encode("utf-8"))
        digest.update(b"=")
        digest.update(format(candidate.features[name], ".12g").encode("ascii"))
    unit = int.from_bytes(digest.digest(), "big") / 0xFFFFFFFF
    return round((unit - 0.5) * 0.1, 8)


def import_torch() -> Any:
    return importlib.import_module("torch")


def import_onnxruntime() -> Any:
    return importlib.import_module("onnxruntime")


def select_onnx_providers(
    available_providers: list[str],
    *,
    platform: str | None = None,
) -> list[str]:
    """Select the native provider order for macOS, Windows, or other hosts."""

    available = set(available_providers)
    current_platform = platform or sys.platform
    priority = ["CUDAExecutionProvider"]
    if current_platform == "darwin":
        priority.append("CoreMLExecutionProvider")
    elif current_platform.startswith("win"):
        priority.append("DmlExecutionProvider")
    priority.append("CPUExecutionProvider")
    selected = [provider for provider in priority if provider in available]
    if not selected:
        raise ModelUnavailableError("ONNX Runtime has no supported execution provider")
    return selected


class TorchPairwiseRuntime:
    """Small MLP utility scorer suitable for pairwise score-difference training."""

    model_id = "local-mlp-v1"
    backend_kind: BackendKind = "pytorch"
    mock = False

    def __init__(self, torch: Any, device: Literal["cpu", "cuda", "mps"]) -> None:
        self._torch = torch
        self.device = device
        self._preferred_device = device
        self._model: Any | None = None

    def load(self) -> None:
        if self._model is not None:
            return
        try:
            self._model = self._build_model()
            self._model.to(self.device)
            self._model.eval()
        except Exception as exc:
            self._model = None
            raise ModelUnavailableError("The PyTorch ranker could not be loaded") from exc

    def _build_model(self) -> Any:
        torch = self._torch
        model = torch.nn.Sequential(
            torch.nn.Linear(FEATURE_DIMENSION, 32),
            torch.nn.ReLU(),
            torch.nn.Linear(32, 1),
        )
        # Stable initialization keeps this untrained Phase 2 baseline reproducible.
        with torch.no_grad():
            for index, parameter in enumerate(model.parameters()):
                values = torch.linspace(
                    -0.025,
                    0.025,
                    parameter.numel(),
                    dtype=parameter.dtype,
                )
                parameter.copy_(values.reshape_as(parameter) * (index + 1))
        return model

    def score_batch(self, candidates: list[RankCandidate]) -> list[float]:
        torch = self._torch
        if self._model is None:
            raise RuntimeInferenceError("PyTorch ranker is not loaded")
        try:
            tensor = torch.tensor(
                [vectorize_features(candidate.features) for candidate in candidates],
                dtype=torch.float32,
                device=self.device,
            )
            with torch.inference_mode():
                output = self._model(tensor)
            return [float(value) for value in output.reshape(-1).detach().cpu().tolist()]
        except Exception as exc:
            if self.device != "cpu" and _is_accelerator_oom(torch, exc):
                raise AcceleratorOutOfMemoryError from exc
            raise RuntimeInferenceError("PyTorch ranking failed") from exc

    def clear_accelerator_cache(self) -> None:
        try:
            if self.device == "mps":
                self._torch.mps.empty_cache()
            else:
                self._torch.cuda.empty_cache()
        except Exception:
            pass

    def move_to_cpu(self) -> None:
        if self._model is None:
            raise RuntimeInferenceError("PyTorch ranker is not loaded")
        try:
            self._model.to("cpu")
            self.device = "cpu"
        except Exception as exc:
            raise RuntimeInferenceError("PyTorch CPU fallback failed") from exc

    def unload(self) -> None:
        self._model = None
        self.clear_accelerator_cache()

    def restore_preferred_device(self) -> None:
        if self._model is None or self._preferred_device == "cpu":
            return
        try:
            self._model.to(self._preferred_device)
            self.device = self._preferred_device
        except Exception:
            self.device = "cpu"

    def health(self) -> BackendHealth:
        loaded = self._model is not None
        return BackendHealth(
            healthy=loaded,
            loaded=loaded,
            model_id=self.model_id,
            backend=self.backend_kind,
            device=self.device,
            mock=self.mock,
        )


class OnnxPairwiseRuntime:
    """ONNX scorer backed only by the bundled, allow-listed model artifact."""

    model_id = "local-onnx-v1"
    backend_kind: BackendKind = "onnx"
    mock = False

    def __init__(
        self,
        onnxruntime: Any,
        model_bytes: bytes = BUILTIN_ONNX_MODEL_BYTES,
    ) -> None:
        self._onnxruntime = onnxruntime
        self._model_bytes = model_bytes
        self._session: Any | None = None
        self._providers = select_onnx_providers(onnxruntime.get_available_providers())
        self._preferred_providers = list(self._providers)
        self.device = _runtime_for_onnx_provider(self._providers[0])

    def load(self) -> None:
        if self._session is not None:
            return
        try:
            session = self._onnxruntime.InferenceSession(
                self._model_bytes,
                providers=self._preferred_providers,
            )
        except Exception as exc:
            raise ModelUnavailableError("The bundled ONNX ranker could not be loaded") from exc
        try:
            actual_providers = session.get_providers()
            self._providers = select_onnx_providers(actual_providers)
            self.device = _runtime_for_onnx_provider(self._providers[0])
            self._session = session
        except AttributeError:
            # Minimal test doubles may not expose session provider introspection.
            self._session = session
        except Exception as exc:
            self._session = None
            raise ModelUnavailableError("The bundled ONNX ranker could not be loaded") from exc

    def score_batch(self, candidates: list[RankCandidate]) -> list[float]:
        if self._session is None:
            raise RuntimeInferenceError("ONNX ranker is not loaded")
        try:
            numpy = importlib.import_module("numpy")
            values = numpy.asarray(
                [vectorize_features(candidate.features) for candidate in candidates],
                dtype=numpy.float32,
            )
            input_name = self._session.get_inputs()[0].name
            output_name = self._session.get_outputs()[0].name
            output = self._session.run([output_name], {input_name: values})[0]
            return [float(value) for value in output.reshape(-1).tolist()]
        except Exception as exc:
            if self.device != "cpu" and _message_is_accelerator_oom(exc):
                raise AcceleratorOutOfMemoryError from exc
            raise RuntimeInferenceError("ONNX ranking failed") from exc

    def clear_accelerator_cache(self) -> None:
        # ONNX Runtime owns its allocator; recreating the session performs fallback.
        return None

    def move_to_cpu(self) -> None:
        if "CPUExecutionProvider" not in self._providers:
            raise RuntimeInferenceError("ONNX CPU fallback is unavailable")
        try:
            self._session = self._onnxruntime.InferenceSession(
                self._model_bytes,
                providers=["CPUExecutionProvider"],
            )
            self._providers = ["CPUExecutionProvider"]
            self.device = "cpu"
        except Exception as exc:
            raise RuntimeInferenceError("ONNX CPU fallback failed") from exc

    def unload(self) -> None:
        self._session = None

    def restore_preferred_device(self) -> None:
        if self._preferred_providers[0] == "CPUExecutionProvider":
            return
        try:
            session = self._onnxruntime.InferenceSession(
                self._model_bytes,
                providers=self._preferred_providers,
            )
            providers = select_onnx_providers(session.get_providers())
            restored_device = _runtime_for_onnx_provider(providers[0])
            if restored_device == "cpu":
                return
            self._session = session
            self._providers = providers
            self.device = restored_device
        except Exception:
            return

    def health(self) -> BackendHealth:
        loaded = self._session is not None
        return BackendHealth(
            healthy=loaded,
            loaded=loaded,
            model_id=self.model_id,
            backend=self.backend_kind,
            device=self.device,
            mock=self.mock,
        )


def _is_accelerator_oom(torch: Any, exc: Exception) -> bool:
    oom_type = getattr(getattr(torch, "cuda", None), "OutOfMemoryError", None)
    if isinstance(oom_type, type) and isinstance(exc, oom_type):
        return True
    return _message_is_accelerator_oom(exc)


def _message_is_accelerator_oom(exc: Exception) -> bool:
    message = str(exc).lower()
    memory_failure = any(
        marker in message
        for marker in (
            "out of memory",
            "failed to allocate memory",
            "error_out_of_memory",
            "e_outofmemory",
        )
    )
    return memory_failure


def _runtime_for_onnx_provider(provider: str) -> RuntimeDevice:
    return {
        "CUDAExecutionProvider": "cuda",
        "CoreMLExecutionProvider": "coreml",
        "DmlExecutionProvider": "directml",
        "CPUExecutionProvider": "cpu",
    }[provider]
