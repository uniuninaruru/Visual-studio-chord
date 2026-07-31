#!/usr/bin/env python3
"""Run one explicitly non-publishable HarmonyForge optimizer-step smoke.

This script proves that the production model can complete a real forward pass,
backward pass, optimizer step, and optional SafeTensors round trip.  It does not
compile a dataset, evaluate music quality, or create any runtime checkpoint
manifest.  Its output must never be presented as a trained model.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Sequence

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIRECTORY = PROJECT_ROOT / "backend"
if str(BACKEND_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIRECTORY))

from app.ml.artifacts import validate_safetensors_file  # noqa: E402
from app.ml.contracts import MODEL_ID, load_model_config  # noqa: E402
from app.ml.masking import MaskPlan  # noqa: E402
from app.ml.model import build_harmony_forge_model  # noqa: E402
from app.ml.training_runtime import (  # noqa: E402
    build_masked_batch,
    factorized_active_head_loss,
)

DeviceChoice = Literal["auto", "cpu", "mps"]

DEFAULT_OUTPUT_DIRECTORY = PROJECT_ROOT / "training" / "runs" / "mps-smoke"
MODEL_CONFIG_PATH = (
    PROJECT_ROOT
    / "configs"
    / "models"
    / "harmonyforge-bimask-base-v1.yaml"
)
FRAME_COUNT = 16
BATCH_SIZE = 1
OPTIMIZER_STEPS = 1


class SmokeTrainingError(RuntimeError):
    """The isolated optimizer-step smoke could not complete safely."""


@dataclass(frozen=True, slots=True)
class SmokeOptions:
    device: DeviceChoice = "auto"
    output_directory: Path = DEFAULT_OUTPUT_DIRECTORY
    seed: str = "1729"
    write_checkpoint: bool = True

    def validate(self) -> None:
        if self.device not in {"auto", "cpu", "mps"}:
            raise SmokeTrainingError("device must be auto, cpu, or mps")
        if not self.seed or len(self.seed) > 128:
            raise SmokeTrainingError("seed must contain 1 to 128 characters")


def _import_torch() -> Any:
    try:
        return importlib.import_module("torch")
    except Exception as exc:
        raise SmokeTrainingError(
            "PyTorch is required. Run the acceleration setup first."
        ) from exc


def _import_safetensors_torch() -> Any:
    try:
        return importlib.import_module("safetensors.torch")
    except Exception as exc:
        raise SmokeTrainingError(
            "SafeTensors is required unless --no-checkpoint is used."
        ) from exc


def _mps_is_available(torch: Any) -> bool:
    backend = getattr(getattr(torch, "backends", None), "mps", None)
    return bool(backend is not None and backend.is_available())


def _probe_device(torch: Any, device: str) -> None:
    try:
        tensor = torch.ones((2,), device=device, dtype=torch.float32)
        result = float((tensor * 2).sum().detach().cpu())
        if result != 4.0:
            raise RuntimeError("unexpected tensor probe result")
        if device == "mps":
            torch.mps.synchronize()
    except Exception as exc:
        raise SmokeTrainingError(
            f"PyTorch could not complete a tensor operation on {device}."
        ) from exc


def _select_device(
    torch: Any,
    requested: DeviceChoice,
) -> tuple[str, str | None]:
    silent_fallback = os.getenv("PYTORCH_ENABLE_MPS_FALLBACK") == "1"
    if requested == "mps":
        if silent_fallback:
            raise SmokeTrainingError(
                "MPS smoke is refused while PYTORCH_ENABLE_MPS_FALLBACK=1; "
                "unset it so CPU work cannot be mistaken for Apple GPU work."
            )
        if not _mps_is_available(torch):
            raise SmokeTrainingError("Apple MPS is not available in this environment.")
        _probe_device(torch, "mps")
        return "mps", None

    if requested == "auto" and _mps_is_available(torch) and not silent_fallback:
        try:
            _probe_device(torch, "mps")
        except SmokeTrainingError:
            _probe_device(torch, "cpu")
            return "cpu", "mpsProbeFailedCpuFallback"
        return "mps", None

    _probe_device(torch, "cpu")
    if requested == "auto" and silent_fallback:
        return "cpu", "mpsSilentFallbackEnabledCpuSelected"
    if requested == "auto":
        return "cpu", "mpsUnavailableCpuSelected"
    return "cpu", None


def _configure_determinism(
    torch: Any,
    *,
    device: str,
    seed: str,
) -> dict[str, Any]:
    integer_seed = int.from_bytes(
        hashlib.sha256(seed.encode()).digest()[:8],
        "big",
    ) % (2**63 - 1)
    torch.manual_seed(integer_seed)
    if device == "mps":
        # PyTorch 2.13 reports that embedding backward currently reaches
        # index_put_with_accumulate_mps, which has no deterministic
        # implementation.  Warn-only is allowed solely for this smoke and is
        # recorded as non-deterministic/non-publishable in the metadata.
        torch.use_deterministic_algorithms(True, warn_only=True)
        return {
            "deterministic": False,
            "mode": "warnOnlyMps",
            "reason": "MPS backward contains an operation without a deterministic implementation.",
        }
    torch.use_deterministic_algorithms(True)
    return {
        "deterministic": True,
        "mode": "strict",
        "reason": None,
    }


def _smoke_row() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "windowId": "UNTRAINED_SMOKE_ONLY:0000",
        "frameCount": FRAME_COUNT,
        "inputs": {
            "melodyMidi": [
                60,
                62,
                64,
                65,
                67,
                69,
                71,
                72,
                72,
                71,
                69,
                67,
                65,
                64,
                62,
                60,
            ],
            "melodyRole": [0] * FRAME_COUNT,
            "metricalSlot": list(range(FRAME_COUNT)),
            "barIndex": [0] * FRAME_COUNT,
            "keyRoot": [0] * FRAME_COUNT,
            "mode": [0] * FRAME_COUNT,
        },
        "targets": {
            "event": [2] + [1] * 7 + [2] + [1] * 7,
            "root": [0] * 8 + [7] * 8,
            "quality": [0] * FRAME_COUNT,
            "inversion": [0] * FRAME_COUNT,
            "bass": [0] * FRAME_COUNT,
            "extensions": [[0] * 8 for _ in range(FRAME_COUNT)],
        },
    }


def _run_one_optimizer_step(
    torch: Any,
    *,
    device: str,
    seed: str,
) -> tuple[Any, dict[str, Any]]:
    determinism = _configure_determinism(torch, device=device, seed=seed)
    config = load_model_config(MODEL_CONFIG_PATH)
    setup_started = time.perf_counter()
    model = build_harmony_forge_model(config, torch_module=torch).to(device)
    model.train()
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=3e-4,
        weight_decay=0.01,
    )
    batch = build_masked_batch(
        [_smoke_row()],
        [
            MaskPlan(
                kind="fullHarmony",
                masked=(True,) * FRAME_COUNT,
            )
        ],
        torch_module=torch,
        device=device,
    )
    setup_seconds = time.perf_counter() - setup_started

    step_started = time.perf_counter()
    optimizer.zero_grad(set_to_none=True)
    outputs = model(batch)
    loss, _ = factorized_active_head_loss(
        outputs,
        batch,
        torch_module=torch,
    )
    if not bool(torch.isfinite(loss)):
        raise SmokeTrainingError("smoke loss became non-finite")
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    optimizer.step()
    if device == "mps":
        torch.mps.synchronize()
    step_seconds = time.perf_counter() - step_started

    parameter_count = sum(parameter.numel() for parameter in model.parameters())
    expected_parameters = config.estimated_parameter_count()
    if parameter_count != expected_parameters:
        raise SmokeTrainingError(
            "production model parameter count changed during the smoke"
        )
    return model, {
        "modelId": config.model_id,
        "parameterCount": parameter_count,
        "loss": float(loss.detach().cpu()),
        "setupSeconds": setup_seconds,
        "optimizerStepSeconds": step_seconds,
        "determinism": determinism,
    }


def _state_signature(state: dict[str, Any]) -> dict[str, tuple[tuple[int, ...], str]]:
    return {
        name: (tuple(int(size) for size in tensor.shape), str(tensor.dtype))
        for name, tensor in state.items()
    }


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_write_checkpoint(
    state: dict[str, Any],
    output_path: Path,
    *,
    safetensors_module: Any | None = None,
) -> dict[str, Any]:
    if not state:
        raise SmokeTrainingError("refusing to write an empty smoke state")
    safetensors = safetensors_module or _import_safetensors_torch()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output_path.name}.",
        suffix=".tmp",
        dir=output_path.parent,
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    expected_signature = _state_signature(state)
    try:
        safetensors.save_file(state, str(temporary_path))
        validate_safetensors_file(temporary_path)
        reloaded = safetensors.load_file(str(temporary_path), device="cpu")
        if _state_signature(reloaded) != expected_signature:
            raise SmokeTrainingError(
                "reloaded smoke checkpoint does not match the model state"
            )
        # Opened read-write rather than read-only, and without truncating what
        # safetensors just wrote. Windows implements fsync as FlushFileBuffers,
        # which needs a handle carrying write access and fails with EBADF
        # without it; POSIX accepts a read-only descriptor, so this only shows
        # up on Windows.
        with temporary_path.open("rb+") as handle:
            os.fsync(handle.fileno())
        temporary_path.replace(output_path)
        validate_safetensors_file(output_path)
        final_state = safetensors.load_file(str(output_path), device="cpu")
        if _state_signature(final_state) != expected_signature:
            raise SmokeTrainingError(
                "atomically installed smoke checkpoint failed reload validation"
            )
        return {
            "file": output_path.name,
            "bytes": output_path.stat().st_size,
            "sha256": _sha256_file(output_path),
            "reloadedAndValidated": True,
        }
    except Exception as exc:
        if isinstance(exc, SmokeTrainingError):
            raise
        raise SmokeTrainingError(
            "SafeTensors smoke checkpoint export failed"
        ) from exc
    finally:
        temporary_path.unlink(missing_ok=True)


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(
                payload,
                handle,
                ensure_ascii=True,
                separators=(",", ":"),
                sort_keys=True,
            )
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _artifact_stem(device: str) -> str:
    if device == "mps":
        return "UNTRAINED_MPS_SMOKE_ONLY"
    return "UNTRAINED_CPU_SMOKE_ONLY"


def _validate_output_directory(output_directory: Path) -> Path:
    resolved = output_directory.expanduser().resolve()
    runtime_registry = (PROJECT_ROOT / "models" / MODEL_ID).resolve()
    try:
        resolved.relative_to(runtime_registry)
    except ValueError:
        pass
    else:
        raise SmokeTrainingError(
            "smoke output cannot be placed in the runtime model registry"
        )
    if any((resolved / name).exists() for name in ("manifest.json", "current.json")):
        raise SmokeTrainingError(
            "smoke output cannot share a directory with runtime checkpoint metadata"
        )
    return resolved


def run_smoke(options: SmokeOptions) -> dict[str, Any]:
    options.validate()
    output_directory = _validate_output_directory(options.output_directory)
    torch = _import_torch()
    device, fallback_reason = _select_device(torch, options.device)
    model, step = _run_one_optimizer_step(
        torch,
        device=device,
        seed=options.seed,
    )
    stem = _artifact_stem(device)
    checkpoint: dict[str, Any] | None = None
    if options.write_checkpoint:
        state = {
            name: tensor.detach().cpu().contiguous()
            for name, tensor in model.state_dict().items()
        }
        checkpoint = _atomic_write_checkpoint(
            state,
            output_directory / f"{stem}.safetensors",
        )

    metadata = {
        "schemaVersion": 1,
        "artifactKind": "optimizerStepSmokeOnly",
        "modelId": step["modelId"],
        "trained": False,
        "publishable": False,
        "runtimeCompatible": False,
        "warning": (
            "UNTRAINED SMOKE OUTPUT. It proves runtime wiring only and must "
            "never be used or distributed as a music model."
        ),
        "requestedDevice": options.device,
        "actualDevice": device,
        "fallbackReason": fallback_reason,
        "pytorchVersion": str(torch.__version__),
        "dtype": "float32",
        "seed": options.seed,
        "frames": FRAME_COUNT,
        "batchSize": BATCH_SIZE,
        "optimizerSteps": OPTIMIZER_STEPS,
        "parameterCount": step["parameterCount"],
        "loss": step["loss"],
        "setupSeconds": step["setupSeconds"],
        "optimizerStepSeconds": step["optimizerStepSeconds"],
        "determinism": step["determinism"],
        "checkpoint": checkpoint,
        "runtimeManifestCreated": False,
        "currentPointerCreated": False,
    }
    metadata_path = output_directory / f"{stem}.metadata.json"
    _atomic_write_json(metadata_path, metadata)
    return {
        **metadata,
        "metadataFile": str(metadata_path),
        "outputDirectory": str(output_directory),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="smoke-harmonyforge-training",
        description=(
            "Run one non-publishable HarmonyForge optimizer-step smoke. "
            "This does not train a usable music model."
        ),
    )
    parser.add_argument(
        "--device",
        choices=("auto", "cpu", "mps"),
        default="auto",
    )
    parser.add_argument(
        "--output-directory",
        type=Path,
        default=DEFAULT_OUTPUT_DIRECTORY,
    )
    parser.add_argument("--seed", default="1729")
    parser.add_argument(
        "--no-checkpoint",
        action="store_true",
        help="run forward/backward/optimizer only and write metadata without weights",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        result = run_smoke(
            SmokeOptions(
                device=arguments.device,
                output_directory=arguments.output_directory,
                seed=arguments.seed,
                write_checkpoint=not arguments.no_checkpoint,
            )
        )
    except SmokeTrainingError as exc:
        print(f"HarmonyForge smoke failed: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
