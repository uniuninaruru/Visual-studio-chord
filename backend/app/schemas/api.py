"""Public JSON contracts for the local inference API."""

from __future__ import annotations

import math
from typing import Annotated, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, StrictFloat, computed_field, model_validator


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        extra="forbid",
    )


RequestId = Annotated[
    str,
    Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$"),
]
BackendKind: TypeAlias = Literal[
    "linear",
    "corpus",
    "pytorch",
    "onnx",
    "browser",
    "mock",
]
RuntimeDevice: TypeAlias = Literal["cpu", "cuda", "mps", "coreml", "directml"]
ServerModelId: TypeAlias = Literal[
    "local-deterministic-v1",
    "harmony-corpus-ngram-v1",
    "local-mlp-v1",
    "local-onnx-v1",
    "mock-deterministic-v1",
]


class ApiRequest(ApiModel):
    api_version: Literal["1"] | None = None
    request_id: RequestId | None = None


class ApiResponse(ApiModel):
    request_id: RequestId

    @computed_field(return_type=Literal["1"])
    @property
    def api_version(self) -> Literal["1"]:
        """Expose the immutable contract version as a required response field."""

        return "1"


PublicErrorCode: TypeAlias = Literal[
    "AUTHENTICATION_REQUIRED",
    "INVALID_AUTHENTICATION_TOKEN",
    "VALIDATION_ERROR",
    "CONFLICT",
    "SERVICE_UNAVAILABLE",
    "NOT_FOUND",
    "METHOD_NOT_ALLOWED",
    "HTTP_ERROR",
    "INTERNAL_ERROR",
]


class ErrorInfo(ApiModel):
    code: PublicErrorCode
    message: str


class ErrorResponse(ApiResponse):
    error: ErrorInfo

    @computed_field(return_type=Literal[False])
    @property
    def success(self) -> Literal[False]:
        return False


class HealthResponse(ApiResponse):
    status: Literal["ok"]
    service: str
    version: str
    python_version: str
    platform_system: str
    platform_machine: str
    auth_required: bool
    inference_authorized: bool
    active_model: ServerModelId
    runtime: RuntimeDevice
    backend: BackendKind
    mock: bool
    fallback_reason: str | None


class ModelInfo(ApiModel):
    id: str
    name: str
    runtime: Literal["browser", "cpu", "cuda", "mps", "coreml", "directml"]
    available: bool
    loaded: bool
    capabilities: list[Literal["rank"]]
    backend: BackendKind
    mock: bool


class ModelsResponse(ApiResponse):
    models: list[ModelInfo]
    active_model: ServerModelId
    active_runtime: RuntimeDevice
    active_backend: BackendKind
    mock: bool
    fallback_reason: str | None


PreferenceCategory: TypeAlias = Literal[
    "chords",
    "melody",
    "rhythm",
    "voicing",
    "combined",
]
PreferenceFeedback: TypeAlias = Literal[
    "like",
    "dislike",
    "favorite",
    "abSelected",
    "notMyStyle",
    "adopted",
    "immediateUndo",
    "saved",
    "midiExported",
    "replayed",
    "manuallyEdited",
]


class RankCandidate(ApiModel):
    id: Annotated[str, Field(min_length=1, max_length=128)]
    features: dict[str, StrictFloat] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_features(self) -> RankCandidate:
        _validate_numeric_map(self.features, field_name="features")
        return self


class RankRequest(ApiRequest):
    candidates: Annotated[list[RankCandidate], Field(min_length=1, max_length=512)]
    preference_weights: dict[str, StrictFloat] = Field(
        default_factory=dict,
        description=(
            "Complete client preference profile when supplied; when omitted, "
            "the process-local profile for preferenceCategory is used."
        ),
    )
    preference_category: PreferenceCategory = "combined"
    model_id: ServerModelId | None = None
    batch_size: Annotated[int, Field(strict=True, ge=1, le=128)] = 64
    allow_cpu_fallback: bool = True

    @model_validator(mode="after")
    def validate_request(self) -> RankRequest:
        ids = [candidate.id for candidate in self.candidates]
        if len(ids) != len(set(ids)):
            raise ValueError("candidate ids must be unique")
        _validate_numeric_map(self.preference_weights, field_name="preferenceWeights")
        return self


class RankedCandidate(ApiModel):
    id: str
    score: float


class RankResponse(ApiResponse):
    ranked: list[RankedCandidate]
    device: RuntimeDevice
    model_id: ServerModelId
    runtime: RuntimeDevice
    batch_size: int
    backend: BackendKind
    mock: bool
    fallback_reason: str | None = None


class PreferenceUpdateRequest(ApiRequest):
    category: PreferenceCategory
    feedback: PreferenceFeedback
    features: dict[str, StrictFloat]
    weight: Annotated[StrictFloat, Field(gt=0, le=4)] = 1.0

    @model_validator(mode="after")
    def validate_features(self) -> PreferenceUpdateRequest:
        if not self.features:
            raise ValueError("features must not be empty")
        _validate_numeric_map(self.features, field_name="features")
        return self


class PreferenceUpdateResponse(ApiResponse):
    weights: dict[str, float]
    evaluation_count: int
    confidence: Annotated[float, Field(ge=0, le=1)]


class ModelActionRequest(ApiRequest):
    model_id: ServerModelId


class ModelActionResponse(ApiResponse):
    model: ModelInfo
    active_model: ServerModelId
    active_runtime: RuntimeDevice
    active_backend: BackendKind
    mock: bool
    cache_size: int
    fallback_reason: str | None


def _validate_numeric_map(values: dict[str, float], *, field_name: str) -> None:
    if len(values) > 128:
        raise ValueError(f"{field_name} supports at most 128 entries")
    for key, value in values.items():
        if not key or len(key) > 128:
            raise ValueError(f"{field_name} keys must contain 1 to 128 characters")
        if not math.isfinite(value) or abs(value) > 1_000_000:
            raise ValueError(f"{field_name} values must be finite and within +/-1,000,000")
