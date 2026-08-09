import { describe, expect, it } from "vitest";
import {
  MINIMAL_GENERATOR_SETTINGS,
  generateComposition,
  phraseForBar,
  phrasesTileBars,
  planPhrases,
  planSections,
  validateComposition,
} from "../src/music";
import type { GeneratorSettings } from "../src/types/music";

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...MINIMAL_GENERATOR_SETTINGS,
    ...patch,
    melody: { ...MINIMAL_GENERATOR_SETTINGS.melody, ...patch.melody },
  };
}

describe("phrase planning", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 12, 16])("tiles %i bars exactly", (bars) => {
    const phrases = planPhrases({ bars, seed: "s" });
    expect(phrasesTileBars(phrases, bars)).toBe(true);
  });

  it("covers a span with no explicit layout", () => {
    for (const bars of [9, 10, 11, 13, 20]) {
      const phrases = planPhrases({ bars, seed: "s" });
      expect(phrasesTileBars(phrases, bars)).toBe(true);
    }
  });

  it("builds the classical sentence over eight bars", () => {
    const phrases = planPhrases({ bars: 8, seed: "s" });
    expect(phrases.map((phrase) => phrase.function)).toEqual([
      "presentation",
      "response",
      "fragmentation",
      "cadential",
    ]);
    expect(phrases.map((phrase) => [phrase.startBar, phrase.endBar])).toEqual([
      [0, 2], [2, 4], [4, 6], [6, 8],
    ]);
  });

  it("always closes on a cadential phrase", () => {
    for (const bars of [2, 4, 6, 8, 16]) {
      expect(planPhrases({ bars, seed: "s" }).at(-1)!.function).toBe("cadential");
    }
  });

  it("only lets the cadential phrase close firmly", () => {
    const phrases = planPhrases({ bars: 8, seed: "s" });
    for (const phrase of phrases) {
      if (phrase.function === "cadential") expect(phrase.cadenceStrength).toBe(1);
      else expect(phrase.cadenceStrength).toBeLessThan(0.5);
    }
    // Fragmentation drives toward the cadence, so it closes least of all.
    const fragmentation = phrases.find((p) => p.function === "fragmentation")!;
    expect(fragmentation.cadenceStrength).toBeLessThanOrEqual(
      Math.min(...phrases.filter((p) => p.function !== "fragmentation")
        .map((p) => p.cadenceStrength)),
    );
  });

  it("keeps every climax inside the phrase", () => {
    for (const phrase of planPhrases({ bars: 16, seed: "s" })) {
      expect(phrase.climaxPosition).toBeGreaterThan(0);
      expect(phrase.climaxPosition).toBeLessThan(1);
    }
  });

  it("never lets a phrase cross a section boundary", () => {
    const sections = planSections({
      key: "C", mode: "major", bars: 16, seed: "s", form: "verseChorus",
    })!;
    const phrases = planPhrases({ bars: 16, seed: "s", sections });
    expect(phrasesTileBars(phrases, 16)).toBe(true);
    for (const phrase of phrases) {
      const section = sections.find(
        (s) => phrase.startBar >= s.startBar && phrase.startBar < s.endBar,
      )!;
      expect(phrase.endBar).toBeLessThanOrEqual(section.endBar);
    }
  });

  it("resolves the phrase covering each bar", () => {
    const phrases = planPhrases({ bars: 8, seed: "s" });
    for (let bar = 0; bar < 8; bar += 1) {
      const phrase = phraseForBar(phrases, bar)!;
      expect(bar).toBeGreaterThanOrEqual(phrase.startBar);
      expect(bar).toBeLessThan(phrase.endBar);
    }
    expect(phraseForBar(phrases, 8)).toBeUndefined();
    expect(phraseForBar(undefined, 0)).toBeUndefined();
  });

  it("is deterministic", () => {
    const plan = () => planPhrases({ bars: 16, seed: "fixed" });
    expect(plan()).toEqual(plan());
  });

  it("rejects plans that do not tile", () => {
    const phrases = planPhrases({ bars: 8, seed: "s" });
    expect(phrasesTileBars(phrases, 16)).toBe(false);
    expect(phrasesTileBars([], 8)).toBe(false);
    const gapped = phrases.map((p, i) =>
      i === 1 ? { ...p, startBar: p.startBar + 1 } : p,
    );
    expect(phrasesTileBars(gapped, 8)).toBe(false);
  });
});

describe("phrase grammar in generated melodies", () => {
  it("changes the melody it produces", () => {
    const plain = generateComposition(settings({ bars: 8, seed: "pg" }));
    const shaped = generateComposition(
      settings({ bars: 8, seed: "pg", phraseGrammar: { enabled: true } }),
    );
    expect(shaped.notes).not.toEqual(plain.notes);
  });

  it("leaves the melody untouched when disabled", () => {
    const plain = generateComposition(settings({ bars: 8, seed: "pg" }));
    const off = generateComposition(
      settings({ bars: 8, seed: "pg", phraseGrammar: { enabled: false } }),
    );
    expect(off.notes).toEqual(plain.notes);
  });

  it("stays valid at every bar count, with and without a song form", () => {
    for (const bars of [4, 8, 16] as const) {
      const plain = generateComposition(
        settings({ bars, seed: `p-${bars}`, phraseGrammar: { enabled: true } }),
      );
      expect(validateComposition(plain).errors).toEqual([]);

      const sectioned = generateComposition(
        settings({
          bars,
          seed: `s-${bars}`,
          phraseGrammar: { enabled: true },
          songForm: { form: "verseChorus", finalLift: 2 },
        }),
      );
      expect(validateComposition(sectioned).errors).toEqual([]);
    }
  });

  it("composes with harmonic rhythm", () => {
    const composition = generateComposition(
      settings({
        bars: 8,
        seed: "both",
        phraseGrammar: { enabled: true },
        harmonicRhythm: { changesPerBar: 2, cadentialAcceleration: true },
      }),
    );
    expect(validateComposition(composition).errors).toEqual([]);
  });

  it("is deterministic", () => {
    const make = () =>
      generateComposition(settings({ bars: 8, seed: "fixed", phraseGrammar: { enabled: true } }));
    expect(make()).toEqual(make());
  });

  it("distinguishes two pieces that differ only by the grammar", () => {
    const plain = generateComposition(settings({ seed: "same" }));
    const shaped = generateComposition(
      settings({ seed: "same", phraseGrammar: { enabled: true } }),
    );
    expect(shaped.id).not.toBe(plain.id);
  });
});
