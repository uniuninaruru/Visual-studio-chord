"""Deterministic masking curriculum without global random state or PyTorch."""

from __future__ import annotations

import hashlib
import random
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

MaskKind = Literal[
    "fullHarmony",
    "contiguousRange",
    "disjointRanges",
    "randomFrames",
    "causalSuffix",
]
MASK_KINDS: tuple[MaskKind, ...] = (
    "fullHarmony",
    "contiguousRange",
    "disjointRanges",
    "randomFrames",
    "causalSuffix",
)


@dataclass(frozen=True, slots=True)
class MaskPlan:
    kind: MaskKind
    masked: tuple[bool, ...]

    def __post_init__(self) -> None:
        if not self.masked or not any(self.masked):
            raise ValueError("a mask plan must hide at least one frame")


def curriculum_mask(
    bar_indices: Sequence[int],
    *,
    seed: str,
    epoch: int,
    example_id: str,
    kind: MaskKind | None = None,
) -> MaskPlan:
    """Return a stable mask for one example and epoch."""

    if not bar_indices:
        raise ValueError("bar_indices must not be empty")
    if epoch < 0:
        raise ValueError("epoch must not be negative")
    material = f"{seed}:{epoch}:{example_id}"
    digest = hashlib.sha256(material.encode("utf-8")).digest()
    selected_kind = kind or MASK_KINDS[int.from_bytes(digest[:4], "big") % len(MASK_KINDS)]
    if selected_kind not in MASK_KINDS:
        raise ValueError("unknown mask kind")
    rng = random.Random(int.from_bytes(digest, "big"))
    frame_count = len(bar_indices)

    if selected_kind == "fullHarmony":
        masked = [True] * frame_count
    elif selected_kind == "randomFrames":
        probability = 0.15 + 0.35 * rng.random()
        masked = [rng.random() < probability for _ in bar_indices]
    elif selected_kind == "causalSuffix":
        first = rng.randrange(frame_count)
        masked = [index >= first for index in range(frame_count)]
    else:
        bars = sorted(set(bar_indices))
        if selected_kind == "contiguousRange":
            first_bar = rng.randrange(len(bars))
            length = rng.randint(1, max(1, len(bars) - first_bar))
            selected_bars = set(bars[first_bar : first_bar + length])
        else:
            count = min(len(bars), max(1, round(len(bars) / 3)))
            selected_bars = set(rng.sample(bars, count))
        masked = [bar in selected_bars for bar in bar_indices]

    if not any(masked):
        masked[rng.randrange(frame_count)] = True
    return MaskPlan(kind=selected_kind, masked=tuple(masked))
