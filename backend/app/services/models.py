"""Strict model registry, lazy runtime loading, and inference cache."""

from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from pathlib import Path
from threading import RLock

from app.schemas.api import (
    BackendKind,
    ModelInfo,
    ModelsResponse,
    RankCandidate,
    RankedCandidate,
    RuntimeDevice,
    ServerModelId,
)
from app.services.device import (
    DeviceInfo,
    detect_device,
    selected_onnx_device,
    selected_torch_device,
)
from app.services.ranking import linear_score
from app.services.runtime import (
    CorpusNGramBackend,
    DeterministicBackend,
    InferenceBackend,
    MockDeterministicBackend,
    ModelUnavailableError,
    OnnxPairwiseRuntime,
    RuntimeExecution,
    TorchPairwiseRuntime,
    execute_bounded_batches,
    import_onnxruntime,
    import_torch,
)

LOCAL_MODEL_ID: ServerModelId = "local-deterministic-v1"
CORPUS_MODEL_ID: ServerModelId = "harmony-corpus-ngram-v1"
MLP_MODEL_ID: ServerModelId = "local-mlp-v1"
ONNX_MODEL_ID: ServerModelId = "local-onnx-v1"
MOCK_MODEL_ID: ServerModelId = "mock-deterministic-v1"
SERVER_MODEL_IDS: frozenset[str] = frozenset(
    {LOCAL_MODEL_ID, CORPUS_MODEL_ID, MLP_MODEL_ID, ONNX_MODEL_ID, MOCK_MODEL_ID}
)


class ModelConflictError(RuntimeError):
    """The requested lifecycle operation is invalid for a built-in model."""


@dataclass(frozen=True, slots=True)
class RankOutcome:
    model_id: ServerModelId
    ranked: list[RankedCandidate]
    device: RuntimeDevice
    runtime: RuntimeDevice
    batch_size: int
    backend: BackendKind
    mock: bool
    fallback_reason: str | None = None


class ModelManager:
    """Cache only known backends; caller input is never interpreted as a path."""

    def __init__(
        self,
        preferred_model: str = "auto",
        *,
        model_directory: Path | None = None,
    ) -> None:
        self._linear_backend = DeterministicBackend()
        self._linear_backend.load()
        self._cache: dict[ServerModelId, InferenceBackend] = {}
        self._active_model: ServerModelId = LOCAL_MODEL_ID
        self._fallback_reason: str | None = None
        self._runtime_fallback_model: ServerModelId | None = None
        self._model_directory = (model_directory or Path("./models")).resolve()
        self._lock = RLock()
        self._initialize_preference(preferred_model)

    @property
    def active_model(self) -> ServerModelId:
        with self._lock:
            return self._active_model

    @property
    def cache_size(self) -> int:
        with self._lock:
            return len(self._cache)

    @property
    def fallback_reason(self) -> str | None:
        with self._lock:
            return self._fallback_reason

    def load(self, model_id: ServerModelId) -> None:
        self._require_allowlisted(model_id)
        with self._lock:
            self._ensure_backend(model_id)
            self._active_model = model_id
            self._fallback_reason = None
            self._runtime_fallback_model = None

    def unload(self, model_id: ServerModelId) -> None:
        self._require_allowlisted(model_id)
        if model_id == LOCAL_MODEL_ID:
            raise ModelConflictError("The deterministic CPU fallback is always loaded")
        with self._lock:
            backend = self._cache.pop(model_id, None)
            if backend is not None:
                backend.unload()
            if self._active_model == model_id:
                self._active_model = LOCAL_MODEL_ID
            self._fallback_reason = None
            self._runtime_fallback_model = None

    def model_info(self, model_id: str, device: DeviceInfo) -> ModelInfo:
        self._require_allowlisted(model_id)
        with self._lock:
            loaded_backend = self._cache.get(model_id)  # type: ignore[arg-type]

        if model_id == LOCAL_MODEL_ID:
            return ModelInfo(
                id=model_id,
                name="Local deterministic linear ranker",
                runtime="cpu",
                available=True,
                loaded=True,
                capabilities=["rank"],
                backend="linear",
                mock=False,
            )
        if model_id == CORPUS_MODEL_ID:
            model_path = self._model_directory / "harmony-corpus-v1.json"
            return ModelInfo(
                id=model_id,
                name="Corpus 3-gram harmony language model",
                runtime="cpu",
                available=loaded_backend is not None or model_path.is_file(),
                loaded=loaded_backend is not None and loaded_backend.health().loaded,
                capabilities=["rank"],
                backend="corpus",
                mock=False,
            )
        if model_id == MOCK_MODEL_ID:
            return ModelInfo(
                id=model_id,
                name="MOCK deterministic development ranker",
                runtime="cpu",
                available=True,
                loaded=loaded_backend is not None and loaded_backend.health().loaded,
                capabilities=["rank"],
                backend="mock",
                mock=True,
            )
        if model_id == MLP_MODEL_ID:
            return ModelInfo(
                id=model_id,
                name="Small pairwise MLP ranker",
                runtime=(
                    loaded_backend.device
                    if loaded_backend
                    else selected_torch_device(device)
                ),
                available=loaded_backend is not None or device.torch_available,
                loaded=loaded_backend is not None and loaded_backend.health().loaded,
                capabilities=["rank"],
                backend="pytorch",
                mock=False,
            )

        onnx_available = loaded_backend is not None or device.onnx_runtime_available
        return ModelInfo(
            id=model_id,
            name="Bundled ONNX pairwise ranker",
            runtime=loaded_backend.device if loaded_backend else selected_onnx_device(device),
            available=onnx_available,
            loaded=loaded_backend is not None and loaded_backend.health().loaded,
            capabilities=["rank"],
            backend="onnx",
            mock=False,
        )

    def models_response(
        self,
        device: DeviceInfo,
        *,
        request_id: str = "internal",
    ) -> ModelsResponse:
        active_model = self.active_model
        active_info = self.model_info(active_model, device)
        return ModelsResponse(
            request_id=request_id,
            models=[
                self.model_info(LOCAL_MODEL_ID, device),
                self.model_info(CORPUS_MODEL_ID, device),
                self.model_info(MLP_MODEL_ID, device),
                self.model_info(ONNX_MODEL_ID, device),
                self.model_info(MOCK_MODEL_ID, device),
                ModelInfo(
                    id="browser-linear-v1",
                    name="Browser linear fallback",
                    runtime="browser",
                    available=True,
                    loaded=False,
                    capabilities=["rank"],
                    backend="browser",
                    mock=False,
                ),
            ],
            active_model=active_model,
            active_runtime=active_info.runtime,
            active_backend=active_info.backend,
            mock=active_info.mock,
            fallback_reason=self.fallback_reason,
        )

    def rank(
        self,
        model_id: ServerModelId | None,
        candidates: list[RankCandidate],
        preference_weights: dict[str, float],
        *,
        batch_size: int,
        allow_cpu_fallback: bool,
    ) -> RankOutcome:
        resolved_model_id = model_id or self.active_model
        self._require_allowlisted(resolved_model_id)
        with self._lock:
            backend = self._ensure_backend(resolved_model_id)
            self._active_model = resolved_model_id
            execution = execute_bounded_batches(
                backend,
                candidates,
                batch_size=batch_size,
                allow_cpu_fallback=allow_cpu_fallback,
            )
            if execution.fallback_reason is not None:
                self._fallback_reason = execution.fallback_reason
                self._runtime_fallback_model = resolved_model_id
                backend.restore_preferred_device()
            elif self._runtime_fallback_model is not None:
                if (
                    resolved_model_id != self._runtime_fallback_model
                    or backend.device != "cpu"
                ):
                    self._fallback_reason = None
                    self._runtime_fallback_model = None
            elif model_id is not None:
                self._fallback_reason = None

        ranked = _merge_and_sort_scores(candidates, preference_weights, execution)
        return RankOutcome(
            model_id=resolved_model_id,
            ranked=ranked,
            device=execution.device,
            runtime=execution.device,
            batch_size=execution.batch_size,
            backend=backend.backend_kind,
            mock=backend.mock,
            fallback_reason=execution.fallback_reason,
        )

    def _ensure_backend(self, model_id: ServerModelId) -> InferenceBackend:
        if model_id == LOCAL_MODEL_ID:
            if not self._linear_backend.health().loaded:
                self._linear_backend.load()
            return self._linear_backend
        backend = self._cache.get(model_id)
        if backend is not None:
            if not backend.health().loaded:
                backend.load()
            return backend
        if model_id == MOCK_MODEL_ID:
            backend = MockDeterministicBackend()
        elif model_id == CORPUS_MODEL_ID:
            backend = CorpusNGramBackend(
                self._model_directory / "harmony-corpus-v1.json",
            )
        else:
            backend = self._load_optional_runtime(model_id)
        backend.load()
        self._cache[model_id] = backend
        return backend

    def _initialize_preference(self, preferred_model: str) -> None:
        """Best-effort startup selection; optional runtime failures never escape."""

        if preferred_model == "linear":
            return
        if preferred_model == "corpus":
            try:
                self.load(CORPUS_MODEL_ID)
            except Exception:
                self._active_model = LOCAL_MODEL_ID
                self._fallback_reason = "corpusUnavailableTheoryFallback"
            return
        if preferred_model == "mock-deterministic":
            self.load(MOCK_MODEL_ID)
            return
        if preferred_model in {"mlp", "onnx"}:
            target = MLP_MODEL_ID if preferred_model == "mlp" else ONNX_MODEL_ID
            try:
                self.load(target)
            except Exception:
                self._active_model = LOCAL_MODEL_ID
                self._fallback_reason = f"{preferred_model}UnavailableCpuFallback"
            return
        if preferred_model != "auto":
            self._fallback_reason = "invalidPreferenceCpuFallback"
            return

        corpus_path = self._model_directory / "harmony-corpus-v1.json"
        if corpus_path.is_file():
            try:
                self.load(CORPUS_MODEL_ID)
                return
            except Exception:
                self._fallback_reason = "corpusLoadFailedTheoryFallback"

        device = detect_device()
        onnx_device = selected_onnx_device(device)
        torch_device = selected_torch_device(device)
        attempts: list[ServerModelId] = []
        if onnx_device == "cuda" and _module_available("onnxruntime"):
            attempts.append(ONNX_MODEL_ID)
        if torch_device == "cuda":
            attempts.append(MLP_MODEL_ID)
        if torch_device == "mps":
            attempts.append(MLP_MODEL_ID)
        if onnx_device in {"coreml", "directml"} and _module_available("onnxruntime"):
            attempts.append(ONNX_MODEL_ID)

        failures: list[str] = []
        for target in dict.fromkeys(attempts):
            try:
                self.load(target)
                backend = self._cache[target]
                if backend.device == "cpu":
                    self.unload(target)
                    raise ModelUnavailableError("accelerator initialization failed")
                if failures:
                    fallback_target = "Onnx" if target == ONNX_MODEL_ID else "Mlp"
                    self._fallback_reason = (
                        f"{''.join(failures)}AutoLoadFailed{fallback_target}Fallback"
                    )
                return
            except Exception:
                failure = "Onnx" if target == ONNX_MODEL_ID else "Mlp"
                failures.append(failure)

        self._active_model = LOCAL_MODEL_ID
        if failures:
            self._fallback_reason = f"{''.join(failures)}AutoLoadFailedCpuFallback"

    def _load_optional_runtime(self, model_id: ServerModelId) -> InferenceBackend:
        if model_id == MLP_MODEL_ID:
            try:
                torch = import_torch()
            except Exception:
                raise ModelUnavailableError("PyTorch is not installed") from None
            device = selected_torch_device(detect_device())
            try:
                return TorchPairwiseRuntime(torch, device)
            except ModelUnavailableError:
                raise
            except Exception:
                raise ModelUnavailableError("The PyTorch ranker could not be initialized") from None

        if model_id == ONNX_MODEL_ID:
            try:
                onnxruntime = import_onnxruntime()
            except Exception:
                raise ModelUnavailableError("ONNX Runtime is not installed") from None
            try:
                return OnnxPairwiseRuntime(onnxruntime)
            except ModelUnavailableError:
                raise
            except Exception:
                raise ModelUnavailableError(
                    "The ONNX ranker could not be initialized"
                ) from None

        raise ModelUnavailableError("The requested model is not loadable")

    @staticmethod
    def _require_allowlisted(model_id: str) -> None:
        if model_id not in SERVER_MODEL_IDS:
            raise ModelUnavailableError("Unknown model id")


def get_models(
    device: DeviceInfo,
    manager: ModelManager | None = None,
    *,
    request_id: str = "internal",
) -> ModelsResponse:
    """Compatibility wrapper used by the system route and direct callers."""

    return (manager or ModelManager("linear")).models_response(
        device,
        request_id=request_id,
    )


def _merge_and_sort_scores(
    candidates: list[RankCandidate],
    preference_weights: dict[str, float],
    execution: RuntimeExecution,
) -> list[RankedCandidate]:
    scored: list[RankedCandidate] = []
    for candidate, runtime_score in zip(candidates, execution.scores, strict=True):
        score = round(runtime_score + linear_score(candidate, preference_weights), 8)
        scored.append(RankedCandidate(id=candidate.id, score=0.0 if score == 0 else score))
    return sorted(scored, key=lambda item: (-item.score, item.id))


def _module_available(module_name: str) -> bool:
    try:
        return importlib.util.find_spec(module_name) is not None
    except (ImportError, ValueError):
        return False
