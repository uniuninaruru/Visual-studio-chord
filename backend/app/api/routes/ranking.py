"""Deterministic Phase 1 ranking endpoint."""

from fastapi import APIRouter

from app.schemas.api import RankRequest, RankResponse
from app.services.device import detect_device
from app.services.ranking import rank_candidates

router = APIRouter(tags=["ranking"])


@router.post("/rank", response_model=RankResponse)
def rank(request: RankRequest) -> RankResponse:
    ranked = rank_candidates(request.candidates, request.preference_weights)
    return RankResponse(ranked=ranked, device=detect_device().selected_device)

