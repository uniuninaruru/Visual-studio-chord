import type { CadenceType, ChordQuality, HarmonyFunction, Mode } from "../types/music";

const MAJOR_ROMANS = ["I", "ii", "iii", "IV", "V", "vi", "vii°"] as const;
const MINOR_ROMANS = ["i", "ii°", "III", "iv", "v", "VI", "VII"] as const;

const MAJOR_FUNCTIONS: readonly HarmonyFunction[] = [
  "tonic",
  "predominant",
  "tonic",
  "predominant",
  "dominant",
  "tonic",
  "dominant",
];

const MINOR_FUNCTIONS: readonly HarmonyFunction[] = [
  "tonic",
  "predominant",
  "tonic",
  "predominant",
  "dominant",
  "tonic",
  "dominant",
];

export function romanNumeralForDegree(degree: number, mode: Mode): string {
  if (!Number.isInteger(degree) || degree < 1 || degree > 7) {
    throw new RangeError("Scale degree must be an integer from 1 to 7.");
  }
  return (mode === "major" ? MAJOR_ROMANS : MINOR_ROMANS)[degree - 1] as string;
}

export function harmonyFunctionForDegree(
  degree: number,
  mode: Mode,
): HarmonyFunction {
  if (!Number.isInteger(degree) || degree < 1 || degree > 7) return "other";
  return (mode === "major" ? MAJOR_FUNCTIONS : MINOR_FUNCTIONS)[
    degree - 1
  ] as HarmonyFunction;
}

/** The last two scale degrees for each supported MVP cadence. */
export function cadenceDegrees(cadence: CadenceType, mode: Mode): readonly [number, number] {
  switch (cadence) {
    case "authentic":
      return [5, 1];
    case "plagal":
      return [4, 1];
    case "half":
      return [mode === "major" ? 2 : 4, 5];
    case "deceptive":
      return [5, 6];
    case "loop":
      return [4, 5];
  }
}

/**
 * Where the functional (leading-tone) dominant sits inside a cadence:
 *  - `authentic` (V→I) and `deceptive` (V→VI) place it on the penultimate chord.
 *  - `half` (…→V) ends *on* the dominant.
 *  - `plagal` (IV→I) and `loop` (…→V vamp) have no leading-tone dominant, so
 *    minor keeps its modal `iv`/`v` there instead of borrowing a raised seventh.
 */
export type CadenceDominantPosition = "penultimate" | "final" | null;

export function cadenceDominantPosition(cadence: CadenceType): CadenceDominantPosition {
  switch (cadence) {
    case "authentic":
    case "deceptive":
      return "penultimate";
    case "half":
      return "final";
    case "plagal":
    case "loop":
      return null;
  }
}

/** A dominant chord carries a leading tone only when it is major or dominant-7th. */
function dominantHasLeadingTone(quality: ChordQuality): boolean {
  return quality === "major" || quality === "dominant7";
}

/**
 * Confirms a progression's final two chords realise the labelled cadence.
 *
 * With only the scale degrees this checks the cadence *shape*. When the ending
 * chords are supplied it additionally verifies the functional dominant actually
 * carries a leading tone — so a minor `v→i` is no longer accepted as an
 * authentic cadence just because its degrees read 5→1.
 */
export function hasCadence(
  degrees: readonly number[],
  cadence: CadenceType,
  mode: Mode,
  endingChords?: readonly { degree: number; quality: ChordQuality }[],
): boolean {
  if (degrees.length < 2) return false;
  const expected = cadenceDegrees(cadence, mode);
  const degreesMatch =
    degrees[degrees.length - 2] === expected[0] &&
    degrees[degrees.length - 1] === expected[1];
  if (!degreesMatch) return false;
  if (!endingChords) return true;

  const position = cadenceDominantPosition(cadence);
  if (position === null) return true;
  const dominant =
    position === "final"
      ? endingChords[endingChords.length - 1]
      : endingChords[endingChords.length - 2];
  if (!dominant) return true;
  return dominantHasLeadingTone(dominant.quality);
}

