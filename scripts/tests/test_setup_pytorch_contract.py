from __future__ import annotations

import unittest
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[2]


class SetupPyTorchContractTests(unittest.TestCase):
    def test_portable_setup_installs_acceleration_profile_by_default(self) -> None:
        posix = (PROJECT_DIR / "scripts" / "setup.sh").read_text(encoding="utf-8")
        windows = (PROJECT_DIR / "scripts" / "setup.ps1").read_text(encoding="utf-8")

        self.assertIn('MTC_ACCELERATION:-auto', posix)
        self.assertIn('setup-acceleration.sh" "$ACCELERATION_MODE"', posix)
        self.assertIn('[string]$Acceleration = "auto"', windows)
        self.assertIn("setup-acceleration.ps1", windows)

    def test_windows_auto_profile_keeps_pytorch_for_harmonyforge(self) -> None:
        script = (PROJECT_DIR / "scripts" / "setup-acceleration.ps1").read_text(
            encoding="utf-8"
        )

        auto_branch = script.split('if ($Backend -eq "auto") {', maxsplit=1)[1]
        auto_branch = auto_branch.split("# ONNX Runtime variants", maxsplit=1)[0]
        self.assertIn('$Backend = "cpu"', auto_branch)
        self.assertNotIn('$Backend = "directml"', auto_branch)


if __name__ == "__main__":
    unittest.main()
