import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS, MINIMAL_GENERATOR_SETTINGS, generateComposition, validateComposition } from "../src/music";
import { buildCompositionTracks } from "../src/music/compositionTracks";
import { analyzeMelodyQuality } from "../src/music/melodicQuality";
import { importCompositionJson, exportCompositionJson } from "../src/features/export/json";
import type { GeneratedComposition, GeneratorSettings, NoteEvent } from "../src/types/music";

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return { ...DEFAULT_GENERATOR_SETTINGS, seed: "phrase-regression", bars: 16, groove: { enabled: false, template: "straight", amount: 0 }, ...patch };
}

function rhythm(piece: GeneratedComposition, bar: number) {
  return piece.notes.filter((note) => note.barIndex === bar)
    .map((note) => note.startTick - bar * piece.ticksPerBar);
}

function digest(piece: GeneratedComposition) {
  return createHash("sha256").update(JSON.stringify({ chords: piece.chords, notes: piece.notes, resolvedStyle: piece.resolvedStyle })).digest("hex");
}

describe("phrase composition", () => {
  it("keeps saved projects without the new setting on their original seeded engine", () => {
    const legacy = structuredClone(DEFAULT_GENERATOR_SETTINGS);
    delete legacy.melody.phraseDesign;
    delete legacy.melody.hookStrength;
    // Captured from main before the phrase engine was added, not from this implementation.
    expect(digest(generateComposition({ ...MINIMAL_GENERATOR_SETTINGS, seed: "legacy-phrase-regression", bars: 8 })))
      .toBe("7c1afbccd2d989d6e242a853810c30821da63b6c34258a8e0b03c34d7b201b93");
    const explicitlyDisabled = structuredClone(legacy);
    explicitlyDisabled.melody.phraseDesign = false;
    expect(digest(generateComposition({ ...legacy, seed: "legacy-phrase-regression", bars: 8 })))
      .toBe(digest(generateComposition({ ...explicitlyDisabled, seed: "legacy-phrase-regression", bars: 8 })));
  });

  it("repeats a chorus's opening rhythm and retains it at the final return", () => {
    const piece = generateComposition(settings({ bars: 48 }));
    const returns = piece.sections!.filter((section) => section.kind === "chorus" || section.kind === "finalChorus");
    expect(returns.length).toBeGreaterThan(1);
    const first = returns[0]!;
    for (const section of returns.slice(1)) {
      expect(rhythm(piece, section.startBar)).toEqual(rhythm(piece, first.startBar));
      expect(rhythm(piece, section.startBar + 1)).toEqual(rhythm(piece, first.startBar + 1));
    }
    const openingRegister = (bar: number) => {
      const notes = piece.notes.filter((note) => note.barIndex >= bar && note.barIndex < bar + 2);
      return notes.reduce((sum, note) => sum + note.midi, 0) / notes.length;
    };
    const final = returns.find((section) => section.kind === "finalChorus")!;
    expect(openingRegister(final.startBar)).toBeGreaterThan(openingRegister(first.startBar));
  });

  it("retains a two-bar statement, then lands on a sustained note with breathing room", () => {
    const piece = generateComposition(settings({ bars: 8, songForm: { form: "none" }, phraseGrammar: { enabled: false } }));
    expect(rhythm(piece, 0)).toEqual(rhythm(piece, 2));
    const ending = piece.notes.filter((note) => note.barIndex === 3).at(-1)!;
    expect(ending.durationTick).toBeGreaterThanOrEqual(piece.ppq);
    expect(ending.startTick + ending.durationTick).toBeLessThan(4 * piece.ticksPerBar);
  });

  it("uses distinct harmonic and rhythmic material across styles with the same seed", () => {
    const pieces = (["j-pop", "lo-fi", "edm", "jazz"] as const).map((style) => generateComposition(settings({ style })));
    expect(new Set(pieces.map((piece) => piece.chords.map((chord) => chord.symbol).join("|"))).size).toBe(4);
    expect(new Set(pieces.map((piece) => JSON.stringify(rhythm(piece, 0)))).size).toBeGreaterThanOrEqual(3);
    const bassOnsets = pieces.map((piece) => {
      const verse = piece.sections!.find((section) => section.kind === "verse")!;
      return buildCompositionTracks(piece)[0]!.notes.filter((note) => note.barIndex === verse.startBar).map((note) => note.startTick);
    });
    expect(new Set(bassOnsets.map((onsets) => JSON.stringify(onsets))).size).toBeGreaterThanOrEqual(3);
  });

  it("is deterministic, valid and monophonic across meters, modes and narrow ranges", () => {
    for (const timeSignature of ["4/4", "3/4", "6/8"] as const) {
      for (const mode of ["major", "naturalMinor", "harmonicMinor", "dorian", "mixolydian"] as const) {
        const config = settings({ timeSignature, mode, bars: 8, melody: { ...DEFAULT_GENERATOR_SETTINGS.melody, minMidi: 64, maxMidi: 76 } });
        const piece = generateComposition(config);
        expect(validateComposition(piece).valid, `${timeSignature}/${mode}`).toBe(true);
        expect(piece.notes).toEqual(generateComposition(config).notes);
        for (const [index, note] of piece.notes.entries()) {
          expect(note.midi).toBeGreaterThanOrEqual(64);
          expect(note.midi).toBeLessThanOrEqual(76);
          expect(note.startTick % (piece.ppq / 4)).toBe(0);
          const next = piece.notes[index + 1];
          if (next) expect(note.startTick + note.durationTick).toBeLessThanOrEqual(next.startTick);
        }
      }
    }
  }, 20_000);

  it("preserves simultaneity and usable durations when grooving chord stacks", () => {
    const piece = generateComposition(settings({ groove: { enabled: true, template: "laidBack", amount: 0.8 }, arpeggio: { enabled: false }, chordRhythm: { enabled: false } }));
    const notes = buildCompositionTracks(piece).find((track) => track.role === "chords")!.notes;
    const groups = new Map<number, NoteEvent[]>();
    for (const note of notes) groups.set(note.startTick, [...(groups.get(note.startTick) ?? []), note]);
    expect([...groups.values()].some((group) => group.length > 1)).toBe(true);
    expect(notes.every((note) => note.durationTick > 1)).toBe(true);
  });

  it("round-trips the new engine settings and rejects malformed hook controls", () => {
    const piece = generateComposition(settings({ bars: 4 }));
    expect(importCompositionJson(exportCompositionJson(piece))).toEqual(piece);
    for (const hookStrength of [-0.1, 1.1, "0.5"]) {
      const document = JSON.parse(exportCompositionJson(piece));
      document.composition.settings.melody.hookStrength = hookStrength;
      expect(() => importCompositionJson(JSON.stringify(document))).toThrow();
    }
  });

  it("recognizes an omitted chord member without accepting an unrelated dissonance", () => {
    const piece = generateComposition(settings({ bars: 4 }));
    const chord = { ...piece.chords[0]!, root: "C" as const, quality: "major7" as const, notes: [48, 52, 59], startTick: 0, durationTick: piece.ticksPerBar, tensions: [] };
    const note = { ...piece.notes[0]!, midi: 67, startTick: 0, durationTick: 480 };
    expect(analyzeMelodyQuality([note], [chord], "4/4").unexplainedNonChordTones).toBe(0);
    expect(analyzeMelodyQuality([{ ...note, midi: 65 }], [chord], "4/4").unexplainedNonChordTones).toBe(1);
  });

  it("does not apply groove twice to an imitation of the performed melody", () => {
    const piece = generateComposition(settings({ bars: 4, groove: { enabled: true, template: "laidBack", amount: 1 } }));
    const note = { ...piece.notes[0]!, id: "copied-timing", startTick: 487, durationTick: 210 };
    piece.voices = [{ id: "imitated", name: "Canon", role: "canon", instrument: "pluck", color: "#abcdef", midiChannel: 3, notes: [note] }];
    expect(buildCompositionTracks(piece).find((track) => track.sourceVoiceId === "imitated")!.notes[0])
      .toMatchObject({ startTick: 487, durationTick: 210 });
  });
});
