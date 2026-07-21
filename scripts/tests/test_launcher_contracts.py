from __future__ import annotations

import os
import shutil
import subprocess
import unittest
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[2]
CUSTOM_PORT = "46173"
SHARED_TOKEN = "launcher_contract_token_1234567890abcdef"


def launcher_environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment.update(
        {
            "MTC_FRONTEND_PORT": CUSTOM_PORT,
            "MTC_LAUNCH_DRY_RUN": "1",
            "MTC_SHARED_TOKEN": SHARED_TOKEN,
        }
    )
    return environment


def assert_launcher_output(test: unittest.TestCase, output: str) -> None:
    expected_desktop_url = (
        f"Desktop URL: http://127.0.0.1:{CUSTOM_PORT}/#access={SHARED_TOKEN}"
    )
    test.assertIn(expected_desktop_url, output)
    test.assertIn("Phone URL", output)
    test.assertIn(f":{CUSTOM_PORT}/#access={SHARED_TOKEN}", output)
    test.assertNotIn(":5173/", output)


class LauncherContractTests(unittest.TestCase):
    @unittest.skipIf(os.name == "nt", "POSIX launcher contract")
    def test_posix_launchers_honor_custom_port_and_token_without_starting(self) -> None:
        bash = shutil.which("bash")
        if bash is None:
            self.skipTest("bash is unavailable")

        for name in ("serve-lan.sh", "start-local.sh"):
            with self.subTest(launcher=name):
                result = subprocess.run(
                    [bash, str(PROJECT_DIR / "scripts" / name)],
                    cwd=PROJECT_DIR,
                    env=launcher_environment(),
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=20,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                assert_launcher_output(self, result.stdout + result.stderr)

    @unittest.skipUnless(os.name == "nt", "Windows launcher contract")
    def test_powershell_launchers_honor_custom_port_and_token_without_starting(self) -> None:
        powershell = shutil.which("pwsh") or shutil.which("powershell")
        if powershell is None:
            self.skipTest("PowerShell is unavailable")

        for name in ("serve-lan.ps1", "start-local.ps1"):
            with self.subTest(launcher=name):
                result = subprocess.run(
                    [
                        powershell,
                        "-NoLogo",
                        "-NoProfile",
                        "-NonInteractive",
                        "-File",
                        str(PROJECT_DIR / "scripts" / name),
                    ],
                    cwd=PROJECT_DIR,
                    env=launcher_environment(),
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                assert_launcher_output(self, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
