import type {
  BassRegisterSettings,
  CompositionVoiceRole,
  GeneratedComposition,
  NoteEvent,
} from "../types/music";
import { midiToNoteName } from "./scales";

export type CompositionTrackRole =
  | "bass"
  | "chords"
  | "melody"
  | CompositionVoiceRole;

export type PianoHand = "left" | "right";

export interface CompositionTrack {
  id: string;
  name: string;
  role: CompositionTrackRole;
  color: string;
  midiChannel: number;
  notes: NoteEvent[];
  editable: boolean;
  muted: boolean;
  hand?: PianoHand;
  sourceVoiceId?: string;
}

function chordNote(
  composition: GeneratedComposition,
  chordId: string,
  startTick: number,
  durationTick: number,
  midi: number,
  suffix: string,
): NoteEvent {
  return {
    id: `${chordId}-${suffix}-${midi}`,
    midi,
    noteName: midiToNoteName(midi),
    startTick,
    durationTick,
    velocity: 78,
    barIndex: Math.floor(startTick / composition.ticksPerBar),
    role: "chordTone",
  };
}

/**
 * DAW-facing view of a composition.
 *
 * Chord symbols remain the canonical harmony data, but their sounding pitches
 * are exposed as two piano tracks: the lowest pitch is the left-hand/bass
 * foundation and the remaining pitches are the right-hand chord. This keeps
 * legacy project files compatible while giving playback, MIDI and the editor a
 * single track vocabulary.
 */
/** Default top of the bass register: C3, the top of a comfortable bass range. */
const DEFAULT_BASS_CEILING = 48;
/** Default bottom: E1, the low E of a five-string bass. */
const DEFAULT_BASS_FLOOR = 28;

/**
 * Drops a sounding pitch into the bass register without changing which note it is.
 *
 * Close-position voicings put their lowest note around D3-F3, so the bass track
 * sings in the tenor range and the mix has nothing under about 147 Hz. Moving by
 * whole octaves keeps the pitch class, and therefore the inversion the voicing
 * chose: an inverted chord still sounds its third or fifth in the bass, an
 * octave or two lower.
 *
 * Stops before crossing the floor, so a pitch that cannot reach the register
 * without going under it stays where the last whole octave left it.
 */
export function bassRegisterPitch(
  midi: number,
  settings: BassRegisterSettings | undefined,
): number {
  if (!settings?.enabled) return midi;
  const ceiling = settings.ceiling ?? DEFAULT_BASS_CEILING;
  const floor = settings.floor ?? DEFAULT_BASS_FLOOR;
  let pitch = midi;
  while (pitch > ceiling && pitch - 12 >= floor) {
    pitch -= 12;
  }
  return pitch;
}

export function buildCompositionTracks(
  composition: GeneratedComposition,
): CompositionTrack[] {
  const bassNotes: NoteEvent[] = [];
  const chordNotes: NoteEvent[] = [];
  for (const chord of composition.chords) {
    const pitches = [...chord.notes].sort((left, right) => left - right);
    const bass = pitches[0];
    if (bass !== undefined) {
      bassNotes.push(
        chordNote(
          composition,
          chord.id,
          chord.startTick,
          chord.durationTick,
          bassRegisterPitch(bass, composition.settings.bassRegister),
          "left",
        ),
      );
    }
    for (const [index, midi] of pitches.slice(1).entries()) {
      chordNotes.push(
        chordNote(
          composition,
          chord.id,
          chord.startTick,
          chord.durationTick,
          midi,
          `right-${index}`,
        ),
      );
    }
  }

  return [
    {
      id: "track-bass",
      name: "Bass / Left Hand",
      role: "bass",
      color: "#d88745",
      midiChannel: 0,
      notes: bassNotes,
      editable: false,
      muted: false,
      hand: "left",
    },
    {
      id: "track-chords",
      name: "Chords / Right Hand",
      role: "chords",
      color: "#6f78d8",
      midiChannel: 1,
      notes: chordNotes,
      editable: false,
      muted: false,
      hand: "right",
    },
    {
      id: "track-melody",
      name: "Melody",
      role: "melody",
      color: "#356ae6",
      midiChannel: 2,
      notes: composition.notes.map((note) => ({ ...note })),
      editable: true,
      muted: false,
      hand: "right",
    },
    ...(composition.voices ?? []).map((voice): CompositionTrack => ({
      id: `track-${voice.id}`,
      name: voice.name,
      role: voice.role,
      color: voice.color,
      midiChannel: Math.min(15, voice.midiChannel + 1),
      notes: voice.notes.map((note) => ({ ...note })),
      editable: false,
      muted: voice.muted ?? false,
      sourceVoiceId: voice.id,
    })),
  ];
}
