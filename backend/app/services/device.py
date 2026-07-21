"""Optional PyTorch device discovery with a reliable CPU fallback."""

from __future__ import annotations

import importlib
from functools import lru_cache
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class DeviceInfo(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    selected_device: Literal["cpu", "cuda"]
    torch_available: bool
    cuda_available: bool
    mps_available: bool
    device_name: str
    cuda_device_count: int
    total_memory_mb: int | None = None


def _import_torch() -> Any:
    return importlib.import_module("torch")


def _safe_bool(callable_value: Any) -> bool:
    try:
        return bool(callable_value())
    except Exception:
        return False


@lru_cache(maxsize=1)
def detect_device() -> DeviceInfo:
    """Detect CUDA without making PyTorch a required dependency."""

    try:
        torch = _import_torch()
    except Exception:
        return DeviceInfo(
            selected_device="cpu",
            torch_available=False,
            cuda_available=False,
            mps_available=False,
            device_name="CPU",
            cuda_device_count=0,
        )

    cuda = getattr(torch, "cuda", None)
    cuda_available = bool(
        cuda and _safe_bool(getattr(cuda, "is_available", lambda: False))
    )
    cuda_device_count = 0
    device_name = "CPU"
    total_memory_mb: int | None = None

    if cuda_available:
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
            total_memory = int(properties.total_memory)
            total_memory_mb = total_memory // (1024 * 1024)
        except Exception:
            total_memory_mb = None

    mps_backend = getattr(getattr(torch, "backends", None), "mps", None)
    mps_available = bool(
        mps_backend
        and _safe_bool(getattr(mps_backend, "is_available", lambda: False))
    )

    return DeviceInfo(
        selected_device="cuda" if cuda_available else "cpu",
        torch_available=True,
        cuda_available=cuda_available,
        mps_available=mps_available,
        device_name=device_name,
        cuda_device_count=cuda_device_count,
        total_memory_mb=total_memory_mb,
    )
