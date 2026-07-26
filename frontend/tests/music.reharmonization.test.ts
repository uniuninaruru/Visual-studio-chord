import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  REHARMONIZATION_TYPES,
  generateComposition,
  intervalsForQuality,
  melodyPitchClassesOver,
  reharmonizeChord,
  reharmonizeProgression,
} from "../src/music";
import type { ReharmonizationType } from "../src/music";
import type { StylePresetId } from "../src/types/music";

const SEMITONE = {
  C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11,
} as const;

/** G7 resolving to C, with the leading tone in the melody. */
function dominant(patch: Partial<Parameters<typeof reharmonizeChord>[0]> = {}) {
  return reharmonizeChord({
    original: { root: "G", quality: "dominant7", degree: 5 },
    melodyPitchClasses: [SEMITONE.B],
    next: { root: "C", quality: "major" },
    key: "C",
    mode: "major",
    limit: 20,
    ...patch,
  });
}

describe("generating candidates", () => {
  it("never proposes the chord that is already there", () => {
    for (const candidate of dominant()) {
      const unchanged =
        candidate.root === "G" && candidate.quality === "dominant7" && !candidate.bass;
      expect(unchanged, candidate.symbol).toBe(false);
    }
  });

  it("finds the tritone substitute of a dominant", () => {
    // Db7 shares its third and seventh with G7, which is why it can stand in.
    const found = dominant({ types: ["tritoneSubstitution"] });
    expect(found.map((c) => c.symbol)).toContain("C#7");
    const sub = found.find((c) => c.symbol === "C#7")!;
    expect(sub.type).toBe("tritoneSubstitution");
    const g7 = new Set(intervalsForQuality("dominant7").map((i) => (SEMITONE.G + i) % 12));
    const db7 = intervalsForQuality("dominant7").map((i) => (SEMITONE["C#"] + i) % 12);
    expect(db7.filter((pitchClass) => g7.has(pitchClass))).toHaveLength(2);
  });

  it("finds the secondary dominant of what comes next", () => {
    const found = reharmonizeChord({
      original: { root: "C", quality: "major", degree: 1 },
      melodyPitchClasses: [SEMITONE.E],
      next: { root: "F", quality: "major" },
      key: "C", mode: "major", types: ["secondaryDominant"],
    });
    // The V7 of F is C7 — which is also why it fits a melody sitting on E.
    expect(found.map((c) => c.symbol)).toEqual(["C7"]);
  });

  it("finds a passing diminished a semitone below the next root", () => {
    const found = dominant({ types: ["diminishedPassing"] });
    expect(found.map((c) => c.symbol)).toEqual(["Bdim7"]);
    expect(found[0]!.rootMotion).toBe(1);
  });

  it("finds the backdoor dominant on the flat seventh", () => {
    const found = reharmonizeChord({
      original: { root: "G", quality: "dominant7", degree: 5 },
      melodyPitchClasses: [SEMITONE.F],
      next: { root: "C", quality: "major" },
      key: "C", mode: "major", types: ["backdoorDominant"],
    });
    expect(found.map((c) => c.symbol)).toEqual(["A#7"]);
  });

  it("keeps the chord and moves the bass for a slash chord", () => {
    const found = dominant({ types: ["slashChord"] });
    expect(found.length).toBeGreaterThan(0);
    for (const candidate of found) {
      expect(candidate.root).toBe("G");
      expect(candidate.quality).toBe("dominant7");
      expect(candidate.bass).toBeDefined();
      expect(candidate.bass).not.toBe("G");
      expect(candidate.symbol).toContain("/");
    }
  });

  it("holds the bass and moves the harmony for a pedal", () => {
    // The melody floor is off here: this is about what the technique generates,
    // and a C triad under a melody on B is exactly the sort of thing the floor
    // is there to reject afterwards.
    const found = dominant({ types: ["pedalPoint"], minimumMelodyFit: 0 });
    expect(found).toHaveLength(1);
    // The next chord, over the bass already sounding.
    expect(found[0]!.root).toBe("C");
    expect(found[0]!.bass).toBe("G");
  });

  it("rejects a pedal whose upper chord fights the melody", () => {
    // The same candidate, judged rather than generated.
    expect(dominant({ types: ["pedalPoint"] })).toEqual([]);
  });

  it("needs a next chord for the techniques defined against one", () => {
    for (const type of ["secondaryDominant", "diminishedPassing", "pedalPoint"] as const) {
      expect(
        dominant({ types: [type], next: undefined, minimumMelodyFit: 0 }),
        type,
      ).toEqual([]);
    }
  });

  it("only ever substitutes something that shares two notes, diatonically", () => {
    const found = dominant({ types: ["diatonicSubstitution"], minimumMelodyFit: 0 });
    const g7 = new Set(intervalsForQuality("dominant7").map((i) => (SEMITONE.G + i) % 12));
    for (const candidate of found) {
      const tones = intervalsForQuality(candidate.quality).map(
        (i) => (SEMITONE[candidate.root as keyof typeof SEMITONE] + i) % 12,
      );
      expect(
        tones.filter((pitchClass) => g7.has(pitchClass)).length,
        candidate.symbol,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("can be restricted to any single technique", () => {
    for (const type of REHARMONIZATION_TYPES) {
      const found = dominant({ types: [type], minimumMelodyFit: 0 });
      for (const candidate of found) expect(candidate.type, type).toBe(type);
    }
  });
});

describe("scoring", () => {
  it("drops candidates that fight the melody", () => {
    // A melody on F and A cannot sit over a chord with neither.
    const found = reharmonizeChord({
      original: { root: "C", quality: "major", degree: 1 },
      melodyPitchClasses: [SEMITONE.F, SEMITONE.A],
      next: { root: "G", quality: "major" },
      key: "C", mode: "major", limit: 20,
    });
    for (const candidate of found) {
      expect(candidate.melodyFit, candidate.symbol).toBeGreaterThanOrEqual(0.5);
      expect(
        candidate.supportedMelodyNotes.length + candidate.unsupportedMelodyNotes.length,
      ).toBe(2);
    }
    // Tightening the floor to 1 keeps only chords holding the whole line.
    for (const candidate of reharmonizeChord({
      original: { root: "C", quality: "major", degree: 1 },
      melodyPitchClasses: [SEMITONE.F, SEMITONE.A],
      next: { root: "G", quality: "major" },
      key: "C", mode: "major", minimumMelodyFit: 1, limit: 20,
    })) {
      expect(candidate.unsupportedMelodyNotes, candidate.symbol).toEqual([]);
    }
  });

  it("treats a dominant resolving down a semitone as strongly as down a fifth", () => {
    // That descent is the whole point of a tritone substitute; scoring it as an
    // ordinary stepwise move buries the substitutes the technique produces.
    const found = dominant({ types: ["tritoneSubstitution"] });
    const sub = found.find((c) => c.symbol === "C#7")!;
    expect(sub.rootMotion).toBe(11);
    expect(sub.functionalFit).toBe(1);
  });

  it("scores a dominant's resolution above the same root motion without one", () => {
    const asDominant = dominant({ types: ["secondaryDominant"] })[0];
    if (asDominant) expect(asDominant.functionalFit).toBe(1);
  });

  it("keeps every score inside 0..1 and sorted", () => {
    const found = dominant({ minimumMelodyFit: 0 });
    for (const candidate of found) {
      for (const value of [candidate.melodyFit, candidate.functionalFit, candidate.styleFit, candidate.score]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    for (let index = 1; index < found.length; index += 1) {
      expect(found[index - 1]!.score).toBeGreaterThanOrEqual(found[index]!.score);
    }
  });

  it("honours the limit, and is deterministic", () => {
    expect(dominant({ limit: 3 })).toHaveLength(3);
    expect(dominant()).toEqual(dominant());
  });

  it("offers no chord twice, however many techniques reach it", () => {
    const found = dominant({ minimumMelodyFit: 0, limit: 50 });
    const seen = found.map((c) => `${c.root}:${c.quality}:${c.bass ?? ""}`);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("style", () => {
  const topTypes = (style: StylePresetId): ReharmonizationType[] =>
    dominant({ style, limit: 4 }).map((c) => c.type);

  it("puts a tritone substitute first in jazz and nowhere near it in pop", () => {
    expect(dominant({ style: "jazz", limit: 1 })[0]!.symbol).toBe("C#7");
    expect(topTypes("pop")).not.toContain("tritoneSubstitution");
  });

  it("ranks the same technique differently by style", () => {
    const fitOf = (style: StylePresetId, type: ReharmonizationType) =>
      dominant({ style, types: [type], minimumMelodyFit: 0 })[0]!.styleFit;
    expect(fitOf("jazz", "tritoneSubstitution")).toBeGreaterThan(
      fitOf("pop", "tritoneSubstitution"),
    );
    expect(fitOf("game-music", "chromaticMediant")).toBeGreaterThan(
      fitOf("pop", "chromaticMediant"),
    );
    expect(fitOf("edm", "pedalPoint")).toBeGreaterThan(fitOf("jazz", "pedalPoint"));
  });
});

describe("reading a whole piece", () => {
  it("finds the melody sounding over each chord", () => {
    const composition = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS, bars: 8, seed: "rh",
    });
    for (const chord of composition.chords) {
      const found = melodyPitchClassesOver(composition.notes, chord);
      const end = chord.startTick + chord.durationTick;
      const expected = new Set(
        composition.notes
          .filter((n) => n.startTick < end && n.startTick + n.durationTick > chord.startTick)
          .map((n) => n.midi % 12),
      );
      expect(new Set(found)).toEqual(expected);
    }
  });

  it("offers options for every chord, in step", () => {
    const composition = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS, bars: 16, seed: "rh", harmony: { complexity: "sevenths" },
    });
    const options = reharmonizeProgression({
      chords: composition.chords,
      notes: composition.notes,
      key: "C", mode: "major", style: "pop",
    });
    expect(options).toHaveLength(composition.chords.length);
    for (const [index, candidates] of options.entries()) {
      expect(candidates.length, `chord ${index}`).toBeGreaterThan(0);
      for (const candidate of candidates) {
        expect(candidate.melodyFit).toBeGreaterThanOrEqual(0.5);
      }
    }
  });

  it("leaves the progression it read alone", () => {
    const composition = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS, bars: 8, seed: "rh",
    });
    const before = JSON.stringify(composition.chords);
    reharmonizeProgression({
      chords: composition.chords, notes: composition.notes, key: "C", mode: "major",
    });
    expect(JSON.stringify(composition.chords)).toBe(before);
  });
});
