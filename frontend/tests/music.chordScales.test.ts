import { describe, expect, it } from "vitest";
import {
  CHORD_SCALES,
  CHORD_SCALE_NAMES,
  DEFAULT_GENERATOR_SETTINGS,
  bestChordScale,
  chordScalesFor,
  chordScalesForProgression,
  generateComposition,
  intervalsForQuality,
} from "../src/music";
import type { ChordQuality } from "../src/types/music";

const SEMITONE = {
  C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11,
} as const;

const best = (options: Parameters<typeof chordScalesFor>[0]) =>
  chordScalesFor(options)[0]!.scale;

describe("the scale table", () => {
  it("holds ordered pitch sets inside an octave, starting on the root", () => {
    for (const name of CHORD_SCALE_NAMES) {
      const scale = CHORD_SCALES[name];
      expect(scale[0], name).toBe(0);
      expect(Math.max(...scale), name).toBeLessThan(12);
      expect([...scale].sort((a, b) => a - b), name).toEqual([...scale]);
      expect(new Set(scale).size, name).toBe(scale.length);
    }
  });

  it("gets the symmetric scales right", () => {
    // Whole tone is six whole steps; the diminished scales alternate.
    expect(CHORD_SCALES.wholeTone).toEqual([0, 2, 4, 6, 8, 10]);
    expect(CHORD_SCALES.halfWholeDiminished).toHaveLength(8);
    expect(CHORD_SCALES.wholeHalfDiminished).toHaveLength(8);
  });
});

describe("matching a scale to a chord", () => {
  it("only offers scales that contain the whole chord", () => {
    const qualities: ChordQuality[] = [
      "major7", "minor7", "dominant7", "halfDiminished7", "diminished7", "minorMajor7",
    ];
    for (const quality of qualities) {
      const chordTones = intervalsForQuality(quality).map((i) => ((i % 12) + 12) % 12);
      for (const candidate of chordScalesFor({ root: "C", quality })) {
        const set = new Set(candidate.intervals.map((i) => ((i % 12) + 12) % 12));
        for (const tone of chordTones) {
          expect(set.has(tone), `${quality}/${candidate.scale} missing ${tone}`).toBe(true);
        }
      }
    }
  });

  it("finds only ionian and lydian for a major seventh", () => {
    // Every other scale in the table alters the third, the fifth or the seventh.
    expect(chordScalesFor({ root: "C", quality: "major7" }).map((c) => c.scale).sort())
      .toEqual(["ionian", "lydian"]);
  });

  it("gives the textbook answer for each degree of a major key", () => {
    const key = { key: "C", mode: "major" } as const;
    expect(best({ root: "C", quality: "major7", ...key })).toBe("ionian");
    expect(best({ root: "D", quality: "minor7", ...key })).toBe("dorian");
    expect(best({ root: "E", quality: "minor7", ...key })).toBe("phrygian");
    // IVmaj7 takes lydian, not ionian: lydian is the one with no avoid note.
    expect(best({ root: "F", quality: "major7", ...key })).toBe("lydian");
    expect(best({ root: "G", quality: "dominant7", ...key })).toBe("mixolydian");
    expect(best({ root: "A", quality: "minor7", ...key })).toBe("aeolian");
    expect(best({ root: "B", quality: "halfDiminished7", ...key })).toBe("locrian");
  });

  it("gives a minor key's dominant its own scale", () => {
    // The same chord takes a different scale depending on where it resolves —
    // which is the thing quality alone cannot tell you.
    expect(best({ root: "G", quality: "dominant7", key: "C", mode: "major" }))
      .toBe("mixolydian");
    for (const mode of ["naturalMinor", "harmonicMinor", "dorian"] as const) {
      expect(best({ root: "G", quality: "dominant7", key: "C", mode }), mode)
        .toBe("phrygianDominant");
    }
    // A secondary dominant inside a major key is not the V of a minor one.
    expect(best({ root: "A", quality: "dominant7", key: "C", mode: "major" }))
      .toBe("mixolydian");
  });

  it("uses a scale that supplies the colour tones the chord already carries", () => {
    const candidates = chordScalesFor({
      root: "G", quality: "dominant7", tensions: ["#11"], key: "C", mode: "major",
    });
    expect(candidates[0]!.scale).toBe("lydianDominant");
    for (const candidate of candidates) {
      // C# is the #11 of G; a scale without it cannot voice the chord.
      expect(candidate.pitchClasses).toContain(SEMITONE["C#"]);
    }
  });
});

describe("avoid notes", () => {
  it("marks the fourth over a major seventh, and nothing over its lydian", () => {
    const key = { key: "C", mode: "major" } as const;
    const ionian = chordScalesFor({ root: "C", quality: "major7", ...key })
      .find((c) => c.scale === "ionian")!;
    // F is a semitone above E, the third.
    expect(ionian.avoidNotes).toEqual([SEMITONE.F]);
    const lydian = chordScalesFor({ root: "C", quality: "major7", ...key })
      .find((c) => c.scale === "lydian")!;
    expect(lydian.avoidNotes).toEqual([]);
  });

  it("marks the fourth over a dominant seventh", () => {
    const mixolydian = chordScalesFor({ root: "G", quality: "dominant7" })
      .find((c) => c.scale === "mixolydian")!;
    // C is a semitone above B, the third of G7.
    expect(mixolydian.avoidNotes).toEqual([SEMITONE.C]);
  });

  it("marks nothing over a dorian minor seventh", () => {
    const dorian = chordScalesFor({ root: "D", quality: "minor7" })
      .find((c) => c.scale === "dorian")!;
    expect(dorian.avoidNotes).toEqual([]);
  });

  it("marks a flat ninth over a minor chord but not over a dominant", () => {
    // Over Cm7 the Db rubs against the root and is the textbook avoid note.
    // Over C7 the same note is an altered tension — the sound being reached for.
    const overMinor = chordScalesFor({ root: "C", quality: "minor7" })
      .find((c) => c.scale === "phrygian")!;
    expect(overMinor.avoidNotes).toContain(SEMITONE["C#"]);

    const overDominant = chordScalesFor({ root: "C", quality: "dominant7" })
      .find((c) => c.scale === "phrygianDominant")!;
    expect(overDominant.avoidNotes).not.toContain(SEMITONE["C#"]);
    expect(overDominant.tensions).toContain("b9");
  });

  it("splits every non-chord scale tone into avoid or available", () => {
    for (const candidate of chordScalesFor({ root: "C", quality: "dominant7" })) {
      const chordTones = new Set(
        intervalsForQuality("dominant7").map((i) => ((i % 12) + 12) % 12),
      );
      const nonChord = candidate.intervals.filter((i) => !chordTones.has(((i % 12) + 12) % 12));
      expect(
        candidate.avoidNotes.length + candidate.availableNotes.length,
        candidate.scale,
      ).toBe(nonChord.length);
      for (const note of candidate.avoidNotes) {
        expect(candidate.availableNotes).not.toContain(note);
      }
    }
  });
});

describe("scoring the fit", () => {
  it("prefers a scale that stays inside the key", () => {
    const candidates = chordScalesFor({
      root: "C", quality: "major7", key: "C", mode: "major",
    });
    const ionian = candidates.find((c) => c.scale === "ionian")!;
    const lydian = candidates.find((c) => c.scale === "lydian")!;
    expect(ionian.outsideKey).toBe(0);
    expect(lydian.outsideKey).toBe(1);
    expect(ionian.fit).toBeGreaterThan(lydian.fit);
  });

  it("counts how far outside the key each scale reaches", () => {
    const candidates = chordScalesFor({
      root: "G", quality: "dominant7", key: "C", mode: "major",
    });
    for (const candidate of candidates) {
      const outside = candidate.pitchClasses.filter(
        (pitchClass) => ![0, 2, 4, 5, 7, 9, 11].includes(pitchClass),
      ).length;
      expect(candidate.outsideKey, candidate.scale).toBe(outside);
    }
  });

  it("keeps fit inside 0..1, ordered, and deterministic", () => {
    const candidates = chordScalesFor({
      root: "G", quality: "dominant7", key: "C", mode: "major",
    });
    for (const candidate of candidates) {
      expect(candidate.fit).toBeGreaterThanOrEqual(0);
      expect(candidate.fit).toBeLessThanOrEqual(1);
    }
    for (let index = 1; index < candidates.length; index += 1) {
      expect(candidates[index - 1]!.fit).toBeGreaterThanOrEqual(candidates[index]!.fit);
    }
    expect(candidates).toEqual(
      chordScalesFor({ root: "G", quality: "dominant7", key: "C", mode: "major" }),
    );
  });

  it("can be restricted to the idiomatic answers", () => {
    const all = chordScalesFor({ root: "D", quality: "minor7" });
    const idiomatic = chordScalesFor({ root: "D", quality: "minor7", idiomaticOnly: true });
    expect(idiomatic.length).toBeGreaterThan(0);
    expect(idiomatic.length).toBeLessThan(all.length);
    const names = new Set(all.map((candidate) => candidate.scale));
    for (const candidate of idiomatic) expect(names.has(candidate.scale)).toBe(true);
  });
});

describe("reading a whole progression", () => {
  it("returns one entry per chord, in step", () => {
    const composition = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      bars: 16,
      seed: "cs",
      harmony: { complexity: "sevenths" },
    });
    const scales = chordScalesForProgression(composition.chords, "C", "major");
    expect(scales).toHaveLength(composition.chords.length);
    for (const [index, candidate] of scales.entries()) {
      expect(candidate, `${composition.chords[index]!.symbol}`).not.toBeNull();
      const root = composition.chords[index]!.root;
      expect(candidate!.pitchClasses[0]).toBe(SEMITONE[root as keyof typeof SEMITONE]);
    }
  });

  it("finds a scale for every chord real generation produces", () => {
    for (const mode of ["major", "naturalMinor", "dorian", "mixolydian"] as const) {
      for (const complexity of ["triads", "sevenths", "advanced"] as const) {
        const composition = generateComposition({
          ...DEFAULT_GENERATOR_SETTINGS,
          bars: 16,
          mode,
          seed: `${mode}-${complexity}`,
          harmony: { complexity },
        });
        for (const chord of composition.chords) {
          expect(
            bestChordScale(chord, "C", mode),
            `${mode}/${complexity}: ${chord.symbol} (${chord.quality})`,
          ).not.toBeNull();
        }
      }
    }
  });
});
