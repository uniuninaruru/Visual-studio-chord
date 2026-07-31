#!/usr/bin/env python3
"""Fail when Git tracks private training inputs or model artifacts.

The check intentionally operates on ``git ls-files`` rather than the working
tree. Local datasets and checkpoints are expected to exist, but they must not
be committed. The implementation uses only the Python standard library so the
same command works on Windows, macOS, and Linux.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable, Sequence


FORBIDDEN_BINARY_SUFFIXES = frozenset(
    {
        ".aac",
        ".aif",
        ".aiff",
        ".bin",
        ".ckpt",
        ".engine",
        ".flac",
        ".ggml",
        ".gguf",
        ".h5",
        ".hdf5",
        ".joblib",
        ".m4a",
        ".mid",
        ".midi",
        ".mp3",
        ".musicxml",
        ".mxl",
        ".npy",
        ".npz",
        ".ogg",
        ".onnx",
        ".opus",
        ".ort",
        ".pb",
        ".pickle",
        ".plan",
        ".pkl",
        ".pt",
        ".pth",
        ".safetensors",
        ".tflite",
        ".wav",
    }
)

PRIVATE_PREFIXES = (
    ("datasets", "processed"),
    ("datasets", "raw"),
    ("local-models",),
    ("training", "runs"),
)


class ArtifactCheckError(RuntimeError):
    """The tracked-file list could not be inspected safely."""


@dataclass(frozen=True, slots=True)
class Violation:
    path: str
    reason: str


def normalize_git_path(value: str) -> str:
    """Return a stable, repository-relative Git path for classification."""

    normalized = value.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def classify_forbidden_path(value: str) -> str | None:
    """Return a policy reason when one tracked path must stay local."""

    normalized = normalize_git_path(value)
    path = PurePosixPath(normalized)
    folded_parts = tuple(part.casefold() for part in path.parts)
    suffix = path.suffix.casefold()

    if suffix in FORBIDDEN_BINARY_SUFFIXES:
        return f"private music/model binary ({suffix})"
    for prefix in PRIVATE_PREFIXES:
        if folded_parts[: len(prefix)] == prefix:
            return f"private training path ({'/'.join(prefix)}/)"
    if len(folded_parts) >= 3 and folded_parts[0] == "models":
        return "private model artifact directory (models/<model-id>/)"
    return None


def find_violations(paths: Iterable[str]) -> list[Violation]:
    """Classify tracked paths deterministically without reading their content."""

    violations: list[Violation] = []
    for value in paths:
        reason = classify_forbidden_path(value)
        if reason is not None:
            violations.append(
                Violation(path=normalize_git_path(value), reason=reason)
            )
    return sorted(violations, key=lambda item: (item.path.casefold(), item.path))


def tracked_paths(repository: Path) -> list[str]:
    """Read the exact tracked-file set from one Git worktree."""

    try:
        completed = subprocess.run(
            ["git", "-C", str(repository), "ls-files", "-z"],
            check=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise ArtifactCheckError(
            f"could not inspect tracked files in {repository}"
        ) from exc
    try:
        return [
            value.decode("utf-8")
            for value in completed.stdout.split(b"\0")
            if value
        ]
    except UnicodeDecodeError as exc:
        raise ArtifactCheckError(
            "tracked Git paths must be valid UTF-8"
        ) from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Reject Git-tracked private datasets, music source files, and "
            "model/checkpoint artifacts."
        )
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Git worktree to inspect (defaults to this project).",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        violations = find_violations(tracked_paths(arguments.repo_root.resolve()))
    except ArtifactCheckError as exc:
        print(f"Artifact policy check failed: {exc}", file=sys.stderr)
        return 2

    if violations:
        print(
            "Forbidden private training artifacts are tracked by Git:",
            file=sys.stderr,
        )
        for violation in violations:
            print(
                f"  - {violation.path}: {violation.reason}",
                file=sys.stderr,
            )
        print(
            "Keep raw/processed data and weights local; commit only policy, "
            "schemas, tests, and non-reconstructive aggregate metadata.",
            file=sys.stderr,
        )
        return 1

    print("Private training artifact policy: tracked files are clean.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
