import { describe, expect, it } from "vitest";
import {
  MINIMAL_GENERATOR_SETTINGS,
  analyzeMelodyQuality,
  generateComposition,
} from "../src/music";
import type { Mode, PitchClassName } from "../src/types/music";

const KEYS: PitchClassName[] = ["C", "F#", "Bb"];
const MODES: Mode[] = [
  "major",
  "naturalMinor",
  "harmonicMinor",
  "dorian",
  "mixolydian",
];

describe("melodic harmonic quality", () => {
  it("uses only prepared weak-beat dissonance across keys, modes and seeds", () => {
    let checked = 0;
    let unrecoveredLeaps = 0;
    for (const key of KEYS) {
      for (const mode of MODES) {
        for (const seed of ["quality-1", "quality-2", "quality-3"]) {
          const composition = generateComposition({
            ...MINIMAL_GENERATOR_SETTINGS,
            key,
            mode,
            seed: `${key}-${mode}-${seed}`,
          });
          const report = analyzeMelodyQuality(
            composition.notes,
            composition.chords,
            composition.timeSignature,
            composition.ppq,
          );
          checked += report.noteCount;
          expect(
            report.strongBeatNonChordTones,
            `${key}/${mode}/${seed}`,
          ).toBe(0);
          expect(
            report.unexplainedNonChordTones,
            `${key}/${mode}/${seed}`,
          ).toBe(0);
          const largeLeaps = composition.notes.slice(1).flatMap((note, index) => {
            const previous = composition.notes[index]!;
            const interval = note.midi - previous.midi;
            const chord = composition.chords.find(
              (candidate) =>
                note.startTick >= candidate.startTick
                && note.startTick < candidate.startTick + candidate.durationTick,
            );
            return Math.abs(interval) > 12
              ? [{
                  tick: note.startTick,
                  from: previous.midi,
                  to: note.midi,
                  interval,
                  role: note.role,
                  chord: chord?.symbol,
                  chordNotes: chord?.notes,
                }]
              : [];
          });
          expect(
            report.leapsLargerThanOctave,
            `${key}/${mode}/${seed}: ${JSON.stringify(largeLeaps)}`,
          ).toBe(0);
          unrecoveredLeaps += report.unrecoveredLeaps;
        }
      }
    }
    expect(checked).toBeGreaterThan(2_000);
    expect(unrecoveredLeaps / checked).toBeLessThan(0.015);
  });

  it("actually uses the expanded register instead of clustering in one octave", () => {
    const ranges = Array.from({ length: 20 }, (_, index) => {
      const composition = generateComposition({
        ...MINIMAL_GENERATOR_SETTINGS,
        seed: `register-${index}`,
      });
      return analyzeMelodyQuality(
        composition.notes,
        composition.chords,
        composition.timeSignature,
        composition.ppq,
      ).rangeSemitones;
    });
    const average = ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
    expect(average).toBeGreaterThanOrEqual(12);
    expect(ranges.filter((range) => range >= 10).length).toBeGreaterThanOrEqual(16);
  });
});
