import type { TimeSignature } from "../types/music";

/**
 * How the right hand plays the chord it has been given.
 *
 * The voicer decides which notes; this decides when they are struck. Until now
 * there were exactly two answers -- one block chord held for the chord's whole
 * length, or an arpeggio running up and down at a fixed rate -- and a keyboard
 * player uses neither for a whole piece. Measured across eight styles at
 * sixteen bars, every chord in every style was struck once, on its own
 * downbeat, and held: 240 chords, 240 onsets, one rhythm.
 *
 * These are comping patterns, written where they are conventionally written:
 * in beats from the start of the bar. Every one is a figure with a name that a
 * player would recognise, rather than a rhythm invented to look varied.
 *
 * Everything here is pure. Choosing a pattern, and whether to use one at all,
 * belongs to the caller.
 */

export type ChordRhythmId =
  | "block"
  | "halves"
  | "pulse"
  | "offbeat"
  | "charleston"
  | "anticipation"
  | "bossa"
  | "waltz"
  | "alberti"
  | "gallop";

/**
 * Which of the chord's notes a strike sounds.
 *
 * Named rather than indexed, because a pattern has to work on a three-note
 * voicing and a six-note one. "upper" and "lower" split the hand at its
 * midpoint, which is what a player does when they alternate.
 */
export type StrikeVoices = "all" | "upper" | "lower" | "top" | "bottom";

export interface RhythmStrike {
  /** Onset in beats from the start of the bar. Fractions are subdivisions. */
  at: number;
  /** How long it is held, in beats, before the clip to the chord's end. */
  hold: number;
  voices: StrikeVoices;
  /**
   * How hard, relative to the chord's own velocity. A comping figure that
   * strikes everything equally reads as a machine; the syncopated notes of
   * these patterns are the ones a player leans on.
   */
  accent?: number;
}

export interface ChordRhythm {
  id: ChordRhythmId;
  /** What a player would call it, for the interface. */
  label: string;
  /** Meters the figure is written for. A pattern is never adapted to a meter it was not. */
  meters: readonly TimeSignature[];
  /** One bar of the figure. */
  bar: readonly RhythmStrike[];
}

/**
 * The catalogue.
 *
 * Each is one bar. Patterns are tiled across a chord that lasts longer than a
 * bar and truncated where a chord is shorter, so a figure means the same thing
 * whatever the harmonic rhythm does.
 */
export const CHORD_RHYTHMS: readonly ChordRhythm[] = [
  {
    id: "block",
    label: "ブロック",
    meters: ["4/4", "3/4", "6/8"],
    // What every chord did before this file existed, kept as a named choice so
    // it can be asked for rather than only fallen back to.
    bar: [{ at: 0, hold: 4, voices: "all" }],
  },
  {
    id: "halves",
    label: "2分音符",
    meters: ["4/4"],
    bar: [
      { at: 0, hold: 2, voices: "all" },
      { at: 2, hold: 2, voices: "all", accent: 0.88 },
    ],
  },
  {
    id: "pulse",
    label: "4分打ち",
    meters: ["4/4", "3/4"],
    // Every beat, with the backbeat leaned on -- the difference between a pulse
    // and a metronome.
    bar: [
      { at: 0, hold: 1, voices: "all" },
      { at: 1, hold: 1, voices: "all", accent: 1.06 },
      { at: 2, hold: 1, voices: "all", accent: 0.9 },
      { at: 3, hold: 1, voices: "all", accent: 1.06 },
    ],
  },
  {
    id: "offbeat",
    label: "裏打ち",
    meters: ["4/4"],
    // The skank: nothing on the downbeat, the chord answering the bass on every
    // upbeat. Short by definition -- a held offbeat chord is not an offbeat.
    bar: [
      { at: 0.5, hold: 0.45, voices: "all", accent: 1.04 },
      { at: 1.5, hold: 0.45, voices: "all" },
      { at: 2.5, hold: 0.45, voices: "all", accent: 1.04 },
      { at: 3.5, hold: 0.45, voices: "all" },
    ],
  },
  {
    id: "charleston",
    label: "チャールストン",
    meters: ["4/4"],
    // The comping cell: the downbeat, then the and of two. Two strikes a bar is
    // most of what jazz piano does behind a soloist, and the syncopation is the
    // whole figure, so the second strike is the accented one.
    bar: [
      { at: 0, hold: 1.5, voices: "all" },
      { at: 1.5, hold: 2.5, voices: "all", accent: 1.08 },
    ],
  },
  {
    id: "anticipation",
    label: "食い込み",
    meters: ["4/4"],
    // The push: the chord arrives an eighth early and the downbeat is left
    // empty, which is why the bar reads as leaning forward.
    bar: [
      { at: 0, hold: 1.5, voices: "all" },
      { at: 1.5, hold: 1, voices: "upper" },
      { at: 3.5, hold: 1.5, voices: "all", accent: 1.1 },
    ],
  },
  {
    id: "bossa",
    label: "ボサノヴァ",
    meters: ["4/4"],
    // The one-bar comping cell. Dotted quarter, dotted quarter, quarter -- the
    // 3+3+2 that makes the figure sound like it is crossing the bar without
    // actually doing so.
    bar: [
      { at: 0, hold: 1.5, voices: "all" },
      { at: 1.5, hold: 1.5, voices: "all", accent: 0.94 },
      { at: 3, hold: 1, voices: "all", accent: 1.04 },
    ],
  },
  {
    id: "waltz",
    label: "ワルツ",
    meters: ["3/4"],
    // The one figure here that is genuinely a meter rather than a style: the
    // downbeat belongs to the bass, and the chord answers on two and three.
    bar: [
      { at: 1, hold: 1, voices: "all" },
      { at: 2, hold: 1, voices: "all", accent: 0.92 },
    ],
  },
  {
    id: "alberti",
    label: "アルベルティ",
    meters: ["4/4", "3/4"],
    // Low, high, middle, high. The classical accompaniment figure, and the one
    // pattern here that needs the voicing to have a middle at all -- with three
    // notes it degenerates to the same alternation, which is what it does on a
    // triad anyway.
    bar: [
      { at: 0, hold: 0.5, voices: "bottom" },
      { at: 0.5, hold: 0.5, voices: "top" },
      { at: 1, hold: 0.5, voices: "upper" },
      { at: 1.5, hold: 0.5, voices: "top" },
      { at: 2, hold: 0.5, voices: "bottom" },
      { at: 2.5, hold: 0.5, voices: "top" },
      { at: 3, hold: 0.5, voices: "upper" },
      { at: 3.5, hold: 0.5, voices: "top" },
    ],
  },
  {
    id: "gallop",
    label: "ギャロップ",
    meters: ["4/4"],
    // Eighth, two sixteenths, repeated. Driving rather than busy: the chord
    // lands on every beat and the sixteenths push it forward.
    bar: [
      { at: 0, hold: 0.5, voices: "all", accent: 1.06 },
      { at: 0.5, hold: 0.25, voices: "upper" },
      { at: 0.75, hold: 0.25, voices: "upper" },
      { at: 1, hold: 0.5, voices: "all" },
      { at: 1.5, hold: 0.25, voices: "upper" },
      { at: 1.75, hold: 0.25, voices: "upper" },
      { at: 2, hold: 0.5, voices: "all", accent: 1.06 },
      { at: 2.5, hold: 0.25, voices: "upper" },
      { at: 2.75, hold: 0.25, voices: "upper" },
      { at: 3, hold: 0.5, voices: "all" },
      { at: 3.5, hold: 0.25, voices: "upper" },
      { at: 3.75, hold: 0.25, voices: "upper" },
    ],
  },
];

export function chordRhythmById(id: string): ChordRhythm | undefined {
  return CHORD_RHYTHMS.find((entry) => entry.id === id);
}

/** The figures that fit a meter, in catalogue order so a pick is deterministic. */
export function rhythmsForMeter(timeSignature: TimeSignature): ChordRhythm[] {
  return CHORD_RHYTHMS.filter((entry) => entry.meters.includes(timeSignature));
}

/**
 * Which notes a strike sounds.
 *
 * The split is by count rather than by pitch, so a five-note voicing divides
 * three and two rather than by wherever its widest gap happens to be -- a hand
 * alternating between halves of a chord is alternating between halves of a
 * hand.
 */
export function voicesFor(pitches: readonly number[], which: StrikeVoices): number[] {
  if (pitches.length === 0) return [];
  const sorted = [...pitches].sort((left, right) => left - right);
  switch (which) {
    case "all": return sorted;
    case "top": return [sorted[sorted.length - 1] as number];
    case "bottom": return [sorted[0] as number];
    case "upper": return sorted.slice(Math.floor(sorted.length / 2));
    case "lower": return sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
  }
}

export interface RhythmNote {
  midi: number;
  startTick: number;
  durationTick: number;
  /** Multiplier on the chord's velocity, so the caller keeps its own dynamics. */
  accent: number;
}

export interface ApplyRhythmOptions {
  ticksPerBeat: number;
  beatsPerBar: number;
  /**
   * Held to the chord's end rather than to the figure's own length.
   *
   * The same argument as the arpeggio's sustain: under a pedal the strikes
   * accumulate. Off by default, because a comping figure's rests are the figure.
   */
  sustain?: boolean;
}

/**
 * Plays one chord as a rhythmic figure.
 *
 * Returns the notes in the order they are struck, so a caller writing them out
 * does not have to sort. A chord shorter than the pattern takes the head of it,
 * and a chord longer repeats it -- the figure is a property of the bar rather
 * than of the chord, so a chord spanning two bars is played twice and one
 * lasting half a bar gets half the figure.
 */
export function applyChordRhythm(
  pitches: readonly number[],
  startTick: number,
  durationTick: number,
  rhythm: ChordRhythm,
  options: ApplyRhythmOptions,
): RhythmNote[] {
  const { ticksPerBeat, beatsPerBar } = options;
  if (pitches.length === 0 || durationTick <= 0) return [];
  if (!Number.isFinite(ticksPerBeat) || ticksPerBeat <= 0) return [];

  const barTicks = ticksPerBeat * beatsPerBar;
  const end = startTick + durationTick;
  const notes: RhythmNote[] = [];

  for (let barStart = startTick; barStart < end; barStart += barTicks) {
    for (const strike of rhythm.bar) {
      const onset = barStart + Math.round(strike.at * ticksPerBeat);
      // A strike whose onset falls outside the chord belongs to the next chord,
      // not to this one played early or late.
      if (onset < startTick || onset >= end) continue;
      const until = options.sustain
        ? end
        : Math.min(end, onset + Math.round(strike.hold * ticksPerBeat));
      const held = Math.max(1, until - onset);
      for (const midi of voicesFor(pitches, strike.voices)) {
        notes.push({ midi, startTick: onset, durationTick: held, accent: strike.accent ?? 1 });
      }
    }
  }

  // Ordered by onset then pitch, so the output is stable and a caller can write
  // it out directly.
  notes.sort((left, right) => left.startTick - right.startTick || left.midi - right.midi);
  return notes;
}

/**
 * What each style reaches for first.
 *
 * A default rather than a restriction: any pattern the meter allows can be
 * named. These are the figure a player would start with for the idiom, and the
 * order matters -- the first entry the meter permits is the one used, so a
 * style whose first choice is a 4/4 figure falls through to something written
 * for the meter rather than being forced into it.
 */
export const STYLE_RHYTHMS: Readonly<Record<string, readonly ChordRhythmId[]>> = {
  pop: ["halves", "pulse", "block"],
  "j-pop": ["anticipation", "halves", "block"],
  rock: ["pulse", "gallop", "block"],
  jazz: ["charleston", "halves", "block"],
  "lo-fi": ["halves", "block"],
  edm: ["offbeat", "pulse", "block"],
  ballad: ["alberti", "halves", "block"],
  "game-music": ["gallop", "pulse", "block"],
};

/**
 * The figure a chord is played with.
 *
 * Named explicitly if the caller asked for one and the meter allows it;
 * otherwise the style's first choice that the meter allows; otherwise a block
 * chord, which every meter allows. Never returns undefined, so the caller has
 * no branch to forget.
 */
export function rhythmFor(
  style: string,
  timeSignature: TimeSignature,
  requested?: string,
): ChordRhythm {
  const allowed = rhythmsForMeter(timeSignature);
  if (requested) {
    const named = allowed.find((entry) => entry.id === requested);
    if (named) return named;
  }
  for (const id of STYLE_RHYTHMS[style] ?? []) {
    const found = allowed.find((entry) => entry.id === id);
    if (found) return found;
  }
  return allowed.find((entry) => entry.id === "block") ?? (CHORD_RHYTHMS[0] as ChordRhythm);
}
