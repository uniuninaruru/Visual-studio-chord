import { describe, expect, it } from "vitest";
import {
  MINIMAL_GENERATOR_SETTINGS,
  PITCH_CLASSES,
  cadenceDegrees,
  cadenceDominantPosition,
  generateComposition,
  generateMelody,
  generateProgression,
  generateRhythmBar,
  getCadentialDominantDefinition,
  getDiatonicChordDefinition,
  getScalePitchClasses,
  hasCadence,
  normalizePitchClass,
  pitchClassToSemitone,
  replaceChordSymbol,
  rhythmExactlyCoversBar,
  ticksPerBar,
  validateComposition,
} from "../src/music";
import type {
  BarCount,
  GeneratorSettings,
  Mode,
  TimeSignature,
} from "../src/types/music";

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...MINIMAL_GENERATOR_SETTINGS,
    ...patch,
    melody: {
      ...MINIMAL_GENERATOR_SETTINGS.melody,
      ...patch.melody,
    },
  };
}

describe("music theory primitives", () => {
  it("normalizes enharmonic spellings onto all 12 pitch classes", () => {
    expect(PITCH_CLASSES).toHaveLength(12);
    expect(new Set(PITCH_CLASSES)).toHaveLength(12);
    expect(normalizePitchClass("Db")).toBe("C#");
    expect(normalizePitchClass("B#")).toBe("C");
    expect(normalizePitchClass("Cb")).toBe("B");
    expect(normalizePitchClass("E#")).toBe("F");
    expect(normalizePitchClass("Fb")).toBe("E");
  });

  it("builds the expected Major and Natural Minor scales", () => {
    expect(getScalePitchClasses("C", "major")).toEqual([
      "C", "D", "E", "F", "G", "A", "B",
    ]);
    expect(getScalePitchClasses("A", "naturalMinor")).toEqual([
      "A", "B", "C", "D", "E", "F", "G",
    ]);
    expect(getScalePitchClasses("Db", "major")).toEqual(
      getScalePitchClasses("C#", "major"),
    );
  });

  it("uses exact integer tick math for every Phase 1 time signature", () => {
    expect(ticksPerBar("4/4")).toBe(1920);
    expect(ticksPerBar("3/4")).toBe(1440);
    expect(ticksPerBar("6/8")).toBe(1440);
  });

  it.each(["4/4", "3/4", "6/8"] satisfies TimeSignature[])(
    "partitions a %s bar exactly at low and high density",
    (timeSignature) => {
      for (const density of [0, 0.35, 0.7, 1]) {
        const slots = generateRhythmBar({
          timeSignature,
          density,
          restRate: 0.25,
          syncopation: 0.3,
          seed: "exact-rhythm",
          barIndex: 2,
        });
        expect(rhythmExactlyCoversBar(slots, 2, timeSignature)).toBe(true);
      }
    },
  );

  it("increases rhythmic subdivision count as density rises", () => {
    const slotCount = (density: number) =>
      generateRhythmBar({
        timeSignature: "4/4",
        density,
        restRate: 0,
        syncopation: 0,
        seed: "density",
        barIndex: 0,
      }).length;
    expect(slotCount(0)).toBeLessThan(slotCount(0.5));
    expect(slotCount(0.5)).toBeLessThan(slotCount(1));
  });

  it("creates diatonic triads with Roman numerals and harmony functions", () => {
    expect(getDiatonicChordDefinition("C", "major", 2)).toMatchObject({
      root: "D",
      quality: "minor",
      symbol: "Dm",
    });
    const progression = generateProgression({
      key: "A",
      mode: "naturalMinor",
      bars: 8,
      timeSignature: "4/4",
      style: "pop",
      seed: "minor-progression",
    });
    expect(progression.chords).toHaveLength(8);
    // Every chord is diatonic except an optional cadential dominant, which
    // borrows a raised leading tone (a major V) in a natural-minor key.
    const dominantIndex =
      cadenceDominantPosition(progression.cadence) === "penultimate"
        ? progression.chords.length - 2
        : cadenceDominantPosition(progression.cadence) === "final"
          ? progression.chords.length - 1
          : null;
    progression.chords.forEach((chord, index) => {
      if (index === dominantIndex) {
        expect(chord).toMatchObject({ degree: 5, quality: "major", romanNumeral: "V", source: "borrowed" });
      } else {
        expect(chord.source).toBe("diatonic");
      }
    });
    expect(
      hasCadence(
        progression.degrees,
        progression.cadence,
        "naturalMinor",
      ),
    ).toBe(true);
    expect(progression.degrees.slice(-2)).toEqual(
      cadenceDegrees(progression.cadence, "naturalMinor"),
    );
  });
});

describe("cadential dominant leading tone", () => {
  it("builds a major V on scale degree 5, raising the seventh where needed", () => {
    // A natural minor: E major (E–G#–B), a dorian: A major (A–C#–E),
    // C mixolydian: G major (G–B–D). Each supplies the missing leading tone.
    expect(getCadentialDominantDefinition("A", "naturalMinor")).toMatchObject({ root: "E", quality: "major", symbol: "E" });
    expect(getCadentialDominantDefinition("D", "dorian")).toMatchObject({ root: "A", quality: "major", symbol: "A" });
    expect(getCadentialDominantDefinition("C", "mixolydian")).toMatchObject({ root: "G", quality: "major", symbol: "G" });
  });

  it.each(["naturalMinor", "dorian", "mixolydian"] satisfies Mode[])(
    "gives %s dominant cadences a raised leading tone",
    (mode) => {
      const leadingTone = (pitchClassToSemitone("A") + 11) % 12; // a semitone below the A tonic
      let sawDominantCadence = false;
      for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]) {
        const progression = generateProgression({
          key: "A",
          mode,
          bars: 8,
          timeSignature: "4/4",
          style: "pop",
          seed,
        });
        const position = cadenceDominantPosition(progression.cadence);
        if (position === null) continue; // plagal / loop keep the modal iv/v
        sawDominantCadence = true;
        const dominant =
          position === "final" ? progression.chords.at(-1)! : progression.chords.at(-2)!;
        expect(dominant.degree).toBe(5);
        expect(dominant.quality).toBe("major");
        expect(dominant.romanNumeral).toBe("V");
        expect(dominant.source).toBe("borrowed");
        expect(dominant.notes.some((midi) => midi % 12 === leadingTone)).toBe(true);
      }
      expect(sawDominantCadence).toBe(true);
    },
  );

  it.each(["major", "harmonicMinor"] satisfies Mode[])(
    "keeps a diatonic major V in %s (no borrow needed)",
    (mode) => {
      for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
        const progression = generateProgression({
          key: "C",
          mode,
          bars: 8,
          timeSignature: "4/4",
          style: "pop",
          seed,
        });
        const position = cadenceDominantPosition(progression.cadence);
        if (position === null) continue;
        const dominant =
          position === "final" ? progression.chords.at(-1)! : progression.chords.at(-2)!;
        // The diatonic V is already major here, so it is never a borrowed cadential dominant.
        expect(dominant.source).not.toBe("borrowed");
      }
    },
  );

  it("rejects a minor v→i as an authentic cadence once chord quality is known", () => {
    // Same 5→1 degree shape, but a minor dominant has no leading tone.
    expect(hasCadence([5, 1], "authentic", "naturalMinor")).toBe(true);
    expect(
      hasCadence([5, 1], "authentic", "naturalMinor", [
        { degree: 5, quality: "minor" },
        { degree: 1, quality: "minor" },
      ]),
    ).toBe(false);
    expect(
      hasCadence([5, 1], "authentic", "naturalMinor", [
        { degree: 5, quality: "major" },
        { degree: 1, quality: "minor" },
      ]),
    ).toBe(true);
  });

  it.each(["naturalMinor", "dorian", "mixolydian"] satisfies Mode[])(
    "%s compositions stay valid with the raised leading tone",
    (mode) => {
      for (const seed of ["v1", "v2", "v3", "v4", "v5", "v6"]) {
        const composition = generateComposition(settings({ key: "A", mode, bars: 8, style: "pop", seed }));
        const validation = validateComposition(composition);
        // No errors: the borrowed cadential dominant is recognized as explained.
        expect(validation.errors).toEqual([]);
        // The cadence label now matches a genuine leading-tone dominant.
        expect(validation.warnings.map((issue) => issue.code)).not.toContain("cadence.metadata");
      }
    },
  );
});

describe("melodic phrase structure", () => {
  function melodyFor(phraseLengthBars: number | undefined, seed = "phrase-seed") {
    const base = settings({ key: "C", mode: "major", bars: 16, style: "pop", seed });
    const progression = generateProgression({
      key: base.key,
      mode: base.mode,
      bars: base.bars,
      timeSignature: base.timeSignature,
      style: base.style,
      seed: base.seed,
    });
    return generateMelody({
      settings: base,
      chords: progression.chords,
      resolvedStyle: progression.resolvedStyle,
      cadence: progression.cadence,
      phraseLengthBars,
    });
  }

  it("generates the same melody for identical phrase settings", () => {
    expect(melodyFor(4)).toEqual(melodyFor(4));
  });

  it("shapes the line around the configured phrase length", () => {
    // Different phrase lengths move the phrase-end landings, which cascade
    // through the running melodic state. If phraseLengthBars were ignored these
    // 16-bar lines would be byte-identical.
    expect(melodyFor(2)).not.toEqual(melodyFor(8));
  });
});

describe("deterministic composition generation", () => {
  it("returns byte-equivalent musical data for identical settings and seed", () => {
    const input = settings({ key: "Eb", seed: "repeat-me", style: "j-pop" });
    expect(generateComposition(input)).toEqual(generateComposition(input));
  });

  it("changes the generated result when the seed changes", () => {
    const first = generateComposition(settings({ seed: "seed-a" }));
    const second = generateComposition(settings({ seed: "seed-b" }));
    expect({ chords: second.chords, notes: second.notes }).not.toEqual({
      chords: first.chords,
      notes: first.notes,
    });
  });

  it.each([4, 8, 16] satisfies BarCount[])("creates an exact %i-bar grid", (bars) => {
    const composition = generateComposition(settings({ bars, seed: `bars-${bars}` }));
    expect(composition.bars).toHaveLength(bars);
    expect(composition.chords).toHaveLength(bars);
    expect(composition.totalTicks).toBe(composition.ticksPerBar * bars);
    expect(composition.bars.at(-1)).toEqual({
      index: bars - 1,
      startTick: (bars - 1) * composition.ticksPerBar,
      durationTick: composition.ticksPerBar,
    });
  });

  it.each(["4/4", "3/4", "6/8"] satisfies TimeSignature[])(
    "keeps every melody note in range and inside one %s bar",
    (timeSignature) => {
      const composition = generateComposition(
        settings({
          timeSignature,
          seed: `meter-${timeSignature}`,
          melody: {
            ...MINIMAL_GENERATOR_SETTINGS.melody,
            minMidi: 65,
            maxMidi: 77,
            density: 0.85,
          },
        }),
      );
      for (const note of composition.notes) {
        const barStart = note.barIndex * composition.ticksPerBar;
        expect(note.midi).toBeGreaterThanOrEqual(65);
        expect(note.midi).toBeLessThanOrEqual(77);
        expect(note.startTick).toBeGreaterThanOrEqual(barStart);
        expect(note.startTick + note.durationTick).toBeLessThanOrEqual(
          barStart + composition.ticksPerBar,
        );
      }
      expect(validateComposition(composition)).toMatchObject({ valid: true, errors: [] });
    },
  );

  it("supports a safe direct chord-symbol edit", () => {
    const composition = generateComposition(settings({ seed: "edit-chord" }));
    const edited = replaceChordSymbol(
      composition.chords[0]!,
      "Dm",
      composition.settings.key,
      composition.settings.mode,
    );
    expect(edited).toMatchObject({
      symbol: "Dm",
      root: "D",
      quality: "minor",
      romanNumeral: "ii",
      function: "predominant",
      source: "diatonic",
    });
    expect(edited.notes).toHaveLength(3);
  });

  it("reports malformed tick, MIDI, and duplicate-ID data", () => {
    const composition = structuredClone(
      generateComposition(settings({ seed: "invalid-data" })),
    );
    const first = composition.notes[0]!;
    first.midi = 200;
    first.durationTick = composition.ticksPerBar + 1;
    if (composition.notes[1]) composition.notes[1].id = first.id;
    const validation = validateComposition(composition);
    expect(validation.valid).toBe(false);
    expect(validation.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["note.midi", "note.barBoundary", "notes.duplicateId"]),
    );
  });
});
