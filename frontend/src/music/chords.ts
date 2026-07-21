import type {
  ChordEvent,
  ChordQuality,
  ChordSource,
  Mode,
  PitchClassName,
} from "../types/music";
import {
  harmonyFunctionForDegree,
  romanNumeralForDegree,
} from "./harmonyFunctions";
import {
  getScalePitchClasses,
  normalizePitchClass,
  pitchClassToSemitone,
  scaleDegreeForPitchClass,
  semitoneToPitchClass,
} from "./scales";

export interface ChordDefinition {
  root: ReturnType<typeof normalizePitchClass>;
  quality: ChordQuality;
  intervals: readonly number[];
  symbol: string;
}

const QUALITY_INTERVALS: Readonly<Record<ChordQuality, readonly number[]>> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
};

const MAJOR_TRIAD_QUALITIES: readonly ChordQuality[] = [
  "major",
  "minor",
  "minor",
  "major",
  "major",
  "minor",
  "diminished",
];

const MINOR_TRIAD_QUALITIES: readonly ChordQuality[] = [
  "minor",
  "diminished",
  "major",
  "minor",
  "minor",
  "major",
  "major",
];

export function intervalsForQuality(quality: ChordQuality): readonly number[] {
  return QUALITY_INTERVALS[quality];
}

export function diatonicQualityForDegree(degree: number, mode: Mode): ChordQuality {
  if (!Number.isInteger(degree) || degree < 1 || degree > 7) {
    throw new RangeError("Scale degree must be an integer from 1 to 7.");
  }
  return (mode === "major" ? MAJOR_TRIAD_QUALITIES : MINOR_TRIAD_QUALITIES)[
    degree - 1
  ] as ChordQuality;
}

export function formatChordSymbol(
  root: PitchClassName,
  quality: ChordQuality,
): string {
  const suffix: Readonly<Record<ChordQuality, string>> = {
    major: "",
    minor: "m",
    diminished: "dim",
    augmented: "aug",
    dominant7: "7",
    major7: "maj7",
    minor7: "m7",
  };
  return `${normalizePitchClass(root)}${suffix[quality]}`;
}

export function getDiatonicChordDefinition(
  key: PitchClassName,
  mode: Mode,
  degree: number,
): ChordDefinition {
  if (!Number.isInteger(degree) || degree < 1 || degree > 7) {
    throw new RangeError("Scale degree must be an integer from 1 to 7.");
  }
  const root = getScalePitchClasses(key, mode)[degree - 1];
  if (!root) throw new RangeError("Could not resolve scale degree.");
  const quality = diatonicQualityForDegree(degree, mode);
  return {
    root,
    quality,
    intervals: intervalsForQuality(quality),
    symbol: formatChordSymbol(root, quality),
  };
}

function chordCandidates(
  rootSemitone: number,
  quality: ChordQuality,
  requestedInversion?: number,
): Array<{ notes: number[]; inversion: number }> {
  const intervals = intervalsForQuality(quality);
  const inversionCount = intervals.length;
  const inversions = requestedInversion === undefined
    ? Array.from({ length: inversionCount }, (_, index) => index)
    : [((requestedInversion % inversionCount) + inversionCount) % inversionCount];
  const candidates: Array<{ notes: number[]; inversion: number }> = [];

  for (const inversion of inversions) {
    const reordered = [
      ...intervals.slice(inversion),
      ...intervals.slice(0, inversion).map((interval) => interval + 12),
    ];
    for (let rootMidi = rootSemitone + 36; rootMidi <= rootSemitone + 72; rootMidi += 12) {
      const notes = reordered.map((interval) => rootMidi + interval);
      if ((notes[0] as number) >= 43 && (notes[notes.length - 1] as number) <= 79) {
        candidates.push({ notes, inversion });
      }
    }
  }
  return candidates;
}

function voicingCost(notes: readonly number[], previousNotes?: readonly number[]): number {
  const centerCost = notes.reduce((sum, note) => sum + Math.abs(note - 60), 0) * 0.08;
  const bassCost = Math.abs((notes[0] as number) - 50) * 0.12;
  if (!previousNotes || previousNotes.length === 0) return centerCost + bassCost;

  const movement = notes.reduce((sum, note, index) => {
    const prior = previousNotes[Math.min(index, previousNotes.length - 1)] as number;
    return sum + Math.abs(note - prior);
  }, 0);
  const commonPitchClasses = notes.filter((note) =>
    previousNotes.some((prior) => prior % 12 === note % 12),
  ).length;
  return movement + centerCost + bassCost - commonPitchClasses * 1.5;
}

/** Closed-position voicing with deterministic, lightweight voice-leading. */
export function voiceChord(
  root: PitchClassName,
  quality: ChordQuality,
  previousNotes?: readonly number[],
  requestedInversion?: number,
): { notes: number[]; inversion: number } {
  const candidates = chordCandidates(
    pitchClassToSemitone(root),
    quality,
    requestedInversion,
  );
  if (candidates.length === 0) throw new Error("No playable chord voicing found.");
  return candidates.reduce((best, candidate) => {
    const bestCost = voicingCost(best.notes, previousNotes);
    const candidateCost = voicingCost(candidate.notes, previousNotes);
    if (candidateCost !== bestCost) return candidateCost < bestCost ? candidate : best;
    return candidate.notes.join(",") < best.notes.join(",") ? candidate : best;
  });
}

export interface CreateDiatonicChordOptions {
  key: PitchClassName;
  mode: Mode;
  degree: number;
  startTick: number;
  durationTick: number;
  id: string;
  previousNotes?: readonly number[];
}

export function createDiatonicChordEvent(
  options: CreateDiatonicChordOptions,
): ChordEvent {
  const definition = getDiatonicChordDefinition(
    options.key,
    options.mode,
    options.degree,
  );
  const voicing = voiceChord(
    definition.root,
    definition.quality,
    options.previousNotes,
  );
  return {
    id: options.id,
    symbol: definition.symbol,
    romanNumeral: romanNumeralForDegree(options.degree, options.mode),
    function: harmonyFunctionForDegree(options.degree, options.mode),
    degree: options.degree,
    quality: definition.quality,
    root: definition.root,
    startTick: options.startTick,
    durationTick: options.durationTick,
    notes: voicing.notes,
    inversion: voicing.inversion,
    source: "diatonic",
  };
}

export function parseChordSymbol(symbol: string): ChordDefinition {
  const match = /^\s*([A-Ga-g])([#b]?)(maj7|M7|m7|min7|dim|°|aug|\+|7|m|min)?\s*$/.exec(
    symbol,
  );
  if (!match) {
    throw new Error(`Unsupported chord symbol: ${symbol}`);
  }
  const root = `${(match[1] as string).toUpperCase()}${match[2] ?? ""}` as PitchClassName;
  const suffix = match[3] ?? "";
  let quality: ChordQuality;
  switch (suffix) {
    case "m":
    case "min":
      quality = "minor";
      break;
    case "dim":
    case "°":
      quality = "diminished";
      break;
    case "aug":
    case "+":
      quality = "augmented";
      break;
    case "7":
      quality = "dominant7";
      break;
    case "maj7":
    case "M7":
      quality = "major7";
      break;
    case "m7":
    case "min7":
      quality = "minor7";
      break;
    default:
      quality = "major";
  }
  const normalizedRoot = normalizePitchClass(root);
  return {
    root: normalizedRoot,
    quality,
    intervals: intervalsForQuality(quality),
    symbol: formatChordSymbol(normalizedRoot, quality),
  };
}

function romanForEditedChord(degree: number, quality: ChordQuality): string {
  const base = ["I", "II", "III", "IV", "V", "VI", "VII"][degree - 1] as string;
  if (quality === "minor" || quality === "minor7") return base.toLowerCase() + (quality === "minor7" ? "7" : "");
  if (quality === "diminished") return `${base.toLowerCase()}°`;
  if (quality === "dominant7" || quality === "major7") return `${base}7`;
  if (quality === "augmented") return `${base}+`;
  return base;
}

/**
 * Rebuilds all derived chord fields after a direct symbol edit. Unsupported
 * or chromatic symbols are marked as `other` instead of pretending diatonicity.
 */
export function replaceChordSymbol(
  chord: ChordEvent,
  symbol: string,
  key: PitchClassName,
  mode: Mode,
  inversion: number = chord.inversion,
): ChordEvent {
  const definition = parseChordSymbol(symbol);
  const degree = scaleDegreeForPitchClass(definition.root, key, mode);
  const expectedQuality = degree ? diatonicQualityForDegree(degree, mode) : null;
  const source: ChordSource = degree && expectedQuality === definition.quality
    ? "diatonic"
    : "other";
  const voicing = voiceChord(definition.root, definition.quality, undefined, inversion);
  return {
    ...chord,
    symbol: definition.symbol,
    romanNumeral: degree ? romanForEditedChord(degree, definition.quality) : "?",
    function: degree ? harmonyFunctionForDegree(degree, mode) : "other",
    degree: degree ?? 0,
    quality: definition.quality,
    root: semitoneToPitchClass(pitchClassToSemitone(definition.root)),
    notes: voicing.notes,
    inversion: voicing.inversion,
    source,
  };
}

