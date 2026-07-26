import type {
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
          bass,
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
