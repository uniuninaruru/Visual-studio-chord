#!/usr/bin/env python3
"""Repair editable imports inside this project's virtual environment.

Python 3.14 ignores ``.pth`` files carrying the macOS ``UF_HIDDEN`` flag or
the Windows hidden-file attribute. A dot-named virtual environment can cause
installers to inherit that attribute, which leaves distribution metadata and
console launchers present while editable imports fail. This script clears that
attribute only on ``*.pth`` files inside the explicitly selected environment.

Some macOS File Provider locations immediately restore ``UF_HIDDEN`` on
descendants of ``.venv``. On macOS, a project-relative package symlink is also
installed inside that same environment so the editable source remains
importable without relying on persistent ``.pth`` visibility.
"""

from __future__ import annotations

import argparse
import ctypes
import os
import platform
import stat
import sys
import sysconfig
from pathlib import Path

WINDOWS_HIDDEN_ATTRIBUTE = 0x2
WINDOWS_INVALID_ATTRIBUTES = 0xFFFFFFFF


class RepairError(RuntimeError):
    """The selected interpreter or site-packages path is unsafe to modify."""


def project_purelib(expected_venv: Path) -> Path:
    prefix = Path(sys.prefix).resolve()
    base_prefix = Path(sys.base_prefix).resolve()
    expected = expected_venv.resolve()
    if prefix != expected or prefix == base_prefix:
        raise RepairError(
            "repair must run with the selected project virtual environment"
        )
    configured = sysconfig.get_path("purelib")
    if not configured:
        raise RepairError("virtual environment site-packages was not reported")
    purelib = Path(configured).resolve()
    try:
        purelib.relative_to(expected)
    except ValueError as exc:
        raise RepairError(
            "virtual environment site-packages escapes the selected environment"
        ) from exc
    if not purelib.is_dir():
        raise RepairError("virtual environment site-packages does not exist")
    return purelib


def repair_pth_visibility(
    purelib: Path,
    *,
    system: str | None = None,
) -> int:
    selected_system = system or platform.system()
    repaired = 0
    for path in sorted(purelib.glob("*.pth")):
        if not path.is_file() or path.is_symlink():
            continue
        if selected_system == "Darwin":
            hidden_flag = getattr(stat, "UF_HIDDEN", 0)
            flags = path.stat().st_flags
            if hidden_flag and flags & hidden_flag:
                os.chflags(path, flags & ~hidden_flag, follow_symlinks=False)
                repaired += 1
        elif selected_system == "Windows":
            repaired += _clear_windows_hidden_attribute(path)
    return repaired


def ensure_macos_editable_fallback(purelib: Path, expected_venv: Path) -> bool:
    """Link this project's ``app`` package without touching external paths."""

    purelib = purelib.resolve()
    project_root = expected_venv.resolve().parent
    source = (project_root / "backend" / "app").resolve()
    try:
        source.relative_to(project_root)
    except ValueError as exc:
        raise RepairError("editable package source escapes the project") from exc
    if not source.is_dir() or not (source / "__init__.py").is_file():
        raise RepairError("editable package source does not exist")

    destination = purelib / "app"
    if destination.is_symlink():
        try:
            destination_source = destination.resolve(strict=True)
        except (OSError, RuntimeError) as exc:
            raise RepairError("site-packages/app is an invalid symlink") from exc
        if destination_source != source:
            raise RepairError("site-packages/app points to a different source")
        return False
    if destination.exists():
        raise RepairError("site-packages/app already exists and was not overwritten")

    relative_source = Path(os.path.relpath(source, start=purelib))
    destination.symlink_to(relative_source, target_is_directory=True)
    return True


def _clear_windows_hidden_attribute(path: Path) -> int:
    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    get_attributes = kernel32.GetFileAttributesW
    get_attributes.argtypes = [ctypes.c_wchar_p]
    get_attributes.restype = ctypes.c_uint32
    set_attributes = kernel32.SetFileAttributesW
    set_attributes.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32]
    set_attributes.restype = ctypes.c_int

    attributes = get_attributes(str(path))
    if attributes == WINDOWS_INVALID_ATTRIBUTES:
        raise RepairError(f"could not read Windows attributes for {path.name}")
    if not attributes & WINDOWS_HIDDEN_ATTRIBUTE:
        return 0
    updated = attributes & ~WINDOWS_HIDDEN_ATTRIBUTE
    if not set_attributes(str(path), updated):
        raise RepairError(f"could not clear Windows hidden flag for {path.name}")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-venv", type=Path, required=True)
    arguments = parser.parse_args()
    try:
        expected_venv = arguments.expected_venv.resolve()
        purelib = project_purelib(expected_venv)
        repaired = repair_pth_visibility(purelib)
        fallback_created = (
            ensure_macos_editable_fallback(purelib, expected_venv)
            if platform.system() == "Darwin"
            else False
        )
    except (OSError, RepairError) as exc:
        parser.error(str(exc))
    print(f"Editable import visibility: repaired {repaired} .pth file(s).")
    if platform.system() == "Darwin":
        state = "created" if fallback_created else "already present"
        print(f"macOS editable package fallback: {state}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
