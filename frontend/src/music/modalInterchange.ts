import type {
  CanonicalPitchClass,
  ChordQuality,
  HarmonyFunction,
  Mode,
  PitchClassName,
  StylePresetId,
} from "../types/music";
import {
  formatChordSymbol,
  getDiatonicChordDefinition,
  getDiatonicSeventhChordDefinition,
} from "./chords";
import { pitchClassToSemitone, semitoneToPitchClass } from "./scales";

/**
 * Modal interchange, as a system rather than a list.
 *
 * Borrowing already existed, but only from one place: each mode had a single
 * declared parallel, and a borrowed chord was whatever that one parallel had on
 * the same degree. That reaches iv in major and not much else. The chords people
 * actually borrow — bVI, bVII, bII, iiø7, the major I7 in a minor key — come
 * from several different parallel scales, and no single one of them supplies the
 * whole vocabulary.
 *
 * So this enumerates the parallel scales as a set, builds every triad and
 * seventh each of them offers on the shared tonic, and keeps the ones the home
 * key does not already have. What comes out is the borrowing vocabulary itself,
 * scored by how idiomatic each chord is in a given style.
 */

export type ParallelScaleName =
  | "ionian"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "aeolian"
  | "locrian"
  | "harmonicMinor"
  | "melodicMinor";

/**
 * The parallel scales, as semitones above the shared tonic.
 *
 * Declared here rather than reusing SCALE_INTERVALS because that map only holds
 * the five modes the generator can *run* in. Borrowing draws on scales the piece
 * is not in and could not be written in — the whole point is that they are
 * elsewhere.
 */
export const PARALLEL_SCALES: Readonly<Record<ParallelScaleName, readonly number[]>> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
};

export const PARALLEL_SCALE_NAMES = Object.keys(PARALLEL_SCALES) as ParallelScaleName[];

export interface ModalBorrowingCandidate {
  /** The parallel scale this chord comes from. */
  sourceScale: ParallelScaleName;
  /** Semitones above the tonic, 0..11. */
  rootOffset: number;
  root: CanonicalPitchClass;
  quality: ChordQuality;
  symbol: string;
  /** Roman numeral relative to the home tonic, e.g. "bVI", "iv", "iiø7". */
  romanNumeral: string;
  function: HarmonyFunction;
  /** Whether this is a triad or a seventh chord. */
  seventh: boolean;
  /** 0..1. How idiomatic this borrowing is in the style asked for. */
  weight: number;
}

/**
 * Roman numeral for a chord root a given number of semitones above the tonic.
 *
 * Written from the semitone rather than a scale degree because a borrowed chord
 * has no degree in the home key — that is what makes it borrowed. A flat sign
 * is used for every lowered degree; the sharp spellings a theorist might prefer
 * for a raised fourth are not reachable from a pitch class alone.
 */
const DEGREE_NAMES: readonly string[] = [
  "I", "bII", "II", "bIII", "III", "IV", "bV", "V", "bVI", "VI", "bVII", "VII",
];

const MINOR_QUALITIES: ReadonlySet<ChordQuality> = new Set<ChordQuality>([
  "minor",
  "diminished",
  "minor7",
  "halfDiminished7",
  "diminished7",
  "minorMajor7",
  "minorAdd9",
]);

const QUALITY_SUFFIX: Readonly<Partial<Record<ChordQuality, string>>> = {
  diminished: "°",
  augmented: "+",
  dominant7: "7",
  major7: "maj7",
  minor7: "7",
  halfDiminished7: "ø7",
  diminished7: "°7",
  minorMajor7: "(maj7)",
  augmentedMajor7: "+maj7",
};

export function borrowedRomanNumeral(rootOffset: number, quality: ChordQuality): string {
  const base = DEGREE_NAMES[((rootOffset % 12) + 12) % 12] as string;
  // Only the numeral takes the case; the accidental stays as written.
  const cased = base.startsWith("b")
    ? `b${MINOR_QUALITIES.has(quality) ? base.slice(1).toLowerCase() : base.slice(1)}`
    : MINOR_QUALITIES.has(quality)
      ? base.toLowerCase()
      : base;
  return `${cased}${QUALITY_SUFFIX[quality] ?? ""}`;
}

/** The triad or seventh a scale builds on one of its own degrees. */
function chordFromScale(
  scale: readonly number[],
  degreeIndex: number,
  seventh: boolean,
): { rootOffset: number; quality: ChordQuality } | null {
  const size = scale.length;
  const pick = (step: number) => scale[(degreeIndex + step) % size] as number;
  const rootOffset = pick(0);
  const intervals = [0, 2, 4, ...(seventh ? [6] : [])].map(
    (step) => (((pick(step) - rootOffset) % 12) + 12) % 12,
  );
  const key = intervals.join(",");
  const QUALITIES: Readonly<Record<string, ChordQuality>> = {
    "0,4,7": "major",
    "0,3,7": "minor",
    "0,3,6": "diminished",
    "0,4,8": "augmented",
    "0,4,7,10": "dominant7",
    "0,4,7,11": "major7",
    "0,3,7,10": "minor7",
    "0,3,6,10": "halfDiminished7",
    "0,3,6,9": "diminished7",
    "0,3,7,11": "minorMajor7",
    "0,4,8,11": "augmentedMajor7",
  };
  const quality = QUALITIES[key];
  // A scale with an augmented second builds stacks that are not tertian chords
  // at all; those are dropped rather than mislabelled.
  return quality ? { rootOffset, quality } : null;
}

/**
 * How idiomatic a borrowing is, by style.
 *
 * These are the chords that turn up by name in real repertoire, keyed by their
 * numeral. Anything not listed is still offered — the system finds it — but at
 * the base weight, because it is available rather than characteristic.
 */
const IDIOMATIC_WEIGHTS: Readonly<
  Record<string, Partial<Record<StylePresetId, number>> & { default: number }>
> = {
  // The minor subdominant in a major key: the most-used borrowing there is.
  iv: { default: 0.9, ballad: 1, "j-pop": 1, pop: 0.95, jazz: 0.8 },
  iv7: { default: 0.7, jazz: 0.9 },
  bVI: { default: 0.8, rock: 0.95, "game-music": 0.95, edm: 0.85 },
  bVII: { default: 0.85, rock: 1, "game-music": 0.9 },
  // The Neapolitan.
  bII: { default: 0.5, "game-music": 0.7, jazz: 0.65 },
  bIII: { default: 0.6, rock: 0.8, "game-music": 0.75 },
  // The half-diminished ii of a minor key, borrowed into major.
  "iiø7": { default: 0.6, jazz: 0.95, "lo-fi": 0.8, ballad: 0.7 },
  // A major tonic seventh pulls toward the subdominant.
  I7: { default: 0.45, jazz: 0.8, rock: 0.7 },
  // The Picardy third and its minor-key relatives.
  i: { default: 0.5 },
  "v": { default: 0.4 },
};

const BASE_WEIGHT = 0.25;

function weightFor(romanNumeral: string, style: StylePresetId | undefined): number {
  const entry = IDIOMATIC_WEIGHTS[romanNumeral];
  if (!entry) return BASE_WEIGHT;
  if (style && style in entry) {
    return (entry as Record<string, number>)[style] as number;
  }
  return entry.default;
}

/**
 * Function of a borrowed chord, from where its root sits.
 *
 * Borrowed chords keep the function of the degree they replace: bVI and bIII
 * stand in for the submediant and mediant and behave as tonic substitutes, iv
 * and bII are subdominants, bVII is the one that resists — it is a subtonic that
 * usually moves to the tonic without passing through a dominant, so it is read
 * as predominant rather than dominant.
 */
function functionForOffset(rootOffset: number): HarmonyFunction {
  switch (((rootOffset % 12) + 12) % 12) {
    case 0:
    case 3:
    case 4:
    case 8:
    case 9:
      return "tonic";
    case 1:
    case 2:
    case 5:
    case 10:
      return "predominant";
    case 7:
    case 11:
      return "dominant";
    default:
      return "other";
  }
}

export interface ModalBorrowingOptions {
  /** Restricts which parallel scales may be drawn on. */
  scales?: readonly ParallelScaleName[];
  /** Weights the results for a style. */
  style?: StylePresetId;
  /** Include seventh chords as well as triads. Defaults to true. */
  sevenths?: boolean;
  /** Drops anything below this weight. Defaults to 0. */
  minimumWeight?: number;
}

/**
 * Every chord the parallel scales offer that the home key does not.
 *
 * A chord the home key already has on the same root and quality is not a
 * borrowing, however many parallel scales also contain it — borrowing is defined
 * by the contrast, so without contrast there is nothing to borrow.
 */
export function findModalBorrowings(
  key: PitchClassName,
  mode: Mode,
  options: ModalBorrowingOptions = {},
): ModalBorrowingCandidate[] {
  const tonic = pitchClassToSemitone(key);
  // The key's own scale needs no special case: everything it builds is in the
  // native set below, so it is excluded for the reason that matters — the chord
  // is already the key's — rather than by name.
  const scales = options.scales ?? PARALLEL_SCALE_NAMES;
  const wantSevenths = options.sevenths ?? true;
  const minimum = options.minimumWeight ?? 0;

  // Everything the home key already sounds, as root+quality. Sevenths as well
  // as triads: Fmaj7 is diatonic to C major, and offering it as a borrowing
  // would put half the home key into the borrowing vocabulary.
  const native = new Set<string>();
  for (let degree = 1; degree <= 7; degree += 1) {
    for (const definition of [
      getDiatonicChordDefinition(key, mode, degree),
      getDiatonicSeventhChordDefinition(key, mode, degree),
    ]) {
      native.add(`${pitchClassToSemitone(definition.root)}:${definition.quality}`);
    }
  }

  const seen = new Set<string>();
  const candidates: ModalBorrowingCandidate[] = [];
  for (const scaleName of scales) {
    const scale = PARALLEL_SCALES[scaleName];
    for (let index = 0; index < scale.length; index += 1) {
      for (const seventh of wantSevenths ? [false, true] : [false]) {
        const built = chordFromScale(scale, index, seventh);
        if (!built) continue;
        const rootSemitone = (tonic + built.rootOffset) % 12;
        const identity = `${rootSemitone}:${built.quality}`;
        if (native.has(identity) || seen.has(identity)) continue;
        seen.add(identity);

        const root = semitoneToPitchClass(rootSemitone);
        const romanNumeral = borrowedRomanNumeral(built.rootOffset, built.quality);
        const weight = weightFor(romanNumeral, options.style);
        if (weight < minimum) continue;
        candidates.push({
          sourceScale: scaleName,
          rootOffset: built.rootOffset,
          root,
          quality: built.quality,
          symbol: formatChordSymbol(root, built.quality),
          romanNumeral,
          function: functionForOffset(built.rootOffset),
          seventh,
          weight,
        });
      }
    }
  }

  return candidates.sort((left, right) => {
    if (right.weight !== left.weight) return right.weight - left.weight;
    if (left.rootOffset !== right.rootOffset) return left.rootOffset - right.rootOffset;
    return left.quality.localeCompare(right.quality);
  });
}

/**
 * The borrowings that stand in for a given scale degree of the home key.
 *
 * A borrowing serves a degree when it shares that degree's root — iv for IV — or
 * sits a semitone below it, which is how bVI, bIII, bVII and bII work. The
 * semitone-below rule needs a guard: in a major key the note a semitone below IV
 * is III, and a chord on III is a chord on III, not a flattened IV. So the lower
 * root only counts when no other degree of the home key already occupies it.
 */
export function borrowingsForDegree(
  key: PitchClassName,
  mode: Mode,
  degree: number,
  options: ModalBorrowingOptions = {},
): ModalBorrowingCandidate[] {
  const tonic = pitchClassToSemitone(key);
  const offsetOf = (which: number) =>
    (pitchClassToSemitone(getDiatonicChordDefinition(key, mode, which).root) -
      tonic +
      12) %
    12;
  const nativeOffset = offsetOf(degree);
  const occupied = new Set(
    Array.from({ length: 7 }, (_, index) => offsetOf(index + 1)),
  );
  const lowered = (nativeOffset + 11) % 12;
  const loweredCounts = !occupied.has(lowered);

  return findModalBorrowings(key, mode, options).filter(
    (candidate) =>
      candidate.rootOffset === nativeOffset ||
      (loweredCounts && candidate.rootOffset === lowered),
  );
}
