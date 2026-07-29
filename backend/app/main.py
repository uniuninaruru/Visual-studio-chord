"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.api.router import api_router
from app.core.auth import is_valid_shared_token
from app.core.config import Settings
from app.core.errors import error_response
from app.core.request_id import normalize_request_id, resolve_request_id
from app.services.harmony_jobs import HarmonyJobManager
from app.services.harmony_models import HarmonyModelManager
from app.services.models import ModelManager
from app.services.preferences import PreferenceStore

logger = logging.getLogger(__name__)


def _requires_shared_token(method: str, path: str) -> bool:
    if method.upper() == "OPTIONS":
        return False
    return (
        path == "/api/rank"
        or path.startswith("/api/v2/harmony/")
        or path.startswith("/api/v2/jobs/")
        or path.startswith("/api/preferences/")
        or (method.upper() != "GET" and path.startswith("/api/models/"))
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build an application using validated, loopback-only settings."""

    resolved_settings = settings or Settings.from_env()
    harmony_model_manager = HarmonyModelManager(
        model_directory=resolved_settings.model_directory,
        config_path=resolved_settings.neural_config_path,
        allow_research=resolved_settings.enable_research_checkpoint,
        enable_mock=resolved_settings.enable_neural_mock,
    )
    harmony_jobs = HarmonyJobManager(harmony_model_manager)

    @asynccontextmanager
    async def lifespan(_application: FastAPI):
        yield
        harmony_jobs.shutdown()

    application = FastAPI(
        title=resolved_settings.app_name,
        version=__version__,
        lifespan=lifespan,
    )
    application.state.settings = resolved_settings
    application.state.model_manager = ModelManager(
        resolved_settings.inference_model,
        model_directory=resolved_settings.model_directory,
    )
    application.state.harmony_model_manager = harmony_model_manager
    application.state.harmony_jobs = harmony_jobs
    application.state.preference_store = PreferenceStore()

    @application.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request,
        _exc: RequestValidationError,
    ) -> JSONResponse:
        return error_response(
            resolve_request_id(request),
            422,
            api_version="2" if request.url.path.startswith("/api/v2/") else "1",
        )

    @application.exception_handler(StarletteHTTPException)
    async def handle_http_error(
        request: Request,
        exc: StarletteHTTPException,
    ) -> JSONResponse:
        return error_response(
            resolve_request_id(request),
            exc.status_code,
            headers=exc.headers,
            api_version="2" if request.url.path.startswith("/api/v2/") else "1",
        )

    @application.middleware("http")
    async def attach_contract_headers(request, call_next):
        request.state.request_id = normalize_request_id(request.headers.get("X-Request-ID"))
        try:
            if resolved_settings.shared_token and _requires_shared_token(
                request.method,
                request.url.path,
            ):
                provided_token = request.headers.get("X-MTC-Token")
                authenticated = is_valid_shared_token(
                    resolved_settings.shared_token,
                    provided_token,
                )
                if not authenticated:
                    status_code = 401 if provided_token is None else 403
                    response = error_response(
                        request.state.request_id,
                        status_code,
                        api_version=(
                            "2" if request.url.path.startswith("/api/v2/") else "1"
                        ),
                    )
                else:
                    response = await call_next(request)
            else:
                response = await call_next(request)
        except Exception:
            logger.exception(
                "Unhandled API error request_id=%s",
                request.state.request_id,
            )
            response = error_response(
                request.state.request_id,
                500,
                api_version="2" if request.url.path.startswith("/api/v2/") else "1",
            )
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["X-API-Version"] = (
            "2" if request.url.path.startswith("/api/v2/") else "1"
        )
        return response

    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved_settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=[
            "Accept",
            "Content-Type",
            "X-API-Version",
            "X-MTC-Token",
            "X-Request-ID",
        ],
        expose_headers=["X-API-Version", "X-Request-ID"],
    )
    application.include_router(api_router, prefix="/api")
    return application


app = create_app()
