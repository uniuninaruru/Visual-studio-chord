"""Validated architecture and vocabulary contracts for HarmonyForge."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

MODEL_ID = "harmonyforge-bimask-base-v1"
MOCK_MODEL_ID = "mock-harmonyforge-bimask-v1"

QUALITY_VOCABULARY = (
    "major",
    "minor",
    "diminished",
    "augmented",
    "dominant7",
    "major7",
    "minor7",
    "halfDiminished7",
    "diminished7",
    "minorMajor7",
    "augmentedMajor7",
    "sus2",
    "sus4",
    "add9",
    "minorAdd9",
    "other",
)
MODE_VOCABULARY = (
    "major",
    "naturalMinor",
    "harmonicMinor",
    "dorian",
    "mixolydian",
)
ROLE_VOCABULARY = (
    "chordTone",
    "scaleTone",
    "passing",
    "neighbor",
    "approach",
    "unknown",
)
EXTENSION_VOCABULARY = (
    "6",
    "9",
    "b9",
    "#9",
    "11",
    "#11",
    "13",
    "b13",
)
EVENT_VOCABULARY = ("noChord", "hold", "change")


@dataclass(frozen=True, slots=True)
class HarmonyForgeConfig:
    """The architecture subset that changes tensor shapes."""

    model_id: str = MODEL_ID
    ppq: int = 480
    maximum_bars: int = 128
    layers: int = 12
    hidden_size: int = 768
    attention_heads: int = 12
    feed_forward_size: int = 4096
    dropout: float = 0.1
    maximum_frames_per_window: int = 256
    factorized_output_heads: bool = True

    def validate(self) -> None:
        if self.model_id != MODEL_ID:
            raise ValueError("Unexpected neural harmony model id")
        if self.ppq < 24 or self.ppq > 9600:
            raise ValueError("ppq is outside the supported range")
        if self.maximum_bars < 1 or self.maximum_bars > 128:
            raise ValueError("maximum_bars must be between 1 and 128")
        if self.layers < 1 or self.layers > 48:
            raise ValueError("layers must be between 1 and 48")
        if self.hidden_size < 32 or self.hidden_size > 4096:
            raise ValueError("hidden_size must be between 32 and 4096")
        if self.hidden_size % self.attention_heads != 0:
            raise ValueError("hidden_size must be divisible by attention_heads")
        if self.feed_forward_size < self.hidden_size:
            raise ValueError("feed_forward_size must not be smaller than hidden_size")
        if not 0 <= self.dropout < 1:
            raise ValueError("dropout must be in [0, 1)")
        if self.maximum_frames_per_window < 16:
            raise ValueError("maximum_frames_per_window must be at least 16")
        if not self.factorized_output_heads:
            raise ValueError("The v1 runtime requires factorized output heads")

    def architecture_dict(self) -> dict[str, int | float | str | bool]:
        return {
            "family": "bidirectional_masked_transformer",
            "layers": self.layers,
            "hiddenSize": self.hidden_size,
            "attentionHeads": self.attention_heads,
            "feedForwardSize": self.feed_forward_size,
            "dropout": self.dropout,
            "normalization": "pre_norm",
            "activation": "gelu",
            "positionalEncoding": "learned_window_plus_bar_and_meter",
            "barSummaryTokens": True,
            "maximumBars": self.maximum_bars,
            "maximumFramesPerWindow": self.maximum_frames_per_window,
            "factorizedOutputHeads": self.factorized_output_heads,
            "extensionConditioning": True,
        }

    def estimated_parameter_count(self) -> int:
        """Return the exact count for the module layout implemented in model.py."""

        hidden = self.hidden_size
        feed_forward = self.feed_forward_size
        # TransformerEncoderLayer: in-projection, out-projection, two FFN
        # projections, their biases, and two LayerNorms.
        per_layer = (
            (3 * hidden * hidden)
            + (3 * hidden)
            + (hidden * hidden)
            + hidden
            + (hidden * feed_forward)
            + feed_forward
            + (feed_forward * hidden)
            + hidden
            + (4 * hidden)
        )
        embedding_rows = (
            129  # melody MIDI plus silence
            + len(ROLE_VOCABULARY)
            + 16  # sixteenth position
            + self.maximum_bars
            + 12  # key
            + len(MODE_VOCABULARY)
            + 4  # harmony event including MASK
            + 13  # root including MASK
            + len(QUALITY_VOCABULARY) + 1
            + 6  # inversion including MASK
            + 13  # bass offset including MASK
            + 4  # edit mask
            + 3  # stream type
        )
        embeddings = embedding_rows * hidden
        frame_positions = self.maximum_frames_per_window * hidden
        extension_projection = len(EXTENSION_VOCABULARY) * hidden
        bar_summary = self.maximum_bars * hidden
        final_norm = 2 * hidden
        head_outputs = (
            len(EVENT_VOCABULARY)
            + 12
            + len(QUALITY_VOCABULARY)
            + 5
            + 12
            + len(EXTENSION_VOCABULARY)
            + 4
            + 6
        )
        heads = (hidden * head_outputs) + head_outputs
        return (
            self.layers * per_layer
            + embeddings
            + frame_positions
            + extension_projection
            + bar_summary
            + final_norm
            + heads
        )


def load_model_config(path: Path) -> HarmonyForgeConfig:
    """Read the reviewed YAML without accepting arbitrary Python objects."""

    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, yaml.YAMLError) as exc:
        raise ValueError("Neural harmony model config could not be read") from exc
    if not isinstance(raw, dict):
        raise ValueError("Neural harmony model config must be an object")
    representation = _mapping(raw.get("representation"), "representation")
    architecture = _mapping(raw.get("architecture"), "architecture")
    model_id = raw.get("model_id")
    config = HarmonyForgeConfig(
        model_id=str(model_id),
        ppq=_integer(representation.get("ppq"), "representation.ppq"),
        maximum_bars=_integer(
            representation.get("maximum_bars"),
            "representation.maximum_bars",
        ),
        layers=_integer(architecture.get("layers"), "architecture.layers"),
        hidden_size=_integer(
            architecture.get("hidden_size"),
            "architecture.hidden_size",
        ),
        attention_heads=_integer(
            architecture.get("attention_heads"),
            "architecture.attention_heads",
        ),
        feed_forward_size=_integer(
            architecture.get("feed_forward_size"),
            "architecture.feed_forward_size",
        ),
        dropout=_number(architecture.get("dropout"), "architecture.dropout"),
        maximum_frames_per_window=_integer(
            representation.get("maximum_frames_per_window", 256),
            "representation.maximum_frames_per_window",
        ),
        factorized_output_heads=bool(
            architecture.get("factorized_output_heads"),
        ),
    )
    config.validate()
    return config


def _mapping(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    return value


def _integer(value: Any, field: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{field} must be an integer")
    return value


def _number(value: Any, field: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"{field} must be numeric")
    return float(value)
