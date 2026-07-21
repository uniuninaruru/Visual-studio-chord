"""Health, device, and model-discovery routes."""

from fastapi import APIRouter

from app import __version__
from app.schemas.api import HealthResponse, ModelsResponse
from app.services.device import DeviceInfo, detect_device
from app.services.models import get_models

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="music-theory-composer-api",
        version=__version__,
    )


@router.get("/device", response_model=DeviceInfo)
def device() -> DeviceInfo:
    return detect_device()


@router.get("/models", response_model=ModelsResponse)
def models() -> ModelsResponse:
    return get_models(detect_device())

