import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  applyPivotModulations,
  fifthsDistance,
  findPivotChords,
  generateComposition,
  planModulation,
  validateComposition,
} from "../src/music";
import type { GeneratorSettings, Mode, PitchClassName } from "../src/types/music";

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...DEFAULT_GENERATOR_SETTINGS,
    ...patch,
    melody: { ...DEFAULT_GENERATOR_SETTINGS.melody, ...patch.melody },
  };
}

function pivots(
  fromKey: PitchClassName,
  fromMode: Mode,
  toKey: PitchClassName,
  toMode: Mode,
) {
  return findPivotChords(fromKey, fromMode, toKey, toMode);
}

describe("distance around the circle of fifths", () => {
  it("counts fifths, not semitones", () => {
    expect(fifthsDistance("C", "C")).toBe(0);
    expect(fifthsDistance("C", "G")).toBe(1);
    expect(fifthsDistance("C", "F")).toBe(1);
    expect(fifthsDistance("C", "D")).toBe(2);
    // A tritone is as far as two keys get.
    expect(fifthsDistance("C", "F#")).toBe(6);
    // A semitone is a long way round the circle, which is the point of using it.
    expect(fifthsDistance("C", "C#")).toBe(5);
  });

  it("is symmetric", () => {
    for (const [left, right] of [["C", "G"], ["A", "Eb"], ["F#", "B"]] as const) {
      expect(fifthsDistance(left, right)).toBe(fifthsDistance(right, left));
    }
  });
});

describe("finding pivot chords", () => {
  it("finds the chords two neighbouring keys share", () => {
    const found = pivots("C", "major", "G", "major");
    // C major and G major differ by one note (F/F#), so four triads survive:
    // C, Em, G, and Am — every triad without an F in it.
    expect(found.map((chord) => chord.root).sort()).toEqual(["A", "C", "E", "G"]);
    for (const chord of found) {
      expect(chord.degreeInSource).toBeGreaterThanOrEqual(1);
      expect(chord.degreeInTarget).toBeGreaterThanOrEqual(1);
    }
  });

  it("finds every triad between relative keys, which share a signature", () => {
    expect(pivots("C", "major", "A", "naturalMinor")).toHaveLength(7);
  });

  it("finds none between keys a tritone apart", () => {
    expect(pivots("C", "major", "F#", "major")).toEqual([]);
  });

  it("requires the same quality, not just the same root", () => {
    // C major has E minor; E major has E major. Sharing a root is a chromatic
    // alteration, which the ear hears as a change rather than a hinge.
    for (const chord of pivots("C", "major", "E", "major")) {
      expect(chord.quality).toBe(
        pivots("C", "major", "E", "major").find(
          (other) => other.root === chord.root,
        )!.quality,
      );
      expect(chord.root).not.toBe("E");
    }
  });

  it("ranks a predominant in the new key above a new tonic", () => {
    const found = pivots("C", "major", "A", "naturalMinor");
    const predominant = found.find((chord) => chord.functionInTarget === "predominant")!;
    const tonic = found.find((chord) => chord.functionInTarget === "tonic")!;
    expect(predominant.strength).toBeGreaterThan(tonic.strength);
    // And the best one overall is a predominant: it hands straight to the new
    // dominant, which is what actually establishes the key.
    expect(found[0]!.functionInTarget).toBe("predominant");
  });

  it("marks down the old tonic itself, but not its substitutes", () => {
    const found = pivots("C", "major", "G", "major");
    const oldTonic = found.find((chord) => chord.degreeInSource === 1)!;
    const submediant = found.find((chord) => chord.degreeInSource === 6)!;
    // Both are predominants in G, so the only thing separating them is that one
    // is the key being left. vi of C is ii of G — the textbook pivot for this
    // modulation — and it must not be marked down for being a tonic substitute.
    expect(oldTonic.functionInTarget).toBe("predominant");
    expect(submediant.functionInTarget).toBe("predominant");
    expect(oldTonic.strength).toBeLessThan(submediant.strength);
    expect(found[0]!.degreeInSource).toBe(6);
  });

  it("returns the strongest first, and is deterministic", () => {
    const found = pivots("C", "major", "A", "naturalMinor");
    for (let index = 1; index < found.length; index += 1) {
      expect(found[index - 1]!.strength).toBeGreaterThanOrEqual(found[index]!.strength);
    }
    expect(pivots("C", "major", "G", "major")).toEqual(pivots("C", "major", "G", "major"));
  });
});

describe("planning a modulation", () => {
  it("calls no key change a direct one rather than inventing a pivot", () => {
    const plan = planModulation({
      fromKey: "C", fromMode: "major", toKey: "C", toMode: "major",
    });
    expect(plan.type).toBe("direct");
    expect(plan.pivot).toBeUndefined();
    expect(plan.fifthsDistance).toBe(0);
  });

  it("falls back to direct when the keys share nothing", () => {
    const plan = planModulation({
      fromKey: "C", fromMode: "major", toKey: "F#", toMode: "major",
    });
    expect(plan.type).toBe("direct");
    expect(plan.pivot).toBeUndefined();
  });

  it("plans a pivot between neighbouring keys, in the bar before the change", () => {
    const plan = planModulation({
      fromKey: "C", fromMode: "major", toKey: "G", toMode: "major", targetBar: 8,
    });
    expect(plan.type).toBe("pivotChord");
    expect(plan.pivot).toBeDefined();
    expect(plan.pivotBar).toBe(7);
  });

  it("omits the bar when there is nothing before the change", () => {
    const plan = planModulation({
      fromKey: "C", fromMode: "major", toKey: "G", toMode: "major", targetBar: 0,
    });
    expect(plan.pivotBar).toBeUndefined();
  });

  it("honours a forced type", () => {
    const plan = planModulation({
      fromKey: "C", fromMode: "major", toKey: "G", toMode: "major", prefer: "direct",
    });
    expect(plan.type).toBe("direct");
    expect(plan.pivot).toBeUndefined();
  });
});

describe("applying a pivot to a progression", () => {
  const base = settings({
    bars: 16,
    seed: "pv",
    songForm: { form: "verseChorus", finalLift: 2 },
  });

  it("rewrites the chord before the key change, and nothing else", () => {
    const composition = generateComposition(base);
    const result = applyPivotModulations({
      chords: composition.chords,
      sections: composition.sections!,
      ticksPerBar: composition.ticksPerBar,
      seed: "pv",
    });
    expect(result.plans.length).toBeGreaterThan(0);

    const changed = result.chords.filter(
      (chord, index) => chord.id !== composition.chords[index]!.id,
    );
    expect(changed).toHaveLength(result.plans.length);
    for (const chord of changed) {
      const original = composition.chords.find(
        (item) => item.startTick === chord.startTick,
      )!;
      // The slot is unchanged: only what sounds in it is different.
      expect(chord.durationTick).toBe(original.durationTick);
      expect(chord.explanation).toMatch(/^Pivot:/);
    }
  });

  it("puts the pivot in the last bar of the outgoing section", () => {
    const composition = generateComposition(base);
    const sections = composition.sections!;
    const result = applyPivotModulations({
      chords: composition.chords,
      sections,
      ticksPerBar: composition.ticksPerBar,
      seed: "pv",
    });
    for (const chord of result.chords) {
      if (!chord.explanation?.startsWith("Pivot:")) continue;
      const bar = Math.floor(chord.startTick / composition.ticksPerBar);
      const boundary = sections.find((section) => section.startBar === bar + 1);
      expect(boundary, `bar ${bar}`).toBeDefined();
    }
  });

  it("does nothing when no section changes key", () => {
    const composition = generateComposition(
      settings({ bars: 16, seed: "same", songForm: { form: "verseChorus" } }),
    );
    const result = applyPivotModulations({
      chords: composition.chords,
      sections: composition.sections!,
      ticksPerBar: composition.ticksPerBar,
      seed: "same",
    });
    expect(result.plans).toEqual([]);
    expect(result.chords).toEqual(composition.chords);
  });

  it("does nothing without sections to modulate between", () => {
    const composition = generateComposition(settings({ bars: 8, seed: "none" }));
    const result = applyPivotModulations({
      chords: composition.chords,
      sections: [],
      ticksPerBar: composition.ticksPerBar,
      seed: "none",
    });
    expect(result.plans).toEqual([]);
    expect(result.chords).toEqual(composition.chords);
  });
});

describe("pivot modulation in generated compositions", () => {
  const lifted = (patch: Partial<GeneratorSettings> = {}) =>
    settings({
      bars: 16,
      seed: "gen",
      songForm: { form: "verseChorus", finalLift: 2 },
      pivotModulation: { enabled: true },
      ...patch,
    });

  it("stays valid across lifts, modes and forms", () => {
    for (const finalLift of [1, 2, 3, 5]) {
      for (const mode of ["major", "naturalMinor", "dorian"] as const) {
        const composition = generateComposition(
          lifted({
            mode,
            seed: `${mode}-${finalLift}`,
            songForm: { form: "verseChorus", finalLift },
          }),
        );
        expect(
          validateComposition(composition).errors,
          `${mode}/+${finalLift}`,
        ).toEqual([]);
      }
    }
    for (const form of ["aaba", "throughComposed"] as const) {
      const composition = generateComposition(
        lifted({ seed: form, songForm: { form, finalLift: 2 } }),
      );
      expect(validateComposition(composition).errors, form).toEqual([]);
    }
  });

  it("changes the progression at the seam", () => {
    let changed = 0;
    for (const seed of Array.from({ length: 10 }, (_, index) => `c${index}`)) {
      const plain = generateComposition(lifted({ seed, pivotModulation: undefined }));
      const withPivot = generateComposition(lifted({ seed }));
      if (
        JSON.stringify(plain.chords.map((chord) => chord.symbol)) !==
        JSON.stringify(withPivot.chords.map((chord) => chord.symbol))
      ) {
        changed += 1;
      }
    }
    // Not every seed: sometimes the chord already there is the pivot, and
    // rewriting it to itself is not a change.
    expect(changed).toBeGreaterThan(0);
  });

  it("does nothing to a piece that never changes key", () => {
    const base = settings({ bars: 16, seed: "flat", songForm: { form: "verseChorus" } });
    expect(
      generateComposition({ ...base, pivotModulation: { enabled: true } }).chords,
    ).toEqual(generateComposition(base).chords);
  });

  it("is deterministic", () => {
    expect(generateComposition(lifted())).toEqual(generateComposition(lifted()));
  });

  it("distinguishes pieces that differ only by the setting", () => {
    expect(generateComposition(lifted()).id).not.toBe(
      generateComposition(lifted({ pivotModulation: undefined })).id,
    );
  });

  it("composes with the rest of the engine", () => {
    const composition = generateComposition(
      lifted({
        seed: "all",
        harmonicRhythm: { changesPerBar: 2 },
        voiceLeading: { enabled: true },
        phraseGrammar: { enabled: true },
        melodicSkeleton: { enabled: true },
        nonChordTones: { enabled: true, rate: 1 },
      }),
    );
    expect(validateComposition(composition).errors).toEqual([]);
  });
});
