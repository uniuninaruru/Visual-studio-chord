import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import { exportCompositionMidi } from "../src/features/export/midi";
import {
  DEFAULT_GENERATOR_SETTINGS,
  buildCompositionTracks,
  generateComposition,
} from "../src/music";
import type { ChordEvent, GeneratedComposition, GeneratorSettings } from "../src/types/music";

const JAZZ: NonNullable<GeneratorSettings["jazz"]> = {
  version: 1,
  style: "swing",
  form: "free",
  chromaticism: 0.2,
  interaction: 0.15,
};

function jazzSettings(overrides: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...DEFAULT_GENERATOR_SETTINGS,
    style: "jazz",
    bars: 4,
    seed: "rendering-test",
    jazz: { ...JAZZ },
    ...overrides,
  };
}

function compositionWithChords(
  composition: GeneratedComposition,
  chords: ChordEvent[],
): GeneratedComposition {
  return { ...composition, chords };
}

function notesAtStart(composition: GeneratedComposition, startTick: number) {
  return buildCompositionTracks(composition).flatMap((track) =>
    track.notes.filter((note) => note.startTick === startTick).map((note) => ({ track, note })),
  );
}

describe("jazz arrangement rendering", () => {
  it("uses split/mid-bar chords for each attack and resolves the exact next root", () => {
    const source = generateComposition(jazzSettings({ bars: 4, seed: "split-render" }));
    const first = source.chords[0] as ChordEvent;
    const second = {
      ...first,
      id: `${first.id}-split`,
      startTick: 1440,
      durationTick: 480,
      root: "F" as const,
      bass: undefined,
      notes: [65, 69, 72, 76],
    } satisfies ChordEvent;
    const edited = compositionWithChords(source, [
      { ...first, durationTick: 1440 },
      second,
    ]);
    const tracks = buildCompositionTracks(edited);
    const bass = tracks.find((track) => track.role === "bass")?.notes ?? [];
    // The boundary itself is a bass attack on the active chord's root.  The
    // preceding attack is a single semitone approach into that exact register.
    expect(bass.find((note) => note.startTick === 1440)?.midi).toBe(41);
    expect(bass.find((note) => note.startTick === 960)?.midi).toBe(40);
    expect(bass.every((note) => note.startTick + note.durationTick <= 1440 || note.startTick >= 1440)).toBe(true);
    const changedChordNotes = notesAtStart(edited, 1440)
      .filter(({ track }) => track.role === "chords")
      .map(({ note }) => note.midi);
    expect(changedChordNotes.length).toBeGreaterThan(0);
    expect(changedChordNotes.every((midi) => [65, 69, 72, 76].includes(midi))).toBe(true);
  });

  it("plays a short mid-bar slash chord on its own sounding bass before approaching the next chord", () => {
    const source = generateComposition(jazzSettings({ bars: 4, seed: "short-slash-render" }));
    const first = source.chords[0] as ChordEvent;
    const shortSlash = {
      ...first,
      id: `${first.id}-short-slash`,
      startTick: 960,
      durationTick: 480,
      root: "D" as const,
      bass: "A" as const,
      notes: [62, 66, 69, 73],
    } satisfies ChordEvent;
    const next = {
      ...first,
      id: `${first.id}-next`,
      startTick: 1440,
      durationTick: 480,
      root: "F" as const,
      bass: undefined,
      notes: [65, 69, 72, 76],
    } satisfies ChordEvent;
    const edited = compositionWithChords(source, [
      { ...first, durationTick: 960 },
      shortSlash,
      next,
    ]);
    const bass = buildCompositionTracks(edited).find((track) => track.role === "bass")?.notes ?? [];
    const slashAttack = bass.find((note) => note.startTick === 960);
    expect(slashAttack?.midi).toBe(45); // A2, not an approach into the following F.
    expect(slashAttack?.role).toBe("chordTone");
    expect(bass.find((note) => note.startTick === 480)?.role).toBe("approach");
  });

  it("honors slash bass, held two-bar chords, and empty chord gaps safely", () => {
    const source = generateComposition(jazzSettings({ bars: 4, seed: "slash-held" }));
    const first = source.chords[0] as ChordEvent;
    const held = { ...first, durationTick: source.totalTicks, bass: "E" as const };
    const heldComposition = compositionWithChords(source, [held]);
    const bass = buildCompositionTracks(heldComposition).find((track) => track.role === "bass")?.notes ?? [];
    expect(bass.length).toBeGreaterThan(0);
    expect(bass[0]?.midi).toBe(40); // E2, the explicit sounding slash bass.
    expect(bass.every((note) => note.startTick + note.durationTick <= source.totalTicks)).toBe(true);

    const empty = compositionWithChords(source, [
      { ...first, startTick: source.ticksPerBar, durationTick: source.ticksPerBar },
    ]);
    expect(() => buildCompositionTracks(empty)).not.toThrow();
    expect(buildCompositionTracks(empty)
      .filter((track) => track.role === "bass" || track.role === "chords")
      .flatMap((track) => track.notes)
      .every((note) => note.startTick >= source.ticksPerBar)).toBe(true);
  });

  it("keeps playback and exported MIDI on the same rendered notes", () => {
    const composition = generateComposition(jazzSettings({ bars: 4, seed: "midi-shared" }));
    const tracks = buildCompositionTracks(composition);
    const midi = new Midi(exportCompositionMidi(composition));
    expect(midi.tracks).toHaveLength(tracks.length);
    for (const [index, track] of tracks.entries()) {
      const midiNotes = midi.tracks[index]?.notes ?? [];
      expect(midiNotes.map((note) => [note.midi, note.ticks, note.durationTicks])).toEqual(
        track.notes.map((note) => [note.midi, note.startTick, note.durationTick]),
      );
    }
    const melody = tracks.find((track) => track.role === "melody")?.notes ?? [];
    expect(melody.map((note) => note.startTick)).toEqual(composition.notes.map((note) => note.startTick));
  });

  it("does not reshuffle accompaniment when only the composition seed changes", () => {
    const composition = generateComposition(jazzSettings({ seed: "stable-accompaniment" }));
    const regeneratedSeed = { ...composition, seed: "melody-only-variation" };
    const firstTracks = buildCompositionTracks(composition);
    const secondTracks = buildCompositionTracks(regeneratedSeed);
    for (const role of ["bass", "chords"] as const) {
      expect(secondTracks.find((track) => track.role === role)?.notes)
        .toEqual(firstTracks.find((track) => track.role === role)?.notes);
    }
  });

  it.each(["4/4", "3/4", "6/8"] as const)("stays deterministic and in range in %s", (timeSignature) => {
    const settings = jazzSettings({ timeSignature, bars: 4, seed: `meter-${timeSignature}` });
    const first = generateComposition(settings);
    const second = generateComposition(settings);
    expect(buildCompositionTracks(first)).toEqual(buildCompositionTracks(second));
    for (const track of buildCompositionTracks(first)) {
      for (const note of track.notes) {
        expect(note.midi).toBeGreaterThanOrEqual(21);
        expect(note.midi).toBeLessThanOrEqual(108);
        expect(note.startTick).toBeGreaterThanOrEqual(0);
        expect(note.startTick + note.durationTick).toBeLessThanOrEqual(first.totalTicks);
      }
    }
  });
});
