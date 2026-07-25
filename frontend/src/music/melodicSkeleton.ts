import type { CadenceType, ChordEvent, PitchClassName } from "../types/music";
import type { PhrasePlanEntry } from "./phrases";
import { createSeededRandom, deriveSeed, type Seed } from "./random";
import { pitchClassToSemitone } from "./scales";

/**
 * Melodic skeleton.
 *
 * The melody was written one note at a time: each note was weighted against the
 * chord under it and the note before it, and the line was whatever that walk
 * produced. Every note could be defensible while the phrase as a whole went
 * nowhere in particular — nothing decided in advance where the line should
 * start, where it should peak, or what it should land on.
 *
 * This plans those points first. A handful of structural notes are fixed per
 * phrase, and the note-by-note generator is then pulled toward them, so the
 * detail fills in a shape rather than inventing one.
 */

export type MelodicStructuralRole =
  | "phraseStart"
  | "climax"
  | "cadentialPreparation"
  | "cadentialResolution";

export interface MelodicSkeletonNote {
  barIndex: number;
  /** Beat within the bar, zero-based. */
  beat: number;
  /** Absolute tick, so the melody generator can match slots without recomputing. */
  tick: number;
  /** 0..11. */
  pitchClass: number;
  /**
   * The concrete pitch the plan intends, inside the melody range.
   *
   * A pitch class alone cannot express a climax: the point of a climax is the
   * register it reaches, and the same pitch class an octave down is the
   * opposite of the intended gesture.
   */
  targetMidi: number;
  structuralRole: MelodicStructuralRole;
  phraseId: string;
}

export interface MelodicSkeletonSettings {
  /** Off keeps the purely note-by-note melody. */
  enabled: boolean;
}

/**
 * Which role wins when two structural points land on the same tick.
 *
 * A resolution outranks everything: it is the note the phrase exists to reach.
 */
const ROLE_PRIORITY: Readonly<Record<MelodicStructuralRole, number>> = {
  cadentialResolution: 4,
  climax: 3,
  cadentialPreparation: 2,
  phraseStart: 1,
};

/** A phrase closing at least this firmly gets a prepared cadence planned. */
const CADENTIAL_THRESHOLD = 0.5;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function chordAt(chords: readonly ChordEvent[], tick: number): ChordEvent | undefined {
  return chords.find(
    (chord) => tick >= chord.startTick && tick < chord.startTick + chord.durationTick,
  );
}

/** Pitch classes actually sounding in a chord. */
function chordPitchClasses(chord: ChordEvent): number[] {
  const classes = new Set(chord.notes.map((note) => ((note % 12) + 12) % 12));
  return [...classes].sort((left, right) => left - right);
}

/**
 * The octave of `pitchClass` sitting closest to `target`, clamped to the range.
 *
 * Clamping by octave rather than by semitone matters: nudging a pitch into range
 * by semitones would change which note it is, and the caller chose the pitch
 * class for harmonic reasons.
 */
function nearestPitchInRange(
  pitchClass: number,
  target: number,
  low: number,
  high: number,
): number | null {
  const base = ((pitchClass % 12) + 12) % 12;
  let best: number | null = null;
  for (let midi = base; midi <= 127; midi += 12) {
    if (midi < low || midi > high) continue;
    if (best === null || Math.abs(midi - target) < Math.abs(best - target)) best = midi;
  }
  return best;
}

/**
 * Height the climax of a phrase should reach, as a fraction of the melody range.
 *
 * The peak of a whole piece sits a little past two thirds through — late enough
 * that the music has been building, early enough to leave room to come down. An
 * arch around that point gives each phrase a climax that is high in itself but
 * subordinate to the piece's own.
 */
function climaxHeightFraction(phraseIndex: number, phraseCount: number): number {
  if (phraseCount <= 1) return 0.85;
  const peakAt = 0.68;
  const progress = phraseIndex / (phraseCount - 1);
  const distance = Math.abs(progress - peakAt) / Math.max(peakAt, 1 - peakAt);
  return 0.45 + 0.4 * clamp(1 - distance, 0, 1);
}

export interface MelodicSkeletonOptions {
  phrases: readonly PhrasePlanEntry[];
  chords: readonly ChordEvent[];
  ticksPerBar: number;
  /**
   * Length of one musical beat. Passed in rather than derived, because 6/8
   * counts in dotted-quarter compound beats and a bar-division would put the
   * cadential preparation on a subdivision instead of a beat.
   */
  ticksPerBeat: number;
  /** Melody range, [low, high] inclusive. */
  range: readonly [number, number];
  /** Key of the piece, used for the final resolution. */
  key: PitchClassName;
  /** How the piece ends; only an authentic or plagal close targets the tonic. */
  cadence?: CadenceType;
  seed: Seed;
}

/**
 * Plans the structural notes of each phrase.
 *
 * Every phrase gets a start and a climax. Only a phrase that actually closes —
 * a cadential one — gets a prepared cadence, because planning a resolution into
 * a fragmentation phrase would stop the momentum that phrase exists to build.
 */
export function planMelodicSkeleton(
  options: MelodicSkeletonOptions,
): MelodicSkeletonNote[] {
  const { phrases, chords, ticksPerBar, range, seed } = options;
  const [low, high] = range;
  if (phrases.length === 0 || chords.length === 0 || high < low) return [];
  const ticksPerBeat = Math.max(1, Math.floor(options.ticksPerBeat));
  const beatsPerBar = Math.max(1, Math.floor(ticksPerBar / ticksPerBeat));

  const span = Math.max(1, high - low);
  const tonicSemitone = pitchClassToSemitone(options.key);
  const resolvesToTonic =
    options.cadence === undefined ||
    options.cadence === "authentic" ||
    options.cadence === "plagal";

  const planned: MelodicSkeletonNote[] = [];

  const add = (
    barIndex: number,
    beat: number,
    pitchClass: number,
    targetHeight: number,
    structuralRole: MelodicStructuralRole,
    phraseId: string,
  ): void => {
    const midi = nearestPitchInRange(pitchClass, targetHeight, low, high);
    if (midi === null) return;
    planned.push({
      barIndex,
      beat,
      tick: barIndex * ticksPerBar + beat * ticksPerBeat,
      pitchClass: ((pitchClass % 12) + 12) % 12,
      targetMidi: midi,
      structuralRole,
      phraseId,
    });
  };

  /** Picks the chord tone nearest a target height, breaking ties from the seed. */
  const pickChordTone = (
    chord: ChordEvent,
    targetHeight: number,
    label: string,
    salt: number,
  ): number => {
    const classes = chordPitchClasses(chord);
    if (classes.length === 0) return tonicSemitone;
    const random = createSeededRandom(deriveSeed(seed, "skeleton", label, salt));
    const weights = classes.map((pitchClass) => {
      const midi = nearestPitchInRange(pitchClass, targetHeight, low, high);
      if (midi === null) return 0.01;
      // Sharply favour the tone closest to the intended height, but leave the
      // others reachable so repeated chords do not all yield the same note.
      return 1 / (1 + Math.abs(midi - targetHeight) * 0.5);
    });
    return random.weightedPick(classes, weights);
  };

  for (const [phraseIndex, phrase] of phrases.entries()) {
    const phraseBars = Math.max(1, phrase.endBar - phrase.startBar);
    const isLastPhrase = phraseIndex === phrases.length - 1;

    // Start: a chord tone in the middle of the range, so the line has room to
    // rise to the climax and fall to the close.
    const startTick = phrase.startBar * ticksPerBar;
    const startChord = chordAt(chords, startTick);
    if (startChord) {
      const height = low + span * 0.45;
      add(
        phrase.startBar,
        0,
        pickChordTone(startChord, height, `${phrase.id}-start`, phraseIndex),
        height,
        "phraseStart",
        phrase.id,
      );
    }

    // Climax: at the phrase's planned peak position, resolved to a beat rather
    // than a bar. Rounding to whole bars puts the peak of a two-bar phrase on
    // its own first downbeat, where it collides with the phrase start and one
    // of the two is lost.
    const phraseBeats = phraseBars * beatsPerBar;
    const climaxBeatOffset = clamp(
      Math.floor(phrase.climaxPosition * phraseBeats),
      0,
      phraseBeats - 1,
    );
    const climaxBar = phrase.startBar + Math.floor(climaxBeatOffset / beatsPerBar);
    const climaxBeat = climaxBeatOffset % beatsPerBar;
    const climaxTick = climaxBar * ticksPerBar + climaxBeat * ticksPerBeat;
    const climaxChord = chordAt(chords, climaxTick);
    if (climaxChord) {
      const height = low + span * climaxHeightFraction(phraseIndex, phrases.length);
      add(
        climaxBar,
        climaxBeat,
        pickChordTone(climaxChord, height, `${phrase.id}-climax`, phraseIndex),
        height,
        "climax",
        phrase.id,
      );
    }

    if (phrase.cadenceStrength < CADENTIAL_THRESHOLD) continue;

    // Resolution: the downbeat of the phrase's last bar.
    const resolutionBar = phrase.endBar - 1;
    const resolutionTick = resolutionBar * ticksPerBar;
    const resolutionChord = chordAt(chords, resolutionTick);
    if (!resolutionChord) continue;
    const resolutionHeight = low + span * 0.4;
    const resolutionPitchClass =
      isLastPhrase && resolvesToTonic
        ? tonicSemitone
        : pitchClassToSemitone(resolutionChord.root);
    add(
      resolutionBar,
      0,
      resolutionPitchClass,
      resolutionHeight,
      "cadentialResolution",
      phrase.id,
    );

    // Preparation: a step above the resolution, on the beat before it, so the
    // cadence is approached rather than merely arrived at. A step above is the
    // conventional descent onto a close and works in every mode; a step below
    // would be the leading tone, which is only available under some harmonies.
    const preparationMidi = nearestPitchInRange(
      resolutionPitchClass,
      resolutionHeight,
      low,
      high,
    );
    if (preparationMidi === null) continue;
    const preparationBeat = beatsPerBar - 1;
    const preparationBar = resolutionBar - 1;
    if (preparationBar < phrase.startBar) continue;
    const preparationTick = preparationBar * ticksPerBar + preparationBeat * ticksPerBeat;
    const preparationChord = chordAt(chords, preparationTick);
    if (!preparationChord) continue;
    add(
      preparationBar,
      preparationBeat,
      (resolutionPitchClass + 2) % 12,
      preparationMidi + 2,
      "cadentialPreparation",
      phrase.id,
    );
  }

  // One structural note per tick: where two land together the more structural
  // role wins, so a climax that coincides with a phrase start reads as a climax.
  const byTick = new Map<number, MelodicSkeletonNote>();
  for (const note of planned) {
    const existing = byTick.get(note.tick);
    if (
      !existing ||
      ROLE_PRIORITY[note.structuralRole] > ROLE_PRIORITY[existing.structuralRole]
    ) {
      byTick.set(note.tick, note);
    }
  }
  return [...byTick.values()].sort((left, right) => left.tick - right.tick);
}

/**
 * The register the plan implies at a tick, interpolated between structural notes.
 *
 * Pinning the structural notes alone is not enough to shape a line. The free
 * notes around them are still chosen on local grounds, so a phrase can reach
 * its highest pitch nowhere near its planned climax and the arch never appears
 * in the music. Interpolating gives every note a register to be weighed
 * against, which is what turns a set of points into a shape.
 */
export function skeletonRegisterAt(
  skeleton: readonly MelodicSkeletonNote[] | undefined,
  tick: number,
): number | null {
  if (!skeleton || skeleton.length === 0) return null;
  const first = skeleton[0] as MelodicSkeletonNote;
  const last = skeleton[skeleton.length - 1] as MelodicSkeletonNote;
  if (tick <= first.tick) return first.targetMidi;
  if (tick >= last.tick) return last.targetMidi;

  for (let index = 1; index < skeleton.length; index += 1) {
    const previous = skeleton[index - 1] as MelodicSkeletonNote;
    const next = skeleton[index] as MelodicSkeletonNote;
    if (tick > next.tick) continue;
    const span = next.tick - previous.tick;
    if (span <= 0) return next.targetMidi;
    const progress = (tick - previous.tick) / span;
    return previous.targetMidi + (next.targetMidi - previous.targetMidi) * progress;
  }
  return last.targetMidi;
}

/** The structural note a bar carries, if any. */
export function skeletonNotesInBar(
  skeleton: readonly MelodicSkeletonNote[] | undefined,
  barIndex: number,
): MelodicSkeletonNote[] {
  if (!skeleton) return [];
  return skeleton.filter((note) => note.barIndex === barIndex);
}

/**
 * The highest structural note of a plan.
 *
 * Reported rather than used in generation: it is the quickest way to check that
 * a plan actually arches instead of sitting flat.
 */
export function skeletonPeak(
  skeleton: readonly MelodicSkeletonNote[],
): MelodicSkeletonNote | null {
  let peak: MelodicSkeletonNote | null = null;
  for (const note of skeleton) {
    if (!peak || note.targetMidi > peak.targetMidi) peak = note;
  }
  return peak;
}
