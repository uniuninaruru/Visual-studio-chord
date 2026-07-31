"""Durability of the compiler's atomic bundle install.

Refusing to overwrite an existing bundle keeps the last known good set intact
against an ordinary mid-compile failure. It does not by itself survive a power
loss: a rename can reach the disk while the renamed directory's contents are
still only in the page cache, publishing a bundle under its final name without
the bytes that name promises. The ordering of the two directory flushes around
the rename is what closes that, so it is pinned here rather than left to read
correctly by inspection.
"""

from __future__ import annotations

import os
from pathlib import Path

from app.ml import dataset as dataset_module
from tests.test_training_dataset import _compile, _record


def test_bundle_entries_are_flushed_before_publication_and_the_rename_after(
    tmp_path,
    monkeypatch,
) -> None:
    destination = tmp_path / "durable-v1"
    original = dataset_module._fsync_directory
    events: list[tuple[Path, bool]] = []

    def record(path: Path) -> None:
        # Whether the destination exists yet distinguishes the two sides of the
        # rename without having to intercept the rename itself.
        events.append((path, destination.exists()))
        original(path)

    monkeypatch.setattr(dataset_module, "_fsync_directory", record)
    _compile(tmp_path, [_record(f"durable-{index}") for index in range(4)], "durable-v1")

    assert len(events) == 2
    staging_path, destination_existed_at_staging_sync = events[0]
    parent_path, destination_existed_at_parent_sync = events[1]

    # The staging directory is flushed while it is still unpublished.
    assert destination_existed_at_staging_sync is False
    assert staging_path.name.startswith(f".{destination.name}.stage-")
    # The parent is flushed only once the bundle carries its final name.
    assert destination_existed_at_parent_sync is True
    assert parent_path == destination.parent


def test_every_bundle_file_is_flushed_before_it_is_renamed_into_place(
    tmp_path,
    monkeypatch,
) -> None:
    """A published directory whose files are empty is worse than no directory.

    The manifest hashes would catch it on load, but only after an operator has
    to delete a bundle that looks complete before they can retry.
    """

    synced: list[int] = []
    original_fsync = os.fsync

    def record(descriptor: int) -> None:
        synced.append(descriptor)
        original_fsync(descriptor)

    monkeypatch.setattr(os, "fsync", record)
    output, _ = _compile(
        tmp_path,
        [_record(f"flushed-{index}") for index in range(4)],
        "flushed-v1",
    )

    bundle_files = [path for path in output.iterdir() if path.is_file()]
    assert bundle_files
    # One flush per written file, plus the two directory flushes.
    assert len(synced) >= len(bundle_files) + 2
