import type {
  ArpeggioSettings,
  SectionKind,
  BassRegisterSettings,
  DynamicsSettings,
  CompositionVoiceRole,
  GeneratedComposition,
  NoteEvent,
  TimeSignature,
} from "../types/music";
import { applyChordRhythm, rhythmFor } from "./chordRhythms";
import { midiToNoteName } from "./scales";
import { metricStrength, ticksPerBeat } from "./time";

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
  /** A comping figure's own accent, on top of the metric and voice dynamics. */
  accent = 1,
): NoteEvent {
  const barIndex = Math.floor(startTick / composition.ticksPerBar);
  return {
    id: `${chordId}-${suffix}-${midi}`,
    midi,
    noteName: midiToNoteName(midi),
    startTick,
    durationTick,
    velocity: Math.min(127, Math.max(1, Math.round(dynamicVelocity(
      startTick - barIndex * composition.ticksPerBar,
      composition.settings.timeSignature,
      position,
      composition.settings.dynamics,
    ) * accent))),
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

/** Default step: eighth notes. */
const DEFAULT_ARPEGGIO_RATE = 2;

/** Default hold: most of the step, leaving a little separation. */
const DEFAULT_ARPEGGIO_GATE = 0.9;

/**
 * The order the voicing's pitches are visited.
 *
 * "upDown" turns without repeating either end, so a four-note voicing gives a
 * six-step cycle rather than eight with the top and bottom struck twice.
 */
function arpeggioOrder(
  pitches: readonly number[],
  pattern: NonNullable<ArpeggioSettings["pattern"]>,
): number[] {
  if (pattern === "down") return [...pitches].reverse();
  if (pattern === "upDown") {
    if (pitches.length < 3) return [...pitches];
    return [...pitches, ...[...pitches].slice(1, -1).reverse()];
  }
  return [...pitches];
}

/**
 * Spreads one chord's pitches across its own duration.
 *
 * Every chord sounded all of its notes at once for its full length. That is a
 * texture, not the texture, and using it for every chord of every piece is a
 * large part of why playback sounds like a chord chart rather than a
 * performance.
 *
 * The steps tile the chord exactly: the remainder goes to the earliest steps,
 * so the figure stays in time and the last note ends where the chord ends
 * rather than drifting. A chord too short to hold even one whole step is left
 * as a block, because an arpeggio nobody can hear is just a quieter chord.
 */
export function arpeggiateChord(
  pitches: readonly number[],
  startTick: number,
  durationTick: number,
  ticksPerStep: number,
  settings: ArpeggioSettings | undefined,
): { midi: number; startTick: number; durationTick: number }[] {
  const block = pitches.map((midi) => ({ midi, startTick, durationTick }));
  if (!settings?.enabled || pitches.length === 0) return block;
  if (!Number.isFinite(ticksPerStep) || ticksPerStep < 1) return block;

  const steps = Math.floor(durationTick / ticksPerStep);
  if (steps < 2) return block;

  const requested = settings.gate ?? DEFAULT_ARPEGGIO_GATE;
  const gate = Number.isFinite(requested)
    ? Math.min(1, Math.max(0.05, requested))
    : DEFAULT_ARPEGGIO_GATE;
  const order = arpeggioOrder(pitches, settings.pattern ?? "up");

  // Integer ticks, and the chord's length is not always a whole number of
  // steps, so the leftover is handed to the earliest steps one tick at a time.
  const base = Math.floor(durationTick / steps);
  let remainder = durationTick - base * steps;

  const notes: { midi: number; startTick: number; durationTick: number }[] = [];
  let tick = startTick;
  for (let step = 0; step < steps; step += 1) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    const span = base + extra;
    notes.push({
      midi: order[step % order.length] as number,
      startTick: tick,
      durationTick: Math.max(1, Math.round(span * gate)),
    });
    tick += span;
  }

  // Under a pedal each note keeps sounding, so the figure accumulates into the
  // chord instead of replacing it. Held to the chord's end, or to the next
  // strike of the same pitch -- a pattern that returns to a note re-articulates
  // it, and two copies of one pitch overlapping is a stuck note rather than a
  // thicker chord.
  if (settings.sustain) {
    const end = startTick + durationTick;
    for (const [index, note] of notes.entries()) {
      let until = end;
      for (let later = index + 1; later < notes.length; later += 1) {
        if (notes[later]?.midi === note.midi) {
          until = notes[later]?.startTick as number;
          break;
        }
      }
      note.durationTick = Math.max(note.durationTick, until - note.startTick);
    }
  }
  return notes;
}

export function buildCompositionTracks(
  composition: GeneratedComposition,
): CompositionTrack[] {
  const bassNotes: NoteEvent[] = [];
  const chordNotes: NoteEvent[] = [];
  const arpeggioRate = composition.settings.arpeggio?.rate ?? DEFAULT_ARPEGGIO_RATE;
  const beatTicks = ticksPerBeat(composition.settings.timeSignature, composition.ppq);
  const ticksPerStep = beatTicks
    / (Number.isFinite(arpeggioRate) && arpeggioRate > 0 ? arpeggioRate : DEFAULT_ARPEGGIO_RATE);
  const rhythm = composition.settings.chordRhythm?.enabled
    ? rhythmFor(
      composition.resolvedStyle,
      composition.settings.timeSignature,
      composition.settings.chordRhythm.pattern,
    )
    : null;
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
    const top = upper[upper.length - 1];
    // The bass is deliberately left sustained under the figure: a bass line
    // that arpeggiates along with the right hand leaves the harmony with no
    // foundation at all.
    //
    // A comping figure and an arpeggio are two answers to the same question --
    // when is this chord struck -- so only one of them plays. The rhythm wins
    // where both are asked for, because it is the more specific request: an
    // arpeggio is a rate and a direction, a rhythm is a figure with a name.
    const figure = rhythm
      ? applyChordRhythm(upper, chord.startTick, chord.durationTick, rhythm, {
        ticksPerBeat: beatTicks,
        beatsPerBar: composition.ticksPerBar / beatTicks,
        sustain: composition.settings.chordRhythm?.sustain,
      })
      : arpeggiateChord(
        upper,
        chord.startTick,
        chord.durationTick,
        ticksPerStep,
        composition.settings.arpeggio,
      ).map((note) => ({ ...note, accent: 1 }));
    for (const [index, note] of figure.entries()) {
      chordNotes.push(
        chordNote(
          composition,
          chord.id,
          note.startTick,
          note.durationTick,
          note.midi,
          `right-${index}`,
          note.midi === top ? "top" : "inner",
          note.accent,
        ),
      );
    }
  }

  const tracks: CompositionTrack[] = [
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

  return applySectionArc(tracks, composition);
}

/**
 * How loudly each kind of section is played.
 *
 * Dynamics until now worked at two scales: where a note sits in its bar, and
 * where a voice sits in its chord. Both are inside one chord. Neither makes a
 * piece go anywhere, and measured, nothing did: across eight styles the
 * loudest quarter of a sixteen-bar piece averaged 0.8 velocity above the
 * quietest, and a chorus was struck no harder than the intro before it.
 *
 * A chorus is louder than the verse that set it up. That is most of what
 * "arrival" is, and no amount of voicing supplies it.
 */
const SECTION_INTENSITY: Readonly<Record<SectionKind, number>> = {
  intro: 0.72,
  verse: 0.85,
  // The point of a pre-chorus is that it is on the way somewhere.
  preChorus: 0.94,
  chorus: 1.06,
  // A bridge contrasts rather than climbs; it is the one section that gets
  // quieter than the verse before it.
  bridge: 0.8,
  // Quieter than anything else in the piece, including the intro. A 落ちサビ is
  // the sabi with the band gone, and if it is merely a little softer than the
  // chorus it reads as a chorus played badly rather than as a drop.
  quietChorus: 0.6,
  // And the 大サビ above the choruses it follows, because it is the one they
  // were leading to.
  finalChorus: 1.16,
  outro: 0.74,
};

/**
 * Scales every track by the section its notes fall in.
 *
 * A rendering decision, like the register and the figure: the composition's own
 * velocities are untouched, so the same seed still describes the same piece and
 * only the performance of it changes.
 */
function applySectionArc(
  tracks: readonly CompositionTrack[],
  composition: GeneratedComposition,
): CompositionTrack[] {
  const sections = composition.sections;
  if (!sections || sections.length === 0 || !composition.settings.dynamics?.enabled) {
    return [...tracks];
  }
  const barTicks = composition.ticksPerBar;
  const intensityAt = (startTick: number): number => {
    const bar = Math.floor(startTick / barTicks);
    const section = sections.find((entry) => bar >= entry.startBar && bar < entry.endBar);
    return section ? SECTION_INTENSITY[section.kind] : 1;
  };

  return tracks.map((track) => ({
    ...track,
    notes: track.notes.map((note) => ({
      ...note,
      // MIDI velocity 0 is note-off, so the floor is 1 rather than 0.
      velocity: Math.min(127, Math.max(1, Math.round(note.velocity * intensityAt(note.startTick)))),
    })),
  }));
}
