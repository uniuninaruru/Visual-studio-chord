import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import {
  MAX_PREFERENCE_BIAS,
  MAX_PREFERENCE_WEIGHT,
  createPreferenceModel,
  explainPreference,
  extractPreferenceFeatures,
  isPreferenceModel,
  rankByPreference,
  scorePreference,
  updatePreferenceModel,
} from "../src/preference";

function features(seed: string) {
  return extractPreferenceFeatures(generateComposition({
    ...DEFAULT_GENERATOR_SETTINGS,
    seed,
    bars: 4,
    melody: { ...DEFAULT_GENERATOR_SETTINGS.melody },
    harmony: DEFAULT_GENERATOR_SETTINGS.harmony
      ? { ...DEFAULT_GENERATOR_SETTINGS.harmony }
      : undefined,
    motif: DEFAULT_GENERATOR_SETTINGS.motif
      ? { ...DEFAULT_GENERATOR_SETTINGS.motif }
      : undefined,
  }));
}

describe("online preference model", () => {
  it("starts neutral and performs immutable deterministic explicit updates", () => {
    const candidate = features("liked-candidate");
    const initial = createPreferenceModel();
    const first = updatePreferenceModel(initial, { type: "like", features: candidate });
    const second = updatePreferenceModel(initial, { type: "like", features: candidate });
    expect(first).toEqual(second);
    expect(initial).toEqual(createPreferenceModel());
    expect(scorePreference(initial, candidate).score).toBe(0);
    expect(scorePreference(first, candidate).score).toBeGreaterThan(0);
    expect(first.categories.combined.feedbackCount).toBe(1);
    expect(first.categories.combined.confidence).toBeGreaterThan(0);
    expect(isPreferenceModel(first)).toBe(true);
  });

  it.each([
    ["like", 1],
    ["favorite", 1],
    ["dislike", -1],
    ["notMyStyle", -1],
  ] as const)("maps %s to the expected score direction", (type, direction) => {
    const candidate = features(`signal-${type}`);
    const updated = updatePreferenceModel(createPreferenceModel(), { type, features: candidate });
    expect(Math.sign(scorePreference(updated, candidate).score)).toBe(direction);
  });

  it("keeps implicit behavior low weight and confidence below explicit feedback", () => {
    const candidate = features("implicit-weight");
    const explicit = updatePreferenceModel(createPreferenceModel(), {
      type: "like",
      features: candidate,
    });
    const implicit = updatePreferenceModel(createPreferenceModel(), {
      type: "implicit",
      event: "exported",
      features: candidate,
    });
    const explicitMagnitude = Math.max(...Object.values(explicit.categories.combined.weights).map(Math.abs));
    const implicitMagnitude = Math.max(...Object.values(implicit.categories.combined.weights).map(Math.abs));
    expect(explicitMagnitude).toBeGreaterThan(implicitMagnitude * 8);
    expect(implicit.categories.combined.effectiveEvidence).toBe(0.12);
    expect(implicit.categories.combined.confidence).toBeLessThan(explicit.categories.combined.confidence);
  });

  it("updates only the selected category", () => {
    const candidate = features("harmony-only");
    const updated = updatePreferenceModel(createPreferenceModel(), {
      type: "favorite",
      category: "harmony",
      features: candidate,
    });
    expect(updated.categories.harmony.feedbackCount).toBe(1);
    expect(scorePreference(updated, candidate, "harmony").score).toBeGreaterThan(0);
    for (const category of ["melody", "rhythm", "voicing", "combined"] as const) {
      expect(updated.categories[category].feedbackCount).toBe(0);
      expect(updated.categories[category].weights).toEqual({});
    }
  });

  it("learns a winner-minus-loser A/B preference without a bias update", () => {
    const winner = features("ab-winner");
    const loser = features("ab-loser");
    winner.harmony["test.contrast"] = 1;
    loser.harmony["test.contrast"] = 0;
    const updated = updatePreferenceModel(createPreferenceModel(), {
      type: "ab",
      category: "harmony",
      winner,
      loser,
    });
    expect(updated.categories.harmony.bias).toBe(0);
    expect(scorePreference(updated, winner, "harmony").score).toBeGreaterThan(
      scorePreference(updated, loser, "harmony").score,
    );
  });

  it("bounds repeated online updates", () => {
    const candidate = features("bounded");
    let model = createPreferenceModel();
    for (let index = 0; index < 250; index += 1) {
      model = updatePreferenceModel(model, { type: "favorite", features: candidate });
    }
    expect(Math.max(...Object.values(model.categories.combined.weights))).toBeLessThanOrEqual(
      MAX_PREFERENCE_WEIGHT,
    );
    expect(model.categories.combined.bias).toBeLessThanOrEqual(MAX_PREFERENCE_BIAS);
    expect(model.categories.combined.confidence).toBeLessThanOrEqual(1);
    expect(isPreferenceModel(model)).toBe(true);
  });

  it("creates evidence-backed explanations and avoids claims before evidence", () => {
    const candidate = features("explanation");
    const initial = explainPreference(createPreferenceModel(), candidate);
    expect(initial.status).toBe("insufficientEvidence");
    expect(initial.reasons).toEqual([]);

    const learned = updatePreferenceModel(createPreferenceModel(), {
      type: "like",
      features: candidate,
    });
    const explanation = explainPreference(learned, candidate, "combined", 2);
    expect(explanation.status).toBe("ready");
    expect(explanation.reasons).toHaveLength(2);
    expect(explanation.reasons.every((reason) => reason.evidenceCount === 1)).toBe(true);
    expect(explanation.reasons.every((reason) => reason.evidenceWeight > 0)).toBe(true);
  });

  it("ranks candidates deterministically with score metadata", () => {
    const preferred = features("ranking-preferred");
    const alternative = features("ranking-alternative");
    const model = updatePreferenceModel(createPreferenceModel(), {
      type: "like",
      features: preferred,
    });
    const ranked = rankByPreference(model, [
      { id: "alternative", features: alternative },
      { id: "preferred", features: preferred },
    ]);
    expect(ranked[0]!.preference.score).toBeGreaterThanOrEqual(ranked[1]!.preference.score);
    expect(ranked.map((candidate) => candidate.id)).toContain("preferred");
  });
});
