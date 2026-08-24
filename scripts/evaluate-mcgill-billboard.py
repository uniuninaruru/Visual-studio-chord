#!/usr/bin/env python3
"""Parse the annotation-only McGill Billboard v2 evaluation corpus.

This module produces an aggregate, key-relative external evaluation.  It does
not train or alter the POP909 runtime model, and it never publishes expressive
annotation content or song identifiers.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import stat
import sys
import tempfile
import types
from datetime import datetime, timezone
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

ARCHIVE_URL = (
    "https://www.dropbox.com/s/2lvny9ves8kns4o/billboard-2.0-salami_chords.tar.gz?dl=1"
)
SOURCE_PAGE_URL = (
    "https://ddmal.ca/research/The_McGill_Billboard_Project_(Chord_Analysis_Dataset)/"
)
EXPECTED_ARCHIVE_SHA256 = (
    "a22e32bf24c8a18859ce18427c6501a7a72520185cddd6d882ceb3c61d02ec75"
)
EXPECTED_MODEL_SHA256 = (
    "dfa28603b2aa0247abe5265a6975ae8267042a91e72e8c1ddd2221e2624209ae"
)
EXPECTED_PORTABLE_SOURCE_SHA256 = (
    "312a0e6478ca018aef44291e799434cc2096c0ea4a0e2568ef0ac90020ebb503"
)
EXPECTED_NORMALIZED_EVALUATION_SHA256 = (
    "f0ceb26872322f3e867d0d6ba9c4523c0bd057efed9799769a6208993cc21fdb"
)
EXPECTED_ANNOTATION_FILE_COUNT = 890
EXPECTED_EXTRACTED_BYTES = 1_589_999
PUBLISHED_DISTINCT_SONGS = 740
EXPECTED_RECEIPT_DATASET = "McGill-Billboard-v2"
EXPECTED_MEMBER_ROOT = "McGill-Billboard"
ANNOTATION_FILENAME = "salami_chords.txt"
RECEIPT_NAME = ".mcgill-billboard-receipt.json"
MAX_MEMBER_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_RECEIPT_BYTES = 1024 * 1024
MAX_MODEL_BYTES = 8 * 1024 * 1024
MAX_REPEAT = 128
PARSER_VERSION = "mcgill-salami-v2-normalizer-1"
DEFAULT_DATASET = Path("datasets/raw/McGill-Billboard-v2")
DEFAULT_MODEL = Path("models/harmony-corpus-v1.json")
MODEL_ID = "harmony-corpus-ngram-v1"
MODEL_VERSION = "local-corpus-v1"
EXPECTED_MODEL_ORDER_ENTRIES = {1: 106, 2: 1591, 3: 7540, 4: 19643, 5: 34335}
EXPECTED_MODEL_ORDER_TOTALS = {1: 93904, 2: 92773, 3: 91642, 4: 90512, 5: 89387}
MODEL_SOURCE_EXPECTED = {
    "kind": "local-corpus",
    "pop909Commit": "d83e6edba6872a704f5d3b8b32f5cb540088dae6",
    "pop909Repository": "https://github.com/music-x-lab/POP909-Dataset",
    "pop909SongCount": 909,
    "rawSongDataBundled": False,
    "sequenceCount": 1131,
    "tokenCount": 93904,
}
SUPPORTED_QUALITIES = frozenset(
    {
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
    }
)

MEMBER_PATTERN = re.compile(r"^McGill-Billboard/[0-9]{4}/salami_chords\.txt$")
SONG_DIRECTORY_PATTERN = re.compile(r"^[0-9]{4}$")
TIMESTAMP_PATTERN = re.compile(r"^[^\t]+\t[^\t]*$")
METER_PATTERN = re.compile(r"^[1-9][0-9]*/[1-9][0-9]*$")
TONIC_PATTERN = re.compile(r"^[A-G](?:#|b)?$")
SECTION_MARKER_PATTERN = re.compile(r"^\s*([A-Z](?:')*)(?=\s*(?:,|\||$))")
REPEAT_SUFFIX_PATTERN = re.compile(r"(?:^|[\s,])x([0-9]+)(?=\s*(?:,|$))")
METRE_BAR_PATTERN = re.compile(r"^\s*\(([1-9][0-9]*/[1-9][0-9]*)\)\s*")
UTC_TIMESTAMP_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$"
)


class EvaluationInputError(ValueError):
    """The external corpus is malformed or violates its safety contract."""


def _load_training_tokenizer() -> tuple[types.ModuleType, str]:
    script = Path(__file__).with_name("train-harmony-corpus.py")
    data = _read_regular_snapshot(script, max_bytes=MAX_MODEL_BYTES)
    digest = hashlib.sha256(data).hexdigest()
    module = types.ModuleType("train_harmony_corpus_for_eval")
    module.__file__ = str(script)
    sys.modules[module.__name__] = module
    try:
        code = compile(data, str(script), "exec")
        exec(code, module.__dict__)
    except (SyntaxError, OSError, ValueError) as exc:
        raise EvaluationInputError("the training tokenizer cannot be loaded") from exc
    return module, digest


@dataclass(frozen=True, slots=True)
class NormalizedSequence:
    """A context-contiguous token sequence and boundary flags per transition."""

    tokens: tuple[str, ...]
    section_boundaries: tuple[bool, ...]

    def __post_init__(self) -> None:
        if len(self.section_boundaries) != max(0, len(self.tokens) - 1):
            raise EvaluationInputError("section boundary count does not match sequence")


@dataclass(frozen=True, slots=True)
class Coverage:
    annotation_slots: int
    published_distinct_songs: int
    phrases: int
    bars: int
    chord_lexemes: int
    normalized_raw_lexemes: int
    supported_tokens: int
    unsupported_tokens: int
    special_markers: int
    dot_repetitions: int
    phrase_repetitions: int
    elision_markers: int
    key_changes: int
    meter_changes: int
    normalized_tokens: int
    sequences: int
    transitions: int
    unsupported_reasons: dict[str, int]
    special_reasons: dict[str, int]


@dataclass(frozen=True, slots=True)
class ParsedDataset:
    sequences: tuple[NormalizedSequence, ...]
    coverage: Coverage
    portable_source_sha256: str
    normalized_evaluation_sha256: str


@dataclass
class _MutableCoverage:
    phrases: int = 0
    bars: int = 0
    chord_lexemes: int = 0
    normalized_raw_lexemes: int = 0
    normalized_tokens: int = 0
    supported_tokens: int = 0
    unsupported_tokens: int = 0
    special_markers: int = 0
    dot_repetitions: int = 0
    phrase_repetitions: int = 0
    elision_markers: int = 0
    key_changes: int = 0
    meter_changes: int = 0
    unsupported_reasons: Counter[str] = field(default_factory=Counter)
    special_reasons: Counter[str] = field(default_factory=Counter)

    def unsupported(self, reason: str) -> None:
        self.unsupported_tokens += 1
        self.unsupported_reasons[reason] += 1


class _SongParser:
    def __init__(self, coverage: _MutableCoverage) -> None:
        self.coverage = coverage
        self.tonic: str | None = None
        self.meter: str | None = None
        self.last_timestamp = -math.inf
        self.current_tokens: list[str] = []
        self.current_boundaries: list[bool] = []
        self.phrase_first_token = False
        self.sequences: list[NormalizedSequence] = []

    def flush(self) -> None:
        if self.current_tokens:
            self.sequences.append(
                NormalizedSequence(
                    tuple(self.current_tokens),
                    tuple(self.current_boundaries),
                )
            )
        self.current_tokens.clear()
        self.current_boundaries.clear()
        self.phrase_first_token = False

    def set_tonic(self, value: str, *, initial: bool = False) -> None:
        value = value.strip()
        if value == "?":
            if not initial:
                self.coverage.key_changes += 1
                self.flush()
            self.tonic = None
            return
        if not TONIC_PATTERN.fullmatch(value):
            raise EvaluationInputError("invalid tonic header or change")
        if not initial and self.tonic != value:
            self.coverage.key_changes += 1
            self.flush()
        self.tonic = value

    def set_meter(self, value: str, *, initial: bool = False) -> None:
        value = value.strip()
        if not METER_PATTERN.fullmatch(value):
            raise EvaluationInputError("invalid metre header or change")
        if not initial and self.meter != value:
            self.coverage.meter_changes += 1
        self.meter = value

    def add_token(self, token: str, boundary: bool) -> None:
        self.coverage.normalized_raw_lexemes += 1
        self.coverage.supported_tokens += 1
        if self.current_tokens and self.current_tokens[-1] == token:
            return
        if self.current_tokens:
            self.current_boundaries.append(boundary)
        self.current_tokens.append(token)
        self.coverage.normalized_tokens += 1

    def unsupported(self, reason: str) -> None:
        self.coverage.unsupported(reason)
        self.flush()

    def special(self, reason: str) -> None:
        self.coverage.special_markers += 1
        self.coverage.special_reasons[reason] += 1
        self.flush()

    def parse_header(self, line: str, *, initial: bool) -> bool:
        if not line.startswith("#"):
            return False
        match = re.fullmatch(r"#\s*([^:]+):\s*(.*)", line)
        if match is None:
            raise EvaluationInputError("malformed Salami header")
        key, value = match.group(1).strip().casefold(), match.group(2).strip()
        if key in {"title", "artist"}:
            if not initial or key in self._seen_headers:
                raise EvaluationInputError("duplicate or late title/artist header")
            if not value:
                raise EvaluationInputError("empty title/artist header")
            self._seen_headers.add(key)
        elif key == "tonic":
            if initial and key in self._seen_headers:
                raise EvaluationInputError("duplicate tonic header")
            if initial:
                self._seen_headers.add(key)
            self.set_tonic(value, initial=initial)
        elif key == "metre":
            if initial and key in self._seen_headers:
                raise EvaluationInputError("duplicate metre header")
            if initial:
                self._seen_headers.add(key)
            self.set_meter(value, initial=initial)
        else:
            raise EvaluationInputError("unknown Salami header")
        return True

    def parse_timestamp_line(self, line: str) -> None:
        if not TIMESTAMP_PATTERN.fullmatch(line):
            raise EvaluationInputError("malformed timestamp line")
        raw_timestamp, annotation = line.split("\t", 1)
        try:
            timestamp = float(raw_timestamp)
        except ValueError:
            raise EvaluationInputError("invalid timestamp")
        if (
            not math.isfinite(timestamp)
            or timestamp < 0
            or timestamp < self.last_timestamp
        ):
            raise EvaluationInputError("invalid timestamp")
        self.last_timestamp = timestamp
        annotation = annotation.strip()
        if annotation in {"silence", "end"}:
            self.coverage.special_markers += 1
            self.coverage.special_reasons[annotation] += 1
            self.flush()
            return
        if re.match(r"^Z'*\s*(?:,|$)", annotation):
            self.special("Z")
            return
        self.parse_phrase(annotation)

    def parse_phrase(self, annotation: str) -> None:
        first_bar, last_bar = annotation.find("|"), annotation.rfind("|")
        if first_bar < 0 or last_bar <= first_bar:
            raise EvaluationInputError("malformed Salami phrase")
        bar_text = annotation[first_bar + 1 : last_bar]
        prefix = annotation[:first_bar]
        suffix = annotation[last_bar + 1 :]
        marker = SECTION_MARKER_PATTERN.match(prefix)
        phrase_boundary = marker is not None
        self.phrase_first_token = True
        self.coverage.phrases += 1
        if "->" in annotation:
            self.coverage.elision_markers += annotation.count("->")
            suffix = suffix.replace("->", " ")
            bar_text = bar_text.replace("->", " ")
        repeat_match = REPEAT_SUFFIX_PATTERN.search(suffix)
        repeats = 1
        if repeat_match is not None:
            repeats = int(repeat_match.group(1))
            if repeats < 1 or repeats > MAX_REPEAT:
                raise EvaluationInputError("phrase repeat exceeds the configured limit")
            self.coverage.phrase_repetitions += 1
        bars = bar_text.split("|")
        parsed_bars: list[list[str]] = []
        for raw_bar in bars:
            if (
                raw_bar.lstrip().startswith("(")
                and METRE_BAR_PATTERN.match(raw_bar) is None
            ):
                raise EvaluationInputError("invalid metre marker")
            metre_match = METRE_BAR_PATTERN.match(raw_bar)
            if metre_match is not None:
                self.set_meter(metre_match.group(1))
                raw_bar = raw_bar[metre_match.end() :]
            lexemes = raw_bar.split()
            parsed_bars.append(lexemes)
        self.coverage.bars += len(parsed_bars) * repeats
        phrase_previous_kind = "none"
        phrase_previous_value = ""
        for _repeat_index in range(repeats):
            for lexemes in parsed_bars:
                for lexeme in lexemes:
                    if lexeme == ".":
                        self.coverage.dot_repetitions += 1
                        if phrase_previous_kind == "valid":
                            self._consume_raw(
                                phrase_previous_value,
                                phrase_boundary and self.phrase_first_token,
                            )
                        elif phrase_previous_kind == "special":
                            self.special(phrase_previous_value)
                        elif phrase_previous_kind == "unsupported":
                            self.unsupported(phrase_previous_value)
                        else:
                            self.unsupported("dot_without_previous")
                        continue
                    if lexeme in {"N", "*", "&pause"}:
                        phrase_previous_kind = "special"
                        phrase_previous_value = lexeme
                        self.special(lexeme)
                        continue
                    self.coverage.chord_lexemes += 1
                    consumed_kind, consumed_value = self._consume_raw(
                        lexeme,
                        phrase_boundary and self.phrase_first_token,
                    )
                    phrase_previous_kind = consumed_kind
                    phrase_previous_value = consumed_value
                    phrase_boundary = False

    def _consume_raw(self, raw: str, boundary: bool) -> tuple[str, str]:
        if self.tonic is None:
            self.unsupported("missing_tonic")
            return "unsupported", "missing_tonic"
        match = CHORD_PATTERN.match(raw)
        if match is None:
            self.unsupported("malformed_chord")
            return "unsupported", "malformed_chord"
        token = chord_token(raw, f"{self.tonic}:maj")
        if token is None:
            quality = normalized_quality(match.group("quality"))
            reason = "unsupported_quality" if quality is None else "unsupported_chord"
            self.unsupported(reason)
            return "unsupported", reason
        self.add_token(token, boundary)
        self.phrase_first_token = False
        return "valid", raw

    def parse(self, text: str) -> tuple[NormalizedSequence, ...]:
        self._seen_headers: set[str] = set()
        header_phase = True
        for line in text.splitlines():
            if not line.strip():
                continue
            if line.startswith("#"):
                self.parse_header(line, initial=header_phase)
                continue
            header_phase = False
            self.parse_timestamp_line(line)
        self.flush()
        if self._seen_headers != {"title", "artist", "metre", "tonic"}:
            raise EvaluationInputError("missing required Salami header")
        return tuple(self.sequences)


def parse_song_bytes(data: bytes) -> tuple[tuple[NormalizedSequence, ...], Coverage]:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise EvaluationInputError("annotation is not UTF-8 text") from exc
    mutable = _MutableCoverage()
    parser = _SongParser(mutable)
    sequences = parser.parse(text)
    return sequences, Coverage(
        annotation_slots=1,
        published_distinct_songs=PUBLISHED_DISTINCT_SONGS,
        phrases=mutable.phrases,
        bars=mutable.bars,
        chord_lexemes=mutable.chord_lexemes,
        normalized_raw_lexemes=mutable.normalized_raw_lexemes,
        supported_tokens=mutable.supported_tokens,
        unsupported_tokens=mutable.unsupported_tokens,
        special_markers=mutable.special_markers,
        dot_repetitions=mutable.dot_repetitions,
        phrase_repetitions=mutable.phrase_repetitions,
        elision_markers=mutable.elision_markers,
        key_changes=mutable.key_changes,
        meter_changes=mutable.meter_changes,
        normalized_tokens=sum(len(sequence.tokens) for sequence in sequences),
        sequences=len(sequences),
        transitions=sum(max(0, len(sequence.tokens) - 1) for sequence in sequences),
        unsupported_reasons=dict(sorted(mutable.unsupported_reasons.items())),
        special_reasons=dict(sorted(mutable.special_reasons.items())),
    )


def _portable_tree_hash(files: Iterable[tuple[str, bytes]]) -> str:
    digest = hashlib.sha256()
    for relative, data in sorted(files, key=lambda item: item[0]):
        encoded = relative.encode("utf-8")
        digest.update(len(encoded).to_bytes(8, "big"))
        digest.update(encoded)
        digest.update(len(data).to_bytes(8, "big"))
        digest.update(data)
    return digest.hexdigest()


def normalized_canonical_bytes(
    sequences: Sequence[NormalizedSequence],
) -> bytes:
    payload = {
        "parserVersion": PARSER_VERSION,
        "sequences": [
            {
                "tokens": list(sequence.tokens),
                "sectionBoundaries": list(sequence.section_boundaries),
            }
            for sequence in sequences
        ],
    }
    return json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def normalized_evaluation_hash(sequences: Sequence[NormalizedSequence]) -> str:
    return hashlib.sha256(normalized_canonical_bytes(sequences)).hexdigest()


def _read_regular_snapshot(path: Path, *, max_bytes: int) -> bytes:
    """Read one regular file once and bind the bytes to its inode identity."""
    try:
        before = path.lstat()
        if not stat.S_ISREG(before.st_mode):
            raise EvaluationInputError("expected a regular file")
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags)
        with os.fdopen(descriptor, "rb", closefd=True) as handle:
            opened = os.fstat(handle.fileno())
            if (before.st_dev, before.st_ino, before.st_mode) != (
                opened.st_dev,
                opened.st_ino,
                opened.st_mode,
            ):
                raise EvaluationInputError("file changed while being opened")
            data = handle.read(max_bytes + 1)
            after = os.fstat(handle.fileno())
        if len(data) > max_bytes:
            raise EvaluationInputError("file exceeds the configured size limit")
        if (opened.st_dev, opened.st_ino, opened.st_mode, opened.st_size) != (
            after.st_dev,
            after.st_ino,
            after.st_mode,
            after.st_size,
        ):
            raise EvaluationInputError("file changed while being read")
        return data
    except EvaluationInputError:
        raise
    except (OSError, ValueError) as exc:
        raise EvaluationInputError("file cannot be read safely") from exc


_TRAIN, TRAIN_TOKENIZER_SHA256 = _load_training_tokenizer()
PITCH_CLASSES = _TRAIN.PITCH_CLASSES
CHORD_PATTERN = _TRAIN.CHORD_PATTERN
normalized_quality = _TRAIN.normalized_quality
chord_token = _TRAIN.chord_token


def _bounded_children(directory: Path, maximum: int) -> list[Path]:
    children: list[Path] = []
    try:
        iterator = directory.iterdir()
        for child in iterator:
            children.append(child)
            if len(children) > maximum:
                raise EvaluationInputError("directory contains too many entries")
    except EvaluationInputError:
        raise
    except OSError as exc:
        raise EvaluationInputError("directory cannot be inspected safely") from exc
    return children


def _validate_receipt(receipt_path: Path) -> dict[str, object]:
    try:
        data = _read_regular_snapshot(receipt_path, max_bytes=MAX_RECEIPT_BYTES)
        payload = _json_load_strict(data, "receipt")
    except EvaluationInputError:
        raise
    if not isinstance(payload, dict):
        raise EvaluationInputError("receipt must be an object")
    expected = {
        "receiptVersion": 1,
        "dataset": EXPECTED_RECEIPT_DATASET,
        "archiveSha256": EXPECTED_ARCHIVE_SHA256,
        "annotationFileCount": EXPECTED_ANNOTATION_FILE_COUNT,
        "extractedBytes": EXPECTED_EXTRACTED_BYTES,
        "annotationsOnly": True,
        "audioBundled": False,
        "titlesOrArtistsPublished": False,
    }
    for key, value in expected.items():
        if payload.get(key) != value:
            raise EvaluationInputError(f"receipt field {key!r} is invalid")
    return payload


def _validate_tree(
    dataset: Path,
) -> tuple[list[tuple[str, Path, bytes]], dict[str, object]]:
    if dataset.is_symlink() or not dataset.is_dir():
        raise EvaluationInputError("dataset root must be a regular directory")
    receipt = dataset / RECEIPT_NAME
    if receipt.is_symlink() or not receipt.is_file():
        raise EvaluationInputError("receipt must be a regular file")
    receipt_payload = _validate_receipt(receipt)
    root_entries = _bounded_children(dataset, 2)
    allowed_root = {EXPECTED_MEMBER_ROOT, RECEIPT_NAME}
    if {entry.name for entry in root_entries} != allowed_root:
        raise EvaluationInputError("dataset root contains unexpected entries")
    member_root = dataset / EXPECTED_MEMBER_ROOT
    if member_root.is_symlink() or not member_root.is_dir():
        raise EvaluationInputError("annotation root must be a regular directory")
    records: list[tuple[str, Path, bytes]] = []
    total_bytes = 0
    song_dirs = _bounded_children(member_root, EXPECTED_ANNOTATION_FILE_COUNT)
    if len(song_dirs) != EXPECTED_ANNOTATION_FILE_COUNT:
        raise EvaluationInputError("annotation file count does not match receipt")
    for song_dir in song_dirs:
        if (
            song_dir.is_symlink()
            or not song_dir.is_dir()
            or not SONG_DIRECTORY_PATTERN.fullmatch(song_dir.name)
        ):
            raise EvaluationInputError("annotation song directory is invalid")
        children = _bounded_children(song_dir, 1)
        if len(children) != 1 or children[0].name != ANNOTATION_FILENAME:
            raise EvaluationInputError(
                "annotation song directory contains unexpected files"
            )
        annotation = children[0]
        if annotation.is_symlink() or not annotation.is_file():
            raise EvaluationInputError("annotation must be a regular file")
        data = _read_regular_snapshot(annotation, max_bytes=MAX_MEMBER_BYTES)
        total_bytes += len(data)
        if total_bytes > MAX_TOTAL_BYTES:
            raise EvaluationInputError("annotations exceed the total size limit")
        relative = annotation.relative_to(dataset).as_posix()
        if not MEMBER_PATTERN.fullmatch(relative):
            raise EvaluationInputError("annotation path is invalid")
        records.append((relative, annotation, data))
    if total_bytes != int(receipt_payload["extractedBytes"]):
        raise EvaluationInputError("annotation byte count does not match receipt")
    records.sort(key=lambda item: item[0])
    return records, receipt_payload


def parse_dataset(dataset: Path = DEFAULT_DATASET) -> ParsedDataset:
    records, _receipt = _validate_tree(dataset.expanduser())
    tree_hash = _portable_tree_hash(
        (relative, data) for relative, _path, data in records
    )
    if tree_hash != EXPECTED_PORTABLE_SOURCE_SHA256:
        raise EvaluationInputError(
            "portable source-tree SHA-256 does not match the pin"
        )
    all_sequences: list[NormalizedSequence] = []
    aggregate = _MutableCoverage()
    for _relative, _path, data in records:
        sequences, coverage = parse_song_bytes(data)
        all_sequences.extend(sequences)
        for field_name in (
            "phrases",
            "bars",
            "chord_lexemes",
            "normalized_raw_lexemes",
            "supported_tokens",
            "unsupported_tokens",
            "special_markers",
            "dot_repetitions",
            "phrase_repetitions",
            "elision_markers",
            "key_changes",
            "meter_changes",
        ):
            setattr(
                aggregate,
                field_name,
                getattr(aggregate, field_name) + getattr(coverage, field_name),
            )
        aggregate.unsupported_reasons.update(coverage.unsupported_reasons)
        aggregate.special_reasons.update(coverage.special_reasons)
    aggregate.normalized_tokens = sum(
        len(sequence.tokens) for sequence in all_sequences
    )
    aggregate.supported_tokens = aggregate.normalized_raw_lexemes
    aggregate_count = Coverage(
        annotation_slots=len(records),
        published_distinct_songs=PUBLISHED_DISTINCT_SONGS,
        phrases=aggregate.phrases,
        bars=aggregate.bars,
        chord_lexemes=aggregate.chord_lexemes,
        normalized_raw_lexemes=aggregate.normalized_raw_lexemes,
        supported_tokens=aggregate.supported_tokens,
        unsupported_tokens=aggregate.unsupported_tokens,
        special_markers=aggregate.special_markers,
        dot_repetitions=aggregate.dot_repetitions,
        phrase_repetitions=aggregate.phrase_repetitions,
        elision_markers=aggregate.elision_markers,
        key_changes=aggregate.key_changes,
        meter_changes=aggregate.meter_changes,
        normalized_tokens=sum(len(sequence.tokens) for sequence in all_sequences),
        sequences=len(all_sequences),
        transitions=sum(max(0, len(sequence.tokens) - 1) for sequence in all_sequences),
        unsupported_reasons=dict(sorted(aggregate.unsupported_reasons.items())),
        special_reasons=dict(sorted(aggregate.special_reasons.items())),
    )
    normalized_hash = normalized_evaluation_hash(all_sequences)
    if normalized_hash != EXPECTED_NORMALIZED_EVALUATION_SHA256:
        raise EvaluationInputError(
            "normalized evaluation SHA-256 does not match the pin"
        )
    return ParsedDataset(
        tuple(all_sequences),
        aggregate_count,
        tree_hash,
        normalized_hash,
    )


@dataclass(frozen=True, slots=True)
class HarmonyModel:
    model_id: str
    model_version: str
    orders: dict[int, dict[str, int]]
    sha256: str
    tokenizer_sha256: str


def _json_load_strict(data: bytes, description: str) -> object:
    def reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
        parsed: dict[str, object] = {}
        for key, value in pairs:
            if key in parsed:
                raise EvaluationInputError(f"{description} contains a duplicate key")
            parsed[key] = value
        return parsed

    try:
        return json.loads(
            data.decode("utf-8"),
            object_pairs_hook=reject_duplicate_keys,
            parse_constant=lambda value: (_ for _ in ()).throw(
                EvaluationInputError(
                    f"{description} contains non-finite JSON value {value}"
                )
            ),
        )
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise EvaluationInputError(f"{description} is not valid UTF-8 JSON") from exc


def _validate_model_payload(payload: object) -> dict[int, dict[str, int]]:
    if not isinstance(payload, dict):
        raise EvaluationInputError("model must be a JSON object")
    expected_top_level = {
        "modelId",
        "modelVersion",
        "orders",
        "schemaVersion",
        "source",
    }
    if set(payload) != expected_top_level:
        raise EvaluationInputError("model top-level schema is invalid")
    if payload.get("schemaVersion") != 1 or payload.get("modelId") != MODEL_ID:
        raise EvaluationInputError("model schemaVersion or modelId is invalid")
    if payload.get("modelVersion") != MODEL_VERSION:
        raise EvaluationInputError("modelVersion is invalid")
    source = payload.get("source")
    if not isinstance(source, dict) or source != MODEL_SOURCE_EXPECTED:
        raise EvaluationInputError("model source provenance is invalid")
    raw_orders = payload.get("orders")
    if not isinstance(raw_orders, dict) or set(raw_orders) != {
        str(order) for order in range(1, 6)
    }:
        raise EvaluationInputError("model orders must contain exactly 1 through 5")
    checked: dict[int, dict[str, int]] = {}
    for order in range(1, 6):
        raw_counts = raw_orders.get(str(order))
        if (
            not isinstance(raw_counts, dict)
            or len(raw_counts) != EXPECTED_MODEL_ORDER_ENTRIES[order]
        ):
            raise EvaluationInputError(f"model order {order} entry count is invalid")
        counts: dict[str, int] = {}
        for gram, count in raw_counts.items():
            if not isinstance(gram, str) or len(gram.split(">")) != order:
                raise EvaluationInputError(f"model order {order} gram shape is invalid")
            for token in gram.split(">"):
                parts = token.split(":")
                if (
                    len(parts) != 2
                    or not parts[0].isdigit()
                    or not 0 <= int(parts[0]) <= 11
                    or parts[1] not in SUPPORTED_QUALITIES
                ):
                    raise EvaluationInputError("model gram token syntax is invalid")
            if isinstance(count, bool) or not isinstance(count, int) or count <= 0:
                raise EvaluationInputError(
                    "model gram count must be a positive integer"
                )
            counts[gram] = count
        if sum(counts.values()) != EXPECTED_MODEL_ORDER_TOTALS[order]:
            raise EvaluationInputError(f"model order {order} total is invalid")
        checked[order] = dict(sorted(counts.items()))
    return checked


def load_model(path: Path = DEFAULT_MODEL) -> HarmonyModel:
    model_path = path.expanduser()
    data = _read_regular_snapshot(model_path, max_bytes=MAX_MODEL_BYTES)
    model_sha256 = hashlib.sha256(data).hexdigest()
    if model_sha256 != EXPECTED_MODEL_SHA256:
        raise EvaluationInputError("model SHA-256 does not match the pin")
    payload = _json_load_strict(data, "model")
    orders = _validate_model_payload(payload)
    return HarmonyModel(
        MODEL_ID,
        MODEL_VERSION,
        orders,
        model_sha256,
        TRAIN_TOKENIZER_SHA256,
    )


class _ModelScorer:
    def __init__(self, model: HarmonyModel, cap: int) -> None:
        if cap not in {1, 2, 3}:
            raise EvaluationInputError("evaluation order cap must be 1, 2, or 3")
        self.model = model
        self.cap = cap
        self.vocabulary = tuple(sorted(model.orders[1]))
        self.vocabulary_size = len(self.vocabulary)
        self.totals = {
            order: sum(model.orders[order].values()) for order in range(1, 4)
        }
        self.contexts: dict[int, dict[str, int]] = {2: Counter(), 3: Counter()}
        for order in (2, 3):
            for gram, count in model.orders[order].items():
                context = ">".join(gram.split(">")[:-1])
                self.contexts[order][context] += count
        self._probability_cache: dict[tuple[str, ...], float] = {}
        self._ranking_cache: dict[tuple[str, ...], tuple[str, ...]] = {}

    def probability(self, tokens: Sequence[str]) -> float:
        normalized = tuple(tokens[-self.cap :])
        if not normalized:
            return 1.0
        cached = self._probability_cache.get(normalized)
        if cached is not None:
            return cached
        if len(normalized) <= 1:
            count = self.model.orders[1].get(normalized[-1], 0)
            probability = (count + 1) / (self.totals[1] + self.vocabulary_size)
        else:
            order = len(normalized)
            gram = ">".join(normalized)
            context = ">".join(normalized[:-1])
            context_count = self.contexts[order].get(context, 0)
            lower = self.probability(normalized[1:])
            if context_count == 0:
                probability = lower
            else:
                maximum_likelihood = (
                    self.model.orders[order].get(gram, 0) / context_count
                )
                interpolation = context_count / (context_count + self.vocabulary_size)
                probability = (
                    interpolation * maximum_likelihood + (1 - interpolation) * lower
                )
        if not math.isfinite(probability) or probability <= 0:
            raise EvaluationInputError("model probability is non-finite")
        self._probability_cache[normalized] = probability
        return probability

    def effective_order(self, history: Sequence[str], target: str) -> int:
        requested = min(self.cap, len(history) + 1)
        for order in range(requested, 1, -1):
            context = ">".join((tuple(history) + (target,))[-order:-1])
            if self.contexts[order].get(context, 0) > 0:
                return order
        return 1

    def requested_exact_support(self, history: Sequence[str], target: str) -> bool:
        requested = min(self.cap, len(history) + 1)
        if requested == 1:
            return self.model.orders[1].get(target, 0) > 0
        gram = ">".join((tuple(history) + (target,))[-requested:])
        return self.model.orders[requested].get(gram, 0) > 0

    def rank_candidates(self, history: Sequence[str]) -> tuple[str, ...]:
        context = tuple(history[-(self.cap - 1) :]) if self.cap > 1 else ()
        cached = self._ranking_cache.get(context)
        if cached is not None:
            return cached
        ranked = tuple(
            sorted(
                self.vocabulary,
                key=lambda token: (-self.probability((*context, token)), token),
            )
        )
        self._ranking_cache[context] = ranked
        return ranked


def _rate(count: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    value = count / denominator
    if not math.isfinite(value):
        raise EvaluationInputError("metric is non-finite")
    return value


def _slice_metrics(
    sequences: Sequence[NormalizedSequence],
    scorer: _ModelScorer,
    section_boundary: bool | None,
) -> dict[str, object]:
    transition_count = in_vocabulary = oov_count = nll_sum = 0
    top_correct = {1: 0, 3: 0, 5: 0}
    support_count = 0
    effective_counts = {"1": 0, "2": 0, "3": 0}
    for sequence in sequences:
        for index, target in enumerate(sequence.tokens[1:], start=1):
            is_boundary = sequence.section_boundaries[index - 1]
            if section_boundary is not None and is_boundary != section_boundary:
                continue
            history = sequence.tokens[:index]
            transition_count += 1
            in_vocab = target in scorer.model.orders[1]
            if in_vocab:
                in_vocabulary += 1
                probability = scorer.probability((*history, target))
                nll_sum += -math.log2(probability)
            else:
                oov_count += 1
            ranking = scorer.rank_candidates(history)
            for k in (1, 3, 5):
                if target in ranking[:k]:
                    top_correct[k] += 1
            if scorer.requested_exact_support(history, target):
                support_count += 1
            effective = scorer.effective_order(history, target)
            effective_counts[str(effective)] += 1
    mean_nll = nll_sum / in_vocabulary if in_vocabulary else None
    perplexity = 2**mean_nll if mean_nll is not None else None
    if mean_nll is not None and (
        not math.isfinite(mean_nll) or not math.isfinite(perplexity)
    ):
        raise EvaluationInputError("metric is non-finite")
    return {
        "transitionCount": transition_count,
        "inVocabularyCount": in_vocabulary,
        "oovCount": oov_count,
        "oovRate": _rate(oov_count, transition_count),
        "nllDenominator": in_vocabulary,
        "perplexityDenominator": in_vocabulary,
        "meanNllBits": mean_nll,
        "perplexityBase2": perplexity,
        "top1": {
            "correct": top_correct[1],
            "denominator": transition_count,
            "rate": _rate(top_correct[1], transition_count),
        },
        "top3": {
            "correct": top_correct[3],
            "denominator": transition_count,
            "rate": _rate(top_correct[3], transition_count),
        },
        "top5": {
            "correct": top_correct[5],
            "denominator": transition_count,
            "rate": _rate(top_correct[5], transition_count),
        },
        "requestedExactSupport": {
            "count": support_count,
            "denominator": transition_count,
            "rate": _rate(support_count, transition_count),
        },
        "effectiveOrderCounts": effective_counts,
    }


def _assert_slice_partition(
    all_metrics: dict[str, object],
    within_metrics: dict[str, object],
    boundary_metrics: dict[str, object],
) -> None:
    """Ensure the two section slices reproduce every additive all metric."""
    additive_fields = ("transitionCount", "inVocabularyCount", "oovCount")
    for field_name in additive_fields:
        if all_metrics[field_name] != (
            within_metrics[field_name] + boundary_metrics[field_name]
        ):
            raise EvaluationInputError(f"section partition mismatch for {field_name}")
    for metric_name in ("top1", "top3", "top5"):
        for field_name in ("correct", "denominator"):
            if all_metrics[metric_name][field_name] != (
                within_metrics[metric_name][field_name]
                + boundary_metrics[metric_name][field_name]
            ):
                raise EvaluationInputError(
                    f"section partition mismatch for {metric_name}.{field_name}"
                )
    for field_name in ("count", "denominator"):
        if all_metrics["requestedExactSupport"][field_name] != (
            within_metrics["requestedExactSupport"][field_name]
            + boundary_metrics["requestedExactSupport"][field_name]
        ):
            raise EvaluationInputError(
                f"section partition mismatch for requestedExactSupport.{field_name}"
            )
    if all_metrics["effectiveOrderCounts"] != {
        key: within_metrics["effectiveOrderCounts"][key]
        + boundary_metrics["effectiveOrderCounts"][key]
        for key in ("1", "2", "3")
    }:
        raise EvaluationInputError("section partition mismatch for effective order")

    nll_denominator = all_metrics["nllDenominator"]
    if nll_denominator != (
        within_metrics["nllDenominator"] + boundary_metrics["nllDenominator"]
    ) or all_metrics["perplexityDenominator"] != (
        within_metrics["perplexityDenominator"]
        + boundary_metrics["perplexityDenominator"]
    ):
        raise EvaluationInputError("section partition mismatch for NLL denominator")
    if nll_denominator:
        weighted_sum = 0.0
        for metrics in (within_metrics, boundary_metrics):
            denominator = metrics["nllDenominator"]
            if denominator:
                if metrics["meanNllBits"] is None:
                    raise EvaluationInputError(
                        "nonzero NLL denominator must have a mean"
                    )
                weighted_sum += metrics["meanNllBits"] * denominator
        weighted_nll = weighted_sum / nll_denominator
        if not math.isclose(
            all_metrics["meanNllBits"], weighted_nll, rel_tol=1e-12, abs_tol=1e-12
        ):
            raise EvaluationInputError("section partition mismatch for mean NLL")
        expected_perplexity = 2**weighted_nll
        if not math.isclose(
            all_metrics["perplexityBase2"],
            expected_perplexity,
            rel_tol=1e-12,
            abs_tol=1e-12,
        ):
            raise EvaluationInputError("section partition mismatch for perplexity")
    elif (
        all_metrics["meanNllBits"] is not None
        or all_metrics["perplexityBase2"] is not None
    ):
        raise EvaluationInputError("zero NLL denominator must have null metrics")


def evaluate_order(
    sequences: Sequence[NormalizedSequence],
    model: HarmonyModel,
    cap: int,
) -> dict[str, dict[str, object]]:
    scorer = _ModelScorer(model, cap)
    result = {
        "all": _slice_metrics(sequences, scorer, None),
        "withinSection": _slice_metrics(sequences, scorer, False),
        "sectionBoundary": _slice_metrics(sequences, scorer, True),
    }
    _assert_slice_partition(
        result["all"], result["withinSection"], result["sectionBoundary"]
    )
    return result


def _delta_metric(
    current: object, baseline: object, *, improvement: bool = False
) -> float | None:
    if current is None or baseline is None:
        return None
    value = (baseline - current) if improvement else (current - baseline)
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        raise EvaluationInputError("delta metric is non-finite")
    return value


def build_order3_deltas(
    results: dict[str, dict[str, dict[str, object]]],
) -> dict[str, dict[str, dict[str, float | None]]]:
    deltas: dict[str, dict[str, dict[str, float | None]]] = {}
    for baseline_name, baseline_key in (("vsOrder1", "1"), ("vsOrder2", "2")):
        deltas[baseline_name] = {}
        for slice_name in ("all", "withinSection", "sectionBoundary"):
            current = results["3"][slice_name]
            baseline = results[baseline_key][slice_name]
            deltas[baseline_name][slice_name] = {
                "nllBitsImprovement": _delta_metric(
                    current["meanNllBits"], baseline["meanNllBits"], improvement=True
                ),
                "top1RateChange": _delta_metric(
                    current["top1"]["rate"], baseline["top1"]["rate"]
                ),
                "top3RateChange": _delta_metric(
                    current["top3"]["rate"], baseline["top3"]["rate"]
                ),
                "top5RateChange": _delta_metric(
                    current["top5"]["rate"], baseline["top5"]["rate"]
                ),
                "exactSupportRateChange": _delta_metric(
                    current["requestedExactSupport"]["rate"],
                    baseline["requestedExactSupport"]["rate"],
                ),
            }
    return deltas


def _coverage_payload(coverage: Coverage) -> dict[str, object]:
    return {
        "annotationSlots": coverage.annotation_slots,
        "publishedDistinctSongs": coverage.published_distinct_songs,
        "phrases": coverage.phrases,
        "expandedBars": coverage.bars,
        "chordLexemes": coverage.chord_lexemes,
        "normalizedRawLexemes": coverage.normalized_raw_lexemes,
        "unsupportedTokens": coverage.unsupported_tokens,
        "normalizedTokens": coverage.normalized_tokens,
        "sequences": coverage.sequences,
        "transitions": coverage.transitions,
        "specialMarkers": coverage.special_markers,
        "specialReasons": coverage.special_reasons,
        "dotRepetitions": coverage.dot_repetitions,
        "repeatDirectives": coverage.phrase_repetitions,
        "elisionMarkers": coverage.elision_markers,
        "keyChanges": coverage.key_changes,
        "meterChanges": coverage.meter_changes,
        "unsupportedReasons": coverage.unsupported_reasons,
    }


def _validate_generated_at(value: str) -> str:
    if not isinstance(value, str) or not UTC_TIMESTAMP_PATTERN.fullmatch(value):
        raise EvaluationInputError(
            "generatedAt must be an ISO-8601 UTC timestamp ending Z"
        )
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise EvaluationInputError("generatedAt is not a valid timestamp") from exc
    if parsed.tzinfo != timezone.utc:
        raise EvaluationInputError("generatedAt must use UTC")
    return value


def _assert_finite_json(value: object) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise EvaluationInputError("report contains a non-finite number")
    if isinstance(value, dict):
        for child in value.values():
            _assert_finite_json(child)
    elif isinstance(value, (list, tuple)):
        for child in value:
            _assert_finite_json(child)


def build_report(
    dataset: Path = DEFAULT_DATASET,
    model_path: Path = DEFAULT_MODEL,
    *,
    generated_at: str | None = None,
) -> dict[str, object]:
    parsed = parse_dataset(dataset)
    model = load_model(model_path)
    results = {
        str(cap): evaluate_order(parsed.sequences, model, cap) for cap in (1, 2, 3)
    }
    timestamp = generated_at or datetime.now(timezone.utc).isoformat().replace(
        "+00:00", "Z"
    )
    timestamp = _validate_generated_at(timestamp)
    report: dict[str, object] = {
        "schemaVersion": 1,
        "reportKind": "externalHarmonyLanguageModelEvaluation",
        "evaluationScope": "languageModelOnlyNotUiTemplateAdvisor",
        "evaluatorVersion": "mcgill-billboard-external-evaluator-1",
        "generatedAt": timestamp,
        "dataset": {
            "id": "McGill-Billboard",
            "version": "v2",
            "role": "evaluationOnly",
            "license": "CC0-1.0",
            "sourceArchiveUrl": ARCHIVE_URL,
            "sourcePageUrl": SOURCE_PAGE_URL,
            "archiveSha256": EXPECTED_ARCHIVE_SHA256,
            "portableSourceTreeSha256": parsed.portable_source_sha256,
            "normalizedEvaluationSha256": parsed.normalized_evaluation_sha256,
            "annotationSlots": parsed.coverage.annotation_slots,
            "publishedDistinctSongs": parsed.coverage.published_distinct_songs,
            "audioDistributed": False,
            "rawAnnotationsTrackedInRepository": False,
            "rawSequencesPublished": False,
            "noQualityClaim": True,
        },
        "model": {
            "modelId": model.model_id,
            "modelVersion": model.model_version,
            "modelSha256": model.sha256,
            "runtimeOrders": [1, 2, 3],
        },
        "normalization": {
            "parserVersion": PARSER_VERSION,
            "tokenizerScriptSha256": TRAIN_TOKENIZER_SHA256,
        },
        "coverage": _coverage_payload(parsed.coverage),
        "protocol": {
            "candidateVocabulary": "sorted observed unigram vocabulary shared by all caps",
            "probability": "TS LocalCorpus recursive interpolation with unigram additive smoothing",
            "transitionDenominator": "adjacent tokens within context-contiguous normalized sequences; sequence first tokens excluded",
            "oov": "target outside observed unigram vocabulary; top-k miss and NLL/perplexity denominator excluded",
            "nllDenominator": "inVocabularyCount",
            "perplexityDenominator": "inVocabularyCount",
            "sectionSlices": "all is partitioned exactly into withinSection and sectionBoundary transitions",
            "sectionBoundaryDefinition": {
                "formalHighLevelSegmentStart": "first valid token after capital letter plus zero or more primes at phrase prefix",
                "zBehavior": "resetWithoutBoundary",
                "plainTextLabelsExcluded": True,
            },
            "qualityClaim": "distributional language-model fit only; no musical-quality claim",
        },
        "results": results,
        "order3Deltas": build_order3_deltas(results),
        "conclusion": {
            "qualityImprovementClaimed": False,
            "interpretation": "external distribution fit only",
        },
    }
    _assert_finite_json(report)
    return report


def atomic_write_json(output: Path, payload: dict[str, object]) -> None:
    output = output.expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output.name}.", suffix=".tmp", dir=output.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(
                payload,
                handle,
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
                allow_nan=False,
            )
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Parse McGill Billboard v2 annotations for external evaluation."
    )
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--output", type=Path, required=True)
    return parser


if __name__ == "__main__":
    arguments = build_argument_parser().parse_args()
    try:
        report = build_report(arguments.dataset, arguments.model)
        atomic_write_json(arguments.output, report)
        coverage = report["coverage"]
        print(
            f"Saved external McGill evaluation: {coverage['annotationSlots']} files, "
            f"{coverage['transitions']} transitions to {arguments.output}"
        )
    except (EvaluationInputError, OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
