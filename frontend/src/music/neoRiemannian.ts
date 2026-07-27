import type { CanonicalPitchClass } from "../types/music";
import { pitchClassToSemitone, semitoneToPitchClass } from "./scales";

/**
 * The three contextual inversions used by Neo-Riemannian theory.
 *
 * P keeps the root and fifth, L keeps the third and fifth, and R keeps the root
 * and third. Each transformation changes exactly one pitch class by one or two
 * semitones. They are candidate moves, not a global distance metric.
 */
export type NeoRiemannianOperation = "P" | "L" | "R";
export type TriadQuality = "major" | "minor";

export interface NeoRiemannianTriad {
  root: CanonicalPitchClass;
  quality: TriadQuality;
}

export function transformTriad(
  chord: NeoRiemannianTriad,
  operation: NeoRiemannianOperation,
): NeoRiemannianTriad {
  const root = pitchClassToSemitone(chord.root);
  if (operation === "P") {
    return {
      root: chord.root,
      quality: chord.quality === "major" ? "minor" : "major",
    };
  }
  if (operation === "L") {
    return chord.quality === "major"
      ? { root: semitoneToPitchClass(root + 4), quality: "minor" }
      : { root: semitoneToPitchClass(root - 4), quality: "major" };
  }
  return chord.quality === "major"
    ? { root: semitoneToPitchClass(root - 3), quality: "minor" }
    : { root: semitoneToPitchClass(root + 3), quality: "major" };
}

export function transformTriadPath(
  start: NeoRiemannianTriad,
  operations: readonly NeoRiemannianOperation[],
): NeoRiemannianTriad[] {
  const result = [start];
  for (const operation of operations) {
    result.push(transformTriad(result[result.length - 1] as NeoRiemannianTriad, operation));
  }
  return result;
}

export function triadPitchClasses(chord: NeoRiemannianTriad): number[] {
  const root = pitchClassToSemitone(chord.root);
  const third = chord.quality === "major" ? 4 : 3;
  return [root, (root + third) % 12, (root + 7) % 12].sort((left, right) => left - right);
}

function circularDistance(left: number, right: number): number {
  const direct = Math.abs(left - right) % 12;
  return Math.min(direct, 12 - direct);
}

/**
 * Exact taxicab distance for two fixed-cardinality pitch-class multisets.
 *
 * Cardinalities must match. This deliberate restriction follows Tymoczko's
 * warning that paths mixing different voice counts do not compose into one
 * meaningful voice-leading distance.
 */
export function fixedCardinalityVoiceLeadingDistance(
  from: readonly number[],
  to: readonly number[],
): number {
  if (from.length !== to.length || from.length === 0) {
    throw new RangeError("Voice-leading distance requires equal non-zero cardinality.");
  }

  const used = new Set<number>();
  let best = Number.POSITIVE_INFINITY;
  const search = (voice: number, total: number): void => {
    if (total >= best) return;
    if (voice === from.length) {
      best = total;
      return;
    }
    for (let target = 0; target < to.length; target += 1) {
      if (used.has(target)) continue;
      used.add(target);
      search(
        voice + 1,
        total + circularDistance(from[voice] as number, to[target] as number),
      );
      used.delete(target);
    }
  };
  search(0, 0);
  return best;
}

export function neoRiemannianMoveDistance(
  chord: NeoRiemannianTriad,
  operation: NeoRiemannianOperation,
): number {
  return fixedCardinalityVoiceLeadingDistance(
    triadPitchClasses(chord),
    triadPitchClasses(transformTriad(chord, operation)),
  );
}
