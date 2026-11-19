#!/usr/bin/env python3
"""Train the local harmony language model from normalized chord sequences.

The primary input is a local checkout of POP909. Only aggregate n-gram counts
are written to the model file; MIDI, song titles, and raw annotations are not
copied into the application repository.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

MODEL_ID = "harmony-corpus-ngram-v1"
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
CHORD_PATTERN = re.compile(r"^(?P<root>[A-G](?:#|b)?):(?P<quality>[^/]+)")


@dataclass(frozen=True, slots=True)
class TimedLabel:
    start: float
    end: float
    label: str


def parse_timed_labels(path: Path) -> list[TimedLabel]:
    labels: list[TimedLabel] = []
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(),
        start=1,
    ):
        if not raw_line.strip():
            continue
        fields = raw_line.split("\t")
        if len(fields) != 3:
            raise ValueError(f"{path}:{line_number}: expected three tab-separated fields")
        start, end = float(fields[0]), float(fields[1])
        if not 0 <= start < end:
            raise ValueError(f"{path}:{line_number}: invalid time interval")
        labels.append(TimedLabel(start=start, end=end, label=fields[2].strip()))
    return labels


def normalized_quality(raw_quality: str) -> str | None:
    quality = raw_quality.lower()
    if quality.startswith("minmaj"):
        return "minorMajor7"
    if quality.startswith("hdim"):
        return "halfDiminished7"
    if quality.startswith("dim7"):
        return "diminished7"
    if quality.startswith("dim"):
        return "diminished"
    if quality.startswith("aug"):
        return "augmented"
    if quality.startswith("sus2"):
        return "sus2"
    if quality.startswith("sus4"):
        return "sus4"
    if quality.startswith(("maj7", "maj9")):
        return "major7"
    if quality.startswith("maj"):
        return "major"
    if quality.startswith(("min7", "min9", "min11")):
        return "minor7"
    if quality.startswith("min"):
        return "minor"
    if quality.startswith(("7", "9", "11", "13")):
        return "dominant7"
    return None


def chord_token(label: str, key_label: str) -> str | None:
    match = CHORD_PATTERN.match(label)
    key_match = CHORD_PATTERN.match(key_label)
    if match is None or key_match is None:
        return None
    root = PITCH_CLASSES.get(match.group("root"))
    key_root = PITCH_CLASSES.get(key_match.group("root"))
    quality = normalized_quality(match.group("quality"))
    if root is None or key_root is None or quality is None:
        return None
    return f"{(root - key_root) % 12}:{quality}"


def key_index_for_time(keys: list[TimedLabel], instant: float) -> int | None:
    for index, key in enumerate(keys):
        if key.start <= instant < key.end:
            return index
    return None


def sequences_from_pop909_song(song_directory: Path) -> list[list[str]]:
    keys = parse_timed_labels(song_directory / "key_audio.txt")
    chords = parse_timed_labels(song_directory / "chord_audio.txt")
    sequences: list[list[str]] = []
    current: list[str] = []
    previous_key_index: int | None = None

    def flush() -> None:
        nonlocal current
        if len(current) >= 2:
            sequences.append(current)
        current = []

    for chord in chords:
        key_index = key_index_for_time(keys, (chord.start + chord.end) / 2)
        if key_index is None or chord.label == "N":
            flush()
            previous_key_index = None
            continue
        if previous_key_index is not None and key_index != previous_key_index:
            flush()
        token = chord_token(chord.label, keys[key_index].label)
        previous_key_index = key_index
        if token is None:
            flush()
            continue
        if not current or current[-1] != token:
            current.append(token)
    flush()
    return sequences


def resolve_pop909_songs(input_path: Path) -> list[Path]:
    candidates = (input_path / "POP909", input_path)
    for candidate in candidates:
        if candidate.is_dir():
            songs = sorted(
                path
                for path in candidate.iterdir()
                if path.is_dir()
                and (path / "chord_audio.txt").is_file()
                and (path / "key_audio.txt").is_file()
            )
            if songs:
                return songs
    raise ValueError(
        "POP909 directory must contain numbered song folders with "
        "chord_audio.txt and key_audio.txt"
    )


def sequences_from_jsonl(path: Path) -> list[list[str]]:
    sequences: list[list[str]] = []
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(),
        start=1,
    ):
        if not raw_line.strip():
            continue
        payload = json.loads(raw_line)
        raw_sequence = payload.get("tokens") if isinstance(payload, dict) else payload
        if (
            not isinstance(raw_sequence, list)
            or len(raw_sequence) < 2
            or not all(isinstance(token, str) and token for token in raw_sequence)
        ):
            raise ValueError(f"{path}:{line_number}: expected a token list of length >= 2")
        sequences.append(raw_sequence)
    return sequences


def count_ngrams(
    sequences: Iterable[list[str]],
    maximum_order: int,
) -> dict[str, dict[str, int]]:
    orders: dict[str, Counter[str]] = {
        str(order): Counter() for order in range(1, maximum_order + 1)
    }
    for sequence in sequences:
        for order in range(1, maximum_order + 1):
            for index in range(len(sequence) - order + 1):
                gram = ">".join(sequence[index : index + order])
                orders[str(order)][gram] += 1
    if any(not counts for counts in orders.values()):
        raise ValueError("Training data is too short for the requested maximum order")
    return {
        order: dict(sorted(counts.items()))
        for order, counts in orders.items()
    }


def git_commit(path: Path) -> str | None:
    try:
        return subprocess.run(
            ["git", "-C", str(path), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def atomic_write_json(output_path: Path, payload: dict[str, object]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output_path.name}.",
        suffix=".tmp",
        dir=output_path.parent,
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary_name, output_path)
    except BaseException:
        Path(temporary_name).unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pop909", type=Path)
    parser.add_argument("--jsonl", action="append", type=Path, default=[])
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--max-order", type=int, default=5, choices=range(1, 9))
    arguments = parser.parse_args()
    if arguments.pop909 is None and not arguments.jsonl:
        parser.error("at least one of --pop909 or --jsonl is required")

    sequences: list[list[str]] = []
    source: dict[str, object] = {"kind": "local-corpus"}
    song_count = 0
    if arguments.pop909 is not None:
        songs = resolve_pop909_songs(arguments.pop909.resolve())
        song_count = len(songs)
        for song in songs:
            sequences.extend(sequences_from_pop909_song(song))
        source.update(
            {
                "pop909Repository": "https://github.com/music-x-lab/POP909-Dataset",
                "pop909Commit": git_commit(arguments.pop909.resolve()),
                "pop909SongCount": song_count,
            }
        )
    for jsonl_path in arguments.jsonl:
        sequences.extend(sequences_from_jsonl(jsonl_path.resolve()))

    payload: dict[str, object] = {
        "schemaVersion": 1,
        "modelId": MODEL_ID,
        "modelVersion": "local-corpus-v1",
        "source": {
            **source,
            "sequenceCount": len(sequences),
            "tokenCount": sum(len(sequence) for sequence in sequences),
            "rawSongDataBundled": False,
        },
        "orders": count_ngrams(sequences, arguments.max_order),
    }
    atomic_write_json(arguments.output.resolve(), payload)
    print(
        f"Saved {MODEL_ID}: {len(sequences)} sequences from {song_count} POP909 songs "
        f"to {arguments.output.resolve()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
