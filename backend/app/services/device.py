"""Optional PyTorch/ONNX device discovery with a reliable CPU fallback."""

from __future__ import annotations

import importlib
import sys
from functools import lru_cache
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.schemas.api import ApiResponse, RuntimeDevice


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class DeviceInfo(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        json_schema_serialization_defaults_required=True,
    )

    selected_device: RuntimeDevice
    torch_available: bool
    onnx_runtime_available: bool = False
    cuda_available: bool
    torch_cuda_available: bool = False
    onnx_cuda_available: bool = False
    mps_available: bool
    coreml_available: bool = False
    directml_available: bool = False
    device_name: str
    cuda_device_count: int
    total_memory_mb: int | None = None


class DeviceResponse(ApiResponse, DeviceInfo):
    """Device capabilities with the shared API response envelope fields."""


def _import_torch() -> Any:
    return importlib.import_module("torch")


def _import_onnxruntime() -> Any:
    return importlib.import_module("onnxruntime")


def _safe_bool(callable_value: Any) -> bool:
    try:
        return bool(callable_value())
    except Exception:
        return False


@lru_cache(maxsize=1)
def detect_device() -> DeviceInfo:
    """Detect native accelerators without requiring either optional package."""

    torch, torch_available = _optional_import(_import_torch)
    onnxruntime, onnx_runtime_available = _optional_import(_import_onnxruntime)

    cuda = getattr(torch, "cuda", None) if torch_available else None
    torch_cuda_available = bool(
        cuda and _safe_bool(getattr(cuda, "is_available", lambda: False))
    )
    mps_backend = getattr(getattr(torch, "backends", None), "mps", None)
    mps_available = bool(
        mps_backend
        and _safe_bool(getattr(mps_backend, "is_available", lambda: False))
    )

    providers: set[str] = set()
    if onnx_runtime_available:
        try:
            providers = set(onnxruntime.get_available_providers())
        except Exception:
            providers = set()
    onnx_cuda_available = "CUDAExecutionProvider" in providers
    coreml_available = sys.platform == "darwin" and "CoreMLExecutionProvider" in providers
    directml_available = sys.platform.startswith("win") and "DmlExecutionProvider" in providers
    cuda_available = torch_cuda_available or onnx_cuda_available

    cuda_device_count = 0
    device_name = "CPU"
    total_memory_mb: int | None = None
    if torch_cuda_available:
        try:
            cuda_device_count = int(cuda.device_count())
        except Exception:
            cuda_device_count = 1
        try:
            device_name = str(cuda.get_device_name(0))
        except Exception:
            device_name = "CUDA device"
        try:
            properties = cuda.get_device_properties(0)
            total_memory_mb = int(properties.total_memory) // (1024 * 1024)
        except Exception:
            total_memory_mb = None
    elif onnx_cuda_available:
        cuda_device_count = 1
        device_name = "CUDA device"

    selected_device: RuntimeDevice = "cpu"
    if cuda_available:
        selected_device = "cuda"
    elif sys.platform == "darwin" and mps_available:
        selected_device = "mps"
        device_name = "Apple Metal (MPS)"
    elif coreml_available:
        selected_device = "coreml"
        device_name = "Apple Core ML"
    elif directml_available:
        selected_device = "directml"
        device_name = "Windows DirectML"

    return DeviceInfo(
        selected_device=selected_device,
        torch_available=torch_available,
        onnx_runtime_available=onnx_runtime_available,
        cuda_available=cuda_available,
        torch_cuda_available=torch_cuda_available,
        onnx_cuda_available=onnx_cuda_available,
        mps_available=mps_available,
        coreml_available=coreml_available,
        directml_available=directml_available,
        device_name=device_name,
        cuda_device_count=cuda_device_count,
        total_memory_mb=total_memory_mb,
    )


def selected_torch_device(device: DeviceInfo) -> RuntimeDevice:
    if device.torch_cuda_available:
        return "cuda"
    if device.mps_available and device.torch_available:
        return "mps"
    return "cpu"


def selected_onnx_device(device: DeviceInfo) -> RuntimeDevice:
    if device.onnx_cuda_available:
        return "cuda"
    if device.coreml_available:
        return "coreml"
    if device.directml_available:
        return "directml"
    return "cpu"


def _optional_import(loader: Any) -> tuple[Any | None, bool]:
    try:
        return loader(), True
    except Exception:
        return None, False
