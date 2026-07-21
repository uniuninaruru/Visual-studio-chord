"""Validated request correlation IDs shared by all API routes."""

from __future__ import annotations

import re
from uuid import uuid4

from fastapi import Request

_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def normalize_request_id(value: str | None) -> str:
    if value and _REQUEST_ID_PATTERN.fullmatch(value):
        return value
    return uuid4().hex


def resolve_request_id(request: Request, supplied: str | None = None) -> str:
    request_id = supplied or getattr(request.state, "request_id", None)
    resolved = normalize_request_id(request_id)
    request.state.request_id = resolved
    return resolved
