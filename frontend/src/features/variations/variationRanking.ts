import type { VariationCandidate } from "./VariationPanel";

/** Score-descending presentation order with a deterministic source-order tie-break. */
export function sortVariationCandidates(
  candidates: readonly VariationCandidate[],
): VariationCandidate[] {
  return [...candidates].sort((left, right) => {
    const leftScore = left.preference?.rawScore ?? 0;
    const rightScore = right.preference?.rawScore ?? 0;
    return rightScore - leftScore || left.sourceIndex - right.sourceIndex;
  });
}
