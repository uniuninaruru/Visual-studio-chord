import type {
  CadenceType,
  ChordEvent,
  Mode,
} from "../types/music";
import { hasCadence } from "./harmonyFunctions";
import { fixedCardinalityVoiceLeadingDistance } from "./neoRiemannian";
import { pitchClassToSemitone } from "./scales";

export interface ProgressionTransitionAnalysis {
  fromIndex: number;
  toIndex: number;
  commonTones: number;
  commonToneLoss: number;
  /**
   * Exact fixed-cardinality pitch-class voice-leading distance.
   *
   * `null` is intentional when cardinalities differ: those transitions must
   * not be folded into the same distance space.
   */
  voiceLeadingDistance: number | null;
  /** Shortest signed root motion in semitones; +6 is used for a tritone tie. */
  rootMotion: number;
  /** Motion of the actual lowest voices, preserving register and direction. */
  bassMotion: number;
}

export interface ProgressionAnalysis {
  transitions: ProgressionTransitionAnalysis[];
  totalComparableVoiceLeadingDistance: number;
  comparableTransitionCount: number;
  totalCommonToneLoss: number;
  unresolvedAppliedDominants: number[];
  maximumChromaticRun: number;
  realizesCadence: boolean;
}

function uniquePitchClasses(chord: ChordEvent): number[] {
  return [...new Set(chord.notes.map((note) => ((note % 12) + 12) % 12))]
    .sort((left, right) => left - right);
}

function signedCircularMotion(from: number, to: number): number {
  const ascending = ((to - from) % 12 + 12) % 12;
  const descending = ascending - 12;
  return Math.abs(ascending) <= Math.abs(descending) ? ascending : descending;
}

function isChromatic(chord: ChordEvent): boolean {
  return chord.specialKind === "borrowed"
    || chord.specialKind === "secondaryDominant"
    || chord.specialKind === "tritoneSubstitution"
    || chord.specialKind === "chromatic"
    || chord.specialKind === "passingDiminished";
}

export function appliedDominantResolves(
  chord: ChordEvent,
  next: ChordEvent | undefined,
  expectedTargetRoot?: ChordEvent["root"],
): boolean {
  if (
    chord.specialKind !== "secondaryDominant"
    && chord.specialKind !== "tritoneSubstitution"
  ) {
    return true;
  }
  return next !== undefined
    && chord.targetDegree !== undefined
    && next.degree === chord.targetDegree
    && (expectedTargetRoot === undefined || next.root === expectedTargetRoot);
}

/**
 * Reports exact, inspectable progression facts without combining them into an
 * invented floating-point "musical quality" score.
 */
export function analyzeProgression(
  chords: readonly ChordEvent[],
  cadence: CadenceType,
  mode: Mode,
): ProgressionAnalysis {
  const transitions: ProgressionTransitionAnalysis[] = [];
  const unresolvedAppliedDominants: number[] = [];
  let maximumChromaticRun = 0;
  let chromaticRun = 0;

  for (let index = 0; index < chords.length; index += 1) {
    const chord = chords[index] as ChordEvent;
    const linearNext = chords[index + 1];
    const resolvingNext = linearNext
      ?? (cadence === "loop" ? chords[0] : undefined);
    if (!appliedDominantResolves(chord, resolvingNext)) {
      unresolvedAppliedDominants.push(index);
    }

    chromaticRun = isChromatic(chord) ? chromaticRun + 1 : 0;
    maximumChromaticRun = Math.max(maximumChromaticRun, chromaticRun);

    // The wrap is validated above but omitted from the linear transition list;
    // playback may not actually loop, and the saved span still has N-1 moves.
    if (!linearNext) continue;
    const fromPitchClasses = uniquePitchClasses(chord);
    const toPitchClasses = uniquePitchClasses(linearNext);
    const toSet = new Set(toPitchClasses);
    const commonTones = fromPitchClasses.filter((pitchClass) => toSet.has(pitchClass)).length;
    const comparable = fromPitchClasses.length === toPitchClasses.length;
    const fromBass = Math.min(...chord.notes);
    const toBass = Math.min(...linearNext.notes);
    transitions.push({
      fromIndex: index,
      toIndex: index + 1,
      commonTones,
      commonToneLoss: Math.min(fromPitchClasses.length, toPitchClasses.length) - commonTones,
      voiceLeadingDistance: comparable
        ? fixedCardinalityVoiceLeadingDistance(fromPitchClasses, toPitchClasses)
        : null,
      rootMotion: signedCircularMotion(
        pitchClassToSemitone(chord.root),
        pitchClassToSemitone(linearNext.root),
      ),
      bassMotion: toBass - fromBass,
    });
  }

  const comparable = transitions.filter(
    (transition) => transition.voiceLeadingDistance !== null,
  );
  return {
    transitions,
    totalComparableVoiceLeadingDistance: comparable.reduce(
      (total, transition) => total + (transition.voiceLeadingDistance as number),
      0,
    ),
    comparableTransitionCount: comparable.length,
    totalCommonToneLoss: transitions.reduce(
      (total, transition) => total + transition.commonToneLoss,
      0,
    ),
    unresolvedAppliedDominants,
    maximumChromaticRun,
    realizesCadence: chords.length >= 2 && hasCadence(
      chords.slice(-2).map((chord) => chord.degree),
      cadence,
      mode,
      chords.slice(-2).map((chord) => ({
        degree: chord.degree,
        quality: chord.quality,
      })),
    ),
  };
}
