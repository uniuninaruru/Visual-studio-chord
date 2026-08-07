import { describe, expect, it } from "vitest";
import {
  MINIMAL_GENERATOR_SETTINGS,
  euclideanPattern,
  euclideanRhythmBar,
  euclideanRhythmName,
  evenness,
  generateComposition,
  validateComposition,
} from "../src/music";
import type { GeneratorSettings } from "../src/types/music";

const show = (pattern: readonly boolean[]) =>
  pattern.map((hit) => (hit ? "x" : ".")).join("");

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...MINIMAL_GENERATOR_SETTINGS,
    ...patch,
    melody: { ...MINIMAL_GENERATOR_SETTINGS.melody, ...patch.melody },
  };
}

describe("the pattern itself", () => {
  it("produces the rhythms traditional music actually uses", () => {
    // This is the evidence that the algorithm finds something real rather than
    // merely something regular: no musical input goes in, and these come out.
    expect(show(euclideanPattern(3, 8))).toBe("x..x..x."); // tresillo
    expect(show(euclideanPattern(5, 8))).toBe("x.xx.xx."); // cinquillo
    expect(show(euclideanPattern(2, 5))).toBe("x.x..");
    expect(show(euclideanPattern(3, 4))).toBe("xxx.");
    expect(show(euclideanPattern(4, 9))).toBe("x.x.x.x..");
    expect(show(euclideanPattern(5, 12))).toBe("x..x.x..x.x.");
    expect(show(euclideanPattern(5, 16))).toBe("x..x..x..x..x...");
    expect(show(euclideanPattern(7, 12))).toBe("x.xx.x.xx.x.");
    expect(show(euclideanPattern(7, 16))).toBe("x..x.x.x..x.x.x.");
    expect(show(euclideanPattern(9, 16))).toBe("x.xx.x.x.xx.x.x.");
  });

  it("names the ones that have names", () => {
    expect(euclideanRhythmName(3, 8)).toBe("Tresillo");
    expect(euclideanRhythmName(5, 8)).toBe("Cinquillo");
    expect(euclideanRhythmName(7, 12)).toBe("West African bell");
    expect(euclideanRhythmName(6, 11)).toBeNull();
  });

  it("places exactly the number of onsets asked for", () => {
    for (let steps = 1; steps <= 16; steps += 1) {
      for (let onsets = 0; onsets <= steps; onsets += 1) {
        const pattern = euclideanPattern(onsets, steps);
        expect(pattern, `${onsets}/${steps}`).toHaveLength(steps);
        expect(pattern.filter(Boolean), `${onsets}/${steps}`).toHaveLength(onsets);
      }
    }
  });

  it("handles the degenerate cases", () => {
    expect(show(euclideanPattern(0, 8))).toBe("........");
    expect(show(euclideanPattern(4, 4))).toBe("xxxx");
    // More onsets than steps is a full bar, not an error.
    expect(show(euclideanPattern(9, 4))).toBe("xxxx");
    expect(euclideanPattern(3, 0)).toEqual([]);
    expect(euclideanPattern(3, -2)).toEqual([]);
  });

  it("rotates without changing how many hits there are", () => {
    const base = euclideanPattern(3, 8);
    for (const rotation of [1, 3, 7, -1, 100]) {
      const rotated = euclideanPattern(3, 8, rotation);
      expect(rotated.filter(Boolean), `${rotation}`).toHaveLength(3);
      expect(rotated).toHaveLength(8);
    }
    // A full turn is no turn.
    expect(euclideanPattern(3, 8, 8)).toEqual(base);
    expect(show(euclideanPattern(3, 8, 1))).toBe("..x..x.x");
  });

  it("spreads onsets as evenly as the step count allows", () => {
    // Where the onsets divide the steps exactly, evenness is perfect.
    expect(evenness(euclideanPattern(4, 16))).toBe(1);
    expect(evenness(euclideanPattern(2, 8))).toBe(1);
    // And where they cannot, it is still the most even arrangement: every gap
    // is one of two adjacent sizes, never three.
    for (const [onsets, steps] of [[3, 8], [5, 8], [7, 12], [5, 16]] as const) {
      const pattern = euclideanPattern(onsets, steps);
      const indices = pattern.map((hit, i) => (hit ? i : -1)).filter((i) => i >= 0);
      const gaps = indices.map((index, position) =>
        position === indices.length - 1
          ? steps - index + (indices[0] as number)
          : (indices[position + 1] as number) - index,
      );
      expect(new Set(gaps).size, `${onsets}/${steps}`).toBeLessThanOrEqual(2);
      expect(Math.max(...gaps) - Math.min(...gaps), `${onsets}/${steps}`).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic", () => {
    expect(euclideanPattern(7, 16, 3)).toEqual(euclideanPattern(7, 16, 3));
  });
});

describe("turning a pattern into a bar", () => {
  const bar = (onsets: number, steps: number, rotation = 0, barIndex = 0) =>
    euclideanRhythmBar({
      timeSignature: "4/4",
      settings: { onsets, steps, rotation },
      barIndex,
    });

  it("covers the bar exactly, with no gaps", () => {
    for (const [onsets, steps] of [[3, 8], [5, 8], [5, 16], [1, 4], [7, 12]] as const) {
      for (const rotation of [0, 1, 5]) {
        const slots = bar(onsets, steps, rotation);
        const total = slots.reduce((sum, slot) => sum + slot.durationTick, 0);
        expect(total, `${onsets}/${steps} rot${rotation}`).toBe(1920);
        for (let index = 1; index < slots.length; index += 1) {
          const previous = slots[index - 1]!;
          expect(slots[index]!.startTick).toBe(previous.startTick + previous.durationTick);
        }
      }
    }
  });

  it("lets each hit last until the next one", () => {
    // The silence after a hit belongs to that hit; that is what makes the
    // spacing audible rather than a row of equal notes.
    const slots = bar(3, 8);
    expect(slots.map((slot) => slot.durationTick)).toEqual([720, 720, 480]);
    expect(slots.every((slot) => !slot.isRest)).toBe(true);
  });

  it("opens with a rest when the pattern does", () => {
    const slots = bar(3, 8, 1); // ..x..x.x
    expect(slots[0]!.isRest).toBe(true);
    expect(slots[0]!.startTick).toBe(0);
    expect(slots.filter((slot) => !slot.isRest)).toHaveLength(3);
  });

  it("offsets by the bar it is in", () => {
    const slots = bar(3, 8, 0, 5);
    expect(slots[0]!.startTick).toBe(5 * 1920);
  });

  it("never returns a silent bar", () => {
    // The melody generator has nothing to write into one.
    const slots = bar(0, 8);
    expect(slots.some((slot) => !slot.isRest)).toBe(true);
  });

  it("works where the steps do not divide the bar evenly", () => {
    for (const steps of [5, 7, 9, 11, 13]) {
      const slots = euclideanRhythmBar({
        timeSignature: "4/4",
        settings: { onsets: 3, steps },
        barIndex: 0,
      });
      expect(slots.reduce((sum, slot) => sum + slot.durationTick, 0), `${steps}`).toBe(1920);
      for (const slot of slots) {
        expect(Number.isInteger(slot.durationTick)).toBe(true);
        expect(slot.durationTick).toBeGreaterThan(0);
      }
    }
  });

  it("works in every time signature", () => {
    for (const timeSignature of ["4/4", "3/4", "6/8"] as const) {
      const slots = euclideanRhythmBar({
        timeSignature,
        settings: { onsets: 3, steps: 8 },
        barIndex: 0,
      });
      const expected = timeSignature === "3/4" ? 1440 : timeSignature === "6/8" ? 1440 : 1920;
      expect(slots.reduce((sum, s) => sum + s.durationTick, 0), timeSignature).toBe(expected);
    }
  });
});

describe("euclidean rhythm in generated compositions", () => {
  const euclid = (patch: Partial<GeneratorSettings> = {}) =>
    settings({
      bars: 8,
      seed: "eu",
      euclideanRhythm: { enabled: true, onsets: 3, steps: 8 },
      ...patch,
    });

  it("stays valid across patterns, modes and time signatures", () => {
    for (const [onsets, steps] of [[3, 8], [5, 8], [7, 16], [5, 16], [1, 4]] as const) {
      for (const timeSignature of ["4/4", "3/4", "6/8"] as const) {
        const composition = generateComposition(
          euclid({
            timeSignature,
            seed: `${onsets}-${steps}-${timeSignature}`,
            euclideanRhythm: { enabled: true, onsets, steps },
          }),
        );
        expect(
          validateComposition(composition).errors,
          `${onsets}/${steps} ${timeSignature}`,
        ).toEqual([]);
      }
    }
  });

  it("puts the melody on the pattern's onsets", () => {
    const composition = generateComposition(euclid());
    const stepTicks = 1920 / 8;
    const onsets = new Set([0, 3, 6].map((step) => step * stepTicks));
    for (const note of composition.notes) {
      const local = note.startTick % 1920;
      expect(onsets.has(local), `tick ${local}`).toBe(true);
    }
    // Three onsets a bar, eight bars.
    expect(composition.notes).toHaveLength(24);
  });

  it("ignores the density and rest controls, which would break the pattern", () => {
    // A rest rate applied on top would remove exactly the hits that make the
    // spacing recognisable.
    const sparse = generateComposition(
      euclid({ melody: { ...MINIMAL_GENERATOR_SETTINGS.melody, density: 0.1, restRate: 0.9 } }),
    );
    const dense = generateComposition(
      euclid({ melody: { ...MINIMAL_GENERATOR_SETTINGS.melody, density: 1, restRate: 0 } }),
    );
    expect(sparse.notes.map((n) => n.startTick)).toEqual(dense.notes.map((n) => n.startTick));
  });

  it("changes the rhythm, and rotation changes it again", () => {
    const plain = generateComposition(euclid({ euclideanRhythm: undefined }));
    const pattern = generateComposition(euclid());
    const rotated = generateComposition(
      euclid({ euclideanRhythm: { enabled: true, onsets: 3, steps: 8, rotation: 1 } }),
    );
    expect(pattern.notes.map((n) => n.startTick)).not.toEqual(plain.notes.map((n) => n.startTick));
    expect(rotated.notes.map((n) => n.startTick)).not.toEqual(pattern.notes.map((n) => n.startTick));
  });

  it("is deterministic and distinguishes its settings", () => {
    expect(generateComposition(euclid())).toEqual(generateComposition(euclid()));
    const ids = [
      generateComposition(euclid({ euclideanRhythm: undefined })).id,
      generateComposition(euclid()).id,
      generateComposition(euclid({ euclideanRhythm: { enabled: true, onsets: 5, steps: 8 } })).id,
      generateComposition(euclid({ euclideanRhythm: { enabled: true, onsets: 3, steps: 8, rotation: 2 } })).id,
    ];
    expect(new Set(ids).size).toBe(4);
  });

  it("composes with the rest of the engine", () => {
    const composition = generateComposition(
      euclid({
        bars: 16,
        seed: "all",
        songForm: { form: "verseChorus" },
        phraseGrammar: { enabled: true },
        melodicSkeleton: { enabled: true },
        voiceLeading: { enabled: true },
      }),
    );
    expect(validateComposition(composition).errors).toEqual([]);
  });
});
