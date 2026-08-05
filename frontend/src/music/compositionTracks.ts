import type {
  BassRegisterSettings,
  DynamicsSettings,
  CompositionVoiceRole,
  GeneratedComposition,
  NoteEvent,
  TimeSignature,
} from "../types/music";
import { midiToNoteName } from "./scales";
import { metricStrength } from "./time";

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

/** The velocity every chord and bass note was struck with, unconditionally. */
const BASE_CHORD_VELOCITY = 78;

/** Default spread: the weakest position lands about a third below the strongest. */
const DEFAULT_DYNAMICS_DEPTH = 0.35;

/** Where a note sits inside its chord, lowest to highest. */
export type ChordVoicePosition = "bass" | "inner" | "top";

/**
 * How strongly each voice of a chord is struck relative to the others.
 *
 * A keyboard player does not press every key of a chord equally. The outer
 * voices carry the frame -- the bass states the harmony's foundation and the
 * top is the line the ear follows -- while the inner voices fill between them
 * and are played lighter. Weighting them equally is what makes a block chord
 * sound like a button being pressed.
 */
const VOICE_PROMINENCE: Readonly<Record<ChordVoicePosition, number>> = {
  bass: 1,
  inner: 0.55,
  top: 0.95,
};

/**
 * How hard a chord or bass note is struck.
 *
 * Measured before this existed: every note of every chord in every style came
 * out at exactly 78, so the two tracks had no dynamics whatsoever and playback
 * was as even as the sequencer grid it came from.
 *
 * Two things decide it, because one is not enough. The bar carries a weighting
 * -- downbeat strongest, then the half-bar, then beats, then offbeats -- and
 * metricStrength is the same curve the melody generator already phrases
 * against, so the two agree about where the weight falls. But with one chord
 * per bar every chord starts on a downbeat, and metric position alone would
 * change nothing at all on the default path. Position within the chord is what
 * reaches it.
 *
 * depth 0 reproduces the flat literal exactly, which is what makes leaving it
 * off safe.
 */
export function dynamicVelocity(
  tickWithinBar: number,
  timeSignature: TimeSignature,
  position: ChordVoicePosition,
  settings: DynamicsSettings | undefined,
  base: number = BASE_CHORD_VELOCITY,
): number {
  if (!settings?.enabled) return base;
  // Math.min/Math.max pass NaN straight through, so a non-finite depth would
  // reach the multiply and leave the note with a velocity of NaN.
  const requested = settings.depth ?? DEFAULT_DYNAMICS_DEPTH;
  const depth = Number.isFinite(requested)
    ? Math.min(1, Math.max(0, requested))
    : DEFAULT_DYNAMICS_DEPTH;
  const strength = metricStrength(tickWithinBar, timeSignature) * VOICE_PROMINENCE[position];
  const scaled = Math.round(base * (1 - depth * (1 - strength)));
  // MIDI velocity 0 means note-off, so the floor is 1 and not 0.
  return Math.min(127, Math.max(1, scaled));
}

function chordNote(
  composition: GeneratedComposition,
  chordId: string,
  startTick: number,
  durationTick: number,
  midi: number,
  suffix: string,
  position: ChordVoicePosition,
): NoteEvent {
  const barIndex = Math.floor(startTick / composition.ticksPerBar);
  return {
    id: `${chordId}-${suffix}-${midi}`,
    midi,
    noteName: midiToNoteName(midi),
    startTick,
    durationTick,
    velocity: dynamicVelocity(
      startTick - barIndex * composition.ticksPerBar,
      composition.settings.timeSignature,
      position,
      composition.settings.dynamics,
    ),
    barIndex,
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
          "bass",
        ),
      );
    }
    const upper = pitches.slice(1);
    for (const [index, midi] of upper.entries()) {
      chordNotes.push(
        chordNote(
          composition,
          chord.id,
          chord.startTick,
          chord.durationTick,
          midi,
          `right-${index}`,
          index === upper.length - 1 ? "top" : "inner",
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
