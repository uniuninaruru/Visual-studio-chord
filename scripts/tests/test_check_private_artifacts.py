import contextlib
import importlib.util
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).parents[1] / "check-private-artifacts.py"
SPEC = importlib.util.spec_from_file_location(
    "check_private_artifacts",
    SCRIPT_PATH,
)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class PrivateArtifactPolicyTests(unittest.TestCase):
    def test_forbidden_binary_extensions_are_case_insensitive(self) -> None:
        for path in (
            "weights/model.SAFETENSORS",
            "weights/pytorch_model.BIN",
            "scores/source.MUSICXML",
            "exports/session.MID",
            "audio/source.FlAc",
            "cache/tensors.NPZ",
        ):
            with self.subTest(path=path):
                self.assertIn(
                    "binary",
                    MODULE.classify_forbidden_path(path),
                )

    def test_private_training_and_future_model_directories_are_rejected(
        self,
    ) -> None:
        for path in (
            "datasets/raw/source.json",
            "datasets/processed/v2/train.index.jsonl",
            "training/runs/2026-07-30/training-run.json",
            "local-models/private/current.json",
            r"models\harmony-only-v1\versions\abc\manifest.json",
        ):
            with self.subTest(path=path):
                self.assertIsNotNone(MODULE.classify_forbidden_path(path))

    def test_public_policy_and_non_reconstructive_metadata_paths_are_allowed(
        self,
    ) -> None:
        for path in (
            "docs/research/harmony-only-private-training-policy.en.md",
            "datasets/manifests/harmony-only-public-summary.json",
            "configs/models/harmonyforge-bimask-base-v1.yaml",
            "models/README.md",
            "models/harmony-corpus-v1.json",
        ):
            with self.subTest(path=path):
                self.assertIsNone(MODULE.classify_forbidden_path(path))

    def test_repository_currently_tracks_no_forbidden_artifacts(self) -> None:
        repository = Path(__file__).resolve().parents[2]
        violations = MODULE.find_violations(MODULE.tracked_paths(repository))
        self.assertEqual(violations, [])

    def test_docker_build_context_excludes_private_training_material(self) -> None:
        repository = Path(__file__).resolve().parents[2]
        patterns = {
            line.strip()
            for line in (repository / ".dockerignore").read_text(
                encoding="utf-8"
            ).splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }
        required_patterns = {
            ".env",
            ".env.*",
            "models/*/",
            "local-models/",
            "datasets/raw/",
            "datasets/processed/",
            "training/runs/",
            "**/*.safetensors",
            "**/*.mid",
            "**/*.musicxml",
            "**/*.wav",
        }
        self.assertTrue(
            required_patterns.issubset(patterns),
            required_patterns - patterns,
        )

    def test_command_fails_when_git_tracks_a_forbidden_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            repository = Path(temporary_directory)
            subprocess.run(
                ["git", "init", "--quiet", str(repository)],
                check=True,
                capture_output=True,
            )
            (repository / "safe.md").write_text("safe\n", encoding="utf-8")
            private_directory = repository / "models" / "private-v1"
            private_directory.mkdir(parents=True)
            (private_directory / "manifest.json").write_text(
                "{}\n",
                encoding="utf-8",
            )
            subprocess.run(
                ["git", "-C", str(repository), "add", "--force", "."],
                check=True,
                capture_output=True,
            )

            error = io.StringIO()
            with contextlib.redirect_stderr(error):
                result = MODULE.main(["--repo-root", str(repository)])

            self.assertEqual(result, 1)
            self.assertIn(
                "models/private-v1/manifest.json",
                error.getvalue(),
            )
            self.assertIn("Keep raw/processed data and weights local", error.getvalue())

    def test_command_reports_a_non_repository_separately(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            error = io.StringIO()
            with contextlib.redirect_stderr(error):
                result = MODULE.main(
                    ["--repo-root", temporary_directory],
                )

            self.assertEqual(result, 2)
            self.assertIn("could not inspect tracked files", error.getvalue())


if __name__ == "__main__":
    unittest.main()
