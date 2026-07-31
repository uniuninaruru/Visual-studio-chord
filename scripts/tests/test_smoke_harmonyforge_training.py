from __future__ import annotations

import importlib.util
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1] / "smoke-harmonyforge-training.py"
)
SPEC = importlib.util.spec_from_file_location(
    "smoke_harmonyforge_training",
    SCRIPT_PATH,
)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class FakeTensor:
    def __init__(self, shape: tuple[int, ...] = (1,), dtype: str = "float32"):
        self.shape = shape
        self.dtype = dtype


class FakeSafeTensors:
    @staticmethod
    def save_file(state, path: str) -> None:
        assert state
        header = json.dumps(
            {
                "weight": {
                    "dtype": "F32",
                    "shape": [1],
                    "data_offsets": [0, 4],
                }
            },
            separators=(",", ":"),
        ).encode()
        Path(path).write_bytes(
            len(header).to_bytes(8, "little")
            + header
            + struct.pack("<f", 1.0)
        )

    @staticmethod
    def load_file(path: str, device: str):
        assert Path(path).is_file()
        assert device == "cpu"
        return {"weight": FakeTensor()}


class FakeTorchDeterminism:
    def __init__(self) -> None:
        self.seed = None
        self.calls: list[tuple[bool, bool | None]] = []

    def manual_seed(self, seed: int) -> None:
        self.seed = seed

    def use_deterministic_algorithms(
        self,
        enabled: bool,
        *,
        warn_only: bool | None = None,
    ) -> None:
        self.calls.append((enabled, warn_only))


class HarmonyForgeSmokeTests(unittest.TestCase):
    def test_mps_records_warn_only_as_non_deterministic(self) -> None:
        torch = FakeTorchDeterminism()

        result = MODULE._configure_determinism(
            torch,
            device="mps",
            seed="1729",
        )

        self.assertEqual(torch.calls, [(True, True)])
        self.assertFalse(result["deterministic"])
        self.assertEqual(result["mode"], "warnOnlyMps")
        self.assertIsInstance(torch.seed, int)

    def test_cpu_uses_strict_determinism(self) -> None:
        torch = FakeTorchDeterminism()

        result = MODULE._configure_determinism(
            torch,
            device="cpu",
            seed="1729",
        )

        self.assertEqual(torch.calls, [(True, None)])
        self.assertTrue(result["deterministic"])
        self.assertEqual(result["mode"], "strict")

    def test_explicit_mps_refuses_silent_cpu_fallback(self) -> None:
        torch = SimpleNamespace(
            backends=SimpleNamespace(
                mps=SimpleNamespace(is_available=lambda: True),
            )
        )
        with (
            patch.dict(
                MODULE.os.environ,
                {"PYTORCH_ENABLE_MPS_FALLBACK": "1"},
            ),
            self.assertRaisesRegex(
                MODULE.SmokeTrainingError,
                "cannot be mistaken for Apple GPU",
            ),
        ):
            MODULE._select_device(torch, "mps")

    def test_checkpoint_is_atomic_reloaded_and_visibly_untrained(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = (
                Path(temporary_directory)
                / "UNTRAINED_MPS_SMOKE_ONLY.safetensors"
            )
            result = MODULE._atomic_write_checkpoint(
                {"weight": FakeTensor()},
                output,
                safetensors_module=FakeSafeTensors(),
            )

            self.assertTrue(output.is_file())
            self.assertTrue(result["reloadedAndValidated"])
            self.assertEqual(
                result["file"],
                "UNTRAINED_MPS_SMOKE_ONLY.safetensors",
            )
            self.assertEqual(len(result["sha256"]), 64)
            self.assertEqual(
                list(output.parent.glob(f".{output.name}.*.tmp")),
                [],
            )

    def test_runtime_registry_is_never_an_output_target(self) -> None:
        runtime_registry = (
            MODULE.PROJECT_ROOT / "models" / MODULE.MODEL_ID / "smoke"
        )

        with self.assertRaisesRegex(
            MODULE.SmokeTrainingError,
            "runtime model registry",
        ):
            MODULE._validate_output_directory(runtime_registry)

    def test_no_checkpoint_run_still_writes_non_publishable_metadata(self) -> None:
        fake_model = SimpleNamespace()
        fake_torch = SimpleNamespace(__version__="test")
        step = {
            "modelId": MODULE.MODEL_ID,
            "parameterCount": 104_567_874,
            "loss": 1.25,
            "setupSeconds": 0.1,
            "optimizerStepSeconds": 0.2,
            "determinism": {
                "deterministic": False,
                "mode": "warnOnlyMps",
                "reason": "fixture",
            },
        }
        with (
            tempfile.TemporaryDirectory() as temporary_directory,
            patch.object(MODULE, "_import_torch", return_value=fake_torch),
            patch.object(
                MODULE,
                "_select_device",
                return_value=("mps", None),
            ),
            patch.object(
                MODULE,
                "_run_one_optimizer_step",
                return_value=(fake_model, step),
            ),
        ):
            result = MODULE.run_smoke(
                MODULE.SmokeOptions(
                    device="mps",
                    output_directory=Path(temporary_directory),
                    write_checkpoint=False,
                )
            )
            metadata_path = Path(result["metadataFile"])
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))

            self.assertFalse(metadata["trained"])
            self.assertFalse(metadata["publishable"])
            self.assertFalse(metadata["runtimeCompatible"])
            self.assertIsNone(metadata["checkpoint"])
            self.assertFalse(metadata["runtimeManifestCreated"])
            self.assertFalse(metadata["currentPointerCreated"])
            self.assertIn(
                "UNTRAINED_MPS_SMOKE_ONLY",
                metadata_path.name,
            )
            self.assertFalse((metadata_path.parent / "manifest.json").exists())
            self.assertFalse((metadata_path.parent / "current.json").exists())

    def test_default_output_stays_inside_ignored_training_runs(self) -> None:
        relative = MODULE.DEFAULT_OUTPUT_DIRECTORY.relative_to(
            MODULE.PROJECT_ROOT
        )

        self.assertEqual(relative.parts[:2], ("training", "runs"))
        self.assertEqual(relative.name, "mps-smoke")


if __name__ == "__main__":
    unittest.main()
