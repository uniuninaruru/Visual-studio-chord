"""Health, device, and model-discovery routes."""

import platform

from fastapi import APIRouter, Request

from app import __version__
from app.core.auth import is_valid_shared_token
from app.core.errors import documented_errors
from app.core.request_id import resolve_request_id
from app.schemas.api import HealthResponse, ModelInfo, ModelsResponse
from app.services.device import DeviceResponse, detect_device
from app.services.models import ModelManager, get_models

router = APIRouter(tags=["system"])


@router.get(
    "/health",
    response_model=HealthResponse,
    operation_id="getHealth",
    responses=documented_errors(500),
)
def health(request: Request) -> HealthResponse:
    manager: ModelManager = request.app.state.model_manager
    settings = request.app.state.settings
    device_info = detect_device()
    active_model = manager.active_model
    active_info = manager.model_info(active_model, device_info)
    return HealthResponse(
        request_id=resolve_request_id(request),
        status="ok",
        service="visual-studio-chord-api",
        version=__version__,
        python_version=platform.python_version(),
        platform_system=platform.system() or "Unknown",
        platform_machine=platform.machine() or "Unknown",
        auth_required=settings.shared_token is not None,
        inference_authorized=is_valid_shared_token(
            settings.shared_token,
            request.headers.get("X-MTC-Token"),
        ),
        active_model=active_model,
        runtime=active_info.runtime,
        backend=active_info.backend,
        mock=active_info.mock,
        fallback_reason=manager.fallback_reason,
    )


@router.get(
    "/device",
    response_model=DeviceResponse,
    operation_id="getDevice",
    responses=documented_errors(500),
)
def device(request: Request) -> DeviceResponse:
    return DeviceResponse(
        request_id=resolve_request_id(request),
        **detect_device().model_dump(),
    )


@router.get(
    "/models",
    response_model=ModelsResponse,
    operation_id="listModels",
    responses=documented_errors(500),
)
def models(request: Request) -> ModelsResponse:
    manager: ModelManager = request.app.state.model_manager
    response = get_models(
        detect_device(),
        manager,
        request_id=resolve_request_id(request),
    )
    harmony_manager = request.app.state.harmony_model_manager
    for manifest in harmony_manager.discovery_models():
        mock = bool(manifest["mock"])
        response.models.append(
            ModelInfo(
                id=str(manifest["modelId"]),
                name=(
                    "MOCK HarmonyForge development generator"
                    if mock
                    else "HarmonyForge BiMask neural harmonizer"
                ),
                runtime=manifest["runtime"],
                available=bool(manifest["available"]),
                loaded=bool(manifest["loaded"]),
                capabilities=["generateHarmony"],
                backend="mock" if mock else "pytorch",
                mock=mock,
                task=manifest.get("task"),  # type: ignore[arg-type]
            )
        )
    return response
