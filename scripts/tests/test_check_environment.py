from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest import mock


def load_diagnostics_module():
    script = Path(__file__).resolve().parents[1] / "check-environment.py"
    spec = importlib.util.spec_from_file_location("check_environment", script)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load check-environment.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


diagnostics = load_diagnostics_module()


class EnvironmentDiagnosticsTests(unittest.TestCase):
    def test_parse_version_accepts_common_runtime_output(self) -> None:
        self.assertEqual(diagnostics.parse_version("v24.14.0"), (24, 14, 0))
        self.assertEqual(diagnostics.parse_version("Python 3.12.13"), (3, 12, 13))
        self.assertIsNone(diagnostics.parse_version("unknown"))

    def test_dotenv_parser_does_not_execute_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text(
                "APP_PORT=8765\n"
                "LITERAL=$(touch should-not-exist)\n"
                "QUOTED='value with spaces'\n"
                "BAD LINE\n",
                encoding="utf-8",
            )
            values, warnings = diagnostics.parse_dotenv(path)

            self.assertEqual(values["APP_PORT"], "8765")
            self.assertEqual(values["LITERAL"], "$(touch should-not-exist)")
            self.assertEqual(values["QUOTED"], "value with spaces")
            self.assertEqual(len(warnings), 1)
            self.assertFalse((Path(directory) / "should-not-exist").exists())

    def test_optional_warning_does_not_block_startup(self) -> None:
        checks = [
            diagnostics.make_check("node", "ok", "ready"),
            diagnostics.make_check(
                "backendConnection",
                "warning",
                "offline",
                optional=True,
            ),
        ]
        self.assertEqual(diagnostics.summarize(checks), ("ready-with-fallback", 0))

    def test_setup_acceleration_modes_are_explicit(self) -> None:
        self.assertEqual(
            diagnostics.VALID_ACCELERATION_MODES,
            {"auto", "cuda", "mps", "directml", "cpu", "none"},
        )

    def test_required_error_blocks_startup(self) -> None:
        checks = [diagnostics.make_check("node", "error", "missing")]
        self.assertEqual(diagnostics.summarize(checks), ("blocked", 1))

    def test_empirical_corpus_model_is_reported_separately(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_directory = Path(directory) / "large-models"
            model_directory.mkdir()
            (model_directory / "harmony-corpus-v1.json").write_text(
                "{}",
                encoding="utf-8",
            )

            check = diagnostics.check_models(
                Path(directory),
                {"MODEL_DIRECTORY": str(model_directory)},
            )

            self.assertEqual(check["status"], "ok")
            self.assertTrue(check["details"]["corpusModelAvailable"])
            self.assertIn("Empirical harmony corpus", check["summary"])

    def test_installed_metadata_without_importable_cli_is_an_error(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            executable = root / ".venv" / "bin" / "python"
            executable.parent.mkdir(parents=True)
            executable.write_text("", encoding="utf-8")
            observed: list[list[str]] = []

            def fail_cli_import(command, timeout=4.0):
                observed.append(list(command))
                return 1, "ModuleNotFoundError: No module named 'app'"

            with (
                mock.patch.object(
                    diagnostics,
                    "venv_python",
                    return_value=executable,
                ),
                mock.patch.object(
                    diagnostics,
                    "command_output",
                    side_effect=fail_cli_import,
                ),
            ):
                checks = diagnostics.check_python_environment(
                    root,
                    strict_versions=False,
                    require_installed=True,
                )

            environment = next(
                check
                for check in checks
                if check["id"] == "pythonEnvironment"
            )
            self.assertEqual(environment["status"], "error")
            self.assertIn("app.ml.cli", observed[0][-1])

    def test_successful_probe_with_invalid_payload_is_an_error(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            executable = root / ".venv" / "bin" / "python"
            executable.parent.mkdir(parents=True)
            executable.write_text("", encoding="utf-8")

            with (
                mock.patch.object(
                    diagnostics,
                    "venv_python",
                    return_value=executable,
                ),
                mock.patch.object(
                    diagnostics,
                    "command_output",
                    return_value=(0, "{}"),
                ),
            ):
                checks = diagnostics.check_python_environment(
                    root,
                    strict_versions=False,
                    require_installed=True,
                )

            environment = next(
                check
                for check in checks
                if check["id"] == "pythonEnvironment"
            )
            self.assertEqual(environment["status"], "error")
            self.assertIn("invalid result", environment["summary"])


if __name__ == "__main__":
    unittest.main()
