import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import {
  extractHarmonyFeatures,
  extractMelodyFeatures,
  extractPreferenceFeatures,
  extractRhythmFeatures,
  extractVoicingFeatures,
} from "../src/preference";
import type { GeneratedComposition, GeneratorSettings, NoteEvent } from "../src/types/music";

function settings(seed: string, bars: 4 | 8 | 16 = 4): GeneratorSettings {
  return {
    ...DEFAULT_GENERATOR_SETTINGS,
    seed,
    bars,
    melody: { ...DEFAULT_GENERATOR_SETTINGS.melody },
    harmony: DEFAULT_GENERATOR_SETTINGS.harmony
      ? { ...DEFAULT_GENERATOR_SETTINGS.harmony }
      : undefined,
    motif: DEFAULT_GENERATOR_SETTINGS.motif
      ? { ...DEFAULT_GENERATOR_SETTINGS.motif }
      : undefined,
  };
}

function composition(seed = "preference-features"): GeneratedComposition {
  return generateComposition(settings(seed));
}

function expectBoundedVector(vector: Record<string, number>): void {
  expect(Object.keys(vector).length).toBeGreaterThan(0);
  for (const value of Object.values(vector)) {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(-1);
    expect(value).toBeLessThanOrEqual(1);
  }
}

describe("preference feature extraction", () => {
  it("is deterministic, finite, bounded, and prefixes combined features", () => {
    const generated = composition();
    const first = extractPreferenceFeatures(generated);
    const second = extractPreferenceFeatures(structuredClone(generated));
    expect(first).toEqual(second);
    for (const vector of [first.harmony, first.melody, first.rhythm, first.voicing, first.combined]) {
      expectBoundedVector(vector);
    }
    expect(first.combined["harmony.quality.tension"]).toBe(first.harmony["quality.tension"]);
    expect(first.combined["melody.chordToneRate"]).toBe(first.melody.chordToneRate);
    expect(first.combined["rhythm.onsetDensity"]).toBe(first.rhythm.onsetDensity);
    expect(first.combined["voicing.meanSpan"]).toBe(first.voicing.meanSpan);
  });

  it("extracts Roman n-grams, functions, cadence, qualities, sources, and root motion", () => {
    const generated = composition("harmony-features");
    const customized = structuredClone(generated);
    customized.chords[0]!.romanNumeral = "I";
    customized.chords[1]!.romanNumeral = "V/V";
    customized.chords[2]!.romanNumeral = "V";
    customized.chords[3]!.romanNumeral = "I";
    customized.chords[0]!.source = "diatonic";
    customized.chords[1]!.source = "secondaryDominant";
    customized.chords[1]!.specialKind = "secondaryDominant";
    customized.chords[2]!.source = "borrowed";
    customized.chords[2]!.specialKind = "borrowed";
    customized.chords[3]!.source = "diatonic";
    customized.chords[1]!.quality = "dominant7";
    const features = extractHarmonyFeatures(customized);

    expect(features["roman.1.I"]).toBe(0.5);
    expect(features["roman.2.I>V/V"]).toBeCloseTo(1 / 3);
    expect(features["roman.3.V/V>V>I"]).toBe(0.5);
    expect(features["cadence.authentic"] ?? features[`cadence.${customized.cadence}`]).toBeDefined();
    expect(features["source.secondaryDominant"]).toBe(0.25);
    expect(features["source.borrowed"]).toBe(0.25);
    expect(features["source.nonDiatonicRate"]).toBe(0.5);
    expect(features["source.specialRate"]).toBe(0.5);
    expect(features["special.secondaryDominant"]).toBe(0.25);
    expect(features["special.borrowed"]).toBe(0.25);
    expect(features["quality.seventhRate"]).toBeGreaterThanOrEqual(0.25);
    expect(features["rootMotion.mean"]).toBeGreaterThanOrEqual(0);
    expect(features["rootMotion.commonToneRate"]).toBeGreaterThanOrEqual(0);
    expect(
      ["function.tonic", "function.predominant", "function.dominant", "function.other"]
        .reduce((sum, key) => sum + (features[key] ?? 0), 0),
    ).toBeCloseTo(1);
  });

  it("measures chord tones, melodic leaps, repetitions, contour, and density", () => {
    const generated = composition("melody-features");
    const note = (id: string, midi: number, startTick: number, barIndex: number): NoteEvent => ({
      id,
      midi,
      noteName: `midi-${midi}`,
      startTick,
      durationTick: generated.ppq / 2,
      velocity: 90,
      barIndex,
      role: "scaleTone",
    });
    generated.notes = [
      note("a", 60, 0, 0),
      note("b", 62, generated.ppq, 0),
      note("c", 69, generated.ticksPerBar, 1),
      note("d", 69, generated.ticksPerBar + generated.ppq, 1),
    ];
    const features = extractMelodyFeatures(generated);
    expect(features.stepRate).toBeCloseTo(1 / 3);
    expect(features.leapRate).toBeCloseTo(1 / 3);
    expect(features.largeLeapRate).toBe(0);
    expect(features.repeatedNoteRate).toBeCloseTo(1 / 3);
    expect(features.meanInterval).toBeCloseTo(3 / 12);
    expect(features.density).toBeCloseTo(4 / 4 / 8);
    expect(features.chordToneRate).toBeGreaterThanOrEqual(0);
    expect(features.chordToneRate).toBeLessThanOrEqual(1);
  });

  it("measures rhythmic occupancy and voicing motion without depending on event order", () => {
    const generated = composition("rhythm-voicing");
    const rhythm = extractRhythmFeatures(generated);
    const voicing = extractVoicingFeatures(generated);
    expect(rhythm.occupancy).toBeGreaterThan(0);
    expect(rhythm.restRate).toBeCloseTo(1 - (rhythm.occupancy ?? 0));
    expect(rhythm.onsetDensity).toBeGreaterThan(0);
    expect(voicing.meanChordSize).toBeGreaterThan(0);
    expect(voicing.meanSpan).toBeGreaterThan(0);
    expect(voicing.voiceLeadingMotion).toBeGreaterThanOrEqual(0);

    const reversed = structuredClone(generated);
    reversed.chords.reverse();
    reversed.notes.reverse();
    expect(extractRhythmFeatures(reversed)).toEqual(rhythm);
    expect(extractVoicingFeatures(reversed)).toEqual(voicing);
  });
});
