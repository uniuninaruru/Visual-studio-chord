import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  generateComposition,
  regenerateRange,
  setBarLocked,
  validateComposition,
  validateRegenerationPreservation,
} from "../src/music";
import type { GeneratedComposition, GeneratorSettings } from "../src/types/music";

function baseSettings(): GeneratorSettings {
  return {
    ...DEFAULT_GENERATOR_SETTINGS,
    seed: "partial-regeneration",
    melody: { ...DEFAULT_GENERATOR_SETTINGS.melody, restRate: 0.05 },
  };
}

function barData(composition: GeneratedComposition, barIndex: number) {
  return {
    chords: composition.chords.filter(
      (chord) => Math.floor(chord.startTick / composition.ticksPerBar) === barIndex,
    ),
    notes: composition.notes.filter((note) => note.barIndex === barIndex),
  };
}

describe("partial regeneration", () => {
  it("preserves every bar outside the end-exclusive selection", () => {
    const before = generateComposition(baseSettings());
    const after = regenerateRange(before, before.settings, { startBar: 2, endBar: 5 }, {
      target: "all",
      seedOffset: 7,
    });

    for (const barIndex of [0, 1, 5, 6, 7]) {
      expect(barData(after, barIndex)).toEqual(barData(before, barIndex));
    }
    expect(validateRegenerationPreservation(before, after, { startBar: 2, endBar: 5 })).toMatchObject({
      valid: true,
      errors: [],
    });
    expect(barData(after, 2)).not.toEqual(barData(before, 2));
    expect(validateComposition(after).valid).toBe(true);
  });

  it("preserves a locked bar inside the selected range", () => {
    const generated = generateComposition(baseSettings());
    const before = setBarLocked(generated, 3, true);
    const after = regenerateRange(before, before.settings, { startBar: 2, endBar: 5 }, {
      seedOffset: 8,
    });
    expect(barData(after, 3)).toEqual(barData(before, 3));
    expect(after.lockedBars).toEqual([3]);
    expect(validateRegenerationPreservation(before, after, { startBar: 2, endBar: 5 }).valid).toBe(true);
  });

  it("returns the source unchanged when every selected bar is locked", () => {
    let before = generateComposition(baseSettings());
    before = setBarLocked(before, 2, true);
    before = setBarLocked(before, 3, true);
    const after = regenerateRange(before, before.settings, { startBar: 2, endBar: 4 }, {
      seedOffset: 9,
    });
    expect(after).toBe(before);
  });

  it("can regenerate pitch while keeping note timing unchanged", () => {
    const before = generateComposition(baseSettings());
    const after = regenerateRange(before, before.settings, { startBar: 1, endBar: 3 }, {
      target: "pitch",
      seedOffset: 11,
    });
    const timing = (composition: GeneratedComposition) =>
      composition.notes.map(({ id, startTick, durationTick, barIndex }) => ({
        id,
        startTick,
        durationTick,
        barIndex,
      }));
    expect(timing(after)).toEqual(timing(before));
    expect(after.chords).toEqual(before.chords);
  });

  it("is deterministic for the same source, range, and regeneration options", () => {
    const before = generateComposition(baseSettings());
    const range = { startBar: 1, endBar: 4 };
    const options = { target: "melody" as const, seedOffset: 19 };
    expect(regenerateRange(before, before.settings, range, options)).toEqual(
      regenerateRange(before, before.settings, range, options),
    );
  });

  it("rejects invalid or structurally incompatible ranges", () => {
    const before = generateComposition(baseSettings());
    expect(() =>
      regenerateRange(before, before.settings, { startBar: 4, endBar: 4 }),
    ).toThrow(/Bar range/);
    expect(() =>
      regenerateRange(
        before,
        { ...before.settings, timeSignature: "3/4" },
        { startBar: 0, endBar: 1 },
      ),
    ).toThrow(/cannot change bar count or time signature/);
  });

  it("detects an accidental edit outside the regeneration selection", () => {
    const before = generateComposition(baseSettings());
    const after = structuredClone(before);
    const outsideNote = after.notes.find((note) => note.barIndex === 0)!;
    outsideNote.velocity -= 1;
    expect(
      validateRegenerationPreservation(before, after, { startBar: 2, endBar: 4 }),
    ).toMatchObject({ valid: false });
  });
});
