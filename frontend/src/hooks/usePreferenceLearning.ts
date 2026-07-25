import { useCallback } from "react";
import { updateServerPreference } from "../api/inferenceClient";
import type { PreferenceProfileController } from "./usePreferenceProfile";
import {
  type ExplicitFeedbackType,
  type PreferenceCategory,
  type PreferenceFeatureSet,
} from "../preference";

const FEEDBACK_LABELS: Record<ExplicitFeedbackType, string> = {
  like: "Like",
  dislike: "Dislike",
  favorite: "Favorite",
  notMyStyle: "Not my style",
};

/** The server names the harmony category differently from the client. */
function serverPreferenceCategory(category: PreferenceCategory) {
  return category === "harmony" ? "chords" as const : category;
}

function featureVector(features: PreferenceFeatureSet, category: PreferenceCategory) {
  return features[category];
}

export type PreferenceSyncFeedback =
  | "like"
  | "dislike"
  | "favorite"
  | "notMyStyle"
  | "abSelected"
  | "adopted";

export interface PreferenceLearningOptions {
  preferenceProfile: PreferenceProfileController;
  preferenceCategory: PreferenceCategory;
  candidateFeatureSets: readonly PreferenceFeatureSet[];
  currentPreferenceFeatures: PreferenceFeatureSet;
  /** True when the local server is reachable and authorised. */
  backendCanInfer: boolean;
  /** Adopting a candidate is a store operation; returns whether it applied. */
  adoptPreviewVariation: (index: number) => boolean;
  onPreferenceChanged: () => void;
  onToast: (message: string) => void;
}

export interface PreferenceLearning {
  recordCandidateFeedback: (index: number, feedback: ExplicitFeedbackType) => void;
  adoptCandidate: (index: number) => void;
}

/**
 * Owns explicit preference feedback and how it reaches the local server.
 *
 * Learning is always recorded in the browser first: the server sync is an
 * optimisation, and its failure is reported without losing the feedback.
 */
export function usePreferenceLearning(
  options: PreferenceLearningOptions,
): PreferenceLearning {
  const {
    preferenceProfile,
    preferenceCategory,
    candidateFeatureSets,
    currentPreferenceFeatures,
    backendCanInfer,
    adoptPreviewVariation,
    onPreferenceChanged,
    onToast,
  } = options;

  const syncToServer = useCallback((
    features: PreferenceFeatureSet,
    feedback: PreferenceSyncFeedback,
  ) => {
    if (!backendCanInfer) return;
    void updateServerPreference(
      serverPreferenceCategory(preferenceCategory),
      feedback,
      featureVector(features, preferenceCategory),
    ).catch(() => {
      onToast("評価はこのブラウザに保存しました。ローカル推論サーバーへの同期だけ失敗しました。");
    });
  }, [backendCanInfer, onToast, preferenceCategory]);

  const recordCandidateFeedback = useCallback((
    index: number,
    feedback: ExplicitFeedbackType,
  ) => {
    const features = candidateFeatureSets[index];
    if (!features) return;
    preferenceProfile.record({ type: feedback, features, category: preferenceCategory });
    syncToServer(features, feedback);
    onPreferenceChanged();
    onToast(`${FEEDBACK_LABELS[feedback]} を記録しました。根拠が十分になるまで好みを断定しません。`);
  }, [
    candidateFeatureSets,
    onPreferenceChanged,
    onToast,
    preferenceCategory,
    preferenceProfile,
    syncToServer,
  ]);

  const adoptCandidate = useCallback((index: number) => {
    const winner = candidateFeatureSets[index];
    if (!winner) return;
    // Adopting is an A/B choice: the adopted candidate beat what was on screen.
    preferenceProfile.record({
      type: "ab",
      winner,
      loser: currentPreferenceFeatures,
      category: preferenceCategory,
    });
    syncToServer(winner, "abSelected");
    if (adoptPreviewVariation(index)) {
      onPreferenceChanged();
      onToast(`候補 ${String.fromCharCode(65 + index)} を採用し、履歴へ保存しました。Undoで戻せます。`);
    }
  }, [
    adoptPreviewVariation,
    candidateFeatureSets,
    currentPreferenceFeatures,
    onPreferenceChanged,
    onToast,
    preferenceCategory,
    preferenceProfile,
    syncToServer,
  ]);

  return { recordCandidateFeedback, adoptCandidate };
}
