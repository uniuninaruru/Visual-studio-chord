"""Public JSON contracts for the Phase 1 API."""

from __future__ import annotations

import math
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictFloat, model_validator


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        extra="forbid",
    )


class HealthResponse(ApiModel):
    status: Literal["ok"]
    service: str
    version: str


class ModelInfo(ApiModel):
    id: str
    name: str
    runtime: Literal["browser", "cpu", "cuda"]
    available: bool
    loaded: bool
    capabilities: list[Literal["rank"]]


class ModelsResponse(ApiModel):
    models: list[ModelInfo]
    active_model: str | None


class RankCandidate(ApiModel):
    id: Annotated[str, Field(min_length=1, max_length=128)]
    features: dict[str, StrictFloat] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_features(self) -> RankCandidate:
        _validate_numeric_map(self.features, field_name="features")
        return self


class RankRequest(ApiModel):
    candidates: Annotated[list[RankCandidate], Field(min_length=1, max_length=512)]
    preference_weights: dict[str, StrictFloat] = Field(default_factory=dict)

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


class RankResponse(ApiModel):
    ranked: list[RankedCandidate]
    device: Literal["cpu", "cuda"]


def _validate_numeric_map(values: dict[str, float], *, field_name: str) -> None:
    if len(values) > 128:
        raise ValueError(f"{field_name} supports at most 128 entries")
    for key, value in values.items():
        if not key or len(key) > 128:
            raise ValueError(f"{field_name} keys must contain 1 to 128 characters")
        if not math.isfinite(value) or abs(value) > 1_000_000:
            raise ValueError(f"{field_name} values must be finite and within +/-1,000,000")
