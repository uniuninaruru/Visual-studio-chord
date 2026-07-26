import type {
  CanonicalPitchClass,
  ChordQuality,
  Mode,
  PitchClassName,
  StylePresetId,
} from "../types/music";
import { formatChordSymbol, getDiatonicChordDefinition, intervalsForQuality } from "./chords";
import { pitchClassToSemitone, semitoneToPitchClass } from "./scales";

/**
 * Chromatic mediants and symmetric harmony.
 *
 * Everything the engine could reach was tied to a tonic: a chord was diatonic,
 * or borrowed from a parallel scale, or a dominant of something. All of those
 * are functional — they mean something *relative to a key*.
 *
 * These do not. A chromatic mediant is a chord a third away that shares a single
 * note with the one before it, and the effect comes from that shared note
 * holding while everything around it moves somewhere unrelated. Symmetric
 * harmony goes further: a whole-tone or octatonic scale divides the octave
 * evenly, so no note in it is a tonic and no chord built from it has a function.
 * That is why both are the sound of film and game scores — they suspend the
 * question of what key the music is in rather than answering it.
 */

/** Semitone distances that make a chord a mediant: thirds, up or down. */
export type MediantDistance = 3 | 4 | 8 | 9;

export const MEDIANT_DISTANCES: readonly MediantDistance[] = [3, 4, 8, 9];

/**
 * How chromatic a mediant relation is, by how much the two chords share.
 *
 * The three cases are forced by the arithmetic of thirds: two triads a third
 * apart share two notes when the relation is diatonic, exactly one when they are
 * the same quality, and none when they are not. So the quality relation and the
 * common-tone count are two views of one fact, and the kind is the useful name
 * for it.
 */
export type MediantKind = "diatonic" | "chromatic" | "doublyChromatic";

export interface ChromaticMediantRelation {
  rootDistance: MediantDistance;
  /** How many pitch classes the two chords have in common: 2, 1 or 0. */
  sharedPitchClasses: number;
  modeRelation: "sameQuality" | "mixedQuality";
  kind: MediantKind;
}

function mediantKind(shared: number): MediantKind {
  if (shared >= 2) return "diatonic";
  return shared === 1 ? "chromatic" : "doublyChromatic";
}

export interface ChromaticMediantCandidate extends ChromaticMediantRelation {
  root: CanonicalPitchClass;
  quality: ChordQuality;
  symbol: string;
  /** True when the chord is not diatonic to the key it is being used in. */
  chromatic: boolean;
  /** 0..1, weighted for the style asked about. */
  weight: number;
}

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

function pitchClassesOf(rootSemitone: number, quality: ChordQuality): Set<number> {
  return new Set(intervalsForQuality(quality).map((interval) => mod12(rootSemitone + interval)));
}

/**
 * How much each style reaches for a chromatic mediant.
 *
 * Film and game scoring lean on them hardest — they are the standard way to make
 * harmony feel large without committing to a key. Jazz has other tools for the
 * same job and uses them less; four-chord pop almost never does.
 */
const MEDIANT_STYLE_WEIGHTS: Partial<Record<StylePresetId, number>> = {
  "game-music": 1,
  ballad: 0.6,
  rock: 0.55,
  "lo-fi": 0.5,
  jazz: 0.45,
  edm: 0.4,
  "j-pop": 0.4,
  pop: 0.3,
};

const DEFAULT_MEDIANT_WEIGHT = 0.4;

export interface ChromaticMediantOptions {
  /** Key context, used to say which mediants are actually chromatic. */
  key?: PitchClassName;
  mode?: Mode;
  style?: StylePresetId;
  /** Keep only chords outside the key. Defaults to true. */
  chromaticOnly?: boolean;
  /**
   * Include the no-common-tone relations as well. Defaults to true.
   *
   * These are the doubly chromatic mediants — C to Ebm — which are the same
   * device pushed one step further: with nothing held over, the move is pure
   * displacement.
   */
  doublyChromatic?: boolean;
}

/**
 * The mediant relations of a chord.
 *
 * A mediant sharing two notes is the diatonic kind — vi to I, iii to I — and is
 * not what this is about; those are heard as substitutions inside the key. The
 * chromatic ones share exactly one, and that single held note is the whole
 * effect. The doubly chromatic ones share none, and are the same device with
 * nothing held over at all.
 */
export function chromaticMediantsOf(
  root: PitchClassName,
  quality: ChordQuality,
  options: ChromaticMediantOptions = {},
): ChromaticMediantCandidate[] {
  const rootSemitone = pitchClassToSemitone(root);
  const source = pitchClassesOf(rootSemitone, quality);
  const chromaticOnly = options.chromaticOnly ?? true;

  const diatonic = new Set<string>();
  if (options.key && options.mode) {
    for (let degree = 1; degree <= 7; degree += 1) {
      const definition = getDiatonicChordDefinition(options.key, options.mode, degree);
      diatonic.add(`${pitchClassToSemitone(definition.root)}:${definition.quality}`);
    }
  }

  const weight = options.style
    ? MEDIANT_STYLE_WEIGHTS[options.style] ?? DEFAULT_MEDIANT_WEIGHT
    : DEFAULT_MEDIANT_WEIGHT;

  const candidates: ChromaticMediantCandidate[] = [];
  for (const rootDistance of MEDIANT_DISTANCES) {
    const targetSemitone = mod12(rootSemitone + rootDistance);
    for (const targetQuality of ["major", "minor"] as const) {
      const target = pitchClassesOf(targetSemitone, targetQuality);
      const shared = [...target].filter((pitchClass) => source.has(pitchClass)).length;
      const kind = mediantKind(shared);
      // Two common tones is a diatonic mediant, which the ear reads as a
      // substitution inside the key rather than a move outside it.
      if (kind === "diatonic") continue;
      if (kind === "doublyChromatic" && options.doublyChromatic === false) continue;

      const isDiatonic = diatonic.has(`${targetSemitone}:${targetQuality}`);
      if (chromaticOnly && isDiatonic) continue;

      const targetRoot = semitoneToPitchClass(targetSemitone);
      candidates.push({
        rootDistance,
        sharedPitchClasses: shared,
        modeRelation: targetQuality === quality ? "sameQuality" : "mixedQuality",
        kind,
        root: targetRoot,
        quality: targetQuality,
        symbol: formatChordSymbol(targetRoot, targetQuality),
        chromatic: !isDiatonic,
        weight,
      });
    }
  }

  return candidates.sort((left, right) => {
    // The one-common-tone relations first: those are the characteristic sound,
    // since the held note changes its role between the two chords.
    if (left.kind !== right.kind) return left.kind === "chromatic" ? -1 : 1;
    return left.rootDistance - right.rootDistance;
  });
}

/** True when two chords stand in a chromatic mediant relation. */
export function isChromaticMediant(
  fromRoot: PitchClassName,
  fromQuality: ChordQuality,
  toRoot: PitchClassName,
  toQuality: ChordQuality,
): ChromaticMediantRelation | null {
  const fromSemitone = pitchClassToSemitone(fromRoot);
  const toSemitone = pitchClassToSemitone(toRoot);
  const distance = mod12(toSemitone - fromSemitone);
  if (!MEDIANT_DISTANCES.includes(distance as MediantDistance)) return null;

  const shared = [...pitchClassesOf(toSemitone, toQuality)].filter((pitchClass) =>
    pitchClassesOf(fromSemitone, fromQuality).has(pitchClass),
  ).length;
  const kind = mediantKind(shared);
  // A diatonic mediant is a substitution inside the key, not a move outside it.
  if (kind === "diatonic") return null;

  return {
    rootDistance: distance as MediantDistance,
    sharedPitchClasses: shared,
    modeRelation: fromQuality === toQuality ? "sameQuality" : "mixedQuality",
    kind,
  };
}

export type SymmetricScaleName = "wholeTone" | "octatonicHalfWhole" | "octatonicWholeHalf";

/**
 * Scales that divide the octave evenly.
 *
 * Their intervals repeat, so transposing one by its period gives back the same
 * set of notes. That is exactly why they have no tonic: every note is in the
 * same relationship to every other, and there is nothing for a key to be built
 * on.
 */
export const SYMMETRIC_SCALES: Readonly<Record<SymmetricScaleName, readonly number[]>> = {
  wholeTone: [0, 2, 4, 6, 8, 10],
  octatonicHalfWhole: [0, 1, 3, 4, 6, 7, 9, 10],
  octatonicWholeHalf: [0, 2, 3, 5, 6, 8, 9, 11],
};

/** How far a symmetric scale must be transposed to give back the same notes. */
export const SYMMETRIC_PERIOD: Readonly<Record<SymmetricScaleName, number>> = {
  wholeTone: 2,
  octatonicHalfWhole: 3,
  octatonicWholeHalf: 3,
};

export interface SymmetricChord {
  root: CanonicalPitchClass;
  quality: ChordQuality;
  symbol: string;
  /** Semitones above the scale's own starting note. */
  rootOffset: number;
}

/**
 * The chords a symmetric scale builds on each of its own degrees.
 *
 * Only chords every one of whose notes is in the scale — the point of writing
 * with one of these is that nothing steps outside it, which is what keeps the
 * music suspended rather than resolving.
 */
export function symmetricChordsOf(
  scale: SymmetricScaleName,
  root: PitchClassName,
): SymmetricChord[] {
  const rootSemitone = pitchClassToSemitone(root);
  const intervals = SYMMETRIC_SCALES[scale];
  const set = new Set(intervals.map(mod12));
  const qualities: readonly ChordQuality[] = [
    "major",
    "minor",
    "diminished",
    "augmented",
    "dominant7",
    "minor7",
    "diminished7",
    "halfDiminished7",
    "major7",
  ];

  const chords: SymmetricChord[] = [];
  const seen = new Set<string>();
  for (const offset of intervals) {
    for (const quality of qualities) {
      const fits = intervalsForQuality(quality).every((interval) =>
        set.has(mod12(offset + interval)),
      );
      if (!fits) continue;
      const identity = `${mod12(offset)}:${quality}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const chordRoot = semitoneToPitchClass(mod12(rootSemitone + offset));
      chords.push({
        root: chordRoot,
        quality,
        symbol: formatChordSymbol(chordRoot, quality),
        rootOffset: mod12(offset),
      });
    }
  }
  return chords;
}

/**
 * The distinct transpositions a symmetric scale has.
 *
 * A whole-tone scale has two and an octatonic three; asking for a thirteenth
 * transposition gets one of the ones already listed. Useful for saying whether
 * two passages are in "the same" symmetric scale, which is not a question a
 * pitch class alone can answer.
 */
export function symmetricTranspositions(scale: SymmetricScaleName): number[] {
  return Array.from({ length: SYMMETRIC_PERIOD[scale] }, (_, index) => index);
}

/** Which transposition of a symmetric scale a set of pitch classes lies in. */
export function symmetricTranspositionOf(
  scale: SymmetricScaleName,
  pitchClasses: readonly number[],
): number | null {
  if (pitchClasses.length === 0) return null;
  const intervals = SYMMETRIC_SCALES[scale];
  for (const offset of symmetricTranspositions(scale)) {
    const set = new Set(intervals.map((interval) => mod12(interval + offset)));
    if (pitchClasses.every((pitchClass) => set.has(mod12(pitchClass)))) return offset;
  }
  return null;
}
