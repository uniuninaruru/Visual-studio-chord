import type { CadenceType, HarmonyFunction, Mode } from "../types/music";

const MAJOR_ROMANS = ["I", "ii", "iii", "IV", "V", "vi", "vii°"] as const;
const MINOR_ROMANS = ["i", "ii°", "III", "iv", "v", "VI", "VII"] as const;
const HARMONIC_MINOR_ROMANS = ["i", "ii°", "III+", "iv", "V", "VI", "vii°"] as const;
const DORIAN_ROMANS = ["i", "ii", "III", "IV", "v", "vi°", "VII"] as const;
const MIXOLYDIAN_ROMANS = ["I", "ii", "iii°", "IV", "v", "vi", "VII"] as const;

const ROMANS_BY_MODE: Readonly<Record<Mode, readonly string[]>> = {
  major: MAJOR_ROMANS,
  naturalMinor: MINOR_ROMANS,
  harmonicMinor: HARMONIC_MINOR_ROMANS,
  dorian: DORIAN_ROMANS,
  mixolydian: MIXOLYDIAN_ROMANS,
};

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

const FUNCTIONS_BY_MODE: Readonly<Record<Mode, readonly HarmonyFunction[]>> = {
  major: MAJOR_FUNCTIONS,
  naturalMinor: MINOR_FUNCTIONS,
  harmonicMinor: MINOR_FUNCTIONS,
  dorian: MINOR_FUNCTIONS,
  mixolydian: MAJOR_FUNCTIONS,
};

export function romanNumeralForDegree(degree: number, mode: Mode): string {
  if (!Number.isInteger(degree) || degree < 1 || degree > 7) {
    throw new RangeError("Scale degree must be an integer from 1 to 7.");
  }
  return ROMANS_BY_MODE[mode][degree - 1] as string;
}

export function harmonyFunctionForDegree(
  degree: number,
  mode: Mode,
): HarmonyFunction {
  if (!Number.isInteger(degree) || degree < 1 || degree > 7) return "other";
  return FUNCTIONS_BY_MODE[mode][degree - 1] as HarmonyFunction;
}

/** The last two scale degrees for each supported MVP cadence. */
export function cadenceDegrees(cadence: CadenceType, mode: Mode): readonly [number, number] {
  switch (cadence) {
    case "authentic":
      return [5, 1];
    case "plagal":
      return [4, 1];
    case "half":
      return [mode === "major" || mode === "mixolydian" ? 2 : 4, 5];
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
