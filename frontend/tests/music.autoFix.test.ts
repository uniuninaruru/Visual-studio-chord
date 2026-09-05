import { describe, expect, it } from "vitest";
import {
  createAutoFixPreview,
  createDefaultSectionArrangement,
  DEFAULT_GENERATOR_SETTINGS,
  generateComposition,
  validateComposition,
} from "../src/music";
import type { GeneratedComposition } from "../src/types/music";

describe("Auto Fix", () => {
  it("creates a deterministic valid preview without mutating the source", () => {
    const source = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      bars: 8,
      seed: "auto-fix",
    });
    const before = structuredClone(source);
    const first = createAutoFixPreview(source);
    const second = createAutoFixPreview(source);

    expect(source).toEqual(before);
    expect(first).toEqual(second);
    expect(first.changes.length).toBeGreaterThan(0);
    expect(first.preview.settings.phraseGrammar?.enabled).toBe(true);
    expect(first.preview.settings.melodicSkeleton?.enabled).toBe(true);
    expect(first.preview.settings.voiceLeading?.enabled).toBe(true);
    expect(first.preview.voices?.some((voice) => voice.role === "countermelody")).toBe(true);
    expect(validateComposition(first.preview).valid).toBe(true);
    expect(first.checks).toContain("対旋律チェック: 重大な問題0件");
  });

  it("enables section-local TIS when Auto Fix has an automatic song form", () => {
    const source = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      bars: 8,
      seed: "auto-fix-tis",
      songForm: { form: "verseChorus" },
      functionalHarmony: { enabled: false },
      tonalTension: { enabled: false },
    });
    const result = createAutoFixPreview(source);
    expect(result.preview.settings.functionalHarmony?.enabled).toBe(true);
    expect(result.preview.settings.tonalTension?.enabled).toBe(true);
    expect(validateComposition(result.preview).valid).toBe(true);
    expect(createAutoFixPreview(source)).toEqual(result);
    expect(result.changes.find((change) => change.id === "tonal-tension")).toEqual({
      id: "tonal-tension",
      label: "セクションの緊張カーブを整える",
      reason: "曲の構造があるため、機能和声の候補をTISでセクションごとに比較します。",
    });
  });

  it("does not enable TIS for a flat, explicit, or assembled composition", () => {
    const flat = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      bars: 8,
      seed: "auto-fix-flat",
      tonalTension: { enabled: false },
      songForm: { form: "none" },
    });
    const explicit = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      bars: 8,
      seed: "auto-fix-explicit",
      tonalTension: { enabled: false },
      songForm: { form: "verseChorus" },
      progressionId: "fifties",
    });
    const assembled = {
      ...flat,
      seed: "auto-fix-assembled",
      arrangementPlan: createDefaultSectionArrangement(flat.settings),
    } satisfies GeneratedComposition;
    const cases: GeneratedComposition[] = [flat, explicit, assembled];
    for (const source of cases) {
      const result = createAutoFixPreview(source);
      expect(result.preview.settings.tonalTension?.enabled).not.toBe(true);
      expect(result.changes.some((change) => change.id === "tonal-tension")).toBe(false);
    }
  });
});
