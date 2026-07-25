import { useCallback, useMemo, useState } from "react";
import { sortVariationCandidates } from "../features/variations/variationRanking";
import type { VariationCandidate } from "../features/variations/VariationPanel";
import {
  scorePreference,
  type PreferenceCategory,
  type PreferenceFeatureSet,
  type PreferenceModel,
} from "../preference";
import type { GeneratedComposition } from "../types/music";

export interface RankInfo {
  runtime: string;
  batchSize: number | null;
  fallback: string | null;
}

export interface CandidateRankingOptions {
  previewVariations: readonly GeneratedComposition[];
  candidateFeatureSets: readonly PreferenceFeatureSet[];
  preferenceModel: PreferenceModel;
  preferenceCategory: PreferenceCategory;
}

export interface CandidateRanking {
  /** Candidates in display order, carrying their preference score. */
  candidates: VariationCandidate[];
  /** Scores from the local server, empty when it ranked in the browser. */
  serverScores: Record<string, number>;
  setServerScores: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  rankingRuntime: string;
  setRankingRuntime: React.Dispatch<React.SetStateAction<string>>;
  lastRankInfo: RankInfo | null;
  setLastRankInfo: React.Dispatch<React.SetStateAction<RankInfo | null>>;
  /** Drops cached scores; call whenever the preference model changes. */
  clearServerScores: () => void;
}

/**
 * Owns how candidates are ordered for display.
 *
 * Ranking has two sources: the local inference server when it is reachable, and
 * a deterministic browser scorer otherwise. Server scores are cached here and
 * are only valid for the model state that produced them, so anything that
 * changes the preference profile must clear them.
 */
export function useCandidateRanking(
  options: CandidateRankingOptions,
): CandidateRanking {
  const {
    previewVariations,
    candidateFeatureSets,
    preferenceModel,
    preferenceCategory,
  } = options;

  const [serverScores, setServerScores] = useState<Record<string, number>>({});
  const [rankingRuntime, setRankingRuntime] = useState<string>("browser");
  const [lastRankInfo, setLastRankInfo] = useState<RankInfo | null>(null);

  const clearServerScores = useCallback(() => setServerScores({}), []);

  const candidates = useMemo(() => {
    const scored = previewVariations.map((candidate, index) => {
      const features = candidateFeatureSets[index] as PreferenceFeatureSet;
      const local = scorePreference(preferenceModel, features, preferenceCategory);
      const serverScore = serverScores[candidate.id];
      return {
        composition: candidate,
        sourceIndex: index,
        // The server returns an unbounded score; squashing it keeps the display
        // on the same scale as the browser scorer's output.
        preference: serverScore === undefined
          ? local
          : { ...local, rawScore: serverScore, score: Math.tanh(serverScore) },
      };
    });
    return sortVariationCandidates(scored);
  }, [
    candidateFeatureSets,
    preferenceCategory,
    preferenceModel,
    previewVariations,
    serverScores,
  ]);

  return {
    candidates,
    serverScores,
    setServerScores,
    rankingRuntime,
    setRankingRuntime,
    lastRankInfo,
    setLastRankInfo,
    clearServerScores,
  };
}
