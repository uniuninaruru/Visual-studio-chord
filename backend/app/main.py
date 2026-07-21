"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.router import api_router
from app.core.config import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build an application using validated, loopback-only settings."""

    resolved_settings = settings or Settings.from_env()
    application = FastAPI(
        title=resolved_settings.app_name,
        version=__version__,
    )
    application.state.settings = resolved_settings
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved_settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Accept", "Content-Type"],
    )
    application.include_router(api_router, prefix="/api")
    return application


app = create_app()

