from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


def load_probe_module():
    script = Path(__file__).resolve().parents[1] / "verify_acceleration.py"
    spec = importlib.util.spec_from_file_location("verify_acceleration", script)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load verify_acceleration.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


probe = load_probe_module()


class FakeArray:
    shape = (1, 1)


class FakeFinite:
    def all(self) -> bool:
        return True


class FakeNumpy:
    float32 = "float32"

    @staticmethod
    def zeros(shape, dtype):
        return {"shape": shape, "dtype": dtype}

    @staticmethod
    def isfinite(value):
        return FakeFinite()


def fake_onnxruntime(providers: list[str], failing: set[str] | None = None):
    failures = failing or set()

    class Session:
        def __init__(self, model_bytes, providers):
            self.providers = providers
            if providers[0] in failures:
                raise RuntimeError("provider initialization failed")

        def get_providers(self):
            return self.providers

        def run(self, output_names, inputs):
            return [FakeArray()]

    return SimpleNamespace(
        get_available_providers=lambda: providers,
        InferenceSession=Session,
    )


class AccelerationProbeTests(unittest.TestCase):
    def test_onnx_provider_requires_real_session_run(self) -> None:
        runtime = fake_onnxruntime(
            ["CUDAExecutionProvider", "CPUExecutionProvider"],
            failing={"CUDAExecutionProvider"},
        )
        with (
            patch.dict(sys.modules, {"onnxruntime": runtime, "numpy": FakeNumpy()}),
            patch.object(probe, "_load_builtin_onnx_model", return_value=b"model"),
        ):
            result = probe._probe_onnx_runtime()

        self.assertEqual(result["providers"], ["CUDAExecutionProvider", "CPUExecutionProvider"])
        self.assertEqual(result["verifiedProviders"], ["CPUExecutionProvider"])
        self.assertEqual(result["providerErrors"]["CUDAExecutionProvider"], "RuntimeError")

    def test_runtime_priority_matches_backend(self) -> None:
        torch_info = {"installed": True, "cuda": True, "mps": True}
        ort_info = {
            "providers": ["CUDAExecutionProvider"],
            "verifiedProviders": ["CUDAExecutionProvider", "CoreMLExecutionProvider"],
        }
        self.assertEqual(probe._select_runtime(torch_info, ort_info), "onnx-cuda")

        ort_info["verifiedProviders"] = []
        self.assertEqual(probe._select_runtime(torch_info, ort_info), "pytorch-cuda")
        torch_info["cuda"] = False
        self.assertEqual(probe._select_runtime(torch_info, ort_info), "pytorch-mps")

    def test_unverified_provider_is_never_reported_as_gpu(self) -> None:
        torch_info = {"installed": False, "cuda": False, "mps": False}
        ort_info = {
            "providers": ["CUDAExecutionProvider", "CPUExecutionProvider"],
            "verifiedProviders": ["CPUExecutionProvider"],
        }
        self.assertEqual(probe._select_runtime(torch_info, ort_info), "onnx-cpu")


if __name__ == "__main__":
    unittest.main()
