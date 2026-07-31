import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_DIRECTORY = Path(__file__).resolve().parents[2]


class TrainingEntrypointTests(unittest.TestCase):
    def test_direct_training_entrypoints_resolve_backend_from_any_directory(
        self,
    ) -> None:
        entrypoints = {
            "training/train.py": "harmonyforge-train",
            "training/evaluate.py": "harmonyforge-evaluate",
            "training/datasets/compiler.py": "harmonyforge-compile",
        }
        with tempfile.TemporaryDirectory() as temporary_directory:
            for relative_path, command_name in entrypoints.items():
                with self.subTest(entrypoint=relative_path):
                    completed = subprocess.run(
                        [
                            sys.executable,
                            str(PROJECT_DIRECTORY / relative_path),
                            "--help",
                        ],
                        cwd=temporary_directory,
                        check=False,
                        capture_output=True,
                        text=True,
                    )
                    self.assertEqual(completed.returncode, 0, completed.stderr)
                    self.assertIn(command_name, completed.stdout)
                    self.assertNotIn("ModuleNotFoundError", completed.stderr)


if __name__ == "__main__":
    unittest.main()
