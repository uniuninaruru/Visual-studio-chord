import { featuresForCategory } from "./featureExtraction";
import type {
  PreferenceCategory,
  PreferenceExplanation,
  PreferenceFeatureSet,
  PreferenceModel,
  PreferenceReason,
} from "./types";

const EXACT_LABELS: Readonly<Record<string, string>> = {
  "harmony.quality.tension": "コードの緊張感",
  "harmony.quality.seventhRate": "セブンスコードの割合",
  "harmony.source.nonDiatonicRate": "ノンダイアトニックコード",
  "harmony.source.specialRate": "特殊なコードソース",
  "harmony.rootMotion.mean": "ルート移動の大きさ",
  "harmony.rootMotion.commonToneRate": "コード間の共通音",
  "melody.chordToneRate": "メロディのコードトーン率",
  "melody.leapRate": "メロディの跳躍",
  "melody.largeLeapRate": "大きな跳躍",
  "melody.density": "メロディ密度",
  "rhythm.onsetDensity": "音の開始密度",
  "rhythm.offbeatRate": "オフビート率",
  "rhythm.syncopationRate": "シンコペーション率",
  "voicing.inversionRate": "転回形の割合",
  "voicing.meanSpan": "ボイシングの広がり",
  "voicing.voiceLeadingMotion": "ボイスリーディングの移動量",
  "voicing.commonToneRate": "ボイシング間の共通音",
};

function labelFor(feature: string, category: PreferenceCategory): string {
  const qualified = category === "combined" ? feature : `${category}.${feature}`;
  if (EXACT_LABELS[qualified]) return EXACT_LABELS[qualified];
  const unprefixed = category === "combined" ? feature.replace(/^[^.]+\./, "") : feature;
  if (unprefixed.startsWith("roman.")) {
    return `コード進行 ${unprefixed.split(".").slice(2).join(" → ")}`;
  }
  if (unprefixed.startsWith("cadence.")) {
    return `カデンツ ${unprefixed.slice("cadence.".length)}`;
  }
  if (unprefixed.startsWith("function.")) {
    return `和声機能 ${unprefixed.slice("function.".length)}`;
  }
  if (unprefixed.startsWith("quality.")) {
    return `コード品質 ${unprefixed.slice("quality.".length)}`;
  }
  if (unprefixed.startsWith("source.")) {
    return `コード由来 ${unprefixed.slice("source.".length)}`;
  }
  return qualified;
}

/** Builds explanations only from features that have recorded feedback evidence. */
export function explainPreference(
  model: PreferenceModel,
  features: PreferenceFeatureSet,
  category: PreferenceCategory = "combined",
  maximumReasons = 3,
): PreferenceExplanation {
  const categoryModel = model.categories[category];
  const vector = featuresForCategory(features, category);
  const reasons: PreferenceReason[] = [];
  for (const [feature, value] of Object.entries(vector)) {
    const evidence = categoryModel.evidence[feature];
    const weight = categoryModel.weights[feature] ?? 0;
    const contribution = weight * value;
    if (!evidence || evidence.observations === 0 || Math.abs(contribution) < 1e-9) continue;
    reasons.push({
      feature,
      label: labelFor(feature, category),
      direction: contribution >= 0 ? "prefer" : "avoid",
      contribution: Number(contribution.toFixed(6)),
      evidenceCount: evidence.observations,
      evidenceWeight: Number(
        (evidence.positiveWeight + evidence.negativeWeight).toFixed(6),
      ),
    });
  }
  reasons.sort((left, right) =>
    Math.abs(right.contribution) - Math.abs(left.contribution) ||
    (left.feature < right.feature ? -1 : left.feature > right.feature ? 1 : 0)
  );
  const limitedReasons = reasons.slice(0, Math.max(0, Math.trunc(maximumReasons)));
  const ready = categoryModel.effectiveEvidence >= 1 && limitedReasons.length > 0;
  return {
    category,
    status: ready ? "ready" : "insufficientEvidence",
    summary: ready
      ? `${categoryModel.feedbackCount}件のフィードバックに基づく傾向です。`
      : "説明に必要な明示的フィードバックがまだ不足しています。",
    confidence: categoryModel.confidence,
    feedbackCount: categoryModel.feedbackCount,
    reasons: limitedReasons,
  };
}
