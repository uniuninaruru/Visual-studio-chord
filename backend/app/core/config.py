"""Environment-backed application settings with safe CORS validation."""

from __future__ import annotations

import os
from dataclasses import dataclass
from ipaddress import ip_address
from urllib.parse import urlsplit

DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
)


def _is_loopback_host(host: str) -> bool:
    if host.lower() == "localhost":
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


def validate_cors_origin(origin: str) -> str:
    """Validate and normalize one HTTP(S), loopback-only CORS origin."""

    normalized = origin.strip().rstrip("/")
    if not normalized or normalized == "*":
        raise ValueError("CORS origins must be explicit loopback HTTP(S) origins")

    parsed = urlsplit(normalized)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
        or not _is_loopback_host(parsed.hostname)
    ):
        raise ValueError(f"CORS origin is not a loopback HTTP(S) origin: {origin!r}")

    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError(f"CORS origin has an invalid port: {origin!r}") from exc
    if port is not None and port == 0:
        raise ValueError(f"CORS origin has an invalid port: {origin!r}")
    return normalized


@dataclass(frozen=True, slots=True)
class Settings:
    app_name: str = "Music Theory Composer API"
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS

    def __post_init__(self) -> None:
        validated = tuple(validate_cors_origin(origin) for origin in self.cors_origins)
        if not validated:
            raise ValueError("At least one CORS origin is required")
        object.__setattr__(self, "cors_origins", tuple(dict.fromkeys(validated)))

    @classmethod
    def from_env(cls) -> Settings:
        raw_origins = os.getenv("MTC_CORS_ORIGINS")
        if raw_origins is None:
            return cls()

        origins = tuple(origin for origin in raw_origins.split(",") if origin.strip())
        return cls(cors_origins=origins)
