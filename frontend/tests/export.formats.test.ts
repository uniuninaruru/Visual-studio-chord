import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import {
  CompositionImportError,
  exportCompositionJson,
  exportCompositionMidi,
  importCompositionJson,
} from "../src/features/export";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";

describe("composition export", () => {
  const composition = generateComposition({
    ...DEFAULT_GENERATOR_SETTINGS,
    seed: "export-tests",
  });

  it("round-trips the versioned JSON format", () => {
    const json = exportCompositionJson(composition);
    const imported = importCompositionJson(json);
    expect(imported).toEqual(composition);
    expect(imported).not.toBe(composition);
  });

  it("rejects malformed and unsupported JSON documents", () => {
    expect(() => importCompositionJson("not-json")).toThrow(CompositionImportError);
    expect(() =>
      importCompositionJson(
        JSON.stringify({
          format: "music-theory-composer",
          version: 999,
          composition,
        }),
      ),
    ).toThrow(/Unsupported composition version/);
  });

  it("rejects out-of-range MIDI velocity during import", () => {
    const document = JSON.parse(exportCompositionJson(composition)) as {
      composition: { notes: Array<{ velocity: number }> };
    };
    const note = document.composition.notes[0];
    expect(note).toBeDefined();
    if (!note) return;
    note.velocity = 0;
    expect(() => importCompositionJson(JSON.stringify(document))).toThrow(/incomplete or out of range/);
  });

  it("exports separate, parseable chord and melody MIDI tracks", () => {
    const bytes = exportCompositionMidi(composition);
    const midi = new Midi(bytes);

    expect(midi.header.tempos[0]?.bpm).toBeCloseTo(composition.settings.bpm);
    expect(midi.tracks.map((track) => track.name)).toEqual(["Chords", "Melody"]);
    expect(midi.tracks[0]?.notes).toHaveLength(
      composition.chords.reduce((total, chord) => total + chord.notes.length, 0),
    );
    expect(midi.tracks[1]?.notes).toHaveLength(composition.notes.length);
    expect(midi.tracks[1]?.notes[0]?.ticks).toBe(composition.notes[0]?.startTick);
    expect(midi.tracks[1]?.notes[0]?.velocity).toBeCloseTo(
      (composition.notes[0]?.velocity ?? 0) / 127,
      1,
    );
  });
});
