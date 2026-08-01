"""Strict manifest and safetensors loading without caller-controlled paths."""

from __future__ import annotations

import hashlib
import importlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app import __version__ as APP_VERSION
from app.ml.contracts import MODEL_ID, HarmonyForgeConfig
from app.ml.dataset import DATA_MANIFEST_FILE, load_data_manifest_bytes
from app.ml.tokenizer import TOKENIZER_SHA256

MANIFEST_FILE = "manifest.json"
CHECKPOINT_FILE = "harmonyforge-bimask-base-v1.safetensors"
TRAINING_RUN_FILE = "training-run.json"
TRAINING_RUN_SCHEMA_VERSION = 2
ARTIFACT_POINTER_FILE = "current.json"
ARTIFACT_VERSIONS_DIRECTORY = "versions"

# The only objective the serving path is allowed to present as the product
# model. Harmony-only pre-training produces weights for the same architecture,
# so every structural check — tokenizer, architecture, file hashes — passes on
# them. Nothing but the declared objective distinguishes the two, which is why
# it has to be declarable and why it has to be checked.
INFERENCE_TASK = "melody_conditioned_variable_rhythm_harmonization"
PRETRAINING_TASK = "harmony_only_pretraining"
CheckpointTask = Literal[
    "melody_conditioned_variable_rhythm_harmonization",
    "harmony_only_pretraining",
]


class SupportedPrecisions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cuda: list[Literal["bfloat16", "float16", "float32"]] = Field(min_length=1)
    mps: list[Literal["float16", "float32"]] = Field(min_length=1)
    cpu: list[Literal["bfloat16", "float32"]] = Field(min_length=1)


class HarmonyCheckpointManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = Field(alias="schemaVersion")
    model_id: Literal["harmonyforge-bimask-base-v1"] = Field(alias="modelId")
    task: CheckpointTask
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

    def __init__(
        self,
        message: str,
        *,
        declared_task: CheckpointTask | None = None,
    ) -> None:
        super().__init__(message)
        self.declared_task = declared_task


class CheckpointInvalidError(RuntimeError):
    """An artifact exists but fails an integrity or compatibility gate."""


@dataclass(frozen=True, slots=True)
class ValidatedHarmonyCheckpoint:
    """One immutable in-memory snapshot of every hash-bound artifact input."""

    manifest: HarmonyCheckpointManifest
    artifact_directory: Path
    manifest_sha256: str
    checkpoint_bytes: bytes
    data_manifest: dict[str, Any]
    training_run: dict[str, Any]


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
    return _load_validated_artifact_directory(
        artifact_directory,
        config,
        config_path=config_path,
        allow_research=allow_research,
        permit_pretraining_task=permit_pretraining_task,
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

    return _load_validated_artifact_directory(
        artifact_directory,
        config,
        config_path=config_path,
        allow_research=allow_research,
        permit_pretraining_task=permit_pretraining_task,
    ).manifest


def _load_validated_artifact_directory(
    artifact_directory: Path,
    config: HarmonyForgeConfig,
    *,
    config_path: Path,
    allow_research: bool,
    permit_pretraining_task: bool,
) -> ValidatedHarmonyCheckpoint:
    """Read every mutable path once, then validate and retain that snapshot."""

    manifest_path = artifact_directory / MANIFEST_FILE
    if not manifest_path.is_file():
        raise CheckpointUnavailableError("No trained HarmonyForge checkpoint is installed")
    try:
        manifest_bytes = manifest_path.read_bytes()
        payload = json.loads(manifest_bytes.decode("utf-8"))
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
            f"serve inference; only {INFERENCE_TASK!r} may be loaded",
            declared_task=manifest.task,
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
    try:
        checkpoint_bytes = checkpoint_path.read_bytes()
    except OSError as exc:
        raise CheckpointUnavailableError(
            "HarmonyForge checkpoint file could not be read"
        ) from exc
    if _sha256_bytes(checkpoint_bytes) != manifest.checkpoint_sha256:
        raise CheckpointInvalidError("HarmonyForge checkpoint checksum does not match")
    data_manifest_path = _safe_data_manifest_path(
        artifact_directory,
        manifest.data_manifest_file,
    )
    if not data_manifest_path.is_file():
        raise CheckpointUnavailableError("HarmonyForge data manifest is missing")
    try:
        data_manifest_bytes = data_manifest_path.read_bytes()
    except OSError as exc:
        raise CheckpointUnavailableError(
            "HarmonyForge data manifest could not be read"
        ) from exc
    if _sha256_bytes(data_manifest_bytes) != manifest.data_manifest_sha256:
        raise CheckpointInvalidError(
            "HarmonyForge data manifest checksum does not match"
        )
    training_run_path = _safe_training_run_path(
        artifact_directory,
        manifest.training_run_file,
    )
    if not training_run_path.is_file():
        raise CheckpointUnavailableError("HarmonyForge training run is missing")
    try:
        training_run_bytes = training_run_path.read_bytes()
    except OSError as exc:
        raise CheckpointUnavailableError(
            "HarmonyForge training run could not be read"
        ) from exc
    if _sha256_bytes(training_run_bytes) != manifest.training_run_sha256:
        raise CheckpointInvalidError(
            "HarmonyForge training run checksum does not match"
        )
    try:
        data_contract = load_data_manifest_bytes(data_manifest_bytes)
        training_run = load_training_run_contract_bytes(training_run_bytes)
    except Exception as exc:
        raise CheckpointInvalidError(
            "HarmonyForge artifact provenance contract is invalid"
        ) from exc
    data_task = (
        PRETRAINING_TASK
        if data_contract.get("contentProfile") == "harmonyOnlyV1"
        else INFERENCE_TASK
    )
    if data_task != manifest.task or training_run["task"] != manifest.task:
        raise CheckpointInvalidError(
            "HarmonyForge task disagrees with its data or training provenance"
        )
    if training_run["dataManifestSha256"] != manifest.data_manifest_sha256:
        raise CheckpointInvalidError(
            "HarmonyForge training run binds a different data manifest"
        )
    if training_run["configSha256"] != manifest.architecture_config_sha256:
        raise CheckpointInvalidError(
            "HarmonyForge training run binds a different model config"
        )
    if training_run["sourceCommit"] != manifest.source_commit:
        raise CheckpointInvalidError(
            "HarmonyForge training run source commit does not match"
        )
    if training_run["pytorchVersion"] != manifest.pytorch_version:
        raise CheckpointInvalidError(
            "HarmonyForge training run PyTorch version does not match"
        )
    return ValidatedHarmonyCheckpoint(
        manifest=manifest,
        artifact_directory=artifact_directory.resolve(),
        manifest_sha256=_sha256_bytes(manifest_bytes),
        checkpoint_bytes=checkpoint_bytes,
        data_manifest=data_contract,
        training_run=training_run,
    )


def load_training_run_contract(path: Path) -> dict[str, Any]:
    """Load v2 provenance or normalize one legacy inference-only v1 run."""

    try:
        data = path.read_bytes()
    except OSError as exc:
        raise CheckpointInvalidError("training run could not be read") from exc
    return load_training_run_contract_bytes(data)


def load_training_run_contract_bytes(data: bytes) -> dict[str, Any]:
    """Validate one in-memory training-run snapshot."""

    try:
        payload = json.loads(data.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise CheckpointInvalidError("training run is not valid UTF-8 JSON") from exc
    common = {
        "schemaVersion",
        "deterministic",
        "sourceCommit",
        "configSha256",
        "dataManifestSha256",
        "pytorchVersion",
        "cublasWorkspaceConfig",
        "seed",
        "optimizer",
        "epochs",
        "steps",
        "actualDevice",
        "dtype",
        "fallbackReason",
        "meanTrainingLoss",
        "metrics",
    }
    if not isinstance(payload, dict):
        raise CheckpointInvalidError("training run must be an object")
    schema_version = payload.get("schemaVersion")
    if schema_version == 1:
        if set(payload) != common:
            raise CheckpointInvalidError(
                "legacy training run fields do not match schema v1"
            )
        normalized = {
            **payload,
            "task": INFERENCE_TASK,
            "initialCheckpoint": None,
        }
    elif schema_version == TRAINING_RUN_SCHEMA_VERSION:
        if set(payload) != common | {"task", "initialCheckpoint"}:
            raise CheckpointInvalidError(
                "training run fields do not match schema v2"
            )
        normalized = dict(payload)
        if normalized["task"] not in {INFERENCE_TASK, PRETRAINING_TASK}:
            raise CheckpointInvalidError("training run task is invalid")
        _validate_initial_checkpoint_contract(normalized["initialCheckpoint"])
        initial_checkpoint = normalized["initialCheckpoint"]
        if initial_checkpoint is not None and not is_allowed_task_transition(
            initial_checkpoint["task"],
            normalized["task"],
        ):
            raise CheckpointInvalidError(
                "training run initial checkpoint task transition is invalid"
            )
    else:
        raise CheckpointInvalidError("unsupported training run schema version")

    if not isinstance(normalized["deterministic"], bool):
        raise CheckpointInvalidError("training run deterministic flag is invalid")
    if normalized["deterministic"] is not True:
        # A non-deterministic run is a legitimate local experiment — MPS has no
        # deterministic kernel for embedding backward, so it is the only way to
        # use that GPU at all — but it cannot be reproduced from its recipe.
        # Publishing the manifest instead of the weights depends on a third
        # party recomputing the same hash, so a run that cannot support that
        # claim is confined to pre-training, the same place the task boundary
        # already confines weights that cannot do the serving job.
        if normalized["task"] != PRETRAINING_TASK:
            raise CheckpointInvalidError(
                f"a non-deterministic training run may only produce a "
                f"{PRETRAINING_TASK!r} artifact, not {normalized['task']!r}"
            )
    for field in (
        "sourceCommit",
        "configSha256",
        "dataManifestSha256",
        "pytorchVersion",
        "cublasWorkspaceConfig",
        "seed",
        "actualDevice",
        "dtype",
    ):
        if not isinstance(normalized[field], str) or not normalized[field]:
            raise CheckpointInvalidError(f"training run {field} is invalid")
    if not re.fullmatch(r"[0-9a-f]{7,64}", normalized["sourceCommit"]):
        raise CheckpointInvalidError("training run sourceCommit is invalid")
    for field in ("configSha256", "dataManifestSha256"):
        if not re.fullmatch(r"[0-9a-f]{64}", normalized[field]):
            raise CheckpointInvalidError(f"training run {field} is invalid")
    if not isinstance(normalized["optimizer"], dict):
        raise CheckpointInvalidError("training run optimizer is invalid")
    if not isinstance(normalized["metrics"], dict):
        raise CheckpointInvalidError("training run metrics are invalid")
    if (
        not isinstance(normalized["steps"], int)
        or isinstance(normalized["steps"], bool)
        or normalized["steps"] < 1
    ):
        raise CheckpointInvalidError("training run steps are invalid")
    if (
        not isinstance(normalized["epochs"], int)
        or isinstance(normalized["epochs"], bool)
        or normalized["epochs"] < 1
    ):
        raise CheckpointInvalidError("training run epochs are invalid")
    if (
        not isinstance(normalized["meanTrainingLoss"], (int, float))
        or isinstance(normalized["meanTrainingLoss"], bool)
        or not math.isfinite(normalized["meanTrainingLoss"])
    ):
        raise CheckpointInvalidError("training run mean loss is invalid")
    if normalized["fallbackReason"] is not None and not isinstance(
        normalized["fallbackReason"],
        str,
    ):
        raise CheckpointInvalidError("training run fallback reason is invalid")
    return normalized


def _validate_initial_checkpoint_contract(value: Any) -> None:
    if value is None:
        return
    if not isinstance(value, dict) or set(value) != {
        "modelId",
        "task",
        "manifestSha256",
        "checkpointSha256",
    }:
        raise CheckpointInvalidError("training run initial checkpoint is invalid")
    if value["modelId"] != MODEL_ID:
        raise CheckpointInvalidError("training run initial checkpoint model is invalid")
    if value["task"] not in {INFERENCE_TASK, PRETRAINING_TASK}:
        raise CheckpointInvalidError("training run initial checkpoint task is invalid")
    for field in ("manifestSha256", "checkpointSha256"):
        if not isinstance(value[field], str) or not re.fullmatch(
            r"[0-9a-f]{64}",
            value[field],
        ):
            raise CheckpointInvalidError(
                f"training run initial checkpoint {field} is invalid"
            )


def is_allowed_task_transition(
    source_task: CheckpointTask,
    destination_task: CheckpointTask,
) -> bool:
    return source_task == destination_task or (
        source_task == PRETRAINING_TASK
        and destination_task == INFERENCE_TASK
    )


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

    try:
        safetensors = importlib.import_module("safetensors.torch")
    except Exception as exc:
        raise CheckpointUnavailableError(
            "The safetensors runtime is not installed"
        ) from exc
    try:
        state = safetensors.load(checkpoint.checkpoint_bytes)
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


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


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
