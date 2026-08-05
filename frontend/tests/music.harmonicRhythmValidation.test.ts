import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition, validateGeneratorSettings } from "../src/music";
import type { GeneratorSettings, HarmonicRhythmSettings } from "../src/types/music";

/**
 * Harmonic rhythm had no validation at all, so every bad value degraded in
 * silence. Measured before this existed, at 4/4 and four bars:
 *
 *   changesPerBar 2.5, 0, -1, NaN   -> one chord per bar, request discarded
 *   barsPerChord 2 + changesPerBar 4 -> two chords, changesPerBar ignored
 *   changesPerBar 3000               -> 12000 chords, 4320 of zero duration
 *
 * These pin that each of those is now reported, and that the values a caller
 * legitimately uses still pass.
 */

function check(rhythm: HarmonicRhythmSettings, patch: Partial<GeneratorSettings> = {}) {
  return validateGeneratorSettings({
    ...DEFAULT_GENERATOR_SETTINGS,
    ...patch,
    harmonicRhythm: rhythm,
  } as GeneratorSettings);
}

function codes(rhythm: HarmonicRhythmSettings, patch: Partial<GeneratorSettings> = {}) {
  const outcome = check(rhythm, patch);
  return [...outcome.errors, ...outcome.warnings].map((issue) => issue.code);
}

describe("harmonic rhythm validation", () => {
  it("rejects the values that used to fall back to one chord per bar", () => {
    for (const changesPerBar of [2.5, 0, -1, Number.NaN, 0.5, -0]) {
      const outcome = check({ changesPerBar });
      expect(outcome.valid).toBe(false);
      expect(outcome.errors.map((issue) => issue.code))
        .toContain("settings.harmonicRhythm.changesPerBar");
    }
    for (const barsPerChord of [1.5, 0, -2, Number.NaN]) {
      const outcome = check({ barsPerChord });
      expect(outcome.valid).toBe(false);
      expect(outcome.errors.map((issue) => issue.code))
        .toContain("settings.harmonicRhythm.barsPerChord");
    }
  });

  it("names the field that is wrong, not just that something is", () => {
    // A caller fixing the settings needs to know which one to change.
    const outcome = check({ changesPerBar: 2.5, barsPerChord: 1.5 });
    const reported = outcome.errors.map((issue) => issue.code);
    expect(reported).toContain("settings.harmonicRhythm.changesPerBar");
    expect(reported).toContain("settings.harmonicRhythm.barsPerChord");
  });

  it("refuses to hold a chord across bars and subdivide the bar at once", () => {
    const outcome = check({ barsPerChord: 2, changesPerBar: 4 });
    expect(outcome.valid).toBe(false);
    expect(outcome.errors.map((issue) => issue.code))
      .toContain("settings.harmonicRhythm.conflict");
  });

  it("allows either one on its own", () => {
    expect(check({ barsPerChord: 2 }).valid).toBe(true);
    expect(check({ changesPerBar: 4 }).valid).toBe(true);
    // barsPerChord 1 is the default and does not conflict with anything.
    expect(check({ barsPerChord: 1, changesPerBar: 4 }).valid).toBe(true);
  });

  it("rejects a rate that would produce chords of no duration", () => {
    // The measured corruption. 1920 ticks in a 4/4 bar, so 1921 cannot tile it.
    const outcome = check({ changesPerBar: 3000 });
    expect(outcome.valid).toBe(false);
    expect(outcome.errors.map((issue) => issue.code))
      .toContain("settings.harmonicRhythm.changesPerBar");
    expect(check({ changesPerBar: 1921 }).valid).toBe(false);
    expect(check({ changesPerBar: 1920 }).errors).toHaveLength(0);
  });

  it("counts the cadential doubling when checking the rate", () => {
    // The closing bars run at twice the nominal rate, so the peak is what has
    // to fit. Without this the last two bars would be the ones that corrupt.
    expect(check({ changesPerBar: 1920, cadentialAcceleration: true }).valid).toBe(false);
    expect(check({ changesPerBar: 960, cadentialAcceleration: true }).errors).toHaveLength(0);
  });

  it("uses the bar of the actual time signature", () => {
    // A 3/4 bar is 1440 ticks, so a rate legal at 4/4 is not legal here.
    expect(check({ changesPerBar: 1920 }, { timeSignature: "3/4" }).valid).toBe(false);
    expect(check({ changesPerBar: 1440 }, { timeSignature: "3/4" }).errors).toHaveLength(0);
  });

  it("warns about a rate faster than a sixteenth without refusing it", () => {
    // It tiles correctly, so it is not an error. It is also not a harmonic
    // rhythm any more, which is worth saying out loud.
    const outcome = check({ changesPerBar: 32 });
    expect(outcome.valid).toBe(true);
    expect(outcome.warnings.map((issue) => issue.code))
      .toContain("settings.harmonicRhythm.changesPerBar");
    expect(check({ changesPerBar: 4 }).warnings).toHaveLength(0);
  });

  it("rejects a non-boolean acceleration flag", () => {
    const outcome = check({ cadentialAcceleration: 1 as unknown as boolean });
    expect(outcome.valid).toBe(false);
    expect(outcome.errors.map((issue) => issue.code))
      .toContain("settings.harmonicRhythm.cadentialAcceleration");
  });

  it("leaves every value the app and tests actually use alone", () => {
    // If this fails, validation is rejecting working configurations.
    const used: HarmonicRhythmSettings[] = [
      {},
      { changesPerBar: 1 },
      { changesPerBar: 2 },
      { changesPerBar: 2, cadentialAcceleration: true },
      { cadentialAcceleration: true },
      { barsPerChord: 2 },
    ];
    for (const rhythm of used) {
      expect(codes(rhythm)).toEqual([]);
    }
    expect(validateGeneratorSettings(DEFAULT_GENERATOR_SETTINGS).valid).toBe(true);
  });

  it("says nothing at all when harmonic rhythm is absent", () => {
    const outcome = validateGeneratorSettings(DEFAULT_GENERATOR_SETTINGS);
    expect(outcome.errors.filter((issue) => issue.code.startsWith("settings.harmonicRhythm")))
      .toHaveLength(0);
    expect(outcome.warnings.filter((issue) => issue.code.startsWith("settings.harmonicRhythm")))
      .toHaveLength(0);
  });

  it("accepts exactly what the generator can render without zero-length chords", () => {
    // The rule is only worth having if it draws the line where the breakage
    // actually is, so this checks the boundary against the generator itself.
    for (const changesPerBar of [1, 2, 4, 480, 1920]) {
      expect(check({ changesPerBar }).valid).toBe(true);
      const piece = generateComposition({
        ...DEFAULT_GENERATOR_SETTINGS,
        bars: 4,
        seed: "boundary",
        harmonicRhythm: { changesPerBar },
      } as GeneratorSettings);
      expect(piece.chords.every((chord) => chord.durationTick > 0)).toBe(true);
    }
  });
});
