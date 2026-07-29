import pytest

from app.ml.cli import compile_main, evaluate_main, train_main


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
