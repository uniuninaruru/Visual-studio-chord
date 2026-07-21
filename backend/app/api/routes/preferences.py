"""Preference-learning routes."""

from fastapi import APIRouter, HTTPException, Request, Security, status

from app.core.auth import shared_token_header
from app.core.errors import documented_errors
from app.core.request_id import resolve_request_id
from app.schemas.api import PreferenceUpdateRequest, PreferenceUpdateResponse
from app.services.preferences import PreferenceCapacityError, PreferenceStore

router = APIRouter(tags=["preferences"])


@router.post(
    "/preferences/update",
    response_model=PreferenceUpdateResponse,
    operation_id="updatePreferences",
    dependencies=[Security(shared_token_header)],
    responses=documented_errors(401, 403, 409, 422, 500),
)
def update_preferences(
    update: PreferenceUpdateRequest,
    request: Request,
) -> PreferenceUpdateResponse:
    store: PreferenceStore = request.app.state.preference_store
    try:
        return store.update(
            update,
            request_id=resolve_request_id(request, update.request_id),
        )
    except PreferenceCapacityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
