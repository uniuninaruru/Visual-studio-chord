import { describe, expect, it } from "vitest";
import {
  MINIMAL_GENERATOR_SETTINGS,
  analyzeArrangementQuality,
  generateComposition,
} from "../src/music";

describe("all-track arrangement quality", () => {
  it("checks left hand, right hand, melody and every optional voice together", () => {
    for (const seed of ["mix-1", "mix-2", "mix-3", "mix-4"]) {
      const composition = generateComposition({
        ...MINIMAL_GENERATOR_SETTINGS,
        seed,
        voiceLeading: { enabled: true, profile: "pop" },
        arrangement: {
          counterpoint: { enabled: true, position: "below", independence: 0.7 },
          canon: { enabled: true, delayBeats: 2, interval: 7, inverted: false },
          polyrhythm: { enabled: true, pulses: 3, spanBars: 1 },
        },
      });
      const report = analyzeArrangementQuality(composition);
      expect(report.trackCount).toBe(6);
      expect(report.noteCount).toBeGreaterThan(composition.notes.length);
      expect(report.errors, `${seed}: ${JSON.stringify(report.issues)}`).toBe(0);
    }
  });

  it("reports muddy low spacing and notes outside an 88-key piano", () => {
    const composition = structuredClone(
      generateComposition({ ...MINIMAL_GENERATOR_SETTINGS, seed: "bad-mix" }),
    );
    composition.chords[0]!.notes = [40, 44, 47];
    composition.notes[0]!.midi = 109;
    const report = analyzeArrangementQuality(composition);
    expect(report.issues.map((issue) => issue.type)).toContain("lowRegisterCluster");
    expect(report.issues.map((issue) => issue.type)).toContain("outOfPianoRange");
  });
});
