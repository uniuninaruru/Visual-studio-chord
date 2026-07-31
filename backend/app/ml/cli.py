"""Installed command-line entry points for the HarmonyForge pipeline."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from app.ml.checkpoint import INFERENCE_TASK, PRETRAINING_TASK
from app.ml.dataset import (
    PRIVATE_HARMONY_TRAINING_PURPOSE,
    TRAINING_PURPOSE,
    CompileOptions,
    compile_dataset,
)
from app.ml.training_runtime import (
    TrainOptions,
    evaluate_checkpoint,
    train_reference_model,
)


def build_compile_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="harmonyforge-compile",
        description=(
            "Compile normalized JSONL with a rights ledger, work-level "
            "split/deduplication, and reproducible SHA-256 provenance."
        ),
    )
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument(
        "--prepare-run",
        type=Path,
        help=(
            "hash-bound prepare-run.json required when a harmony-only ledger "
            "declares a preparation descriptor"
        ),
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--dataset-id", required=True)
    parser.add_argument("--dataset-version", required=True)
    parser.add_argument("--split-seed", default="1729")
    parser.add_argument("--train-basis-points", type=int, default=8000)
    parser.add_argument("--validation-basis-points", type=int, default=1000)
    parser.add_argument("--maximum-frames-per-window", type=int, default=256)
    parser.add_argument(
        "--unsupported-quality-policy",
        choices=("excludeRecord", "mapOther"),
        default="excludeRecord",
    )
    parser.add_argument(
        "--harmony-gap-policy",
        choices=("excludeRecord", "allowNoChord"),
        default="excludeRecord",
    )
    parser.add_argument(
        "--content-profile",
        choices=("melodyHarmonyV1", "harmonyOnlyV1"),
        default="melodyHarmonyV1",
        help=(
            "Use harmonyOnlyV1 for private/local pretraining data that must "
            "not contain melody, MIDI, audio, lyrics, titles, voicing, or "
            "performance content."
        ),
    )
    return parser


def compile_main(argv: Sequence[str] | None = None) -> int:
    arguments = build_compile_parser().parse_args(argv)
    manifest = compile_dataset(
        arguments.input,
        arguments.ledger,
        arguments.output,
        preparation_run_path=arguments.prepare_run,
        options=CompileOptions(
            dataset_id=arguments.dataset_id,
            dataset_version=arguments.dataset_version,
            split_seed=arguments.split_seed,
            train_basis_points=arguments.train_basis_points,
            validation_basis_points=arguments.validation_basis_points,
            maximum_frames_per_window=arguments.maximum_frames_per_window,
            unsupported_quality_policy=arguments.unsupported_quality_policy,
            harmony_gap_policy=arguments.harmony_gap_policy,
            purpose=(
                PRIVATE_HARMONY_TRAINING_PURPOSE
                if arguments.content_profile == "harmonyOnlyV1"
                else TRAINING_PURPOSE
            ),
            content_profile=arguments.content_profile,
        ),
    )
    print(json.dumps(manifest, ensure_ascii=True, sort_keys=True))
    return 0


def build_train_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="harmonyforge-train",
        description=(
            "Run deterministic reference training and export a research-only "
            "safetensors checkpoint with hash-bound data and run manifests."
        ),
    )
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--data-manifest", type=Path, required=True)
    parser.add_argument("--model-directory", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument(
        "--task",
        choices=(INFERENCE_TASK, PRETRAINING_TASK),
        required=True,
        help=(
            "Declare the objective actually represented by the compiled data. "
            "harmonyOnlyV1 requires harmony_only_pretraining and cannot be "
            "served as melody-conditioned inference."
        ),
    )
    parser.add_argument(
        "--initial-model-directory",
        type=Path,
        help=(
            "Optional local HarmonyForge model root to warm-start. A "
            "harmony_only_pretraining checkpoint may initialize the inference "
            "task, but remains non-servable until a new inference-task artifact "
            "is trained and exported."
        ),
    )
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--gradient-clipping-norm", type=float, default=1.0)
    parser.add_argument("--seed", default="1729")
    parser.add_argument(
        "--device",
        choices=("auto", "cpu", "cuda", "mps"),
        default="auto",
    )
    parser.add_argument("--max-steps", type=int)
    return parser


def train_main(argv: Sequence[str] | None = None) -> int:
    arguments = build_train_parser().parse_args(argv)
    result = train_reference_model(
        config_path=arguments.config,
        data_manifest_path=arguments.data_manifest,
        model_directory=arguments.model_directory,
        source_commit=arguments.source_commit,
        task=arguments.task,
        initial_model_directory=arguments.initial_model_directory,
        options=TrainOptions(
            epochs=arguments.epochs,
            batch_size=arguments.batch_size,
            learning_rate=arguments.learning_rate,
            weight_decay=arguments.weight_decay,
            gradient_clipping_norm=arguments.gradient_clipping_norm,
            seed=arguments.seed,
            device=arguments.device,
            max_steps=arguments.max_steps,
        ),
    )
    print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    return 0


def build_evaluate_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="harmonyforge-evaluate",
        description=(
            "Strictly hash-match and evaluate a HarmonyForge checkpoint on "
            "train, validation, or locked test data."
        ),
    )
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--data-manifest", type=Path, required=True)
    parser.add_argument("--model-directory", type=Path, required=True)
    parser.add_argument(
        "--split",
        choices=("train", "validation", "test"),
        default="test",
    )
    parser.add_argument(
        "--device",
        choices=("auto", "cpu", "cuda", "mps"),
        default="auto",
    )
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--output", type=Path)
    return parser


def evaluate_main(argv: Sequence[str] | None = None) -> int:
    arguments = build_evaluate_parser().parse_args(argv)
    result = evaluate_checkpoint(
        config_path=arguments.config,
        data_manifest_path=arguments.data_manifest,
        model_directory=arguments.model_directory,
        split=arguments.split,
        device_choice=arguments.device,
        batch_size=arguments.batch_size,
    )
    encoded = (
        json.dumps(
            result,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    )
    if arguments.output is None:
        print(encoded, end="")
    else:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = arguments.output.with_name(f".{arguments.output.name}.tmp")
        temporary.write_text(encoded, encoding="utf-8")
        temporary.replace(arguments.output)
    return 0
