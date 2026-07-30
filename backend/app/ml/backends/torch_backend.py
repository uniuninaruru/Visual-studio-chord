"""PyTorch CUDA/MPS/CPU adapter for the same checkpoint."""

from __future__ import annotations

import os
from pathlib import Path
from threading import Event, RLock
from typing import Any

from app.ml.backends.base import (
    HarmonyBackendHealth,
    HarmonyGenerationResult,
    ProgressCallback,
)
from app.ml.checkpoint import (
    ARTIFACT_POINTER_FILE,
    CHECKPOINT_FILE,
    MANIFEST_FILE,
    TRAINING_RUN_FILE,
    CheckpointInvalidError,
    CheckpointUnavailableError,
    HarmonyCheckpointManifest,
    ValidatedHarmonyCheckpoint,
    load_validated_checkpoint,
    load_weights,
    model_artifact_directory,
    validate_pytorch_compatibility,
)
from app.ml.contracts import MODEL_ID, HarmonyForgeConfig, load_model_config
from app.ml.dataset import DATA_MANIFEST_FILE
from app.ml.decoding import WindowLogits, decode_candidate
from app.ml.model import build_harmony_forge_model, import_torch, tensor_batch
from app.ml.tokenizer import TOKENIZER_SHA256, HarmonyTokenizer
from app.schemas.api import HarmonyGenerateRequest, RuntimeDevice
from app.services.device import detect_device


class TorchHarmonyBackend:
    model_id = MODEL_ID
    mock = False
    trained = True

    def __init__(
        self,
        *,
        model_directory: Path,
        config_path: Path,
        allow_research: bool,
    ) -> None:
        self._model_directory = model_directory
        self._config_path = config_path
        self._allow_research = allow_research
        self._config: HarmonyForgeConfig | None = None
        self._loaded_checkpoint: ValidatedHarmonyCheckpoint | None = None
        self._cached_validation_signature: tuple[object, ...] | None = None
        self._cached_manifest_response: dict[str, object] | None = None
        self._cached_validated_checkpoint: ValidatedHarmonyCheckpoint | None = None
        self._model: Any | None = None
        self._torch: Any | None = None
        self._device: RuntimeDevice = "cpu"
        self._requested_device: str = "auto"
        self._dtype = "float32"
        self._fallback_reason: str | None = None
        self._lock = RLock()

    def manifest(self) -> dict[str, object]:
        with self._lock:
            if self._model is not None and self._loaded_checkpoint is not None:
                return _available_manifest_response(self._loaded_checkpoint.manifest)
            signature = self._validation_signature()
            if (
                signature == self._cached_validation_signature
                and self._cached_manifest_response is not None
            ):
                return dict(self._cached_manifest_response)
            try:
                config = load_model_config(self._config_path)
            except ValueError:
                response = _unavailable_manifest_response(
                    architecture={},
                    reason=(
                        "The HarmonyForge architecture config is missing or invalid"
                    ),
                )
                self._cache_manifest_validation(
                    signature,
                    response,
                    config=None,
                    checkpoint=None,
                )
                return dict(response)
            try:
                checkpoint = load_validated_checkpoint(
                    self._model_directory,
                    config,
                    config_path=self._config_path,
                    allow_research=self._allow_research,
                )
            except (CheckpointUnavailableError, CheckpointInvalidError) as exc:
                response = _unavailable_manifest_response(
                    architecture=config.architecture_dict(),
                    reason=str(exc),
                )
                self._cache_manifest_validation(
                    signature,
                    response,
                    config=config,
                    checkpoint=None,
                )
                return dict(response)
            response = _available_manifest_response(checkpoint.manifest)
            self._cache_manifest_validation(
                signature,
                response,
                config=config,
                checkpoint=checkpoint,
            )
            return dict(response)

    def health(self) -> HarmonyBackendHealth:
        """Return a lock-consistent snapshot of the actual loaded runtime."""

        with self._lock:
            return HarmonyBackendHealth(
                loaded=self._model is not None and self._loaded_checkpoint is not None,
                device=self._device if self._model is not None else None,
                dtype=self._dtype if self._model is not None else None,
                fallback_reason=self._fallback_reason,
            )

    def _validation_signature(self) -> tuple[object, ...]:
        artifact_root = self._model_directory.resolve() / MODEL_ID
        try:
            artifact_directory = model_artifact_directory(self._model_directory)
        except CheckpointInvalidError:
            artifact_directory = artifact_root
        paths = (
            self._config_path,
            artifact_root / ARTIFACT_POINTER_FILE,
            artifact_directory / MANIFEST_FILE,
            artifact_directory / CHECKPOINT_FILE,
            artifact_directory / DATA_MANIFEST_FILE,
            artifact_directory / TRAINING_RUN_FILE,
        )
        return tuple(_file_signature(path) for path in paths)

    def _cache_manifest_validation(
        self,
        signature: tuple[object, ...],
        response: dict[str, object],
        *,
        config: HarmonyForgeConfig | None,
        checkpoint: ValidatedHarmonyCheckpoint | None,
    ) -> None:
        self._cached_validation_signature = signature
        self._cached_manifest_response = dict(response)
        self._cached_validated_checkpoint = checkpoint
        self._config = config

    def _validated_checkpoint(self) -> ValidatedHarmonyCheckpoint:
        response = self.manifest()
        checkpoint = self._cached_validated_checkpoint
        if not response["available"] or checkpoint is None:
            raise CheckpointUnavailableError(str(response["unavailableReason"]))
        return checkpoint

    def generate(
        self,
        request: HarmonyGenerateRequest,
        *,
        cancel_event: Event,
        on_progress: ProgressCallback,
    ) -> HarmonyGenerationResult:
        with self._lock:
            on_progress("Loading checkpoint", 8)
            self._ensure_loaded(
                preferred_device=request.preferred_device,
                allow_cpu_fallback=request.allow_cpu_fallback,
            )
            if cancel_event.is_set():
                raise InterruptedError
            config = self._load_config()
            tokenizer = HarmonyTokenizer()
            on_progress("Encoding", 20)
            windows = tokenizer.encode(
                request,
                maximum_frames_per_window=config.maximum_frames_per_window,
            )
            if cancel_event.is_set():
                raise InterruptedError

            logits = self._forward_with_cpu_fallback(
                windows,
                cancel_event,
                on_progress,
                allow_cpu_fallback=request.allow_cpu_fallback,
            )

            on_progress("Decoding", 82)
            candidates = [
                decode_candidate(
                    request,
                    windows,
                    logits,
                    candidate_index=index,
                )
                for index in range(request.candidate_count)
            ]
            if cancel_event.is_set():
                raise InterruptedError
            on_progress("Schema validation", 90)
            checkpoint = self._loaded_checkpoint
            if checkpoint is None:
                raise RuntimeError("Checkpoint manifest was not retained")
            manifest = checkpoint.manifest
            return HarmonyGenerationResult(
                candidates=candidates,
                device=self._device,
                dtype=self._dtype,
                backend="pytorch",
                mock=False,
                trained=True,
                checkpoint_sha256=manifest.checkpoint_sha256,
                tokenizer_sha256=manifest.tokenizer_sha256,
                source_commit=manifest.source_commit,
                batch_size=1,
                deterministic=True,
                cpu_fallback_used=self._device == "cpu" and self._fallback_reason is not None,
                fallback_reason=self._fallback_reason,
            )

    def _load_config(self) -> HarmonyForgeConfig:
        if self._config is None:
            self._config = load_model_config(self._config_path)
        return self._config

    def _ensure_loaded(
        self,
        *,
        preferred_device: str,
        allow_cpu_fallback: bool,
    ) -> None:
        if self._model is not None:
            torch = self._torch
            if torch is None:
                raise RuntimeError("HarmonyForge loaded state is incomplete")
            requested = (
                _preferred_device(torch)
                if preferred_device == "auto"
                else preferred_device
            )
            self._requested_device = preferred_device
            if requested != self._device:
                self._move_loaded_model(
                    requested,
                    allow_cpu_fallback=allow_cpu_fallback,
                )
                return
            # The current device now matches this request rather than being a
            # stale fallback inherited from a prior job.
            self._fallback_reason = None
            return
        checkpoint = self._validated_checkpoint()
        manifest = checkpoint.manifest
        try:
            torch = import_torch()
        except Exception as exc:
            raise CheckpointUnavailableError("PyTorch is not installed") from exc
        validate_pytorch_compatibility(manifest, str(torch.__version__))
        requested = (
            _preferred_device(torch)
            if preferred_device == "auto"
            else preferred_device
        )
        self._requested_device = preferred_device
        device, fallback = _probe_or_fallback(
            torch,
            requested,  # type: ignore[arg-type]
            allow_cpu_fallback=allow_cpu_fallback,
        )
        self._torch = torch
        try:
            model, dtype = self._build_loaded_model(checkpoint, device)
        except Exception:
            if device == "cpu" or not allow_cpu_fallback:
                raise
            accelerator = device
            model, dtype = self._build_loaded_model(checkpoint, "cpu")
            device = "cpu"
            fallback = f"{accelerator}LoadFailedCpuFallback"
        self._install_loaded_model(
            model,
            checkpoint=checkpoint,
            device=device,
            dtype=dtype,
            fallback_reason=fallback,
        )

    def _move_loaded_model(
        self,
        requested: str,
        *,
        allow_cpu_fallback: bool,
    ) -> None:
        torch = self._torch
        model = self._model
        checkpoint = self._loaded_checkpoint
        if torch is None or model is None or checkpoint is None:
            raise RuntimeError("HarmonyForge loaded state is incomplete")
        device, fallback = _probe_or_fallback(
            torch,
            requested,  # type: ignore[arg-type]
            allow_cpu_fallback=allow_cpu_fallback,
        )
        if device == self._device:
            self._fallback_reason = fallback
            return
        try:
            candidate, dtype = self._build_loaded_model(checkpoint, device)
        except Exception:
            if device == "cpu" or not allow_cpu_fallback:
                raise
            fallback = f"{device}MoveFailedCpuFallback"
            if self._device == "cpu":
                # The existing CPU model was never mutated: only the fresh
                # accelerator candidate experienced the partial move.
                self._fallback_reason = fallback
                return
            candidate, dtype = self._build_loaded_model(checkpoint, "cpu")
            device = "cpu"
        self._install_loaded_model(
            candidate,
            checkpoint=checkpoint,
            device=device,
            dtype=dtype,
            fallback_reason=fallback,
        )

    def _build_loaded_model(
        self,
        checkpoint: ValidatedHarmonyCheckpoint,
        device: RuntimeDevice,
    ) -> tuple[Any, str]:
        torch = self._torch
        if torch is None:
            raise RuntimeError("HarmonyForge PyTorch runtime is not initialized")
        dtype = _select_dtype(torch, device, checkpoint.manifest)
        model = build_harmony_forge_model(
            self._load_config(),
            torch_module=torch,
        )
        load_weights(model, checkpoint, device=device)
        return model, dtype

    def _install_loaded_model(
        self,
        model: Any,
        *,
        checkpoint: ValidatedHarmonyCheckpoint,
        device: RuntimeDevice,
        dtype: str,
        fallback_reason: str | None,
    ) -> None:
        previous_device = self._device if self._model is not None else None
        self._model = model
        self._loaded_checkpoint = checkpoint
        self._device = device
        self._dtype = dtype
        self._fallback_reason = fallback_reason
        if previous_device is not None and previous_device != device:
            self._clear_cache(device=previous_device)

    def _forward_with_cpu_fallback(
        self,
        windows: list[Any],
        cancel_event: Event,
        on_progress: ProgressCallback,
        *,
        allow_cpu_fallback: bool,
    ) -> list[WindowLogits]:
        try:
            return self._forward(windows, cancel_event, on_progress)
        except InterruptedError:
            raise
        except Exception as exc:
            accelerator = self._device
            if accelerator == "cpu" or not allow_cpu_fallback:
                if accelerator != "cpu" and _is_out_of_memory(self._torch, exc):
                    raise RuntimeError("Accelerator memory was exhausted") from exc
                raise
            if cancel_event.is_set():
                raise InterruptedError from exc
            reason = (
                f"{accelerator}OomCpuFallback"
                if _is_out_of_memory(self._torch, exc)
                else f"{accelerator}InferenceFailedCpuFallback"
            )
            self._reload_clean_cpu(reason)
            on_progress("Neural proposal", 30)
            return self._forward(windows, cancel_event, on_progress)

    def _reload_clean_cpu(self, reason: str) -> None:
        checkpoint = self._loaded_checkpoint
        if checkpoint is None:
            raise RuntimeError("HarmonyForge loaded state is incomplete")
        accelerator = self._device
        try:
            model, dtype = self._build_loaded_model(checkpoint, "cpu")
        except Exception:
            # Never keep serving an accelerator model after an inference error
            # if clean CPU reconstruction itself failed.
            self._clear_cache(device=accelerator)
            self._model = None
            self._device = "cpu"
            self._dtype = "float32"
            self._fallback_reason = reason
            raise
        self._install_loaded_model(
            model,
            checkpoint=checkpoint,
            device="cpu",
            dtype=dtype,
            fallback_reason=reason,
        )

    def _forward(
        self,
        windows: list[Any],
        cancel_event: Event,
        on_progress: ProgressCallback,
    ) -> list[WindowLogits]:
        torch = self._torch
        model = self._model
        if torch is None or model is None:
            raise RuntimeError("HarmonyForge is not loaded")
        decoded: list[WindowLogits] = []
        with torch.inference_mode():
            for index, window in enumerate(windows):
                if cancel_event.is_set():
                    raise InterruptedError
                on_progress(
                    "Neural proposal",
                    25 + round(50 * index / max(1, len(windows))),
                )
                batch = tensor_batch(
                    window,
                    torch_module=torch,
                    device=self._device,
                )
                with _autocast(torch, self._device, self._dtype):
                    outputs = model(batch)
                decoded.append(
                    WindowLogits(
                        event=_to_rows(outputs["event"]),
                        root=_to_rows(outputs["root"]),
                        quality=_to_rows(outputs["quality"]),
                        inversion=_to_rows(outputs["inversion"]),
                        bass=_to_rows(outputs["bass"]),
                        extensions=_to_rows(outputs["extensions"]),
                    )
                )
        on_progress("Neural proposal", 75)
        return decoded

    def _clear_cache(self, *, device: RuntimeDevice | None = None) -> None:
        if self._torch is None:
            return
        target = self._device if device is None else device
        try:
            if target == "cuda":
                self._torch.cuda.empty_cache()
            elif target == "mps":
                self._torch.mps.empty_cache()
        except Exception:
            return


def _file_signature(path: Path) -> tuple[object, ...]:
    try:
        stat = path.stat()
    except OSError as exc:
        return ("missing", type(exc).__name__)
    return (
        "file",
        stat.st_dev,
        stat.st_ino,
        stat.st_size,
        stat.st_mtime_ns,
        stat.st_ctime_ns,
    )


def _unavailable_manifest_response(
    *,
    architecture: dict[str, int | float | str | bool],
    reason: str,
) -> dict[str, object]:
    return {
        "modelId": MODEL_ID,
        "available": False,
        "mock": False,
        "trained": False,
        "evaluationStatus": "notEvaluated",
        "checkpointSha256": None,
        "tokenizerSha256": TOKENIZER_SHA256,
        "architecture": architecture,
        "supportedDevices": ["cpu", "cuda", "mps"],
        "unavailableReason": reason,
    }


def _available_manifest_response(
    manifest: HarmonyCheckpointManifest,
) -> dict[str, object]:
    return {
        "modelId": MODEL_ID,
        "available": True,
        "mock": False,
        "trained": manifest.trained,
        # Constant by construction here — the loader rejects every other task
        # before an artifact can reach this response — but reported so a client
        # never has to infer the objective from the model id alone.
        "task": manifest.task,
        "evaluationStatus": manifest.evaluation_status,
        "checkpointSha256": manifest.checkpoint_sha256,
        "tokenizerSha256": manifest.tokenizer_sha256,
        "architecture": manifest.architecture,
        "supportedDevices": ["cpu", "cuda", "mps"],
        "unavailableReason": None,
    }


def _preferred_device(torch: Any) -> RuntimeDevice:
    device = detect_device()
    if device.torch_cuda_available:
        return "cuda"
    if device.mps_available:
        return "mps"
    return "cpu"


def _probe_or_fallback(
    torch: Any,
    requested: RuntimeDevice,
    *,
    allow_cpu_fallback: bool,
) -> tuple[RuntimeDevice, str | None]:
    if requested == "mps" and os.getenv("PYTORCH_ENABLE_MPS_FALLBACK") == "1":
        if not allow_cpu_fallback:
            raise CheckpointUnavailableError(
                "Silent MPS CPU operation fallback is enabled"
            )
        return "cpu", "mpsSilentOperationFallbackDisabled"
    try:
        value = torch.ones((2,), device=requested, dtype=torch.float32)
        result = (value * 2).sum()
        if float(result.detach().cpu()) != 4:
            raise RuntimeError("device probe returned an unexpected value")
        if requested == "mps" and hasattr(torch, "mps"):
            torch.mps.synchronize()
        if requested == "cuda" and hasattr(torch, "cuda"):
            torch.cuda.synchronize()
        return requested, None
    except Exception as exc:
        if requested == "cpu" or not allow_cpu_fallback:
            raise CheckpointUnavailableError(
                f"{requested} tensor probe failed"
            ) from exc
        return "cpu", f"{requested}ProbeFailedCpuFallback"


def _select_dtype(
    torch: Any,
    device: RuntimeDevice,
    manifest: HarmonyCheckpointManifest,
) -> str:
    supported = manifest.supported_precisions
    if device == "cuda":
        if "bfloat16" in supported.cuda and torch.cuda.is_bf16_supported():
            return "bfloat16"
        if "float16" in supported.cuda:
            return "float16"
        if "float32" in supported.cuda:
            return "float32"
    elif device == "mps":
        if "float16" in supported.mps:
            return "float16"
        if "float32" in supported.mps:
            return "float32"
    elif "float32" in supported.cpu:
        return "float32"
    raise CheckpointUnavailableError(
        f"HarmonyForge manifest does not declare a usable {device} precision"
    )


def _autocast(torch: Any, device: RuntimeDevice, dtype: str):
    if dtype == "float32":
        return torch.autocast(device_type=device, enabled=False)
    torch_dtype = torch.bfloat16 if dtype == "bfloat16" else torch.float16
    return torch.autocast(device_type=device, dtype=torch_dtype)


def _to_rows(tensor: Any) -> list[list[float]]:
    return tensor[0].detach().float().cpu().tolist()


def _is_out_of_memory(torch: Any | None, exc: Exception) -> bool:
    if torch is not None:
        out_of_memory = getattr(torch, "OutOfMemoryError", None)
        if out_of_memory is not None and isinstance(exc, out_of_memory):
            return True
    text = str(exc).lower()
    return "out of memory" in text or "mps backend out of memory" in text
