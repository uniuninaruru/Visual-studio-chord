"""Reproducible, visibly marked development harmonizer."""

from __future__ import annotations

import hashlib
from threading import Event

from app.ml.backends.base import (
    HarmonyBackendHealth,
    HarmonyGenerationResult,
    ProgressCallback,
)
from app.ml.contracts import MOCK_MODEL_ID
from app.ml.tokenizer import TOKENIZER_SHA256
from app.schemas.api import (
    HarmonyCandidate,
    HarmonyFactorEvent,
    HarmonyGenerateRequest,
)


class MockHarmonyBackend:
    model_id = MOCK_MODEL_ID
    mock = True
    trained = False

    def health(self) -> HarmonyBackendHealth:
        return HarmonyBackendHealth(
            loaded=True,
            device="cpu",
            dtype="float32",
            fallback_reason=None,
        )

    def manifest(self) -> dict[str, object]:
        return {
            "modelId": self.model_id,
            "available": True,
            "mock": True,
            "trained": False,
            "task": None,
            "evaluationStatus": "notEvaluated",
            "checkpointSha256": None,
            "tokenizerSha256": TOKENIZER_SHA256,
            "architecture": {
                "family": "deterministic_test_fixture",
                "factorizedOutputHeads": True,
            },
            "supportedDevices": ["cpu"],
            "unavailableReason": None,
        }

    def generate(
        self,
        request: HarmonyGenerateRequest,
        *,
        cancel_event: Event,
        on_progress: ProgressCallback,
    ) -> HarmonyGenerationResult:
        on_progress("Encoding", 20)
        if cancel_event.is_set():
            raise InterruptedError
        on_progress("Neural proposal", 45)
        candidates: list[HarmonyCandidate] = []
        for candidate_index in range(request.candidate_count):
            if cancel_event.is_set():
                raise InterruptedError
            candidates.append(_mock_candidate(request, candidate_index))
            on_progress(
                "Neural proposal",
                45 + round(35 * (candidate_index + 1) / request.candidate_count),
            )
        on_progress("Schema validation", 85)
        return HarmonyGenerationResult(
            candidates=candidates,
            device="cpu",
            dtype="float32",
            backend="mock",
            mock=True,
            trained=False,
            checkpoint_sha256=None,
            tokenizer_sha256=TOKENIZER_SHA256,
            source_commit=None,
            batch_size=1,
            deterministic=True,
        )


def _mock_candidate(
    request: HarmonyGenerateRequest,
    candidate_index: int,
) -> HarmonyCandidate:
    controls = request.controls
    primary_mode = request.tonalities[0].mode
    major_patterns = (
        ((0, "major"), (5, "major"), (7, "major"), (0, "major")),
        ((0, "major"), (9, "minor"), (5, "major"), (7, "major")),
        ((0, "major"), (4, "minor"), (5, "major"), (7, "major")),
    )
    minor_patterns = (
        ((0, "minor"), (5, "minor"), (7, "major"), (0, "minor")),
        ((0, "minor"), (8, "major"), (5, "minor"), (7, "major")),
        ((0, "minor"), (3, "major"), (8, "major"), (7, "major")),
    )
    pattern = (
        minor_patterns
        if primary_mode in {"naturalMinor", "harmonicMinor"}
        else major_patterns
    )[candidate_index % 3]
    events: list[HarmonyFactorEvent] = []
    tick = controls.start_tick
    while tick < controls.end_tick:
        mask = _edit_span(request, tick)
        condition = _condition(request, tick)
        condition_end = (
            condition.start_tick + condition.duration_tick
            if condition is not None
            else controls.end_tick
        )
        next_boundary = min(
            controls.end_tick,
            mask.end_tick,
            condition_end,
            ((tick // controls.ticks_per_bar) + 1) * controls.ticks_per_bar,
        )
        if mask.mode != "generate":
            if condition is None:
                raise ValueError("Mock preserve span has no source harmony")
            event = HarmonyFactorEvent(
                start_tick=tick,
                duration_tick=next_boundary - tick,
                root_offset_from_key=condition.root_offset_from_key,
                quality=condition.quality,
                inversion=condition.inversion,
                bass_offset_from_root=condition.bass_offset_from_root,
                extensions=list(condition.extensions),
                confidence=1.0,
                mask_mode=(
                    "preserved" if mask.mode == "preserve" else "conditionOnly"
                ),
            )
        elif condition is not None:
            # The explicit Mock backend is an integration fixture, not a trained
            # harmonizer. Reuse the request's already-valid source harmony so a
            # melody-bearing draft can exercise the complete async preview and
            # client safety pipeline without pretending the fixture inferred a
            # musically compatible replacement.
            event = HarmonyFactorEvent(
                start_tick=tick,
                duration_tick=next_boundary - tick,
                root_offset_from_key=condition.root_offset_from_key,
                quality=condition.quality,
                inversion=condition.inversion,
                bass_offset_from_root=condition.bass_offset_from_root,
                extensions=list(condition.extensions),
                confidence=1.0,
                mask_mode="generated",
            )
        else:
            bar = tick // controls.ticks_per_bar
            root, quality = pattern[bar % len(pattern)]
            event = HarmonyFactorEvent(
                start_tick=tick,
                duration_tick=next_boundary - tick,
                root_offset_from_key=root,
                quality=quality,  # type: ignore[arg-type]
                inversion=(bar + candidate_index) % 3 if bar % 2 else 0,
                bass_offset_from_root=0,
                extensions=[],
                confidence=0.5,
                mask_mode="generated",
            )
        _append_or_extend(events, event)
        tick = next_boundary

    digest = hashlib.sha256(
        f"{request.request_id}:{request.seed}:mock:{candidate_index}".encode()
    ).hexdigest()[:16]
    return HarmonyCandidate(
        candidate_id=f"mock-neural-{digest}",
        events=events,
        neural_mean_log_probability=None,
    )


def _append_or_extend(
    events: list[HarmonyFactorEvent],
    event: HarmonyFactorEvent,
) -> None:
    if events:
        previous = events[-1]
        if (
            previous.start_tick + previous.duration_tick == event.start_tick
            and previous.root_offset_from_key == event.root_offset_from_key
            and previous.quality == event.quality
            and previous.inversion == event.inversion
            and previous.bass_offset_from_root == event.bass_offset_from_root
            and previous.extensions == event.extensions
            and previous.mask_mode == event.mask_mode
        ):
            events[-1] = previous.model_copy(
                update={"duration_tick": previous.duration_tick + event.duration_tick}
            )
            return
    events.append(event)


def _edit_span(request: HarmonyGenerateRequest, tick: int):
    for span in request.generation_mask:
        if span.start_tick <= tick < span.end_tick:
            return span
    raise ValueError("generationMask does not cover the requested range")


def _condition(request: HarmonyGenerateRequest, tick: int):
    conditions = [
        condition
        for condition in request.existing_harmony
        if condition.start_tick <= tick < condition.start_tick + condition.duration_tick
    ]
    if not conditions:
        return None
    return min(
        conditions,
        key=lambda condition: (
            not condition.locked,
            condition.start_tick,
            condition.root_offset_from_key,
        ),
    )
