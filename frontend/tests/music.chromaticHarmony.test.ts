import { describe, expect, it } from "vitest";
import {
  MEDIANT_DISTANCES,
  SYMMETRIC_PERIOD,
  SYMMETRIC_SCALES,
  chromaticMediantsOf,
  intervalsForQuality,
  isChromaticMediant,
  symmetricChordsOf,
  symmetricTranspositionOf,
  symmetricTranspositions,
} from "../src/music";
import type { StylePresetId } from "../src/types/music";

const symbols = (options: Parameters<typeof chromaticMediantsOf>[2] = {}) =>
  chromaticMediantsOf("C", "major", options).map((chord) => chord.symbol);

describe("chromatic mediants", () => {
  it("finds the four chromatic mediants of a major triad", () => {
    // From C major: Eb, E, Ab and A major — a third away, one note in common.
    const found = chromaticMediantsOf("C", "major", { doublyChromatic: false });
    expect(found.map((c) => c.symbol)).toEqual(["D#", "E", "G#", "A"]);
    for (const chord of found) {
      expect(chord.sharedPitchClasses).toBe(1);
      expect(chord.kind).toBe("chromatic");
      expect(chord.modeRelation).toBe("sameQuality");
      expect(MEDIANT_DISTANCES).toContain(chord.rootDistance);
    }
  });

  it("finds the doubly chromatic ones too, and ranks them after", () => {
    const found = chromaticMediantsOf("C", "major");
    const doubly = found.filter((c) => c.kind === "doublyChromatic");
    expect(doubly.map((c) => c.symbol)).toEqual(["D#m", "G#m"]);
    for (const chord of doubly) {
      expect(chord.sharedPitchClasses).toBe(0);
      expect(chord.modeRelation).toBe("mixedQuality");
    }
    // The one-common-tone relations come first: they are the characteristic sound.
    expect(found.findIndex((c) => c.kind === "doublyChromatic")).toBe(
      found.filter((c) => c.kind === "chromatic").length,
    );
  });

  it("refuses a diatonic mediant, which is a substitution not a departure", () => {
    // Am and Em share two notes with C major and are inside the key.
    expect(symbols()).not.toContain("Am");
    expect(symbols()).not.toContain("Em");
    expect(isChromaticMediant("C", "major", "A", "minor")).toBeNull();
    expect(isChromaticMediant("C", "major", "E", "minor")).toBeNull();
  });

  it("refuses a relation that is not a third", () => {
    for (const [root, quality] of [["G", "major"], ["F", "major"], ["D", "minor"]] as const) {
      expect(isChromaticMediant("C", "major", root, quality)).toBeNull();
    }
  });

  it("mirrors a major triad's four, from a minor one", () => {
    // Cm shares Eb with Ebm, G with Em, Eb with Abm and C with Am — one note
    // each, exactly as a major triad does with its four.
    const found = chromaticMediantsOf("C", "minor", { doublyChromatic: false });
    expect(found.map((c) => c.symbol)).toEqual(["D#m", "Em", "G#m", "Am"]);
    for (const chord of found) {
      expect(chord.modeRelation).toBe("sameQuality");
      expect(chord.sharedPitchClasses).toBe(1);
    }
    expect(found).toHaveLength(
      chromaticMediantsOf("C", "major", { doublyChromatic: false }).length,
    );
  });

  it("marks which candidates are actually outside the key", () => {
    // In C major, A minor is diatonic — but it is also a diatonic mediant, so it
    // never reaches the list. E major is the interesting case: a third away,
    // chromatic, and not in the key.
    const inKey = chromaticMediantsOf("C", "major", { key: "C", mode: "major" });
    expect(inKey.every((chord) => chord.chromatic)).toBe(true);
    expect(inKey.map((c) => c.symbol)).toContain("E");
  });

  it("can keep the ones that are diatonic to the key", () => {
    const relaxed = chromaticMediantsOf("C", "minor", {
      key: "C", mode: "naturalMinor", chromaticOnly: false,
    });
    // Eb minor and Ab minor are the mediants; in C natural minor neither is
    // diatonic, but Ab major and Eb major are — and they are not mediants of Cm.
    expect(relaxed.length).toBeGreaterThan(0);
    expect(relaxed.every((chord) => typeof chord.chromatic === "boolean")).toBe(true);
  });

  it("weights the styles that actually use them", () => {
    const weightOf = (style: StylePresetId) =>
      chromaticMediantsOf("C", "major", { style })[0]!.weight;
    expect(weightOf("game-music")).toBeGreaterThan(weightOf("pop"));
    expect(weightOf("game-music")).toBeGreaterThan(weightOf("jazz"));
  });

  it("is deterministic", () => {
    expect(chromaticMediantsOf("C", "major")).toEqual(chromaticMediantsOf("C", "major"));
  });
});

describe("symmetric scales", () => {
  it("divide the octave evenly", () => {
    for (const [name, scale] of Object.entries(SYMMETRIC_SCALES)) {
      const period = SYMMETRIC_PERIOD[name as keyof typeof SYMMETRIC_PERIOD];
      const set = new Set(scale);
      // Transposing by the period gives back the same set of notes. That is what
      // makes them symmetric, and why none of their notes can be a tonic.
      const shifted = new Set(scale.map((interval) => (interval + period) % 12));
      expect(shifted, name).toEqual(set);
    }
  });

  it("have only as many distinct transpositions as their period", () => {
    expect(symmetricTranspositions("wholeTone")).toEqual([0, 1]);
    expect(symmetricTranspositions("octatonicHalfWhole")).toEqual([0, 1, 2]);
  });

  it("build only augmented triads out of a whole-tone scale", () => {
    const chords = symmetricChordsOf("wholeTone", "C");
    expect(chords).toHaveLength(6);
    expect(chords.every((chord) => chord.quality === "augmented")).toBe(true);
  });

  it("build diminished sevenths out of an octatonic scale", () => {
    const chords = symmetricChordsOf("octatonicWholeHalf", "C");
    expect(chords.some((chord) => chord.quality === "diminished7")).toBe(true);
    expect(chords.some((chord) => chord.quality === "dominant7")).toBe(true);
  });

  it("only builds chords whose every note is in the scale", () => {
    for (const name of ["wholeTone", "octatonicHalfWhole", "octatonicWholeHalf"] as const) {
      const set = new Set(SYMMETRIC_SCALES[name]);
      for (const chord of symmetricChordsOf(name, "C")) {
        for (const interval of intervalsForQuality(chord.quality)) {
          expect(set.has((chord.rootOffset + interval) % 12), `${name} ${chord.symbol}`).toBe(true);
        }
      }
    }
  });

  it("says which transposition a set of notes lies in", () => {
    expect(symmetricTranspositionOf("wholeTone", [0, 2, 4])).toBe(0);
    expect(symmetricTranspositionOf("wholeTone", [1, 3, 5])).toBe(1);
    // A set spanning both whole-tone collections is in neither.
    expect(symmetricTranspositionOf("wholeTone", [0, 1])).toBeNull();
    expect(symmetricTranspositionOf("wholeTone", [])).toBeNull();
  });
});
