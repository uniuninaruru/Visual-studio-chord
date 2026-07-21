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
  getScaleSemitones,
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
  halfDiminished7: [0, 3, 6, 10],
  diminished7: [0, 3, 6, 9],
  minorMajor7: [0, 3, 7, 11],
  augmentedMajor7: [0, 4, 8, 11],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  // Close-position voicings keep the ninth inside the first octave.
  add9: [0, 2, 4, 7],
  minorAdd9: [0, 2, 3, 7],
};

const INTERVALS_TO_QUALITY: Readonly<Record<string, ChordQuality>> = {
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

export function intervalsForQuality(quality: ChordQuality): readonly number[] {
  return QUALITY_INTERVALS[quality];
}

function assertDegree(degree: number): void {
  if (!Number.isInteger(degree) || degree < 1 || degree > 7) {
    throw new RangeError("Scale degree must be an integer from 1 to 7.");
  }
}

function stackedThirdIntervals(
  mode: Mode,
  degree: number,
  noteCount: 3 | 4,
): number[] {
  assertDegree(degree);
  const scale = getScaleSemitones("C", mode);
  const rootIndex = degree - 1;
  const root = scale[rootIndex] as number;
  return Array.from({ length: noteCount }, (_, stackIndex) => {
    const scaleIndex = rootIndex + stackIndex * 2;
    const octave = Math.floor(scaleIndex / 7) * 12;
    const pitch = (scale[scaleIndex % 7] as number) + octave;
    return pitch - root;
  });
}

function qualityForDiatonicStack(
  mode: Mode,
  degree: number,
  noteCount: 3 | 4,
): ChordQuality {
  const key = stackedThirdIntervals(mode, degree, noteCount).join(",");
  const quality = INTERVALS_TO_QUALITY[key];
  if (!quality) {
    throw new Error(`Unsupported diatonic chord intervals: ${key}`);
  }
  return quality;
}

export function diatonicQualityForDegree(degree: number, mode: Mode): ChordQuality {
  return qualityForDiatonicStack(mode, degree, 3);
}

export function diatonicSeventhQualityForDegree(
  degree: number,
  mode: Mode,
): ChordQuality {
  return qualityForDiatonicStack(mode, degree, 4);
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
    halfDiminished7: "m7b5",
    diminished7: "dim7",
    minorMajor7: "mMaj7",
    augmentedMajor7: "augMaj7",
    sus2: "sus2",
    sus4: "sus4",
    add9: "add9",
    minorAdd9: "madd9",
  };
  return `${normalizePitchClass(root)}${suffix[quality]}`;
}

function getDiatonicDefinition(
  key: PitchClassName,
  mode: Mode,
  degree: number,
  seventh: boolean,
): ChordDefinition {
  assertDegree(degree);
  const root = getScalePitchClasses(key, mode)[degree - 1];
  if (!root) throw new RangeError("Could not resolve scale degree.");
  const quality = seventh
    ? diatonicSeventhQualityForDegree(degree, mode)
    : diatonicQualityForDegree(degree, mode);
  return {
    root,
    quality,
    intervals: intervalsForQuality(quality),
    symbol: formatChordSymbol(root, quality),
  };
}

export function getDiatonicChordDefinition(
  key: PitchClassName,
  mode: Mode,
  degree: number,
): ChordDefinition {
  return getDiatonicDefinition(key, mode, degree, false);
}

export function getDiatonicSeventhChordDefinition(
  key: PitchClassName,
  mode: Mode,
  degree: number,
): ChordDefinition {
  return getDiatonicDefinition(key, mode, degree, true);
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
      if ((notes[0] as number) >= 43 && (notes[notes.length - 1] as number) <= 84) {
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

export function romanNumeralForChordQuality(
  degree: number,
  mode: Mode,
  quality: ChordQuality,
): string {
  const base = romanNumeralForDegree(degree, mode).replace(/[°+]$/, "");
  const upper = base.toUpperCase();
  const lower = base.toLowerCase();
  switch (quality) {
    case "minor":
      return lower;
    case "diminished":
      return `${lower}°`;
    case "augmented":
      return `${upper}+`;
    case "dominant7":
      return `${upper}7`;
    case "major7":
      return `${upper}maj7`;
    case "minor7":
      return `${lower}7`;
    case "halfDiminished7":
      return `${lower}ø7`;
    case "diminished7":
      return `${lower}°7`;
    case "minorMajor7":
      return `${lower}(maj7)`;
    case "augmentedMajor7":
      return `${upper}+(maj7)`;
    case "sus2":
      return `${upper}sus2`;
    case "sus4":
      return `${upper}sus4`;
    case "add9":
      return `${upper}add9`;
    case "minorAdd9":
      return `${lower}add9`;
    case "major":
      return upper;
  }
}

export interface CreateDiatonicChordOptions {
  key: PitchClassName;
  mode: Mode;
  degree: number;
  startTick: number;
  durationTick: number;
  id: string;
  previousNotes?: readonly number[];
  seventh?: boolean;
}

export function createDiatonicChordEvent(
  options: CreateDiatonicChordOptions,
): ChordEvent {
  const definition = options.seventh
    ? getDiatonicSeventhChordDefinition(options.key, options.mode, options.degree)
    : getDiatonicChordDefinition(options.key, options.mode, options.degree);
  const voicing = voiceChord(
    definition.root,
    definition.quality,
    options.previousNotes,
  );
  return {
    id: options.id,
    symbol: definition.symbol,
    romanNumeral: romanNumeralForChordQuality(
      options.degree,
      options.mode,
      definition.quality,
    ),
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
  const match = /^\s*([A-Ga-g])([#b]?)(augMaj7|mMaj7|madd9|add9|m7b5|ø7|dim7|maj7|M7|m7|min7|sus2|sus4|dim|°|aug|\+|7|m|min)?\s*$/.exec(
    symbol,
  );
  if (!match) {
    throw new Error(`Unsupported chord symbol: ${symbol}`);
  }
  const root = `${(match[1] as string).toUpperCase()}${match[2] ?? ""}` as PitchClassName;
  const suffix = match[3] ?? "";
  const qualities: Readonly<Record<string, ChordQuality>> = {
    "": "major",
    m: "minor",
    min: "minor",
    dim: "diminished",
    "°": "diminished",
    aug: "augmented",
    "+": "augmented",
    "7": "dominant7",
    maj7: "major7",
    M7: "major7",
    m7: "minor7",
    min7: "minor7",
    m7b5: "halfDiminished7",
    "ø7": "halfDiminished7",
    dim7: "diminished7",
    mMaj7: "minorMajor7",
    augMaj7: "augmentedMajor7",
    sus2: "sus2",
    sus4: "sus4",
    add9: "add9",
    madd9: "minorAdd9",
  };
  const quality = qualities[suffix];
  if (!quality) throw new Error(`Unsupported chord symbol: ${symbol}`);
  const normalizedRoot = normalizePitchClass(root);
  return {
    root: normalizedRoot,
    quality,
    intervals: intervalsForQuality(quality),
    symbol: formatChordSymbol(normalizedRoot, quality),
  };
}

function colorSource(
  degree: number | null,
  definition: ChordDefinition,
  key: PitchClassName,
  mode: Mode,
): Pick<ChordEvent, "source" | "specialKind" | "explanation"> {
  if (!degree) return { source: "other" };
  const triad = getDiatonicChordDefinition(key, mode, degree);
  const seventh = getDiatonicSeventhChordDefinition(key, mode, degree);
  if (
    definition.root === triad.root &&
    (definition.quality === triad.quality || definition.quality === seventh.quality)
  ) {
    return { source: "diatonic" };
  }
  if (definition.quality === "sus2" || definition.quality === "sus4") {
    return {
      source: "substitute",
      specialKind: "suspended",
      explanation: `Scale degree ${degree} replaces its third with a suspension.`,
    };
  }
  if (definition.quality === "add9" || definition.quality === "minorAdd9") {
    return {
      source: "substitute",
      specialKind: "addedTone",
      explanation: `Scale degree ${degree} adds the diatonic ninth as color.`,
    };
  }
  return { source: "other" };
}

/** Rebuilds all derived chord fields after a direct symbol edit. */
export function replaceChordSymbol(
  chord: ChordEvent,
  symbol: string,
  key: PitchClassName,
  mode: Mode,
  inversion: number = chord.inversion,
): ChordEvent {
  const definition = parseChordSymbol(symbol);
  const degree = scaleDegreeForPitchClass(definition.root, key, mode);
  const classification = colorSource(degree, definition, key, mode);
  const voicing = voiceChord(definition.root, definition.quality, undefined, inversion);
  return {
    ...chord,
    symbol: definition.symbol,
    romanNumeral: degree
      ? romanNumeralForChordQuality(degree, mode, definition.quality)
      : "?",
    function: degree ? harmonyFunctionForDegree(degree, mode) : "other",
    degree: degree ?? 0,
    quality: definition.quality,
    root: semitoneToPitchClass(pitchClassToSemitone(definition.root)),
    notes: voicing.notes,
    inversion: voicing.inversion,
    source: classification.source as ChordSource,
    specialKind: classification.specialKind,
    explanation: classification.explanation,
    targetDegree: undefined,
    borrowedFromMode: undefined,
  };
}
