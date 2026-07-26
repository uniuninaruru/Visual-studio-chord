import { PPQ, type TimeSignature } from "../types/music";
import type { RhythmSlot } from "./rhythmGenerator";
import { ticksPerBar } from "./time";

/**
 * Euclidean rhythms.
 *
 * The rhythm generator partitioned a bar into slots and then decided which were
 * rests, one at a time. That produces variety and cannot produce a groove,
 * because a groove is not a set of independent decisions — it is a particular
 * way of spacing a fixed number of hits, and the ear recognises the spacing.
 *
 * Spread k onsets as evenly as possible over n steps and you get, with no
 * musical input at all, a startling number of the patterns that traditional
 * music actually uses: the tresillo, the cinquillo, the Venda and West African
 * bell patterns. The distribution is the same one Euclid's algorithm computes
 * for the greatest common divisor, which is where the name comes from.
 */

export interface EuclideanSettings {
  /** Number of onsets in the bar. */
  onsets: number;
  /** Number of grid steps the bar is divided into. */
  steps: number;
  /** Steps to rotate the pattern by. Rotating changes which onset is the downbeat. */
  rotation?: number;
}

/**
 * Bjorklund's algorithm: the most even distribution of k onsets over n steps.
 *
 * Written out rather than approximated with a Bresenham line, which produces a
 * rotation of the same pattern. The rotations are equally even and only one of
 * them is the named rhythm — E(5,8) is the cinquillo as `x.xx.xx.`, and the
 * Bresenham answer is a different starting point of the same necklace.
 */
export function euclideanPattern(
  onsets: number,
  steps: number,
  rotation = 0,
): boolean[] {
  if (!Number.isInteger(steps) || steps <= 0) return [];
  const k = Math.max(0, Math.min(steps, Math.trunc(onsets)));
  if (k === 0) return Array.from({ length: steps }, () => false);
  if (k === steps) return Array.from({ length: steps }, () => true);

  let head: boolean[][] = Array.from({ length: k }, () => [true]);
  let tail: boolean[][] = Array.from({ length: steps - k }, () => [false]);

  while (tail.length > 1) {
    const pairs = Math.min(head.length, tail.length);
    const merged = Array.from({ length: pairs }, (_, index) => [
      ...(head[index] as boolean[]),
      ...(tail[index] as boolean[]),
    ]);
    const leftover = head.length > pairs ? head.slice(pairs) : tail.slice(pairs);
    head = merged;
    tail = leftover;
  }

  const flat = [...head, ...tail].flat();
  const shift = ((Math.trunc(rotation) % steps) + steps) % steps;
  return flat.map((_, index) => flat[(index + shift) % steps] as boolean);
}

/**
 * Euclidean patterns that traditional music has a name for.
 *
 * Keyed by onsets/steps. Included because they are the evidence that the
 * algorithm is finding something real rather than merely something regular.
 */
export const NAMED_EUCLIDEAN_RHYTHMS: Readonly<Record<string, string>> = {
  "2/3": "Trochoid",
  "2/5": "Classical rumba cell",
  "3/4": "Cumbia",
  "3/8": "Tresillo",
  "4/9": "Turkish aksak",
  "5/8": "Cinquillo",
  "5/12": "Venda",
  "5/16": "Bossa nova",
  "7/8": "Bulgarian",
  "7/12": "West African bell",
  "7/16": "Brazilian necklace",
  "9/16": "Central African",
  "11/24": "Central African",
};

/** The traditional name of a pattern, if it has one. */
export function euclideanRhythmName(onsets: number, steps: number): string | null {
  return NAMED_EUCLIDEAN_RHYTHMS[`${onsets}/${steps}`] ?? null;
}

export interface EuclideanBarOptions {
  timeSignature: TimeSignature;
  settings: EuclideanSettings;
  barIndex: number;
  ppq?: number;
}

/**
 * A bar of rhythm slots from a Euclidean pattern.
 *
 * Every slot runs from one onset to the next, so a sounded note lasts until the
 * following hit rather than being cut to a fixed length. That is what makes the
 * pattern audible as spacing: the silence after a hit belongs to that hit.
 *
 * Steps that do not divide the bar evenly are handled by giving the remainder to
 * the earliest steps, so the downbeat stays the longest and the grid never
 * drifts off the bar line.
 */
export function euclideanRhythmBar(options: EuclideanBarOptions): RhythmSlot[] {
  const ppq = options.ppq ?? PPQ;
  const barTicks = ticksPerBar(options.timeSignature, ppq);
  const steps = Math.max(1, Math.trunc(options.settings.steps));
  const pattern = euclideanPattern(
    options.settings.onsets,
    steps,
    options.settings.rotation ?? 0,
  );
  if (pattern.length === 0) return [];

  const base = Math.floor(barTicks / steps);
  const remainder = barTicks % steps;
  const stepTicks = Array.from(
    { length: steps },
    (_, index) => base + (index < remainder ? 1 : 0),
  );

  const barStart = options.barIndex * barTicks;
  const starts: number[] = [];
  let cursor = barStart;
  for (const ticks of stepTicks) {
    starts.push(cursor);
    cursor += ticks;
  }

  const onsetIndices = pattern
    .map((hit, index) => (hit ? index : -1))
    .filter((index) => index >= 0);

  // No onsets at all would leave a silent bar the melody generator cannot use.
  if (onsetIndices.length === 0) {
    return [{ startTick: barStart, durationTick: barTicks, isRest: false }];
  }

  const slots: RhythmSlot[] = [];
  // A pattern whose first step is a rest opens with silence, and that silence is
  // part of the groove rather than something to be trimmed away.
  const first = onsetIndices[0] as number;
  if (first > 0) {
    slots.push({
      startTick: barStart,
      durationTick: (starts[first] as number) - barStart,
      isRest: true,
    });
  }

  for (const [position, index] of onsetIndices.entries()) {
    const start = starts[index] as number;
    const nextIndex = onsetIndices[position + 1];
    const end = nextIndex === undefined ? barStart + barTicks : (starts[nextIndex] as number);
    slots.push({ startTick: start, durationTick: end - start, isRest: false });
  }

  return slots;
}

/** How evenly a pattern spreads its onsets: 1 is perfectly even. */
export function evenness(pattern: readonly boolean[]): number {
  const indices = pattern
    .map((hit, index) => (hit ? index : -1))
    .filter((index) => index >= 0);
  if (indices.length < 2) return 1;
  const gaps = indices.map((index, position) => {
    const next = indices[(position + 1) % indices.length] as number;
    return position === indices.length - 1
      ? next + pattern.length - index
      : next - index;
  });
  const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const spread = Math.max(...gaps) - Math.min(...gaps);
  return mean === 0 ? 1 : Math.max(0, 1 - spread / mean);
}
