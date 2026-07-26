import { describe, expect, it } from "vitest";
import {
  polymeterCycleBars,
  polymeterPhases,
  polymeterSlots,
  polyrhythmCoincidences,
  polyrhythmRatio,
  polyrhythmSlots,
} from "../src/music";

const BAR = 1920;

const layer = (pulses: number, spanBars = 1, startBar = 0) =>
  polyrhythmSlots({
    timeSignature: "4/4",
    settings: { enabled: true, pulses, spanBars },
    startBar,
  });

describe("polyrhythm", () => {
  it("produces nothing when off or asked for no pulses", () => {
    expect(polyrhythmSlots({
      timeSignature: "4/4", settings: { enabled: false, pulses: 3 }, startBar: 0,
    })).toEqual([]);
    expect(layer(0)).toEqual([]);
    expect(layer(-2)).toEqual([]);
  });

  it("divides the span into exactly that many pulses", () => {
    for (const pulses of [2, 3, 4, 5, 7, 11]) {
      const slots = layer(pulses);
      expect(slots, `${pulses}`).toHaveLength(pulses);
      expect(slots.reduce((sum, slot) => sum + slot.durationTick, 0), `${pulses}`).toBe(BAR);
    }
  });

  it("ends exactly on the cycle boundary, so the layers meet", () => {
    // Rounding each pulse independently would drift; the remainder is
    // distributed instead, which is what keeps the last pulse landing home.
    for (const pulses of [5, 7, 11, 13]) {
      for (const spanBars of [1, 2, 3]) {
        const slots = layer(pulses, spanBars);
        const last = slots[slots.length - 1]!;
        expect(last.startTick + last.durationTick, `${pulses}/${spanBars}`).toBe(BAR * spanBars);
        for (const slot of slots) {
          expect(Number.isInteger(slot.durationTick)).toBe(true);
          expect(slot.durationTick).toBeGreaterThan(0);
        }
      }
    }
  });

  it("is contiguous and offset by the bar it starts on", () => {
    const slots = layer(3, 1, 4);
    expect(slots[0]!.startTick).toBe(4 * BAR);
    for (let index = 1; index < slots.length; index += 1) {
      const previous = slots[index - 1]!;
      expect(slots[index]!.startTick).toBe(previous.startTick + previous.durationTick);
    }
  });

  it("spreads three pulses evenly over a four-four bar", () => {
    expect(layer(3).map((slot) => slot.durationTick)).toEqual([640, 640, 640]);
    // Five does not divide 1920, so the remainder goes to the earliest pulses.
    expect(layer(5).map((slot) => slot.durationTick)).toEqual([384, 384, 384, 384, 384]);
    expect(layer(7).map((slot) => slot.durationTick)).toEqual([275, 275, 274, 274, 274, 274, 274]);
  });

  it("reports the ratio against the bar's own beat, in lowest terms", () => {
    expect(polyrhythmRatio(3, "4/4")).toEqual([3, 4]);
    expect(polyrhythmRatio(6, "4/4")).toEqual([3, 2]);
    expect(polyrhythmRatio(2, "4/4")).toEqual([1, 2]);
    expect(polyrhythmRatio(3, "3/4")).toEqual([1, 1]);
    // 6/8 is counted in two compound beats, not six.
    expect(polyrhythmRatio(3, "6/8")).toEqual([3, 2]);
    expect(polyrhythmRatio(3, "4/4", 2)).toEqual([3, 8]);
  });

  it("says how often two layers land together", () => {
    // Three against two meet once a cycle — at the start. That is why the figure
    // is heard as one gesture rather than two loops.
    expect(polyrhythmCoincidences(3, 2, BAR)).toEqual([0]);
    expect(polyrhythmCoincidences(4, 2, BAR)).toEqual([0, 960]);
    expect(polyrhythmCoincidences(6, 4, BAR)).toEqual([0, 960]);
    expect(polyrhythmCoincidences(0, 4, BAR)).toEqual([]);
    expect(polyrhythmCoincidences(3, 2, 0)).toEqual([]);
  });
});

describe("polymeter", () => {
  it("takes the least common multiple of the two counts to come home", () => {
    // The number that decides whether a polymeter is a device or a structure:
    // a piece shorter than the cycle never hears it resolve.
    expect(polymeterCycleBars(7, 4)).toBe(7);
    expect(polymeterCycleBars(3, 4)).toBe(3);
    expect(polymeterCycleBars(5, 4)).toBe(5);
    // A six-step pattern is back on the downbeat after twelve steps, which is
    // three bars — not two, which is where the pattern merely repeats.
    expect(polymeterCycleBars(6, 4)).toBe(3);
    // A pattern the length of the bar never drifts; one twice its length takes
    // two bars, because that is when it starts over on a bar line.
    expect(polymeterCycleBars(4, 4)).toBe(1);
    expect(polymeterCycleBars(8, 4)).toBe(2);
  });

  it("walks the downbeat around the bar and back", () => {
    const phases = polymeterPhases(7, 4, 8);
    expect(phases.map((phase) => phase.offsetSteps)).toEqual([0, 4, 1, 5, 2, 6, 3, 0]);
    expect(phases.filter((phase) => phase.aligned).map((phase) => phase.bar)).toEqual([0, 7]);
    // A pattern that fits the bar never drifts.
    expect(polymeterPhases(4, 4, 4).every((phase) => phase.aligned)).toBe(true);
    expect(polymeterPhases(7, 4, 0)).toEqual([]);
  });

  it("keeps the pulse and moves the downbeat", () => {
    // Both layers agree on the step length — that is what makes it polymeter
    // rather than polyrhythm.
    const slots = polymeterSlots({
      timeSignature: "4/4",
      settings: { enabled: true, patternSteps: 7, barSteps: 16 },
      bars: 2,
    });
    const step = BAR / 16;
    for (const slot of slots) expect(slot.startTick % step).toBe(0);
    expect(slots).toHaveLength(32);
  });

  it("honours a pattern of onsets and rests", () => {
    const slots = polymeterSlots({
      timeSignature: "4/4",
      settings: { enabled: true, patternSteps: 3, barSteps: 4 },
      bars: 3,
      pattern: [true, false, false],
    });
    // Three-step pattern, one hit each, over twelve steps.
    expect(slots).toHaveLength(4);
    expect(slots.map((slot) => slot.startTick)).toEqual([0, 1440, 2880, 4320]);
    // Each hit lasts until the next, so the phase is heard as spacing.
    expect(slots.map((slot) => slot.durationTick)).toEqual([1440, 1440, 1440, 1440]);
  });

  it("produces nothing when off or given no bars", () => {
    expect(polymeterSlots({
      timeSignature: "4/4",
      settings: { enabled: false, patternSteps: 7, barSteps: 16 },
      bars: 4,
    })).toEqual([]);
    expect(polymeterSlots({
      timeSignature: "4/4",
      settings: { enabled: true, patternSteps: 7, barSteps: 16 },
      bars: 0,
    })).toEqual([]);
  });

  it("keeps every slot legal in each time signature", () => {
    for (const timeSignature of ["4/4", "3/4", "6/8"] as const) {
      const slots = polymeterSlots({
        timeSignature,
        settings: { enabled: true, patternSteps: 5, barSteps: 12 },
        bars: 4,
      });
      for (const slot of slots) {
        expect(Number.isInteger(slot.startTick), timeSignature).toBe(true);
        expect(Number.isInteger(slot.durationTick), timeSignature).toBe(true);
        expect(slot.durationTick, timeSignature).toBeGreaterThan(0);
      }
      for (let index = 1; index < slots.length; index += 1) {
        expect(slots[index]!.startTick).toBeGreaterThanOrEqual(slots[index - 1]!.startTick);
      }
    }
  });

  it("is deterministic", () => {
    const options = {
      timeSignature: "4/4" as const,
      settings: { enabled: true, patternSteps: 7, barSteps: 16 },
      bars: 4,
    };
    expect(polymeterSlots(options)).toEqual(polymeterSlots(options));
  });
});
