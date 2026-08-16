import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import { explainChord, explainComposition } from "../src/music/explanation";
import { getProgressionTemplate } from "../src/music/progressions";
import type { GeneratorSettings } from "../src/types/music";

/**
 * The app saying why it did what it did.
 *
 * It always knew: every chord carries its roman numeral, its function, what it
 * was borrowed from, what it resolves to. Measured across 171 chords of the
 * shipped defaults, 44% carried an explanation string and the rest carried
 * none, because validateComposition only requires one where a chord is not
 * diatonic.
 *
 * What is tested here is coverage, provenance, and the two claims that are
 * easy to get subtly wrong and would be believed anyway: that a chord's
 * position in its progression is counted into that progression's own cycle,
 * and that every statement names the body of theory it comes from.
 */

const SEEDS = ["a", "b", "c", "d"];
const STYLES = ["pop", "j-pop", "jazz", "ballad"] as const;

function piece(patch: Partial<GeneratorSettings> = {}) {
  return generateComposition({
    ...DEFAULT_GENERATOR_SETTINGS, bars: 16, seed: "a", ...patch,
  } as GeneratorSettings);
}

describe("explaining a piece", () => {
  it("gives every chord at least one reason", () => {
    // The state this replaced: 44% of chords carried a string and the rest
    // carried nothing at all.
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const composed = piece({ seed, style });
        const explanation = explainComposition(composed);
        expect(explanation.chords).toHaveLength(composed.chords.length);
        for (const chord of explanation.chords) {
          expect(chord.reasons.length, `${style}/${seed}/${chord.symbol}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("names the body of theory behind every statement", () => {
    // The bar the rest of this app is held to. A progression is not admitted
    // to the catalogue without independent sources; an explanation shown to
    // someone learning theory should not be held to less.
    for (const style of STYLES) {
      const explanation = explainComposition(piece({ style }));
      for (const chord of explanation.chords) {
        for (const reason of chord.reasons) {
          expect(reason.source, `${chord.symbol}: ${reason.text}`).toBeTruthy();
          expect(reason.text.length, chord.symbol).toBeGreaterThan(4);
        }
      }
      for (const section of explanation.sections) {
        for (const reason of section.reasons) expect(reason.source, section.label).toBeTruthy();
      }
    }
  });

  it("counts a chord's position into its progression's own cycle", () => {
    // "The fourth chord of a three-chord progression" is a sentence that was
    // printed before this: a section holds more chords than its progression
    // has steps whenever the harmonic rhythm splits a bar.
    for (const seed of SEEDS) {
      const composed = piece({ seed, bars: 32 });
      const explanation = explainComposition(composed);
      for (const [index, chord] of explanation.chords.entries()) {
        const positional = chord.reasons.find((reason) => reason.text.includes("番目の和音"));
        if (!positional) continue;
        const section = composed.sections?.find((entry) => {
          const bar = Math.floor(composed.chords[index]!.startTick / composed.ticksPerBar);
          return bar >= entry.startBar && bar < entry.endBar;
        });
        const template = section?.progressionId
          ? getProgressionTemplate(section.progressionId)
          : undefined;
        if (!template) continue;
        const claimed = Number(/(\d+)番目/.exec(positional.text)?.[1]);
        expect(claimed, positional.text).toBeGreaterThanOrEqual(1);
        expect(claimed, `${positional.text} against ${template.steps.length} steps`)
          .toBeLessThanOrEqual(template.steps.length);
      }
    }
  });

  it("puts what makes a chord itself before what makes it ordinary", () => {
    // Every chord has a function; only some are borrowed. Leading with the
    // function would bury the reason the chord is interesting under a fact
    // that is true of a third of the piece.
    // Across seeds, because whether a given piece reaches for a borrowed chord
    // is a property of that piece rather than of the explanation.
    const special = SEEDS.flatMap((seed) => explainComposition(piece({
      seed, style: "jazz", bars: 32,
      harmony: { ...DEFAULT_GENERATOR_SETTINGS.harmony!, complexity: "advanced" },
    })).chords).filter((chord) =>
      chord.reasons.some((reason) => reason.source.includes("ジャズ和声")
        || reason.source.includes("モーダル")));
    expect(special.length).toBeGreaterThan(0);
    for (const chord of special) {
      const functionIndex = chord.reasons.findIndex((reason) =>
        reason.source === "機能和声：三機能");
      const specialIndex = chord.reasons.findIndex((reason) =>
        reason.source.includes("ジャズ和声") || reason.source.includes("モーダル"));
      expect(specialIndex, chord.symbol).toBeLessThan(functionIndex);
    }
  });

  it("states the tritone substitution by what defines it", () => {
    // Not "contains a tritone" -- every dominant seventh does. The two chords
    // share the SAME tritone with the third and seventh exchanged, and the
    // root a semitone above the tonic is where the chromatic bass comes from.
    const found = SEEDS.flatMap((seed) => explainComposition(piece({
      seed, style: "jazz", bars: 32,
      harmony: { ...DEFAULT_GENERATOR_SETTINGS.harmony!, complexity: "advanced" },
    })).chords).flatMap((chord) => chord.reasons)
      .find((reason) => reason.source.includes("トライトーン代理"));
    if (!found) return;
    expect(found.text).toContain("3度と7度");
    expect(found.text).toContain("半音");
  });

  it("describes the piece without needing a section plan", () => {
    // A piece with no song form has no sections; the explanation must not
    // depend on them existing.
    const composed = piece({ songForm: undefined, bars: 8 });
    const explanation = explainComposition(composed);
    expect(explanation.text.length).toBeGreaterThan(50);
    for (const chord of explanation.chords) {
      expect(chord.reasons.length, chord.symbol).toBeGreaterThan(0);
    }
  });

  it("builds its prose from the same structures it reports", () => {
    // Written separately, the text and the data drift apart, and the text is
    // what a reader believes.
    const composed = piece({ bars: 8 });
    const explanation = explainComposition(composed);
    for (const chord of explanation.chords) {
      expect(explanation.text, chord.headline).toContain(chord.headline);
      for (const reason of chord.reasons) {
        expect(explanation.text, reason.text).toContain(reason.text);
      }
    }
  });

  it("changes nothing about the composition", () => {
    // A piece's identity is its seed and its settings, not how well it can
    // describe itself.
    const composed = piece({ bars: 8 });
    const before = JSON.stringify(composed);
    explainComposition(composed);
    expect(JSON.stringify(composed)).toBe(before);
  });

  it("is deterministic", () => {
    const make = () => JSON.stringify(explainComposition(piece({ seed: "det" })));
    expect(make()).toBe(make());
  });

  it("explains one chord on its own", () => {
    const composed = piece({ bars: 8 });
    const chord = composed.chords[0]!;
    const explanation = explainChord(composed, chord);
    expect(explanation.chordId).toBe(chord.id);
    expect(explanation.headline).toContain(chord.symbol);
    expect(explanation.bar).toBe(1);
  });
});
