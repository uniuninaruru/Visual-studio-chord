"""Lazy-PyTorch reference training and evaluation for HarmonyForge."""

from __future__ import annotations

import hashlib
import importlib
import json
import os
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from app.ml.artifacts import save_trained_artifact
from app.ml.checkpoint import (
    load_validated_checkpoint,
    load_weights,
    validate_pytorch_compatibility,
)
from app.ml.contracts import (
    EVENT_VOCABULARY,
    EXTENSION_VOCABULARY,
    MODE_VOCABULARY,
    QUALITY_VOCABULARY,
    ROLE_VOCABULARY,
    HarmonyForgeConfig,
    load_model_config,
)
from app.ml.dataset import iter_compiled_split, load_data_manifest
from app.ml.masking import MaskPlan, curriculum_mask
from app.ml.model import build_harmony_forge_model
from app.ml.tokenizer import GENERATE_ID, MASK_ID, PRESERVE_ID

DeviceChoice = Literal["auto", "cpu", "cuda", "mps"]
DatasetSplit = Literal["train", "validation", "test"]


class TrainingRuntimeError(RuntimeError):
    """Training cannot proceed without a valid dataset or optional runtime."""


@dataclass(frozen=True, slots=True)
class TrainOptions:
    epochs: int = 1
    batch_size: int = 1
    learning_rate: float = 3e-4
    weight_decay: float = 0.01
    gradient_clipping_norm: float = 1.0
    seed: str = "1729"
    device: DeviceChoice = "auto"
    max_steps: int | None = None

    def validate(self) -> None:
        if self.epochs < 1:
            raise TrainingRuntimeError("epochs must be at least one")
        if self.batch_size < 1 or self.batch_size > 1024:
            raise TrainingRuntimeError("batch_size is outside the supported range")
        if not 0 < self.learning_rate <= 1:
            raise TrainingRuntimeError("learning_rate must be in (0, 1]")
        if not 0 <= self.weight_decay <= 1:
            raise TrainingRuntimeError("weight_decay must be in [0, 1]")
        if self.gradient_clipping_norm <= 0:
            raise TrainingRuntimeError("gradient_clipping_norm must be positive")
        if not self.seed or len(self.seed) > 128:
            raise TrainingRuntimeError("seed must contain 1 to 128 characters")
        if self.device not in {"auto", "cpu", "cuda", "mps"}:
            raise TrainingRuntimeError("unsupported training device")
        if self.max_steps is not None and self.max_steps < 1:
            raise TrainingRuntimeError("max_steps must be positive")


def train_reference_model(
    *,
    config_path: Path,
    data_manifest_path: Path,
    model_directory: Path,
    source_commit: str,
    options: TrainOptions,
) -> dict[str, Any]:
    """Run deterministic reference training and export a research checkpoint."""

    options.validate()
    if not re.fullmatch(r"[0-9a-f]{7,64}", source_commit):
        raise TrainingRuntimeError(
            "source_commit must be a 7-64 digit lowercase hex id"
        )
    config = load_model_config(config_path)
    load_data_manifest(data_manifest_path)
    train_rows = list(iter_compiled_split(data_manifest_path, "train"))
    validation_rows = list(iter_compiled_split(data_manifest_path, "validation"))
    if not train_rows:
        raise TrainingRuntimeError("compiled training split is empty")
    if not validation_rows:
        raise TrainingRuntimeError(
            "compiled validation split is empty; research export is blocked"
        )
    validate_compiled_rows(train_rows, config)
    validate_compiled_rows(validation_rows, config)

    cublas_workspace_config = prepare_deterministic_environment()
    torch = _import_torch()
    device, device_fallback = _select_device(torch, options.device)
    _configure_determinism(torch, options.seed)
    model = build_harmony_forge_model(config, torch_module=torch).to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=options.learning_rate,
        weight_decay=options.weight_decay,
    )

    step = 0
    loss_sum = 0.0
    model.train()
    for epoch in range(options.epochs):
        ordered = _deterministic_order(
            train_rows,
            seed=options.seed,
            epoch=epoch,
        )
        for rows in _batches(ordered, options.batch_size):
            plans = [
                curriculum_mask(
                    row["inputs"]["barIndex"],
                    seed=options.seed,
                    epoch=epoch,
                    example_id=row["windowId"],
                )
                for row in rows
            ]
            batch = build_masked_batch(
                rows,
                plans,
                torch_module=torch,
                device=device,
            )
            optimizer.zero_grad(set_to_none=True)
            outputs = model(batch)
            loss, _ = factorized_active_head_loss(
                outputs,
                batch,
                torch_module=torch,
            )
            if not bool(torch.isfinite(loss)):
                raise TrainingRuntimeError("training loss became non-finite")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(
                model.parameters(),
                options.gradient_clipping_norm,
            )
            optimizer.step()
            step += 1
            loss_sum += float(loss.detach().cpu())
            if options.max_steps is not None and step >= options.max_steps:
                break
        if options.max_steps is not None and step >= options.max_steps:
            break

    if step == 0:
        raise TrainingRuntimeError("training completed without an optimizer step")
    evaluation = evaluate_model_rows(
        model,
        validation_rows,
        torch_module=torch,
        device=device,
        batch_size=options.batch_size,
    )
    artifact_directory = model_directory.resolve() / config.model_id
    artifact_directory.mkdir(parents=True, exist_ok=True)
    evaluation_payload = {
        "schemaVersion": 1,
        "split": "validation",
        "dataManifestSha256": _sha256_file(data_manifest_path),
        "checkpointStatus": "preExportValidation",
        "metrics": evaluation,
    }
    _atomic_json_write(
        artifact_directory / "evaluation.json",
        evaluation_payload,
    )
    training_run_path = artifact_directory / "training-run.json"
    training_run = {
        "schemaVersion": 1,
        "deterministic": True,
        "sourceCommit": source_commit,
        "configSha256": _sha256_file(config_path),
        "dataManifestSha256": _sha256_file(data_manifest_path),
        "pytorchVersion": str(torch.__version__),
        "cublasWorkspaceConfig": cublas_workspace_config,
        "seed": options.seed,
        "optimizer": {
            "name": "AdamW",
            "learningRate": options.learning_rate,
            "weightDecay": options.weight_decay,
            "gradientClippingNorm": options.gradient_clipping_norm,
            "batchSize": options.batch_size,
            "maximumSteps": options.max_steps,
        },
        "epochs": options.epochs,
        "steps": step,
        "actualDevice": device,
        "dtype": "float32",
        "fallbackReason": device_fallback,
        "meanTrainingLoss": loss_sum / step,
        "metrics": evaluation,
    }
    _atomic_json_write(training_run_path, training_run)
    manifest = save_trained_artifact(
        model,
        model_directory,
        config=config,
        config_path=config_path,
        data_manifest_path=data_manifest_path,
        training_run_path=training_run_path,
        source_commit=source_commit,
        pytorch_version=str(torch.__version__),
        evaluation_status="researchOnly",
    )
    return {
        "modelId": config.model_id,
        "trained": True,
        "evaluationStatus": manifest.evaluation_status,
        "device": device,
        "fallbackReason": device_fallback,
        "steps": step,
        "epochs": options.epochs,
        "meanTrainingLoss": loss_sum / step,
        "validation": evaluation,
        "checkpointSha256": manifest.checkpoint_sha256,
        "dataManifestSha256": manifest.data_manifest_sha256,
        "artifactDirectory": str(artifact_directory),
    }


def evaluate_checkpoint(
    *,
    config_path: Path,
    data_manifest_path: Path,
    model_directory: Path,
    split: DatasetSplit,
    device_choice: DeviceChoice = "auto",
    batch_size: int = 1,
) -> dict[str, Any]:
    """Strictly load one exported checkpoint and evaluate a declared split."""

    if split not in {"train", "validation", "test"}:
        raise TrainingRuntimeError("unsupported evaluation split")
    if batch_size < 1:
        raise TrainingRuntimeError("batch_size must be positive")
    config = load_model_config(config_path)
    load_data_manifest(data_manifest_path)
    rows = list(iter_compiled_split(data_manifest_path, split))
    if not rows:
        raise TrainingRuntimeError(f"compiled {split} split is empty")
    validate_compiled_rows(rows, config)
    checkpoint = load_validated_checkpoint(
        model_directory,
        config,
        config_path=config_path,
        allow_research=True,
    )
    manifest = checkpoint.manifest
    if manifest.data_manifest_sha256 != _sha256_file(data_manifest_path):
        raise TrainingRuntimeError(
            "evaluation dataset differs from checkpoint data provenance"
        )
    torch = _import_torch()
    validate_pytorch_compatibility(manifest, str(torch.__version__))
    device, device_fallback = _select_device(torch, device_choice)
    model = build_harmony_forge_model(config, torch_module=torch)
    load_weights(model, checkpoint, device=device)
    metrics = evaluate_model_rows(
        model,
        rows,
        torch_module=torch,
        device=device,
        batch_size=batch_size,
    )
    return {
        "schemaVersion": 1,
        "modelId": config.model_id,
        "split": split,
        "device": device,
        "fallbackReason": device_fallback,
        "checkpointSha256": manifest.checkpoint_sha256,
        "dataManifestSha256": manifest.data_manifest_sha256,
        "metrics": metrics,
    }


def build_masked_batch(
    rows: Sequence[dict[str, Any]],
    plans: Sequence[MaskPlan],
    *,
    torch_module: Any,
    device: str,
) -> dict[str, Any]:
    """Collate variable windows and apply an explicit masked-harmony plan."""

    if not rows or len(rows) != len(plans):
        raise TrainingRuntimeError("rows and mask plans must be non-empty and aligned")
    torch = torch_module
    maximum = max(row["frameCount"] for row in rows)
    values: dict[str, list[list[Any]]] = {
        "melody_midi": [],
        "melody_role": [],
        "metrical_slot": [],
        "bar_index": [],
        "key_root": [],
        "mode": [],
        "harmony_event": [],
        "harmony_root": [],
        "harmony_quality": [],
        "harmony_inversion": [],
        "harmony_bass": [],
        "harmony_extensions": [],
        "edit_mask": [],
        "padding_mask": [],
        "target_event": [],
        "target_root": [],
        "target_quality": [],
        "target_inversion": [],
        "target_bass": [],
        "target_extensions": [],
    }
    for row, plan in zip(rows, plans, strict=True):
        frame_count = row["frameCount"]
        if len(plan.masked) != frame_count:
            raise TrainingRuntimeError("mask plan length does not match the window")
        padding = maximum - frame_count
        inputs = row["inputs"]
        targets = row["targets"]
        last_bar = inputs["barIndex"][-1]
        values["melody_midi"].append(inputs["melodyMidi"] + [128] * padding)
        values["melody_role"].append(
            inputs["melodyRole"] + [ROLE_VOCABULARY.index("unknown")] * padding
        )
        values["metrical_slot"].append(inputs["metricalSlot"] + [0] * padding)
        values["bar_index"].append(inputs["barIndex"] + [last_bar] * padding)
        values["key_root"].append(inputs["keyRoot"] + [0] * padding)
        values["mode"].append(inputs["mode"] + [0] * padding)

        event_inputs: list[int] = []
        root_inputs: list[int] = []
        quality_inputs: list[int] = []
        inversion_inputs: list[int] = []
        bass_inputs: list[int] = []
        extension_inputs: list[list[int]] = []
        edit_masks: list[int] = []
        for index, masked in enumerate(plan.masked):
            event = targets["event"][index]
            if masked:
                event_inputs.append(MASK_ID)
                root_inputs.append(MASK_ID)
                quality_inputs.append(MASK_ID)
                inversion_inputs.append(MASK_ID)
                bass_inputs.append(MASK_ID)
                extension_inputs.append([0] * len(EXTENSION_VOCABULARY))
                edit_masks.append(GENERATE_ID)
                continue
            event_inputs.append(event + 1)
            root_inputs.append(_factor_input_id(targets["root"][index]))
            quality_inputs.append(_factor_input_id(targets["quality"][index]))
            inversion_inputs.append(_factor_input_id(targets["inversion"][index]))
            bass_inputs.append(_factor_input_id(targets["bass"][index]))
            extension_inputs.append(targets["extensions"][index])
            edit_masks.append(PRESERVE_ID)
        values["harmony_event"].append(event_inputs + [MASK_ID] * padding)
        values["harmony_root"].append(root_inputs + [MASK_ID] * padding)
        values["harmony_quality"].append(quality_inputs + [MASK_ID] * padding)
        values["harmony_inversion"].append(inversion_inputs + [MASK_ID] * padding)
        values["harmony_bass"].append(bass_inputs + [MASK_ID] * padding)
        values["harmony_extensions"].append(
            extension_inputs + [[0] * len(EXTENSION_VOCABULARY)] * padding
        )
        values["edit_mask"].append(edit_masks + [PRESERVE_ID] * padding)
        values["padding_mask"].append([False] * frame_count + [True] * padding)
        values["target_event"].append(targets["event"] + [-100] * padding)
        values["target_root"].append(targets["root"] + [-100] * padding)
        values["target_quality"].append(targets["quality"] + [-100] * padding)
        values["target_inversion"].append(
            targets["inversion"] + [-100] * padding
        )
        values["target_bass"].append(targets["bass"] + [-100] * padding)
        values["target_extensions"].append(
            targets["extensions"] + [[0] * len(EXTENSION_VOCABULARY)] * padding
        )

    batch = {
        key: torch.tensor(value, dtype=torch.long, device=device)
        for key, value in values.items()
        if key not in {
            "harmony_extensions",
            "target_extensions",
            "padding_mask",
        }
    }
    batch["harmony_extensions"] = torch.tensor(
        values["harmony_extensions"],
        dtype=torch.float32,
        device=device,
    )
    batch["target_extensions"] = torch.tensor(
        values["target_extensions"],
        dtype=torch.float32,
        device=device,
    )
    batch["padding_mask"] = torch.tensor(
        values["padding_mask"],
        dtype=torch.bool,
        device=device,
    )
    return batch


def factorized_active_head_loss(
    outputs: dict[str, Any],
    batch: dict[str, Any],
    *,
    torch_module: Any,
) -> tuple[Any, dict[str, Any]]:
    """Mean normalized active-head loss from the preregistered objective."""

    torch = torch_module
    functional = torch.nn.functional
    active_frames = (
        (batch["edit_mask"] == GENERATE_ID)
        & ~batch["padding_mask"]
        & (batch["target_event"] != -100)
    )
    if not bool(active_frames.any()):
        raise TrainingRuntimeError("batch contains no masked target frames")
    losses: dict[str, Any] = {
        "event": functional.cross_entropy(
            outputs["event"][active_frames],
            batch["target_event"][active_frames],
        )
    }
    change_id = EVENT_VOCABULARY.index("change")
    active_changes = active_frames & (batch["target_event"] == change_id)
    if bool(active_changes.any()):
        for head in ("root", "quality", "inversion", "bass"):
            losses[head] = functional.cross_entropy(
                outputs[head][active_changes],
                batch[f"target_{head}"][active_changes],
            )
        losses["extensions"] = functional.binary_cross_entropy_with_logits(
            outputs["extensions"][active_changes],
            batch["target_extensions"][active_changes],
        )
    return torch.stack(tuple(losses.values())).mean(), losses


def evaluate_model_rows(
    model: Any,
    rows: Sequence[dict[str, Any]],
    *,
    torch_module: Any,
    device: str,
    batch_size: int,
) -> dict[str, Any]:
    """Evaluate full-mask reconstruction with per-head NLL and accuracy."""

    torch = torch_module
    aggregates = {
        head: {"loss": 0.0, "correct": 0, "count": 0}
        for head in (
            "event",
            "root",
            "quality",
            "inversion",
            "bass",
            "extensions",
        )
    }
    model.eval()
    with torch.inference_mode():
        for batch_rows in _batches(list(rows), batch_size):
            plans = [
                MaskPlan(
                    kind="fullHarmony",
                    masked=(True,) * row["frameCount"],
                )
                for row in batch_rows
            ]
            batch = build_masked_batch(
                batch_rows,
                plans,
                torch_module=torch,
                device=device,
            )
            outputs = model(batch)
            _, losses = factorized_active_head_loss(
                outputs,
                batch,
                torch_module=torch,
            )
            active_frames = (
                (batch["edit_mask"] == GENERATE_ID)
                & ~batch["padding_mask"]
                & (batch["target_event"] != -100)
            )
            change_id = EVENT_VOCABULARY.index("change")
            active_changes = active_frames & (batch["target_event"] == change_id)
            for head in ("event", "root", "quality", "inversion", "bass"):
                mask = active_frames if head == "event" else active_changes
                count = int(mask.sum().detach().cpu())
                if not count:
                    continue
                predictions = outputs[head][mask].argmax(dim=-1)
                targets = batch[f"target_{head}"][mask]
                aggregates[head]["correct"] += int(
                    (predictions == targets).sum().detach().cpu()
                )
                aggregates[head]["count"] += count
                aggregates[head]["loss"] += (
                    float(losses[head].detach().cpu()) * count
                )
            extension_count = int(active_changes.sum().detach().cpu())
            if extension_count:
                predictions = outputs["extensions"][active_changes] >= 0
                targets = batch["target_extensions"][active_changes] >= 0.5
                exact = (predictions == targets).all(dim=-1)
                aggregates["extensions"]["correct"] += int(
                    exact.sum().detach().cpu()
                )
                aggregates["extensions"]["count"] += extension_count
                aggregates["extensions"]["loss"] += (
                    float(losses["extensions"].detach().cpu()) * extension_count
                )
    metrics: dict[str, Any] = {}
    for head, values in aggregates.items():
        count = values["count"]
        metrics[head] = {
            "count": count,
            "nll": None if count == 0 else values["loss"] / count,
            "accuracy": None if count == 0 else values["correct"] / count,
        }
    active_nll = [
        metric["nll"]
        for metric in metrics.values()
        if metric["nll"] is not None
    ]
    metrics["primaryMeanNormalizedNll"] = (
        None if not active_nll else sum(active_nll) / len(active_nll)
    )
    return metrics


def validate_compiled_rows(
    rows: Sequence[dict[str, Any]],
    config: HarmonyForgeConfig,
) -> None:
    for row in rows:
        schema_version = row.get("schemaVersion")
        if schema_version not in {1, 2}:
            raise TrainingRuntimeError("compiled row schema version is unsupported")
        if (
            schema_version == 2
            and row.get("contentProfile") != "harmonyOnlyV1"
        ):
            raise TrainingRuntimeError(
                "schema v2 compiled rows require harmonyOnlyV1 content"
            )
        frame_count = row.get("frameCount")
        if (
            not isinstance(frame_count, int)
            or isinstance(frame_count, bool)
            or frame_count < 1
            or frame_count > config.maximum_frames_per_window
        ):
            raise TrainingRuntimeError(
                "compiled window exceeds the model frame contract"
            )
        if (
            not isinstance(row.get("windowId"), str)
            or not row["windowId"]
            or len(row["windowId"]) > 640
        ):
            raise TrainingRuntimeError("compiled windowId is invalid")
        inputs = row.get("inputs")
        targets = row.get("targets")
        if not isinstance(inputs, dict) or not isinstance(targets, dict):
            raise TrainingRuntimeError("compiled row inputs/targets are invalid")
        if set(inputs) != {
            "melodyMidi",
            "melodyRole",
            "metricalSlot",
            "barIndex",
            "keyRoot",
            "mode",
        }:
            raise TrainingRuntimeError("compiled input fields are invalid")
        if set(targets) != {
            "event",
            "root",
            "quality",
            "inversion",
            "bass",
            "extensions",
        }:
            raise TrainingRuntimeError("compiled target fields are invalid")
        for values in [*inputs.values(), *targets.values()]:
            if not isinstance(values, list) or len(values) != frame_count:
                raise TrainingRuntimeError("compiled frame arrays are misaligned")
        _validate_integer_array(inputs["melodyMidi"], "melodyMidi", 0, 128)
        _validate_integer_array(
            inputs["melodyRole"],
            "melodyRole",
            0,
            len(ROLE_VOCABULARY) - 1,
        )
        if schema_version == 2 and (
            any(value != 128 for value in inputs["melodyMidi"])
            or any(
                value != ROLE_VOCABULARY.index("unknown")
                for value in inputs["melodyRole"]
            )
        ):
            raise TrainingRuntimeError(
                "harmonyOnlyV1 rows must use melody sentinel inputs"
            )
        _validate_integer_array(inputs["metricalSlot"], "metricalSlot", 0, 15)
        _validate_integer_array(
            inputs["barIndex"],
            "barIndex",
            0,
            config.maximum_bars - 1,
        )
        _validate_integer_array(inputs["keyRoot"], "keyRoot", 0, 11)
        _validate_integer_array(
            inputs["mode"],
            "mode",
            0,
            len(MODE_VOCABULARY) - 1,
        )
        _validate_integer_array(
            targets["event"],
            "event",
            0,
            len(EVENT_VOCABULARY) - 1,
        )
        _validate_factor_array(targets["root"], "root", 11)
        _validate_factor_array(
            targets["quality"],
            "quality",
            len(QUALITY_VOCABULARY) - 1,
        )
        _validate_factor_array(targets["inversion"], "inversion", 4)
        _validate_factor_array(targets["bass"], "bass", 11)
        for extensions in targets["extensions"]:
            if (
                not isinstance(extensions, list)
                or len(extensions) != len(EXTENSION_VOCABULARY)
                or any(
                    not isinstance(value, int)
                    or isinstance(value, bool)
                    or value not in {0, 1}
                    for value in extensions
                )
            ):
                raise TrainingRuntimeError(
                    "compiled extension targets must be binary vectors"
                )
        no_chord = EVENT_VOCABULARY.index("noChord")
        for index, event in enumerate(targets["event"]):
            factors = (
                targets["root"][index],
                targets["quality"][index],
                targets["inversion"][index],
                targets["bass"][index],
            )
            if event == no_chord and any(value != -100 for value in factors):
                raise TrainingRuntimeError(
                    "NO_CHORD frames must not carry chord-factor targets"
                )
            if event != no_chord and any(value == -100 for value in factors):
                raise TrainingRuntimeError(
                    "chord frames require every chord-factor target"
                )


def _validate_integer_array(
    values: Sequence[Any],
    field: str,
    minimum: int,
    maximum: int,
) -> None:
    if any(
        not isinstance(value, int)
        or isinstance(value, bool)
        or not minimum <= value <= maximum
        for value in values
    ):
        raise TrainingRuntimeError(
            f"compiled {field} values are outside the model vocabulary"
        )


def _validate_factor_array(
    values: Sequence[Any],
    field: str,
    maximum: int,
) -> None:
    if any(
        not isinstance(value, int)
        or isinstance(value, bool)
        or (value != -100 and not 0 <= value <= maximum)
        for value in values
    ):
        raise TrainingRuntimeError(
            f"compiled {field} targets are outside the model vocabulary"
        )


def _deterministic_order(
    rows: Sequence[dict[str, Any]],
    *,
    seed: str,
    epoch: int,
) -> list[dict[str, Any]]:
    return sorted(
        rows,
        key=lambda row: hashlib.sha256(
            f"{seed}:{epoch}:{row['windowId']}".encode()
        ).digest(),
    )


def _batches(
    rows: Sequence[dict[str, Any]],
    batch_size: int,
) -> Iterable[list[dict[str, Any]]]:
    for first in range(0, len(rows), batch_size):
        yield list(rows[first : first + batch_size])


def _factor_input_id(target: int) -> int:
    return MASK_ID if target < 0 else target + 1


def _import_torch() -> Any:
    try:
        return importlib.import_module("torch")
    except Exception as exc:
        raise TrainingRuntimeError(
            "PyTorch is optional and must be installed for train/evaluate"
        ) from exc


def _select_device(
    torch: Any,
    choice: DeviceChoice,
) -> tuple[str, str | None]:
    candidates: list[str]
    if choice == "auto":
        candidates = []
        if torch.cuda.is_available():
            candidates.append("cuda")
        if (
            hasattr(torch.backends, "mps")
            and torch.backends.mps.is_available()
        ):
            candidates.append("mps")
        candidates.append("cpu")
    else:
        candidates = [choice]
    errors: list[str] = []
    mps_silent_fallback = os.getenv("PYTORCH_ENABLE_MPS_FALLBACK") == "1"
    for candidate in candidates:
        if candidate == "mps" and mps_silent_fallback:
            if choice == "mps":
                raise TrainingRuntimeError(
                    "MPS training is refused while silent CPU operation "
                    "fallback is enabled"
                )
            errors.append("mps: silent CPU operation fallback is enabled")
            continue
        try:
            tensor = torch.ones((2,), device=candidate, dtype=torch.float32)
            if float((tensor * 2).sum().detach().cpu()) != 4:
                raise RuntimeError("unexpected probe value")
            if candidate == "cuda":
                torch.cuda.synchronize()
            elif candidate == "mps":
                torch.mps.synchronize()
            fallback_reason = None
            if candidate == "cpu" and errors:
                fallback_reason = "acceleratorProbeFailedCpuFallback"
            return candidate, fallback_reason
        except Exception as exc:
            errors.append(f"{candidate}: {exc}")
    raise TrainingRuntimeError(
        "no requested training device passed a tensor probe: " + "; ".join(errors)
    )


def _configure_determinism(torch: Any, seed: str) -> None:
    integer_seed = int.from_bytes(
        hashlib.sha256(seed.encode()).digest()[:8],
        "big",
    ) % (2**63 - 1)
    torch.manual_seed(integer_seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(integer_seed)
    torch.use_deterministic_algorithms(True)
    if hasattr(torch.backends, "cudnn"):
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True


def prepare_deterministic_environment() -> str:
    """Configure cuBLAS determinism before torch import or any device probe."""

    configured = os.getenv("CUBLAS_WORKSPACE_CONFIG")
    if configured is None:
        configured = ":4096:8"
        os.environ["CUBLAS_WORKSPACE_CONFIG"] = configured
    if configured not in {":4096:8", ":16:8"}:
        raise TrainingRuntimeError(
            "CUBLAS_WORKSPACE_CONFIG must be :4096:8 or :16:8"
        )
    return configured


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise TrainingRuntimeError("artifact could not be hashed") from exc
    return digest.hexdigest()


def _atomic_json_write(path: Path, payload: Any) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    encoded = (
        json.dumps(
            payload,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    ).encode()
    temporary.write_bytes(encoded)
    temporary.replace(path)
