import { PPQ, type ChordEvent, type NoteEvent, type TimeSignature } from "../types/music";
import { createSeededRandom, deriveSeed, hashSeed, type Seed } from "./random";
import { midiToNoteName } from "./scales";
import { ticksPerBar } from "./time";

/**
 * Counterpoint: a second voice against the first.
 *
 * Everything the engine wrote was one line over chords. A countermelody is not
 * that — it is a line that has to be good on its own terms *and* good against
 * the one already there, and the second condition is what makes it hard. Two
 * lines that both move up by the same interval are not two lines; the ear fuses
 * them into one thickened voice, which is exactly what parallel fifths and
 * octaves do and why counterpoint has always forbidden them.
 *
 * So a candidate here is judged on the vertical interval it forms, on how it
 * moves relative to the melody, and on whether it is singable by itself.
 *
 * A note on scope: these produce note arrays and nothing plays them yet. The
 * composition carries one voice, and making a second audible means multi-voice
 * support in playback, MIDI export, the piano roll and the project schema —
 * a change of a different kind from writing the notes.
 */

/** Intervals that count as consonant, in semitones from the bass of the pair. */
const CONSONANT = new Set([0, 3, 4, 7, 8, 9, 12]);
/** The perfect intervals, which two voices may not move into in parallel. */
const PERFECT = new Set([0, 7]);

export type MotionType = "parallel" | "similar" | "contrary" | "oblique";

/** How two voices moved between one pair of notes and the next. */
export function motionBetween(
  previousLower: number,
  previousUpper: number,
  lower: number,
  upper: number,
): MotionType {
  const lowerDelta = lower - previousLower;
  const upperDelta = upper - previousUpper;
  if (lowerDelta === 0 || upperDelta === 0) return "oblique";
  if (Math.sign(lowerDelta) !== Math.sign(upperDelta)) return "contrary";
  return lowerDelta === upperDelta ? "parallel" : "similar";
}

export interface CountermelodySettings {
  /** Off produces nothing. */
  enabled: boolean;
  /** Which side of the melody the second voice sits on. Defaults to "below". */
  position?: "above" | "below";
  /**
   * 0..1. How much the second voice moves on its own rather than with the
   * melody. Defaults to 0.5.
   */
  independence?: number;
}

export interface CountermelodyOptions {
  melody: readonly NoteEvent[];
  chords: readonly ChordEvent[];
  /** Pitches available in a bar, sorted. */
  scaleForBar: (barIndex: number) => readonly number[];
  /** Range the second voice is written in, inclusive. */
  range: readonly [number, number];
  settings?: CountermelodySettings;
  seed: Seed;
}

function chordAt(chords: readonly ChordEvent[], tick: number): ChordEvent | undefined {
  return chords.find(
    (chord) => tick >= chord.startTick && tick < chord.startTick + chord.durationTick,
  );
}

function isChordTone(midi: number, chord: ChordEvent | undefined): boolean {
  if (!chord) return false;
  return chord.notes.some((note) => ((note % 12) + 12) % 12 === ((midi % 12) + 12) % 12);
}

/**
 * Writes a second voice against a melody.
 *
 * One note per melody note, so the two lines share a rhythm and the vertical
 * intervals are unambiguous. That is first species, and it is the right place to
 * start: the rules about what may sound together are the ones being enforced,
 * and giving the second voice its own rhythm first would hide whether they work.
 */
export function generateCountermelody(
  options: CountermelodyOptions,
): NoteEvent[] {
  const settings = options.settings;
  if (!settings?.enabled || options.melody.length === 0) return [];
  const below = (settings.position ?? "below") !== "above";
  const independence = Math.min(1, Math.max(0, settings.independence ?? 0.5));
  const [low, high] = options.range;

  const result: NoteEvent[] = [];
  let previousOwn: number | null = null;
  let previousMelody: number | null = null;

  for (const [index, note] of options.melody.entries()) {
    const chord = chordAt(options.chords, note.startTick);
    const scale = options.scaleForBar(note.barIndex);
    const inRange = scale.filter((midi) => midi >= low && midi <= high);
    if (inRange.length === 0) continue;
    // The voice stays on its own side of the melody. Crossing would swap which
    // line the ear is following, which is the one thing a second voice must not
    // do to the first.
    const onSide = inRange.filter((midi) => (below ? midi < note.midi : midi > note.midi));
    // Where the range does not reach past the melody there is no such pitch, and
    // the nearest one is used instead. Dropping the note would be worse: the two
    // lines are paired by position, so a gap in one silently misaligns every
    // comparison after it, and the crossing is reported honestly either way.
    const candidates = onSide.length > 0
      ? onSide
      : [below ? (inRange[0] as number) : (inRange[inRange.length - 1] as number)];

    const random = createSeededRandom(deriveSeed(options.seed, "counter", index));
    const weights = candidates.map((midi) => {
      const lower = below ? midi : note.midi;
      const upper = below ? note.midi : midi;
      const interval = (upper - lower) % 12;
      let weight = CONSONANT.has(interval) ? 4 : 0.35;
      // Thirds and sixths are the intervals a second voice lives on: consonant
      // without being so stable that the two lines stop sounding separate.
      if (interval === 3 || interval === 4 || interval === 8 || interval === 9) weight *= 2;
      if (isChordTone(midi, chord)) weight *= 2.5;

      if (previousOwn !== null && previousMelody !== null) {
        const motion = motionBetween(
          below ? previousOwn : previousMelody,
          below ? previousMelody : previousOwn,
          lower,
          upper,
        );
        // Contrary motion is what keeps two lines audibly separate, and the
        // setting is how much of it to insist on.
        if (motion === "contrary") weight *= 1 + 2.5 * independence;
        if (motion === "oblique") weight *= 1 + 0.8 * independence;
        if (motion === "similar") weight *= 1 - 0.3 * independence;
        // Moving in parallel into a perfect interval fuses the voices; that is
        // the prohibition counterpoint has always had, and the reason for it.
        if (motion === "parallel" && PERFECT.has(interval)) weight *= 0.02;
        if (motion === "parallel") weight *= 0.3;

        const step = Math.abs(midi - previousOwn);
        if (step === 0) weight *= 0.5;
        else if (step <= 2) weight *= 3;
        else if (step <= 4) weight *= 1.6;
        else if (step > 7) weight *= 0.15;
      } else {
        // Start near the middle of the range, so the line has room either way.
        weight *= 1 / (1 + Math.abs(midi - (low + high) / 2) * 0.08);
      }
      return Math.max(weight, 0.0001);
    });

    const midi = random.weightedPick(candidates, weights);
    const idHash = hashSeed(
      deriveSeed(options.seed, "counter-note", note.startTick, midi),
    ).toString(36);
    result.push({
      id: `counter-${note.barIndex}-${note.startTick}-${idHash}`,
      midi,
      noteName: midiToNoteName(midi),
      startTick: note.startTick,
      durationTick: note.durationTick,
      velocity: Math.max(1, Math.round(note.velocity * 0.85)),
      barIndex: note.barIndex,
      role: isChordTone(midi, chord) ? "chordTone" : "scaleTone",
    });
    previousOwn = midi;
    previousMelody = note.midi;
  }

  return result;
}

export interface CounterpointIssue {
  type: "parallelFifth" | "parallelOctave" | "voiceCrossing" | "dissonance";
  index: number;
  interval: number;
}

/**
 * Faults in a pair of lines.
 *
 * Reported rather than thrown: a countermelody with one similar-motion fifth in
 * it is not invalid, it is worse than one without, and the caller is better
 * placed to decide which matters.
 */
export function findCounterpointIssues(
  lower: readonly NoteEvent[],
  upper: readonly NoteEvent[],
): CounterpointIssue[] {
  const issues: CounterpointIssue[] = [];
  const length = Math.min(lower.length, upper.length);
  for (let index = 0; index < length; index += 1) {
    const bass = lower[index] as NoteEvent;
    const top = upper[index] as NoteEvent;
    const interval = top.midi - bass.midi;
    if (interval < 0) {
      issues.push({ type: "voiceCrossing", index, interval });
      continue;
    }
    if (!CONSONANT.has(interval % 12)) {
      issues.push({ type: "dissonance", index, interval });
    }
    if (index === 0) continue;
    const previousBass = lower[index - 1] as NoteEvent;
    const previousTop = upper[index - 1] as NoteEvent;
    const motion = motionBetween(previousBass.midi, previousTop.midi, bass.midi, top.midi);
    if (motion !== "parallel") continue;
    if (interval % 12 === 7) issues.push({ type: "parallelFifth", index, interval });
    if (interval % 12 === 0) issues.push({ type: "parallelOctave", index, interval });
  }
  return issues;
}

export interface CanonSettings {
  /** Off produces nothing. */
  enabled: boolean;
  /** How far behind the melody the imitation enters, in beats. */
  delayBeats: number;
  /** Semitones the imitation is transposed by. 0 is at the unison. */
  interval?: number;
  /** Turns every interval of the melody upside down. */
  inverted?: boolean;
}

export interface CanonOptions {
  melody: readonly NoteEvent[];
  settings?: CanonSettings;
  timeSignature: TimeSignature;
  /** Total bars of the piece; the imitation is cut off at the end. */
  bars: number;
  /** Range the imitation is written in, inclusive. */
  range: readonly [number, number];
  ppq?: number;
}

/**
 * The melody again, entering later and somewhere else.
 *
 * A canon is the strictest counterpoint there is: the second voice is not
 * chosen, it is the first voice displaced, and whether the result works is
 * decided entirely by the melody and the delay. Nothing here searches, because
 * there is nothing to search — that is what makes it a canon.
 *
 * Notes that fall past the end of the piece are dropped rather than wrapped. An
 * imitation that ran on after the music stopped would not be a canon, and one
 * folded back to the start would be a different piece.
 */
export function generateCanon(options: CanonOptions): NoteEvent[] {
  const settings = options.settings;
  if (!settings?.enabled || options.melody.length === 0) return [];
  const ppq = options.ppq ?? PPQ;
  const barTicks = ticksPerBar(options.timeSignature, ppq);
  const totalTicks = barTicks * options.bars;
  const delay = Math.round(settings.delayBeats * ppq);
  const interval = Math.trunc(settings.interval ?? 0);
  const [low, high] = options.range;

  const first = options.melody[0] as NoteEvent;
  const result: NoteEvent[] = [];
  for (const note of options.melody) {
    const startTick = note.startTick + delay;
    if (startTick >= totalTicks) continue;
    // An inversion mirrors each note around the line's first pitch, so the
    // imitation moves down wherever the melody moved up.
    const base = settings.inverted ? 2 * first.midi - note.midi : note.midi;
    let midi = base + interval;
    // Octave-shift into range rather than clamping: clamping would flatten the
    // contour, and the contour is the only thing a canon has.
    while (midi < low) midi += 12;
    while (midi > high) midi -= 12;
    if (midi < low || midi > high) continue;

    const durationTick = Math.min(note.durationTick, totalTicks - startTick);
    if (durationTick <= 0) continue;
    const barIndex = Math.floor(startTick / barTicks);
    // Keep every note inside the bar it now belongs to, as the rest of the app
    // requires of any note it is handed.
    const barEnd = (barIndex + 1) * barTicks;
    const clipped = Math.min(durationTick, barEnd - startTick);
    if (clipped <= 0) continue;

    const idHash = hashSeed(`canon-${startTick}-${midi}`).toString(36);
    result.push({
      id: `canon-${barIndex}-${startTick}-${idHash}`,
      midi,
      noteName: midiToNoteName(midi),
      startTick,
      durationTick: clipped,
      velocity: Math.max(1, Math.round(note.velocity * 0.8)),
      barIndex,
      role: note.role,
    });
  }
  return result;
}
