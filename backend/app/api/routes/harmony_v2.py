"""Version-two asynchronous neural harmony preview routes."""

from fastapi import APIRouter, HTTPException, Request, Security, status

from app.core.auth import shared_token_header
from app.core.errors import documented_errors_v2
from app.schemas.api import (
    HarmonyCancelRequest,
    HarmonyGenerateRequest,
    HarmonyJobResponse,
    HarmonyModelId,
    HarmonyModelManifestResponse,
)
from app.services.harmony_jobs import (
    HarmonyJobCapacityError,
    HarmonyJobConflictError,
    HarmonyJobManager,
)
from app.services.harmony_models import HarmonyModelManager

router = APIRouter(prefix="/v2", tags=["neural-harmony"])


@router.post(
    "/harmony/generate",
    response_model=HarmonyJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="startHarmonyGeneration",
    dependencies=[Security(shared_token_header)],
    responses=documented_errors_v2(401, 403, 409, 422, 500, 503),
)
def generate_harmony(
    body: HarmonyGenerateRequest,
    request: Request,
) -> HarmonyJobResponse:
    jobs: HarmonyJobManager = request.app.state.harmony_jobs
    try:
        return jobs.submit(body)
    except HarmonyJobCapacityError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE) from exc
    except HarmonyJobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT) from exc


@router.get(
    "/jobs/{request_id}",
    response_model=HarmonyJobResponse,
    operation_id="getHarmonyJob",
    dependencies=[Security(shared_token_header)],
    responses=documented_errors_v2(401, 403, 404, 422, 500),
)
def get_harmony_job(request_id: str, request: Request) -> HarmonyJobResponse:
    jobs: HarmonyJobManager = request.app.state.harmony_jobs
    try:
        return jobs.get(request_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND) from exc


@router.post(
    "/harmony/cancel/{request_id}",
    response_model=HarmonyJobResponse,
    operation_id="cancelHarmonyGeneration",
    dependencies=[Security(shared_token_header)],
    responses=documented_errors_v2(401, 403, 404, 409, 422, 500),
)
def cancel_harmony(
    request_id: str,
    body: HarmonyCancelRequest,
    request: Request,
) -> HarmonyJobResponse:
    if request_id != body.request_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT)
    jobs: HarmonyJobManager = request.app.state.harmony_jobs
    try:
        return jobs.cancel(request_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND) from exc
    except HarmonyJobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT) from exc


@router.get(
    "/models/{model_id}/manifest",
    response_model=HarmonyModelManifestResponse,
    operation_id="getHarmonyModelManifest",
    responses=documented_errors_v2(404, 422, 500),
)
def harmony_manifest(
    model_id: HarmonyModelId,
    request: Request,
) -> HarmonyModelManifestResponse:
    manager: HarmonyModelManager = request.app.state.harmony_model_manager
    manifest = manager.manifest(model_id)
    return HarmonyModelManifestResponse(
        request_id=request.state.request_id,
        model_id=model_id,
        available=bool(manifest["available"]),
        mock=bool(manifest["mock"]),
        trained=bool(manifest["trained"]),
        evaluation_status=manifest["evaluationStatus"],  # type: ignore[arg-type]
        checkpoint_sha256=manifest["checkpointSha256"],  # type: ignore[arg-type]
        tokenizer_sha256=str(manifest["tokenizerSha256"]),
        architecture=manifest["architecture"],  # type: ignore[arg-type]
        supported_devices=manifest["supportedDevices"],  # type: ignore[arg-type]
        unavailable_reason=manifest["unavailableReason"],  # type: ignore[arg-type]
    )
