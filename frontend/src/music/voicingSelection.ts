import type { ChordQuality, PitchClassName, Tension } from "../types/music";
import { intervalsForQuality, reduceStack, resolveAvoidNotes } from "./chords";
import { pitchClassToSemitone } from "./scales";
import { shapesFor, type VoicingShape } from "./voicingShapes";
import {
  bassCrowding,
  lowIntervalViolation,
  melodyConflict,
  clusterCount,
  spacingInversion,
  span,
} from "./voicingRegister";

/**
 * Choosing a voicing, rather than being told one.
 *
 * The shape is never requested. Every shape the chord admits is placed in every
 * register it fits, and the one that scores best wins -- so drop-2 appears
 * where a drop-2 is what the moment wants, and close position appears where it
 * is not. A setting that named the shape would be the same mistake as a setting
 * that named the chord.
 *
 * The cost terms read the whole vertical space, not just the chord: where the
 * bass is, where the melody is going, how the intervals sit against the low
 * interval limits. Measured before this existed, across eight styles at sixteen
 * bars: every voicing spanned 8.0 semitones on average with a third at the
 * bottom, and in the jazz style forty-five of eighty chord spans had the melody
 * at or below the chord's top note -- the harmony sitting on top of the tune.
 */

export type VoicingStyleId =
  | "pop" | "j-pop" | "rock" | "jazz" | "lo-fi" | "edm" | "ballad" | "game-music";

export interface VoicingProfile {
  /**
   * The narrowest and widest this style's chords should be, in semitones.
   *
   * A range rather than a target. Aiming at a preferred width is the mistake
   * that made the search reject the ordinary two-handed piano voicing -- a
   * left-hand root and fifth under a close right-hand chord spans about three
   * octaves, and a cost that pulled toward seventeen semitones rejected it
   * outright, however cleanly it was spaced. A pianist does not aim for a
   * width; a width is what results from voicing well.
   */
  minSpan: number;
  maxSpan: number;
  /** Weight on covering or clashing with the melody. */
  melody: number;
  /** Weight on the low interval limits. */
  clarity: number;
  /** Weight on wide-at-the-bottom spacing. */
  spacing: number;
  /**
   * Weight on seconds inside the voicing.
   *
   * A ninth sounding against the root is the whole point of an add9, and a rock
   * keyboard playing the same interval is a mistake. Folding an extended chord
   * into playable width produces these by construction -- measured, 943 of them
   * across eight styles once compact voicings existed -- so what they cost has
   * to be a style decision rather than one rule for everybody.
   */
  cluster: number;
  /** Weight on staying near the previous voicing. */
  motion: number;
  /**
   * Weight on the top voice moving as a line.
   *
   * The highest note of successive chords is heard as a melody whether or not
   * one was intended, so it cannot be left to fall out of the other terms.
   * Measured before this existed: the register and spacing work took the mean
   * top-voice leap from 0.9 semitones to 4.5, with one move in eleven jumping
   * more than a fifth. Better voicings, worse playing.
   */
  topVoice: number;
  /** Weight on keeping the same shape as the previous chord. */
  coherence: number;
  /** Shapes this style will not use at all. */
  excluded: readonly VoicingShape[];
}

/**
 * What each style wants.
 *
 * These are not decorations. A rootless voicing in a game-music cue and a
 * four-note close triad in a jazz ballad are each wrong in a way the other is
 * not, and a single profile applied to all eight styles would trade one kind of
 * wrong output for another.
 */
export const VOICING_PROFILES: Readonly<Record<VoicingStyleId, VoicingProfile>> = {
  jazz: {
    minSpan: 12, maxSpan: 38, melody: 3, clarity: 1.2, spacing: 0.8, cluster: 0.35, motion: 0.5, topVoice: 1.4, coherence: 0.6,
    excluded: [],
  },
  "lo-fi": {
    minSpan: 12, maxSpan: 38, melody: 2.4, clarity: 1.2, spacing: 0.8, cluster: 0.35, motion: 0.6, topVoice: 1.2, coherence: 0.8,
    excluded: [],
  },
  ballad: {
    minSpan: 11, maxSpan: 36, melody: 3, clarity: 1.4, spacing: 1.2, cluster: 0.9, motion: 0.9, topVoice: 1.6, coherence: 0.9,
    // A ballad is carried by its line; a quartal stack states no quality and
    // leaves the singer nothing to sit on.
    excluded: ["quartal"],
  },
  "j-pop": {
    minSpan: 10, maxSpan: 34, melody: 2.6, clarity: 1.2, spacing: 1, cluster: 0.7, motion: 0.8, topVoice: 1.4, coherence: 0.8,
    excluded: ["rootlessB"],
  },
  pop: {
    minSpan: 9, maxSpan: 32, melody: 2.6, clarity: 1.2, spacing: 1, cluster: 1.1, motion: 0.9, topVoice: 1.4, coherence: 1,
    excluded: ["rootlessA", "rootlessB", "quartal"],
  },
  rock: {
    minSpan: 7, maxSpan: 28, melody: 2, clarity: 1.4, spacing: 1, cluster: 1.8, motion: 1, topVoice: 1.2, coherence: 1.2,
    // Rock keyboard states the chord plainly; the rootless and quartal shapes
    // both withhold the root, which is the one thing it is there to supply.
    excluded: ["rootlessA", "rootlessB", "quartal", "shell"],
  },
  edm: {
    minSpan: 9, maxSpan: 32, melody: 2, clarity: 1.6, spacing: 1.2, cluster: 0.9, motion: 0.7, topVoice: 1.0, coherence: 1.2,
    excluded: ["rootlessA", "rootlessB", "shell"],
  },
  "game-music": {
    minSpan: 7, maxSpan: 28, melody: 2, clarity: 1.4, spacing: 1, cluster: 1.8, motion: 1, topVoice: 1.2, coherence: 1.2,
    excluded: ["rootlessA", "rootlessB", "quartal", "shell"],
  },
};

export function voicingProfileFor(style: string): VoicingProfile {
  return VOICING_PROFILES[style as VoicingStyleId] ?? VOICING_PROFILES.pop;
}

/** The register the chord voicing is allowed to occupy. */
const LOWEST_CHORD_NOTE = 36;
const HIGHEST_CHORD_NOTE = 88;

export interface VoicingContext {
  style: string;
  /** The voicing of the previous chord, for voice leading. */
  previousNotes?: readonly number[];
  /** The shape the previous chord used, for coherence. */
  previousShape?: VoicingShape;
  /** Where the bass track will sound under this chord. */
  bass?: number;
  /** Melody pitches sounding while this chord is held. */
  melody?: readonly number[];
}

export interface VoicingChoice {
  notes: number[];
  shape: VoicingShape;
  cost: number;
}

/** Every component of one candidate's cost, kept separable so it can be checked. */
export interface VoicingCostBreakdown {
  clarity: number;
  spacing: number;
  cluster: number;
  melodyCovering: number;
  melodyClash: number;
  bass: number;
  spanFit: number;
  motion: number;
  topVoice: number;
  retention: number;
  density: number;
  coherence: number;
  total: number;
}

/**
 * A dominant chord may sound its own flat ninth against the root.
 *
 * The minor-ninth clash is the one interval a voicer must avoid, with exactly
 * this exception: on a dominant the flat ninth is the sound, not the fault.
 */
function permittedMinorNinthsFor(rootSemitone: number, quality: ChordQuality): Set<number> {
  if (quality !== "dominant7") return new Set();
  return new Set([((rootSemitone % 12) + 12) % 12]);
}

export function scoreVoicingCandidate(
  notes: readonly number[],
  shape: VoicingShape,
  context: VoicingContext,
  profile: VoicingProfile,
  permittedMinorNinths: ReadonlySet<number>,
): VoicingCostBreakdown {
  const conflict = melodyConflict(notes, context.melody, permittedMinorNinths);
  // Weighted well above the preference terms on purpose. The low interval
  // limit is an acoustic floor -- below it two tones fuse into roughness
  // instead of harmony -- so a voicing that violates it should lose to any
  // voicing that does not, however much better it fits the style otherwise.
  // A flat charge for violating at all, on top of the proportional one, so the
  // comparison is lexicographic in practice: any voicing that stays above the
  // limits beats every voicing that does not.
  //
  // Weighting it merely heavily was not enough. Measured with the whole engine
  // switched on, five chords were voiced below their limit while a clean
  // candidate for the same chord existed -- the melody terms, which can reach
  // eighteen, were outbidding a two-semitone violation worth nine.
  const violation = lowIntervalViolation(notes);
  const clarity = violation === 0 ? 0 : (25 + violation * 4) * profile.clarity;
  // Weighted like a rule rather than a preference, now that the metric no
  // longer condemns a two-handed voicing for the hole it is supposed to have.
  const spacing = spacingInversion(notes) * profile.spacing * 2.5;
  // Covering the melody is the fault that makes a written line disappear, so it
  // is weighted above every other consideration in every style.
  const cluster = clusterCount(notes) * profile.cluster;
  const melodyCovering = conflict.covering * profile.melody * 2;
  const melodyClash = conflict.minorNinth * profile.melody * 4;
  const bass = bassCrowding(notes, context.bass) * 0.35;
  // Only for being outside the range, and nothing for where inside it the
  // voicing sits. A chord that is neither cramped nor unplayable has nothing
  // left to answer for on width.
  const width = span(notes);
  const spanFit = width < profile.minSpan
    ? (profile.minSpan - width) * 0.45
    : width > profile.maxSpan
      ? (width - profile.maxSpan) * 0.45
      : 0;

  let motion = 0;
  let topVoice = 0;
  let retention = 0;
  let density = 0;
  if (context.previousNotes && context.previousNotes.length > 0) {
    const previous = context.previousNotes;

    // The top voice, specifically. A step is free, a third is cheap, and a leap
    // costs sharply -- the shape of the penalty matters more than its size,
    // because a line that steps everywhere except once is still a line and one
    // that leaps everywhere is not.
    const leap = Math.abs(
      Math.max(...notes) - Math.max(...previous),
    );
    topVoice = (leap <= 2 ? leap * 0.2 : 0.4 + (leap - 2) ** 1.4 * 0.35) * profile.topVoice;

    // A pitch held at the same octave, not merely a pitch class reappearing
    // somewhere. Holding the actual note is what makes two chords sound joined
    // rather than merely related.
    // As a share, not a count. Rewarding the raw number of held notes rewards
    // adding notes -- a five-note voicing can hold more than a three-note one
    // by existing -- and measured, that alone pushed the texture from changing
    // thickness on one chord in nine to one in five.
    const held = notes.filter((note) => previous.includes(note)).length;
    retention = -(held / Math.max(notes.length, previous.length)) * 3.5 * profile.motion;

    // Three notes then five then three again is the texture flickering. A
    // player who has settled on a way of holding the chord keeps holding it.
    density = Math.abs(notes.length - previous.length) * 2.8;
    // Nearest previous pitch for each note, so a voicing with a different
    // number of voices is still comparable to the one before it.
    const travel = notes.reduce((sum, note) => {
      const nearest = previous.reduce(
        (best, prior) => Math.min(best, Math.abs(note - prior)),
        Number.POSITIVE_INFINITY,
      );
      return sum + nearest;
    }, 0);
    const common = notes.filter((note) =>
      previous.some((prior) => prior % 12 === ((note % 12) + 12) % 12)).length;
    motion = (travel / notes.length - common * 1.2) * profile.motion;
  }

  // Changing shape on every chord is as mechanical as never changing it. The
  // penalty is small: it breaks ties toward continuity without preventing the
  // search from moving when the music asks it to.
  const coherence = context.previousShape !== undefined && context.previousShape !== shape
    ? profile.coherence * 1.5
    : 0;

  const total = clarity + spacing + cluster + melodyCovering + melodyClash
    + bass + spanFit + motion + topVoice + retention + density + coherence;
  return {
    clarity, spacing, cluster, melodyCovering, melodyClash, bass, spanFit,
    motion, topVoice, retention, density, coherence, total,
  };
}

/**
 * Every placement of every shape this chord admits.
 *
 * Shapes carry offsets from the root and may run below it, so each is slid
 * through the register an octave at a time and kept only where the whole
 * voicing fits. Candidates are emitted in a fixed order so the search's
 * tie-breaking is deterministic.
 */
export function voicingCandidates(
  root: PitchClassName,
  quality: ChordQuality,
  tensions: readonly Tension[] | undefined,
  profile: VoicingProfile,
  stack?: readonly number[],
): Array<{ notes: number[]; shape: VoicingShape }> {
  const rootSemitone = pitchClassToSemitone(root);
  const closeStack = stack ?? intervalsForQuality(quality);
  const candidates: Array<{ notes: number[]; shape: VoicingShape }> = [];
  const seen = new Set<string>();

  // A chord that declares no colour tones must sound every one of its own
  // tones: validateComposition holds a plain chord to exactly its pitch-class
  // set, and only relaxes to "nothing foreign sounds" once tensions are
  // declared. So the shapes that omit a tone -- shell, the rootless forms,
  // quartal -- are available on an extended chord and not on a plain triad.
  // This is not a workaround for the validator. It is the same rule stated
  // twice: dropping the fifth of a C major triad leaves something that is no
  // longer a C major triad, while dropping it from a C13 leaves a C13.
  const own = new Set(intervalsForQuality(quality).map((interval) => ((interval % 12) + 12) % 12));
  const mayOmit = (tensions?.length ?? 0) > 0;
  // What the chord has actually declared. A shape that sounds anything outside
  // this is not a voicing of this chord: a rootless A form of a plain major
  // seventh sounds a ninth, which makes it a different chord than the one whose
  // symbol is printed on the lane. So rootless and quartal shapes become
  // available when the chord already carries the extensions they need, and stay
  // unavailable when it does not.
  const declared = new Set(own);
  for (const interval of closeStack) declared.add(((interval % 12) + 12) % 12);

  for (const entry of shapesFor({ quality, tensions, stack: closeStack })) {
    if (profile.excluded.includes(entry.shape)) continue;
    const sounding = new Set(entry.intervals.map((interval) => ((interval % 12) + 12) % 12));
    if ([...sounding].some((pitchClass) => !declared.has(pitchClass))) continue;
    if (!mayOmit && [...own].some((pitchClass) => !sounding.has(pitchClass))) continue;
    for (let octave = 24; octave <= 84; octave += 12) {
      const notes = entry.intervals.map((interval) => rootSemitone + octave + interval);
      const lowest = notes[0] as number;
      const highest = notes[notes.length - 1] as number;
      if (lowest < LOWEST_CHORD_NOTE || highest > HIGHEST_CHORD_NOTE) continue;
      const key = notes.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ notes, shape: entry.shape });
    }
  }
  return candidates;
}

/**
 * The voicing this chord should take here.
 *
 * Falls back to nothing rather than to something arbitrary when no candidate
 * fits the register at all, so the caller can keep whatever it already had
 * instead of receiving a voicing that was never really chosen.
 */
export function selectVoicing(
  root: PitchClassName,
  quality: ChordQuality,
  tensions: readonly Tension[] | undefined,
  context: VoicingContext,
  stack?: readonly number[],
): VoicingChoice | null {
  const profile = voicingProfileFor(context.style);
  const candidates = voicingCandidates(root, quality, tensions, profile, stack);
  if (candidates.length === 0) return null;

  const permitted = permittedMinorNinthsFor(pitchClassToSemitone(root), quality);
  let best: VoicingChoice | null = null;
  for (const candidate of candidates) {
    const cost = scoreVoicingCandidate(
      candidate.notes, candidate.shape, context, profile, permitted,
    ).total;
    if (
      best === null
      || cost < best.cost - 1e-9
      // An exact tie goes to the earlier candidate, which is fixed by the
      // catalogue's order, so the same inputs always give the same voicing.
      || (Math.abs(cost - best.cost) <= 1e-9 && candidate.notes.join(",") < best.notes.join(","))
    ) {
      best = { notes: candidate.notes, shape: candidate.shape, cost };
    }
  }
  return best;
}

export interface RevoiceOptions {
  style: string;
  /** Where the bass track sounds, per chord id, when it is already decided. */
  bassFor?: (chordId: string) => number | undefined;
}

interface RevoiceableChord {
  id: string;
  root: PitchClassName;
  quality: ChordQuality;
  tensions?: readonly Tension[];
  startTick: number;
  durationTick: number;
  notes: number[];
  inversion: number;
}

interface RevoiceableNote {
  midi: number;
  startTick: number;
  durationTick: number;
}

/**
 * Re-voices a progression now that the melody exists.
 *
 * This app writes the chords first and the melody second, so at the moment the
 * voicer runs there is no melody to voice against. Rather than reorder the
 * pipeline -- which would leave the melody generator with no chord tones to
 * score against, the exact mirror of the problem -- the chords are voiced
 * twice: once blind, so the melody has something to be written against, and
 * once knowing where the melody went.
 *
 * The second pass is safe precisely because re-voicing moves octaves and never
 * pitch classes. Every relationship the melody generator scored against -- what
 * is a chord tone, what is a passing tone, where the guide tones are -- is
 * stated in pitch classes and survives untouched. What changes is only which
 * octave each chord tone sounds in, which is the one thing the melody
 * generator did not depend on.
 */
export function revoiceForMelody<TChord extends RevoiceableChord>(
  chords: readonly TChord[],
  melody: readonly RevoiceableNote[],
  options: RevoiceOptions,
): TChord[] {
  const result: TChord[] = [];
  let previousNotes: readonly number[] | undefined;
  let previousShape: VoicingShape | undefined;

  for (const chord of chords) {
    const end = chord.startTick + chord.durationTick;
    const sounding = melody
      .filter((note) => note.startTick < end && note.startTick + note.durationTick > chord.startTick)
      .map((note) => note.midi);

    // The stack has to carry the colour tones. Without it the second pass
    // voices the plain triad and the ninth the first pass put there is simply
    // gone -- the chord still declares the tension, so validation stays happy
    // while the note stops sounding.
    const tensions = resolveAvoidNotes(chord.quality, chord.tensions ?? []);
    const stack = tensions.length > 0
      ? reduceStack(chord.quality, tensions, false)
      : undefined;

    const choice = selectVoicing(chord.root, chord.quality, chord.tensions, {
      style: options.style,
      previousNotes,
      previousShape,
      bass: options.bassFor?.(chord.id),
      melody: sounding,
    }, stack);

    // No candidate fitting the register is not a licence to invent one: the
    // chord keeps the voicing it already had.
    if (!choice) {
      result.push(chord);
      previousNotes = chord.notes;
      previousShape = undefined;
      continue;
    }

    result.push({
      ...chord,
      notes: choice.notes,
      // The inversion is a property of the sounding pitches, so it is restated
      // rather than carried over from a voicing that no longer exists.
      inversion: inversionOf(choice.notes, chord.root, chord.quality),
    });
    previousNotes = choice.notes;
    previousShape = choice.shape;
  }
  return result;
}

/**
 * Which chord tone is in the bass, as a position in the chord's own stack.
 *
 * A rootless voicing has no root to count from and a quartal stack is not an
 * inversion of anything, so a lowest tone that is not a chord tone reports
 * position zero rather than inventing one. validateComposition only requires
 * the figure to index into the sounding notes.
 */
function inversionOf(
  notes: readonly number[],
  root: PitchClassName,
  quality: ChordQuality,
): number {
  const rootSemitone = ((pitchClassToSemitone(root) % 12) + 12) % 12;
  const lowest = ((Math.min(...notes) % 12) + 12) % 12;
  const position = intervalsForQuality(quality)
    .findIndex((interval) => (rootSemitone + interval) % 12 === lowest);
  return position < 0 || position >= notes.length ? 0 : position;
}
