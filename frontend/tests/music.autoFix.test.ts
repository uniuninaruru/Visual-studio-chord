import { describe, expect, it } from "vitest";
import {
  createAutoFixPreview,
  DEFAULT_GENERATOR_SETTINGS,
  generateComposition,
  validateComposition,
} from "../src/music";

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
});
