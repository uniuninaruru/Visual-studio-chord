import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  DEFAULT_GUIDE_TONE_REGISTER,
  generateComposition,
  planGuideToneLines,
  summarizeGuideTones,
} from "../src/music";
import type { GuideToneLine } from "../src/music";
import type {
  CanonicalPitchClass,
  ChordEvent,
  ChordQuality,
  GeneratorSettings,
} from "../src/types/music";

const BAR = 1920;

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...DEFAULT_GENERATOR_SETTINGS,
    ...patch,
    melody: { ...DEFAULT_GENERATOR_SETTINGS.melody, ...patch.melody },
  };
}

const TEMPLATE = generateComposition(settings({ bars: 4, seed: "template" })).chords[0]!;

function chord(
  index: number,
  root: CanonicalPitchClass,
  quality: ChordQuality,
  notes: number[],
): ChordEvent {
  return {
    ...TEMPLATE,
    id: `c${index}`,
    root,
    quality,
    notes,
    startTick: index * BAR,
    durationTick: BAR,
  };
}

/** ii–V–I in C: Dm7, G7, Cmaj7 — the progression guide tones exist to explain. */
const II_V_I = [
  chord(0, "D", "minor7", [50, 57, 60, 65]),
  chord(1, "G", "dominant7", [43, 50, 59, 65]),
  chord(2, "C", "major7", [48, 55, 59, 64]),
];

/** All pitches carrying a given chord member, in chord order. */
function member(lines: GuideToneLine[], role: "third" | "seventh"): number[] {
  const found: number[] = [];
  const count = lines[0]?.notes.length ?? 0;
  for (let index = 0; index < count; index += 1) {
    for (const entry of lines) {
      const note = entry.notes[index]!;
      if (note.role === role) found.push(note.midi);
    }
  }
  return found;
}

/** The note each voice carries at a given chord. */
function atChord(lines: GuideToneLine[], index: number) {
  return lines.map((entry) => entry.notes[index]!);
}

describe("planning the lines", () => {
  it("plans two voices covering every chord", () => {
    const lines = planGuideToneLines(II_V_I);
    expect(lines.map((entry) => entry.index)).toEqual([0, 1]);
    for (const entry of lines) expect(entry.notes).toHaveLength(3);
  });

  it("covers each chord's third and seventh exactly once, between the voices", () => {
    const lines = planGuideToneLines(II_V_I);
    // Dm7 → F/C, G7 → B/F, Cmaj7 → E/B.
    const expected = [[5, 0], [11, 5], [4, 11]];
    for (const [index, [third, seventh]] of expected.entries()) {
      const roles = atChord(lines, index);
      expect([...roles.map((note) => note.role)].sort()).toEqual(["seventh", "third"]);
      expect(roles.find((note) => note.role === "third")!.midi % 12).toBe(third);
      expect(roles.find((note) => note.role === "seventh")!.midi % 12).toBe(seventh);
    }
    // Every third and seventh is present across the two voices.
    expect(member(lines, "third").map((midi) => midi % 12).sort((a, b) => a - b)).toEqual([4, 5, 11]);
    expect(member(lines, "seventh").map((midi) => midi % 12).sort((a, b) => a - b)).toEqual([0, 5, 11]);
  });

  it("lets a voice change which member it carries", () => {
    // This is the point: a voice that stayed on the third would have to leap a
    // tritone from the F of Dm7 to the B of G7.
    const lines = planGuideToneLines(II_V_I);
    const swaps = lines.filter((entry) =>
      entry.notes.some((note, index) => index > 0 && note.role !== entry.notes[index - 1]!.role),
    );
    expect(swaps.length).toBeGreaterThan(0);
  });

  it("resolves a ii–V–I by step, which is the whole point of the figure", () => {
    const lines = planGuideToneLines(II_V_I);
    // The seventh of Dm7 (C) falls a semitone to the third of G7 (B); the
    // seventh of G7 (F) falls a semitone to the third of Cmaj7 (E). Every move
    // in both voices is a step or a common tone.
    for (const entry of lines) {
      for (const note of entry.notes.slice(1)) {
        expect(Math.abs(note.motion), `voice ${entry.index}`).toBeLessThanOrEqual(2);
      }
    }
    expect(summarizeGuideTones(lines)!.smoothness).toBe(1);
  });

  it("stands in for a third or seventh the chord does not have", () => {
    // A triad has a real third but no seventh, so the fifth stands in.
    const triad = atChord(planGuideToneLines([chord(0, "C", "major", [48, 52, 55])]), 0);
    const triadThird = triad.find((note) => note.role === "third")!;
    const triadSeventh = triad.find((note) => note.role === "seventh")!;
    expect(triadThird.substituted).toBe(false);
    expect(triadThird.midi % 12).toBe(4);
    expect(triadSeventh.substituted).toBe(true);
    expect(triadSeventh.midi % 12).toBe(7);

    // A sus chord has no third; the suspension carries the same weight.
    const sus = atChord(planGuideToneLines([chord(0, "C", "sus4", [48, 53, 55])]), 0);
    const susThird = sus.find((note) => note.role === "third")!;
    expect(susThird.substituted).toBe(true);
    expect(susThird.midi % 12).toBe(5);
  });

  it("keeps both lines inside the register when the bass allows it", () => {
    for (const register of [
      DEFAULT_GUIDE_TONE_REGISTER,
      [60, 79],
      [48, 67],
    ] as const) {
      for (const entry of planGuideToneLines(II_V_I, { register })) {
        for (const note of entry.notes) {
          expect(note.midi, `voice ${entry.index}`).toBeGreaterThanOrEqual(register[0]);
          expect(note.midi).toBeLessThanOrEqual(register[1]);
        }
      }
    }
  });

  it("reports each note's motion from the one before it", () => {
    for (const entry of planGuideToneLines(II_V_I)) {
      expect(entry.notes[0]!.motion).toBe(0);
      for (const [index, note] of entry.notes.entries()) {
        if (index === 0) continue;
        expect(note.motion).toBe(note.midi - entry.notes[index - 1]!.midi);
      }
      expect(entry.totalMotion).toBe(
        entry.notes.reduce((sum, note) => sum + Math.abs(note.motion), 0),
      );
    }
  });

  it("beats holding each voice to one chord member", () => {
    // The naive construction — one voice on every third, the other on every
    // seventh — is what the joint search exists to improve on.
    const held = (
      pitchesByChord: readonly number[],
      register: readonly [number, number],
    ): number => {
      const centre = (register[0] + register[1]) / 2;
      let previous: number | null = null;
      let total = 0;
      for (const pitchClass of pitchesByChord) {
        const options: number[] = [];
        for (let midi = ((pitchClass % 12) + 12) % 12; midi <= 127; midi += 12) {
          if (midi >= register[0] && midi <= register[1]) options.push(midi);
        }
        if (options.length === 0) continue;
        const target: number = previous ?? centre;
        const best: number = options.reduce((left, right) =>
          Math.abs(right - target) < Math.abs(left - target) ? right : left,
        );
        if (previous !== null) total += Math.abs(best - previous);
        previous = best;
      }
      return total;
    };

    let improved = 0;
    let compared = 0;
    for (const seed of Array.from({ length: 12 }, (_, index) => `greedy-${index}`)) {
      const composition = generateComposition(
        settings({ bars: 16, seed, style: "jazz", harmony: { complexity: "sevenths" } }),
      );
      const lines = planGuideToneLines(composition.chords);
      const planned = lines.reduce((sum, entry) => sum + entry.totalMotion, 0);
      const count = lines[0]!.notes.length;
      const thirds: number[] = [];
      const sevenths: number[] = [];
      for (let index = 0; index < count; index += 1) {
        for (const note of atChord(lines, index)) {
          (note.role === "third" ? thirds : sevenths).push(note.midi % 12);
        }
      }
      const naive =
        held(thirds, DEFAULT_GUIDE_TONE_REGISTER) +
        held(sevenths, DEFAULT_GUIDE_TONE_REGISTER);
      compared += 1;
      if (planned <= naive) improved += 1;
    }
    expect(compared).toBe(12);
    expect(improved).toBe(12);
  });

  it("plans nothing for nothing", () => {
    for (const entry of planGuideToneLines([])) expect(entry.notes).toEqual([]);
    expect(summarizeGuideTones(planGuideToneLines([]))).toBeNull();
  });

  it("is deterministic", () => {
    expect(planGuideToneLines(II_V_I)).toEqual(planGuideToneLines(II_V_I));
  });
});

describe("summarising the lines", () => {
  it("counts steps, leaps and stand-ins", () => {
    const summary = summarizeGuideTones(planGuideToneLines(II_V_I))!;
    expect(summary.smoothness).toBe(1);
    expect(summary.largestLeap).toBeLessThanOrEqual(2);
    expect(summary.substitutions).toBe(0);
    expect(summary.totalMotion).toBeGreaterThan(0);
  });

  it("counts a triad's missing seventh as a stand-in", () => {
    const summary = summarizeGuideTones(
      planGuideToneLines([
        chord(0, "C", "major", [48, 52, 55]),
        chord(1, "F", "major", [53, 57, 60]),
      ]),
    )!;
    // Two chords, no sevenths between them.
    expect(summary.substitutions).toBe(2);
  });
});

describe("what the lines say about real progressions", () => {
  it("describes every generated progression, in every mode and style", () => {
    for (const mode of ["major", "naturalMinor", "dorian", "mixolydian"] as const) {
      for (const style of ["jazz", "pop", "game-music"] as const) {
        const composition = generateComposition(
          settings({
            bars: 8,
            mode,
            style,
            seed: `${mode}-${style}`,
            harmony: { complexity: "sevenths" },
          }),
        );
        const lines = planGuideToneLines(composition.chords);
        expect(lines, `${mode}/${style}`).toHaveLength(2);
        for (const entry of lines) {
          expect(entry.notes.length).toBe(composition.chords.length);
        }
        expect(summarizeGuideTones(lines)).not.toBeNull();
      }
    }
  });

  it("keeps the guide tones above each chord's own bass", () => {
    // A guide tone under the bass is not a guide tone; it is the bass. The
    // register alone does not guarantee this — a chord voiced high can have a
    // bass above the register's floor, which is the case built here.
    const high = [
      chord(0, "C", "major7", [72, 76, 79, 83]),
      chord(1, "F", "major7", [77, 81, 84, 88]),
    ];
    for (const entry of planGuideToneLines(high)) {
      for (const [index, note] of entry.notes.entries()) {
        expect(note.midi, `voice ${entry.index}/${index}`).toBeGreaterThan(
          Math.min(...high[index]!.notes),
        );
      }
    }

    // And it holds across ordinary generated material too.
    for (const seed of Array.from({ length: 8 }, (_, index) => `floor-${index}`)) {
      const composition = generateComposition(
        settings({ bars: 16, seed, harmony: { complexity: "sevenths" } }),
      );
      for (const entry of planGuideToneLines(composition.chords)) {
        for (const note of entry.notes) {
          const target = composition.chords.find((item) => item.id === note.chordId)!;
          expect(note.midi, seed).toBeGreaterThan(Math.min(...target.notes));
        }
      }
    }
  });

  it("finds mostly stepwise motion in real progressions", () => {
    const scores: number[] = [];
    for (const seed of Array.from({ length: 16 }, (_, index) => `sm-${index}`)) {
      const composition = generateComposition(
        settings({ bars: 16, seed, style: "jazz", harmony: { complexity: "sevenths" } }),
      );
      const summary = summarizeGuideTones(planGuideToneLines(composition.chords));
      if (summary) scores.push(summary.smoothness);
    }
    const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    // Solving the two voices together is what earns this. Holding each voice to
    // one chord member for the whole progression scores around 0.14 on the same
    // material, because the thirds alone have to leap wherever the roots do.
    expect(mean).toBeGreaterThan(0.6);
  });

  it("gives the two voices different notes at every chord", () => {
    for (const seed of Array.from({ length: 8 }, (_, index) => `pair-${index}`)) {
      const composition = generateComposition(
        settings({ bars: 16, seed, harmony: { complexity: "sevenths" } }),
      );
      const [first, second] = planGuideToneLines(composition.chords);
      for (const [index, note] of first!.notes.entries()) {
        const other = second!.notes[index]!;
        expect(note.midi, `${seed}/${index}`).not.toBe(other.midi);
        expect(note.role).not.toBe(other.role);
      }
    }
  });
});
