import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import { exportCompositionMidi } from "../src/features/export/midi";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import { buildCompositionTracks } from "../src/music/compositionTracks";

describe("MIDI performance fidelity", () => {
  it("exports every rendered track with its articulation, groove and section dynamics", () => {
    const piece = generateComposition({ ...DEFAULT_GENERATOR_SETTINGS, bars: 16, seed: "midi-performance", style: "edm" });
    const rendered = buildCompositionTracks(piece);
    const midi = new Midi(exportCompositionMidi(piece));
    expect(midi.tracks.length).toBe(rendered.length);
    for (const [index, source] of rendered.entries()) {
      const track = midi.tracks[index]!;
      expect(track.name).toBe(source.name);
      expect(track.channel).toBe(source.midiChannel);
      const expected = source.notes.map((note) => ({ midi: note.midi, ticks: Math.round(note.startTick * midi.header.ppq / piece.ppq), durationTicks: Math.max(1, Math.round(note.durationTick * midi.header.ppq / piece.ppq)), velocity: note.velocity }));
      const actual = track.notes.map((note) => ({ midi: note.midi, ticks: note.ticks, durationTicks: note.durationTicks, velocity: Math.round(note.velocity * 127) }));
      const sort = (notes: typeof expected) => notes.sort((a, b) => a.ticks - b.ticks || a.midi - b.midi || a.durationTicks - b.durationTicks);
      expect(sort(actual)).toEqual(sort(expected));
    }
    expect(new Set(midi.tracks[0]!.notes.map((note) => note.velocity)).size).toBeGreaterThan(2);
  });

  it("still honours an explicit accompaniment velocity override and track filters", () => {
    const piece = generateComposition({ ...DEFAULT_GENERATOR_SETTINGS, bars: 4 });
    const midi = new Midi(exportCompositionMidi(piece, { chordVelocity: 0.5, includeMelody: false, includeAdditionalVoices: false }));
    expect(midi.tracks.length).toBe(2);
    for (const track of midi.tracks) for (const note of track.notes) expect(note.velocity).toBeCloseTo(0.5, 1);
  });
});
