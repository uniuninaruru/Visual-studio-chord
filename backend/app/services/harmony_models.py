"""Independent registry for harmony generation, separate from rankers."""

from __future__ import annotations

from pathlib import Path

from app.ml.backends import MockHarmonyBackend, NeuralHarmonyBackend, TorchHarmonyBackend
from app.ml.checkpoint import CheckpointUnavailableError
from app.ml.contracts import MOCK_MODEL_ID, MODEL_ID
from app.schemas.api import HarmonyModelId


class HarmonyModelManager:
    """Resolve only allowlisted generation models; never accept a file path."""

    def __init__(
        self,
        *,
        model_directory: Path,
        config_path: Path,
        allow_research: bool,
        enable_mock: bool,
    ) -> None:
        self._real = TorchHarmonyBackend(
            model_directory=model_directory,
            config_path=config_path,
            allow_research=allow_research,
        )
        self._mock = MockHarmonyBackend()
        self._enable_mock = enable_mock

    def backend(self, model_id: HarmonyModelId) -> NeuralHarmonyBackend:
        if model_id == MODEL_ID:
            manifest = self._real.manifest()
            if not manifest["available"]:
                raise CheckpointUnavailableError(
                    str(manifest["unavailableReason"])
                )
            return self._real
        if model_id == MOCK_MODEL_ID:
            if not self._enable_mock:
                raise CheckpointUnavailableError(
                    "Mock neural harmony is disabled outside explicit development mode"
                )
            return self._mock
        raise CheckpointUnavailableError("Unknown harmony model")

    def manifest(self, model_id: HarmonyModelId) -> dict[str, object]:
        if model_id == MODEL_ID:
            return self._real.manifest()
        if model_id == MOCK_MODEL_ID:
            manifest = self._mock.manifest()
            if not self._enable_mock:
                return {
                    **manifest,
                    "available": False,
                    "unavailableReason": (
                        "Mock neural harmony is disabled outside explicit development mode"
                    ),
                }
            return manifest
        raise CheckpointUnavailableError("Unknown harmony model")

    def discovery_models(self) -> list[dict[str, object]]:
        real_health = self._real.health()
        mock_health = self._mock.health()
        return [
            {
                **self.manifest(MODEL_ID),
                "loaded": real_health.loaded,
                "runtime": real_health.device,
            },
            {
                **self.manifest(MOCK_MODEL_ID),
                "loaded": mock_health.loaded and self._enable_mock,
                "runtime": mock_health.device if self._enable_mock else None,
            },
        ]
