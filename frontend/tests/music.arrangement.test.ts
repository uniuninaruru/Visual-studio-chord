import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  generateComposition,
  validateComposition,
} from "../src/music";

describe("multi-voice arrangement", () => {
  it("is deterministic and keeps the lead melody as the backwards-compatible primary voice", () => {
    const settings = {
      ...DEFAULT_GENERATOR_SETTINGS,
      bars: 8 as const,
      seed: "arrangement-deterministic",
      arrangement: {
        counterpoint: {
          enabled: true,
          position: "below" as const,
          independence: 0.8,
        },
        canon: { enabled: true, delayBeats: 2, interval: 7 },
        polyrhythm: { enabled: true, pulses: 3, spanBars: 1 },
      },
    };

    const first = generateComposition(settings);
    const second = generateComposition(settings);
    expect(first).toEqual(second);
    expect(first.notes.length).toBeGreaterThan(0);
    expect(first.voices).toHaveLength(3);
    expect(validateComposition(first).valid).toBe(true);
  });

  it("omits the new schema field when no additional voice is enabled", () => {
    const composition = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      seed: "legacy-single-voice",
    });
    expect(composition.voices).toBeUndefined();
  });
});
