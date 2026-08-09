import { describe, expect, it } from "vitest";
import {
  MINIMAL_GENERATOR_SETTINGS,
  buildCompositionTracks,
  generateComposition,
} from "../src/music";

describe("DAW composition tracks", () => {
  it("accepts the complete 88-key piano range from A0 to C8", () => {
    const composition = generateComposition({
      ...MINIMAL_GENERATOR_SETTINGS,
      seed: "full-piano",
      melody: {
        ...MINIMAL_GENERATOR_SETTINGS.melody,
        minMidi: 21,
        maxMidi: 108,
      },
    });
    expect(composition.settings.melody).toMatchObject({ minMidi: 21, maxMidi: 108 });
    for (const note of composition.notes) {
      expect(note.midi).toBeGreaterThanOrEqual(21);
      expect(note.midi).toBeLessThanOrEqual(108);
    }
  });

  it("exposes bass, right-hand chords and melody as separate tracks", () => {
    const composition = generateComposition({
      ...MINIMAL_GENERATOR_SETTINGS,
      seed: "tracks",
    });
    const tracks = buildCompositionTracks(composition);
    expect(tracks.slice(0, 3).map((track) => track.id)).toEqual([
      "track-bass",
      "track-chords",
      "track-melody",
    ]);
    expect(tracks[0]).toMatchObject({ hand: "left", editable: false });
    expect(tracks[1]).toMatchObject({ hand: "right", editable: false });
    expect(tracks[2]).toMatchObject({ hand: "right", editable: true });
    expect(tracks[0]!.notes).toHaveLength(composition.chords.length);
    expect(tracks[2]!.notes).toEqual(composition.notes);
  });

  it("puts only the lowest chord pitch in the bass track", () => {
    const composition = generateComposition({
      ...MINIMAL_GENERATOR_SETTINGS,
      seed: "hands",
    });
    const [bass, chords] = buildCompositionTracks(composition);
    for (const [index, chord] of composition.chords.entries()) {
      const pitches = [...chord.notes].sort((left, right) => left - right);
      expect(bass!.notes[index]!.midi).toBe(pitches[0]);
      const rightHand = chords!.notes
        .filter((note) => note.startTick === chord.startTick)
        .map((note) => note.midi);
      expect(rightHand).toEqual(pitches.slice(1));
    }
  });

  it("keeps generated arrangement voices as independent tracks", () => {
    const composition = generateComposition({
      ...MINIMAL_GENERATOR_SETTINGS,
      seed: "arranged-tracks",
      arrangement: {
        counterpoint: { enabled: true, position: "below", independence: 0.7 },
        polyrhythm: { enabled: true, pulses: 3, spanBars: 1 },
      },
    });
    const tracks = buildCompositionTracks(composition);
    expect(tracks.map((track) => track.role)).toContain("countermelody");
    expect(tracks.map((track) => track.role)).toContain("pulse");
    expect(tracks).toHaveLength(3 + (composition.voices?.length ?? 0));
  });
});
