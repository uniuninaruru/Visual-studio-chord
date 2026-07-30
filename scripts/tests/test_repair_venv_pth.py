from __future__ import annotations

import importlib.util
import os
import platform
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1]
    / "repair-venv-pth.py"
)
PROJECT_DIR = SCRIPT_PATH.parent.parent
SPEC = importlib.util.spec_from_file_location("repair_venv_pth", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class RepairVenvPthTests(unittest.TestCase):
    def test_project_purelib_rejects_a_different_interpreter(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            expected = root / "expected"
            expected.mkdir()

            with (
                mock.patch.object(MODULE.sys, "prefix", str(root / "other")),
                mock.patch.object(MODULE.sys, "base_prefix", str(root / "base")),
            ):
                with self.assertRaisesRegex(
                    MODULE.RepairError,
                    "selected project virtual environment",
                ):
                    MODULE.project_purelib(expected)

    def test_project_purelib_rejects_a_non_venv_interpreter(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            expected = Path(directory) / "expected"
            expected.mkdir()

            with (
                mock.patch.object(MODULE.sys, "prefix", str(expected)),
                mock.patch.object(MODULE.sys, "base_prefix", str(expected)),
            ):
                with self.assertRaisesRegex(
                    MODULE.RepairError,
                    "selected project virtual environment",
                ):
                    MODULE.project_purelib(expected)

    def test_project_purelib_rejects_site_packages_outside_venv(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            expected = root / "expected"
            outside = root / "outside" / "site-packages"
            expected.mkdir()
            outside.mkdir(parents=True)

            with (
                mock.patch.object(MODULE.sys, "prefix", str(expected)),
                mock.patch.object(MODULE.sys, "base_prefix", str(root / "base")),
                mock.patch.object(
                    MODULE.sysconfig,
                    "get_path",
                    return_value=str(outside),
                ),
            ):
                with self.assertRaisesRegex(
                    MODULE.RepairError,
                    "escapes the selected environment",
                ):
                    MODULE.project_purelib(expected)

    def test_non_hidden_platform_is_a_noop(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            purelib = Path(directory)
            path = purelib / "project.pth"
            path.write_text("import project_editable\n", encoding="utf-8")

            self.assertEqual(
                MODULE.repair_pth_visibility(purelib, system="Linux"),
                0,
            )
            self.assertEqual(
                path.read_text(encoding="utf-8"),
                "import project_editable\n",
            )

    def test_macos_fallback_is_relative_and_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            expected = root / ".venv"
            purelib = expected / "lib" / "python3.14" / "site-packages"
            source = root / "backend" / "app"
            purelib.mkdir(parents=True)
            source.mkdir(parents=True)
            (source / "__init__.py").write_text("", encoding="utf-8")

            self.assertTrue(
                MODULE.ensure_macos_editable_fallback(purelib, expected)
            )
            destination = purelib / "app"
            self.assertTrue(destination.is_symlink())
            self.assertFalse(destination.readlink().is_absolute())
            self.assertEqual(destination.resolve(), source.resolve())
            self.assertFalse(
                MODULE.ensure_macos_editable_fallback(purelib, expected)
            )

    def test_macos_fallback_does_not_overwrite_an_existing_package(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            expected = root / ".venv"
            purelib = expected / "lib" / "python3.14" / "site-packages"
            source = root / "backend" / "app"
            purelib.mkdir(parents=True)
            source.mkdir(parents=True)
            (source / "__init__.py").write_text("", encoding="utf-8")
            (purelib / "app").mkdir()

            with self.assertRaisesRegex(
                MODULE.RepairError,
                "already exists",
            ):
                MODULE.ensure_macos_editable_fallback(purelib, expected)

    def test_setup_scripts_repair_and_smoke_test_all_cli_entrypoints(self) -> None:
        posix = (PROJECT_DIR / "scripts" / "setup.sh").read_text(
            encoding="utf-8"
        )
        windows = (PROJECT_DIR / "scripts" / "setup.ps1").read_text(
            encoding="utf-8"
        )

        for script in (posix, windows):
            editable = script.index("--editable")
            repair = script.index("repair-venv-pth.py")
            cli_import = script.index("from app.ml.cli import")
            self.assertLess(editable, repair)
            self.assertLess(repair, cli_import)
            for command in (
                "harmonyforge-compile",
                "harmonyforge-train",
                "harmonyforge-evaluate",
            ):
                command_index = script.index(command)
                self.assertLess(cli_import, command_index)
            self.assertIn("--help", script)

    @unittest.skipUnless(
        platform.system() == "Darwin"
        and hasattr(os, "chflags")
        and bool(getattr(stat, "UF_HIDDEN", 0)),
        "macOS file flags are required",
    )
    def test_macos_hidden_pth_is_made_visible(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            purelib = Path(directory)
            path = purelib / "project.pth"
            path.write_text("import project_editable\n", encoding="utf-8")
            hidden = getattr(stat, "UF_HIDDEN")
            os.chflags(path, path.stat().st_flags | hidden)

            repaired = MODULE.repair_pth_visibility(
                purelib,
                system="Darwin",
            )

            self.assertEqual(repaired, 1)
            self.assertFalse(path.stat().st_flags & hidden)

    def test_windows_hidden_attribute_is_cleared(self) -> None:
        get_attributes = mock.Mock(return_value=MODULE.WINDOWS_HIDDEN_ATTRIBUTE)
        set_attributes = mock.Mock(return_value=1)
        kernel32 = SimpleNamespace(
            GetFileAttributesW=get_attributes,
            SetFileAttributesW=set_attributes,
        )

        with mock.patch.object(
            MODULE.ctypes,
            "windll",
            SimpleNamespace(kernel32=kernel32),
            create=True,
        ):
            repaired = MODULE._clear_windows_hidden_attribute(Path("project.pth"))

        self.assertEqual(repaired, 1)
        set_attributes.assert_called_once_with("project.pth", 0)
        self.assertEqual(get_attributes.restype, MODULE.ctypes.c_uint32)
        self.assertEqual(set_attributes.restype, MODULE.ctypes.c_int)

    def test_windows_invalid_attributes_are_reported(self) -> None:
        get_attributes = mock.Mock(return_value=MODULE.WINDOWS_INVALID_ATTRIBUTES)
        set_attributes = mock.Mock(return_value=1)
        kernel32 = SimpleNamespace(
            GetFileAttributesW=get_attributes,
            SetFileAttributesW=set_attributes,
        )

        with mock.patch.object(
            MODULE.ctypes,
            "windll",
            SimpleNamespace(kernel32=kernel32),
            create=True,
        ):
            with self.assertRaisesRegex(
                MODULE.RepairError,
                "could not read Windows attributes",
            ):
                MODULE._clear_windows_hidden_attribute(Path("project.pth"))

        set_attributes.assert_not_called()


if __name__ == "__main__":
    unittest.main()
