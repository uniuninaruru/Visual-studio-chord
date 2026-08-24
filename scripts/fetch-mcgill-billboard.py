#!/usr/bin/env python3
"""Fetch the annotation-only McGill Billboard v2 archive.

The upstream download is a small tar.gz containing only Salami chord
annotation text files.  Acquisition is deliberately fail-closed: the
archive digest and exact member shape are pinned before anything is
installed, and all extraction happens in a sibling staging directory.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import shutil
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Sequence

ARCHIVE_URL = (
    "https://www.dropbox.com/s/2lvny9ves8kns4o/billboard-2.0-salami_chords.tar.gz?dl=1"
)
SOURCE_PAGE_URL = (
    "https://ddmal.ca/research/The_McGill_Billboard_Project_(Chord_Analysis_Dataset)/"
)
EXPECTED_ARCHIVE_SHA256 = (
    "a22e32bf24c8a18859ce18427c6501a7a72520185cddd6d882ceb3c61d02ec75"
)
EXPECTED_MEMBER_PREFIX = "McGill-Billboard/"
EXPECTED_MEMBER_COUNT = 890
EXPECTED_ANNOTATION_NAME = "salami_chords.txt"
MEMBER_PATTERN = re.compile(r"^McGill-Billboard/[0-9]{4}/salami_chords\.txt$")

# These limits are intentionally much larger than the pinned archive while
# still bounding decompression and entry-count attacks before extraction.
MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024
MAX_EXTRACTED_BYTES = 64 * 1024 * 1024
MAX_MEMBER_BYTES = 2 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 2_000
DOWNLOAD_TIMEOUT_SECONDS = 60

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROJECT_RAW_ROOT = PROJECT_ROOT / "datasets" / "raw"
DEFAULT_TARGET = PROJECT_RAW_ROOT / "McGill-Billboard-v2"
RECEIPT_NAME = ".mcgill-billboard-receipt.json"


class AcquisitionError(RuntimeError):
    """The archive cannot be fetched or safely installed."""


@dataclass(frozen=True, slots=True)
class ArchiveStats:
    archive_sha256: str
    member_count: int
    extracted_bytes: int
    target: Path | None = None


@dataclass(frozen=True, slots=True)
class ArchiveSnapshot:
    """Immutable archive bytes captured by one read of the source."""

    data: bytes
    sha256: str


def _resolved(path: Path) -> Path:
    try:
        return path.expanduser().resolve(strict=False)
    except (OSError, RuntimeError) as exc:
        raise AcquisitionError(f"path cannot be resolved safely: {exc}") from exc


def resolve_target(
    requested_target: Path,
    *,
    project_raw_root: Path = PROJECT_RAW_ROOT,
    allow_outside_project_raw: bool = False,
) -> Path:
    """Resolve a target and reject broad, sensitive, or ambiguous paths."""
    expanded = requested_target.expanduser()
    if expanded.is_symlink():
        raise AcquisitionError("target must not be a symbolic link")
    target = _resolved(expanded)
    raw_root = _resolved(project_raw_root)
    if target == raw_root:
        raise AcquisitionError("target must be a child of datasets/raw")
    try:
        target.relative_to(raw_root)
        inside_raw = True
    except ValueError:
        inside_raw = False
    if not inside_raw and not allow_outside_project_raw:
        raise AcquisitionError(
            "target resolves outside datasets/raw; pass "
            "--allow-outside-project-raw with an explicit target to override"
        )

    filesystem_root = Path(target.anchor).resolve(strict=False)
    broad_targets = {
        filesystem_root,
        Path.home().resolve(strict=False),
        PROJECT_ROOT.resolve(strict=False),
        raw_root,
    }
    if target in broad_targets:
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


def _read_file_snapshot(path: Path, *, max_bytes: int) -> ArchiveSnapshot:
    if path.is_symlink():
        raise AcquisitionError("archive source must not be a symbolic link")
    digest = hashlib.sha256()
    contents = bytearray()
    total = 0
    try:
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if max_bytes is not None and total > max_bytes:
                    raise AcquisitionError("download exceeds the configured size limit")
                digest.update(chunk)
                contents.extend(chunk)
    except OSError as exc:
        raise AcquisitionError(f"archive cannot be read: {exc}") from exc
    return ArchiveSnapshot(bytes(contents), digest.hexdigest())


def _response_content_length(response: object) -> int | None:
    headers = getattr(response, "headers", None)
    if headers is None:
        return None
    value = headers.get("Content-Length")
    if value is None:
        return None
    try:
        length = int(value)
    except (TypeError, ValueError) as exc:
        raise AcquisitionError("server returned an invalid Content-Length") from exc
    if length < 0:
        raise AcquisitionError("server returned a negative Content-Length")
    return length


def download_archive(
    destination: Path,
    *,
    url: str = ARCHIVE_URL,
    expected_sha256: str = EXPECTED_ARCHIVE_SHA256,
) -> ArchiveSnapshot:
    """Download one archive without credentials, shells, or unbounded reads."""
    destination = destination.resolve(strict=False)
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    contents = bytearray()
    total = 0
    try:
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "HarmonyForge-McGill-fetch/1"},
            method="GET",
        )
        with urllib.request.urlopen(
            request, timeout=DOWNLOAD_TIMEOUT_SECONDS
        ) as response:
            content_length = _response_content_length(response)
            if content_length is not None and content_length > MAX_DOWNLOAD_BYTES:
                raise AcquisitionError("download exceeds the configured size limit")
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_DOWNLOAD_BYTES:
                    raise AcquisitionError("download exceeds the configured size limit")
                digest.update(chunk)
                contents.extend(chunk)
    except AcquisitionError:
        raise
    except (OSError, urllib.error.URLError, urllib.error.HTTPError) as exc:
        raise AcquisitionError(f"archive download failed: {exc}") from exc

    actual = digest.hexdigest()
    if actual != expected_sha256.casefold():
        raise AcquisitionError(
            f"archive SHA-256 mismatch: expected {expected_sha256}, found {actual}"
        )
    opened = False
    try:
        with destination.open("xb") as output:
            opened = True
            output.write(contents)
    except OSError as exc:
        if opened:
            destination.unlink(missing_ok=True)
        raise AcquisitionError(f"downloaded archive cannot be staged: {exc}") from exc
    return ArchiveSnapshot(bytes(contents), actual)


def _member_path(name: str) -> PurePosixPath:
    if not name or "\\" in name or "\x00" in name:
        raise AcquisitionError("archive contains an invalid member path")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise AcquisitionError(f"archive contains an unsafe member path: {name!r}")
    if not MEMBER_PATTERN.fullmatch(name):
        raise AcquisitionError(f"archive contains an unexpected member: {name!r}")
    return path


def _inspect_members(snapshot: ArchiveSnapshot) -> tuple[list[tarfile.TarInfo], int]:
    try:
        with tarfile.open(fileobj=io.BytesIO(snapshot.data), mode="r:*") as archive:
            members: list[tarfile.TarInfo] = []
            for member in archive:
                members.append(member)
                if len(members) > MAX_ARCHIVE_ENTRIES:
                    raise AcquisitionError("archive contains too many entries")
    except (OSError, tarfile.TarError) as exc:
        raise AcquisitionError(f"archive is not a readable tar file: {exc}") from exc
    except AcquisitionError:
        raise
    if len(members) != EXPECTED_MEMBER_COUNT:
        raise AcquisitionError(
            "archive member count mismatch: "
            f"expected {EXPECTED_MEMBER_COUNT}, found {len(members)}"
        )
    names: set[str] = set()
    extracted_bytes = 0
    for member in members:
        _member_path(member.name)
        if member.name in names:
            raise AcquisitionError(
                f"archive contains a duplicate member: {member.name!r}"
            )
        names.add(member.name)
        if not member.isfile() or member.issym() or member.islnk() or member.isdev():
            raise AcquisitionError(
                f"archive member is not a regular file: {member.name!r}"
            )
        if member.size < 0 or member.size > MAX_MEMBER_BYTES:
            raise AcquisitionError(f"archive member is too large: {member.name!r}")
        extracted_bytes += member.size
        if extracted_bytes > MAX_EXTRACTED_BYTES:
            raise AcquisitionError("archive exceeds the extracted-size limit")
    if len(names) != EXPECTED_MEMBER_COUNT:
        raise AcquisitionError("archive does not contain the exact annotation shape")
    return members, extracted_bytes


def validate_archive(
    archive: Path | ArchiveSnapshot | bytes,
    *,
    expected_sha256: str = EXPECTED_ARCHIVE_SHA256,
) -> ArchiveStats:
    """Validate digest, tar safety, exact names, and extracted byte budget."""
    if isinstance(archive, ArchiveSnapshot):
        snapshot = archive
    elif isinstance(archive, bytes):
        snapshot = ArchiveSnapshot(
            archive,
            hashlib.sha256(archive).hexdigest(),
        )
    else:
        snapshot = _read_file_snapshot(archive, max_bytes=MAX_DOWNLOAD_BYTES)
    if len(snapshot.data) > MAX_DOWNLOAD_BYTES:
        raise AcquisitionError("download exceeds the configured size limit")
    computed_sha256 = hashlib.sha256(snapshot.data).hexdigest()
    if snapshot.sha256 != computed_sha256:
        raise AcquisitionError(
            "archive snapshot SHA-256 mismatch: "
            f"declared {snapshot.sha256}, computed {computed_sha256}"
        )
    if computed_sha256 != expected_sha256.casefold():
        raise AcquisitionError(
            "archive SHA-256 mismatch: "
            f"expected {expected_sha256}, found {computed_sha256}"
        )
    _members, extracted_bytes = _inspect_members(snapshot)
    return ArchiveStats(computed_sha256, EXPECTED_MEMBER_COUNT, extracted_bytes)


def _write_member(
    archive: tarfile.TarFile, member: tarfile.TarInfo, destination: Path
) -> int:
    source: BinaryIO | None = archive.extractfile(member)
    if source is None:
        raise AcquisitionError(f"archive member cannot be read: {member.name!r}")
    written = 0
    try:
        with destination.open("xb") as output:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_MEMBER_BYTES:
                    raise AcquisitionError(
                        f"archive member is too large: {member.name!r}"
                    )
                output.write(chunk)
    finally:
        source.close()
    if written != member.size:
        raise AcquisitionError(
            f"archive member size changed while extracting: {member.name!r}"
        )
    try:
        destination.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise AcquisitionError(
            f"annotation is not UTF-8 text: {member.name!r}"
        ) from exc
    return written


def extract_validated_archive(
    snapshot: ArchiveSnapshot,
    staging: Path,
    *,
    expected_sha256: str = EXPECTED_ARCHIVE_SHA256,
) -> ArchiveStats:
    """Extract only validated regular annotation files into ``staging``."""
    expected = validate_archive(snapshot, expected_sha256=expected_sha256)
    if staging.is_symlink():
        raise AcquisitionError("extraction staging must not be a symbolic link")
    if staging.exists():
        try:
            if next(staging.iterdir(), None) is not None:
                raise AcquisitionError("extraction staging must be empty")
        except OSError as exc:
            raise AcquisitionError(
                f"extraction staging cannot be inspected: {exc}"
            ) from exc
    else:
        staging.mkdir(parents=True, exist_ok=False)
    total = 0
    try:
        with tarfile.open(fileobj=io.BytesIO(snapshot.data), mode="r:*") as archive:
            for member in archive:
                relative = _member_path(member.name)
                destination = staging.joinpath(*relative.parts)
                destination.parent.mkdir(parents=True, exist_ok=False)
                total += _write_member(archive, member, destination)
    except (OSError, tarfile.TarError) as exc:
        raise AcquisitionError(f"archive extraction failed: {exc}") from exc
    if total != expected.extracted_bytes:
        raise AcquisitionError("extracted byte count differs from archive validation")
    stats = validate_extracted_directory(staging)
    return ArchiveStats(expected.archive_sha256, stats.member_count, total)


def validate_extracted_directory(staging: Path) -> ArchiveStats:
    """Validate the materialized exact annotation-only tree."""
    # Do not require contiguous IDs, but only allow the pinned four-digit
    # member pattern.  The exact count is checked below.
    actual_files: set[Path] = set()
    total = 0
    try:
        for current_root, directory_names, filenames in os.walk(
            staging, followlinks=False
        ):
            current = Path(current_root)
            for directory_name in directory_names:
                if (current / directory_name).is_symlink():
                    raise AcquisitionError("extracted symbolic links are not allowed")
            for filename in filenames:
                path = current / filename
                if path.is_symlink() or not path.is_file():
                    raise AcquisitionError(
                        "extracted non-regular files are not allowed"
                    )
                relative = path.relative_to(staging)
                if not MEMBER_PATTERN.fullmatch(relative.as_posix()):
                    raise AcquisitionError(
                        f"extracted unexpected file: {relative.as_posix()!r}"
                    )
                actual_files.add(relative)
                total += path.stat().st_size
                if total > MAX_EXTRACTED_BYTES:
                    raise AcquisitionError("extracted files exceed the size limit")
                path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise AcquisitionError(f"extracted tree cannot be validated: {exc}") from exc
    if len(actual_files) != EXPECTED_MEMBER_COUNT:
        raise AcquisitionError(
            "extracted annotation count mismatch: "
            f"expected {EXPECTED_MEMBER_COUNT}, found {len(actual_files)}"
        )
    return ArchiveStats("", len(actual_files), total)


def _receipt_payload(stats: ArchiveStats) -> dict[str, object]:
    return {
        "receiptVersion": 1,
        "dataset": "McGill-Billboard-v2",
        "sourceArchiveUrl": ARCHIVE_URL,
        "sourcePageUrl": SOURCE_PAGE_URL,
        "archiveSha256": stats.archive_sha256,
        "annotationFileCount": stats.member_count,
        "extractedBytes": stats.extracted_bytes,
        "annotationsOnly": True,
        "audioBundled": False,
        "titlesOrArtistsPublished": False,
    }


def _write_receipt(staging: Path, stats: ArchiveStats) -> None:
    path = staging / RECEIPT_NAME
    temporary = staging / f".{RECEIPT_NAME}.tmp"
    try:
        with temporary.open("x", encoding="utf-8") as handle:
            json.dump(
                _receipt_payload(stats),
                handle,
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            handle.write("\n")
        temporary.replace(path)
    except (OSError, TypeError, ValueError) as exc:
        temporary.unlink(missing_ok=True)
        raise AcquisitionError(f"receipt cannot be written safely: {exc}") from exc


def _install_validated(staging: Path, target: Path) -> None:
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
            raise AcquisitionError(
                f"empty target cannot be replaced safely: {exc}"
            ) from exc
    try:
        staging.replace(target)
    except OSError as exc:
        raise AcquisitionError(f"validated archive cannot be installed: {exc}") from exc


def _cleanup_staging(staging: Path) -> None:
    if not staging.exists():
        return
    try:
        shutil.rmtree(staging)
    except OSError as exc:
        raise AcquisitionError(f"temporary staging cleanup failed: {exc}") from exc


def acquire_mcgill(
    requested_target: Path = DEFAULT_TARGET,
    *,
    archive_url: str = ARCHIVE_URL,
    expected_sha256: str = EXPECTED_ARCHIVE_SHA256,
    project_raw_root: Path = PROJECT_RAW_ROOT,
    allow_outside_project_raw: bool = False,
) -> ArchiveStats:
    """Download, validate, and atomically install the annotation archive."""
    target = resolve_target(
        requested_target,
        project_raw_root=project_raw_root,
        allow_outside_project_raw=allow_outside_project_raw,
    )
    staging: Path | None = None
    archive_path: Path | None = None
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(
            tempfile.mkdtemp(prefix=f".{target.name}.fetch-", dir=target.parent)
        )
        archive_descriptor, archive_name = tempfile.mkstemp(
            prefix=f".{target.name}.archive-",
            suffix=".tar.gz",
            dir=target.parent,
        )
        os.close(archive_descriptor)
        archive_path = Path(archive_name)
        archive_path.unlink()
    except OSError as exc:
        if archive_path is not None:
            archive_path.unlink(missing_ok=True)
        if staging is not None:
            _cleanup_staging(staging)
        raise AcquisitionError(
            f"staging directory cannot be created safely: {exc}"
        ) from exc
    installed = False
    try:
        snapshot = download_archive(
            archive_path,
            url=archive_url,
            expected_sha256=expected_sha256,
        )
        extract_stats = validate_archive(snapshot, expected_sha256=expected_sha256)
        annotation_stats = extract_validated_archive(
            snapshot,
            staging,
            expected_sha256=expected_sha256,
        )
        _write_receipt(staging, annotation_stats)
        archive_path.unlink(missing_ok=True)
        result = ArchiveStats(
            extract_stats.archive_sha256,
            annotation_stats.member_count,
            annotation_stats.extracted_bytes,
            target,
        )
        _install_validated(staging, target)
        installed = True
        return result
    finally:
        if not installed:
            archive_path.unlink(missing_ok=True)
            _cleanup_staging(staging)


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Fetch the annotation-only McGill Billboard v2 archive."
    )
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    parser.add_argument("--url", default=ARCHIVE_URL, help=argparse.SUPPRESS)
    parser.add_argument("--allow-outside-project-raw", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_argument_parser().parse_args(argv)
    try:
        stats = acquire_mcgill(
            arguments.target,
            archive_url=arguments.url,
            allow_outside_project_raw=arguments.allow_outside_project_raw,
        )
    except AcquisitionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"installed: {stats.member_count} annotation files")
    print(f"archive_sha256: {stats.archive_sha256}")
    print(f"extracted_bytes: {stats.extracted_bytes}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
