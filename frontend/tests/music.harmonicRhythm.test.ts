import { describe, expect, it } from "vitest";
import {
  MINIMAL_GENERATOR_SETTINGS,
  buildChordSlots,
  chordSlotsFor,
  generateComposition,
  isOneChordPerBar,
  planHarmonicRhythm,
  ticksPerBar,
  validateComposition,
} from "../src/music";
import type {
  GeneratorSettings,
  HarmonicRhythmSettings,
  TimeSignature,
} from "../src/types/music";

const SIGNATURES = ["4/4", "3/4", "6/8"] satisfies TimeSignature[];

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...MINIMAL_GENERATOR_SETTINGS,
    ...patch,
    melody: { ...MINIMAL_GENERATOR_SETTINGS.melody, ...patch.melody },
  };
}

function withRhythm(rhythm: HarmonicRhythmSettings, patch: Partial<GeneratorSettings> = {}) {
  return generateComposition(settings({ bars: 4, seed: "hr", ...patch, harmonicRhythm: rhythm }));
}

describe("harmonic rhythm planning", () => {
  it("defaults to one chord per bar", () => {
    expect(planHarmonicRhythm(4, undefined).changesPerBar).toEqual([1, 1, 1, 1]);
    expect(planHarmonicRhythm(4, {}).changesPerBar).toEqual([1, 1, 1, 1]);
  });

  it("subdivides every bar for changesPerBar", () => {
    expect(planHarmonicRhythm(4, { changesPerBar: 2 }).changesPerBar).toEqual([2, 2, 2, 2]);
    expect(planHarmonicRhythm(3, { changesPerBar: 4 }).changesPerBar).toEqual([4, 4, 4]);
  });

  it("marks continuation bars with zero for barsPerChord", () => {
    // One change, then a bar that carries the same chord on.
    expect(planHarmonicRhythm(4, { barsPerChord: 2 }).changesPerBar).toEqual([1, 0, 1, 0]);
  });

  it("doubles the rate over the final two bars when accelerating", () => {
    expect(planHarmonicRhythm(4, { cadentialAcceleration: true }).changesPerBar)
      .toEqual([1, 1, 2, 2]);
    expect(planHarmonicRhythm(8, { changesPerBar: 2, cadentialAcceleration: true }).changesPerBar)
      .toEqual([2, 2, 2, 2, 2, 2, 4, 4]);
  });

  it("does not accelerate a span too short to have an approach", () => {
    expect(planHarmonicRhythm(2, { cadentialAcceleration: true }).changesPerBar).toEqual([1, 1]);
  });

  it("ignores values that are not positive integers", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(planHarmonicRhythm(2, { changesPerBar: bad }).changesPerBar).toEqual([1, 1]);
    }
  });
});

describe("chord slots", () => {
  it.each(SIGNATURES)("tiles a %s bar exactly at every rate", (timeSignature) => {
    const barTicks = ticksPerBar(timeSignature);
    for (const changesPerBar of [1, 2, 3, 4]) {
      const slots = chordSlotsFor(4, timeSignature, { changesPerBar });
      expect(slots).toHaveLength(4 * changesPerBar);
      let cursor = 0;
      for (const slot of slots) {
        expect(slot.startTick).toBe(cursor);
        expect(slot.durationTick).toBeGreaterThan(0);
        cursor += slot.durationTick;
      }
      expect(cursor).toBe(4 * barTicks);
    }
  });

  it("uses integer ticks even when the bar does not divide evenly", () => {
    // 3/4 into four parts does not divide exactly.
    const slots = chordSlotsFor(1, "3/4", { changesPerBar: 4 });
    expect(slots.every((slot) => Number.isInteger(slot.durationTick))).toBe(true);
    const total = slots.reduce((sum, slot) => sum + slot.durationTick, 0);
    expect(total).toBe(ticksPerBar("3/4"));
    // The remainder goes to the earliest slots, keeping the downbeat longest.
    expect(slots[0]!.durationTick).toBeGreaterThanOrEqual(slots.at(-1)!.durationTick);
  });

  it("extends a held chord across its continuation bars", () => {
    const barTicks = ticksPerBar("4/4");
    const slots = chordSlotsFor(4, "4/4", { barsPerChord: 2 });
    expect(slots).toHaveLength(2);
    expect(slots.every((slot) => slot.durationTick === barTicks * 2)).toBe(true);
    expect(slots[1]!.startTick).toBe(barTicks * 2);
  });

  it("records the bar and the position within it", () => {
    const slots = chordSlotsFor(2, "4/4", { changesPerBar: 2 });
    expect(slots.map((slot) => [slot.barIndex, slot.indexInBar])).toEqual([
      [0, 0], [0, 1], [1, 0], [1, 1],
    ]);
  });

  it("offsets from a starting bar, for generating one section", () => {
    const barTicks = ticksPerBar("4/4");
    const slots = chordSlotsFor(2, "4/4", undefined, undefined, 3);
    expect(slots[0]!.startTick).toBe(3 * barTicks);
    expect(slots[0]!.barIndex).toBe(3);
  });

  it("recognises the one-chord-per-bar case", () => {
    const barTicks = ticksPerBar("4/4");
    expect(isOneChordPerBar(chordSlotsFor(4, "4/4"), barTicks)).toBe(true);
    expect(isOneChordPerBar(chordSlotsFor(4, "4/4", { changesPerBar: 2 }), barTicks)).toBe(false);
  });

  it("survives a leading continuation bar rather than dropping it", () => {
    const barTicks = ticksPerBar("4/4");
    const slots = buildChordSlots({ changesPerBar: [0, 1] }, "4/4");
    // Nothing precedes the zero, so it holds a chord of its own instead of
    // leaving the span uncovered.
    expect(slots[0]!.startTick).toBe(0);
    const total = slots.reduce((sum, slot) => sum + slot.durationTick, 0);
    expect(total).toBe(2 * barTicks);
  });
});

describe("generated compositions", () => {
  it("places one chord per bar by default", () => {
    const composition = generateComposition(settings({ bars: 4, seed: "plain" }));
    expect(composition.chords).toHaveLength(4);
    expect(
      composition.chords.every((chord) => chord.durationTick === composition.ticksPerBar),
    ).toBe(true);
  });

  it("produces the requested number of chords at each rate", () => {
    expect(withRhythm({ changesPerBar: 2 }).chords).toHaveLength(8);
    expect(withRhythm({ barsPerChord: 2 }).chords).toHaveLength(2);
    // 1 + 1 + 2 + 2
    expect(withRhythm({ cadentialAcceleration: true }).chords).toHaveLength(6);
  });

  it("shortens chords into the cadence when accelerating", () => {
    const composition = withRhythm({ cadentialAcceleration: true });
    const bar = composition.ticksPerBar;
    expect(composition.chords[0]!.durationTick).toBe(bar);
    expect(composition.chords.at(-1)!.durationTick).toBe(bar / 2);
  });

  it("keeps the chord timeline gap-free at every rate", () => {
    for (const rhythm of [
      { changesPerBar: 2 },
      { changesPerBar: 4 },
      { barsPerChord: 2 },
      { cadentialAcceleration: true },
      { changesPerBar: 2, cadentialAcceleration: true },
    ] satisfies HarmonicRhythmSettings[]) {
      for (const timeSignature of SIGNATURES) {
        const composition = withRhythm(rhythm, { timeSignature, bars: 8 });
        let cursor = 0;
        for (const chord of composition.chords) {
          expect(chord.startTick).toBe(cursor);
          cursor += chord.durationTick;
        }
        expect(cursor).toBe(composition.totalTicks);
        expect(validateComposition(composition).errors).toEqual([]);
      }
    }
  });

  it("stays valid with a named progression and with a song form", () => {
    const named = withRhythm({ changesPerBar: 2 }, { progressionId: "royal-road", bars: 4 });
    expect(validateComposition(named).errors).toEqual([]);
    expect(named.chords).toHaveLength(8);

    const sectioned = withRhythm(
      { changesPerBar: 2 },
      { songForm: { form: "verseChorus", finalLift: 2 }, bars: 8 },
    );
    expect(validateComposition(sectioned).errors).toEqual([]);
    expect(sectioned.chords).toHaveLength(16);
  });

  it("is deterministic", () => {
    const make = () => withRhythm({ changesPerBar: 2, cadentialAcceleration: true });
    expect(make()).toEqual(make());
  });

  it("distinguishes two pieces that differ only by harmonic rhythm", () => {
    const plain = generateComposition(settings({ seed: "same" }));
    const fast = generateComposition(
      settings({ seed: "same", harmonicRhythm: { changesPerBar: 2 } }),
    );
    expect(fast.id).not.toBe(plain.id);
  });

  it("leaves output untouched when no harmonic rhythm is set", () => {
    const plain = generateComposition(settings({ seed: "same" }));
    const explicit = generateComposition(settings({ seed: "same", harmonicRhythm: {} }));
    expect(explicit.chords).toEqual(plain.chords);
    expect(explicit.notes).toEqual(plain.notes);
  });
});
