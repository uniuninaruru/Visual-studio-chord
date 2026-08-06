import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import { exportCompositionMidi } from "../src/features/export/midi";
import {
  MidiParseError,
  parseMidi,
  pickMelodyTrack,
  rescaleTicks,
} from "../src/music/midiImport";
import { harmonizeMelody } from "../src/music/melodyHarmonizer";
import type { GeneratorSettings } from "../src/types/music";

/**
 * Reading a Standard MIDI File.
 *
 * The app could already write one, so the strongest available test is a round
 * trip: export a composition, read it back, and require the notes to survive.
 * A parser checked only against files it wrote itself would still be worth
 * having, so there are hand-built files here too for the parts an exporter
 * never produces -- running status, note-on-with-zero-velocity as a note-off,
 * and the formats that must be refused.
 */

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function piece(patch: Partial<GeneratorSettings> = {}) {
  return generateComposition({
    ...DEFAULT_GENERATOR_SETTINGS, bars: 8, seed: "midi", ...patch,
  } as GeneratorSettings);
}

/** Builds a minimal single-track file from raw track bytes. */
function fileWith(trackBytes: number[], division = 480, format = 0, tracks = 1): ArrayBuffer {
  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6,
    (format >> 8) & 0xff, format & 0xff,
    (tracks >> 8) & 0xff, tracks & 0xff,
    (division >> 8) & 0xff, division & 0xff,
  ];
  const length = trackBytes.length;
  const track = [
    0x4d, 0x54, 0x72, 0x6b,
    (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff,
    ...trackBytes,
  ];
  return bufferOf(new Uint8Array([...header, ...track]));
}

const END_OF_TRACK = [0x00, 0xff, 0x2f, 0x00];

describe("reading a MIDI file", () => {
  it("reads back what the app itself wrote", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const composed = piece({ seed });
      const parsed = parseMidi(bufferOf(exportCompositionMidi(composed)));

      const written = composed.notes
        .map((note) => `${note.midi}@${note.startTick}`)
        .sort();
      const readBack = parsed.notes
        .filter((note) => written.includes(`${note.midi}@${note.startTick}`))
        .map((note) => `${note.midi}@${note.startTick}`);
      // Every melody note the app wrote is present, at the tick it was written.
      for (const entry of written) {
        expect(readBack, `${seed}: lost ${entry}`).toContain(entry);
      }
      expect(parsed.ppq, seed).toBe(composed.ppq);
    }
  });

  it("keeps note durations through the round trip", () => {
    const composed = piece();
    const parsed = parseMidi(bufferOf(exportCompositionMidi(composed)));
    for (const note of composed.notes) {
      const match = parsed.notes.find(
        (entry) => entry.midi === note.midi && entry.startTick === note.startTick,
      );
      expect(match, `${note.midi}@${note.startTick}`).toBeDefined();
      expect(match!.durationTick).toBe(note.durationTick);
    }
  });

  it("recovers the time signature", () => {
    for (const timeSignature of ["4/4", "3/4", "6/8"] as const) {
      const parsed = parseMidi(bufferOf(exportCompositionMidi(piece({ timeSignature }))));
      expect(parsed.timeSignature, timeSignature).toBe(timeSignature);
    }
  });

  it("treats a note-on of zero velocity as a note-off", () => {
    // Not an edge case: most writers use it, because it lets a run of notes
    // share one running status byte. Read without it, every note sticks on.
    const parsed = parseMidi(fileWith([
      0x00, 0x90, 60, 100,
      0x81, 0x40, 0x90, 60, 0, // 192 ticks later, velocity zero
      ...END_OF_TRACK,
    ]));
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0]).toMatchObject({ midi: 60, startTick: 0, durationTick: 192 });
  });

  it("follows running status", () => {
    // The second note omits its status byte entirely.
    const parsed = parseMidi(fileWith([
      0x00, 0x90, 60, 100,
      0x00, 62, 100,
      0x60, 0x80, 60, 0,
      0x00, 62, 0,
      ...END_OF_TRACK,
    ]));
    expect(parsed.notes.map((note) => note.midi).sort()).toEqual([60, 62]);
    expect(parsed.notes.every((note) => note.durationTick === 96)).toBe(true);
  });

  it("closes a pitch that is struck again before it is released", () => {
    // Losing one of them would be the alternative.
    const parsed = parseMidi(fileWith([
      0x00, 0x90, 60, 100,
      0x60, 0x90, 60, 100,
      0x60, 0x80, 60, 0,
      ...END_OF_TRACK,
    ]));
    expect(parsed.notes).toHaveLength(2);
    expect(parsed.notes[0]?.startTick).toBe(0);
    expect(parsed.notes[1]?.startTick).toBe(96);
  });

  it("keeps a note whose track ends without releasing it", () => {
    // Malformed, but discarding it loses music the file plainly contains.
    const parsed = parseMidi(fileWith([
      0x00, 0x90, 60, 100,
      0x60, 0xff, 0x2f, 0x00,
    ]));
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0]?.durationTick).toBe(96);
  });

  it("tells the same pitch on two channels apart", () => {
    // Closing the wrong one leaves a note hanging.
    const parsed = parseMidi(fileWith([
      0x00, 0x90, 60, 100,
      0x00, 0x91, 60, 100,
      0x60, 0x80, 60, 0,
      0x60, 0x81, 60, 0,
      ...END_OF_TRACK,
    ]));
    expect(parsed.notes).toHaveLength(2);
    expect(parsed.notes.map((note) => note.durationTick).sort((a, b) => a - b)).toEqual([96, 192]);
  });

  it("skips the messages it does not need", () => {
    const parsed = parseMidi(fileWith([
      0x00, 0xb0, 7, 100,        // controller
      0x00, 0xc0, 42,            // program change
      0x00, 0xd0, 64,            // channel pressure
      0x00, 0xe0, 0, 64,         // pitch bend
      0x00, 0xff, 0x01, 0x03, 65, 66, 67, // a text meta event
      0x00, 0x90, 60, 100,
      0x60, 0x80, 60, 0,
      ...END_OF_TRACK,
    ]));
    expect(parsed.notes).toHaveLength(1);
  });

  it("reads a variable-length delta longer than one byte", () => {
    // 0x87 0x68 is 1000 ticks. A parser reading only the first byte would place
    // every later note in the wrong bar.
    const parsed = parseMidi(fileWith([
      0x00, 0x90, 60, 100,
      0x87, 0x68, 0x80, 60, 0,
      ...END_OF_TRACK,
    ]));
    expect(parsed.notes[0]?.durationTick).toBe(1000);
  });

  describe("refusing what it cannot read", () => {
    it("refuses a file that is not a MIDI file", () => {
      expect(() => parseMidi(bufferOf(new Uint8Array([1, 2, 3, 4]))))
        .toThrow(MidiParseError);
      expect(() => parseMidi(bufferOf(new Uint8Array(20))))
        .toThrow(/does not start with a MIDI header/);
    });

    it("refuses format 2 by name", () => {
      // It holds independent sequences rather than one piece, so flattening it
      // would import something the caller did not ask for.
      expect(() => parseMidi(fileWith(END_OF_TRACK, 480, 2)))
        .toThrow(/independent sequences/);
    });

    it("refuses SMPTE timing rather than guessing a beat", () => {
      // Ticks per video frame have no fixed relation to the beat; a guess would
      // silently misplace every note.
      expect(() => parseMidi(fileWith(END_OF_TRACK, 0xe278)))
        .toThrow(/SMPTE/);
    });

    it("refuses a division of zero", () => {
      expect(() => parseMidi(fileWith(END_OF_TRACK, 0))).toThrow(/zero ticks/);
    });

    it("refuses a truncated file rather than returning half a piece", () => {
      expect(() => parseMidi(fileWith([0x00, 0x90, 60]))).toThrow(MidiParseError);
    });
  });
});

describe("picking the melody out of an arrangement", () => {
  it("takes the higher line over the lower one", () => {
    // A file dropped in by a composer is an arrangement, not a bare tune, and
    // harmonising the bass produces nonsense that looks like a harmoniser bug.
    const parsed = parseMidi(fileWith([
      0x00, 0x90, 40, 100,   // bass, channel 0
      0x00, 0x91, 76, 100,   // melody, channel 1
      0x60, 0x80, 40, 0,
      0x00, 0x81, 76, 0,
      ...END_OF_TRACK,
    ]));
    expect(pickMelodyTrack(parsed).map((note) => note.midi)).toEqual([76]);
  });

  it("prefers a line to a chord part even when the chords sit higher", () => {
    // Simultaneous onsets are what tell a chord part from a melody.
    const parsed = parseMidi(fileWith([
      0x00, 0x90, 72, 100, 0x00, 76, 100, 0x00, 79, 100, // a chord, channel 0
      0x00, 0x91, 67, 100,                                // a line, channel 1
      0x60, 0x80, 72, 0, 0x00, 76, 0, 0x00, 79, 0,
      0x00, 0x81, 67, 0,
      ...END_OF_TRACK,
    ]));
    expect(pickMelodyTrack(parsed).map((note) => note.midi)).toEqual([67]);
  });

  it("ignores the percussion channel entirely", () => {
    // Channel 10 pitches are drum numbers, not notes.
    const parsed = parseMidi(fileWith([
      0x00, 0x99, 100, 100,  // channel 9, a high "pitch" that would otherwise win
      0x00, 0x90, 60, 100,
      0x60, 0x89, 100, 0,
      0x00, 0x80, 60, 0,
      ...END_OF_TRACK,
    ]));
    expect(pickMelodyTrack(parsed).map((note) => note.midi)).toEqual([60]);
  });

  it("returns nothing rather than guessing when there is only percussion", () => {
    const parsed = parseMidi(fileWith([
      0x00, 0x99, 36, 100, 0x60, 0x89, 36, 0, ...END_OF_TRACK,
    ]));
    expect(pickMelodyTrack(parsed)).toEqual([]);
  });

  it("is deterministic when two parts score alike", () => {
    const parsed = parseMidi(fileWith([
      0x00, 0x90, 60, 100,
      0x00, 0x91, 60, 100,
      0x60, 0x80, 60, 0,
      0x00, 0x81, 60, 0,
      ...END_OF_TRACK,
    ]));
    expect(JSON.stringify(pickMelodyTrack(parsed))).toBe(JSON.stringify(pickMelodyTrack(parsed)));
  });
});

describe("rescaling to the app's division", () => {
  it("leaves ticks alone when the divisions match", () => {
    const notes = [{ midi: 60, startTick: 480, durationTick: 240, velocity: 90, channel: 0, track: 0 }];
    expect(rescaleTicks(notes, 480, 480)).toEqual(notes);
  });

  it("scales both the start and the length", () => {
    const notes = [{ midi: 60, startTick: 96, durationTick: 48, velocity: 90, channel: 0, track: 0 }];
    const scaled = rescaleTicks(notes, 96, 480);
    expect(scaled[0]?.startTick).toBe(480);
    expect(scaled[0]?.durationTick).toBe(240);
  });

  it("rounds rather than truncates", () => {
    // Truncation biases every note early, and a piece imported at a coarse
    // division would drift steadily ahead of the beat.
    const notes = [{ midi: 60, startTick: 1, durationTick: 1, velocity: 90, channel: 0, track: 0 }];
    const scaled = rescaleTicks(notes, 96, 480 * 1.5);
    expect(scaled[0]?.startTick).toBe(8);
  });

  it("never scales a note down to nothing", () => {
    const notes = [{ midi: 60, startTick: 0, durationTick: 1, velocity: 90, channel: 0, track: 0 }];
    expect(rescaleTicks(notes, 960, 96)[0]?.durationTick).toBeGreaterThan(0);
  });
});

describe("import through to chords", () => {
  it("turns an exported piece back into a harmonisation of its own melody", () => {
    // The end of the chain, and the only test that says the parts fit together.
    for (const seed of ["a", "b", "c"]) {
      const composed = piece({ seed, bars: 16 });
      const parsed = parseMidi(bufferOf(exportCompositionMidi(composed)));
      const melody = rescaleTicks(pickMelodyTrack(parsed), parsed.ppq, composed.ppq);
      expect(melody.length, seed).toBeGreaterThan(0);

      const harmonised = harmonizeMelody(melody, {
        bars: 16,
        timeSignature: parsed.timeSignature ?? "4/4",
        ppq: composed.ppq,
        maxChordsPerBar: 1,
      });
      expect(harmonised, seed).not.toBeNull();
      expect(harmonised!.chords.length, seed).toBe(16);

      // And the melody sits on what came out.
      let onChord = 0;
      let total = 0;
      for (const chord of harmonised!.chords) {
        const tones = new Set(chord.pitchClasses);
        for (const note of melody) {
          if (note.startTick < chord.startTick) continue;
          if (note.startTick >= chord.startTick + chord.durationTick) continue;
          total += 1;
          if (tones.has(((note.midi % 12) + 12) % 12)) onChord += 1;
        }
      }
      expect(onChord / total, seed).toBeGreaterThan(0.7);
    }
  });
});
