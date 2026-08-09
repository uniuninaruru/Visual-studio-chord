import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import { exportCompositionMidi } from "../src/features/export/midi";
import { parseMidi } from "../src/music/midiImport";
import { buildCompositionTracks } from "../src/music/compositionTracks";
import {
  chordSlices,
  compareVoicing,
  measureVoicing,
  spanRangeFrom,
} from "../src/music/voicingStatistics";
import type { GeneratorSettings } from "../src/types/music";

/**
 * Measuring how chords are held, from anything that holds them.
 *
 * The point of this module is to replace numbers I chose with numbers a
 * recording states, so the test that matters most is not that it computes a
 * span correctly -- it is that measuring a piece through a MIDI file gives the
 * same answer as measuring the piece itself. If those disagree, every figure
 * taken from an external file is measuring the parser rather than the music.
 */

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/** "Chords / Right Hand", as buildCompositionTracks assigns it. */
const CHORD_CHANNEL = 1;

function piece(patch: Partial<GeneratorSettings> = {}) {
  return generateComposition({
    ...DEFAULT_GENERATOR_SETTINGS, bars: 16, seed: "stats", ...patch,
  } as GeneratorSettings);
}

describe("slicing notes into voicings", () => {
  it("finds the vertical set at each moment", () => {
    const slices = chordSlices([
      { midi: 60, startTick: 0, durationTick: 480 },
      { midi: 64, startTick: 0, durationTick: 480 },
      { midi: 67, startTick: 0, durationTick: 480 },
    ]);
    expect(slices).toEqual([{ notes: [60, 64, 67], startTick: 0, durationTick: 480 }]);
  });

  it("merges consecutive slices holding the same pitches", () => {
    // A chord under a moving melody changes its vertical set on every melody
    // note. Counting each as a separate voicing would report the chord as many
    // short voicings rather than the one long one a player is holding, and
    // every time-weighted figure would be wrong by however busy the tune is.
    const slices = chordSlices([
      { midi: 60, startTick: 0, durationTick: 1920 },
      { midi: 64, startTick: 0, durationTick: 1920 },
      { midi: 67, startTick: 0, durationTick: 1920 },
    ], { minDurationTick: 1 });
    expect(slices).toHaveLength(1);
    expect(slices[0]?.durationTick).toBe(1920);
  });

  it("does not merge across a gap of silence", () => {
    const slices = chordSlices([
      { midi: 60, startTick: 0, durationTick: 240 },
      { midi: 64, startTick: 0, durationTick: 240 },
      { midi: 67, startTick: 0, durationTick: 240 },
      { midi: 60, startTick: 480, durationTick: 240 },
      { midi: 64, startTick: 480, durationTick: 240 },
      { midi: 67, startTick: 480, durationTick: 240 },
    ], { minDurationTick: 1 });
    expect(slices).toHaveLength(2);
    expect(slices.map((slice) => slice.startTick)).toEqual([0, 480]);
  });

  it("drops sets too brief to be a voicing anyone chose", () => {
    // A sixteenth passing note forms a vertical set with whatever is under it.
    // That set is an artefact of the line moving, not a voicing.
    const withPassing = chordSlices([
      { midi: 60, startTick: 0, durationTick: 1920 },
      { midi: 64, startTick: 0, durationTick: 1920 },
      { midi: 67, startTick: 0, durationTick: 1920 },
      { midi: 74, startTick: 480, durationTick: 60 },
    ]);
    expect(withPassing.every((slice) => slice.durationTick >= 120)).toBe(true);
    expect(withPassing.some((slice) => slice.notes.includes(74))).toBe(false);
  });

  it("ignores dyads, which state an interval rather than a voicing", () => {
    expect(chordSlices([
      { midi: 60, startTick: 0, durationTick: 1920 },
      { midi: 67, startTick: 0, durationTick: 1920 },
    ])).toEqual([]);
  });

  it("ignores percussion, whose pitches are drum numbers", () => {
    const slices = chordSlices([
      { midi: 36, startTick: 0, durationTick: 1920, channel: 9 },
      { midi: 38, startTick: 0, durationTick: 1920, channel: 9 },
      { midi: 42, startTick: 0, durationTick: 1920, channel: 9 },
    ]);
    expect(slices).toEqual([]);
  });

  it("counts a doubled pitch once", () => {
    // Two hands playing the same C is one pitch in the voicing, and counting it
    // twice would report a four-voice chord as five and shift every span.
    const slices = chordSlices([
      { midi: 60, startTick: 0, durationTick: 960 },
      { midi: 60, startTick: 0, durationTick: 960 },
      { midi: 64, startTick: 0, durationTick: 960 },
      { midi: 67, startTick: 0, durationTick: 960 },
    ]);
    expect(slices[0]?.notes).toEqual([60, 64, 67]);
  });
});

describe("measuring a body of voicings", () => {
  it("weights a held chord above a passing one", () => {
    // Three narrow chords flashing past and one wide chord held for four bars.
    // A count-weighted median would report the narrow width; what is heard is
    // the wide one.
    const held = [
      { midi: 36, startTick: 0, durationTick: 7680 },
      { midi: 55, startTick: 0, durationTick: 7680 },
      { midi: 64, startTick: 0, durationTick: 7680 },
    ];
    const flashes = [0, 1, 2].flatMap((index) => [
      { midi: 72, startTick: 7680 + index * 240, durationTick: 240 },
      { midi: 76, startTick: 7680 + index * 240, durationTick: 240 },
      { midi: 79, startTick: 7680 + index * 240, durationTick: 240 },
    ]);
    const statistics = measureVoicing(chordSlices([...held, ...flashes]));
    expect(statistics.span.median).toBe(28);
  });

  it("reports nothing rather than zero-shaped numbers for no input", () => {
    const statistics = measureVoicing([]);
    expect(statistics.sliceCount).toBe(0);
    expect(statistics.weight).toBe(0);
  });

  it("names the share of voicings holding a second", () => {
    const clustered = { notes: [60, 62, 67], startTick: 0, durationTick: 480 };
    const clean = { notes: [60, 64, 67], startTick: 480, durationTick: 1440 };
    expect(measureVoicing([clustered, clean]).clusterShare).toBeCloseTo(0.25, 5);
  });

  it("names the share of voicings a player holds in two hands", () => {
    const twoHand = { notes: [40, 47, 64, 67, 71], startTick: 0, durationTick: 960 };
    const oneHand = { notes: [60, 64, 67], startTick: 960, durationTick: 960 };
    expect(measureVoicing([twoHand, oneHand]).twoHandShare).toBeCloseTo(0.5, 5);
  });

  it("reads a span range off the distribution rather than off the extremes", () => {
    // One freak three-octave chord must not widen the range every other chord
    // is judged against.
    const ordinary = Array.from({ length: 20 }, (_, index) => ({
      notes: [60, 64, 72], startTick: index * 480, durationTick: 480,
    }));
    const freak = { notes: [36, 60, 84], startTick: 9600, durationTick: 480 };
    const range = spanRangeFrom(measureVoicing([...ordinary, freak]));
    expect(range.maxSpan).toBe(12);
  });
});

describe("measuring a piece through a MIDI file", () => {
  it("gives the same figures as measuring the piece itself", () => {
    // The claim this module rests on. Every number taken from a composer's own
    // file passes through the parser first, so if the parser changed the
    // geometry the figures would describe the parser.
    for (const seed of ["a", "b", "c"]) {
      const composed = piece({ seed });
      // The chord track as the app plays it, before anything is written out.
      const chordTrack = buildCompositionTracks(composed)
        .find((track) => track.midiChannel === CHORD_CHANNEL);
      expect(chordTrack, seed).toBeDefined();
      const direct = measureVoicing(chordSlices(chordTrack!.notes));
      expect(direct.sliceCount, seed).toBeGreaterThan(0);

      // The same track after a round trip through a Standard MIDI File.
      const parsed = parseMidi(bufferOf(exportCompositionMidi(composed)));
      const viaFile = measureVoicing(chordSlices(
        parsed.notes.filter((note) => note.channel === CHORD_CHANNEL),
      ));

      expect(viaFile.sliceCount, seed).toBe(direct.sliceCount);
      expect(viaFile.span.median, seed).toBe(direct.span.median);
      expect(viaFile.span.p90, seed).toBe(direct.span.p90);
      expect(viaFile.voiceCount.mean, seed).toBeCloseTo(direct.voiceCount.mean, 6);
      expect(viaFile.clusterShare, seed).toBeCloseTo(direct.clusterShare, 6);
      expect(viaFile.twoHandShare, seed).toBeCloseTo(direct.twoHandShare, 6);
    }
  });
});

describe("comparing against a reference", () => {
  it("reports each metric separately rather than one score", () => {
    // A single number would hide which of the eight things is wrong, and the
    // only useful output of a measurement is what to change next.
    const reference = measureVoicing([
      { notes: [40, 47, 64, 67, 71], startTick: 0, durationTick: 1920 },
    ]);
    const measured = measureVoicing([
      { notes: [60, 64, 67], startTick: 0, durationTick: 1920 },
    ]);
    const comparison = compareVoicing(reference, measured);
    expect(comparison.length).toBeGreaterThan(5);
    expect(comparison.find((entry) => entry.metric === "span.median")?.difference).toBe(-24);
    expect(comparison.find((entry) => entry.metric === "twoHandShare")?.difference).toBe(-1);
  });
});
