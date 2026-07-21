"""Shared-token verification and its OpenAPI declaration."""

import hmac

from fastapi.security import APIKeyHeader

shared_token_header = APIKeyHeader(
    name="X-MTC-Token",
    scheme_name="MtcSharedToken",
    description=(
        "Shared LAN token. Required only when GET /api/health reports "
        "authRequired=true."
    ),
    auto_error=False,
)


def is_valid_shared_token(expected: str | None, provided: str | None) -> bool:
    """Return whether protected inference is authorized for this request."""

    if expected is None:
        return True
    if provided is None:
        return False
    return hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8"))
