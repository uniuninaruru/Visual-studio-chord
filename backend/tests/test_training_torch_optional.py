import pytest

from app.ml.contracts import HarmonyForgeConfig
from app.ml.masking import MaskPlan
from app.ml.model import build_harmony_forge_model
from app.ml.training_runtime import (
    build_masked_batch,
    factorized_active_head_loss,
)

torch = pytest.importorskip("torch")

pytestmark = pytest.mark.optional_torch


def test_active_head_loss_runs_on_a_tiny_real_torch_batch() -> None:
    row = {
        "schemaVersion": 1,
        "windowId": "tiny:0000",
        "frameCount": 2,
        "inputs": {
            "melodyMidi": [60, 62],
            "melodyRole": [0, 1],
            "metricalSlot": [0, 1],
            "barIndex": [0, 0],
            "keyRoot": [0, 0],
            "mode": [0, 0],
        },
        "targets": {
            "event": [2, 1],
            "root": [0, 0],
            "quality": [0, 0],
            "inversion": [0, 0],
            "bass": [0, 0],
            "extensions": [[0] * 8, [0] * 8],
        },
    }
    batch = build_masked_batch(
        [row],
        [MaskPlan(kind="fullHarmony", masked=(True, True))],
        torch_module=torch,
        device="cpu",
    )
    outputs = {
        "event": torch.randn(1, 2, 3, requires_grad=True),
        "root": torch.randn(1, 2, 12, requires_grad=True),
        "quality": torch.randn(1, 2, 16, requires_grad=True),
        "inversion": torch.randn(1, 2, 5, requires_grad=True),
        "bass": torch.randn(1, 2, 12, requires_grad=True),
        "extensions": torch.randn(1, 2, 8, requires_grad=True),
    }

    loss, heads = factorized_active_head_loss(
        outputs,
        batch,
        torch_module=torch,
    )
    loss.backward()

    assert torch.isfinite(loss)
    assert set(heads) == {
        "event",
        "root",
        "quality",
        "inversion",
        "bass",
        "extensions",
    }


def test_disjoint_bar_summaries_are_batch_companion_invariant() -> None:
    torch.manual_seed(1729)
    config = HarmonyForgeConfig(
        maximum_bars=16,
        layers=1,
        hidden_size=32,
        attention_heads=4,
        feed_forward_size=32,
        dropout=0.0,
        maximum_frames_per_window=16,
    )
    model = build_harmony_forge_model(config, torch_module=torch)
    model.eval()
    first = _model_batch([0, 0, 0, 0])
    second = _model_batch([10, 10, 10, 10])
    combined = {
        key: torch.cat((first[key], second[key]), dim=0)
        for key in first
    }

    first_alone = model(first)["event"].detach()
    second_alone = model(second)["event"].detach()
    together = model(combined)["event"]

    assert torch.allclose(together[0:1], first_alone, atol=1e-6, rtol=1e-6)
    assert torch.allclose(together[1:2], second_alone, atol=1e-6, rtol=1e-6)
    together.sum().backward()
    assert any(
        parameter.grad is not None and torch.isfinite(parameter.grad).all()
        for parameter in model.parameters()
    )


def _model_batch(bar_indices: list[int]) -> dict:
    frame_count = len(bar_indices)
    integer_fields = (
        "melody_midi",
        "melody_role",
        "metrical_slot",
        "key_root",
        "mode",
        "harmony_event",
        "harmony_root",
        "harmony_quality",
        "harmony_inversion",
        "harmony_bass",
        "edit_mask",
    )
    batch = {
        field: torch.zeros((1, frame_count), dtype=torch.long)
        for field in integer_fields
    }
    batch["bar_index"] = torch.tensor([bar_indices], dtype=torch.long)
    batch["harmony_extensions"] = torch.zeros(
        (1, frame_count, 8),
        dtype=torch.float32,
    )
    batch["padding_mask"] = torch.zeros(
        (1, frame_count),
        dtype=torch.bool,
    )
    return batch
