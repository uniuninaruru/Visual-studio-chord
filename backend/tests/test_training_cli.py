import pytest

from app.ml.checkpoint import PRETRAINING_TASK
from app.ml.cli import (
    build_compile_parser,
    build_train_parser,
    compile_main,
    evaluate_main,
    train_main,
)


@pytest.mark.parametrize(
    ("entrypoint", "command_name"),
    [
        (compile_main, "harmonyforge-compile"),
        (train_main, "harmonyforge-train"),
        (evaluate_main, "harmonyforge-evaluate"),
    ],
)
def test_pipeline_help_is_available_without_loading_torch(
    entrypoint,
    command_name,
    capsys,
) -> None:
    with pytest.raises(SystemExit) as exit_info:
        entrypoint(["--help"])

    assert exit_info.value.code == 0
    assert command_name in capsys.readouterr().out


def test_training_cli_requires_an_explicit_objective() -> None:
    required = [
        "--config",
        "config.yaml",
        "--data-manifest",
        "data-manifest.json",
        "--model-directory",
        "models",
        "--source-commit",
        "b" * 40,
    ]
    parser = build_train_parser()

    with pytest.raises(SystemExit):
        parser.parse_args(required)

    arguments = parser.parse_args(
        [
            *required,
            "--task",
            PRETRAINING_TASK,
            "--initial-model-directory",
            "local-models",
        ]
    )
    assert arguments.task == PRETRAINING_TASK
    assert str(arguments.initial_model_directory) == "local-models"


def test_compile_cli_accepts_a_hash_bound_preparation_run() -> None:
    arguments = build_compile_parser().parse_args(
        [
            "--input",
            "records.jsonl",
            "--ledger",
            "ledger.json",
            "--prepare-run",
            "prepare-run.json",
            "--output",
            "processed",
            "--dataset-id",
            "pop909-harmony-only",
            "--dataset-version",
            "d83e6edba6872a704f5d3b8b32f5cb540088dae6",
            "--content-profile",
            "harmonyOnlyV1",
        ]
    )

    assert str(arguments.prepare_run) == "prepare-run.json"
