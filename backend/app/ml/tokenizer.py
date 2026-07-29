"""Deterministic tick-to-frame tokenizer for melody-conditioned harmony."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

from app.ml.contracts import (
    EVENT_VOCABULARY,
    EXTENSION_VOCABULARY,
    MODE_VOCABULARY,
    QUALITY_VOCABULARY,
    ROLE_VOCABULARY,
)
from app.schemas.api import HarmonyGenerateRequest

MASK_ID = 0
PRESERVE_ID = 1
GENERATE_ID = 2
CONDITION_ONLY_ID = 3

TOKENIZER_CONTRACT = {
    "schemaVersion": 1,
    "frame": "sixteenth",
    "melodyMidi": {"silence": 128, "minimum": 0, "maximum": 127},
    "roles": ROLE_VOCABULARY,
    "modes": MODE_VOCABULARY,
    "events": EVENT_VOCABULARY,
    "qualities": QUALITY_VOCABULARY,
    "extensions": {
        "vocabulary": EXTENSION_VOCABULARY,
        "encoding": "multiHot",
    },
    "maskIds": {
        "mask": MASK_ID,
        "preserve": PRESERVE_ID,
        "generate": GENERATE_ID,
        "conditionOnly": CONDITION_ONLY_ID,
    },
}
TOKENIZER_SHA256 = hashlib.sha256(
    json.dumps(
        TOKENIZER_CONTRACT,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
).hexdigest()


@dataclass(frozen=True, slots=True)
class EncodedHarmonyWindow:
    """Plain lists keep contract tests independent from PyTorch."""

    start_tick: int
    frame_ticks: int
    melody_midi: tuple[int, ...]
    melody_role: tuple[int, ...]
    metrical_slot: tuple[int, ...]
    bar_index: tuple[int, ...]
    key_root: tuple[int, ...]
    mode: tuple[int, ...]
    harmony_event: tuple[int, ...]
    harmony_root: tuple[int, ...]
    harmony_quality: tuple[int, ...]
    harmony_inversion: tuple[int, ...]
    harmony_bass: tuple[int, ...]
    harmony_extensions: tuple[tuple[int, ...], ...]
    edit_mask: tuple[int, ...]
    padding_mask: tuple[bool, ...]

    @property
    def frame_count(self) -> int:
        return len(self.melody_midi)


class HarmonyTokenizer:
    """Create aligned melody/harmony frames and preserve immutable locks."""

    def encode(
        self,
        request: HarmonyGenerateRequest,
        *,
        maximum_frames_per_window: int = 256,
    ) -> list[EncodedHarmonyWindow]:
        controls = request.controls
        if controls.ppq % 4 != 0:
            raise ValueError("ppq must be divisible by four for sixteenth frames")
        frame_ticks = controls.ppq // 4
        total_frames = (
            controls.end_tick - controls.start_tick + frame_ticks - 1
        ) // frame_ticks
        windows: list[EncodedHarmonyWindow] = []
        for first_frame in range(0, total_frames, maximum_frames_per_window):
            frame_count = min(maximum_frames_per_window, total_frames - first_frame)
            start_tick = controls.start_tick + first_frame * frame_ticks
            windows.append(
                self._encode_window(
                    request,
                    start_tick=start_tick,
                    frame_ticks=frame_ticks,
                    frame_count=frame_count,
                )
            )
        return windows

    def _encode_window(
        self,
        request: HarmonyGenerateRequest,
        *,
        start_tick: int,
        frame_ticks: int,
        frame_count: int,
    ) -> EncodedHarmonyWindow:
        controls = request.controls
        melody_midi: list[int] = []
        melody_role: list[int] = []
        metrical_slot: list[int] = []
        bar_index: list[int] = []
        harmony_event: list[int] = []
        harmony_root: list[int] = []
        harmony_quality: list[int] = []
        harmony_inversion: list[int] = []
        harmony_bass: list[int] = []
        harmony_extensions: list[tuple[int, ...]] = []
        edit_mask: list[int] = []

        for frame_index in range(frame_count):
            tick = start_tick + frame_index * frame_ticks
            melody = _active_melody(request, tick)
            condition = _active_harmony(request, tick)
            span_mode = _active_edit_span(request, tick).mode
            melody_midi.append(128 if melody is None else melody.midi)
            melody_role.append(
                ROLE_VOCABULARY.index("unknown" if melody is None else melody.role)
            )
            position_in_bar = tick % controls.ticks_per_bar
            metrical_slot.append(
                min(15, (position_in_bar * 16) // controls.ticks_per_bar)
            )
            bar_index.append(
                min(
                    127,
                    max(
                        0,
                        (tick - controls.start_tick) // controls.ticks_per_bar,
                    ),
                )
            )
            # Existing unlocked harmony is a label, not an input, inside a
            # generated span. Revealing it here would make both training and
            # inference appear better by leaking the answer.
            reveal_condition = condition is not None and (
                condition.locked or span_mode != "generate"
            )
            if not reveal_condition:
                harmony_event.append(MASK_ID)
                harmony_root.append(MASK_ID)
                harmony_quality.append(MASK_ID)
                harmony_inversion.append(MASK_ID)
                harmony_bass.append(MASK_ID)
                harmony_extensions.append((0,) * len(EXTENSION_VOCABULARY))
                edit_mask.append(
                    CONDITION_ONLY_ID
                    if span_mode == "conditionOnly"
                    else PRESERVE_ID
                    if span_mode == "preserve"
                    else GENERATE_ID
                )
                continue
            previous = _active_harmony(request, tick - frame_ticks)
            event_name = (
                "hold"
                if previous is not None
                and _same_harmony(previous, condition)
                and previous.start_tick < tick
                else "change"
            )
            harmony_event.append(EVENT_VOCABULARY.index(event_name) + 1)
            harmony_root.append(condition.root_offset_from_key + 1)
            harmony_quality.append(QUALITY_VOCABULARY.index(condition.quality) + 1)
            harmony_inversion.append(condition.inversion + 1)
            harmony_bass.append(condition.bass_offset_from_root + 1)
            harmony_extensions.append(
                tuple(
                    int(extension in condition.extensions)
                    for extension in EXTENSION_VOCABULARY
                )
            )
            edit_mask.append(
                PRESERVE_ID
                if condition.locked or span_mode == "preserve"
                else CONDITION_ONLY_ID
                if span_mode == "conditionOnly"
                else GENERATE_ID
            )

        repeated_key = tuple(
            _active_tonality(request, start_tick + index * frame_ticks).key_root
            for index in range(frame_count)
        )
        repeated_mode = tuple(
            MODE_VOCABULARY.index(
                _active_tonality(request, start_tick + index * frame_ticks).mode
            )
            for index in range(frame_count)
        )
        return EncodedHarmonyWindow(
            start_tick=start_tick,
            frame_ticks=frame_ticks,
            melody_midi=tuple(melody_midi),
            melody_role=tuple(melody_role),
            metrical_slot=tuple(metrical_slot),
            bar_index=tuple(bar_index),
            key_root=repeated_key,
            mode=repeated_mode,
            harmony_event=tuple(harmony_event),
            harmony_root=tuple(harmony_root),
            harmony_quality=tuple(harmony_quality),
            harmony_inversion=tuple(harmony_inversion),
            harmony_bass=tuple(harmony_bass),
            harmony_extensions=tuple(harmony_extensions),
            edit_mask=tuple(edit_mask),
            padding_mask=(False,) * frame_count,
        )


def _active_melody(request: HarmonyGenerateRequest, tick: int):
    active = [
        note
        for note in request.melody
        if note.start_tick <= tick < note.start_tick + note.duration_tick
    ]
    if not active:
        return None
    # The lead line is monophonic in current projects. If imported material
    # overlaps, use the highest pitch deterministically and keep the input safe.
    return max(active, key=lambda note: (note.midi, -note.start_tick))


def _active_harmony(request: HarmonyGenerateRequest, tick: int):
    active = [
        chord
        for chord in request.existing_harmony
        if chord.start_tick <= tick < chord.start_tick + chord.duration_tick
    ]
    if not active:
        return None
    locked = [chord for chord in active if chord.locked]
    return min(
        locked or active,
        key=lambda chord: (
            chord.start_tick,
            chord.root_offset_from_key,
            chord.quality,
        ),
    )


def _active_edit_span(request: HarmonyGenerateRequest, tick: int):
    for span in request.generation_mask:
        if span.start_tick <= tick < span.end_tick:
            return span
    raise ValueError("generationMask does not cover a requested frame")


def _active_tonality(request: HarmonyGenerateRequest, tick: int):
    for span in request.tonalities:
        if span.start_tick <= tick < span.end_tick:
            return span
    raise ValueError("tonalities do not cover a requested frame")


def _same_harmony(left, right) -> bool:
    return (
        left.start_tick == right.start_tick
        and left.duration_tick == right.duration_tick
        and left.root_offset_from_key == right.root_offset_from_key
        and left.quality == right.quality
        and left.inversion == right.inversion
        and left.bass_offset_from_root == right.bass_offset_from_root
        and left.extensions == right.extensions
        and left.locked == right.locked
    )
