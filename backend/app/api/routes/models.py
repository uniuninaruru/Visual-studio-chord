"""Strict allow-list model lifecycle routes."""

from fastapi import APIRouter, HTTPException, Request, Security, status

from app.core.auth import shared_token_header
from app.core.errors import documented_errors
from app.core.request_id import resolve_request_id
from app.schemas.api import ModelActionRequest, ModelActionResponse
from app.services.device import detect_device
from app.services.models import ModelConflictError, ModelManager
from app.services.runtime import ModelUnavailableError

router = APIRouter(tags=["models"])


@router.post(
    "/models/load",
    response_model=ModelActionResponse,
    operation_id="loadModel",
    dependencies=[Security(shared_token_header)],
    responses=documented_errors(401, 403, 422, 500, 503),
)
def load_model(body: ModelActionRequest, request: Request) -> ModelActionResponse:
    manager: ModelManager = request.app.state.model_manager
    request_id = resolve_request_id(request, body.request_id)
    try:
        manager.load(body.model_id)
    except ModelUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return _action_response(
        manager,
        body.model_id,
        request_id=request_id,
    )


@router.post(
    "/models/unload",
    response_model=ModelActionResponse,
    operation_id="unloadModel",
    dependencies=[Security(shared_token_header)],
    responses=documented_errors(401, 403, 409, 422, 500),
)
def unload_model(body: ModelActionRequest, request: Request) -> ModelActionResponse:
    manager: ModelManager = request.app.state.model_manager
    request_id = resolve_request_id(request, body.request_id)
    try:
        manager.unload(body.model_id)
    except ModelConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return _action_response(
        manager,
        body.model_id,
        request_id=request_id,
    )


def _action_response(
    manager: ModelManager,
    model_id: str,
    *,
    request_id: str,
) -> ModelActionResponse:
    device = detect_device()
    active_model = manager.active_model
    active_info = manager.model_info(active_model, device)
    return ModelActionResponse(
        request_id=request_id,
        model=manager.model_info(model_id, device),
        active_model=active_model,
        active_runtime=active_info.runtime,
        active_backend=active_info.backend,
        mock=active_info.mock,
        cache_size=manager.cache_size,
        fallback_reason=manager.fallback_reason,
    )
