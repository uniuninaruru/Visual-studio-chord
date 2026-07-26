import type {
  CanonicalPitchClass,
  ChordEvent,
  ChordQuality,
  HarmonyFunction,
  Mode,
  PitchClassName,
  SectionEvent,
} from "../types/music";
import {
  createDiatonicChordEvent,
  getDiatonicChordDefinition,
} from "./chords";
import { harmonyFunctionForDegree } from "./harmonyFunctions";
import { deriveSeed, hashSeed, type Seed } from "./random";
import { pitchClassToSemitone } from "./scales";

/**
 * Modulation.
 *
 * A key change was a single thing: the last section was transposed and simply
 * started in its new key. That is one real technique — a direct modulation, the
 * "truck driver" lift — but it is the bluntest of them, and it was the only one
 * the engine could do.
 *
 * The others differ in how the seam is prepared. A pivot modulation finds a
 * chord that is diatonic in both keys and lets it be heard as belonging to the
 * old one and then the new; by the time the new key asserts itself the ear has
 * already been standing in it. That preparation is the whole difference between
 * a modulation that sounds inevitable and one that sounds like an edit.
 */

export type ModulationType =
  | "tonicization"
  | "pivotChord"
  | "commonTone"
  | "chromaticMediant"
  | "direct"
  | "sequential";

export interface PivotChord {
  /** Scale degree the chord occupies in the key being left. */
  degreeInSource: number;
  /** Scale degree the same chord occupies in the key being entered. */
  degreeInTarget: number;
  root: CanonicalPitchClass;
  quality: ChordQuality;
  functionInSource: HarmonyFunction;
  functionInTarget: HarmonyFunction;
  /** Higher is a better pivot. See PIVOT_SCORES for what earns what. */
  strength: number;
}

export interface ModulationPlan {
  fromKey: PitchClassName;
  fromMode: Mode;
  toKey: PitchClassName;
  toMode: Mode;
  type: ModulationType;
  /** Bar the pivot chord sits in, when there is one. */
  pivotBar?: number;
  pivot?: PivotChord;
  /** Steps around the circle of fifths, 0..6. Two keys a fifth apart score 1. */
  fifthsDistance: number;
}

/**
 * How much each role a pivot can play is worth.
 *
 * A pivot works best as a predominant in the new key: it hands straight to the
 * new dominant, which is what actually establishes the key. Arriving on the new
 * tonic instead announces the destination before it has been prepared, and
 * arriving on its dominant skips the preparation altogether.
 */
const PIVOT_SCORES = {
  predominantInTarget: 3,
  tonicInTarget: 1,
  dominantInTarget: 0.5,
  /**
   * Leaving on the old tonic itself gives the ear nothing to leave from.
   *
   * Keyed on the degree, not on the harmonic function: vi and iii are tonic
   * *substitutes*, and penalising them too would mark down vi, which is the
   * textbook pivot from a key to its dominant (vi of C is ii of G).
   */
  sourceTonicDegreePenalty: 1,
  /** A diminished triad is too unstable to be heard as belonging anywhere. */
  diminishedPenalty: 1.5,
  /** Being a different degree in each key is what makes a pivot reinterpretable. */
  reinterpretationBonus: 0.75,
} as const;

/** Distance around the circle of fifths, 0..6. */
export function fifthsDistance(from: PitchClassName, to: PitchClassName): number {
  const semitones = (pitchClassToSemitone(to) - pitchClassToSemitone(from) + 12) % 12;
  // Multiplying by 7 walks the circle of fifths; the shorter way round wins.
  const steps = (semitones * 7) % 12;
  return Math.min(steps, 12 - steps);
}

interface DiatonicChord {
  degree: number;
  root: CanonicalPitchClass;
  quality: ChordQuality;
  function: HarmonyFunction;
}

/** The seven triads of a key, as roots and qualities. */
function diatonicTriads(key: PitchClassName, mode: Mode): DiatonicChord[] {
  const chords: DiatonicChord[] = [];
  for (let degree = 1; degree <= 7; degree += 1) {
    const definition = getDiatonicChordDefinition(key, mode, degree);
    chords.push({
      degree,
      root: definition.root,
      quality: definition.quality,
      function: harmonyFunctionForDegree(degree, mode),
    });
  }
  return chords;
}

function scorePivot(chord: PivotChord): number {
  let score = 0;
  if (chord.functionInTarget === "predominant") score += PIVOT_SCORES.predominantInTarget;
  else if (chord.functionInTarget === "tonic") score += PIVOT_SCORES.tonicInTarget;
  else if (chord.functionInTarget === "dominant") score += PIVOT_SCORES.dominantInTarget;

  if (chord.degreeInSource === 1) score -= PIVOT_SCORES.sourceTonicDegreePenalty;
  if (chord.quality === "diminished" || chord.quality === "augmented") {
    score -= PIVOT_SCORES.diminishedPenalty;
  }
  if (chord.degreeInSource !== chord.degreeInTarget) {
    score += PIVOT_SCORES.reinterpretationBonus;
  }
  return score;
}

/**
 * Every chord diatonic to both keys, best pivot first.
 *
 * A pivot has to be genuinely the same chord in both — same root and same
 * quality. A shared root with a different quality is not a pivot; it is a
 * chromatic alteration, which the ear hears as a change rather than a hinge.
 */
export function findPivotChords(
  fromKey: PitchClassName,
  fromMode: Mode,
  toKey: PitchClassName,
  toMode: Mode,
): PivotChord[] {
  const target = diatonicTriads(toKey, toMode);
  const pivots: PivotChord[] = [];

  for (const source of diatonicTriads(fromKey, fromMode)) {
    const match = target.find(
      (candidate) =>
        candidate.root === source.root && candidate.quality === source.quality,
    );
    if (!match) continue;
    const pivot: PivotChord = {
      degreeInSource: source.degree,
      degreeInTarget: match.degree,
      root: source.root,
      quality: source.quality,
      functionInSource: source.function,
      functionInTarget: match.function,
      strength: 0,
    };
    pivot.strength = scorePivot(pivot);
    pivots.push(pivot);
  }

  return pivots.sort((left, right) => {
    if (right.strength !== left.strength) return right.strength - left.strength;
    // Deterministic tie-break, so the same two keys always yield the same pivot.
    return left.degreeInSource - right.degreeInSource;
  });
}

export interface ModulationPlanOptions {
  fromKey: PitchClassName;
  fromMode: Mode;
  toKey: PitchClassName;
  toMode: Mode;
  /** Bar the new key begins at; the pivot is placed in the bar before it. */
  targetBar?: number;
  /** Forces a type instead of choosing the strongest available. */
  prefer?: ModulationType;
}

/**
 * Chooses how to get from one key to another.
 *
 * Same key in and out is not a modulation, and says so rather than inventing a
 * pivot for a seam that does not exist.
 */
export function planModulation(options: ModulationPlanOptions): ModulationPlan {
  const { fromKey, fromMode, toKey, toMode } = options;
  const distance = fifthsDistance(fromKey, toKey);
  const base = { fromKey, fromMode, toKey, toMode, fifthsDistance: distance };

  const sameKey =
    pitchClassToSemitone(fromKey) === pitchClassToSemitone(toKey) && fromMode === toMode;
  if (sameKey) return { ...base, type: "direct" };

  if (options.prefer && options.prefer !== "pivotChord") {
    return { ...base, type: options.prefer };
  }

  const [best] = findPivotChords(fromKey, fromMode, toKey, toMode);
  // A pivot that is weaker than the chord it would displace is not worth having:
  // below zero the chord is a diminished triad, or the old tonic, or both.
  if (!best || best.strength <= 0) return { ...base, type: "direct" };

  return {
    ...base,
    type: "pivotChord",
    pivot: best,
    ...(options.targetBar !== undefined && options.targetBar > 0
      ? { pivotBar: options.targetBar - 1 }
      : {}),
  };
}

export interface PivotModulationSettings {
  /** Off leaves every key change as the direct one it was. */
  enabled: boolean;
}

export interface ApplyPivotOptions {
  chords: readonly ChordEvent[];
  sections: readonly SectionEvent[];
  ticksPerBar: number;
  seed: Seed;
  voiceLeadingStrength?: number;
}

export interface PivotModulationResult {
  chords: ChordEvent[];
  plans: ModulationPlan[];
}

/**
 * Prepares each key change by rewriting the chord before it as a pivot.
 *
 * The chord replaced is the last of the outgoing section — the one the ear is
 * sitting on when the new key arrives. Replacing anything earlier would leave
 * the seam itself unprepared, which is the thing this exists to fix.
 *
 * It is written in the terms of the key it sits in — the outgoing one — because
 * that is the section it belongs to and how the rest of that section is
 * analysed. The pitches are identical either way; a pivot is the same chord in
 * both keys, which is what makes it a pivot. The reinterpretation is what the
 * explanation records, and it is the plan that carries it.
 */
export function applyPivotModulations(
  options: ApplyPivotOptions,
): PivotModulationResult {
  const { chords, sections, ticksPerBar, seed } = options;
  const plans: ModulationPlan[] = [];
  if (sections.length < 2 || chords.length === 0) {
    return { chords: [...chords], plans };
  }

  const result = [...chords];
  for (let index = 1; index < sections.length; index += 1) {
    const previous = sections[index - 1] as SectionEvent;
    const current = sections[index] as SectionEvent;
    const plan = planModulation({
      fromKey: previous.key,
      fromMode: previous.mode,
      toKey: current.key,
      toMode: current.mode,
      targetBar: current.startBar,
    });
    if (plan.type !== "pivotChord" || !plan.pivot) continue;

    // The last chord that starts inside the outgoing section.
    const boundaryTick = current.startBar * ticksPerBar;
    let pivotIndex = -1;
    for (const [position, chord] of result.entries()) {
      if (chord.startTick < boundaryTick) pivotIndex = position;
      else break;
    }
    if (pivotIndex < 0) continue;

    const replaced = result[pivotIndex] as ChordEvent;
    const idHash = hashSeed(
      deriveSeed(seed, "pivot", current.id, plan.pivot.degreeInTarget),
    ).toString(36);
    const pivotChord = createDiatonicChordEvent({
      key: previous.key,
      mode: previous.mode,
      degree: plan.pivot.degreeInSource,
      startTick: replaced.startTick,
      durationTick: replaced.durationTick,
      id: `${replaced.id}-pivot-${idHash}`,
      previousNotes: result[pivotIndex - 1]?.notes,
      voiceLeadingStrength: options.voiceLeadingStrength,
    });
    result[pivotIndex] = {
      ...pivotChord,
      explanation:
        `Pivot: ${plan.pivot.root} is degree ${plan.pivot.degreeInSource} of ` +
        `${previous.key} ${previous.mode} and degree ${plan.pivot.degreeInTarget} of ` +
        `${current.key} ${current.mode}.`,
    };
    plans.push({ ...plan, pivotBar: current.startBar - 1 });
  }

  return { chords: result, plans };
}
