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
HarmonyCheckpointTask: TypeAlias = Literal[
    "melody_conditioned_variable_rhythm_harmonization",
    "harmony_only_pretraining",
]
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


class ApiResponseV2(ApiModel):
    request_id: RequestId

    @computed_field(return_type=Literal["2"])
    @property
    def api_version(self) -> Literal["2"]:
        """Expose the harmony-preview contract version."""

        return "2"


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


class ErrorResponseV2(ApiResponseV2):
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
    runtime: Literal["browser", "cpu", "cuda", "mps", "coreml", "directml"] | None
    available: bool
    loaded: bool
    capabilities: list[Literal["rank", "generateHarmony"]]
    backend: BackendKind
    mock: bool
    task: HarmonyCheckpointTask | None = None


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


HarmonyModelId: TypeAlias = Literal[
    "harmonyforge-bimask-base-v1",
    "mock-harmonyforge-bimask-v1",
]
HarmonyMode: TypeAlias = Literal[
    "major",
    "naturalMinor",
    "harmonicMinor",
    "dorian",
    "mixolydian",
]
HarmonyQuality: TypeAlias = Literal[
    "major",
    "minor",
    "diminished",
    "augmented",
    "dominant7",
    "major7",
    "minor7",
    "halfDiminished7",
    "diminished7",
    "minorMajor7",
    "augmentedMajor7",
    "sus2",
    "sus4",
    "add9",
    "minorAdd9",
]
HarmonyExtension: TypeAlias = Literal[
    "6",
    "9",
    "b9",
    "#9",
    "11",
    "#11",
    "13",
    "b13",
]
HarmonyJobState: TypeAlias = Literal[
    "queued",
    "running",
    "cancelRequested",
    "completed",
    "cancelled",
    "failed",
]


class HarmonyMelodyNote(ApiModel):
    start_tick: Annotated[int, Field(strict=True, ge=0, le=15_728_640)]
    duration_tick: Annotated[int, Field(strict=True, ge=1, le=1_966_080)]
    midi: Annotated[int, Field(strict=True, ge=0, le=127)]
    velocity: Annotated[int, Field(strict=True, ge=1, le=127)] = 96
    role: Literal[
        "chordTone",
        "scaleTone",
        "passing",
        "neighbor",
        "approach",
        "unknown",
    ] = "unknown"


class HarmonyCondition(ApiModel):
    start_tick: Annotated[int, Field(strict=True, ge=0, le=15_728_640)]
    duration_tick: Annotated[int, Field(strict=True, ge=1, le=1_966_080)]
    root_offset_from_key: Annotated[int, Field(strict=True, ge=0, le=11)]
    quality: HarmonyQuality
    inversion: Annotated[int, Field(strict=True, ge=0, le=3)] = 0
    bass_offset_from_root: Annotated[int, Field(strict=True, ge=0, le=11)] = 0
    extensions: list[HarmonyExtension] = Field(default_factory=list, max_length=8)
    locked: bool = False


class HarmonyEditSpan(ApiModel):
    start_tick: Annotated[int, Field(strict=True, ge=0, le=15_728_640)]
    end_tick: Annotated[int, Field(strict=True, ge=1, le=15_728_640)]
    mode: Literal["generate", "preserve", "conditionOnly"]

    @model_validator(mode="after")
    def validate_span(self) -> HarmonyEditSpan:
        if self.end_tick <= self.start_tick:
            raise ValueError("edit span endTick must be greater than startTick")
        return self


class HarmonyTonalitySpan(ApiModel):
    start_tick: Annotated[int, Field(strict=True, ge=0, le=15_728_640)]
    end_tick: Annotated[int, Field(strict=True, ge=1, le=15_728_640)]
    key_root: Annotated[int, Field(strict=True, ge=0, le=11)]
    mode: HarmonyMode

    @model_validator(mode="after")
    def validate_span(self) -> HarmonyTonalitySpan:
        if self.end_tick <= self.start_tick:
            raise ValueError("tonality span endTick must be greater than startTick")
        return self


class HarmonyControls(ApiModel):
    ppq: Annotated[int, Field(strict=True, ge=24, le=9600)] = 480
    ticks_per_bar: Annotated[int, Field(strict=True, ge=96, le=38_400)]
    time_signature: Literal["4/4", "3/4", "6/8"]
    start_tick: Annotated[int, Field(strict=True, ge=0, le=15_728_640)]
    end_tick: Annotated[int, Field(strict=True, ge=1, le=15_728_640)]

    @model_validator(mode="after")
    def validate_range(self) -> HarmonyControls:
        if self.end_tick <= self.start_tick:
            raise ValueError("endTick must be greater than startTick")
        if self.ppq % 4 != 0:
            raise ValueError("ppq must be divisible by four")
        expected_ticks_per_bar = self.ppq * (
            4 if self.time_signature == "4/4" else 3
        )
        if self.ticks_per_bar != expected_ticks_per_bar:
            raise ValueError(
                "ticksPerBar is inconsistent with ppq and timeSignature"
            )
        frame_ticks = self.ppq // 4
        if self.start_tick % frame_ticks or self.end_tick % frame_ticks:
            raise ValueError(
                "startTick and endTick must align to a sixteenth-note frame"
            )
        maximum_ticks = self.ticks_per_bar * 128
        if self.end_tick - self.start_tick > maximum_ticks:
            raise ValueError("generation range supports at most 128 bars")
        return self


class HarmonyGenerateRequest(ApiModel):
    api_version: Literal["2"]
    request_id: RequestId
    model_id: HarmonyModelId = "harmonyforge-bimask-base-v1"
    seed: Annotated[str, Field(min_length=1, max_length=128)]
    candidate_count: Annotated[int, Field(strict=True, ge=1, le=32)] = 32
    preferred_device: Literal["auto", "cpu", "cuda", "mps"] = "auto"
    allow_cpu_fallback: bool = True
    melody: Annotated[list[HarmonyMelodyNote], Field(max_length=16_384)]
    existing_harmony: Annotated[list[HarmonyCondition], Field(max_length=4096)] = Field(
        default_factory=list,
    )
    generation_mask: Annotated[list[HarmonyEditSpan], Field(min_length=1, max_length=512)]
    tonalities: Annotated[list[HarmonyTonalitySpan], Field(min_length=1, max_length=256)]
    controls: HarmonyControls

    @model_validator(mode="after")
    def validate_timelines(self) -> HarmonyGenerateRequest:
        _validate_timeline(
            self.generation_mask,
            self.controls.start_tick,
            self.controls.end_tick,
            "generationMask",
        )
        _validate_timeline(
            self.tonalities,
            self.controls.start_tick,
            self.controls.end_tick,
            "tonalities",
        )
        frame_ticks = self.controls.ppq // 4
        for span in [*self.generation_mask, *self.tonalities]:
            if span.start_tick % frame_ticks or span.end_tick % frame_ticks:
                raise ValueError(
                    "generationMask and tonalities must align to sixteenth-note frames"
                )
        for span in self.generation_mask:
            if span.mode == "generate":
                continue
            _validate_harmony_coverage(
                self.existing_harmony,
                span.start_tick,
                span.end_tick,
                f"{span.mode} span",
            )
        return self


class HarmonyFactorEvent(ApiModel):
    start_tick: int
    duration_tick: int
    root_offset_from_key: Annotated[int, Field(ge=0, le=11)]
    quality: HarmonyQuality
    inversion: Annotated[int, Field(ge=0, le=3)]
    bass_offset_from_root: Annotated[int, Field(ge=0, le=11)]
    extensions: list[HarmonyExtension]
    confidence: Annotated[float, Field(ge=0, le=1)]
    mask_mode: Literal["generated", "preserved", "conditionOnly"]


class HarmonyCandidate(ApiModel):
    candidate_id: str
    events: list[HarmonyFactorEvent]
    neural_mean_log_probability: float | None
    hard_rule_vector: dict[str, int] = Field(default_factory=dict)
    hard_rule_validation: Literal["pendingClient"] = "pendingClient"
    adoptable: Literal[False] = False
    requires_client_validation: Literal[True] = True


class HarmonyJobError(ApiModel):
    code: Literal[
        "MODEL_UNAVAILABLE",
        "CHECKPOINT_INVALID",
        "INFERENCE_FAILED",
        "CANCELLED",
    ]
    message: str
    composition_safe: Literal[True] = True
    fallback_available: Literal[True] = True


class HarmonyJobResponse(ApiResponseV2):
    state: HarmonyJobState
    stage: Literal[
        "Queued",
        "Loading checkpoint",
        "Encoding",
        "Neural proposal",
        "Decoding",
        "Schema validation",
        "Client theory validation",
        "Complete",
        "Cancel requested",
        "Cancelled",
        "Failed",
    ]
    progress: Annotated[int, Field(ge=0, le=100)]
    elapsed_ms: Annotated[int, Field(ge=0)]
    model_id: HarmonyModelId
    device: RuntimeDevice | None
    backend: Literal["pytorch", "mock"]
    dtype: Literal["float32", "float16", "bfloat16"] | None
    mock: bool
    trained: bool
    checkpoint_sha256: str | None = None
    tokenizer_sha256: str
    source_commit: str | None = None
    batch_size: Annotated[int, Field(ge=1, le=32)] = 1
    candidate_count: Annotated[int, Field(ge=1, le=32)]
    deterministic: bool = True
    cpu_fallback_used: bool = False
    fallback_reason: str | None = None
    stage_timings_ms: dict[str, Annotated[int, Field(ge=0)]] = Field(
        default_factory=dict,
    )
    partial_candidate_stored: Literal[False] = False
    candidates: list[HarmonyCandidate] = Field(default_factory=list)
    error: HarmonyJobError | None = None


class HarmonyCancelRequest(ApiModel):
    api_version: Literal["2"]
    request_id: RequestId


class HarmonyModelManifestResponse(ApiResponseV2):
    model_id: HarmonyModelId
    available: bool
    mock: bool
    trained: bool
    task: HarmonyCheckpointTask | None
    evaluation_status: Literal["notEvaluated", "researchOnly", "validated"]
    checkpoint_sha256: str | None
    tokenizer_sha256: str
    architecture: dict[str, int | float | str | bool]
    supported_devices: list[Literal["cpu", "cuda", "mps"]]
    unavailable_reason: str | None = None


def _validate_timeline(
    spans: list[HarmonyEditSpan] | list[HarmonyTonalitySpan],
    start_tick: int,
    end_tick: int,
    field_name: str,
) -> None:
    ordered = sorted(spans, key=lambda span: (span.start_tick, span.end_tick))
    cursor = start_tick
    for span in ordered:
        if span.start_tick != cursor:
            raise ValueError(f"{field_name} must cover the range without gaps or overlaps")
        if span.end_tick > end_tick:
            raise ValueError(f"{field_name} extends beyond the requested range")
        cursor = span.end_tick
    if cursor != end_tick:
        raise ValueError(f"{field_name} must cover the complete requested range")


def _validate_harmony_coverage(
    harmony: list[HarmonyCondition],
    start_tick: int,
    end_tick: int,
    field_name: str,
) -> None:
    intervals = sorted(
        (
            max(start_tick, condition.start_tick),
            min(end_tick, condition.start_tick + condition.duration_tick),
        )
        for condition in harmony
        if condition.start_tick < end_tick
        and condition.start_tick + condition.duration_tick > start_tick
    )
    cursor = start_tick
    for interval_start, interval_end in intervals:
        if interval_start > cursor:
            raise ValueError(f"{field_name} requires complete existingHarmony coverage")
        cursor = max(cursor, interval_end)
        if cursor >= end_tick:
            return
    raise ValueError(f"{field_name} requires complete existingHarmony coverage")


def _validate_numeric_map(values: dict[str, float], *, field_name: str) -> None:
    if len(values) > 128:
        raise ValueError(f"{field_name} supports at most 128 entries")
    for key, value in values.items():
        if not key or len(key) > 128:
            raise ValueError(f"{field_name} keys must contain 1 to 128 characters")
        if not math.isfinite(value) or abs(value) > 1_000_000:
            raise ValueError(f"{field_name} values must be finite and within +/-1,000,000")
