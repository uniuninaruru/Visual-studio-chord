import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  PITCH_CLASSES,
  cadenceDegrees,
  generateComposition,
  generateProgression,
  generateRhythmBar,
  getDiatonicChordDefinition,
  getScalePitchClasses,
  hasCadence,
  normalizePitchClass,
  replaceChordSymbol,
  rhythmExactlyCoversBar,
  ticksPerBar,
  validateComposition,
} from "../src/music";
import type {
  BarCount,
  GeneratorSettings,
  TimeSignature,
} from "../src/types/music";

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...DEFAULT_GENERATOR_SETTINGS,
    ...patch,
    melody: {
      ...DEFAULT_GENERATOR_SETTINGS.melody,
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
    expect(progression.chords.every((chord) => chord.source === "diatonic")).toBe(true);
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
            ...DEFAULT_GENERATOR_SETTINGS.melody,
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
