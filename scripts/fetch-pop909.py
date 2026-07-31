#!/usr/bin/env python3
"""Fetch only the POP909 annotations needed for private local training.

The script talks directly to the canonical public GitHub repository without
credentials.  A blob-filtered clone and non-cone sparse checkout materialize
only LICENSE plus beat_audio.txt, chord_audio.txt, and key_audio.txt for each
song.  MIDI, audio, archives, model weights, and normalized derivatives are
never requested for the working tree.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass, replace
from pathlib import Path

CANONICAL_REPOSITORY = "https://github.com/music-x-lab/POP909-Dataset"
DEFAULT_COMMIT = "d83e6edba6872a704f5d3b8b32f5cb540088dae6"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROJECT_RAW_ROOT = PROJECT_ROOT / "datasets" / "raw"
DEFAULT_TARGET = PROJECT_RAW_ROOT / "POP909-Dataset"

EXPECTED_SONG_DIRECTORIES = 909
ANNOTATION_FILENAMES = (
    "beat_audio.txt",
    "chord_audio.txt",
    "key_audio.txt",
)
SPARSE_PATTERNS = (
    "/LICENSE",
    "/POP909/*/beat_audio.txt",
    "/POP909/*/chord_audio.txt",
    "/POP909/*/key_audio.txt",
)
FORBIDDEN_SUFFIXES = frozenset(
    {
        ".aac",
        ".aif",
        ".aiff",
        ".flac",
        ".m4a",
        ".mid",
        ".midi",
        ".mp3",
        ".ogg",
        ".opus",
        ".wav",
        ".wave",
        ".zip",
    }
)
COMMIT_PATTERN = re.compile(r"^[0-9a-fA-F]{40}$")

_GIT_ENVIRONMENT_KEYS_TO_REMOVE = frozenset(
    {
        "GH_TOKEN",
        "GITHUB_TOKEN",
        "GITLAB_TOKEN",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_ASKPASS",
        "GIT_COMMON_DIR",
        "GIT_CONFIG_COUNT",
        "GIT_CONFIG_PARAMETERS",
        "GIT_DIR",
        "GIT_INDEX_FILE",
        "GIT_NAMESPACE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_PASSWORD",
        "GIT_PROXY_COMMAND",
        "GIT_SSH",
        "GIT_SSH_COMMAND",
        "GIT_USERNAME",
        "SSH_ASKPASS",
    }
)


class AcquisitionError(RuntimeError):
    """The requested checkout cannot be acquired or safely validated."""


@dataclass(frozen=True, slots=True)
class CheckoutStats:
    target: Path
    commit: str
    song_directories: int
    annotation_files: int
    forbidden_files: int


def normalize_commit(value: str) -> str:
    """Return one full, lowercase Git object ID or reject an ambiguous revision."""
    if not COMMIT_PATTERN.fullmatch(value):
        raise AcquisitionError("commit must be a full 40-character hexadecimal Git object ID")
    return value.lower()


def resolve_target(
    requested_target: Path,
    *,
    project_raw_root: Path = PROJECT_RAW_ROOT,
    allow_outside_project_raw: bool = False,
) -> Path:
    """Resolve and validate a destination without modifying it."""
    expanded_target = requested_target.expanduser()
    if expanded_target.is_symlink():
        raise AcquisitionError("target must not be a symbolic link")
    try:
        target = expanded_target.resolve(strict=False)
        raw_root = project_raw_root.expanduser().resolve(strict=False)
    except (OSError, RuntimeError) as exc:
        raise AcquisitionError(f"target cannot be resolved safely: {exc}") from exc

    if target == raw_root:
        raise AcquisitionError("target must be a child of the project datasets/raw directory")

    try:
        target.relative_to(raw_root)
        inside_project_raw = True
    except ValueError:
        inside_project_raw = False

    if not inside_project_raw and not allow_outside_project_raw:
        raise AcquisitionError(
            "target resolves outside the project datasets/raw directory; "
            "pass --allow-outside-project-raw with an explicit --target to override"
        )

    filesystem_root = Path(target.anchor).resolve(strict=False)
    unsafe_exact_targets = {
        filesystem_root,
        Path.home().resolve(strict=False),
        PROJECT_ROOT.resolve(strict=False),
        raw_root,
    }
    if target in unsafe_exact_targets:
        raise AcquisitionError("refusing a broad or sensitive target directory")
    if ".git" in {part.casefold() for part in target.parts}:
        raise AcquisitionError("target must not be inside Git metadata")

    if target.is_symlink():
        raise AcquisitionError("target must not be a symbolic link")
    if target.exists():
        if not target.is_dir():
            raise AcquisitionError("target already exists and is not a directory")
        try:
            nonempty = next(target.iterdir(), None) is not None
        except OSError as exc:
            raise AcquisitionError(f"target cannot be inspected safely: {exc}") from exc
        if nonempty:
            raise AcquisitionError("target already exists and is not empty")
    return target


def git_environment() -> dict[str, str]:
    """Build a non-interactive Git environment that cannot source credentials."""
    environment = dict(os.environ)
    for key in tuple(environment):
        if (
            key in _GIT_ENVIRONMENT_KEYS_TO_REMOVE
            or key.startswith("GIT_CONFIG_KEY_")
            or key.startswith("GIT_CONFIG_VALUE_")
        ):
            environment.pop(key, None)
    environment.update(
        {
            "GCM_INTERACTIVE": "Never",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_LFS_SKIP_SMUDGE": "1",
            "GIT_TERMINAL_PROMPT": "0",
        }
    )
    return environment


def run_git(arguments: Sequence[str]) -> subprocess.CompletedProcess[str]:
    """Run Git with an argv array and captured output; never invoke a shell."""
    command = ["git", *arguments]
    try:
        return subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            env=git_environment(),
            shell=False,
        )
    except FileNotFoundError as exc:
        raise AcquisitionError("Git is required but was not found on PATH") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip()
        if detail:
            detail = detail.splitlines()[-1]
            raise AcquisitionError(f"Git failed while acquiring POP909: {detail}") from exc
        raise AcquisitionError("Git failed while acquiring POP909") from exc


def verify_git_checkout(target: Path, expected_commit: str) -> str:
    """Verify canonical origin, partial-clone settings, and exact HEAD."""
    origin = run_git(["-C", str(target), "remote", "get-url", "origin"]).stdout.strip()
    if origin != CANONICAL_REPOSITORY:
        raise AcquisitionError(
            f"origin mismatch: expected {CANONICAL_REPOSITORY!r}, found {origin!r}"
        )

    partial_filter = run_git(
        ["-C", str(target), "config", "--get", "remote.origin.partialclonefilter"]
    ).stdout.strip()
    if partial_filter != "blob:none":
        raise AcquisitionError(
            f"partial-clone filter mismatch: expected 'blob:none', found {partial_filter!r}"
        )

    promisor = run_git(
        ["-C", str(target), "config", "--get", "remote.origin.promisor"]
    ).stdout.strip()
    if promisor.casefold() != "true":
        raise AcquisitionError("origin is not recorded as a partial-clone promisor remote")

    head = run_git(
        ["-C", str(target), "rev-parse", "--verify", "HEAD^{commit}"]
    ).stdout.strip()
    if head.casefold() != expected_commit:
        raise AcquisitionError(
            f"HEAD mismatch: expected {expected_commit}, found {head or '<empty>'}"
        )
    return head.lower()


def _raise_walk_error(error: OSError) -> None:
    raise error


def _worktree_entries(target: Path) -> tuple[set[Path], set[Path]]:
    directories: set[Path] = set()
    files: set[Path] = set()
    for current_root, directory_names, filenames in os.walk(
        target,
        followlinks=False,
        onerror=_raise_walk_error,
    ):
        current = Path(current_root)
        if current == target and ".git" in directory_names:
            directory_names.remove(".git")
        for name in directory_names:
            path = current / name
            if path.is_symlink():
                raise AcquisitionError(f"symbolic link is not allowed: {path.relative_to(target)}")
            directories.add(path.relative_to(target))
        for name in filenames:
            path = current / name
            if path.is_symlink() or not path.is_file():
                raise AcquisitionError(
                    f"non-regular file is not allowed: {path.relative_to(target)}"
                )
            files.add(path.relative_to(target))
    return directories, files


def validate_checkout(
    target: Path,
    *,
    commit: str,
    expected_song_directories: int = EXPECTED_SONG_DIRECTORIES,
) -> CheckoutStats:
    """Validate the exact sparse working-tree shape and annotation counts."""
    git_metadata = target / ".git"
    if git_metadata.is_symlink() or not git_metadata.is_dir():
        raise AcquisitionError("checkout has no regular .git directory")

    try:
        directories, files = _worktree_entries(target)
    except OSError as exc:
        raise AcquisitionError(f"checkout cannot be inspected safely: {exc}") from exc

    forbidden = sorted(
        path
        for path in files
        if path.suffix.casefold() in FORBIDDEN_SUFFIXES
    )
    if forbidden:
        examples = ", ".join(path.as_posix() for path in forbidden[:5])
        raise AcquisitionError(
            f"checkout contains {len(forbidden)} forbidden MIDI/audio/zip file(s): {examples}"
        )

    pop909 = target / "POP909"
    if pop909.is_symlink() or not pop909.is_dir():
        raise AcquisitionError("checkout is missing the regular POP909 directory")
    try:
        song_directories = sorted(
            child
            for child in pop909.iterdir()
            if child.is_dir() and not child.is_symlink()
        )
    except OSError as exc:
        raise AcquisitionError(f"POP909 directory cannot be inspected safely: {exc}") from exc

    if len(song_directories) != expected_song_directories:
        raise AcquisitionError(
            "song-directory count mismatch: "
            f"expected {expected_song_directories}, found {len(song_directories)}"
        )

    expected_directories = {Path("POP909")}
    expected_files = {Path("LICENSE")}
    for song_directory in song_directories:
        relative_song = song_directory.relative_to(target)
        expected_directories.add(relative_song)
        expected_files.update(
            relative_song / filename for filename in ANNOTATION_FILENAMES
        )

    missing_directories = sorted(expected_directories - directories)
    unexpected_directories = sorted(directories - expected_directories)
    missing_files = sorted(expected_files - files)
    unexpected_files = sorted(files - expected_files)
    if (
        missing_directories
        or unexpected_directories
        or missing_files
        or unexpected_files
    ):
        details: list[str] = []
        for label, paths in (
            ("missing directories", missing_directories),
            ("unexpected directories", unexpected_directories),
            ("missing files", missing_files),
            ("unexpected files", unexpected_files),
        ):
            if paths:
                examples = ", ".join(path.as_posix() for path in paths[:5])
                details.append(f"{label}: {examples}")
        raise AcquisitionError("sparse checkout shape mismatch; " + "; ".join(details))

    annotation_files = len(expected_files) - 1
    expected_annotation_files = expected_song_directories * len(ANNOTATION_FILENAMES)
    if annotation_files != expected_annotation_files:
        raise AcquisitionError(
            "annotation-file count mismatch: "
            f"expected {expected_annotation_files}, found {annotation_files}"
        )

    return CheckoutStats(
        target=target,
        commit=commit,
        song_directories=len(song_directories),
        annotation_files=annotation_files,
        forbidden_files=0,
    )


def _install_validated_checkout(staging: Path, target: Path) -> None:
    """Move a validated staging checkout into place without overwriting data."""
    if target.is_symlink():
        raise AcquisitionError("target became a symbolic link during acquisition")
    if target.exists():
        if not target.is_dir():
            raise AcquisitionError("target became a non-directory during acquisition")
        try:
            if next(target.iterdir(), None) is not None:
                raise AcquisitionError("target became nonempty during acquisition")
            target.rmdir()
        except OSError as exc:
            raise AcquisitionError(f"empty target cannot be replaced safely: {exc}") from exc
    try:
        staging.replace(target)
    except OSError as exc:
        raise AcquisitionError(f"validated checkout cannot be installed: {exc}") from exc


def acquire_pop909(
    requested_target: Path,
    *,
    commit: str = DEFAULT_COMMIT,
    project_raw_root: Path = PROJECT_RAW_ROOT,
    allow_outside_project_raw: bool = False,
) -> CheckoutStats:
    """Acquire, validate, and install one immutable sparse POP909 checkout."""
    normalized_commit = normalize_commit(commit)
    target = resolve_target(
        requested_target,
        project_raw_root=project_raw_root,
        allow_outside_project_raw=allow_outside_project_raw,
    )
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(
            tempfile.mkdtemp(prefix=f".{target.name}.fetch-", dir=target.parent)
        ).resolve(strict=True)
    except OSError as exc:
        raise AcquisitionError(f"staging directory cannot be created safely: {exc}") from exc

    installed = False
    try:
        run_git(
            [
                "-c",
                "credential.helper=",
                "clone",
                "--filter=blob:none",
                "--no-checkout",
                "--no-tags",
                "--single-branch",
                "--depth=1",
                CANONICAL_REPOSITORY,
                str(staging),
            ]
        )
        run_git(
            [
                "-C",
                str(staging),
                "-c",
                "credential.helper=",
                "fetch",
                "--filter=blob:none",
                "--no-tags",
                "--depth=1",
                "origin",
                normalized_commit,
            ]
        )
        # Configure sparsity without ``sparse-checkout init``.  The legacy
        # init command starts with every root file selected, which could
        # briefly materialize the upstream POP909.zip before ``set`` narrows
        # the patterns.
        run_git(["-C", str(staging), "config", "core.sparseCheckout", "true"])
        run_git(["-C", str(staging), "config", "core.sparseCheckoutCone", "false"])
        run_git(
            [
                "-C",
                str(staging),
                "sparse-checkout",
                "set",
                "--no-cone",
                "--",
                *SPARSE_PATTERNS,
            ]
        )
        run_git(
            [
                "-C",
                str(staging),
                "checkout",
                "--detach",
                normalized_commit,
            ]
        )

        verified_commit = verify_git_checkout(staging, normalized_commit)
        stats = validate_checkout(staging, commit=verified_commit)
        _install_validated_checkout(staging, target)
        installed = True
        return replace(stats, target=target)
    finally:
        if not installed and staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch only POP909 LICENSE and harmony annotations from canonical GitHub. "
            "No credentials, MIDI, audio, ZIP, or model weights are fetched."
        )
    )
    parser.add_argument(
        "--target",
        type=Path,
        default=DEFAULT_TARGET,
        help=(
            "checkout destination "
            "(default: <project>/datasets/raw/POP909-Dataset)"
        ),
    )
    parser.add_argument(
        "--commit",
        default=DEFAULT_COMMIT,
        help=f"full upstream commit to fetch (default: {DEFAULT_COMMIT})",
    )
    parser.add_argument(
        "--allow-outside-project-raw",
        "--allow-outside-datasets-raw",
        action="store_true",
        help=(
            "allow an explicit --target outside this project's datasets/raw; "
            "broad, sensitive, nonempty, and symbolic-link targets remain forbidden"
        ),
    )
    return parser


def print_summary(stats: CheckoutStats) -> None:
    print(f"path: {stats.target}")
    print(f"commit: {stats.commit}")
    print(f"song_directories: {stats.song_directories}")
    print(f"annotation_files: {stats.annotation_files}")
    print(f"forbidden_midi_audio_zip_files: {stats.forbidden_files}")


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_argument_parser()
    arguments = parser.parse_args(argv)
    try:
        stats = acquire_pop909(
            arguments.target,
            commit=arguments.commit,
            allow_outside_project_raw=arguments.allow_outside_project_raw,
        )
    except AcquisitionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print_summary(stats)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
