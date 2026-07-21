"""Versioned, correlation-safe API error responses and OpenAPI metadata."""

from __future__ import annotations

from collections.abc import Mapping

from fastapi.responses import JSONResponse

from app.schemas.api import ErrorInfo, ErrorResponse, PublicErrorCode

_ERRORS: dict[int, tuple[PublicErrorCode, str]] = {
    401: ("AUTHENTICATION_REQUIRED", "Authentication is required."),
    403: ("INVALID_AUTHENTICATION_TOKEN", "Authentication token is invalid."),
    404: ("NOT_FOUND", "Resource not found."),
    405: ("METHOD_NOT_ALLOWED", "Method not allowed."),
    409: ("CONFLICT", "The request conflicts with the current server state."),
    422: ("VALIDATION_ERROR", "Request validation failed."),
    500: ("INTERNAL_ERROR", "An internal server error occurred."),
    503: ("SERVICE_UNAVAILABLE", "The requested service is unavailable."),
}


def error_response(
    request_id: str,
    status_code: int,
    *,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    """Create a stable public error without native exception or path details."""

    code, message = _ERRORS.get(
        status_code,
        (
            "INTERNAL_ERROR" if status_code >= 500 else "HTTP_ERROR",
            (
                "An internal server error occurred."
                if status_code >= 500
                else "Request failed."
            ),
        ),
    )
    payload = ErrorResponse(
        request_id=request_id,
        error=ErrorInfo(code=code, message=message),
    )
    response_headers = dict(headers or {})
    response_headers["X-Request-ID"] = request_id
    response_headers["X-API-Version"] = "1"
    return JSONResponse(
        status_code=status_code,
        content=payload.model_dump(mode="json", by_alias=True),
        headers=response_headers,
    )


def documented_errors(*status_codes: int) -> dict[int, dict[str, object]]:
    """Return reusable FastAPI response documentation for public errors."""

    return {
        status_code: {
            "model": ErrorResponse,
            "description": _ERRORS.get(
                status_code,
                ("HTTP_ERROR", "Request failed."),
            )[1],
        }
        for status_code in status_codes
    }
