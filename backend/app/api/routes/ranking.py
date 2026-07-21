"""Linear and optional accelerated ranking endpoint."""

from fastapi import APIRouter, HTTPException, Request, Security, status

from app.core.auth import shared_token_header
from app.core.errors import documented_errors
from app.core.request_id import resolve_request_id
from app.schemas.api import RankRequest, RankResponse
from app.services.models import ModelManager
from app.services.preferences import PreferenceStore
from app.services.runtime import ModelUnavailableError, RuntimeInferenceError

router = APIRouter(tags=["ranking"])


@router.post(
    "/rank",
    response_model=RankResponse,
    response_model_exclude_none=True,
    operation_id="rankCandidates",
    dependencies=[Security(shared_token_header)],
    responses=documented_errors(401, 403, 422, 500, 503),
)
def rank(body: RankRequest, request: Request) -> RankResponse:
    manager: ModelManager = request.app.state.model_manager
    preference_store: PreferenceStore = request.app.state.preference_store
    request_id = resolve_request_id(request, body.request_id)
    # The browser persists the complete category profile and also mirrors each
    # feedback event to the process-local store.  When that complete profile is
    # supplied, adding the mirrored server weights would count the same signal
    # twice.  Omission keeps the endpoint useful for clients that rely only on
    # the server-side update API; an explicitly empty profile remains an
    # authoritative reset.
    preference_weights = (
        dict(body.preference_weights)
        if "preference_weights" in body.model_fields_set
        else preference_store.get_weights(body.preference_category)
    )
    try:
        outcome = manager.rank(
            body.model_id,
            body.candidates,
            preference_weights,
            batch_size=body.batch_size,
            allow_cpu_fallback=body.allow_cpu_fallback,
        )
    except (ModelUnavailableError, RuntimeInferenceError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return RankResponse(
        request_id=request_id,
        ranked=outcome.ranked,
        device=outcome.device,
        model_id=outcome.model_id,
        runtime=outcome.runtime,
        batch_size=outcome.batch_size,
        backend=outcome.backend,
        mock=outcome.mock,
        fallback_reason=outcome.fallback_reason or manager.fallback_reason,
    )
