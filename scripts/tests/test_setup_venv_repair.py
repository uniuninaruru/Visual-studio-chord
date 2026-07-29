from __future__ import annotations

import subprocess
import sys
import unittest
import venv
from pathlib import Path
from tempfile import TemporaryDirectory

PROJECT_DIR = Path(__file__).resolve().parents[2]


class VenvRepairBehaviourTests(unittest.TestCase):
    """The behaviour of `venv` that the setup scripts have to work around.

    A virtual environment whose interpreter has been removed — the usual cause
    being a system or Xcode Python upgraded or uninstalled out from under it —
    leaves a dangling symlink. `venv` will not touch a directory that already
    exists, so running setup again does not repair it, and installing a
    supported Python does not either. `--clear` is the only thing that does.
    """

    def _broken_environment(self, root: Path) -> Path:
        directory = root / ".venv"
        venv.create(directory, with_pip=False, symlinks=True)
        interpreter = directory / "bin" / "python3"
        self.assertTrue(interpreter.is_symlink())
        interpreter.unlink()
        interpreter.symlink_to("/nonexistent/python3")
        self.assertFalse(interpreter.exists())
        return directory

    @unittest.skipIf(sys.platform == "win32", "POSIX symlink layout")
    def test_plain_venv_does_not_repair_a_missing_interpreter(self) -> None:
        """Running `venv` again leaves the dangling link exactly as it was.

        Whether it reports success is not something a script can rely on: with
        pip it fails trying to run the interpreter that is gone, and without pip
        it exits zero having repaired nothing. Only the outcome is stable, so
        that is what is asserted.
        """

        for with_pip in (True, False):
            with self.subTest(with_pip=with_pip):
                with TemporaryDirectory() as root:
                    directory = self._broken_environment(Path(root))
                    arguments = [sys.executable, "-m", "venv"]
                    if not with_pip:
                        arguments.append("--without-pip")

                    subprocess.run(
                        [*arguments, str(directory)],
                        capture_output=True,
                        text=True,
                        check=False,
                    )

                    interpreter = directory / "bin" / "python3"
                    self.assertEqual(
                        interpreter.readlink(), Path("/nonexistent/python3")
                    )
                    self.assertFalse(interpreter.exists())

    @unittest.skipIf(sys.platform == "win32", "POSIX symlink layout")
    def test_clear_rebuilds_a_missing_interpreter(self) -> None:
        with TemporaryDirectory() as root:
            directory = self._broken_environment(Path(root))

            subprocess.run(
                [sys.executable, "-m", "venv", "--clear", str(directory)],
                capture_output=True,
                text=True,
                check=True,
            )

            interpreter = directory / "bin" / "python3"
            self.assertTrue(interpreter.exists())
            version = subprocess.run(
                [str(interpreter), "--version"],
                capture_output=True,
                text=True,
                check=True,
            )
            self.assertTrue(version.stdout.startswith("Python 3."))


class SetupVenvRepairContractTests(unittest.TestCase):
    """Both setup scripts must rebuild rather than misdiagnose."""

    def test_posix_setup_rebuilds_a_broken_environment(self) -> None:
        script = (PROJECT_DIR / "scripts" / "setup.sh").read_text(encoding="utf-8")

        self.assertIn('-m venv --clear "$VENV_DIR"', script)
        self.assertIn("The .venv interpreter is missing", script)

    def test_windows_setup_rebuilds_a_broken_environment(self) -> None:
        script = (PROJECT_DIR / "scripts" / "setup.ps1").read_text(encoding="utf-8")

        self.assertIn('"-m", "venv", "--clear", $VenvDir', script)
        self.assertIn("The .venv interpreter is missing", script)

    def test_setup_does_not_blame_the_python_version_for_a_broken_environment(
        self,
    ) -> None:
        """The unsupported-Python message must not be the one a broken venv gets.

        It sends the reader to install a Python they are likely to have already,
        and no Python they install will fix a dangling interpreter symlink.
        """

        for name in ("setup.sh", "setup.ps1"):
            script = (PROJECT_DIR / "scripts" / name).read_text(encoding="utf-8")
            missing_index = script.index("The .venv interpreter is missing")
            unsupported_index = script.index("The existing .venv uses an unsupported")
            self.assertLess(missing_index, unsupported_index, name)


if __name__ == "__main__":
    unittest.main()
