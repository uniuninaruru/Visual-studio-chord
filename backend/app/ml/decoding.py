"""Seeded factor decoding with product-schema masks and immutable spans."""

from __future__ import annotations

import hashlib
import math
from collections.abc import Sequence
from dataclasses import dataclass

from app.ml.contracts import EXTENSION_VOCABULARY, QUALITY_VOCABULARY
from app.ml.tokenizer import CONDITION_ONLY_ID, GENERATE_ID, PRESERVE_ID, EncodedHarmonyWindow
from app.schemas.api import (
    HarmonyCandidate,
    HarmonyFactorEvent,
    HarmonyGenerateRequest,
)


@dataclass(frozen=True, slots=True)
class WindowLogits:
    event: Sequence[Sequence[float]]
    root: Sequence[Sequence[float]]
    quality: Sequence[Sequence[float]]
    inversion: Sequence[Sequence[float]]
    bass: Sequence[Sequence[float]]
    extensions: Sequence[Sequence[float]]


class DecodeRejectedError(RuntimeError):
    """A model proposal cannot be represented safely by the product schema."""


def decode_candidate(
    request: HarmonyGenerateRequest,
    windows: Sequence[EncodedHarmonyWindow],
    logits: Sequence[WindowLogits],
    *,
    candidate_index: int,
    temperature: float = 0.9,
    top_p: float = 0.95,
) -> HarmonyCandidate:
    if len(windows) != len(logits):
        raise ValueError("window/logit count mismatch")
    frame_events: list[HarmonyFactorEvent] = []
    selected_log_probabilities: list[float] = []
    has_previous = False

    for window_index, (window, window_logits) in enumerate(zip(windows, logits, strict=True)):
        if window.frame_count != len(window_logits.event):
            raise ValueError("logits do not match tokenizer frame count")
        for frame_index in range(window.frame_count):
            tick = window.start_tick + frame_index * window.frame_ticks
            edit_mask = window.edit_mask[frame_index]
            if edit_mask in {PRESERVE_ID, CONDITION_ONLY_ID}:
                condition = _active_condition(request, tick)
                if condition is None:
                    raise DecodeRejectedError(
                        "A preserved or condition-only frame has no source harmony"
                    )
                event = HarmonyFactorEvent(
                    start_tick=tick,
                    duration_tick=window.frame_ticks,
                    root_offset_from_key=condition.root_offset_from_key,
                    quality=condition.quality,
                    inversion=condition.inversion,
                    bass_offset_from_root=condition.bass_offset_from_root,
                    extensions=list(condition.extensions),
                    confidence=1.0,
                    mask_mode=(
                        "preserved"
                        if edit_mask == PRESERVE_ID
                        else "conditionOnly"
                    ),
                )
                _append_or_extend(frame_events, event)
                has_previous = True
                continue
            if edit_mask != GENERATE_ID:
                raise DecodeRejectedError("Unknown edit-mask token")

            # NO_CHORD is incompatible with the current continuous-harmony
            # project schema. The first generated frame must CHANGE; later
            # frames may HOLD the preceding factor tuple.
            event_scores = list(window_logits.event[frame_index])
            if len(event_scores) != 3:
                raise DecodeRejectedError("Event head has an invalid shape")
            event_scores[0] = -math.inf
            if not has_previous:
                event_scores[1] = -math.inf
            event_choice, event_log_probability = _sample(
                event_scores,
                request.seed,
                candidate_index,
                window_index,
                frame_index,
                "event",
                temperature,
                top_p,
            )
            selected_log_probabilities.append(event_log_probability)
            if event_choice == 1:
                previous = frame_events[-1]
                _append_or_extend(
                    frame_events,
                    previous.model_copy(
                        update={
                            "start_tick": tick,
                            "duration_tick": window.frame_ticks,
                            "mask_mode": "generated",
                            "confidence": _probability(event_scores, event_choice, temperature),
                        }
                    ),
                )
                continue
            if event_choice != 2:
                raise DecodeRejectedError("NO_CHORD cannot be decoded by this project schema")

            root, root_log_probability = _sample(
                window_logits.root[frame_index],
                request.seed,
                candidate_index,
                window_index,
                frame_index,
                "root",
                temperature,
                top_p,
            )
            quality, quality_log_probability = _sample(
                # The final OTHER class is analysis-only and cannot silently
                # become a product ChordQuality.
                window_logits.quality[frame_index][:-1],
                request.seed,
                candidate_index,
                window_index,
                frame_index,
                "quality",
                temperature,
                top_p,
            )
            inversion, inversion_log_probability = _sample(
                # The fifth "other" class has no safe voicing representation.
                window_logits.inversion[frame_index][:-1],
                request.seed,
                candidate_index,
                window_index,
                frame_index,
                "inversion",
                temperature,
                top_p,
            )
            bass, bass_log_probability = _sample(
                window_logits.bass[frame_index],
                request.seed,
                candidate_index,
                window_index,
                frame_index,
                "bass",
                temperature,
                top_p,
            )
            extensions = _decode_extensions(window_logits.extensions[frame_index])
            selected_log_probabilities.extend(
                (
                    root_log_probability,
                    quality_log_probability,
                    inversion_log_probability,
                    bass_log_probability,
                )
            )
            confidence = min(
                _probability(event_scores, event_choice, temperature),
                _probability(window_logits.root[frame_index], root, temperature),
                _probability(window_logits.quality[frame_index][:-1], quality, temperature),
            )
            _append_or_extend(
                frame_events,
                HarmonyFactorEvent(
                    start_tick=tick,
                    duration_tick=window.frame_ticks,
                    root_offset_from_key=root,
                    quality=QUALITY_VOCABULARY[quality],  # type: ignore[arg-type]
                    inversion=inversion,
                    bass_offset_from_root=bass,
                    extensions=extensions,  # type: ignore[arg-type]
                    confidence=round(confidence, 8),
                    mask_mode="generated",
                ),
            )
            has_previous = True

    digest = hashlib.sha256(
        f"{request.request_id}:{request.seed}:{candidate_index}".encode()
    ).hexdigest()[:16]
    mean_log_probability = (
        sum(selected_log_probabilities) / len(selected_log_probabilities)
        if selected_log_probabilities
        else None
    )
    return HarmonyCandidate(
        candidate_id=f"neural-{digest}",
        events=frame_events,
        neural_mean_log_probability=(
            None
            if mean_log_probability is None
            else round(mean_log_probability, 8)
        ),
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


def _sample(
    scores: Sequence[float],
    seed: str,
    candidate_index: int,
    window_index: int,
    frame_index: int,
    head: str,
    temperature: float,
    top_p: float,
) -> tuple[int, float]:
    probabilities = _softmax(scores, temperature)
    ranked = sorted(
        enumerate(probabilities),
        key=lambda item: (-item[1], item[0]),
    )
    kept: list[tuple[int, float]] = []
    cumulative = 0.0
    for item in ranked:
        kept.append(item)
        cumulative += item[1]
        if cumulative >= top_p:
            break
    total = sum(probability for _, probability in kept)
    unit = _unit_interval(
        f"{seed}:{candidate_index}:{window_index}:{frame_index}:{head}"
    )
    threshold = unit * total
    running = 0.0
    for index, probability in kept:
        running += probability
        if threshold <= running:
            return index, math.log(max(probability, float.fromhex("0x1p-1022")))
    index, probability = kept[-1]
    return index, math.log(max(probability, float.fromhex("0x1p-1022")))


def _probability(
    scores: Sequence[float],
    selected: int,
    temperature: float,
) -> float:
    probabilities = _softmax(scores, temperature)
    return probabilities[selected]


def _softmax(scores: Sequence[float], temperature: float) -> list[float]:
    if not scores:
        raise DecodeRejectedError("Cannot sample an empty head")
    if temperature <= 0:
        raise ValueError("temperature must be positive")
    finite = [score for score in scores if math.isfinite(score)]
    if not finite:
        raise DecodeRejectedError("All output classes were masked")
    maximum = max(finite)
    exponentials = [
        0.0 if not math.isfinite(score) else math.exp((score - maximum) / temperature)
        for score in scores
    ]
    total = sum(exponentials)
    return [value / total for value in exponentials]


def _unit_interval(material: str) -> float:
    digest = hashlib.sha256(material.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def _decode_extensions(scores: Sequence[float]) -> list[str]:
    if len(scores) != len(EXTENSION_VOCABULARY):
        raise DecodeRejectedError("Extension head has an invalid shape")
    ranked = sorted(
        enumerate(scores),
        key=lambda item: (-item[1], item[0]),
    )
    selected = [
        EXTENSION_VOCABULARY[index]
        for index, score in ranked
        if score > 0
    ][:2]
    return list(selected)


def _active_condition(request: HarmonyGenerateRequest, tick: int):
    conditions = [
        condition
        for condition in request.existing_harmony
        if condition.start_tick <= tick < condition.start_tick + condition.duration_tick
    ]
    if not conditions:
        return None
    locked = [condition for condition in conditions if condition.locked]
    return min(
        locked or conditions,
        key=lambda condition: (
            condition.start_tick,
            condition.root_offset_from_key,
            condition.quality,
        ),
    )
