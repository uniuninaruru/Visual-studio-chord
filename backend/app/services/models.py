"""Allow-listed model metadata for Phase 1."""

from app.schemas.api import ModelInfo, ModelsResponse
from app.services.device import DeviceInfo

LOCAL_MODEL_ID = "local-deterministic-v1"


def get_models(device: DeviceInfo) -> ModelsResponse:
    """Return metadata only; no caller-supplied paths are opened or loaded."""

    return ModelsResponse(
        models=[
            ModelInfo(
                id=LOCAL_MODEL_ID,
                name="Local deterministic linear ranker",
                runtime=device.selected_device,
                available=True,
                loaded=True,
                capabilities=["rank"],
            ),
            ModelInfo(
                id="browser-linear-v1",
                name="Browser linear fallback",
                runtime="browser",
                available=True,
                loaded=False,
                capabilities=["rank"],
            ),
        ],
        active_model=LOCAL_MODEL_ID,
    )

