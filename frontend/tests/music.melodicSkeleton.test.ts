import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  generateComposition,
  planMelodicSkeleton,
  planPhrases,
  skeletonNotesInBar,
  skeletonPeak,
  skeletonRegisterAt,
  validateComposition,
} from "../src/music";
import type {
  CadenceType,
  CanonicalPitchClass,
  ChordEvent,
  GeneratorSettings,
} from "../src/types/music";
import type { MelodicSkeletonNote } from "../src/music";

const TICKS_PER_BAR = 1920;
const TICKS_PER_BEAT = 480;

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...DEFAULT_GENERATOR_SETTINGS,
    ...patch,
    melody: { ...DEFAULT_GENERATOR_SETTINGS.melody, ...patch.melody },
  };
}

/** A chord template taken from real output, so every field is realistic. */
const TEMPLATE = generateComposition(settings({ bars: 4, seed: "template" })).chords[0]!;

/** One chord per bar, all the same, so pitch choice is not confounded. */
function uniformChords(bars: number, notes: number[], root: CanonicalPitchClass): ChordEvent[] {
  return Array.from({ length: bars }, (_, barIndex) => ({
    ...TEMPLATE,
    id: `c${barIndex}`,
    root,
    notes: [...notes],
    startTick: barIndex * TICKS_PER_BAR,
    durationTick: TICKS_PER_BAR,
  }));
}

function plan(options: {
  bars?: number;
  seed?: string;
  cadence?: CadenceType;
  range?: readonly [number, number];
  chords?: ChordEvent[];
} = {}): MelodicSkeletonNote[] {
  const bars = options.bars ?? 16;
  const seed = options.seed ?? "sk";
  return planMelodicSkeleton({
    phrases: planPhrases({ bars, seed }),
    chords: options.chords ?? uniformChords(bars, [48, 52, 55], "C"),
    ticksPerBar: TICKS_PER_BAR,
    ticksPerBeat: TICKS_PER_BEAT,
    range: options.range ?? [60, 84],
    key: "C",
    cadence: options.cadence,
    seed,
  });
}

describe("planning the skeleton", () => {
  it("gives every phrase a start and a climax", () => {
    const phrases = planPhrases({ bars: 16, seed: "sk" });
    const skeleton = plan();
    for (const phrase of phrases) {
      const own = skeleton.filter((note) => note.phraseId === phrase.id);
      const roles = own.map((note) => note.structuralRole);
      expect(roles, phrase.id).toContain("climax");
      // A start can be outranked by a climax landing on the same tick, but the
      // phrase must never come away with nothing planned.
      expect(own.length, phrase.id).toBeGreaterThan(0);
    }
  });

  it("keeps a phrase start distinct from its climax", () => {
    // The climax is placed on a beat, not a bar, precisely so a two-bar phrase
    // does not put both points on its own first downbeat.
    const phrases = planPhrases({ bars: 16, seed: "sk" });
    const skeleton = plan();
    const first = phrases[0]!;
    const own = skeleton.filter((note) => note.phraseId === first.id);
    expect(own.map((note) => note.structuralRole)).toEqual(
      expect.arrayContaining(["phraseStart", "climax"]),
    );
  });

  it("plans a cadence only where a phrase actually closes", () => {
    const phrases = planPhrases({ bars: 16, seed: "sk" });
    const skeleton = plan();
    for (const phrase of phrases) {
      const roles = new Set(
        skeleton
          .filter((note) => note.phraseId === phrase.id)
          .map((note) => note.structuralRole),
      );
      const closes = phrase.cadenceStrength >= 0.5;
      expect(roles.has("cadentialResolution"), `${phrase.function}`).toBe(closes);
    }
    // The layout is a sentence, so only the cadential phrases close.
    expect(phrases.some((phrase) => phrase.cadenceStrength >= 0.5)).toBe(true);
    expect(phrases.some((phrase) => phrase.cadenceStrength < 0.5)).toBe(true);
  });

  it("approaches the close from a step above", () => {
    const skeleton = plan();
    for (const resolution of skeleton.filter(
      (note) => note.structuralRole === "cadentialResolution",
    )) {
      const preparation = skeleton.find(
        (note) =>
          note.phraseId === resolution.phraseId &&
          note.structuralRole === "cadentialPreparation",
      );
      if (!preparation) continue;
      expect(preparation.tick).toBeLessThan(resolution.tick);
      expect((preparation.pitchClass - resolution.pitchClass + 12) % 12).toBe(2);
    }
  });

  it("keeps every target inside the melody range", () => {
    for (const range of [[60, 84], [55, 72], [67, 79]] as const) {
      for (const note of plan({ range })) {
        expect(note.targetMidi, `${note.structuralRole}`).toBeGreaterThanOrEqual(range[0]);
        expect(note.targetMidi).toBeLessThanOrEqual(range[1]);
      }
    }
  });

  it("builds starts and climaxes out of chord tones", () => {
    const chords = uniformChords(16, [48, 52, 55], "C"); // C E G
    const chordClasses = new Set([0, 4, 7]);
    for (const note of plan({ chords })) {
      if (note.structuralRole === "phraseStart" || note.structuralRole === "climax") {
        expect(chordClasses, note.structuralRole).toContain(note.pitchClass);
      }
    }
  });

  it("lands the final close on the tonic when the cadence goes there", () => {
    const chords = uniformChords(16, [50, 53, 57], "D"); // a chord that is not the tonic
    const authentic = plan({ chords, cadence: "authentic" });
    const last = authentic.filter((n) => n.structuralRole === "cadentialResolution").at(-1)!;
    expect(last.pitchClass).toBe(0); // C

    // A half cadence does not resolve to the tonic, so the close takes the
    // chord's own root instead of pretending to land home.
    const half = plan({ chords, cadence: "half" });
    const halfLast = half.filter((n) => n.structuralRole === "cadentialResolution").at(-1)!;
    expect(halfLast.pitchClass).toBe(2); // D
  });

  it("puts the highest point past the middle but before the end", () => {
    const phrases = planPhrases({ bars: 16, seed: "sk" });
    const skeleton = plan();
    const peak = skeletonPeak(skeleton)!;
    const peakIndex = phrases.findIndex((phrase) => phrase.id === peak.phraseId);
    expect(peakIndex).toBeGreaterThan((phrases.length - 1) / 2);
    // Peaking on the final phrase would leave nowhere to come down to.
    expect(peakIndex).toBeLessThan(phrases.length - 1);
  });

  it("never plans two structural notes on one tick", () => {
    for (const bars of [4, 8, 16] as const) {
      const ticks = plan({ bars }).map((note) => note.tick);
      expect(new Set(ticks).size, `${bars} bars`).toBe(ticks.length);
    }
  });

  it("orders notes by tick", () => {
    const ticks = plan().map((note) => note.tick);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
  });

  it("is deterministic, and follows the seed", () => {
    expect(plan({ seed: "same" })).toEqual(plan({ seed: "same" }));
    expect(plan({ seed: "one" })).not.toEqual(plan({ seed: "two" }));
  });

  it("plans nothing without phrases or chords", () => {
    const empty = {
      ticksPerBar: TICKS_PER_BAR,
      ticksPerBeat: TICKS_PER_BEAT,
      range: [60, 84] as const,
      key: "C" as const,
      seed: "x",
    };
    expect(planMelodicSkeleton({ ...empty, phrases: [], chords: uniformChords(4, [48], "C") }))
      .toEqual([]);
    expect(planMelodicSkeleton({ ...empty, phrases: planPhrases({ bars: 4, seed: "x" }), chords: [] }))
      .toEqual([]);
  });
});

describe("reading a skeleton", () => {
  it("interpolates the register between structural notes", () => {
    const skeleton = plan();
    const first = skeleton[0]!;
    const second = skeleton[1]!;
    const middle = Math.floor((first.tick + second.tick) / 2);
    const register = skeletonRegisterAt(skeleton, middle)!;
    const [low, high] = [first.targetMidi, second.targetMidi].sort((a, b) => a - b);
    expect(register).toBeGreaterThanOrEqual(low!);
    expect(register).toBeLessThanOrEqual(high!);
  });

  it("holds flat before the first note and after the last", () => {
    const skeleton = plan();
    const first = skeleton[0]!;
    const last = skeleton.at(-1)!;
    expect(skeletonRegisterAt(skeleton, 0)).toBe(first.targetMidi);
    expect(skeletonRegisterAt(skeleton, first.tick - 500)).toBe(first.targetMidi);
    expect(skeletonRegisterAt(skeleton, last.tick + 100_000)).toBe(last.targetMidi);
  });

  it("reports nothing when there is no plan", () => {
    expect(skeletonRegisterAt([], 0)).toBeNull();
    expect(skeletonRegisterAt(undefined, 0)).toBeNull();
  });

  it("finds the notes in a bar", () => {
    const skeleton = plan();
    const bar = skeleton[0]!.barIndex;
    const inBar = skeletonNotesInBar(skeleton, bar);
    expect(inBar.length).toBeGreaterThan(0);
    expect(inBar.every((note) => note.barIndex === bar)).toBe(true);
    expect(skeletonNotesInBar(skeleton, 999)).toEqual([]);
    expect(skeletonNotesInBar(undefined, 0)).toEqual([]);
  });

  it("finds the highest target", () => {
    const skeleton = plan();
    const peak = skeletonPeak(skeleton)!;
    expect(peak.targetMidi).toBe(Math.max(...skeleton.map((note) => note.targetMidi)));
    expect(skeletonPeak([])).toBeNull();
  });
});

describe("the skeleton in generated compositions", () => {
  const shaped = (patch: Partial<GeneratorSettings> = {}) =>
    settings({
      bars: 16,
      seed: "gen",
      phraseGrammar: { enabled: true },
      melodicSkeleton: { enabled: true },
      ...patch,
    });

  it("produces a valid composition at every bar count and mode", () => {
    for (const bars of [4, 8, 16] as const) {
      for (const mode of ["major", "naturalMinor", "dorian", "mixolydian"] as const) {
        const composition = generateComposition(shaped({ bars, mode, seed: `s-${bars}-${mode}` }));
        expect(validateComposition(composition).errors, `${mode}/${bars}`).toEqual([]);
      }
    }
  });

  it("stays valid in 3/4 and 6/8, where a beat is not a quarter of a bar", () => {
    for (const timeSignature of ["3/4", "6/8"] as const) {
      const composition = generateComposition(shaped({ timeSignature }));
      expect(validateComposition(composition).errors, timeSignature).toEqual([]);
    }
  });

  it("changes the melody it produces", () => {
    const plain = generateComposition(shaped({ melodicSkeleton: undefined }));
    const withSkeleton = generateComposition(shaped());
    expect(withSkeleton.notes.map((note) => note.midi)).not.toEqual(
      plain.notes.map((note) => note.midi),
    );
  });

  it("does nothing without a phrase plan, which it is defined against", () => {
    const base = settings({ bars: 16, seed: "no-phrases" });
    const withSetting = generateComposition({
      ...base,
      melodicSkeleton: { enabled: true },
    });
    expect(withSetting.notes.map((note) => note.midi)).toEqual(
      generateComposition(base).notes.map((note) => note.midi),
    );
  });

  it("pulls the melody's register toward the plan", () => {
    // The measure is the mean register per bar, not the single highest note: one
    // stray note at the top of the range says nothing about the line's shape,
    // and the range ceiling is reached in almost every piece either way.
    const mean = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const correlation = (left: number[], right: number[]) => {
      const [ml, mr] = [mean(left), mean(right)];
      let product = 0;
      let leftSquares = 0;
      let rightSquares = 0;
      for (const [index, value] of left.entries()) {
        const dl = value - ml;
        const dr = right[index]! - mr;
        product += dl * dr;
        leftSquares += dl * dl;
        rightSquares += dr * dr;
      }
      return product / Math.sqrt(leftSquares * rightSquares || 1);
    };

    // Enough seeds that one unlucky piece cannot decide the result: the
    // per-seed correlation ranges from below zero to about 0.7.
    const scores = { plain: [] as number[], shaped: [] as number[] };
    for (const seed of Array.from({ length: 16 }, (_, index) => `corr-${index}`)) {
      const base = settings({ bars: 16, seed, phraseGrammar: { enabled: true } });
      const plainPiece = generateComposition(base);
      const shapedPiece = generateComposition({
        ...base,
        melodicSkeleton: { enabled: true },
      });
      const skeleton = planMelodicSkeleton({
        phrases: planPhrases({ bars: 16, seed }),
        chords: shapedPiece.chords,
        ticksPerBar: shapedPiece.ticksPerBar,
        ticksPerBeat: TICKS_PER_BEAT,
        range: [base.melody.minMidi, base.melody.maxMidi],
        key: base.key,
        cadence: shapedPiece.cadence,
        seed,
      });

      const planned: number[] = [];
      const actualPlain: number[] = [];
      const actualShaped: number[] = [];
      for (let bar = 0; bar < 16; bar += 1) {
        const register = skeletonRegisterAt(skeleton, bar * shapedPiece.ticksPerBar);
        const plainBar = plainPiece.notes.filter((n) => n.barIndex === bar).map((n) => n.midi);
        const shapedBar = shapedPiece.notes.filter((n) => n.barIndex === bar).map((n) => n.midi);
        if (register === null || plainBar.length === 0 || shapedBar.length === 0) continue;
        planned.push(register);
        actualPlain.push(mean(plainBar));
        actualShaped.push(mean(shapedBar));
      }
      scores.plain.push(correlation(planned, actualPlain));
      scores.shaped.push(correlation(planned, actualShaped));
    }

    // Without the skeleton the plan describes nothing about the line.
    expect(Math.abs(mean(scores.plain))).toBeLessThan(0.2);
    expect(mean(scores.shaped)).toBeGreaterThan(0.35);
    // The gap is the claim being made: the plan is what moved the line.
    expect(mean(scores.shaped)).toBeGreaterThan(mean(scores.plain) + 0.25);
    expect(
      scores.shaped.filter((score, index) => score > scores.plain[index]!).length,
    ).toBeGreaterThan(scores.shaped.length * 0.75);
  });

  it("is deterministic", () => {
    expect(generateComposition(shaped())).toEqual(generateComposition(shaped()));
  });

  it("distinguishes pieces that differ only by the setting", () => {
    expect(generateComposition(shaped()).id).not.toBe(
      generateComposition(shaped({ melodicSkeleton: undefined })).id,
    );
  });

  it("composes with harmonic rhythm, functional harmony and voice leading", () => {
    const composition = generateComposition(
      shaped({
        seed: "all",
        harmonicRhythm: { changesPerBar: 2 },
        functionalHarmony: { enabled: true },
        voiceLeading: { enabled: true },
      }),
    );
    expect(validateComposition(composition).errors).toEqual([]);
  });
});
