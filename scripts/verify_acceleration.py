#!/usr/bin/env python3
"""Report the native inference runtimes available to the local API.

This probe intentionally imports optional packages lazily. A missing or broken
GPU runtime never prevents the application from using its deterministic CPU
fallback.
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ONNX_PROVIDER_PRIORITY = (
    "CUDAExecutionProvider",
    "CoreMLExecutionProvider",
    "DmlExecutionProvider",
    "CPUExecutionProvider",
)


def _probe_torch() -> dict[str, Any]:
    result: dict[str, Any] = {
        "installed": False,
        "cpu": False,
        "cuda": False,
        "mps": False,
        "cudaDevice": None,
        "errors": [],
    }
    try:
        import torch
    except Exception as exc:  # optional dependency
        result["errors"].append(f"PyTorch import failed: {type(exc).__name__}")
        return result

    result["installed"] = True
    try:
        tensor = torch.ones(1, device="cpu") + 1
        result["cpu"] = float(tensor.item()) == 2.0
    except Exception as exc:
        result["errors"].append(f"PyTorch CPU probe failed: {type(exc).__name__}")

    try:
        if torch.cuda.is_available():
            # An actual tensor operation catches a visible driver/runtime mismatch.
            tensor = torch.ones(1, device="cuda") + 1
            result["cuda"] = float(tensor.cpu().item()) == 2.0
            result["cudaDevice"] = str(torch.cuda.get_device_name(0))
    except Exception as exc:
        result["errors"].append(f"PyTorch CUDA probe failed: {type(exc).__name__}")

    try:
        mps = getattr(getattr(torch, "backends", None), "mps", None)
        if mps is not None and mps.is_available():
            tensor = torch.ones(1, device="mps") + 1
            result["mps"] = float(tensor.cpu().item()) == 2.0
    except Exception as exc:
        result["errors"].append(f"PyTorch MPS probe failed: {type(exc).__name__}")
    return result


def _probe_onnx_runtime() -> dict[str, Any]:
    result: dict[str, Any] = {
        "installed": False,
        "providers": [],
        "verifiedProviders": [],
        "errors": [],
        "providerErrors": {},
    }
    try:
        import onnxruntime
    except Exception as exc:  # optional dependency
        result["errors"].append(f"ONNX Runtime import failed: {type(exc).__name__}")
        return result

    result["installed"] = True
    try:
        result["providers"] = list(onnxruntime.get_available_providers())
    except Exception as exc:
        result["errors"].append(f"ONNX provider probe failed: {type(exc).__name__}")
        return result

    try:
        model_bytes = _load_builtin_onnx_model()
    except Exception as exc:
        result["errors"].append(f"Embedded ONNX model load failed: {type(exc).__name__}")
        return result

    available = set(result["providers"])
    for provider in ONNX_PROVIDER_PRIORITY:
        if provider not in available:
            continue
        try:
            _run_onnx_smoke(onnxruntime, model_bytes, provider, available)
        except Exception as exc:
            result["providerErrors"][provider] = type(exc).__name__
        else:
            result["verifiedProviders"].append(provider)
    return result


def _load_builtin_onnx_model() -> bytes:
    backend_dir = str(PROJECT_ROOT / "backend")
    inserted = backend_dir not in sys.path
    if inserted:
        sys.path.insert(0, backend_dir)
    try:
        from app.services.runtime import BUILTIN_ONNX_MODEL_BYTES

        return BUILTIN_ONNX_MODEL_BYTES
    finally:
        if inserted:
            sys.path.remove(backend_dir)


def _run_onnx_smoke(
    onnxruntime: Any,
    model_bytes: bytes,
    provider: str,
    available: set[str],
) -> None:
    import numpy

    providers = [provider]
    if provider != "CPUExecutionProvider" and "CPUExecutionProvider" in available:
        providers.append("CPUExecutionProvider")
    session = onnxruntime.InferenceSession(model_bytes, providers=providers)
    active_providers = list(session.get_providers())
    if not active_providers or active_providers[0] != provider:
        raise RuntimeError("requested provider was not activated")
    outputs = session.run(
        None,
        {"features": numpy.zeros((1, 128), dtype=numpy.float32)},
    )
    if not outputs or getattr(outputs[0], "shape", None) != (1, 1):
        raise RuntimeError("provider returned an invalid output")
    if not bool(numpy.isfinite(outputs[0]).all()):
        raise RuntimeError("provider returned a non-finite output")


def _select_runtime(torch_info: dict[str, Any], ort_info: dict[str, Any]) -> str:
    providers = set(ort_info.get("verifiedProviders", []))
    if "CUDAExecutionProvider" in providers:
        return "onnx-cuda"
    if "CoreMLExecutionProvider" in providers:
        return "onnx-coreml"
    if "DmlExecutionProvider" in providers:
        return "onnx-directml"
    if torch_info["cuda"]:
        return "pytorch-cuda"
    if torch_info["mps"]:
        return "pytorch-mps"
    if "CPUExecutionProvider" in providers:
        return "onnx-cpu"
    if torch_info["installed"]:
        return "pytorch-cpu"
    return "deterministic-cpu"


def _torch_device_passed(
    torch_info: dict[str, Any],
    required_device: str | None,
) -> bool:
    return required_device is None or bool(torch_info.get(required_device, False))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    parser.add_argument(
        "--require-gpu",
        action="store_true",
        help="return a non-zero status when no GPU runtime passes the probe",
    )
    parser.add_argument(
        "--require-torch-device",
        choices=("cpu", "cuda", "mps"),
        help=(
            "return a non-zero status unless PyTorch completes a tensor "
            "operation on this exact device"
        ),
    )
    args = parser.parse_args()

    torch_info = _probe_torch()
    ort_info = _probe_onnx_runtime()
    selected = _select_runtime(torch_info, ort_info)
    accelerated = selected not in {"onnx-cpu", "pytorch-cpu", "deterministic-cpu"}
    result = {
        "platform": platform.platform(),
        "selectedRuntime": selected,
        "gpuAvailable": accelerated,
        "cpuFallbackAvailable": True,
        "requiredTorchDevice": args.require_torch_device,
        "torch": torch_info,
        "onnxRuntime": ort_info,
    }

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"Selected runtime: {selected}")
        print(f"GPU available: {'yes' if accelerated else 'no'}")
        if torch_info["cudaDevice"]:
            print(f"CUDA device: {torch_info['cudaDevice']}")
        if ort_info["providers"]:
            print("ONNX providers: " + ", ".join(ort_info["providers"]))
        if ort_info["verifiedProviders"]:
            print("Verified ONNX providers: " + ", ".join(ort_info["verifiedProviders"]))
        errors = [*torch_info["errors"], *ort_info["errors"]]
        for error in errors:
            print(f"Warning: {error}")
        if not accelerated:
            print("The application will continue with its CPU fallback.")

    required_torch_failed = not _torch_device_passed(
        torch_info,
        args.require_torch_device,
    )
    if required_torch_failed and not args.json:
        print(
            "Required PyTorch device probe failed: "
            f"{args.require_torch_device}."
        )
    return 2 if (args.require_gpu and not accelerated) or required_torch_failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
