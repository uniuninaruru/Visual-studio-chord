import type { TimeSignature } from "../types/music";

/**
 * Reading a Standard MIDI File.
 *
 * Written rather than depended on. The parser is a few hundred lines of a
 * published, stable format, while a dependency would be a licence to check, a
 * bundle to carry, and a supply chain to trust -- for a file format that has
 * not changed since 1996.
 *
 * Handles format 0 and format 1. Format 2 holds independent sequences rather
 * than one piece, so it is refused by name instead of being silently flattened
 * into something the caller did not import.
 */

export interface ImportedNote {
  midi: number;
  /** Ticks from the start of the file, in the file's own division. */
  startTick: number;
  durationTick: number;
  velocity: number;
  channel: number;
  track: number;
}

export interface ImportedMidi {
  notes: ImportedNote[];
  /** Ticks per quarter note, as the file declares. */
  ppq: number;
  /** Microseconds per quarter note from the first tempo event, if any. */
  microsecondsPerQuarter?: number;
  timeSignature?: TimeSignature;
  /** Raw time signature, kept when it is one the app cannot represent. */
  rawTimeSignature?: { numerator: number; denominator: number };
  trackCount: number;
  format: number;
}

export class MidiParseError extends Error {}

class Reader {
  private offset = 0;

  constructor(private readonly view: DataView) {}

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.view.byteLength - this.offset;
  }

  seek(offset: number): void {
    this.offset = offset;
  }

  uint8(): number {
    if (this.offset >= this.view.byteLength) throw new MidiParseError("MIDI file ended early.");
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  uint16(): number {
    const value = this.uint8();
    return (value << 8) | this.uint8();
  }

  uint32(): number {
    // Shifting would overflow into a negative for the high bit, and a chunk
    // length is unsigned.
    return this.uint16() * 0x10000 + this.uint16();
  }

  /** MIDI's variable-length quantity: seven bits per byte, high bit continues. */
  variableLength(): number {
    let value = 0;
    for (let read = 0; read < 4; read += 1) {
      const byte = this.uint8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    // Five continuation bytes is not a long number, it is a corrupt file.
    throw new MidiParseError("MIDI variable-length quantity is too long.");
  }

  ascii(length: number): string {
    let text = "";
    for (let index = 0; index < length; index += 1) text += String.fromCharCode(this.uint8());
    return text;
  }

  skip(length: number): void {
    this.offset += length;
  }
}

function timeSignatureFrom(numerator: number, denominator: number): TimeSignature | undefined {
  if (numerator === 4 && denominator === 4) return "4/4";
  if (numerator === 3 && denominator === 4) return "3/4";
  if (numerator === 6 && denominator === 8) return "6/8";
  return undefined;
}

/**
 * Parses one track, appending its notes.
 *
 * Note-on with a velocity of zero is a note-off. That is not an edge case: most
 * writers use it, because it lets a run of notes share one running status byte.
 * A file read without it produces every note stuck on forever.
 */
function readTrack(
  reader: Reader,
  end: number,
  trackIndex: number,
  into: ImportedNote[],
  state: { microsecondsPerQuarter?: number; timeSignature?: TimeSignature; raw?: { numerator: number; denominator: number } },
): void {
  let tick = 0;
  let runningStatus = 0;
  // Keyed by channel and pitch, because the same pitch on two channels is two
  // notes and closing the wrong one leaves a note hanging.
  const sounding = new Map<number, { startTick: number; velocity: number }>();

  while (reader.position < end) {
    tick += reader.variableLength();
    let status = reader.uint8();
    if ((status & 0x80) === 0) {
      // Running status: this byte is already data, so the previous status
      // stands and the read has to be rewound by one.
      if (runningStatus === 0) throw new MidiParseError("MIDI event has no status byte.");
      reader.seek(reader.position - 1);
      status = runningStatus;
    } else if (status < 0xf0) {
      runningStatus = status;
    }

    if (status === 0xff) {
      const type = reader.uint8();
      const length = reader.variableLength();
      if (type === 0x51 && length === 3) {
        const value = (reader.uint8() << 16) | (reader.uint8() << 8) | reader.uint8();
        state.microsecondsPerQuarter ??= value;
        continue;
      }
      if (type === 0x58 && length >= 2) {
        const numerator = reader.uint8();
        const denominator = 2 ** reader.uint8();
        state.raw ??= { numerator, denominator };
        state.timeSignature ??= timeSignatureFrom(numerator, denominator);
        reader.skip(length - 2);
        continue;
      }
      reader.skip(length);
      continue;
    }

    if (status === 0xf0 || status === 0xf7) {
      reader.skip(reader.variableLength());
      continue;
    }

    const command = status & 0xf0;
    const channel = status & 0x0f;
    if (command === 0x90 || command === 0x80) {
      const pitch = reader.uint8() & 0x7f;
      const velocity = reader.uint8() & 0x7f;
      const key = channel * 128 + pitch;
      if (command === 0x90 && velocity > 0) {
        // A second note-on for a pitch already sounding closes the first: the
        // alternative is losing one of them.
        const open = sounding.get(key);
        if (open) {
          into.push({
            midi: pitch, startTick: open.startTick, durationTick: Math.max(1, tick - open.startTick),
            velocity: open.velocity, channel, track: trackIndex,
          });
        }
        sounding.set(key, { startTick: tick, velocity });
      } else {
        const open = sounding.get(key);
        if (open) {
          sounding.delete(key);
          into.push({
            midi: pitch, startTick: open.startTick, durationTick: Math.max(1, tick - open.startTick),
            velocity: open.velocity, channel, track: trackIndex,
          });
        }
      }
      continue;
    }

    // Every other channel message is two data bytes except program change and
    // channel pressure, which are one.
    if (command === 0xc0 || command === 0xd0) {
      reader.uint8();
    } else if (command === 0xa0 || command === 0xb0 || command === 0xe0) {
      reader.uint8();
      reader.uint8();
    } else {
      throw new MidiParseError(`Unsupported MIDI status byte 0x${status.toString(16)}.`);
    }
  }

  // A track that ends without releasing its notes is malformed, but discarding
  // them loses music the file plainly contains, so they end where it does.
  for (const [key, open] of sounding) {
    into.push({
      midi: key % 128, startTick: open.startTick, durationTick: Math.max(1, tick - open.startTick),
      velocity: open.velocity, channel: Math.floor(key / 128), track: trackIndex,
    });
  }
}

/** Reads a Standard MIDI File into notes measured in its own ticks. */
export function parseMidi(data: ArrayBuffer): ImportedMidi {
  const reader = new Reader(new DataView(data));
  if (reader.remaining < 14) throw new MidiParseError("File is too short to be a MIDI file.");
  if (reader.ascii(4) !== "MThd") throw new MidiParseError("File does not start with a MIDI header.");

  const headerLength = reader.uint32();
  const format = reader.uint16();
  const trackCount = reader.uint16();
  const division = reader.uint16();
  // Header chunks are six bytes today; the length field exists so they can grow.
  reader.skip(headerLength - 6);

  if (format === 2) {
    throw new MidiParseError(
      "MIDI format 2 holds independent sequences rather than one piece, so it cannot be imported as a melody.",
    );
  }
  if ((division & 0x8000) !== 0) {
    // SMPTE timing measures ticks per video frame, which has no fixed relation
    // to the beat. Guessing one would silently misplace every note.
    throw new MidiParseError("MIDI files timed in SMPTE frames are not supported.");
  }
  if (division === 0) throw new MidiParseError("MIDI file declares zero ticks per quarter note.");

  const notes: ImportedNote[] = [];
  const state: {
    microsecondsPerQuarter?: number;
    timeSignature?: TimeSignature;
    raw?: { numerator: number; denominator: number };
  } = {};

  for (let track = 0; track < trackCount; track += 1) {
    if (reader.remaining < 8) break;
    const chunk = reader.ascii(4);
    const length = reader.uint32();
    if (chunk !== "MTrk") {
      // Unknown chunk types are to be skipped, by the specification.
      reader.skip(length);
      track -= 1;
      continue;
    }
    readTrack(reader, reader.position + length, track, notes, state);
  }

  notes.sort((left, right) =>
    left.startTick - right.startTick || left.midi - right.midi || left.track - right.track);

  return {
    notes,
    ppq: division,
    microsecondsPerQuarter: state.microsecondsPerQuarter,
    timeSignature: state.timeSignature,
    rawTimeSignature: state.raw,
    trackCount,
    format,
  };
}

/**
 * The one line most likely to be the melody.
 *
 * A file dropped in by a composer is rarely a bare melody. It is a whole
 * arrangement, and harmonising the bass or the pad instead of the tune produces
 * nonsense that looks like a bug in the harmoniser.
 *
 * The heuristic is the highest-sounding monophonic-ish line: melodies sit above
 * their accompaniment and rarely play chords. Channel 10 is dropped outright
 * because it is percussion by convention and its pitches are drum numbers, not
 * notes.
 */
export function pickMelodyTrack(imported: ImportedMidi): ImportedNote[] {
  const byTrack = new Map<string, ImportedNote[]>();
  for (const note of imported.notes) {
    if (note.channel === 9) continue;
    const key = `${note.track}:${note.channel}`;
    const list = byTrack.get(key) ?? [];
    list.push(note);
    byTrack.set(key, list);
  }
  if (byTrack.size === 0) return [];

  let best: { notes: ImportedNote[]; score: number } | null = null;
  for (const [key, list] of [...byTrack].sort((left, right) => left[0].localeCompare(right[0]))) {
    void key;
    if (list.length === 0) continue;
    const meanPitch = list.reduce((sum, note) => sum + note.midi, 0) / list.length;
    // How often two notes start together, which is what tells a chord part
    // from a line.
    const starts = new Map<number, number>();
    for (const note of list) starts.set(note.startTick, (starts.get(note.startTick) ?? 0) + 1);
    const simultaneous = [...starts.values()].filter((count) => count > 1).length / starts.size;
    const score = meanPitch - simultaneous * 40;
    if (best === null || score > best.score) best = { notes: list, score };
  }
  return best?.notes ?? [];
}

/**
 * Rescales ticks from the file's division to the app's.
 *
 * Rounded rather than truncated, because truncation biases every note early and
 * a piece imported at a coarse division would drift steadily ahead of the beat.
 */
export function rescaleTicks(
  notes: readonly ImportedNote[],
  fromPpq: number,
  toPpq: number,
): ImportedNote[] {
  if (fromPpq === toPpq) return [...notes];
  const ratio = toPpq / fromPpq;
  return notes.map((note) => ({
    ...note,
    startTick: Math.round(note.startTick * ratio),
    durationTick: Math.max(1, Math.round(note.durationTick * ratio)),
  }));
}
