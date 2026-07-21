"""Bounded, explainable online preference updates for the Phase 2 ranker."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from threading import RLock

from app.schemas.api import (
    PreferenceCategory,
    PreferenceFeedback,
    PreferenceUpdateRequest,
    PreferenceUpdateResponse,
)

_BASE_LEARNING_RATE = 0.05
_MAX_ABS_WEIGHT = 5.0
_MAX_STORED_FEATURES_PER_CATEGORY = 256

# Explicit feedback has more influence than implicit interaction signals.
_FEEDBACK_SIGNALS: dict[PreferenceFeedback, float] = {
    "like": 1.0,
    "dislike": -1.0,
    "favorite": 1.5,
    "abSelected": 1.0,
    "notMyStyle": -1.5,
    "adopted": 0.35,
    "immediateUndo": -0.35,
    "saved": 0.25,
    "midiExported": 0.25,
    "replayed": 0.1,
    "manuallyEdited": -0.1,
}


@dataclass(slots=True)
class _PreferenceState:
    weights: dict[str, float] = field(default_factory=dict)
    evaluation_count: int = 0


class PreferenceCapacityError(RuntimeError):
    """Preference state rejected an unbounded feature expansion."""


class PreferenceStore:
    """Process-local preference state separated by musical category."""

    def __init__(self) -> None:
        self._states: dict[PreferenceCategory, _PreferenceState] = {}
        self._lock = RLock()

    def update(
        self,
        request: PreferenceUpdateRequest,
        *,
        request_id: str = "internal",
    ) -> PreferenceUpdateResponse:
        signal = _FEEDBACK_SIGNALS[request.feedback] * request.weight
        with self._lock:
            state = self._states.setdefault(request.category, _PreferenceState())
            combined_features = state.weights.keys() | request.features.keys()
            if len(combined_features) > _MAX_STORED_FEATURES_PER_CATEGORY:
                raise PreferenceCapacityError(
                    "preference category supports at most 256 distinct features"
                )
            for feature_name in sorted(request.features):
                current = state.weights.get(feature_name, 0.0)
                delta = _BASE_LEARNING_RATE * signal * request.features[feature_name]
                state.weights[feature_name] = _round_weight(
                    max(-_MAX_ABS_WEIGHT, min(_MAX_ABS_WEIGHT, current + delta))
                )
            state.evaluation_count += 1
            confidence = round(1.0 - math.exp(-state.evaluation_count / 12.0), 4)
            return PreferenceUpdateResponse(
                request_id=request_id,
                weights=dict(sorted(state.weights.items())),
                evaluation_count=state.evaluation_count,
                confidence=confidence,
            )

    def get_weights(self, category: PreferenceCategory) -> dict[str, float]:
        with self._lock:
            state = self._states.get(category)
            return {} if state is None else dict(state.weights)


def _round_weight(value: float) -> float:
    rounded = round(value, 8)
    return 0.0 if rounded == 0 else rounded
