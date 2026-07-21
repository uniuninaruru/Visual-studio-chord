import type { CadenceType, HarmonyFunction, Mode } from "../types/music";

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

export function hasCadence(
  degrees: readonly number[],
  cadence: CadenceType,
  mode: Mode,
): boolean {
  if (degrees.length < 2) return false;
  const expected = cadenceDegrees(cadence, mode);
  return (
    degrees[degrees.length - 2] === expected[0] &&
    degrees[degrees.length - 1] === expected[1]
  );
}

