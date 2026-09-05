import type {
  ChordEvent,
  CanonicalPitchClass,
  Mode,
  PitchClassName,
} from "../types/music";
import { getScaleSemitones, pitchClassToSemitone } from "./scales";

/**
 * A small, dependency-free Tonal Interval Space implementation.
 *
 * This is an independent TypeScript adaptation of the symbolic ideas in
 * Bernardes et al. (2016), Navarro-Cáceres et al. (2020), and the 2025
 * tension-beamsearch preprint. It is deliberately not a Transformer and does
 * not reproduce the 2020 hierarchical-tree term: it is a bar-level reranker
 * for this app's already theory-valid functional-harmony candidates.
 *
 * The 2025 profile coefficients are kept as named constants so callers and
 * tests can audit the decomposition without importing any external code.
 */

export interface ComplexBin {
  real: number;
  imag: number;
}

export type TonalIntervalVector = readonly ComplexBin[];

export const TIS_WEIGHTS = Object.freeze([2, 11, 17, 16, 19, 7] as const);
export const CHORD_DISTANCE_NORMALIZER = 64.8757;
export const TIS_VOICE_PITCH_WEIGHT = 1.5;
export const TIS_VOICE_KEY_WEIGHT = 3.5;
export const TIS_VOICE_FUNCTION_WEIGHT = 1.1;
export const TIS_VOICE_EXPONENT = 0.05;
export const TIS_PROFILE_COEFFICIENTS = Object.freeze({
  chordDistance: 1,
  keyDistance: 1.58,
  tonalFunctionDistance: 1,
  dissonance: 30.3,
  voiceLeading: 2.71,
});

const CHROMA_SIZE = 12;
const ANGLE_EPSILON = 1e-12;
const PEARSON_VARIANCE_FLOOR = 1e-3;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function clamp(value: number, low: number, high: number): number {
  if (!finite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

function normalizePitchClassNumber(value: number): number {
  if (!finite(value)) throw new RangeError("Pitch must be finite.");
  return ((Math.trunc(value) % CHROMA_SIZE) + CHROMA_SIZE) % CHROMA_SIZE;
}

/**
 * Converts MIDI pitches or pitch-class numbers/names to a length-12 count
 * vector. Counts are intentionally retained (rather than binarised), since a
 * voicing with doubled notes has a different chroma mass before normalization.
 */
export function chromaCountVector(
  pitches: readonly (number | PitchClassName | CanonicalPitchClass)[],
): number[] {
  const chroma = Array.from({ length: CHROMA_SIZE }, () => 0);
  for (const pitch of pitches) {
    const pitchClass = typeof pitch === "number"
      ? normalizePitchClassNumber(pitch)
      : pitchClassToSemitone(pitch);
    chroma[pitchClass] = (chroma[pitchClass] as number) + 1;
  }
  return chroma;
}

/** Alias mirroring the notation used by the cited symbolic implementation. */
export const midiToChroma = chromaCountVector;
export const chromaFromPitches = chromaCountVector;

function assertChroma(chroma: readonly number[]): void {
  if (chroma.length !== CHROMA_SIZE || chroma.some((value) => !finite(value) || value < 0)) {
    throw new RangeError("A chroma vector must contain 12 finite non-negative values.");
  }
}

/**
 * Computes weighted DFT bins k=1..6 without a complex-number dependency.
 * The chroma mass is the normalizing denominator, as in the TIV definition.
 */
export function weightedTonalIntervalVector(
  chroma: readonly number[],
): ComplexBin[] {
  assertChroma(chroma);
  const mass = chroma.reduce((sum, value) => sum + value, 0);
  if (!finite(mass) || mass <= 0) {
    return TIS_WEIGHTS.map(() => ({ real: 0, imag: 0 }));
  }
  return TIS_WEIGHTS.map((weight, offset) => {
    const k = offset + 1;
    let real = 0;
    let imag = 0;
    for (let n = 0; n < CHROMA_SIZE; n += 1) {
      const phase = -2 * Math.PI * k * n / CHROMA_SIZE;
      real += (chroma[n] as number) * Math.cos(phase);
      imag += (chroma[n] as number) * Math.sin(phase);
    }
    return { real: weight * real / mass, imag: weight * imag / mass };
  });
}

/** Alias using the name of the normalized FFT primitive in the paper code. */
export const normalFft = weightedTonalIntervalVector;
export const computeTiv = weightedTonalIntervalVector;

export function tonalVectorNorm(vector: TonalIntervalVector): number {
  return Math.sqrt(vector.reduce((sum, bin) => sum + bin.real ** 2 + bin.imag ** 2, 0));
}

/** Euclidean distance in the real representation of complex TIS bins. */
export function euclideanTisDistance(
  first: TonalIntervalVector,
  second: TonalIntervalVector,
): number {
  if (first.length !== second.length) throw new RangeError("TIS vectors must have equal length.");
  return Math.sqrt(first.reduce((sum, bin, index) => {
    const other = second[index] as ComplexBin;
    return sum + (other.real - bin.real) ** 2 + (other.imag - bin.imag) ** 2;
  }, 0));
}

export const compareChords = euclideanTisDistance;

/**
 * Real-complex angular distance. A zero vector has no direction, so its
 * distance is defined as zero, matching the safe behaviour of the reference
 * profile for empty/flat inputs.
 */
export function realComplexAngularDistance(
  first: TonalIntervalVector,
  second: TonalIntervalVector,
): number {
  if (first.length !== second.length) throw new RangeError("TIS vectors must have equal length.");
  const firstNorm = tonalVectorNorm(first);
  const secondNorm = tonalVectorNorm(second);
  if (firstNorm <= ANGLE_EPSILON || secondNorm <= ANGLE_EPSILON) return 0;
  const dot = first.reduce((sum, bin, index) => {
    const other = second[index] as ComplexBin;
    return sum + bin.real * other.real + bin.imag * other.imag;
  }, 0);
  return Math.acos(clamp(dot / (firstNorm * secondNorm), -1, 1));
}

export const angularDistance = realComplexAngularDistance;
export const keyDist = realComplexAngularDistance;

/** Angular distance from a sounding chroma to the active key scale. */
export function keyDistanceForChroma(
  chordChroma: readonly number[],
  key: PitchClassName,
  mode: Mode,
): number {
  return realComplexAngularDistance(
    weightedTonalIntervalVector(chordChroma),
    weightedTonalIntervalVector(scaleChromaVector(key, mode)),
  );
}

/** Dissonance from the TIV norm, clamped to the perceptual 0..1 interval. */
export function dissonanceFromTiv(vector: TonalIntervalVector): number {
  const maximum = Math.sqrt(TIS_WEIGHTS.reduce((sum, weight) => sum + weight ** 2, 0));
  return clamp(1 - tonalVectorNorm(vector) / maximum, 0, 1);
}

export const getDissonance = dissonanceFromTiv;

export function dissonanceForChroma(chroma: readonly number[]): number {
  return dissonanceFromTiv(weightedTonalIntervalVector(chroma));
}

/** Chord-to-chord TIS distance with the published profile normalizer. */
export function chordToChordDistance(
  firstChroma: readonly number[],
  secondChroma: readonly number[],
): number {
  return euclideanTisDistance(
    weightedTonalIntervalVector(firstChroma),
    weightedTonalIntervalVector(secondChroma),
  ) / CHORD_DISTANCE_NORMALIZER;
}

function binaryChroma(pitchClasses: readonly number[]): number[] {
  const chroma = Array.from({ length: CHROMA_SIZE }, () => 0);
  for (const pitchClass of pitchClasses) chroma[normalizePitchClassNumber(pitchClass)] = 1;
  return chroma;
}

export function scaleChromaVector(key: PitchClassName, mode: Mode): number[] {
  return binaryChroma(getScaleSemitones(key, mode));
}

function triadTemplate(root: number, third: number, fifth: number): number[] {
  const result = Array.from({ length: CHROMA_SIZE }, () => 0);
  result[normalizePitchClassNumber(root)] = 2;
  result[normalizePitchClassNumber(third)] = 1;
  result[normalizePitchClassNumber(fifth)] = 1;
  return result;
}

/**
 * Builds the symbolic tonic / dominant / subdominant convention used by the
 * TIS profile. The tonic root is doubled. The dominant is always major (also
 * in minor), while tonic and subdominant use the current mode's diatonic
 * scale. The published perceptual evaluation was mostly major/minor and short
 * progressions; modal support here is a documented symbolic extension.
 */
export function tonalFunctionChromaVectors(
  key: PitchClassName,
  mode: Mode,
): { tonic: number[]; dominant: number[]; subdominant: number[] } {
  const scale = getScaleSemitones(key, mode);
  if (scale.length < 7) throw new RangeError("Mode scale must contain seven degrees.");
  const tonic = triadTemplate(scale[0] as number, scale[2] as number, scale[4] as number);
  const dominantRoot = scale[4] as number;
  const dominant = triadTemplate(dominantRoot, dominantRoot + 4, dominantRoot + 7);
  const subdominantRoot = scale[3] as number;
  const subdominant = triadTemplate(
    subdominantRoot,
    scale[5] as number,
    scale[0] as number,
  );
  return { tonic, dominant, subdominant };
}

function subtractVectors(first: TonalIntervalVector, second: TonalIntervalVector): ComplexBin[] {
  if (first.length !== second.length) throw new RangeError("TIS vectors must have equal length.");
  return first.map((bin, index) => {
    const other = second[index] as ComplexBin;
    return { real: bin.real - other.real, imag: bin.imag - other.imag };
  });
}

/**
 * Minimum angular distance between chord-minus-key and the three function
 * directions (tonic, subdominant, dominant).
 */
export function tonalFunctionDistance(
  chord: TonalIntervalVector,
  key: TonalIntervalVector,
  functions: readonly [TonalIntervalVector, TonalIntervalVector, TonalIntervalVector],
): number {
  const chordMinusKey = subtractVectors(chord, key);
  const distances = functions.map((func) =>
    realComplexAngularDistance(chordMinusKey, subtractVectors(func, key)));
  const result = Math.min(...distances);
  return finite(result) ? result : 0;
}

export const harmotion = tonalFunctionDistance;

/** Convenience wrapper operating on chroma vectors and an active key/mode. */
export function tonalFunctionDistanceForChroma(
  chordChroma: readonly number[],
  key: PitchClassName,
  mode: Mode,
): number {
  const keyVector = weightedTonalIntervalVector(scaleChromaVector(key, mode));
  const functions = tonalFunctionChromaVectors(key, mode);
  return tonalFunctionDistance(
    weightedTonalIntervalVector(chordChroma),
    keyVector,
    [
      weightedTonalIntervalVector(functions.tonic),
      weightedTonalIntervalVector(functions.dominant),
      weightedTonalIntervalVector(functions.subdominant),
    ],
  );
}

function circularPitchClassDistance(first: number, second: number): number {
  const difference = Math.abs(normalizePitchClassNumber(first) - normalizePitchClassNumber(second));
  return Math.min(difference, CHROMA_SIZE - difference);
}

function uniquePitchClasses(chroma: readonly number[]): number[] {
  assertChroma(chroma);
  return chroma
    .map((value, pitchClass) => (value > 0 ? pitchClass : -1))
    .filter((pitchClass) => pitchClass >= 0);
}

function normalizePitchClassSet(pitchClasses: readonly number[]): number[] {
  return [...new Set(pitchClasses.map(normalizePitchClassNumber))].sort((left, right) => left - right);
}

export interface VoiceLeadingMapping {
  cost: number;
  pairs: readonly [number, number][];
}

function rotateRight(values: readonly number[], amount: number): number[] {
  if (values.length === 0) return [];
  const offset = ((amount % values.length) + values.length) % values.length;
  return values.slice(values.length - offset).concat(values.slice(0, values.length - offset));
}

function rotateLeft(values: readonly number[], amount: number): number[] {
  if (values.length === 0) return [];
  const offset = ((amount % values.length) + values.length) % values.length;
  return values.slice(offset).concat(values.slice(0, offset));
}

/** Minimum circular mapping for equal-cardinality pitch-class sets. */
export function minimumCircularVoiceLeading(
  source: readonly number[],
  target: readonly number[],
): VoiceLeadingMapping {
  const normalizedSource = normalizePitchClassSet(source);
  const normalizedTarget = normalizePitchClassSet(target);
  if (normalizedSource.length !== normalizedTarget.length) throw new RangeError("Equal-cardinality mapping required.");
  if (normalizedSource.length === 0) return { cost: 0, pairs: [] };
  let best: VoiceLeadingMapping | undefined;
  for (let step = 0; step < normalizedTarget.length; step += 1) {
    // The reference ordering starts at one right rotation and visits the
    // unrotated set only at the end. This matters when two rotations tie.
    const rotation = (step + 1) % normalizedTarget.length;
    const rotated = rotateRight(normalizedTarget, rotation);
    const pairs = normalizedSource.map((pitchClass, index) => [pitchClass, rotated[index] as number] as [number, number]);
    const cost = pairs.reduce((sum, pair) => sum + circularPitchClassDistance(pair[0], pair[1]), 0);
    // Strict comparison is intentional: the prescribed first right rotation
    // wins exact ties, then the first later rotation wins.
    if (!best || cost < best.cost) best = { cost, pairs };
  }
  return best as VoiceLeadingMapping;
}

interface DynamicCell {
  cost: number;
  previous: [number, number] | null;
}

/**
 * Minimum non-bijective mapping for different cardinalities. Each left-rotated
 * target is closed by repeating its first pitch class, as is the source. The
 * cumulative local-cost DP then finds the path through those two closed
 * sequences. The closing pair is removed from the returned path and its local
 * cost is removed from the score. Tie order is diagonal, left, up, and strict
 * rotation comparison keeps the first minimum.
 */
export function minimumNonBijectiveVoiceLeading(
  source: readonly number[],
  target: readonly number[],
): VoiceLeadingMapping {
  const normalizedSource = normalizePitchClassSet(source);
  const normalizedTarget = normalizePitchClassSet(target);
  if (normalizedSource.length === normalizedTarget.length) return minimumCircularVoiceLeading(normalizedSource, normalizedTarget);
  if (normalizedSource.length === 0 || normalizedTarget.length === 0) return { cost: 0, pairs: [] };

  let best: VoiceLeadingMapping | undefined;
  for (let rotation = 0; rotation < normalizedTarget.length; rotation += 1) {
    const rotated = rotateLeft(normalizedTarget, rotation);
    const sourceClosed = [...normalizedSource, normalizedSource[0] as number];
    const targetClosed = [...rotated, rotated[0] as number];
    const cells: DynamicCell[][] = Array.from({ length: targetClosed.length }, () =>
      Array.from({ length: sourceClosed.length }, () => ({ cost: Number.POSITIVE_INFINITY, previous: null })));
    const localCost = (sourceIndex: number, targetIndex: number): number =>
      circularPitchClassDistance(sourceClosed[sourceIndex] as number, targetClosed[targetIndex] as number);
    cells[0]![0] = { cost: localCost(0, 0), previous: null };
    for (let sourceIndex = 1; sourceIndex < sourceClosed.length; sourceIndex += 1) {
      cells[0]![sourceIndex] = {
        cost: cells[0]![sourceIndex - 1]!.cost + localCost(sourceIndex, 0),
        previous: [0, sourceIndex - 1],
      };
    }
    for (let targetIndex = 1; targetIndex < targetClosed.length; targetIndex += 1) {
      cells[targetIndex]![0] = {
        cost: cells[targetIndex - 1]![0]!.cost + localCost(0, targetIndex),
        previous: [targetIndex - 1, 0],
      };
    }
    for (let targetIndex = 1; targetIndex < targetClosed.length; targetIndex += 1) {
      for (let sourceIndex = 1; sourceIndex < sourceClosed.length; sourceIndex += 1) {
        const pairCost = localCost(sourceIndex, targetIndex);
        const diagonal = cells[targetIndex - 1]![sourceIndex - 1]!.cost;
        const left = cells[targetIndex]![sourceIndex - 1]!.cost;
        const up = cells[targetIndex - 1]![sourceIndex]!.cost;
        if (diagonal <= left && diagonal <= up) {
          cells[targetIndex]![sourceIndex] = {
            cost: diagonal + pairCost,
            previous: [targetIndex - 1, sourceIndex - 1],
          };
        } else if (left <= up) {
          cells[targetIndex]![sourceIndex] = {
            cost: left + pairCost,
            previous: [targetIndex, sourceIndex - 1],
          };
        } else {
          cells[targetIndex]![sourceIndex] = {
            cost: up + pairCost,
            previous: [targetIndex - 1, sourceIndex],
          };
        }
      }
    }

    const pairs: [number, number][] = [];
    let sourceIndex = sourceClosed.length - 1;
    let targetIndex = targetClosed.length - 1;
    while (sourceIndex > 0 || targetIndex > 0) {
      pairs.push([
        sourceClosed[sourceIndex] as number,
        targetClosed[targetIndex] as number,
      ]);
      const previous = cells[targetIndex]![sourceIndex]!.previous;
      if (!previous) break;
      [targetIndex, sourceIndex] = previous;
    }
    pairs.push([sourceClosed[0] as number, targetClosed[0] as number]);
    pairs.reverse();
    pairs.pop();
    const endpointCost = localCost(sourceClosed.length - 1, targetClosed.length - 1);
    const cost = cells[targetClosed.length - 1]![sourceClosed.length - 1]!.cost - endpointCost;
    if (!best || cost < best.cost) best = { cost, pairs };
  }
  return best ?? { cost: 0, pairs: [] };
}

export function minimumVoiceLeading(
  source: readonly number[],
  target: readonly number[],
): VoiceLeadingMapping {
  const normalizedSource = normalizePitchClassSet(source);
  const normalizedTarget = normalizePitchClassSet(target);
  return normalizedSource.length === normalizedTarget.length
    ? minimumCircularVoiceLeading(normalizedSource, normalizedTarget)
    : minimumNonBijectiveVoiceLeading(normalizedSource, normalizedTarget);
}

function voiceLeadingFeature(
  sourceChroma: readonly number[],
  targetChroma: readonly number[],
  keyVector: TonalIntervalVector,
  functionVectors: readonly [TonalIntervalVector, TonalIntervalVector, TonalIntervalVector],
): number {
  const source = uniquePitchClasses(sourceChroma);
  const target = uniquePitchClasses(targetChroma);
  if (source.length === 0 || target.length === 0) return 0;
  const mapping = minimumVoiceLeading(source, target);
  let totalDistance = 0;
  for (const [sourcePitch, targetPitch] of mapping.pairs) {
    const sourceVector = weightedTonalIntervalVector(chromaCountVector([sourcePitch]));
    const targetVector = weightedTonalIntervalVector(chromaCountVector([targetPitch]));
    const pitchDistance = euclideanTisDistance(sourceVector, targetVector) / CHORD_DISTANCE_NORMALIZER;
    const keyDistance = realComplexAngularDistance(targetVector, keyVector);
    const functionDistance = tonalFunctionDistance(targetVector, keyVector, functionVectors);
    totalDistance +=
      TIS_VOICE_PITCH_WEIGHT * pitchDistance +
      TIS_VOICE_KEY_WEIGHT * keyDistance +
      TIS_VOICE_FUNCTION_WEIGHT * functionDistance;
  }
  const exponent = TIS_VOICE_EXPONENT * mapping.cost * totalDistance;
  return finite(exponent) ? Math.exp(-exponent) : 0;
}

/** Exported for audit tests; inputs are length-12 chroma count vectors. */
export function tisVoiceLeading(
  sourceChroma: readonly number[],
  targetChroma: readonly number[],
  key: PitchClassName,
  mode: Mode,
): number {
  const keyVector = weightedTonalIntervalVector(scaleChromaVector(key, mode));
  const functions = tonalFunctionChromaVectors(key, mode);
  return voiceLeadingFeature(sourceChroma, targetChroma, keyVector, [
    weightedTonalIntervalVector(functions.tonic),
    weightedTonalIntervalVector(functions.dominant),
    weightedTonalIntervalVector(functions.subdominant),
  ]);
}

export const TISVoices = tisVoiceLeading;

export interface TonalTensionComponents {
  chordDistance: number;
  keyDistance: number;
  tonalFunctionDistance: number;
  dissonance: number;
  voiceLeading: number;
  total: number;
}

function finiteComponents(components: TonalTensionComponents): boolean {
  return Object.values(components).every((value) => finite(value));
}

/** Computes one chord's complete 2025-profile decomposition. */
export function computeChordTonalTension(
  chord: ChordEvent,
  previousChord: ChordEvent | undefined,
  key: PitchClassName,
  mode: Mode,
): TonalTensionComponents {
  const chordChroma = chromaCountVector(chord.notes);
  const previousChroma = previousChord ? chromaCountVector(previousChord.notes) : undefined;
  const keyVector = weightedTonalIntervalVector(scaleChromaVector(key, mode));
  const functions = tonalFunctionChromaVectors(key, mode);
  const functionVectors: readonly [TonalIntervalVector, TonalIntervalVector, TonalIntervalVector] = [
    weightedTonalIntervalVector(functions.tonic),
    weightedTonalIntervalVector(functions.dominant),
    weightedTonalIntervalVector(functions.subdominant),
  ];
  const chordVector = weightedTonalIntervalVector(chordChroma);
  const chordDistance = previousChroma
    ? euclideanTisDistance(
      weightedTonalIntervalVector(previousChroma),
      chordVector,
    ) / CHORD_DISTANCE_NORMALIZER
    : 0;
  const keyDistance = realComplexAngularDistance(chordVector, keyVector);
  const functionDistance = tonalFunctionDistance(chordVector, keyVector, functionVectors);
  const dissonance = dissonanceFromTiv(chordVector);
  const voiceLeading = previousChroma
    ? voiceLeadingFeature(previousChroma, chordChroma, keyVector, functionVectors)
    : 0;
  const total =
    TIS_PROFILE_COEFFICIENTS.chordDistance * chordDistance +
    TIS_PROFILE_COEFFICIENTS.keyDistance * keyDistance +
    TIS_PROFILE_COEFFICIENTS.tonalFunctionDistance * functionDistance +
    TIS_PROFILE_COEFFICIENTS.dissonance * dissonance +
    TIS_PROFILE_COEFFICIENTS.voiceLeading * voiceLeading;
  const result = {
    chordDistance,
    keyDistance,
    tonalFunctionDistance: functionDistance,
    dissonance,
    voiceLeading,
    total,
  } satisfies TonalTensionComponents;
  if (!finiteComponents(result)) throw new RangeError("TIS profile produced a non-finite component.");
  return result;
}

export const computeTonalTension = computeChordTonalTension;

export interface TonalBarCurveOptions {
  chords: readonly ChordEvent[];
  key: PitchClassName;
  mode: Mode;
  ticksPerBar: number;
  bars: number;
}

/**
 * Aggregates chord totals into bars using integer tick intersections. A chord
 * crossing a bar boundary contributes only the ticks it actually occupies in
 * that bar; no floating seconds or BPM conversion is involved.
 */
export function aggregateTonalTensionBars(options: TonalBarCurveOptions): number[] {
  const { chords, key, mode, ticksPerBar, bars } = options;
  if (!Number.isInteger(ticksPerBar) || ticksPerBar <= 0 || !Number.isInteger(bars) || bars <= 0) {
    throw new RangeError("Bar aggregation requires positive integer ticksPerBar and bars.");
  }
  const values = chords.map((chord, index) => computeChordTonalTension(
    chord,
    index > 0 ? chords[index - 1] : undefined,
    key,
    mode,
  ));
  return Array.from({ length: bars }, (_, barIndex) => {
    const start = barIndex * ticksPerBar;
    const end = start + ticksPerBar;
    let weighted = 0;
    let duration = 0;
    for (const [index, chord] of chords.entries()) {
      const chordStart = chord.startTick;
      const chordEnd = chord.startTick + chord.durationTick;
      const overlap = Math.max(0, Math.min(end, chordEnd) - Math.max(start, chordStart));
      if (overlap <= 0) continue;
      const value = values[index]!.total;
      if (!finite(value)) throw new RangeError("TIS bar value is non-finite.");
      weighted += overlap * value;
      duration += overlap;
    }
    return duration > 0 && finite(weighted / duration) ? weighted / duration : 0;
  });
}

export function tonalTensionBarCurve(options: TonalBarCurveOptions): number[] {
  return aggregateTonalTensionBars(options);
}

export interface TonalCurveCandidate {
  chords: readonly ChordEvent[];
  /** Original beam position, retained when duplicate candidates are removed. */
  originalIndex?: number;
}

export interface TonalCandidateRanking {
  selectedIndex: number;
  selectedOriginalIndex: number;
  originalIndices: readonly number[];
  scores: readonly number[];
  curves: readonly (readonly number[])[];
}

function curveVariance(curve: readonly number[]): number {
  if (curve.length === 0) return 0;
  const mean = curve.reduce((sum, value) => sum + value, 0) / curve.length;
  return curve.reduce((sum, value) => sum + (value - mean) ** 2, 0) / curve.length;
}

function validCurve(curve: readonly number[]): boolean {
  return curve.length > 0 && curve.every((value) => finite(value));
}

/** Pearson correlation, returned as zero for degenerate/non-finite inputs. */
export function pearsonCorrelation(
  first: readonly number[],
  second: readonly number[],
): number {
  if (first.length !== second.length || first.length === 0 || !validCurve(first) || !validCurve(second)) return 0;
  const firstMean = first.reduce((sum, value) => sum + value, 0) / first.length;
  const secondMean = second.reduce((sum, value) => sum + value, 0) / second.length;
  let numerator = 0;
  let firstVariance = 0;
  let secondVariance = 0;
  for (let index = 0; index < first.length; index += 1) {
    const left = (first[index] as number) - firstMean;
    const right = (second[index] as number) - secondMean;
    numerator += left * right;
    firstVariance += left ** 2;
    secondVariance += right ** 2;
  }
  const denominator = Math.sqrt(firstVariance * secondVariance);
  return denominator <= ANGLE_EPSILON ? 0 : clamp(numerator / denominator, -1, 1);
}

/**
 * Scores a candidate against a target contour. Non-flat curves use Pearson
 * correlation once both variances reach 1e-3. Otherwise we use a deterministic
 * flatness fallback, never raw means: app energy values are 0..1 while TIS
 * totals are on a much larger profile scale.
 */
export function targetSimilarity(
  candidate: readonly number[],
  target: readonly number[],
): number {
  if (candidate.length !== target.length || !validCurve(candidate) || !validCurve(target)) return 0;
  const candidateVariance = curveVariance(candidate);
  const targetVariance = curveVariance(target);
  if (candidateVariance >= PEARSON_VARIANCE_FLOOR && targetVariance >= PEARSON_VARIANCE_FLOOR) {
    return pearsonCorrelation(candidate, target);
  }
  if (targetVariance < PEARSON_VARIANCE_FLOOR) {
    if (candidateVariance < PEARSON_VARIANCE_FLOOR) return 1;
    // A flat target has no shape to correlate. Compare only bounded
    // dispersion, monotonically favouring the flatter candidate without
    // comparing the app's raw energy mean to the TIS scale.
    return 1 / (1 + Math.max(0, candidateVariance));
  }
  // The target is non-flat and the candidate is below the variance floor.
  return -1;
}

export function rankTonalCurves(
  curves: readonly (readonly number[])[],
  target: readonly number[],
): { selectedIndex: number; scores: readonly number[] } {
  if (curves.length === 0) return { selectedIndex: 0, scores: [] };
  // A partial metric result is not a meaningful ranking. The caller can then
  // return the already generated candidate zero byte-for-byte instead of
  // silently allowing a surviving candidate to win over a failed one.
  if (!validCurve(target) || curves.some((curve) =>
    !validCurve(curve) || curve.length !== target.length)) {
    return { selectedIndex: 0, scores: curves.map(() => 0) };
  }
  const scores = curves.map((curve) => targetSimilarity(curve, target));
  let selectedIndex = 0;
  for (let index = 1; index < scores.length; index += 1) {
    // Strict comparison keeps candidate 0 ahead of later ties.
    if ((scores[index] as number) > (scores[selectedIndex] as number)) selectedIndex = index;
  }
  return { selectedIndex, scores };
}

/**
 * Profiles and ranks already generated candidates. Failures are represented
 * by a zero score and candidate 0 remains the stable fallback.
 */
export function rankTonalCandidates(
  candidates: readonly TonalCurveCandidate[],
  options: Omit<TonalBarCurveOptions, "chords"> & { target: readonly number[] },
): TonalCandidateRanking {
  const curves = candidates.map((candidate) => {
    try {
      const curve = aggregateTonalTensionBars({ ...options, chords: candidate.chords });
      return validCurve(curve) && curve.length === options.bars ? curve : [];
    } catch {
      return [];
    }
  });
  const ranked = rankTonalCurves(curves, options.target);
  const originalIndices = candidates.map((candidate, index) => candidate.originalIndex ?? index);
  return {
    ...ranked,
    selectedOriginalIndex: originalIndices[ranked.selectedIndex] ?? 0,
    originalIndices,
    curves,
  };
}

/**
 * Audible identity used to discard duplicate beam candidates. Root/quality is
 * retained for auditability, while tick placement, duration, and the sorted
 * MIDI notes make doubling and voicing differences survive deduplication.
 */
export function audibleChordIdentity(chord: ChordEvent): string {
  const notes = [...chord.notes].sort((left, right) => left - right).join(",");
  return `${chord.root}:${chord.quality}:${chord.startTick}:${chord.durationTick}:${notes}:${chord.bass ?? ""}`;
}

export function audibleProgressionIdentity(chords: readonly ChordEvent[]): string {
  return chords.map(audibleChordIdentity).join("|");
}
