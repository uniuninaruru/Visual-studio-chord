"""Environment-backed application settings with safe CORS validation."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from ipaddress import ip_address
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
)
PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MODEL_DIRECTORY = PROJECT_ROOT / "models"
DEFAULT_NEURAL_CONFIG_PATH = (
    PROJECT_ROOT
    / "configs"
    / "models"
    / "harmonyforge-bimask-base-v1.yaml"
)
InferenceModelPreference = Literal[
    "auto",
    "corpus",
    "linear",
    "mlp",
    "onnx",
    "mock-deterministic",
]


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
    app_name: str = "Visual studio chord API"
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS
    inference_model: InferenceModelPreference = "auto"
    model_directory: Path = DEFAULT_MODEL_DIRECTORY
    neural_config_path: Path = DEFAULT_NEURAL_CONFIG_PATH
    enable_neural_mock: bool = False
    enable_research_checkpoint: bool = False
    shared_token: str | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        validated = tuple(validate_cors_origin(origin) for origin in self.cors_origins)
        if not validated:
            raise ValueError("At least one CORS origin is required")
        object.__setattr__(self, "cors_origins", tuple(dict.fromkeys(validated)))
        if self.inference_model not in {
            "auto",
            "corpus",
            "linear",
            "mlp",
            "onnx",
            "mock-deterministic",
        }:
            raise ValueError(
                "MTC_INFERENCE_MODEL must be auto, corpus, linear, mlp, onnx, "
                "or mock-deterministic"
            )
        object.__setattr__(self, "model_directory", self.model_directory.expanduser().resolve())
        object.__setattr__(
            self,
            "neural_config_path",
            self.neural_config_path.expanduser().resolve(),
        )
        if self.shared_token is not None and not re.fullmatch(
            r"[A-Za-z0-9_-]{16,512}",
            self.shared_token,
        ):
            raise ValueError(
                "MTC_SHARED_TOKEN must be a 16 to 512 character base64url-safe value"
            )

    @classmethod
    def from_env(cls) -> Settings:
        raw_origins = os.getenv("MTC_CORS_ORIGINS")
        origins = (
            DEFAULT_CORS_ORIGINS
            if raw_origins is None
            else tuple(origin for origin in raw_origins.split(",") if origin.strip())
        )
        inference_model = os.getenv("MTC_INFERENCE_MODEL", "auto").strip().lower()
        shared_token = os.getenv("MTC_SHARED_TOKEN") or None
        model_directory = Path(
            os.getenv("MODEL_DIRECTORY", str(DEFAULT_MODEL_DIRECTORY))
        )
        neural_config_path = Path(
            os.getenv(
                "NEURAL_MODEL_CONFIG",
                str(DEFAULT_NEURAL_CONFIG_PATH),
            )
        )
        return cls(  # type: ignore[arg-type]
            cors_origins=origins,
            inference_model=inference_model,
            model_directory=model_directory,
            neural_config_path=neural_config_path,
            enable_neural_mock=_environment_bool("MTC_ENABLE_NEURAL_MOCK"),
            enable_research_checkpoint=_environment_bool(
                "MTC_ENABLE_RESEARCH_CHECKPOINT"
            ),
            shared_token=shared_token,
        )


def _environment_bool(name: str) -> bool:
    value = os.getenv(name, "false").strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off", ""}:
        return False
    raise ValueError(f"{name} must be a boolean value")
