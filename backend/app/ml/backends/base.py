"""Common neural-harmony backend result and protocol."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from threading import Event
from typing import Protocol

from app.schemas.api import HarmonyCandidate, HarmonyGenerateRequest, RuntimeDevice

ProgressCallback = Callable[[str, int], None]


@dataclass(frozen=True, slots=True)
class HarmonyGenerationResult:
    candidates: list[HarmonyCandidate]
    device: RuntimeDevice
    dtype: str
    backend: str
    mock: bool
    trained: bool
    checkpoint_sha256: str | None
    tokenizer_sha256: str
    source_commit: str | None
    batch_size: int
    deterministic: bool
    cpu_fallback_used: bool = False
    fallback_reason: str | None = None


@dataclass(frozen=True, slots=True)
class HarmonyBackendHealth:
    loaded: bool
    device: RuntimeDevice | None
    dtype: str | None
    fallback_reason: str | None


class NeuralHarmonyBackend(Protocol):
    model_id: str
    mock: bool
    trained: bool

    def generate(
        self,
        request: HarmonyGenerateRequest,
        *,
        cancel_event: Event,
        on_progress: ProgressCallback,
    ) -> HarmonyGenerationResult: ...

    def manifest(self) -> dict[str, object]: ...

    def health(self) -> HarmonyBackendHealth: ...
