import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  cadenceDominantPosition,
  createAdvancedChordEvent,
  diatonicSeventhQualityForDegree,
  explainSpecialChord,
  extractMotif,
  generateComposition,
  generateProgression,
  getScalePitchClasses,
  regenerateRange,
  setBarLocked,
  transformMotif,
  validateGeneratorSettings,
  validateComposition,
  validateRegenerationPreservation,
  voiceChord,
} from "../src/music";
import type {
  GeneratedComposition,
  GeneratorSettings,
  HarmonySettings,
  Mode,
} from "../src/types/music";

function phase2Settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...DEFAULT_GENERATOR_SETTINGS,
    bars: 8,
    style: "jazz",
    seed: "phase-2-theory",
    harmony: { complexity: "advanced" },
    motif: { enabled: true, lengthBars: 1, transformationRate: 1 },
    ...patch,
    melody: {
      ...DEFAULT_GENERATOR_SETTINGS.melody,
      restRate: 0.03,
      ...patch.melody,
    },
  };
}

function barData(composition: GeneratedComposition, barIndex: number): unknown {
  return {
    chords: composition.chords.filter(
      (chord) => Math.floor(chord.startTick / composition.ticksPerBar) === barIndex,
    ),
    notes: composition.notes.filter((note) => note.barIndex === barIndex),
  };
}

describe("Phase 2 scales and seventh chords", () => {
  it("supports Harmonic Minor, Dorian, and Mixolydian", () => {
    expect(getScalePitchClasses("A", "harmonicMinor")).toEqual([
      "A", "B", "C", "D", "E", "F", "G#",
    ]);
    expect(getScalePitchClasses("D", "dorian")).toEqual([
      "D", "E", "F", "G", "A", "B", "C",
    ]);
    expect(getScalePitchClasses("G", "mixolydian")).toEqual([
      "G", "A", "B", "C", "D", "E", "F",
    ]);
  });

  it("derives the correct diatonic seventh quality in every mode", () => {
    const expected: Readonly<Record<Mode, readonly string[]>> = {
      major: ["major7", "minor7", "minor7", "major7", "dominant7", "minor7", "halfDiminished7"],
      naturalMinor: ["minor7", "halfDiminished7", "major7", "minor7", "minor7", "major7", "dominant7"],
      harmonicMinor: ["minorMajor7", "halfDiminished7", "augmentedMajor7", "minor7", "dominant7", "major7", "diminished7"],
      dorian: ["minor7", "minor7", "major7", "dominant7", "minor7", "halfDiminished7", "major7"],
      mixolydian: ["dominant7", "minor7", "halfDiminished7", "major7", "minor7", "minor7", "major7"],
    };
    for (const [mode, qualities] of Object.entries(expected) as Array<[Mode, readonly string[]]>) {
      expect(
        Array.from({ length: 7 }, (_, index) =>
          diatonicSeventhQualityForDegree(index + 1, mode),
        ),
      ).toEqual(qualities);
    }
  });

  it("generates deterministic diatonic sevenths", () => {
    const settings = phase2Settings({
      mode: "dorian",
      harmony: { complexity: "sevenths" },
      motif: { enabled: false, lengthBars: 1, transformationRate: 0 },
    });
    const first = generateComposition(settings);
    const second = generateComposition(settings);
    expect(second).toEqual(first);
    expect(first.chords.some((chord) => chord.notes.length === 4)).toBe(true);
    // Every chord is a diatonic seventh/triad except an optional cadential
    // dominant, which raises the leading tone to a major V in dorian.
    const dominantIndex =
      cadenceDominantPosition(first.cadence) === "penultimate"
        ? first.chords.length - 2
        : cadenceDominantPosition(first.cadence) === "final"
          ? first.chords.length - 1
          : null;
    first.chords.forEach((chord, index) => {
      if (index === dominantIndex) {
        expect(chord).toMatchObject({ degree: 5, quality: "major", romanNumeral: "V", source: "borrowed" });
      } else {
        expect(chord.source).toBe("diatonic");
      }
    });
    expect(validateComposition(first)).toMatchObject({ valid: true, errors: [] });
  });
});

describe("Phase 2 style harmony and explanations", () => {
  it("preserves legacy fixed-seed output when the new controls use their defaults", () => {
    const legacy = generateComposition(phase2Settings({
      harmony: { complexity: "advanced" },
    }));
    const explicitDefaults = generateComposition(phase2Settings({
      harmony: {
        complexity: "advanced",
        borrowedChordRate: 1,
        secondaryDominantRate: 1,
        explorationRate: 1,
        voiceLeadingStrength: 1,
      },
    }));

    expect(explicitDefaults.id).toBe(legacy.id);
    expect(explicitDefaults.chords).toEqual(legacy.chords);
    expect(explicitDefaults.notes).toEqual(legacy.notes);
    expect(explicitDefaults.cadence).toBe(legacy.cadence);
  });

  it.each([
    ["borrowedChordRate", "borrowed"],
    ["secondaryDominantRate", "secondaryDominant"],
  ] as const)("disables %s candidates at zero, including the advanced guarantee", (field, kind) => {
    let enabledOccurrences = 0;
    for (let seed = 0; seed < 48; seed += 1) {
      const harmony: HarmonySettings = { complexity: "advanced", [field]: 0 };
      const common = {
        key: "C",
        mode: "major",
        bars: 8,
        timeSignature: "4/4",
        style: "jazz",
        seed: `disabled-${field}-${seed}`,
      } as const;
      const progression = generateProgression({
        ...common,
        harmony,
      });
      expect(progression.chords.some((chord) => chord.specialKind === kind)).toBe(false);
      const enabled = generateProgression({
        ...common,
        harmony: { complexity: "advanced", [field]: 1 },
      });
      enabledOccurrences += enabled.chords.filter((chord) => chord.specialKind === kind).length;
    }
    expect(enabledOccurrences).toBeGreaterThan(0);
  });

  it("turns off all chromatic/color candidates when exploration is zero", () => {
    let enabledSpecials = 0;
    for (let seed = 0; seed < 48; seed += 1) {
      const common = {
        key: "C",
        mode: "major",
        bars: 8,
        timeSignature: "4/4",
        style: "jazz",
        seed: `no-exploration-${seed}`,
      } as const;
      const progression = generateProgression({
        ...common,
        harmony: { complexity: "advanced", explorationRate: 0 },
      });
      expect(progression.chords.every((chord) => chord.source === "diatonic")).toBe(true);
      expect(progression.chords.every((chord) => chord.specialKind === undefined)).toBe(true);
      enabledSpecials += generateProgression({
        ...common,
        harmony: { complexity: "advanced", explorationRate: 1 },
      }).chords.filter((chord) => chord.specialKind !== undefined).length;
    }
    expect(enabledSpecials).toBeGreaterThan(0);
  });

  it("returns to native harmony after at most two chromatic color chords", () => {
    for (let seed = 0; seed < 64; seed += 1) {
      const progression = generateProgression({
        key: "C",
        mode: "major",
        bars: 16,
        timeSignature: "4/4",
        style: "jazz",
        seed: `chromatic-run-${seed}`,
        harmony: {
          complexity: "advanced",
          borrowedChordRate: 1,
          secondaryDominantRate: 1,
          explorationRate: 1,
        },
      });
      let run = 0;
      let maximum = 0;
      for (const chord of progression.chords) {
        const chromatic =
          chord.specialKind === "borrowed"
          || chord.specialKind === "secondaryDominant"
          || chord.specialKind === "tritoneSubstitution";
        run = chromatic ? run + 1 : 0;
        maximum = Math.max(maximum, run);
      }
      expect(maximum, `seed ${seed}`).toBeLessThanOrEqual(2);
    }
  });

  it("applies voice-leading strength without changing the default voicing", () => {
    const previous = [72, 76, 79];
    const defaultVoicing = voiceChord("F#", "major", previous);
    const connectedVoicing = voiceChord("F#", "major", previous, undefined, 1);
    const neutralVoicing = voiceChord("F#", "major", previous, undefined, 0);
    const movement = (notes: readonly number[]) => notes.reduce(
      (total, note, index) => total + Math.abs(note - (previous[index] as number)),
      0,
    );

    expect(defaultVoicing).toEqual(connectedVoicing);
    expect(neutralVoicing.notes).not.toEqual(connectedVoicing.notes);
    expect(movement(connectedVoicing.notes)).toBeLessThan(movement(neutralVoicing.notes));
  });

  it("validates every optional harmony control and fingerprints non-default values", () => {
    for (const field of [
      "borrowedChordRate",
      "secondaryDominantRate",
      "explorationRate",
      "voiceLeadingStrength",
    ] as const) {
      const invalidSettings = phase2Settings({
        harmony: { complexity: "advanced", [field]: 1.01 },
      });
      expect(validateGeneratorSettings(invalidSettings).errors.map((issue) => issue.code)).toContain(
        `settings.harmony.${field}`,
      );
    }

    const base = generateComposition(phase2Settings({
      harmony: { complexity: "advanced" },
    }));
    const adjusted = generateComposition(phase2Settings({
      harmony: { complexity: "advanced", voiceLeadingStrength: 0.5 },
    }));
    expect(adjusted.id).not.toBe(base.id);
  });

  it("generates a deterministic style-aware special chord with a valid explanation", () => {
    const settings = phase2Settings({ mode: "harmonicMinor" });
    const first = generateComposition(settings);
    const second = generateComposition(settings);
    expect(second).toEqual(first);
    const special = first.chords.find((chord) => chord.source !== "diatonic");
    expect(special).toBeDefined();
    expect(special?.explanation).toBeTruthy();
    const validation = validateComposition(first);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.warnings.some((issue) => issue.code.startsWith("chord.special."))).toBe(true);
  });

  it("constructs and verifies secondary dominants and tritone substitutes", () => {
    const common = {
      key: "C" as const,
      mode: "major" as const,
      degree: 6,
      targetDegree: 2,
      startTick: 0,
      durationTick: 1920,
      previousNotes: undefined,
    };
    const secondary = createAdvancedChordEvent({
      ...common,
      kind: "secondaryDominant",
      id: "secondary",
    });
    const substitute = createAdvancedChordEvent({
      ...common,
      kind: "tritoneSubstitution",
      id: "substitute",
    });
    expect(secondary).toMatchObject({ symbol: "A7", romanNumeral: "V7/ii" });
    expect(substitute).toMatchObject({ symbol: "D#7", romanNumeral: "subV7/ii" });
    expect(explainSpecialChord(secondary, "C", "major").allowed).toBe(true);
    expect(explainSpecialChord(substitute, "C", "major").allowed).toBe(true);
  });

  it("rejects special-chord metadata without a generated explanation", () => {
    const composition = structuredClone(generateComposition(phase2Settings()));
    const special = composition.chords.find((chord) => chord.source !== "diatonic")!;
    special.explanation = undefined;
    const validation = validateComposition(composition);
    expect(validation.valid).toBe(false);
    expect(validation.errors.map((issue) => issue.code)).toContain(
      "chord.special.missingExplanation",
    );
  });
});

describe("Phase 2 motif development", () => {
  it("extracts and transforms a motif without mutating its source", () => {
    const composition = generateComposition(phase2Settings({
      motif: { enabled: false, lengthBars: 1, transformationRate: 0 },
    }));
    const motif = extractMotif(
      composition.notes,
      { startBar: 0, endBar: 1 },
      composition.ticksPerBar,
    );
    const inverted = transformMotif(motif, "inversion");
    expect(inverted).not.toBe(motif);
    expect(inverted.notes).not.toBe(motif.notes);
    expect(inverted.notes[0]?.midi).toBe(motif.notes[0]?.midi);
    if (motif.notes[1] && inverted.notes[1]) {
      expect(inverted.notes[1].midi - motif.anchorMidi).toBe(
        -(motif.notes[1].midi - motif.anchorMidi),
      );
    }
  });

  it("develops a deterministic motif while keeping all notes valid", () => {
    const settings = phase2Settings({ mode: "mixolydian" });
    const composition = generateComposition(settings);
    expect(composition.notes.some((note) => note.id.includes("-motif-"))).toBe(true);
    expect(generateComposition(settings)).toEqual(composition);
    expect(validateComposition(composition)).toMatchObject({ valid: true, errors: [] });
  });
});

describe("Phase 2 regeneration strength", () => {
  it("keeps locks/range boundaries and makes strong regeneration broader than subtle", () => {
    const generated = generateComposition(phase2Settings());
    const before = setBarLocked(generated, 3, true);
    const range = { startBar: 1, endBar: 6 };
    const subtleOptions = { target: "all" as const, seedOffset: 12, strength: "subtle" as const };
    const strongOptions = { target: "all" as const, seedOffset: 12, strength: "strong" as const };
    const subtle = regenerateRange(before, before.settings, range, subtleOptions);
    const strong = regenerateRange(before, before.settings, range, strongOptions);

    expect(regenerateRange(before, before.settings, range, subtleOptions)).toEqual(subtle);
    for (const barIndex of [0, 3, 6, 7]) {
      expect(barData(subtle, barIndex)).toEqual(barData(before, barIndex));
      expect(barData(strong, barIndex)).toEqual(barData(before, barIndex));
    }
    const changedBars = (composition: GeneratedComposition) =>
      [1, 2, 4, 5].filter(
        (barIndex) =>
          JSON.stringify(barData(composition, barIndex)) !==
          JSON.stringify(barData(before, barIndex)),
      ).length;
    expect(changedBars(subtle)).toBeGreaterThan(0);
    expect(changedBars(strong)).toBeGreaterThanOrEqual(changedBars(subtle));
    expect(validateRegenerationPreservation(before, subtle, range).valid).toBe(true);
    expect(validateRegenerationPreservation(before, strong, range).valid).toBe(true);
    expect(validateComposition(subtle).valid).toBe(true);
    expect(validateComposition(strong).valid).toBe(true);
  });
});
