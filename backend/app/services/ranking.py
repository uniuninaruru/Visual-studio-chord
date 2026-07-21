"""Small deterministic scorer compatible with a browser-side linear ranker."""

from app.schemas.api import RankCandidate, RankedCandidate


def linear_score(candidate: RankCandidate, preference_weights: dict[str, float]) -> float:
    return sum(
        candidate.features[name] * preference_weights.get(name, 0.0)
        for name in sorted(candidate.features)
    )


def rank_candidates(
    candidates: list[RankCandidate],
    preference_weights: dict[str, float],
) -> list[RankedCandidate]:
    """Rank candidates by a plain dot product and a stable ID tie-break.

    Iterating sorted feature names and rounding the public score makes repeated
    requests stable. With no learned weights every score is neutral (0.0).
    """

    scored: list[RankedCandidate] = []
    for candidate in candidates:
        score = linear_score(candidate, preference_weights)
        public_score = round(score, 8)
        if public_score == 0:
            public_score = 0.0
        scored.append(RankedCandidate(id=candidate.id, score=public_score))

    return sorted(scored, key=lambda item: (-item.score, item.id))
