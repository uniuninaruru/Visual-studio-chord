#!/usr/bin/env python3
"""Prepare private, harmony-only POP909 records for HarmonyForge.

Only ``beat_audio.txt``, ``chord_audio.txt``, and ``key_audio.txt`` are read.
The preparer never reads MIDI, audio, song titles, artists, melodies, voicings,
or style metadata.  Raw annotations remain in the caller's local checkout.

The emitted ledger follows the strict local/private v2 contract consumed by
the ``harmonyOnlyV1`` dataset compiler profile. Converter gap policy
``reject`` pairs with compiler policy ``excludeRecord``; ``allow-no-chord``
pairs with ``allowNoChord``.
"""

from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import os
import re
import subprocess
import tempfile
from collections import Counter
from dataclasses import dataclass, replace
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Literal, Sequence

PPQ = 480
FRAME_TICKS = PPQ // 4
MAXIMUM_BARS = 128
SOURCE_ID = "pop909"
CANONICAL_URL = "https://github.com/music-x-lab/POP909-Dataset"
ATTRIBUTION_CITATION = (
    "Wang et al., POP909: A Pop-song Dataset for Music Arrangement Generation, "
    "ISMIR 2020"
)
LEDGER_SCHEMA_VERSION = 2
LEDGER_POLICY_ID = "harmony-only-private-v1"
LEDGER_PURPOSE = "privateLocalHarmonyOnlyTraining"
LEDGER_DISTRIBUTION_SCOPE = "privateLocalOnly"

PITCH_CLASSES = {
    "C": 0,
    "C#": 1,
    "Db": 1,
    "D": 2,
    "D#": 3,
    "Eb": 3,
    "E": 4,
    "Fb": 4,
    "E#": 5,
    "F": 5,
    "F#": 6,
    "Gb": 6,
    "G": 7,
    "G#": 8,
    "Ab": 8,
    "A": 9,
    "A#": 10,
    "Bb": 10,
    "B": 11,
    "Cb": 11,
    "B#": 0,
}
MODE_MAP = {
    "maj": "major",
    "major": "major",
    "min": "naturalMinor",
    "minor": "naturalMinor",
}
EXTENSIONS = ("6", "9", "b9", "#9", "11", "#11", "13", "b13")
LABEL_PATTERN = re.compile(
    r"^(?P<root>[A-G](?:#|b)?):(?P<quality>[^/]+)"
    r"(?:/(?P<bass>(?:[A-G](?:#|b)?)|(?:[#b]?\d+)))?$"
)
SAFE_ITEM_ID = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
UTC_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

GapPolicy = Literal["reject", "allow-no-chord"]
COMPILER_GAP_POLICIES: dict[GapPolicy, str] = {
    "reject": "excludeRecord",
    "allow-no-chord": "allowNoChord",
}


class PreparationError(ValueError):
    """One song cannot be safely normalized."""

    def __init__(self, reason: str, detail: str) -> None:
        self.reason = reason
        super().__init__(detail)


@dataclass(frozen=True, slots=True)
class TimedLabel:
    start: Decimal
    end: Decimal
    label: str


@dataclass(frozen=True, slots=True)
class Beat:
    time: Decimal
    order: int


@dataclass(frozen=True, slots=True)
class QuantizedSpan:
    start_tick: int
    end_tick: int
    label: str


@dataclass(frozen=True, slots=True)
class BeatGrid:
    """Piecewise-linear seconds-to-quarter-note mapping."""

    times: tuple[Decimal, ...]
    orders: tuple[int, ...]
    beats_per_bar: int

    @classmethod
    def from_file(cls, path: Path) -> BeatGrid:
        beats = parse_beats(path)
        beats_per_bar = infer_beats_per_bar(beats)
        return cls(
            times=tuple(beat.time for beat in beats),
            orders=tuple(beat.order for beat in beats),
            beats_per_bar=beats_per_bar,
        )

    @property
    def time_signature(self) -> str:
        return f"{self.beats_per_bar}/4"

    @property
    def ticks_per_bar(self) -> int:
        return PPQ * self.beats_per_bar

    def exact_tick(self, instant: Decimal) -> Decimal:
        if instant <= self.times[0]:
            left = 0
        elif instant >= self.times[-1]:
            left = len(self.times) - 2
        else:
            left = bisect.bisect_right(self.times, instant) - 1
        start = self.times[left]
        end = self.times[left + 1]
        fraction = (instant - start) / (end - start)
        return (Decimal(left) + fraction) * Decimal(PPQ)

    def covers_with_one_beat_margin(self, start: Decimal, end: Decimal) -> bool:
        first_interval = self.times[1] - self.times[0]
        last_interval = self.times[-1] - self.times[-2]
        return (
            start >= self.times[0] - first_interval
            and end <= self.times[-1] + last_interval
        )

    def first_downbeat_at_or_after(
        self,
        start: Decimal,
        end: Decimal,
    ) -> Decimal:
        for instant, order in zip(self.times, self.orders):
            if order == 1 and start <= instant < end:
                return instant
        raise PreparationError(
            "missingDownbeat",
            "no bar downbeat exists inside the chord/key annotation overlap",
        )


@dataclass(frozen=True, slots=True)
class PreparedCorpus:
    records: tuple[dict[str, Any], ...]
    discovered_song_count: int
    excluded_by_reason: dict[str, int]
    source_material_sha256: str


def parse_decimal(value: str, *, path: Path, line_number: int) -> Decimal:
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise PreparationError(
            "invalidAnnotation",
            f"{path}:{line_number}: invalid decimal value",
        ) from exc
    if not parsed.is_finite():
        raise PreparationError(
            "invalidAnnotation",
            f"{path}:{line_number}: non-finite decimal value",
        )
    return parsed


def parse_timed_labels(path: Path) -> list[TimedLabel]:
    labels: list[TimedLabel] = []
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(),
        start=1,
    ):
        if not raw_line.strip():
            continue
        fields = raw_line.split()
        if len(fields) != 3:
            raise PreparationError(
                "invalidAnnotation",
                f"{path}:{line_number}: expected start, end, and label",
            )
        start = parse_decimal(fields[0], path=path, line_number=line_number)
        end = parse_decimal(fields[1], path=path, line_number=line_number)
        if start < 0 or end <= start:
            raise PreparationError(
                "invalidAnnotation",
                f"{path}:{line_number}: invalid annotation interval",
            )
        labels.append(TimedLabel(start=start, end=end, label=fields[2]))
    if not labels:
        raise PreparationError("emptyAnnotation", f"{path}: annotation is empty")
    return sorted(labels, key=lambda item: (item.start, item.end, item.label))


def parse_beats(path: Path) -> list[Beat]:
    beats: list[Beat] = []
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(),
        start=1,
    ):
        if not raw_line.strip():
            continue
        fields = raw_line.split()
        if len(fields) != 2:
            raise PreparationError(
                "invalidBeatGrid",
                f"{path}:{line_number}: expected beat time and order",
            )
        instant = parse_decimal(fields[0], path=path, line_number=line_number)
        order_value = parse_decimal(fields[1], path=path, line_number=line_number)
        if instant < 0 or order_value != order_value.to_integral_value():
            raise PreparationError(
                "invalidBeatGrid",
                f"{path}:{line_number}: invalid beat value",
            )
        beats.append(Beat(time=instant, order=int(order_value)))
    if len(beats) < 2:
        raise PreparationError(
            "invalidBeatGrid",
            f"{path}: at least two beat anchors are required",
        )
    if any(right.time <= left.time for left, right in zip(beats, beats[1:])):
        raise PreparationError(
            "invalidBeatGrid",
            f"{path}: beat times must be strictly increasing",
        )
    return beats


def infer_beats_per_bar(beats: Sequence[Beat]) -> int:
    maximum = max(beat.order for beat in beats)
    if maximum not in {3, 4} or min(beat.order for beat in beats) != 1:
        raise PreparationError(
            "unsupportedMeter",
            "beat order must describe a complete 3/4 or 4/4 cycle",
        )
    for left, right in zip(beats, beats[1:]):
        expected = 1 if left.order == maximum else left.order + 1
        if right.order != expected:
            raise PreparationError(
                "invalidBeatGrid",
                "beat orders must advance by one and wrap at the bar boundary",
            )
    return maximum


def quantize_tick(value: Decimal) -> int:
    """Round to a sixteenth; exact half frames round away from zero."""

    frames = (value / Decimal(FRAME_TICKS)).to_integral_value(
        rounding=ROUND_HALF_UP
    )
    return int(frames) * FRAME_TICKS


def resolve_song_directories(input_path: Path) -> list[Path]:
    for candidate in (input_path / "POP909", input_path):
        if not candidate.is_dir():
            continue
        songs = sorted(
            (
                path
                for path in candidate.iterdir()
                if path.is_dir()
                and (path / "beat_audio.txt").is_file()
                and (path / "chord_audio.txt").is_file()
                and (path / "key_audio.txt").is_file()
            ),
            key=lambda path: path.name,
        )
        if songs:
            return songs
    raise PreparationError(
        "missingCorpus",
        "POP909 must contain song folders with beat_audio.txt, "
        "chord_audio.txt, and key_audio.txt",
    )


def _clip_labels(
    labels: Sequence[TimedLabel],
    start: Decimal,
    end: Decimal,
) -> list[TimedLabel]:
    return [
        TimedLabel(
            start=max(item.start, start),
            end=min(item.end, end),
            label=item.label,
        )
        for item in labels
        if item.start < end and item.end > start
    ]


def quantize_spans(
    labels: Sequence[TimedLabel],
    *,
    grid: BeatGrid,
    record_start: Decimal,
    record_end: Decimal,
    kind: str,
) -> list[QuantizedSpan]:
    clipped = _clip_labels(labels, record_start, record_end)
    if not clipped:
        raise PreparationError(f"{kind}Coverage", f"{kind} does not cover the record")
    origin = grid.exact_tick(record_start)
    exact: list[tuple[Decimal, Decimal, str]] = [
        (
            grid.exact_tick(item.start) - origin,
            grid.exact_tick(item.end) - origin,
            item.label,
        )
        for item in clipped
    ]
    repaired: list[tuple[Decimal, Decimal, str]] = []
    for start, end, label in exact:
        if repaired:
            previous_end = repaired[-1][1]
            difference = start - previous_end
            if difference and abs(difference) < FRAME_TICKS:
                start = previous_end
        repaired.append((start, end, label))

    record_end_exact = grid.exact_tick(record_end) - origin
    first_start = repaired[0][0]
    if first_start != 0:
        if abs(first_start) < FRAME_TICKS:
            repaired[0] = (Decimal(0), repaired[0][1], repaired[0][2])
        else:
            raise PreparationError(
                f"{kind}GapAfterQuantization",
                f"{kind} does not begin at the selected downbeat",
            )
    last_end = repaired[-1][1]
    if last_end != record_end_exact:
        if abs(record_end_exact - last_end) < FRAME_TICKS:
            repaired[-1] = (
                repaired[-1][0],
                record_end_exact,
                repaired[-1][2],
            )
        else:
            raise PreparationError(
                f"{kind}GapAfterQuantization",
                f"{kind} does not reach the record end",
            )

    spans = [
        QuantizedSpan(
            start_tick=quantize_tick(start),
            end_tick=quantize_tick(end),
            label=label,
        )
        for start, end, label in repaired
    ]
    record_end_tick = quantize_tick(record_end_exact)
    if record_end_tick <= 0:
        raise PreparationError(
            f"{kind}CollapsedAfterQuantization",
            f"{kind} record collapsed after quantization",
        )
    spans[0] = replace(spans[0], start_tick=0)
    spans[-1] = replace(spans[-1], end_tick=record_end_tick)

    # A boundary a few milliseconds from the selected downbeat can produce a
    # zero-frame edge fragment. Dropping only that edge fragment is the
    # monotonic equivalent of snapping it to the downbeat; interior collapses
    # remain errors because silently deleting them would change the progression.
    while (
        len(spans) > 1
        and spans[0].start_tick == 0
        and spans[0].end_tick == 0
        and repaired[0][1] - repaired[0][0] < FRAME_TICKS
        and spans[1].start_tick == 0
    ):
        spans.pop(0)
        repaired.pop(0)
    while (
        len(spans) > 1
        and spans[-1].start_tick == record_end_tick
        and spans[-1].end_tick == record_end_tick
        and repaired[-1][1] - repaired[-1][0] < FRAME_TICKS
        and spans[-2].end_tick == record_end_tick
    ):
        spans.pop()
        repaired.pop()
    for span in spans:
        if span.end_tick <= span.start_tick:
            raise PreparationError(
                f"{kind}CollapsedAfterQuantization",
                f"{kind} contains a sub-frame interval",
            )
    for left, right in zip(spans, spans[1:]):
        if right.start_tick > left.end_tick:
            raise PreparationError(
                f"{kind}GapAfterQuantization",
                f"{kind} contains a gap after quantization",
            )
        if right.start_tick < left.end_tick:
            raise PreparationError(
                f"{kind}OverlapAfterQuantization",
                f"{kind} contains an overlap after quantization",
            )
    if spans[0].start_tick != 0 or spans[-1].end_tick != record_end_tick:
        raise PreparationError(
            f"{kind}Coverage",
            f"{kind} does not cover the quantized record",
        )
    return spans


def parse_key(label: str) -> tuple[int, str]:
    match = LABEL_PATTERN.fullmatch(label)
    if match is None or match.group("bass") is not None:
        raise PreparationError("unsupportedKey", f"unsupported key label: {label}")
    root = PITCH_CLASSES.get(match.group("root"))
    mode = MODE_MAP.get(match.group("quality").lower())
    if root is None or mode is None:
        raise PreparationError("unsupportedKey", f"unsupported key label: {label}")
    return root, mode


def normalize_quality(raw: str) -> tuple[str, list[str]]:
    quality = raw.lower().replace("(", "").replace(")", "").replace(",", "")
    extension_source = quality
    extensions: set[str] = set()
    for altered in ("b9", "#9", "#11", "b13"):
        if altered in extension_source:
            extensions.add(altered)
            extension_source = extension_source.replace(altered, "")
    for natural in ("6", "9", "11", "13"):
        if natural in extension_source:
            extensions.add(natural)
    if quality.startswith("minmaj"):
        normalized = "minorMajor7"
    elif quality.startswith("hdim"):
        normalized = "halfDiminished7"
    elif quality.startswith("dim7"):
        normalized = "diminished7"
    elif quality.startswith("dim"):
        normalized = "diminished"
    elif quality.startswith("augmaj"):
        normalized = "augmentedMajor7"
    elif quality.startswith("aug"):
        normalized = "augmented"
    elif quality.startswith("sus2"):
        normalized = "sus2"
    elif quality.startswith("sus4"):
        normalized = "sus4"
    elif quality.startswith("minadd9"):
        normalized = "minorAdd9"
        extensions.add("9")
    elif quality.startswith("add9"):
        normalized = "add9"
        extensions.add("9")
    elif quality.startswith(("maj7", "maj9", "maj11", "maj13")):
        normalized = "major7"
    elif quality.startswith("maj6"):
        normalized = "major"
        extensions.add("6")
    elif quality.startswith("maj"):
        normalized = "major"
    elif quality.startswith(("min7", "min9", "min11", "min13")):
        normalized = "minor7"
    elif quality.startswith("min6"):
        normalized = "minor"
        extensions.add("6")
    elif quality.startswith("min"):
        normalized = "minor"
    elif quality.startswith(("7", "9", "11", "13")):
        normalized = "dominant7"
    else:
        raise PreparationError(
            "unsupportedChordQuality",
            f"unsupported chord quality: {raw}",
        )
    return normalized, sorted(extensions, key=EXTENSIONS.index)


def parse_chord(label: str, key_root: int) -> dict[str, Any]:
    match = LABEL_PATTERN.fullmatch(label)
    if match is None:
        raise PreparationError("unsupportedChord", f"unsupported chord label: {label}")
    root = PITCH_CLASSES.get(match.group("root"))
    if root is None:
        raise PreparationError("unsupportedChord", f"unsupported chord root: {label}")
    quality, extensions = normalize_quality(match.group("quality"))
    bass_label = match.group("bass")
    bass_degree_is_chord_tone = True
    if bass_label is None:
        bass_offset = 0
    elif bass_label in PITCH_CLASSES:
        bass_offset = (PITCH_CLASSES[bass_label] - root) % 12
    else:
        interval_match = re.fullmatch(r"(?P<accidental>[#b]?)(?P<degree>\d+)", bass_label)
        if interval_match is None:
            raise PreparationError(
                "unsupportedChord",
                f"unsupported chord bass: {label}",
            )
        degree = int(interval_match.group("degree"))
        base_intervals = {1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11}
        simple_degree = ((degree - 1) % 7) + 1
        base = base_intervals.get(simple_degree)
        if base is None:
            raise PreparationError(
                "unsupportedChord",
                f"unsupported chord bass: {label}",
            )
        accidental_text = interval_match.group("accidental")
        if accidental_text:
            accidental = {"b": -1, "#": 1}[accidental_text]
            bass_offset = (base + accidental) % 12
        else:
            chord_degrees = _quality_degree_intervals(quality, extensions)
            if simple_degree in chord_degrees:
                bass_offset = chord_degrees[simple_degree]
            else:
                bass_offset = base
                bass_degree_is_chord_tone = False
    chord_degrees = _quality_degree_intervals(quality, extensions)
    third = chord_degrees.get(3)
    fifth = chord_degrees.get(5)
    seventh = chord_degrees.get(7)
    if bass_offset == 0:
        inversion = 0
    elif bass_degree_is_chord_tone and third is not None and bass_offset == third:
        inversion = 1
    elif bass_degree_is_chord_tone and fifth is not None and bass_offset == fifth:
        inversion = 2
    elif bass_degree_is_chord_tone and seventh is not None and bass_offset == seventh:
        inversion = 3
    else:
        inversion = 4
    return {
        "rootOffsetFromKey": (root - key_root) % 12,
        "quality": quality,
        "inversion": inversion,
        "bassOffsetFromRoot": bass_offset,
        "extensions": extensions,
        "originalLabel": label,
    }


def _quality_degree_intervals(
    quality: str,
    extensions: Sequence[str],
) -> dict[int, int]:
    if quality in {
        "minor",
        "minor7",
        "minorMajor7",
        "minorAdd9",
        "diminished",
        "diminished7",
        "halfDiminished7",
    }:
        third = 3
    elif quality in {"sus2", "sus4"}:
        third = None
    else:
        third = 4
    if quality in {"diminished", "diminished7", "halfDiminished7"}:
        fifth = 6
    elif quality in {"augmented", "augmentedMajor7"}:
        fifth = 8
    else:
        fifth = 7
    degrees = {1: 0, 5: fifth}
    if third is not None:
        degrees[3] = third
    if quality == "sus2":
        degrees[2] = 2
    if quality == "sus4":
        degrees[4] = 5
    if quality in {"dominant7", "minor7", "halfDiminished7"}:
        degrees[7] = 10
    elif quality in {"major7", "minorMajor7", "augmentedMajor7"}:
        degrees[7] = 11
    elif quality == "diminished7":
        degrees[7] = 9
    if "6" in extensions:
        degrees[6] = 9
    if "9" in extensions:
        degrees[2] = 2
    return degrees


def _merge_harmony(events: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for event in events:
        if merged:
            previous = merged[-1]
            previous_end = previous["startTick"] + previous["durationTick"]
            factors = (
                "rootOffsetFromKey",
                "quality",
                "inversion",
                "bassOffsetFromRoot",
                "extensions",
                "originalLabel",
            )
            if previous_end == event["startTick"] and all(
                previous[field] == event[field] for field in factors
            ):
                previous["durationTick"] += event["durationTick"]
                continue
        merged.append(dict(event))
    return merged


def _prepare_unsplit_song(
    song_directory: Path,
    *,
    gap_policy: GapPolicy,
) -> dict[str, Any]:
    source_item_id = song_directory.name
    if SAFE_ITEM_ID.fullmatch(source_item_id) is None:
        raise PreparationError(
            "invalidSourceItemId",
            f"unsafe POP909 song directory name: {source_item_id}",
        )
    grid = BeatGrid.from_file(song_directory / "beat_audio.txt")
    chord_labels = parse_timed_labels(song_directory / "chord_audio.txt")
    key_labels = parse_timed_labels(song_directory / "key_audio.txt")
    annotation_start = max(chord_labels[0].start, key_labels[0].start)
    record_end = min(chord_labels[-1].end, key_labels[-1].end)
    if record_end <= annotation_start:
        raise PreparationError(
            "annotationCoverage",
            "chord and key annotations do not overlap",
        )
    record_start = grid.first_downbeat_at_or_after(annotation_start, record_end)
    if not grid.covers_with_one_beat_margin(record_start, record_end):
        raise PreparationError(
            "beatCoverage",
            "chord/key annotations extend beyond the beat grid margin",
        )

    tonal_spans = quantize_spans(
        key_labels,
        grid=grid,
        record_start=record_start,
        record_end=record_end,
        kind="tonality",
    )
    chord_spans = quantize_spans(
        chord_labels,
        grid=grid,
        record_start=record_start,
        record_end=record_end,
        kind="harmony",
    )
    end_tick = tonal_spans[-1].end_tick

    tonalities: list[dict[str, Any]] = []
    for span in tonal_spans:
        key_root, mode = parse_key(span.label)
        tonalities.append(
            {
                "startTick": span.start_tick,
                "endTick": span.end_tick,
                "keyRoot": key_root,
                "mode": mode,
            }
        )

    harmony: list[dict[str, Any]] = []
    saw_no_chord = False
    for chord in chord_spans:
        if chord.label == "N":
            saw_no_chord = True
            continue
        covered = 0
        for tonality in tonalities:
            start_tick = max(chord.start_tick, tonality["startTick"])
            end_tick_for_fragment = min(chord.end_tick, tonality["endTick"])
            if end_tick_for_fragment <= start_tick:
                continue
            factors = parse_chord(chord.label, tonality["keyRoot"])
            harmony.append(
                {
                    "startTick": start_tick,
                    "durationTick": end_tick_for_fragment - start_tick,
                    **factors,
                }
            )
            covered += end_tick_for_fragment - start_tick
        if covered != chord.end_tick - chord.start_tick:
            raise PreparationError(
                "tonalityCoverage",
                "a chord is not fully covered by the tonality timeline",
            )
    if saw_no_chord and gap_policy == "reject":
        raise PreparationError(
            "noChordRegion",
            "N-labelled harmony requires --gap-policy allow-no-chord",
        )
    if not harmony:
        raise PreparationError("emptyHarmony", "song has no supported chord events")

    return {
        "recordId": f"{SOURCE_ID}-{source_item_id}",
        "workId": f"{SOURCE_ID}-{source_item_id}",
        "sourceId": SOURCE_ID,
        "sourceItemId": source_item_id,
        "ppq": PPQ,
        "ticksPerBar": grid.ticks_per_bar,
        "timeSignature": grid.time_signature,
        "startTick": 0,
        "endTick": end_tick,
        "harmony": _merge_harmony(harmony),
        "tonalities": tonalities,
        "synthetic": False,
    }


def split_record_at_bar_boundaries(
    record: dict[str, Any],
) -> list[dict[str, Any]]:
    """Split one song without allowing its parts to cross dataset splits."""

    ticks_per_bar = record["ticksPerBar"]
    maximum_ticks = MAXIMUM_BARS * ticks_per_bar
    end_tick = record["endTick"]
    if end_tick <= maximum_ticks:
        return [record]
    part_count = (end_tick + maximum_ticks - 1) // maximum_ticks
    base_record_id = record["recordId"]
    parts: list[dict[str, Any]] = []
    for part_index in range(part_count):
        chunk_start = part_index * maximum_ticks
        chunk_end = min(end_tick, chunk_start + maximum_ticks)
        chunk_length = chunk_end - chunk_start
        harmony: list[dict[str, Any]] = []
        for event in record["harmony"]:
            event_start = event["startTick"]
            event_end = event_start + event["durationTick"]
            clipped_start = max(event_start, chunk_start)
            clipped_end = min(event_end, chunk_end)
            if clipped_end <= clipped_start:
                continue
            harmony.append(
                {
                    **event,
                    "startTick": clipped_start - chunk_start,
                    "durationTick": clipped_end - clipped_start,
                }
            )
        tonalities: list[dict[str, Any]] = []
        for span in record["tonalities"]:
            clipped_start = max(span["startTick"], chunk_start)
            clipped_end = min(span["endTick"], chunk_end)
            if clipped_end <= clipped_start:
                continue
            tonalities.append(
                {
                    **span,
                    "startTick": clipped_start - chunk_start,
                    "endTick": clipped_end - chunk_start,
                }
            )
        part = {
            **record,
            "recordId": f"{base_record_id}-part-{part_index + 1:03d}",
            "startTick": 0,
            "endTick": chunk_length,
            "harmony": harmony,
            "tonalities": tonalities,
        }
        _validate_split_record(part)
        parts.append(part)
    if sum(part["endTick"] for part in parts) != end_tick:
        raise PreparationError(
            "splitCoverage",
            "split records do not reconstruct the source duration",
        )
    if len({part["workId"] for part in parts}) != 1 or len(
        {part["sourceItemId"] for part in parts}
    ) != 1:
        raise PreparationError(
            "splitIdentity",
            "split records lost their shared leakage-group identity",
        )
    return parts


def _validate_split_record(record: dict[str, Any]) -> None:
    end_tick = record["endTick"]
    if not 0 < end_tick <= MAXIMUM_BARS * record["ticksPerBar"]:
        raise PreparationError(
            "splitLength",
            "split record exceeds the model bar contract",
        )
    tonalities = record["tonalities"]
    if (
        not tonalities
        or tonalities[0]["startTick"] != 0
        or tonalities[-1]["endTick"] != end_tick
    ):
        raise PreparationError(
            "splitTonalityCoverage",
            "split tonality does not cover the complete part",
        )
    for left, right in zip(tonalities, tonalities[1:]):
        if left["endTick"] != right["startTick"]:
            raise PreparationError(
                "splitTonalityCoverage",
                "split tonalities contain a gap or overlap",
            )
    previous_end = 0
    for event in record["harmony"]:
        start_tick = event["startTick"]
        event_end = start_tick + event["durationTick"]
        if (
            start_tick < previous_end
            or start_tick < 0
            or event_end > end_tick
            or event_end <= start_tick
        ):
            raise PreparationError(
                "splitHarmonyOverlap",
                "split harmony is out of range or overlaps",
            )
        previous_end = event_end


def prepare_song_records(
    song_directory: Path,
    *,
    gap_policy: GapPolicy,
) -> list[dict[str, Any]]:
    return split_record_at_bar_boundaries(
        _prepare_unsplit_song(song_directory, gap_policy=gap_policy)
    )


def prepare_song(song_directory: Path, *, gap_policy: GapPolicy) -> dict[str, Any]:
    """Compatibility helper for songs that fit in one model record."""

    records = prepare_song_records(song_directory, gap_policy=gap_policy)
    if len(records) != 1:
        raise PreparationError(
            "multipleSongParts",
            "song requires multiple records; use prepare_song_records",
        )
    return records[0]


def _source_material_sha256(song_directories: Sequence[Path]) -> str:
    digest = hashlib.sha256()
    common_root = Path(os.path.commonpath([str(path) for path in song_directories]))
    for song in song_directories:
        for name in ("beat_audio.txt", "chord_audio.txt", "key_audio.txt"):
            path = song / name
            relative = path.relative_to(common_root).as_posix().encode("utf-8")
            payload = path.read_bytes()
            digest.update(len(relative).to_bytes(8, "big"))
            digest.update(relative)
            digest.update(len(payload).to_bytes(8, "big"))
            digest.update(payload)
    return digest.hexdigest()


def prepare_corpus(input_path: Path, *, gap_policy: GapPolicy) -> PreparedCorpus:
    songs = resolve_song_directories(input_path.resolve())
    source_sha256 = _source_material_sha256(songs)
    records: list[dict[str, Any]] = []
    excluded: Counter[str] = Counter()
    for song in songs:
        try:
            records.extend(prepare_song_records(song, gap_policy=gap_policy))
        except (OSError, UnicodeError, PreparationError) as exc:
            reason = exc.reason if isinstance(exc, PreparationError) else "annotationReadError"
            excluded[reason] += 1
    return PreparedCorpus(
        records=tuple(sorted(records, key=lambda item: item["recordId"])),
        discovered_song_count=len(songs),
        excluded_by_reason=dict(sorted(excluded.items())),
        source_material_sha256=source_sha256,
    )


def canonical_jsonl(records: Sequence[dict[str, Any]]) -> bytes:
    return b"".join(
        (
            json.dumps(
                record,
                ensure_ascii=True,
                separators=(",", ":"),
                sort_keys=True,
            )
            + "\n"
        ).encode("utf-8")
        for record in records
    )


def canonical_json(payload: dict[str, Any]) -> bytes:
    return (
        json.dumps(
            payload,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")


def atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def validate_utc(value: str, field: str) -> str:
    if UTC_PATTERN.fullmatch(value) is None:
        raise PreparationError(
            "invalidLedgerMetadata",
            f"{field} must use YYYY-MM-DDTHH:MM:SSZ",
        )
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise PreparationError(
            "invalidLedgerMetadata",
            f"{field} is not a valid UTC timestamp",
        ) from exc
    return value


def git_commit(path: Path) -> str | None:
    try:
        value = subprocess.run(
            ["git", "-C", str(path), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None
    return value if re.fullmatch(r"[0-9a-f]{40,64}", value) else None


def build_ledger_v2(
    *,
    records_sha256: str,
    corpus: PreparedCorpus,
    source_version: str,
    retrieved_at_utc: str,
    reviewed_at_utc: str,
    license_id: str,
) -> dict[str, Any]:
    if not source_version or len(source_version) > 128:
        raise PreparationError(
            "invalidLedgerMetadata",
            "source version must contain 1 to 128 characters",
        )
    if not license_id or len(license_id) > 128:
        raise PreparationError(
            "invalidLedgerMetadata",
            "license id must contain 1 to 128 characters",
        )
    return {
        "schemaVersion": LEDGER_SCHEMA_VERSION,
        "policyId": LEDGER_POLICY_ID,
        "purpose": LEDGER_PURPOSE,
        "distributionScope": LEDGER_DISTRIBUTION_SCOPE,
        "rawDataInGit": False,
        "normalizedInputSha256": records_sha256,
        "sources": [
            {
                "sourceId": SOURCE_ID,
                "version": source_version,
                "canonicalUrl": CANONICAL_URL,
                "citation": ATTRIBUTION_CITATION,
                "retrievedAt": validate_utc(
                    retrieved_at_utc,
                    "retrievedAt",
                ),
                "review": {
                    "status": "approved",
                    "basis": "license",
                    "licenseId": license_id,
                    "allowedContent": ["harmony", "key", "meter"],
                    "reviewedAt": validate_utc(
                        reviewed_at_utc,
                        "reviewedAt",
                    ),
                },
                "attribution": ATTRIBUTION_CITATION,
                "sourceMaterialSha256": corpus.source_material_sha256,
                "normalizedRecordsSha256": records_sha256,
                "removalProcedure": (
                    "Delete the private POP909 checkout, normalized JSONL, "
                    "processed splits, and locally trained checkpoint; then rebuild."
                ),
            }
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Prepare private harmony/key/meter-only HarmonyForge records from "
            "a local POP909 checkout. No MIDI or audio is read."
        )
    )
    parser.add_argument("--pop909", required=True, type=Path)
    parser.add_argument("--output-records", required=True, type=Path)
    parser.add_argument("--output-ledger", required=True, type=Path)
    parser.add_argument("--source-version")
    parser.add_argument("--retrieved-at-utc", required=True)
    parser.add_argument("--reviewed-at-utc")
    parser.add_argument("--license-id", default="MIT")
    parser.add_argument(
        "--gap-policy",
        choices=("reject", "allow-no-chord"),
        default="reject",
        help=(
            "reject pairs with compiler --harmony-gap-policy excludeRecord; "
            "allow-no-chord pairs with allowNoChord"
        ),
    )
    arguments = parser.parse_args()

    source_version = arguments.source_version or git_commit(arguments.pop909.resolve())
    if source_version is None:
        parser.error(
            "--source-version is required when the POP909 checkout has no Git commit"
        )
    reviewed_at_utc = arguments.reviewed_at_utc or arguments.retrieved_at_utc
    corpus = prepare_corpus(arguments.pop909, gap_policy=arguments.gap_policy)
    if not corpus.records:
        reasons = ", ".join(
            f"{reason}={count}"
            for reason, count in corpus.excluded_by_reason.items()
        )
        parser.error(f"no eligible POP909 records remained ({reasons})")
    records_bytes = canonical_jsonl(corpus.records)
    records_sha256 = hashlib.sha256(records_bytes).hexdigest()
    ledger = build_ledger_v2(
        records_sha256=records_sha256,
        corpus=corpus,
        source_version=source_version,
        retrieved_at_utc=arguments.retrieved_at_utc,
        reviewed_at_utc=reviewed_at_utc,
        license_id=arguments.license_id,
    )
    atomic_write(arguments.output_records.resolve(), records_bytes)
    atomic_write(arguments.output_ledger.resolve(), canonical_json(ledger))
    print(
        json.dumps(
            {
                "schemaVersion": 1,
                "eligibleRecordCount": len(corpus.records),
                "excludedRecordCount": sum(corpus.excluded_by_reason.values()),
                "excludedByReason": corpus.excluded_by_reason,
                "gapPolicy": arguments.gap_policy,
                "compilerHarmonyGapPolicy": COMPILER_GAP_POLICIES[
                    arguments.gap_policy
                ],
                "quantization": {
                    "ppq": PPQ,
                    "frameTicks": FRAME_TICKS,
                    "beatUnit": "quarter",
                    "rounding": "nearestTiesAwayFromZero",
                    "adjacentJitterRepair": (
                        "snapWhenAbsoluteDeltaIsBelowOneFrame"
                    ),
                },
                "normalizedRecordsSha256": records_sha256,
                "recordsPath": str(arguments.output_records.resolve()),
                "ledgerPath": str(arguments.output_ledger.resolve()),
                "ledgerContractStatus": "compilerV2Compatible",
            },
            ensure_ascii=True,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
