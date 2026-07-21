"""Top-level API router."""

from fastapi import APIRouter

from app.api.routes import ranking, system

api_router = APIRouter()
api_router.include_router(system.router)
api_router.include_router(ranking.router)

