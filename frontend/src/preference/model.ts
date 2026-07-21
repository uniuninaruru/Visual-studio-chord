import { featuresForCategory } from "./featureExtraction";
import {
  PREFERENCE_CATEGORIES,
  PREFERENCE_MODEL_VERSION,
  type CategoryPreferenceModel,
  type FeatureEvidence,
  type FeatureVector,
  type PreferenceCategory,
  type PreferenceFeatureSet,
  type PreferenceFeedback,
  type PreferenceModel,
  type PreferenceScore,
} from "./types";

export const MAX_PREFERENCE_WEIGHT = 3;
export const MAX_PREFERENCE_BIAS = 1;
export const PREFERENCE_LEARNING_RATE = 0.18;

const EXPLICIT_SIGNAL = {
  like: 1,
  dislike: -1,
  favorite: 1.4,
  notMyStyle: -1.3,
} as const;

/** Implicit signals are intentionally at least 8x weaker than explicit feedback. */
export const IMPLICIT_FEEDBACK_SIGNAL = {
  previewed: 0.03,
  playbackCompleted: 0.08,
  editAccepted: 0.06,
  exported: 0.12,
  regenerated: -0.04,
  skipped: -0.1,
} as const;

function round(value: number): number {
  return Number(value.toFixed(12));
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(minimum, value));
}

function featureValue(value: number | undefined): number {
  return clamp(value ?? 0, -1, 1);
}

function emptyCategoryModel(): CategoryPreferenceModel {
  return {
    weights: {},
    bias: 0,
    feedbackCount: 0,
    effectiveEvidence: 0,
    confidence: 0,
    evidence: {},
  };
}

export function createPreferenceModel(): PreferenceModel {
  return {
    version: PREFERENCE_MODEL_VERSION,
    categories: {
      harmony: emptyCategoryModel(),
      melody: emptyCategoryModel(),
      rhythm: emptyCategoryModel(),
      voicing: emptyCategoryModel(),
      combined: emptyCategoryModel(),
    },
  };
}

function cloneEvidence(evidence: FeatureEvidence): FeatureEvidence {
  return { ...evidence };
}

function cloneCategory(model: CategoryPreferenceModel): CategoryPreferenceModel {
  return {
    ...model,
    weights: { ...model.weights },
    evidence: Object.fromEntries(
      Object.entries(model.evidence).map(([feature, evidence]) => [feature, cloneEvidence(evidence)]),
    ),
  };
}

export function clonePreferenceModel(model: PreferenceModel): PreferenceModel {
  return {
    version: PREFERENCE_MODEL_VERSION,
    categories: {
      harmony: cloneCategory(model.categories.harmony),
      melody: cloneCategory(model.categories.melody),
      rhythm: cloneCategory(model.categories.rhythm),
      voicing: cloneCategory(model.categories.voicing),
      combined: cloneCategory(model.categories.combined),
    },
  };
}

function confidenceFor(effectiveEvidence: number): number {
  return round(clamp(1 - Math.exp(-effectiveEvidence / 5), 0, 1));
}

interface VectorUpdate {
  vector: FeatureVector;
  signal: number;
  updateBias: boolean;
}

function vectorDifference(winner: FeatureVector, loser: FeatureVector): FeatureVector {
  const output: FeatureVector = {};
  const keys = new Set([...Object.keys(winner), ...Object.keys(loser)]);
  for (const key of [...keys].sort()) {
    const difference = featureValue(winner[key]) - featureValue(loser[key]);
    if (difference !== 0) output[key] = clamp(difference, -1, 1);
  }
  return output;
}

function feedbackUpdate(feedback: PreferenceFeedback, category: PreferenceCategory): VectorUpdate {
  if (feedback.type === "ab") {
    return {
      vector: vectorDifference(
        featuresForCategory(feedback.winner, category),
        featuresForCategory(feedback.loser, category),
      ),
      signal: 1,
      updateBias: false,
    };
  }
  if (feedback.type === "implicit") {
    return {
      vector: featuresForCategory(feedback.features, category),
      signal: IMPLICIT_FEEDBACK_SIGNAL[feedback.event],
      updateBias: true,
    };
  }
  return {
    vector: featuresForCategory(feedback.features, category),
    signal: EXPLICIT_SIGNAL[feedback.type],
    updateBias: true,
  };
}

function applyVectorUpdate(
  source: CategoryPreferenceModel,
  update: VectorUpdate,
): CategoryPreferenceModel {
  const result = cloneCategory(source);
  const nonZeroEntries = Object.entries(update.vector)
    .map(([feature, value]) => [feature, featureValue(value)] as const)
    .filter(([, value]) => value !== 0)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);

  result.feedbackCount += 1;
  if (nonZeroEntries.length === 0) return result;

  for (const [feature, value] of nonZeroEntries) {
    const signedEvidence = round(update.signal * value);
    const currentWeight = result.weights[feature] ?? 0;
    result.weights[feature] = round(
      clamp(
        currentWeight + PREFERENCE_LEARNING_RATE * signedEvidence,
        -MAX_PREFERENCE_WEIGHT,
        MAX_PREFERENCE_WEIGHT,
      ),
    );
    const currentEvidence = result.evidence[feature] ?? {
      observations: 0,
      positiveWeight: 0,
      negativeWeight: 0,
      netSignal: 0,
    };
    result.evidence[feature] = {
      observations: currentEvidence.observations + 1,
      positiveWeight: round(
        currentEvidence.positiveWeight + Math.max(0, signedEvidence),
      ),
      negativeWeight: round(
        currentEvidence.negativeWeight + Math.max(0, -signedEvidence),
      ),
      netSignal: round(currentEvidence.netSignal + signedEvidence),
    };
  }

  if (update.updateBias) {
    result.bias = round(
      clamp(
        result.bias + PREFERENCE_LEARNING_RATE * update.signal * 0.25,
        -MAX_PREFERENCE_BIAS,
        MAX_PREFERENCE_BIAS,
      ),
    );
  }
  result.effectiveEvidence = round(result.effectiveEvidence + Math.abs(update.signal));
  result.confidence = confidenceFor(result.effectiveEvidence);
  return result;
}

/**
 * Applies one deterministic online update without mutating the previous model.
 * Feedback defaults to `combined`; set `category` for focused learning.
 */
export function updatePreferenceModel(
  model: PreferenceModel,
  feedback: PreferenceFeedback,
): PreferenceModel {
  if (!isPreferenceModel(model)) throw new TypeError("Invalid preference model.");
  const category = feedback.category ?? "combined";
  const next = clonePreferenceModel(model);
  next.categories[category] = applyVectorUpdate(
    model.categories[category],
    feedbackUpdate(feedback, category),
  );
  return next;
}

export function scorePreference(
  model: PreferenceModel,
  features: PreferenceFeatureSet,
  category: PreferenceCategory = "combined",
): PreferenceScore {
  const categoryModel = model.categories[category];
  const vector = featuresForCategory(features, category);
  let rawScore = categoryModel.bias;
  for (const [feature, value] of Object.entries(vector)) {
    rawScore += (categoryModel.weights[feature] ?? 0) * featureValue(value);
  }
  rawScore = round(rawScore);
  return {
    category,
    score: round(Math.tanh(rawScore)),
    rawScore,
    confidence: categoryModel.confidence,
    feedbackCount: categoryModel.feedbackCount,
  };
}

export function rankByPreference<T extends { features: PreferenceFeatureSet }>(
  model: PreferenceModel,
  candidates: readonly T[],
  category: PreferenceCategory = "combined",
): Array<T & { preference: PreferenceScore }> {
  return candidates
    .map((candidate) => ({
      ...candidate,
      preference: scorePreference(model, candidate.features, category),
    }))
    .sort((left, right) =>
      right.preference.score - left.preference.score ||
      (left.features.compositionId < right.features.compositionId
        ? -1
        : left.features.compositionId > right.features.compositionId ? 1 : 0)
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFeatureVector(value: unknown): value is FeatureVector {
  return isRecord(value) && Object.values(value).every(
    (entry) => typeof entry === "number" && Number.isFinite(entry) && Math.abs(entry) <= MAX_PREFERENCE_WEIGHT,
  );
}

function isFeatureEvidence(value: unknown): value is FeatureEvidence {
  return isRecord(value) &&
    Number.isInteger(value.observations) &&
    (value.observations as number) >= 0 &&
    typeof value.positiveWeight === "number" &&
    Number.isFinite(value.positiveWeight) &&
    value.positiveWeight >= 0 &&
    typeof value.negativeWeight === "number" &&
    Number.isFinite(value.negativeWeight) &&
    value.negativeWeight >= 0 &&
    typeof value.netSignal === "number" &&
    Number.isFinite(value.netSignal);
}

function isCategoryPreferenceModel(value: unknown): value is CategoryPreferenceModel {
  return isRecord(value) &&
    isFeatureVector(value.weights) &&
    typeof value.bias === "number" &&
    Number.isFinite(value.bias) &&
    Math.abs(value.bias) <= MAX_PREFERENCE_BIAS &&
    Number.isInteger(value.feedbackCount) &&
    (value.feedbackCount as number) >= 0 &&
    typeof value.effectiveEvidence === "number" &&
    Number.isFinite(value.effectiveEvidence) &&
    value.effectiveEvidence >= 0 &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    isRecord(value.evidence) &&
    Object.values(value.evidence).every(isFeatureEvidence);
}

export function isPreferenceModel(value: unknown): value is PreferenceModel {
  if (!isRecord(value) || value.version !== PREFERENCE_MODEL_VERSION || !isRecord(value.categories)) {
    return false;
  }
  const categories = value.categories;
  return PREFERENCE_CATEGORIES.every((category) =>
    isCategoryPreferenceModel(categories[category])
  );
}
