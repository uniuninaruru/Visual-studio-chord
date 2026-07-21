import type { GeneratedComposition } from "../types/music";

export const PREFERENCE_MODEL_VERSION = 1 as const;
export const PREFERENCE_FEATURE_VERSION = 1 as const;

export const PREFERENCE_CATEGORIES = [
  "harmony",
  "melody",
  "rhythm",
  "voicing",
  "combined",
] as const;

export type PreferenceCategory = (typeof PREFERENCE_CATEGORIES)[number];

/** Sparse numeric map. Extractors bound candidate feature values to [-1, 1]. */
export type FeatureVector = Record<string, number>;

export interface PreferenceFeatureSet {
  version: typeof PREFERENCE_FEATURE_VERSION;
  compositionId: GeneratedComposition["id"];
  harmony: FeatureVector;
  melody: FeatureVector;
  rhythm: FeatureVector;
  voicing: FeatureVector;
  /** Harmony, melody, rhythm, and voicing features with category prefixes. */
  combined: FeatureVector;
}

export type ExplicitFeedbackType =
  | "like"
  | "dislike"
  | "favorite"
  | "notMyStyle";

export type ImplicitFeedbackType =
  | "previewed"
  | "playbackCompleted"
  | "editAccepted"
  | "exported"
  | "regenerated"
  | "skipped";

interface CategorizedFeedback {
  /** Whole-composition feedback defaults to the combined model. */
  category?: PreferenceCategory;
}

export interface ExplicitPreferenceFeedback extends CategorizedFeedback {
  type: ExplicitFeedbackType;
  features: PreferenceFeatureSet;
}

export interface ABPreferenceFeedback extends CategorizedFeedback {
  type: "ab";
  winner: PreferenceFeatureSet;
  loser: PreferenceFeatureSet;
}

export interface ImplicitPreferenceFeedback extends CategorizedFeedback {
  type: "implicit";
  event: ImplicitFeedbackType;
  features: PreferenceFeatureSet;
}

export type PreferenceFeedback =
  | ExplicitPreferenceFeedback
  | ABPreferenceFeedback
  | ImplicitPreferenceFeedback;

export interface FeatureEvidence {
  /** Number of feedback events in which this feature affected an update. */
  observations: number;
  positiveWeight: number;
  negativeWeight: number;
  netSignal: number;
}

export interface CategoryPreferenceModel {
  weights: FeatureVector;
  bias: number;
  feedbackCount: number;
  /** Explicit feedback contributes roughly 1; implicit feedback contributes <= 0.12. */
  effectiveEvidence: number;
  /** Deterministic 0..1 estimate derived from effectiveEvidence. */
  confidence: number;
  evidence: Record<string, FeatureEvidence>;
}

export interface PreferenceModel {
  version: typeof PREFERENCE_MODEL_VERSION;
  categories: Record<PreferenceCategory, CategoryPreferenceModel>;
}

export interface PreferenceScore {
  category: PreferenceCategory;
  /** Bounded -1..1 score. Positive means the candidate matches learned taste. */
  score: number;
  rawScore: number;
  confidence: number;
  feedbackCount: number;
}

export interface PreferenceReason {
  feature: string;
  label: string;
  direction: "prefer" | "avoid";
  contribution: number;
  evidenceCount: number;
  evidenceWeight: number;
}

export interface PreferenceExplanation {
  category: PreferenceCategory;
  status: "insufficientEvidence" | "ready";
  summary: string;
  confidence: number;
  feedbackCount: number;
  reasons: PreferenceReason[];
}
