"""Atomic safetensors and strict checkpoint-manifest export."""

from __future__ import annotations

import hashlib
import importlib
import json
import math
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any, Literal

from app import __version__ as APP_VERSION
from app.ml.checkpoint import (
    ARTIFACT_POINTER_FILE,
    ARTIFACT_VERSIONS_DIRECTORY,
    CHECKPOINT_FILE,
    MANIFEST_FILE,
    TRAINING_RUN_FILE,
    HarmonyCheckpointManifest,
    SupportedPrecisions,
    load_manifest_from_artifact_directory,
)
from app.ml.contracts import MODEL_ID, HarmonyForgeConfig
from app.ml.dataset import DATA_MANIFEST_FILE, load_data_manifest
from app.ml.tokenizer import TOKENIZER_SHA256

EvaluationStatus = Literal["researchOnly"]


class ArtifactExportError(RuntimeError):
    """A trained artifact could not be serialized with complete provenance."""


def save_trained_artifact(
    model: Any,
    model_directory: Path,
    *,
    config: HarmonyForgeConfig,
    config_path: Path,
    data_manifest_path: Path,
    training_run_path: Path,
    source_commit: str,
    pytorch_version: str,
    evaluation_status: EvaluationStatus = "researchOnly",
    minimum_app_version: str = APP_VERSION,
    minimum_api_version: str = "2",
    supported_precisions: dict[str, list[str]] | None = None,
) -> HarmonyCheckpointManifest:
    """Stage a complete immutable version, validate it, then switch a pointer."""

    _validate_export_provenance(
        config=config,
        config_path=config_path,
        data_manifest_path=data_manifest_path,
        training_run_path=training_run_path,
        source_commit=source_commit,
        pytorch_version=pytorch_version,
        evaluation_status=evaluation_status,
        minimum_app_version=minimum_app_version,
        minimum_api_version=minimum_api_version,
        supported_precisions=supported_precisions,
    )
    try:
        safetensors = importlib.import_module("safetensors.torch")
    except Exception as exc:
        raise ArtifactExportError(
            "safetensors is required to export a trained checkpoint"
        ) from exc
    try:
        state = {
            name: tensor.detach().cpu().contiguous()
            for name, tensor in model.state_dict().items()
        }
    except Exception as exc:
        raise ArtifactExportError("model state_dict could not be materialized") from exc
    if not state:
        raise ArtifactExportError("refusing to export an empty model state")

    artifact_root = model_directory.resolve() / MODEL_ID
    versions_directory = artifact_root / ARTIFACT_VERSIONS_DIRECTORY
    versions_directory.mkdir(parents=True, exist_ok=True)
    staging_directory = Path(
        tempfile.mkdtemp(
            prefix=".stage-",
            dir=versions_directory,
        )
    )
    checkpoint_path = staging_directory / CHECKPOINT_FILE
    try:
        safetensors.save_file(state, str(checkpoint_path))
        validate_safetensors_file(checkpoint_path)
        manifest = publish_checkpoint_manifest(
            staging_directory,
            config=config,
            config_path=config_path,
            data_manifest_path=data_manifest_path,
            training_run_path=training_run_path,
            source_commit=source_commit,
            pytorch_version=pytorch_version,
            evaluation_status=evaluation_status,
            minimum_app_version=minimum_app_version,
            minimum_api_version=minimum_api_version,
            supported_precisions=supported_precisions,
        )
        validated = load_manifest_from_artifact_directory(
            staging_directory,
            config,
            config_path=config_path,
            allow_research=True,
        )
        if validated.checkpoint_sha256 != manifest.checkpoint_sha256:
            raise ArtifactExportError(
                "staged artifact validation returned inconsistent provenance"
            )
        version_id = _sha256_file(staging_directory / MANIFEST_FILE)
        version_directory = versions_directory / version_id
        if version_directory.exists():
            existing = load_manifest_from_artifact_directory(
                version_directory,
                config,
                config_path=config_path,
                allow_research=True,
            )
            if existing != validated:
                raise ArtifactExportError(
                    "artifact version id collides with different provenance"
                )
            shutil.rmtree(staging_directory)
        else:
            staging_directory.replace(version_directory)
        pointer_payload = {
            "schemaVersion": 1,
            "artifactVersion": version_id,
        }
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=".current-",
            suffix=".tmp",
            dir=artifact_root,
        )
        temporary_pointer = Path(temporary_name)
        try:
            with open(descriptor, "wb", closefd=True) as handle:
                handle.write(_canonical_json_bytes(pointer_payload))
                handle.flush()
                os.fsync(handle.fileno())
            temporary_pointer.replace(artifact_root / ARTIFACT_POINTER_FILE)
        finally:
            temporary_pointer.unlink(missing_ok=True)
        return validated
    except Exception as exc:
        if staging_directory.exists():
            shutil.rmtree(staging_directory, ignore_errors=True)
        if isinstance(exc, ArtifactExportError):
            raise
        raise ArtifactExportError("atomic safetensors artifact export failed") from exc


def publish_checkpoint_manifest(
    artifact_directory: Path,
    *,
    config: HarmonyForgeConfig,
    config_path: Path,
    data_manifest_path: Path,
    training_run_path: Path,
    source_commit: str,
    pytorch_version: str,
    evaluation_status: EvaluationStatus = "researchOnly",
    minimum_app_version: str = APP_VERSION,
    minimum_api_version: str = "2",
    supported_precisions: dict[str, list[str]] | None = None,
) -> HarmonyCheckpointManifest:
    """Validate existing safetensors and atomically publish strict provenance."""

    precisions = _validate_export_provenance(
        config=config,
        config_path=config_path,
        data_manifest_path=data_manifest_path,
        training_run_path=training_run_path,
        source_commit=source_commit,
        pytorch_version=pytorch_version,
        evaluation_status=evaluation_status,
        minimum_app_version=minimum_app_version,
        minimum_api_version=minimum_api_version,
        supported_precisions=supported_precisions,
    )

    resolved_directory = artifact_directory.resolve()
    checkpoint_path = (resolved_directory / CHECKPOINT_FILE).resolve()
    if checkpoint_path.parent != resolved_directory or not checkpoint_path.is_file():
        raise ArtifactExportError("allowlisted checkpoint file is missing")
    validate_safetensors_file(checkpoint_path)
    data_manifest_bytes = data_manifest_path.read_bytes()
    target_data_manifest = resolved_directory / DATA_MANIFEST_FILE
    temporary_data_manifest = resolved_directory / f".{DATA_MANIFEST_FILE}.tmp"
    temporary_data_manifest.write_bytes(data_manifest_bytes)
    temporary_data_manifest.replace(target_data_manifest)
    training_run_bytes = training_run_path.read_bytes()
    target_training_run = resolved_directory / TRAINING_RUN_FILE
    temporary_training_run = resolved_directory / f".{TRAINING_RUN_FILE}.tmp"
    temporary_training_run.write_bytes(training_run_bytes)
    temporary_training_run.replace(target_training_run)

    payload = {
        "schemaVersion": 1,
        "modelId": config.model_id,
        "task": "melody_conditioned_variable_rhythm_harmonization",
        "trained": True,
        "evaluationStatus": evaluation_status,
        "architecture": config.architecture_dict(),
        "architectureConfigSha256": _sha256_file(config_path),
        "checkpointFile": CHECKPOINT_FILE,
        "checkpointSha256": _sha256_file(checkpoint_path),
        "dataManifestFile": DATA_MANIFEST_FILE,
        "trainingRunFile": TRAINING_RUN_FILE,
        "tokenizerSha256": TOKENIZER_SHA256,
        "dataManifestSha256": _sha256_file(target_data_manifest),
        "trainingRunSha256": _sha256_file(target_training_run),
        "sourceCommit": source_commit,
        "pytorchVersion": pytorch_version,
        "minimumAppVersion": minimum_app_version,
        "minimumApiVersion": minimum_api_version,
        "supportedPrecisions": precisions.model_dump(),
    }
    try:
        manifest = HarmonyCheckpointManifest.model_validate(payload)
    except Exception as exc:
        raise ArtifactExportError("checkpoint manifest contract is invalid") from exc

    manifest_path = resolved_directory / MANIFEST_FILE
    temporary_manifest = resolved_directory / f".{MANIFEST_FILE}.tmp"
    temporary_manifest.write_bytes(_canonical_json_bytes(payload))
    temporary_manifest.replace(manifest_path)
    return manifest


def _validate_export_provenance(
    *,
    config: HarmonyForgeConfig,
    config_path: Path,
    data_manifest_path: Path,
    training_run_path: Path,
    source_commit: str,
    pytorch_version: str,
    evaluation_status: EvaluationStatus,
    minimum_app_version: str,
    minimum_api_version: str,
    supported_precisions: dict[str, list[str]] | None,
) -> SupportedPrecisions:
    config.validate()
    if not re.fullmatch(r"[0-9a-f]{7,64}", source_commit):
        raise ArtifactExportError("source_commit must be a 7-64 digit lowercase hex id")
    if evaluation_status != "researchOnly":
        raise ArtifactExportError(
            "the reference writer cannot promote a checkpoint to validated"
        )
    if minimum_api_version != "2":
        raise ArtifactExportError("HarmonyForge v1 requires API version 2")
    if not re.fullmatch(r"\d+\.\d+(?:\.\d+)?(?:[+-][A-Za-z0-9.]+)?", pytorch_version):
        raise ArtifactExportError("pytorch_version is invalid")
    if not re.fullmatch(r"\d+\.\d+(?:\.\d+)?", minimum_app_version):
        raise ArtifactExportError("minimum_app_version is invalid")
    if not config_path.is_file():
        raise ArtifactExportError("model config file is missing")
    try:
        load_data_manifest(data_manifest_path)
    except Exception as exc:
        raise ArtifactExportError("compiled data manifest is invalid") from exc
    training_run = _load_training_run(training_run_path)
    expected_config_sha256 = _sha256_file(config_path)
    expected_data_sha256 = _sha256_file(data_manifest_path)
    if training_run["sourceCommit"] != source_commit:
        raise ArtifactExportError("training run source commit does not match export")
    if training_run["configSha256"] != expected_config_sha256:
        raise ArtifactExportError("training run model config hash does not match")
    if training_run["dataManifestSha256"] != expected_data_sha256:
        raise ArtifactExportError("training run data manifest hash does not match")
    if training_run["pytorchVersion"] != pytorch_version:
        raise ArtifactExportError("training run PyTorch version does not match")
    precision_payload = supported_precisions or {
        "cuda": ["bfloat16", "float16", "float32"],
        "mps": ["float32"],
        "cpu": ["float32"],
    }
    try:
        return SupportedPrecisions.model_validate(precision_payload)
    except Exception as exc:
        raise ArtifactExportError("supported precision contract is invalid") from exc


def validate_safetensors_file(path: Path) -> None:
    """Validate safetensors framing without importing torch or pickle."""

    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise ArtifactExportError("checkpoint could not be read") from exc
    if len(payload) < 9:
        raise ArtifactExportError("checkpoint is not a safetensors file")
    header_length = int.from_bytes(payload[:8], "little")
    if header_length < 2 or header_length > 100 * 1024 * 1024:
        raise ArtifactExportError("safetensors header length is invalid")
    data_start = 8 + header_length
    if data_start > len(payload):
        raise ArtifactExportError("safetensors header is truncated")
    try:
        header = json.loads(payload[8:data_start].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ArtifactExportError("safetensors header is invalid") from exc
    if not isinstance(header, dict):
        raise ArtifactExportError("safetensors header must be an object")
    tensors = [
        descriptor
        for name, descriptor in header.items()
        if name != "__metadata__"
    ]
    if not tensors:
        raise ArtifactExportError("safetensors checkpoint contains no tensors")
    ranges: list[tuple[int, int]] = []
    for descriptor in tensors:
        if not isinstance(descriptor, dict):
            raise ArtifactExportError("safetensors tensor descriptor is invalid")
        if (
            not isinstance(descriptor.get("dtype"), str)
            or not isinstance(descriptor.get("shape"), list)
            or any(
                not isinstance(dimension, int) or dimension < 0
                for dimension in descriptor["shape"]
            )
        ):
            raise ArtifactExportError("safetensors tensor shape is invalid")
        offsets = descriptor.get("data_offsets")
        if (
            not isinstance(offsets, list)
            or len(offsets) != 2
            or any(not isinstance(offset, int) for offset in offsets)
            or offsets[0] < 0
            or offsets[1] < offsets[0]
            or data_start + offsets[1] > len(payload)
        ):
            raise ArtifactExportError("safetensors data offsets are invalid")
        ranges.append((offsets[0], offsets[1]))
    ordered = sorted(ranges)
    for previous, current in zip(ordered, ordered[1:], strict=False):
        if previous[1] > current[0]:
            raise ArtifactExportError("safetensors tensor ranges overlap")
    if max(end for _, end in ordered) != len(payload) - data_start:
        raise ArtifactExportError("safetensors data section length is inconsistent")


def _load_training_run(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ArtifactExportError("training run is not valid UTF-8 JSON") from exc
    required = {
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
    if not isinstance(payload, dict) or set(payload) != required:
        raise ArtifactExportError("training run fields do not match schema v1")
    if payload["schemaVersion"] != 1 or payload["deterministic"] is not True:
        raise ArtifactExportError("training run must be deterministic schema v1")
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
        if not isinstance(payload[field], str) or not payload[field]:
            raise ArtifactExportError(f"training run {field} is invalid")
    if not isinstance(payload["optimizer"], dict):
        raise ArtifactExportError("training run optimizer is invalid")
    if not isinstance(payload["metrics"], dict):
        raise ArtifactExportError("training run metrics are invalid")
    if not isinstance(payload["steps"], int) or payload["steps"] < 1:
        raise ArtifactExportError("training run steps are invalid")
    if (
        not isinstance(payload["epochs"], int)
        or isinstance(payload["epochs"], bool)
        or payload["epochs"] < 1
    ):
        raise ArtifactExportError("training run epochs are invalid")
    if (
        not isinstance(payload["meanTrainingLoss"], (int, float))
        or isinstance(payload["meanTrainingLoss"], bool)
        or not math.isfinite(payload["meanTrainingLoss"])
    ):
        raise ArtifactExportError("training run mean loss is invalid")
    if payload["fallbackReason"] is not None and not isinstance(
        payload["fallbackReason"],
        str,
    ):
        raise ArtifactExportError("training run fallback reason is invalid")
    return payload


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise ArtifactExportError("artifact could not be hashed") from exc
    return digest.hexdigest()


def _canonical_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    ).encode()
