"""Top-level API router."""

from fastapi import APIRouter

from app.api.routes import models, preferences, ranking, system

api_router = APIRouter()
api_router.include_router(system.router)
api_router.include_router(ranking.router)
api_router.include_router(preferences.router)
api_router.include_router(models.router)
