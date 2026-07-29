from pathlib import Path

import pytest
from pydantic import ValidationError

from app.ml.contracts import HarmonyForgeConfig, load_model_config
from app.ml.tokenizer import (
    CONDITION_ONLY_ID,
    GENERATE_ID,
    MASK_ID,
    PRESERVE_ID,
    TOKENIZER_SHA256,
    HarmonyTokenizer,
)
from app.schemas.api import HarmonyGenerateRequest


def _request(**overrides) -> HarmonyGenerateRequest:
    payload = {
        "apiVersion": "2",
        "requestId": "tokenizer-test",
        "modelId": "mock-harmonyforge-bimask-v1",
        "seed": "1729",
        "candidateCount": 3,
        "melody": [
            {
                "startTick": 0,
                "durationTick": 480,
                "midi": 64,
                "velocity": 96,
                "role": "chordTone",
            },
            {
                "startTick": 480,
                "durationTick": 480,
                "midi": 67,
                "velocity": 88,
                "role": "passing",
            },
        ],
        "existingHarmony": [
            {
                "startTick": 0,
                "durationTick": 960,
                "rootOffsetFromKey": 0,
                "quality": "major",
                "inversion": 0,
                "bassOffsetFromRoot": 0,
                "extensions": [],
                "locked": False,
            },
            {
                "startTick": 960,
                "durationTick": 960,
                "rootOffsetFromKey": 7,
                "quality": "major",
                "inversion": 1,
                "bassOffsetFromRoot": 4,
                "extensions": ["9"],
                "locked": False,
            },
        ],
        "generationMask": [
            {"startTick": 0, "endTick": 480, "mode": "preserve"},
            {"startTick": 480, "endTick": 960, "mode": "conditionOnly"},
            {"startTick": 960, "endTick": 1920, "mode": "generate"},
        ],
        "tonalities": [
            {"startTick": 0, "endTick": 960, "keyRoot": 0, "mode": "major"},
            {
                "startTick": 960,
                "endTick": 1920,
                "keyRoot": 2,
                "mode": "naturalMinor",
            },
        ],
        "controls": {
            "ppq": 480,
            "ticksPerBar": 1920,
            "timeSignature": "4/4",
            "startTick": 0,
            "endTick": 1920,
        },
    }
    payload.update(overrides)
    return HarmonyGenerateRequest.model_validate(payload)


def test_tokenizer_contract_hash_is_stable() -> None:
    assert len(TOKENIZER_SHA256) == 64
    assert TOKENIZER_SHA256 == TOKENIZER_SHA256.lower()


def test_tokenizer_aligns_melody_locks_masks_and_modulation() -> None:
    windows = HarmonyTokenizer().encode(_request())

    assert len(windows) == 1
    window = windows[0]
    assert window.frame_ticks == 120
    assert window.frame_count == 16
    assert window.melody_midi[:5] == (64, 64, 64, 64, 67)
    assert window.edit_mask[:4] == (PRESERVE_ID,) * 4
    assert window.edit_mask[4:8] == (CONDITION_ONLY_ID,) * 4
    assert window.edit_mask[8:] == (GENERATE_ID,) * 8
    assert window.harmony_root[0] == 1
    assert window.harmony_root[8:] == (MASK_ID,) * 8
    assert window.harmony_extensions[0] == (0,) * 8
    assert window.harmony_extensions[4] == (0,) * 8
    assert window.harmony_extensions[8:] == ((0,) * 8,) * 8
    assert window.key_root[:8] == (0,) * 8
    assert window.key_root[8:] == (2,) * 8
    assert window.mode[:8] != window.mode[8:]
    assert window.harmony_event[:4] == (3, 2, 2, 2)
    assert window.harmony_event[4:8] == (2, 2, 2, 2)


def test_timeline_gaps_and_uncovered_preserve_are_rejected() -> None:
    with pytest.raises(ValidationError):
        _request(
            generationMask=[
                {"startTick": 0, "endTick": 480, "mode": "generate"},
                {"startTick": 960, "endTick": 1920, "mode": "generate"},
            ]
        )


def test_controls_and_mask_grid_must_match_ppq() -> None:
    with pytest.raises(ValidationError, match="ticksPerBar"):
        _request(
            controls={
                "ppq": 480,
                "ticksPerBar": 1440,
                "timeSignature": "4/4",
                "startTick": 0,
                "endTick": 1920,
            }
        )
    with pytest.raises(ValidationError, match="align"):
        _request(
            generationMask=[
                {"startTick": 0, "endTick": 481, "mode": "generate"},
                {"startTick": 481, "endTick": 1920, "mode": "generate"},
            ]
        )
    with pytest.raises(ValidationError):
        _request(
            existingHarmony=[],
            generationMask=[
                {"startTick": 0, "endTick": 1920, "mode": "preserve"},
            ],
        )


def test_locked_harmony_overrides_a_generate_span() -> None:
    request = _request()
    request.existing_harmony[1].locked = True

    window = HarmonyTokenizer().encode(request)[0]

    assert window.edit_mask[8:] == (PRESERVE_ID,) * 8
    assert window.harmony_root[8:] == (8,) * 8
    assert window.harmony_extensions[8][1] == 1


def test_generate_span_masks_all_unlocked_existing_harmony_factors() -> None:
    request = _request(
        generationMask=[
            {"startTick": 0, "endTick": 1920, "mode": "generate"},
        ]
    )

    window = HarmonyTokenizer().encode(request)[0]

    assert window.edit_mask == (GENERATE_ID,) * 16
    assert window.harmony_event == (MASK_ID,) * 16
    assert window.harmony_root == (MASK_ID,) * 16
    assert window.harmony_quality == (MASK_ID,) * 16
    assert window.harmony_inversion == (MASK_ID,) * 16
    assert window.harmony_bass == (MASK_ID,) * 16
    assert window.harmony_extensions == ((0,) * 8,) * 16


def test_bar_index_is_relative_to_generation_start() -> None:
    request = _request(
        melody=[],
        existingHarmony=[],
        generationMask=[
            {"startTick": 3840, "endTick": 5760, "mode": "generate"},
        ],
        tonalities=[
            {"startTick": 3840, "endTick": 5760, "keyRoot": 0, "mode": "major"},
        ],
        controls={
            "ppq": 480,
            "ticksPerBar": 1920,
            "timeSignature": "4/4",
            "startTick": 3840,
            "endTick": 5760,
        },
    )

    assert HarmonyTokenizer().encode(request)[0].bar_index == (0,) * 16


def test_long_ranges_are_windowed_without_changing_tick_positions() -> None:
    end_tick = 128 * 1920
    request = _request(
        melody=[],
        existingHarmony=[],
        generationMask=[
            {"startTick": 0, "endTick": end_tick, "mode": "generate"},
        ],
        tonalities=[
            {"startTick": 0, "endTick": end_tick, "keyRoot": 0, "mode": "major"},
        ],
        controls={
            "ppq": 480,
            "ticksPerBar": 1920,
            "timeSignature": "4/4",
            "startTick": 0,
            "endTick": end_tick,
        },
    )

    windows = HarmonyTokenizer().encode(request, maximum_frames_per_window=256)

    assert len(windows) == 8
    assert all(window.frame_count == 256 for window in windows)
    assert windows[-1].start_tick == 7 * 256 * 120


def test_production_config_meets_declared_parameter_target() -> None:
    config_path = (
        Path(__file__).resolve().parents[2]
        / "configs"
        / "models"
        / "harmonyforge-bimask-base-v1.yaml"
    )
    config = load_model_config(config_path)

    assert config.feed_forward_size == 4096
    assert config.architecture_dict()["extensionConditioning"] is True
    assert config.estimated_parameter_count() == 104_567_874
    assert 100_000_000 <= config.estimated_parameter_count() <= 130_000_000


def test_tiny_config_rejects_invalid_head_division() -> None:
    config = HarmonyForgeConfig(hidden_size=63, attention_heads=8)
    with pytest.raises(ValueError, match="divisible"):
        config.validate()
