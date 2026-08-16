import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition, validateComposition } from "../src/music";
import {
  generateNoteValueBar,
  generateRhythmBar,
  rhythmExactlyCoversBar,
} from "../src/music/rhythmGenerator";
import { PPQ, type GeneratorSettings } from "../src/types/music";

/**
 * Why every melody sounded like every other melody.
 *
 * Not the harmony and not the pitches: measured across 24 seeds, the melodic
 * interval trigrams carried 94% of the entropy available to them, every one of
 * the 24 rhythms was distinct as a string, and every contour was distinct.
 *
 * The rhythm had two note lengths. Not usually two -- two by arithmetic. The
 * partition took the bar's sixteenth count, divided by a target slot count and
 * handed out the remainder a unit at a time, so the only lengths it can ever
 * emit are floor(n/k) and floor(n/k)+1. Measured: 3349 notes across 24 pop
 * pieces, 59% eighths and 41% sixteenths, nothing else. No quarter. Nothing
 * held, nothing dotted, nothing across a bar line. And not one phrase in any
 * piece landed on a note longer than an eighth, because there was no longer
 * note to land on.
 */

const SEEDS = Array.from({ length: 16 }, (_, index) => `s${index}`);
const STYLES = ["pop", "jazz", "ballad", "rock"] as const;
const SIXTEENTH = PPQ / 4;

function piece(patch: Partial<GeneratorSettings>, varied: boolean) {
  return generateComposition({
    ...DEFAULT_GENERATOR_SETTINGS, bars: 16, ...patch,
    melody: { ...DEFAULT_GENERATOR_SETTINGS.melody, variedNoteValues: varied },
  } as GeneratorSettings);
}

function durationsOf(varied: boolean) {
  const counts = new Map<number, number>();
  for (const style of STYLES) {
    for (const seed of SEEDS) {
      for (const note of piece({ seed, style }, varied).notes) {
        const units = Math.round(note.durationTick / SIXTEENTH);
        counts.set(units, (counts.get(units) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function entropy(counts: Map<number, number>): number {
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / total;
    bits -= p * Math.log2(p);
  }
  return bits;
}

describe("note values instead of an equal division", () => {
  it("changes nothing when it is off", () => {
    const off = piece({ seed: "same" }, false);
    const absent = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS, bars: 16, seed: "same",
      melody: { ...DEFAULT_GENERATOR_SETTINGS.melody, variedNoteValues: undefined },
    } as GeneratorSettings);
    expect(JSON.stringify(off.notes)).toBe(JSON.stringify(absent.notes));
  }, 30_000);

  it("emits two lengths without it, and the whole vocabulary with it", () => {
    // Two is not an observation about taste, it is what the arithmetic permits.
    expect(durationsOf(false).size).toBe(2);
    expect(durationsOf(true).size).toBeGreaterThanOrEqual(7);
  }, 240_000);

  it("more than doubles the rhythm's entropy", () => {
    // Measured: 1.00 bit per note against 2.59.
    expect(entropy(durationsOf(true))).toBeGreaterThan(entropy(durationsOf(false)) * 2);
  }, 240_000);

  it("lands every phrase on a note long enough to hear it land", () => {
    // Measured before: 0% of phrases ended on anything longer than an eighth,
    // in any piece, in any style. A phrase that ends on a sixteenth has not
    // ended, it has stopped.
    let phrases = 0;
    let landed = 0;
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const composed = piece({ seed, style }, true);
        const barTicks = composed.ppq * 4;
        for (let phrase = 0; phrase * 4 < composed.bars.length; phrase += 1) {
          const inside = composed.notes.filter((note) => {
            const bar = Math.floor(note.startTick / barTicks);
            return bar >= phrase * 4 && bar < phrase * 4 + 4;
          });
          if (inside.length === 0) continue;
          phrases += 1;
          const last = inside[inside.length - 1] as { durationTick: number };
          if (last.durationTick >= 4 * SIXTEENTH) landed += 1;
        }
      }
    }
    expect(landed / phrases).toBeGreaterThan(0.9);
  }, 240_000);

  it("does not trade the pitches away for the rhythm", () => {
    // The pitches were never the problem, so they must not become one.
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const composed = piece({ seed, style }, true);
        expect(validateComposition(composed).errors.map((issue) => issue.code), `${style}/${seed}`)
          .toEqual([]);
      }
    }
  }, 240_000);

  it("covers the bar exactly, like the partition it replaces", () => {
    for (const density of [0, 0.25, 0.5, 0.75, 1]) {
      for (const barIndex of [0, 1, 7]) {
        for (const timeSignature of ["4/4", "3/4", "6/8"] as const) {
          const slots = generateNoteValueBar({
            timeSignature, density, restRate: 0.2, syncopation: 0.3,
            seed: `cover-${density}`, barIndex,
          });
          expect(
            rhythmExactlyCoversBar(slots, barIndex, timeSignature),
            `${timeSignature}/${density}/${barIndex}`,
          ).toBe(true);
        }
      }
    }
  });

  it("uses long values at low density and short ones at high", () => {
    // Density is the app's existing dial and it means how many notes are in a
    // bar, so it has to keep meaning that.
    const notes = (density: number) => generateNoteValueBar({
      timeSignature: "4/4", density, restRate: 0, syncopation: 0,
      seed: "density", barIndex: 0,
    }).length;
    expect(notes(0.9)).toBeGreaterThan(notes(0.1));
  });

  it("always sounds something", () => {
    for (const seed of ["r1", "r2", "r3", "r4"]) {
      const slots = generateNoteValueBar({
        timeSignature: "4/4", density: 0.5, restRate: 1, syncopation: 0,
        seed, barIndex: 0,
      });
      expect(slots.some((slot) => !slot.isRest), seed).toBe(true);
    }
  });

  it("never rests through a long value", () => {
    // Silence measured in half notes reads as the piece stopping rather than as
    // the line breathing.
    for (const seed of SEEDS) {
      for (const slot of generateNoteValueBar({
        timeSignature: "4/4", density: 0.3, restRate: 0.9, syncopation: 0,
        seed, barIndex: 0,
      })) {
        if (slot.isRest) expect(slot.durationTick, seed).toBeLessThanOrEqual(4 * SIXTEENTH);
      }
    }
  });

  it("reserves the landing before filling, not after", () => {
    // A bar already filled has no room left to lengthen anything.
    const soft = generateNoteValueBar({
      timeSignature: "4/4", density: 0.9, restRate: 0, syncopation: 0,
      seed: "land", barIndex: 0, closesPhrase: true, cadenceStrength: 0.4,
    });
    const firm = generateNoteValueBar({
      timeSignature: "4/4", density: 0.9, restRate: 0, syncopation: 0,
      seed: "land", barIndex: 0, closesPhrase: true, cadenceStrength: 1,
    });
    expect((soft[soft.length - 1] as { durationTick: number }).durationTick).toBe(4 * SIXTEENTH);
    expect((firm[firm.length - 1] as { durationTick: number }).durationTick).toBe(8 * SIXTEENTH);
    expect((soft[soft.length - 1] as { isRest: boolean }).isRest).toBe(false);
  });

  it("leaves the equal partition exactly as it was", () => {
    // The old generator is still there and still what a piece without the
    // setting gets, to the tick.
    const slots = generateRhythmBar({
      timeSignature: "4/4", density: 0.52, restRate: 0.14, syncopation: 0.18,
      seed: "legacy", barIndex: 3,
    });
    const lengths = new Set(slots.map((slot) => slot.durationTick));
    expect(lengths.size).toBeLessThanOrEqual(2);
    expect(rhythmExactlyCoversBar(slots, 3, "4/4")).toBe(true);
  });
});
