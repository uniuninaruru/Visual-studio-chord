"""Configurable encoder-only Transformer with factorized harmony heads."""

from __future__ import annotations

import importlib
from typing import Any

from app.ml.contracts import (
    EVENT_VOCABULARY,
    EXTENSION_VOCABULARY,
    MODE_VOCABULARY,
    QUALITY_VOCABULARY,
    ROLE_VOCABULARY,
    HarmonyForgeConfig,
)


def import_torch() -> Any:
    """Keep the normal CPU/theory backend importable without PyTorch."""

    return importlib.import_module("torch")


def build_harmony_forge_model(
    config: HarmonyForgeConfig,
    *,
    torch_module: Any | None = None,
) -> Any:
    """Build the reviewed architecture; caller controls device placement."""

    config.validate()
    torch = torch_module or import_torch()
    nn = torch.nn

    class HarmonyForgeBiMask(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            hidden = config.hidden_size
            self.config = config
            self.embeddings = nn.ModuleDict(
                {
                    "melodyMidi": nn.Embedding(129, hidden),
                    "melodyRole": nn.Embedding(len(ROLE_VOCABULARY), hidden),
                    "metricalSlot": nn.Embedding(16, hidden),
                    "barIndex": nn.Embedding(config.maximum_bars, hidden),
                    "keyRoot": nn.Embedding(12, hidden),
                    "mode": nn.Embedding(len(MODE_VOCABULARY), hidden),
                    "harmonyEvent": nn.Embedding(4, hidden),
                    "harmonyRoot": nn.Embedding(13, hidden),
                    "harmonyQuality": nn.Embedding(len(QUALITY_VOCABULARY) + 1, hidden),
                    "harmonyInversion": nn.Embedding(6, hidden),
                    "harmonyBass": nn.Embedding(13, hidden),
                    "editMask": nn.Embedding(4, hidden),
                    "stream": nn.Embedding(3, hidden),
                }
            )
            self.frame_position = nn.Embedding(
                config.maximum_frames_per_window,
                hidden,
            )
            self.harmony_extension_projection = nn.Linear(
                len(EXTENSION_VOCABULARY),
                hidden,
                bias=False,
            )
            self.bar_summary = nn.Embedding(config.maximum_bars, hidden)
            layer = nn.TransformerEncoderLayer(
                d_model=hidden,
                nhead=config.attention_heads,
                dim_feedforward=config.feed_forward_size,
                dropout=config.dropout,
                activation="gelu",
                batch_first=True,
                norm_first=True,
            )
            self.encoder = nn.TransformerEncoder(
                layer,
                num_layers=config.layers,
                norm=nn.LayerNorm(hidden),
            )
            self.heads = nn.ModuleDict(
                {
                    "event": nn.Linear(hidden, len(EVENT_VOCABULARY)),
                    "root": nn.Linear(hidden, 12),
                    "quality": nn.Linear(hidden, len(QUALITY_VOCABULARY)),
                    "inversion": nn.Linear(hidden, 5),
                    "bass": nn.Linear(hidden, 12),
                    "extensions": nn.Linear(hidden, len(EXTENSION_VOCABULARY)),
                    "function": nn.Linear(hidden, 4),
                    "cadence": nn.Linear(hidden, 6),
                }
            )

        def forward(self, batch: dict[str, Any]) -> dict[str, Any]:
            padding = batch["padding_mask"].bool()
            frame_positions = torch.arange(
                batch["melody_midi"].shape[1],
                device=batch["melody_midi"].device,
                dtype=batch["melody_midi"].dtype,
            )
            position = self.frame_position(frame_positions).unsqueeze(0)
            common = (
                self.embeddings["metricalSlot"](batch["metrical_slot"])
                + self.embeddings["barIndex"](batch["bar_index"])
                + self.embeddings["keyRoot"](batch["key_root"])
                + self.embeddings["mode"](batch["mode"])
                + position
            )
            melody = (
                common
                + self.embeddings["melodyMidi"](batch["melody_midi"])
                + self.embeddings["melodyRole"](batch["melody_role"])
                + self.embeddings["stream"](
                    torch.zeros_like(batch["melody_midi"])
                )
            )
            harmony = (
                common
                + self.embeddings["harmonyEvent"](batch["harmony_event"])
                + self.embeddings["harmonyRoot"](batch["harmony_root"])
                + self.embeddings["harmonyQuality"](batch["harmony_quality"])
                + self.embeddings["harmonyInversion"](batch["harmony_inversion"])
                + self.embeddings["harmonyBass"](batch["harmony_bass"])
                + self.harmony_extension_projection(
                    batch["harmony_extensions"].float()
                )
                + self.embeddings["editMask"](batch["edit_mask"])
                + self.embeddings["stream"](
                    torch.ones_like(batch["melody_midi"])
                )
            )
            frame_tokens = torch.stack((melody, harmony), dim=2).flatten(1, 2)
            frame_padding = torch.stack((padding, padding), dim=2).flatten(1, 2)

            # Build summaries independently per example. A global batch min/max
            # would inject another song's otherwise absent bars and make one
            # sample's logits depend on its batch companions.
            bar_counts = torch.zeros(
                (batch["bar_index"].shape[0], config.maximum_bars),
                device=batch["bar_index"].device,
                dtype=batch["bar_index"].dtype,
            )
            bar_counts.scatter_add_(
                1,
                batch["bar_index"],
                (~padding).to(batch["bar_index"].dtype),
            )
            represented = bar_counts > 0
            all_bar_ids = torch.arange(
                config.maximum_bars,
                device=batch["bar_index"].device,
                dtype=batch["bar_index"].dtype,
            ).unsqueeze(0).expand(batch["bar_index"].shape[0], -1)
            sentinel = torch.full_like(all_bar_ids, config.maximum_bars)
            sorted_ids = torch.where(represented, all_bar_ids, sentinel).sort(
                dim=1
            ).values
            summary_count = int(
                represented.sum(dim=1).max().detach().cpu()
            )
            summary_ids = sorted_ids[:, :summary_count]
            summary_padding = summary_ids == config.maximum_bars
            safe_summary_ids = summary_ids.clamp_max(config.maximum_bars - 1)
            summaries = (
                self.bar_summary(safe_summary_ids)
                + self.embeddings["stream"](
                    torch.full_like(safe_summary_ids, 2)
                )
            )

            encoded = self.encoder(
                torch.cat((frame_tokens, summaries), dim=1),
                src_key_padding_mask=torch.cat(
                    (frame_padding, summary_padding),
                    dim=1,
                ),
            )
            harmony_states = encoded[:, 1 : frame_tokens.shape[1] : 2, :]
            return {
                name: head(harmony_states)
                for name, head in self.heads.items()
            }

    model = HarmonyForgeBiMask()
    actual = sum(parameter.numel() for parameter in model.parameters())
    expected = config.estimated_parameter_count()
    if actual != expected:
        raise RuntimeError(
            f"Architecture parameter count drifted: expected {expected}, got {actual}"
        )
    return model


def tensor_batch(
    window: Any,
    *,
    torch_module: Any,
    device: str,
) -> dict[str, Any]:
    """Convert one plain tokenizer window without hidden global RNG state."""

    torch = torch_module
    values = {
        "melody_midi": window.melody_midi,
        "melody_role": window.melody_role,
        "metrical_slot": window.metrical_slot,
        "bar_index": window.bar_index,
        "key_root": window.key_root,
        "mode": window.mode,
        "harmony_event": window.harmony_event,
        "harmony_root": window.harmony_root,
        "harmony_quality": window.harmony_quality,
        "harmony_inversion": window.harmony_inversion,
        "harmony_bass": window.harmony_bass,
        "edit_mask": window.edit_mask,
    }
    batch = {
        name: torch.tensor([data], dtype=torch.long, device=device)
        for name, data in values.items()
    }
    batch["padding_mask"] = torch.tensor(
        [window.padding_mask],
        dtype=torch.bool,
        device=device,
    )
    batch["harmony_extensions"] = torch.tensor(
        [window.harmony_extensions],
        dtype=torch.float32,
        device=device,
    )
    return batch
