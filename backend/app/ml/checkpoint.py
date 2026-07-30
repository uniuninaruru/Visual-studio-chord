"""Strict manifest and safetensors loading without caller-controlled paths."""

from __future__ import annotations

import hashlib
import importlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app import __version__ as APP_VERSION
from app.ml.contracts import MODEL_ID, HarmonyForgeConfig
from app.ml.dataset import DATA_MANIFEST_FILE
from app.ml.tokenizer import TOKENIZER_SHA256

MANIFEST_FILE = "manifest.json"
CHECKPOINT_FILE = "harmonyforge-bimask-base-v1.safetensors"
TRAINING_RUN_FILE = "training-run.json"
ARTIFACT_POINTER_FILE = "current.json"
ARTIFACT_VERSIONS_DIRECTORY = "versions"

# The only objective the serving path is allowed to present as the product
# model. Harmony-only pre-training produces weights for the same architecture,
# so every structural check — tokenizer, architecture, file hashes — passes on
# them. Nothing but the declared objective distinguishes the two, which is why
# it has to be declarable and why it has to be checked.
INFERENCE_TASK = "melody_conditioned_variable_rhythm_harmonization"
PRETRAINING_TASK = "harmony_only_pretraining"


class SupportedPrecisions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cuda: list[Literal["bfloat16", "float16", "float32"]] = Field(min_length=1)
    mps: list[Literal["float16", "float32"]] = Field(min_length=1)
    cpu: list[Literal["bfloat16", "float32"]] = Field(min_length=1)


class HarmonyCheckpointManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = Field(alias="schemaVersion")
    model_id: Literal["harmonyforge-bimask-base-v1"] = Field(alias="modelId")
    task: Literal[
        "melody_conditioned_variable_rhythm_harmonization",
        "harmony_only_pretraining",
    ]
    trained: bool
    evaluation_status: Literal["notEvaluated", "researchOnly", "validated"] = Field(
        alias="evaluationStatus",
    )
    architecture: dict[str, int | float | str | bool]
    architecture_config_sha256: str = Field(alias="architectureConfigSha256")
    checkpoint_file: Literal["harmonyforge-bimask-base-v1.safetensors"] = Field(
        alias="checkpointFile",
    )
    checkpoint_sha256: str = Field(
        alias="checkpointSha256",
        pattern=r"^[0-9a-f]{64}$",
    )
    data_manifest_file: Literal["data-manifest.json"] = Field(
        alias="dataManifestFile",
    )
    training_run_file: Literal["training-run.json"] = Field(
        alias="trainingRunFile",
    )
    tokenizer_sha256: str = Field(
        alias="tokenizerSha256",
        pattern=r"^[0-9a-f]{64}$",
    )
    data_manifest_sha256: str = Field(
        alias="dataManifestSha256",
        pattern=r"^[0-9a-f]{64}$",
    )
    training_run_sha256: str = Field(
        alias="trainingRunSha256",
        pattern=r"^[0-9a-f]{64}$",
    )
    source_commit: str = Field(alias="sourceCommit", pattern=r"^[0-9a-f]{7,64}$")
    pytorch_version: str = Field(alias="pytorchVersion", min_length=1, max_length=64)
    minimum_app_version: str = Field(alias="minimumAppVersion", min_length=1, max_length=32)
    minimum_api_version: Literal["2"] = Field(alias="minimumApiVersion")
    supported_precisions: SupportedPrecisions = Field(alias="supportedPrecisions")


class CheckpointUnavailableError(RuntimeError):
    """A trained, compatible artifact is not present."""


class CheckpointInvalidError(RuntimeError):
    """An artifact exists but fails an integrity or compatibility gate."""


@dataclass(frozen=True, slots=True)
class ValidatedHarmonyCheckpoint:
    """A manifest bound to the exact immutable directory that was validated."""

    manifest: HarmonyCheckpointManifest
    artifact_directory: Path


def model_artifact_directory(model_directory: Path) -> Path:
    root = model_directory.resolve() / MODEL_ID
    pointer_path = root / ARTIFACT_POINTER_FILE
    if not pointer_path.is_file():
        return root
    try:
        pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CheckpointInvalidError(
            "HarmonyForge artifact pointer is invalid"
        ) from exc
    if (
        not isinstance(pointer, dict)
        or set(pointer) != {"schemaVersion", "artifactVersion"}
        or pointer["schemaVersion"] != 1
        or not isinstance(pointer["artifactVersion"], str)
        or not re.fullmatch(r"[0-9a-f]{64}", pointer["artifactVersion"])
    ):
        raise CheckpointInvalidError("HarmonyForge artifact pointer is invalid")
    versions = (root / ARTIFACT_VERSIONS_DIRECTORY).resolve()
    artifact = (versions / pointer["artifactVersion"]).resolve()
    if artifact.parent != versions:
        raise CheckpointInvalidError("HarmonyForge artifact pointer escapes its root")
    return artifact


def load_manifest(
    model_directory: Path,
    config: HarmonyForgeConfig,
    *,
    config_path: Path,
    allow_research: bool,
    permit_pretraining_task: bool = False,
) -> HarmonyCheckpointManifest:
    return load_validated_checkpoint(
        model_directory,
        config,
        config_path=config_path,
        allow_research=allow_research,
        permit_pretraining_task=permit_pretraining_task,
    ).manifest


def load_validated_checkpoint(
    model_directory: Path,
    config: HarmonyForgeConfig,
    *,
    config_path: Path,
    allow_research: bool,
    permit_pretraining_task: bool = False,
) -> ValidatedHarmonyCheckpoint:
    """Resolve the active pointer once and bind all later reads to that version."""

    artifact_directory = model_artifact_directory(model_directory)
    manifest = load_manifest_from_artifact_directory(
        artifact_directory,
        config,
        config_path=config_path,
        allow_research=allow_research,
        permit_pretraining_task=permit_pretraining_task,
    )
    return ValidatedHarmonyCheckpoint(
        manifest=manifest,
        artifact_directory=artifact_directory.resolve(),
    )


def load_manifest_from_artifact_directory(
    artifact_directory: Path,
    config: HarmonyForgeConfig,
    *,
    config_path: Path,
    allow_research: bool,
    permit_pretraining_task: bool = False,
) -> HarmonyCheckpointManifest:
    """Validate one direct artifact directory, including staging versions."""

    manifest_path = artifact_directory / MANIFEST_FILE
    if not manifest_path.is_file():
        raise CheckpointUnavailableError("No trained HarmonyForge checkpoint is installed")
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest = HarmonyCheckpointManifest.model_validate(payload)
    except (OSError, UnicodeError, json.JSONDecodeError, ValidationError) as exc:
        raise CheckpointInvalidError("HarmonyForge manifest is invalid") from exc
    # Checked before every other gate, and deliberately not routed through
    # `allow_research`. Release status and training objective are independent:
    # `researchOnly` means "not yet validated at this task", not "trained at
    # some other task". Collapsing them onto one flag would let
    # MTC_ENABLE_RESEARCH_CHECKPOINT admit a model that cannot do the job the
    # interface says it does. No environment variable or setting reaches this
    # argument — only the training and export paths pass it.
    if manifest.task != INFERENCE_TASK and not permit_pretraining_task:
        raise CheckpointUnavailableError(
            f"HarmonyForge artifact declares task {manifest.task!r}, which cannot "
            f"serve inference; only {INFERENCE_TASK!r} may be loaded"
        )
    if not manifest.trained:
        raise CheckpointUnavailableError("HarmonyForge artifact is explicitly untrained")
    if manifest.evaluation_status == "notEvaluated":
        raise CheckpointUnavailableError("HarmonyForge artifact has not been evaluated")
    if manifest.evaluation_status == "researchOnly" and not allow_research:
        raise CheckpointUnavailableError(
            "HarmonyForge research checkpoint requires explicit research mode"
        )
    if manifest.tokenizer_sha256 != TOKENIZER_SHA256:
        raise CheckpointInvalidError("HarmonyForge tokenizer checksum does not match")
    if manifest.architecture != config.architecture_dict():
        raise CheckpointInvalidError("HarmonyForge architecture does not match the config")
    if _semantic_version(APP_VERSION) < _semantic_version(
        manifest.minimum_app_version
    ):
        raise CheckpointUnavailableError(
            "HarmonyForge requires a newer application version"
        )
    if _sha256(config_path) != manifest.architecture_config_sha256:
        raise CheckpointInvalidError("HarmonyForge config checksum does not match")
    checkpoint_path = _safe_checkpoint_path(artifact_directory, manifest.checkpoint_file)
    if not checkpoint_path.is_file():
        raise CheckpointUnavailableError("HarmonyForge checkpoint file is missing")
    if _sha256(checkpoint_path) != manifest.checkpoint_sha256:
        raise CheckpointInvalidError("HarmonyForge checkpoint checksum does not match")
    data_manifest_path = _safe_data_manifest_path(
        artifact_directory,
        manifest.data_manifest_file,
    )
    if not data_manifest_path.is_file():
        raise CheckpointUnavailableError("HarmonyForge data manifest is missing")
    if _sha256(data_manifest_path) != manifest.data_manifest_sha256:
        raise CheckpointInvalidError(
            "HarmonyForge data manifest checksum does not match"
        )
    training_run_path = _safe_training_run_path(
        artifact_directory,
        manifest.training_run_file,
    )
    if not training_run_path.is_file():
        raise CheckpointUnavailableError("HarmonyForge training run is missing")
    if _sha256(training_run_path) != manifest.training_run_sha256:
        raise CheckpointInvalidError(
            "HarmonyForge training run checksum does not match"
        )
    return manifest


def validate_pytorch_compatibility(
    manifest: HarmonyCheckpointManifest,
    runtime_version: str,
) -> None:
    """Require the checkpoint's declared PyTorch major/minor ABI family."""

    trained = _semantic_version(manifest.pytorch_version)
    runtime = _semantic_version(runtime_version)
    if trained[:2] != runtime[:2]:
        raise CheckpointUnavailableError(
            "HarmonyForge PyTorch major/minor version does not match the runtime"
        )


def load_weights(
    model: object,
    checkpoint: ValidatedHarmonyCheckpoint,
    *,
    device: str,
) -> None:
    """Load on CPU from safetensors, validate strictly, then move once."""

    manifest = checkpoint.manifest
    checkpoint_path = _safe_checkpoint_path(
        checkpoint.artifact_directory,
        manifest.checkpoint_file,
    )
    try:
        safetensors = importlib.import_module("safetensors.torch")
    except Exception as exc:
        raise CheckpointUnavailableError(
            "The safetensors runtime is not installed"
        ) from exc
    try:
        state = safetensors.load_file(str(checkpoint_path), device="cpu")
        model.load_state_dict(state, strict=True)  # type: ignore[attr-defined]
        model.to(device)  # type: ignore[attr-defined]
        model.eval()  # type: ignore[attr-defined]
    except CheckpointInvalidError:
        raise
    except Exception as exc:
        raise CheckpointInvalidError(
            "HarmonyForge checkpoint tensors are incompatible"
        ) from exc


def _safe_checkpoint_path(directory: Path, file_name: str) -> Path:
    if file_name != CHECKPOINT_FILE:
        raise CheckpointInvalidError("HarmonyForge checkpoint filename is not allowlisted")
    resolved_directory = directory.resolve()
    resolved_path = (resolved_directory / file_name).resolve()
    if resolved_path.parent != resolved_directory:
        raise CheckpointInvalidError("HarmonyForge checkpoint path is invalid")
    return resolved_path


def _safe_data_manifest_path(directory: Path, file_name: str) -> Path:
    if file_name != DATA_MANIFEST_FILE:
        raise CheckpointInvalidError(
            "HarmonyForge data manifest filename is not allowlisted"
        )
    resolved_directory = directory.resolve()
    resolved_path = (resolved_directory / file_name).resolve()
    if resolved_path.parent != resolved_directory:
        raise CheckpointInvalidError("HarmonyForge data manifest path is invalid")
    return resolved_path


def _safe_training_run_path(directory: Path, file_name: str) -> Path:
    if file_name != TRAINING_RUN_FILE:
        raise CheckpointInvalidError(
            "HarmonyForge training run filename is not allowlisted"
        )
    resolved_directory = directory.resolve()
    resolved_path = (resolved_directory / file_name).resolve()
    if resolved_path.parent != resolved_directory:
        raise CheckpointInvalidError("HarmonyForge training run path is invalid")
    return resolved_path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise CheckpointInvalidError("HarmonyForge artifact could not be read") from exc
    return digest.hexdigest()


def _semantic_version(value: str) -> tuple[int, int, int]:
    normalized = value.split("+", 1)[0].split("-", 1)[0]
    pieces = normalized.split(".")
    if len(pieces) < 2:
        raise CheckpointInvalidError("HarmonyForge manifest has an invalid version")
    try:
        parsed = tuple(int(piece) for piece in pieces[:3])
    except ValueError as exc:
        raise CheckpointInvalidError(
            "HarmonyForge manifest has an invalid version"
        ) from exc
    return (
        parsed[0],
        parsed[1],
        parsed[2] if len(parsed) > 2 else 0,
    )
