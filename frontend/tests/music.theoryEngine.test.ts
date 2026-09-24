import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  buildCompositionTracks,
  generateComposition,
  regenerateRange,
  validateComposition,
  validateRegenerationPreservation,
} from "../src/music";
import { exportCompositionJson, importCompositionJson } from "../src/features/export/json";
import { exportCompositionMidi } from "../src/features/export/midi";
import { diagnoseTheoryComposition, generateTheoryComposition } from "../src/music/theoryEngine";
import type { ChordEvent, GeneratorSettings, JazzSettings } from "../src/types/music";

function settings(overrides: Partial<GeneratorSettings> = {}, jazzOverrides: Partial<JazzSettings> = {}): GeneratorSettings {
  return {
    ...DEFAULT_GENERATOR_SETTINGS,
    key: "C",
    mode: "major",
    bars: 8,
    style: "jazz",
    seed: "theory-engine-integration",
    jazz: {
      version: 2,
      style: "swing",
      form: "aaba",
      chromaticism: 0.35,
      interaction: 0.6,
      ...jazzOverrides,
    },
    ...overrides,
  };
}

function pcs(chord: ChordEvent): Set<number> {
  const root = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"].indexOf(chord.root);
  const intervals: Record<ChordEvent["quality"], number[]> = {
    major: [0, 4, 7], minor: [0, 3, 7], diminished: [0, 3, 6], augmented: [0, 4, 8],
    dominant7: [0, 4, 7, 10], major7: [0, 4, 7, 11], minor7: [0, 3, 7, 10],
    halfDiminished7: [0, 3, 6, 10], diminished7: [0, 3, 6, 9], minorMajor7: [0, 3, 7, 11],
    augmentedMajor7: [0, 4, 8, 11], sus2: [0, 2, 7], sus4: [0, 5, 7], add9: [0, 2, 4, 7], minorAdd9: [0, 2, 3, 7],
  };
  const tensions: Record<NonNullable<ChordEvent["tensions"]>[number], number> = {
    "6": 9, "9": 2, b9: 1, "#9": 3, "11": 5, "#11": 6, "13": 9, b13: 8,
  };
  return new Set([
    ...intervals[chord.quality].map((interval) => (root + interval) % 12),
    ...(chord.tensions ?? []).map((tension) => (root + tensions[tension]) % 12),
  ]);
}

describe("integrated theory-led jazz engine v2", () => {
  it("is deterministic and produces a structurally valid project", () => {
    const first = generateComposition(settings());
    expect(generateComposition(settings())).toEqual(first);
    expect(validateComposition(first).valid).toBe(true);
    expect(first.ppq).toBe(480);
    expect(first.notes.length).toBeGreaterThan(0);
    expect(first.notes.every((note) => Number.isInteger(note.startTick) && Number.isInteger(note.durationTick))).toBe(true);
  });

  it("adds a joint counterline only when requested, with no legacy duplicate", () => {
    const plain = generateComposition(settings());
    const paired = generateComposition(settings({
      arrangement: { counterpoint: { enabled: true, position: "below", independence: 0.7 } },
    }));
    expect(plain.voices?.filter((voice) => voice.role === "countermelody") ?? []).toHaveLength(0);
    expect(paired.voices?.filter((voice) => voice.role === "countermelody")).toHaveLength(1);
    expect(paired.voices?.some((voice) => voice.id === "voice-countermelody")).toBe(true);
    expect(validateComposition(paired).valid).toBe(true);
  });

  it("plays, serializes, and exports bass/chords/lead plus exactly one counterline", () => {
    const paired = generateComposition(settings({
      arrangement: { counterpoint: { enabled: true, position: "below" } },
    }));
    const rendered = buildCompositionTracks(paired);
    expect(rendered.map((track) => track.role)).toEqual(["bass", "chords", "melody", "countermelody"]);
    expect(rendered.filter((track) => track.role === "countermelody")).toHaveLength(1);
    for (const track of rendered) {
      expect(track.notes.length, track.role).toBeGreaterThan(0);
      for (const note of track.notes) {
        expect(Number.isInteger(note.startTick)).toBe(true);
        expect(Number.isInteger(note.durationTick)).toBe(true);
        expect(note.durationTick).toBeGreaterThan(0);
        expect(note.startTick + note.durationTick).toBeLessThanOrEqual(paired.totalTicks);
        expect(note.midi).toBeGreaterThanOrEqual(21);
        expect(note.midi).toBeLessThanOrEqual(108);
      }
    }

    const midi = new Midi(exportCompositionMidi(paired));
    expect(midi.tracks.map((track) => track.name)).toEqual(rendered.map((track) => track.name));
    expect(midi.tracks.filter((track) => track.name === "Countermelody")).toHaveLength(1);
    expect(midi.tracks.every((track) => track.notes.length > 0)).toBe(true);
    expect(importCompositionJson(exportCompositionJson(paired))).toEqual(paired);
  });

  it("uses a 12-bar blues, minor ii-V-i material, and the 6/8 integer grid", () => {
    const blues = generateComposition(settings({ bars: 12 }, { form: "blues" }));
    expect(blues.chords.map((chord) => chord.degree)).toEqual([1, 1, 1, 1, 4, 4, 1, 1, 5, 4, 1, 5]);
    expect(blues.cadence).toBe("loop");

    const minor = generateComposition(settings({ mode: "naturalMinor", bars: 16 }, { style: "bebop", form: "aaba" }));
    const minorCadence = minor.chords.some((chord, index) =>
      chord.degree === 2 && chord.quality === "halfDiminished7"
      && minor.chords[index + 1]?.degree === 5 && minor.chords[index + 1]?.quality === "dominant7"
      && minor.chords[index + 2]?.degree === 1 && minor.chords[index + 2]?.quality === "minor7",
    );
    expect(minorCadence).toBe(true);

    const compound = generateComposition(settings({ timeSignature: "6/8", bars: 8 }, { form: "modal" }));
    expect(compound.ticksPerBar).toBe(1440);
    expect(compound.totalTicks).toBe(1440 * 8);
    expect(validateComposition(compound).valid).toBe(true);
  });

  it("preserves the selected range and locked bars and composes against retained edited harmony", () => {
    const source = generateComposition(settings({
      arrangement: { counterpoint: { enabled: true, position: "below" } },
    }));
    const barTicks = source.ticksPerBar;
    const locked = { ...source, lockedBars: [1] };
    const regenerated = regenerateRange(locked, locked.settings, { startBar: 0, endBar: 2 }, {
      target: "all",
      seedOffset: 7,
    });
    expect(validateRegenerationPreservation(locked, regenerated, { startBar: 0, endBar: 2 }).valid).toBe(true);
    expect(regenerated.chords.find((chord) => chord.startTick === barTicks)).toBe(source.chords.find((chord) => chord.startTick === barTicks));
    expect(regenerated.notes.filter((note) => note.barIndex === 1)).toEqual(source.notes.filter((note) => note.barIndex === 1));
    expect(regenerated.notes.filter((note) => note.barIndex >= 2)).toEqual(source.notes.filter((note) => note.barIndex >= 2));
    const sourceCounter = source.voices?.find((voice) => voice.role === "countermelody");
    const regeneratedCounter = regenerated.voices?.find((voice) => voice.role === "countermelody");
    expect(regeneratedCounter?.notes.filter((note) => note.barIndex === 1 || note.barIndex >= 2))
      .toEqual(sourceCounter?.notes.filter((note) => note.barIndex === 1 || note.barIndex >= 2));

    const originalChord = source.chords[0] as ChordEvent;
    const editedChord: ChordEvent = {
      ...originalChord,
      root: "F#",
      symbol: "F#maj7",
      quality: "major7",
      notes: [54, 58, 61, 65],
      tensions: [],
    };
    const edited = { ...source, chords: [editedChord, ...source.chords.slice(1)] };
    const leadRegenerated = regenerateRange(edited, edited.settings, { startBar: 0, endBar: 1 }, {
      target: "melody",
      seedOffset: 11,
    });
    expect(leadRegenerated.chords[0]).toBe(editedChord);
    const downbeat = leadRegenerated.notes.find((note) => note.startTick === 0);
    expect(downbeat).toBeDefined();
    expect(pcs(editedChord).has((downbeat?.midi ?? -1) % 12)).toBe(true);
  });

  it("does not populate locked or out-of-range bars when counterpoint is first enabled during range regeneration", () => {
    const source = generateComposition(settings());
    const withCounterpoint: GeneratorSettings = {
      ...source.settings,
      arrangement: { counterpoint: { enabled: true, position: "below" } },
    };
    const regenerated = regenerateRange(
      { ...source, lockedBars: [3] },
      withCounterpoint,
      { startBar: 2, endBar: 5 },
      { target: "all", seedOffset: 29 },
    );
    const counter = regenerated.voices?.find((voice) => voice.role === "countermelody");
    expect(counter).toBeDefined();
    expect(counter?.notes.length).toBeGreaterThan(0);
    expect(counter?.notes.every((note) => note.barIndex === 2 || note.barIndex === 4)).toBe(true);
  });

  it("disables counterpoint only in selected unlocked bars and drops an empty track", () => {
    const source = generateComposition(settings({
      arrangement: { counterpoint: { enabled: true, position: "below" } },
    }));
    const sourceCounter = source.voices?.find((voice) => voice.role === "countermelody");
    expect(sourceCounter?.notes.length).toBeGreaterThan(0);
    const locked = { ...source, lockedBars: [3] };
    const withoutCounterpoint: GeneratorSettings = {
      ...source.settings,
      arrangement: { counterpoint: { enabled: false, position: "below" } },
    };
    const chordsOnly = regenerateRange(locked, withoutCounterpoint, { startBar: 2, endBar: 5 }, {
      target: "chords",
      seedOffset: 39,
    });
    expect(chordsOnly.voices?.find((voice) => voice.role === "countermelody")?.notes)
      .toEqual(sourceCounter?.notes);

    const partial = regenerateRange(locked, withoutCounterpoint, { startBar: 2, endBar: 5 }, {
      target: "all",
      seedOffset: 41,
    });
    const partialCounter = partial.voices?.find((voice) => voice.role === "countermelody");
    expect(partialCounter?.notes).toEqual(sourceCounter?.notes.filter((note) =>
      note.barIndex < 2 || note.barIndex === 3 || note.barIndex >= 5,
    ));
    expect(partialCounter?.notes.length).toBeGreaterThan(0);

    const allDisabled = regenerateRange(source, withoutCounterpoint, { startBar: 0, endBar: source.settings.bars }, {
      target: "all",
      seedOffset: 43,
      respectLocks: false,
    });
    expect((allDisabled.voices ?? []).some((voice) => voice.role === "countermelody")).toBe(false);
  });

  it("exposes jazz-profile diagnostics for a held dissonance across an edited chord change", () => {
    const composition = generateComposition(settings());
    const first = composition.chords[0] as ChordEvent;
    const second = composition.chords[1] as ChordEvent;
    const dissonantPitch = first.notes.find((pitch) => !pcs(second).has(pitch % 12));
    expect(dissonantPitch).toBeDefined();
    const changed = {
      ...composition,
      notes: composition.notes.map((note, index) => index === 0
        ? { ...note, midi: dissonantPitch as number, startTick: 0, durationTick: composition.ticksPerBar + 120 }
        : note),
    };
    const diagnostics = diagnoseTheoryComposition(changed);
    expect(diagnostics.some((diagnostic) => diagnostic.ruleId === "CP-4" && diagnostic.tick === composition.ticksPerBar)).toBe(true);
    expect(diagnostics.every((diagnostic) => diagnostic.severity !== "error")).toBe(true);
    // The evaluator's current two-part contract audits bass/lead and
    // counterline/lead; the polyphonic chord voicing remains an explicit gap.
    expect(diagnostics.every((diagnostic) => !diagnostic.voiceIds.includes("chords"))).toBe(true);

    const bass = buildCompositionTracks(composition).find((track) => track.role === "bass");
    expect(bass).toBeDefined();
    const crossing = {
      ...composition,
      notes: composition.notes.map((note, index) => index === 0
        ? { ...note, startTick: 0, midi: 21 }
        : note),
    };
    expect(diagnoseTheoryComposition(crossing).some((diagnostic) =>
      diagnostic.ruleId === "VL-INDEPENDENCE"
      && diagnostic.tick === 0
      && diagnostic.voiceIds.includes(bass?.id ?? ""),
    )).toBe(true);
  });

  it("fails explicitly when a requested melody range has no playable 88-key pitch", () => {
    const unsupportedNarrowRange = settings({
      melody: { ...DEFAULT_GENERATOR_SETTINGS.melody, minMidi: 112, maxMidi: 112 },
    }, { chromaticism: 0 });
    expect(() => generateTheoryComposition(unsupportedNarrowRange, unsupportedNarrowRange.jazz as JazzSettings))
      .toThrow(/does not intersect the supported 88-key piano range/i);
  });
});
