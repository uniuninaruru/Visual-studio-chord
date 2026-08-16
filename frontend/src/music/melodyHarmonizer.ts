import type { Mode, PitchClassName, TimeSignature } from "../types/music";
import {
  getScalePitchClasses,
  getScaleSemitones,
  pitchClassToSemitone,
  semitoneToPitchClass,
} from "./scales";
import { metricStrength, ticksPerBar } from "./time";
import { PROGRESSION_TEMPLATES } from "./progressions";

/**
 * Chords from a melody.
 *
 * The reverse of everything else in this app: instead of writing a tune over a
 * progression, this reads a tune and works out what could be underneath it.
 *
 * Three steps, each of which can be checked on its own. Find the key from the
 * distribution of pitch, decide where the chords change, then choose the
 * sequence of chords -- not chord by chord, because the best chord for one bar
 * can strand the next bar with nothing good to follow it, which is the same
 * reason the voicer searches whole progressions rather than single chords.
 */

export interface HarmonizerNote {
  midi: number;
  startTick: number;
  durationTick: number;
}

/**
 * Krumhansl and Schmuckler's key profiles.
 *
 * Each entry is how strongly that scale degree is associated with the key, from
 * the probe-tone experiments: listeners hear a context and rate how well each
 * chromatic pitch completes it. The tonic scores highest, then the fifth, then
 * the third -- so a melody's duration-weighted pitch histogram, correlated
 * against these, names the key.
 *
 * These are published measurements, reproduced as data. The algorithm below --
 * correlate the histogram against all twenty-four rotations and take the best
 * -- is written from the method's description.
 */
const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
] as const;

const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
] as const;

/** Pearson correlation, which is what the method calls for rather than a dot product. */
function correlate(left: readonly number[], right: readonly number[]): number {
  const n = left.length;
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / n;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let index = 0; index < n; index += 1) {
    const dl = (left[index] as number) - meanLeft;
    const dr = (right[index] as number) - meanRight;
    numerator += dl * dr;
    leftSquares += dl * dl;
    rightSquares += dr * dr;
  }
  const denominator = Math.sqrt(leftSquares * rightSquares);
  // A melody on a single pitch has no variance to correlate against; saying so
  // is more honest than returning a key with a confidence of zero.
  return denominator === 0 ? 0 : numerator / denominator;
}

export interface KeyEstimate {
  key: PitchClassName;
  mode: Mode;
  /** The winning correlation, and how far ahead of the runner-up it was. */
  correlation: number;
  margin: number;
}

/**
 * The key a melody is in, weighted by how long each pitch sounds.
 *
 * Duration matters more than count: a passing sixteenth says much less about
 * the key than a held whole note, and a histogram that counted them equally
 * would be swayed by ornament.
 */
export function findKey(notes: readonly HarmonizerNote[]): KeyEstimate | null {
  if (notes.length === 0) return null;
  const histogram: number[] = new Array(12).fill(0);
  for (const note of notes) {
    const pitchClass = ((note.midi % 12) + 12) % 12;
    histogram[pitchClass] = (histogram[pitchClass] as number) + Math.max(0, note.durationTick);
  }
  if (histogram.every((value) => value === 0)) return null;

  const sounded = histogram
    .map((weight, pitchClass) => ({ weight, pitchClass }))
    .filter((entry) => entry.weight > 0)
    .map((entry) => entry.pitchClass);

  /**
   * Pitches the melody sounds that the key has no room for.
   *
   * Correlation alone does not notice this. Each profile is twelve numbers and
   * a chromatic degree scores low but never zero, so weight landing outside the
   * scale costs a little rather than disqualifying the key -- the well known
   * neighbouring-key confusion the method is criticised for. Measured on this
   * app's own output, two melodies in ten were named a key that excludes a note
   * they sound: a C major tune, no accidentals anywhere, called E natural minor
   * -- a scale with no F in it, over an F sounding seventeen times.
   */
  const foreign = (tonic: number, mode: Mode) => {
    const scale = new Set(getScaleSemitones(semitoneToPitchClass(tonic), mode)
      .map((semitone) => ((semitone % 12) + 12) % 12));
    return sounded.filter((pitchClass) => !scale.has(pitchClass)).length;
  };

  const scored: Array<
    { key: PitchClassName; mode: Mode; correlation: number; foreign: number }
  > = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    const rotated = histogram.map((_, index) => histogram[(index + tonic) % 12] as number);
    scored.push({
      key: semitoneToPitchClass(tonic),
      mode: "major",
      correlation: correlate(rotated, MAJOR_PROFILE),
      foreign: foreign(tonic, "major"),
    });
    scored.push({
      key: semitoneToPitchClass(tonic),
      mode: "naturalMinor",
      correlation: correlate(rotated, MINOR_PROFILE),
      foreign: foreign(tonic, "naturalMinor"),
    });
  }
  scored.sort((left, right) =>
    // Fewest foreign pitches first, then the correlation decides among equals.
    //
    // Counted rather than weighted, and ranked rather than penalised, so there
    // is no tuned constant here: nothing to fit, nothing to overfit. A melody
    // with a chromatic passing tone puts every key one foreign pitch from the
    // melody -- the old ordering, restored exactly when the criterion has
    // nothing to say. What it rules out is only the case it was written for: a
    // key that cannot spell what the melody plays, chosen over one that can.
    left.foreign - right.foreign
    || right.correlation - left.correlation
    // A tie broken by name rather than by array position, so the same melody
    // always names the same key.
    || left.key.localeCompare(right.key)
    || left.mode.localeCompare(right.mode));

  const winner = scored[0] as { key: PitchClassName; mode: Mode; correlation: number };
  const runnerUp = (scored[1] ?? winner) as { correlation: number };
  return {
    key: winner.key,
    mode: winner.mode,
    correlation: winner.correlation,
    margin: winner.correlation - runnerUp.correlation,
  };
}

/** One span the harmony holds a single chord for. */
export interface HarmonicSegment {
  startTick: number;
  durationTick: number;
}

/**
 * Where the chords change.
 *
 * A bar each, unless the melody says otherwise. The test for splitting a bar in
 * two is whether its halves disagree about pitch: a bar whose second half
 * introduces pitch classes the first half never sounded is a bar where the
 * harmony probably moves, and a bar that repeats itself is not.
 */
export function segmentMelody(
  notes: readonly HarmonizerNote[],
  options: { bars: number; timeSignature: TimeSignature; ppq: number; maxChordsPerBar?: 1 | 2 },
): HarmonicSegment[] {
  const barTicks = ticksPerBar(options.timeSignature, options.ppq);
  const maxPerBar = options.maxChordsPerBar ?? 2;
  const segments: HarmonicSegment[] = [];

  for (let bar = 0; bar < options.bars; bar += 1) {
    const start = bar * barTicks;
    const half = Math.floor(barTicks / 2);
    if (maxPerBar === 1 || half <= 0) {
      segments.push({ startTick: start, durationTick: barTicks });
      continue;
    }
    const firstHalf = pitchClassesIn(notes, start, start + half);
    const secondHalf = pitchClassesIn(notes, start + half, start + barTicks);
    const fresh = [...secondHalf].filter((pitchClass) => !firstHalf.has(pitchClass)).length;
    // Nothing new in the second half means nothing asked the harmony to move.
    if (secondHalf.size === 0 || fresh === 0) {
      segments.push({ startTick: start, durationTick: barTicks });
      continue;
    }
    segments.push({ startTick: start, durationTick: half });
    segments.push({ startTick: start + half, durationTick: barTicks - half });
  }
  return segments;
}

function pitchClassesIn(
  notes: readonly HarmonizerNote[],
  from: number,
  to: number,
): Set<number> {
  const found = new Set<number>();
  for (const note of notes) {
    if (note.startTick >= to) continue;
    if (note.startTick + note.durationTick <= from) continue;
    found.add(((note.midi % 12) + 12) % 12);
  }
  return found;
}

/** A chord the harmonizer may propose, as scale degree plus quality. */
export interface ChordCandidate {
  degree: number;
  /** Semitone offsets from the chord root. */
  intervals: readonly number[];
  seventh: boolean;
  label: string;
}

const MAJOR_TRIADS: ReadonlyArray<readonly number[]> = [
  [0, 4, 7], [0, 3, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 3, 7], [0, 3, 6],
];
const MAJOR_SEVENTHS: ReadonlyArray<readonly number[]> = [
  [0, 4, 7, 11], [0, 3, 7, 10], [0, 3, 7, 10], [0, 4, 7, 11],
  [0, 4, 7, 10], [0, 3, 7, 10], [0, 3, 6, 10],
];
const MINOR_TRIADS: ReadonlyArray<readonly number[]> = [
  [0, 3, 7], [0, 3, 6], [0, 4, 7], [0, 3, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7],
];
const MINOR_SEVENTHS: ReadonlyArray<readonly number[]> = [
  [0, 3, 7, 10], [0, 3, 6, 10], [0, 4, 7, 11], [0, 3, 7, 10],
  [0, 3, 7, 10], [0, 4, 7, 11], [0, 4, 7, 10],
];

/**
 * The chords a minor key borrows from its harmonic form.
 *
 * A minor key does not cadence on its own diatonic v. The seventh degree is
 * raised to make a real leading tone, which turns the fifth degree into a major
 * triad or a dominant seventh and the seventh degree into a diminished chord.
 * Offering only the natural-minor set means the harmoniser can never propose
 * the one chord a minor piece is most likely to end on, and measured, it scored
 * 43% against melodies whose cadences it therefore could not match.
 */
const HARMONIC_MINOR_EXTRAS: ReadonlyArray<{
  degree: number; intervals: readonly number[]; seventh: boolean; label: string;
}> = [
  { degree: 5, intervals: [0, 4, 7], seventh: false, label: "V" },
  { degree: 5, intervals: [0, 4, 7, 10], seventh: true, label: "V7" },
  { degree: 7, intervals: [0, 3, 6], seventh: false, label: "vii°" },
];

const ROMAN_MAJOR = ["I", "ii", "iii", "IV", "V", "vi", "vii°"] as const;
const ROMAN_MINOR = ["i", "ii°", "III", "iv", "v", "VI", "VII"] as const;

/** Every chord the harmonizer will consider in this key. */
export function candidatesFor(mode: Mode, allowSevenths: boolean): ChordCandidate[] {
  const minorish = mode !== "major";
  const triads = minorish ? MINOR_TRIADS : MAJOR_TRIADS;
  const sevenths = minorish ? MINOR_SEVENTHS : MAJOR_SEVENTHS;
  const roman = minorish ? ROMAN_MINOR : ROMAN_MAJOR;

  const result: ChordCandidate[] = [];
  if (minorish) {
    for (const extra of HARMONIC_MINOR_EXTRAS) {
      if (extra.seventh && !allowSevenths) continue;
      result.push({ ...extra });
    }
  }
  for (let degree = 1; degree <= 7; degree += 1) {
    result.push({
      degree,
      intervals: triads[degree - 1] as readonly number[],
      seventh: false,
      label: roman[degree - 1] as string,
    });
    if (allowSevenths) {
      result.push({
        degree,
        intervals: sevenths[degree - 1] as readonly number[],
        seventh: true,
        label: `${roman[degree - 1]}7`,
      });
    }
  }
  return result;
}

/**
 * How badly a chord fits the notes sounding over it.
 *
 * Every note contributes its own weight -- how long it sounds, multiplied by
 * how strong its metric position is -- and a note that is not a chord tone
 * costs that weight. A passing sixteenth on an offbeat is nearly free; a held
 * note on the downbeat that the chord does not contain is not, and that
 * asymmetry is the whole of what makes the result musical rather than merely
 * consistent.
 *
 * A note a semitone from a chord tone is treated more gently than one a tone
 * away: the semitone is how appoggiaturas and chromatic passing tones actually
 * behave, and penalising them equally would drive the harmoniser to reharmonise
 * every ornament.
 */
export function segmentCost(
  candidate: ChordCandidate,
  rootSemitone: number,
  notes: readonly HarmonizerNote[],
  segment: HarmonicSegment,
  options: { timeSignature: TimeSignature; ppq: number },
): number {
  const barTicks = ticksPerBar(options.timeSignature, options.ppq);
  const chordTones = new Set(
    candidate.intervals.map((interval) => ((rootSemitone + interval) % 12 + 12) % 12),
  );
  const segmentEnd = segment.startTick + segment.durationTick;

  let cost = 0;
  let weighed = 0;
  for (const note of notes) {
    if (note.startTick >= segmentEnd) continue;
    if (note.startTick + note.durationTick <= segment.startTick) continue;
    const sounding = Math.min(note.startTick + note.durationTick, segmentEnd)
      - Math.max(note.startTick, segment.startTick);
    if (sounding <= 0) continue;

    const strength = metricStrength(note.startTick % barTicks, options.timeSignature, options.ppq);
    const weight = (sounding / barTicks) * (0.3 + strength);
    weighed += weight;

    const pitchClass = ((note.midi % 12) + 12) % 12;
    if (chordTones.has(pitchClass)) continue;
    const nearest = [...chordTones].reduce((best, tone) => {
      const distance = Math.min(
        ((pitchClass - tone) + 12) % 12,
        ((tone - pitchClass) + 12) % 12,
      );
      return Math.min(best, distance);
    }, 12);
    cost += weight * (nearest === 1 ? 0.6 : 1.6);
  }
  // A segment with nothing sounding in it says nothing about the harmony, so
  // it must not be free -- otherwise every silent bar takes whatever chord the
  // transition prior happens to like.
  return weighed === 0 ? 0.5 : cost;
}

/**
 * How likely one degree is to follow another.
 *
 * Rows are the degree being left, columns the degree arrived at, both 1-based,
 * and these are costs so lower means more likely.
 *
 * The major table is DERIVED, not written: it counts the degree-to-degree
 * moves in the app's own catalogue of documented progressions -- 129 moves
 * across 28 major templates, each of which was included only because several
 * independent practitioner sources describe it with the same name and the same
 * degrees. A prior invented by hand is a guess about how music moves; this one
 * is a count of how the progressions people actually named do move.
 *
 * The minor table is written by hand, because the same catalogue holds only
 * five minor templates and eighteen moves. Eighteen is not a distribution. So
 * it states ordinary minor-key practice explicitly instead of pretending to
 * have measured it -- and what it has to state is exactly what the old shared
 * table got wrong. Measured before this existed: the harmoniser chose degree
 * seven zero times against the 125 the source used, and degree six eight times
 * against 161, because a table written around the major key's rare diminished
 * vii was punishing the flat seventh and the sixth that a minor key leans on
 * hardest.
 */
/** The average move cost both tables are scaled to, so one weight means one thing. */
const TARGET_TRANSITION_MEAN = 0.7;

/**
 * How the catalogue is counted.
 *
 * Every field here was a suspected flaw in the counting, and each was tried
 * against held-out templates -- progressions the prior had never seen. The
 * separation between a real progression and a random one, which is the only
 * thing this prior is for:
 *
 *   wrap 1.0, unnormalised (the defaults)  0.270
 *   wrap 0.5                               0.268
 *   normalised per template                0.268
 *   both                                   0.268
 *   wrap not counted at all                0.258
 *
 * So the defaults stand. The reasoning behind each alternative was sound and
 * none of it was worth anything, which is why they are options at their
 * measured-best settings rather than changes. What the exercise did establish
 * is that the earlier in-sample figure of 0.351 was circular: 30% of the app's
 * own four-bar windows are literally template sequences, and they were being
 * scored against a prior derived from those templates.
 */
export interface TransitionCountOptions {
  /**
   * How much a progression's closing move counts.
   *
   * A named progression is a loop, so the move from its last chord back to its
   * first is one of the moves it teaches. It is taught once per progression
   * however long that progression is, which gives it 22% of the sample and
   * inflates arrivals on the tonic specifically, since most loops both begin
   * and end there. Discounting it measured no better and dropping it measured
   * worse, so it counts in full.
   */
  wrapWeight?: number;
  /**
   * How much each template contributes in total.
   *
   * Counting every transition equally lets a twelve-chord blues speak three
   * times as loudly as a four-chord loop -- a fact about the catalogue's shape
   * rather than about music. Normalising would divide each template's votes by
   * its own length so every progression is one voice; measured, it changed
   * nothing.
   */
  normalizePerTemplate?: boolean;
  /** Templates to leave out, for measuring the prior against data it never saw. */
  exclude?: ReadonlySet<string>;
}

export function deriveTransitionCounts(
  templates: readonly { id: string; steps: readonly { degree: number }[]; modes: readonly Mode[] }[],
  wanted: (modes: readonly Mode[]) => boolean,
  options: TransitionCountOptions = {},
): number[][] {
  const wrapWeight = options.wrapWeight ?? 1;
  const normalize = options.normalizePerTemplate ?? false;
  const counts = Array.from({ length: 7 }, () => new Array(7).fill(0) as number[]);

  for (const template of templates) {
    if (!wanted(template.modes)) continue;
    if (options.exclude?.has(template.id)) continue;
    const degrees = template.steps.map((entry) => entry.degree);
    if (degrees.length === 0) continue;
    const share = normalize ? 1 / degrees.length : 1;

    for (let index = 0; index < degrees.length; index += 1) {
      const wraps = index === degrees.length - 1;
      const from = (degrees[index] as number) - 1;
      const to = (degrees[(index + 1) % degrees.length] as number) - 1;
      if (from < 0 || from > 6 || to < 0 || to > 6) continue;
      const row = counts[from] as number[];
      row[to] = (row[to] as number) + share * (wraps ? wrapWeight : 1);
    }
  }
  return counts;
}

function deriveTransitionCosts(
  templates: readonly { id: string; steps: readonly { degree: number }[]; modes: readonly Mode[] }[],
  wanted: (modes: readonly Mode[]) => boolean,
  options: TransitionCountOptions = {},
): number[][] {
  const counts = deriveTransitionCounts(templates, wanted, options);
  // Add-one smoothing, so a move the catalogue never happens to contain is
  // expensive rather than impossible. A zero here would be the harmoniser
  // refusing a chord change on the grounds that no named progression uses it,
  // and 20 of the 49 cells are never observed.
  //
  // One, rather than something scaled to the 2.6 observations a cell holds on
  // average. Sizing it to the sample is the textbook correction and it was
  // tried: it left the held-out separation unchanged and widened the gap
  // between the commonest move and an unseen one from 6.7 to 20, which is a
  // prior stating far more confidence than 129 observations support.
  const raw = counts.map((row) => {
    const total = row.reduce((sum, value) => sum + value, 0) + 7;
    return row.map((value) => -Math.log((value + 1) / total));
  });

  // Rescaled to the same average as the hand-written table, because the balance
  // between "does this chord fit the notes" and "does this chord follow the
  // last one" is set by their relative size, and a negative log runs over a far
  // wider range than a hand-chosen figure does. Measured before this: the
  // unscaled prior overwhelmed the fit and melody notes landing on a chord tone
  // fell from 89% to 80%, with the harmoniser choosing the tonic 64 times where
  // the source used it 191. The shape of the counts is what was wanted from the
  // corpus; the loudness of it was not.
  const flat = raw.flat();
  const mean = flat.reduce((sum, value) => sum + value, 0) / flat.length;
  const scale = mean === 0 ? 1 : TARGET_TRANSITION_MEAN / mean;
  return raw.map((row) => row.map((value) => value * scale));
}

/**
 * The major-key prior, built from a chosen part of the catalogue.
 *
 * Exposed with its options so the prior can be rebuilt without a template and
 * then measured against that template -- the only way to find out whether it
 * has learned anything beyond the sequences it was counted from. Nothing in the
 * app calls it with options; the evaluation does.
 */
export function majorTransitionCosts(options: TransitionCountOptions = {}): number[][] {
  return deriveTransitionCosts(
    PROGRESSION_TEMPLATES, (modes) => modes.includes("major"), options,
  );
}

export const TRANSITION_COST_MAJOR = majorTransitionCosts();

/**
 * Minor-key practice, stated rather than measured.
 *
 * The moves a minor key is built on: VII to i is the Aeolian cadence, VI-VII-i
 * is its turnaround, iv-V-i and iv-i are its plagal and its dominant approach,
 * and ii diminished leads to V. Costs, so lower is likelier.
 */
const TRANSITION_COST_MINOR: ReadonlyArray<readonly number[]> = [
  //         i    ii°  III  iv    v/V  VI   VII
  /* i    */ [1.6, 1.5, 1.4, 0.9, 1.0, 0.9, 0.8],
  /* ii°  */ [1.3, 1.8, 1.7, 1.4, 0.6, 1.5, 1.2],
  /* III  */ [1.2, 1.6, 1.7, 1.2, 1.3, 0.9, 0.9],
  /* iv   */ [0.9, 1.4, 1.5, 1.6, 0.7, 1.2, 0.9],
  /* v/V  */ [0.5, 1.7, 1.4, 1.3, 1.7, 0.9, 1.3],
  /* VI   */ [1.1, 1.2, 1.2, 1.1, 0.9, 1.6, 0.6],
  /* VII  */ [0.6, 1.6, 0.9, 1.2, 1.2, 1.0, 1.6],
];

/** Scaled to the same average as the derived table, for the same reason. */
const SCALED_MINOR = (() => {
  const flat = TRANSITION_COST_MINOR.flat();
  const mean = flat.reduce((sum, value) => sum + value, 0) / flat.length;
  const scale = mean === 0 ? 1 : TARGET_TRANSITION_MEAN / mean;
  return TRANSITION_COST_MINOR.map((row) => row.map((value) => value * scale));
})();

export function transitionCostsFor(mode: Mode): ReadonlyArray<readonly number[]> {
  return mode === "major" ? TRANSITION_COST_MAJOR : SCALED_MINOR;
}

export interface HarmonizedChord {
  degree: number;
  root: PitchClassName;
  seventh: boolean;
  label: string;
  startTick: number;
  durationTick: number;
  pitchClasses: number[];
}

export interface HarmonizeOptions {
  bars: number;
  timeSignature: TimeSignature;
  ppq: number;
  key?: PitchClassName;
  mode?: Mode;
  allowSevenths?: boolean;
  maxChordsPerBar?: 1 | 2;
  /** How much the functional prior counts against fitting the notes. */
  transitionWeight?: number;
}

export interface HarmonizeResult {
  key: PitchClassName;
  mode: Mode;
  chords: HarmonizedChord[];
  /** Mean per-segment fit cost. Lower is a closer fit to the melody. */
  meanFit: number;
}

/**
 * Chords for a melody, chosen as a sequence.
 *
 * The search is a Viterbi pass over the segments: each segment scores every
 * candidate against the notes sounding in it, and the running total carries the
 * cost of getting there from the previous segment's choice. Choosing greedily
 * per bar would take the locally best chord and strand the next bar, which is
 * the same failure the voicer's sequence optimiser exists to avoid.
 */
export function harmonizeMelody(
  notes: readonly HarmonizerNote[],
  options: HarmonizeOptions,
): HarmonizeResult | null {
  const estimate = options.key && options.mode
    ? { key: options.key, mode: options.mode }
    : findKey(notes);
  if (!estimate) return null;

  const segments = segmentMelody(notes, options);
  if (segments.length === 0) return null;

  const scale = getScalePitchClasses(estimate.key, estimate.mode);
  const candidates = candidatesFor(estimate.mode, options.allowSevenths ?? true);
  const transitionWeight = options.transitionWeight ?? 1;
  const transitions = transitionCostsFor(estimate.mode);

  // Viterbi. Costs, so the best path is the cheapest one.
  const costs: number[][] = [];
  const backpointers: number[][] = [];
  for (const [index, segment] of segments.entries()) {
    const row: number[] = [];
    const from: number[] = [];
    for (const candidate of candidates) {
      const rootSemitone = pitchClassToSemitone(scale[candidate.degree - 1] as PitchClassName);
      const fit = segmentCost(candidate, rootSemitone, notes, segment, options);
      if (index === 0) {
        // Starting anywhere is allowed, but starting on the tonic is what a
        // piece usually does, and nothing else in the first segment says so.
        row.push(fit + (candidate.degree === 1 ? 0 : 0.15));
        from.push(-1);
        continue;
      }
      let best = Number.POSITIVE_INFINITY;
      let bestFrom = 0;
      for (const [priorIndex, prior] of candidates.entries()) {
        const previous = (costs[index - 1] as number[])[priorIndex] as number;
        const move = (transitions[prior.degree - 1] as readonly number[])[
          candidate.degree - 1
        ] as number;
        // A seventh where the triad would do is a small extra claim.
        const total = previous + move * transitionWeight + (candidate.seventh ? 0.05 : 0);
        if (total < best - 1e-9) { best = total; bestFrom = priorIndex; }
      }
      row.push(fit + best);
      from.push(bestFrom);
    }
    costs.push(row);
    backpointers.push(from);
  }

  const last = costs[costs.length - 1] as number[];
  let bestIndex = 0;
  for (const [index, value] of last.entries()) {
    if (value < (last[bestIndex] as number) - 1e-9) bestIndex = index;
  }

  const path: number[] = new Array(segments.length).fill(0);
  path[segments.length - 1] = bestIndex;
  for (let index = segments.length - 1; index > 0; index -= 1) {
    path[index - 1] = (backpointers[index] as number[])[path[index] as number] as number;
  }

  let fitTotal = 0;
  const chords = segments.map((segment, index) => {
    const candidate = candidates[path[index] as number] as ChordCandidate;
    const root = scale[candidate.degree - 1] as PitchClassName;
    const rootSemitone = pitchClassToSemitone(root);
    fitTotal += segmentCost(candidate, rootSemitone, notes, segment, options);
    return {
      degree: candidate.degree,
      root,
      seventh: candidate.seventh,
      label: candidate.label,
      startTick: segment.startTick,
      durationTick: segment.durationTick,
      pitchClasses: candidate.intervals.map(
        (interval) => ((rootSemitone + interval) % 12 + 12) % 12,
      ),
    };
  });

  return {
    key: estimate.key,
    mode: estimate.mode,
    chords,
    meanFit: fitTotal / segments.length,
  };
}
