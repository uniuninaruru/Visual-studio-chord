import { PPQ } from "../types/music";
import type {
  ChordQuality,
  GeneratedComposition,
  GeneratorSettings,
  NoteEvent,
  PitchClassName,
  TimeSignature,
} from "../types/music";
import { createStepChordEvent } from "./chords";
import { generateComposition } from "./generator";
import { harmonizeMelody, type HarmonizerNote } from "./melodyHarmonizer";
import {
  MidiParseError,
  parseMidi,
  pickMelodyTrack,
  rescaleTicks,
} from "./midiImport";
import { midiToNoteName } from "./scales";
import { ticksPerBar } from "./time";

/**
 * A melody file in, a composition out.
 *
 * The parts existed separately -- a MIDI reader, a key finder, a harmoniser --
 * and nothing joined them to something the editor can open. This is that join,
 * and it is deliberately thin: every decision it makes is one of the underlying
 * pieces' decisions, and where it has to choose something itself it says so.
 */

/** Bar counts the generator will accept, so an import can be edited afterwards. */
const ALLOWED_BARS = [4, 8, 16, 24, 32, 48] as const;

export class MelodyImportError extends Error {}

export interface MelodyImportOptions {
  /** Overrides the key the melody's own pitch distribution suggests. */
  key?: PitchClassName;
  mode?: GeneratorSettings["mode"];
  /** Style used for voicing and for everything the melody does not decide. */
  style?: GeneratorSettings["style"];
  maxChordsPerBar?: 1 | 2;
}

export interface MelodyImportResult {
  composition: GeneratedComposition;
  key: PitchClassName;
  mode: GeneratorSettings["mode"];
  bars: number;
  /** Notes kept from the file, after the melody line was picked out. */
  noteCount: number;
  /** Tracks and channels the file held, so the user can see what was dropped. */
  sourceTrackCount: number;
  timeSignature: TimeSignature;
}

/**
 * Rounds the melody's length up to a bar count the generator accepts.
 *
 * Refusing an odd length would reject most real files; truncating one would
 * silently drop the end of the tune. Rounding up leaves the last bars empty,
 * which is visible and editable.
 */
function barsFor(lastTick: number, timeSignature: TimeSignature, ppq: number): number {
  const barTicks = ticksPerBar(timeSignature, ppq);
  const needed = Math.max(1, Math.ceil(lastTick / barTicks));
  return ALLOWED_BARS.find((count) => count >= needed) ?? 48;
}

/** The quality the harmoniser chose, as the chord builder names it. */
function qualityFrom(intervals: readonly number[]): ChordQuality {
  const third = intervals[1] as number;
  const fifth = intervals[2] as number;
  const seventh = intervals[3];
  if (seventh === undefined) {
    if (third === 4 && fifth === 7) return "major";
    if (third === 3 && fifth === 7) return "minor";
    if (third === 3 && fifth === 6) return "diminished";
    return "augmented";
  }
  if (third === 4 && fifth === 7) return seventh === 11 ? "major7" : "dominant7";
  if (third === 3 && fifth === 7) return seventh === 11 ? "minorMajor7" : "minor7";
  if (third === 3 && fifth === 6) return seventh === 10 ? "halfDiminished7" : "diminished7";
  return "major7";
}

/** Reads a MIDI file and harmonises whatever melody it holds. */
export async function importMelodyFile(
  file: { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> },
  defaults: GeneratorSettings,
  options: MelodyImportOptions = {},
): Promise<MelodyImportResult> {
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > 4_000_000) {
    throw new MelodyImportError("MIDI file is too large (maximum 4 MB).");
  }
  if (!/\.midi?$/i.test(file.name.trim())) {
    throw new MelodyImportError("Choose a .mid file. The current composition is unchanged.");
  }

  let parsed;
  try {
    parsed = parseMidi(await file.arrayBuffer());
  } catch (error) {
    // The parser's refusals are specific and worth passing through -- "format 2
    // holds independent sequences" tells the user what to do, "import failed"
    // does not.
    throw new MelodyImportError(
      error instanceof MidiParseError ? error.message : "The file could not be read as MIDI.",
    );
  }

  const line = pickMelodyTrack(parsed);
  if (line.length === 0) {
    throw new MelodyImportError("No melody line was found in the file, only percussion or silence.");
  }
  const melody = rescaleTicks(line, parsed.ppq, PPQ);

  return harmoniseInto(melody, defaults, {
    ...options,
    timeSignature: parsed.timeSignature ?? defaults.timeSignature,
    sourceTrackCount: parsed.trackCount,
  });
}

/**
 * Harmonises a melody and returns it as a composition the editor can open.
 *
 * Kept separate from the file reading so the harmonisation can be tested
 * without a file, and so a melody from anywhere else can use the same path.
 */
export function harmoniseInto(
  melody: readonly HarmonizerNote[],
  defaults: GeneratorSettings,
  options: MelodyImportOptions & { timeSignature?: TimeSignature; sourceTrackCount?: number },
): MelodyImportResult {
  if (melody.length === 0) {
    throw new MelodyImportError("The file holds no notes to harmonise.");
  }
  const ppq = PPQ;
  const timeSignature = options.timeSignature ?? defaults.timeSignature;
  const lastTick = Math.max(...melody.map((note) => note.startTick + note.durationTick));
  const bars = barsFor(lastTick, timeSignature, ppq);

  const harmonised = harmonizeMelody(melody, {
    bars,
    timeSignature,
    ppq,
    key: options.key,
    mode: options.mode,
    maxChordsPerBar: options.maxChordsPerBar ?? 1,
  });
  if (!harmonised) {
    throw new MelodyImportError("The melody gave nothing to work out a key from.");
  }

  const settings: GeneratorSettings = {
    ...defaults,
    key: harmonised.key,
    mode: harmonised.mode,
    bars: bars as GeneratorSettings["bars"],
    timeSignature,
    style: options.style ?? defaults.style,
    // No song form: the file's own shape is what it is, and imposing a
    // verse-chorus plan on someone else's melody would be inventing structure.
    songForm: undefined,
  };
  const scaffold = generateComposition(settings);

  let previousNotes: readonly number[] | undefined;
  const chords = harmonised.chords.map((chord, index) => {
    const event = createStepChordEvent({
      step: {
        degree: chord.degree,
        quality: qualityFrom(chord.pitchClasses.length === 0 ? [0, 4, 7] : intervalsOf(chord)),
      },
      key: harmonised.key,
      mode: harmonised.mode,
      startTick: chord.startTick,
      durationTick: chord.durationTick,
      id: `imported-chord-${index}`,
      previousNotes,
      voiceLeadingStrength: 1,
    });
    previousNotes = event.notes;
    return event;
  });

  const notes: NoteEvent[] = melody.map((note, index) => ({
    id: `imported-note-${index}`,
    midi: note.midi,
    noteName: midiToNoteName(note.midi),
    startTick: note.startTick,
    durationTick: note.durationTick,
    velocity: 92,
    barIndex: Math.floor(note.startTick / ticksPerBar(timeSignature, ppq)),
    role: "chordTone",
  }));

  return {
    composition: {
      ...scaffold,
      // An imported piece is not a seeded one: nothing here was generated from
      // a seed, so the id says what it is rather than borrowing the scaffold's.
      id: `imported-${scaffold.id}`,
      chords,
      notes,
      sections: undefined,
      voices: [],
    },
    key: harmonised.key,
    mode: harmonised.mode,
    bars,
    noteCount: melody.length,
    sourceTrackCount: options.sourceTrackCount ?? 1,
    timeSignature,
  };
}

/** The harmoniser reports pitch classes; the chord builder wants intervals. */
function intervalsOf(chord: { root: PitchClassName; pitchClasses: readonly number[] }): number[] {
  const rootClass = chord.pitchClasses[0] as number;
  return chord.pitchClasses.map((pitchClass) => ((pitchClass - rootClass) + 12) % 12)
    .sort((left, right) => left - right);
}
