import type {
  ChordEvent,
  ChordQuality,
  HarmonyFunction,
  Mode,
  PitchClassName,
} from "../types/music";
import {
  createDiatonicChordEvent,
  formatChordSymbol,
  getDiatonicChordDefinition,
  getDiatonicSeventhChordDefinition,
  romanNumeralForChordQuality,
  voiceChord,
} from "./chords";
import {
  harmonyFunctionForDegree,
  romanNumeralForDegree,
} from "./harmonyFunctions";
import {
  getScalePitchClasses,
  parallelModeFor,
  pitchClassToSemitone,
  semitoneToPitchClass,
} from "./scales";
import type { HarmonyCandidateKind } from "./styles";

export interface ChordExplanation {
  allowed: boolean;
  code: string;
  message: string;
}

export interface CreateAdvancedChordOptions {
  kind: HarmonyCandidateKind;
  key: PitchClassName;
  mode: Mode;
  degree: number;
  /** Required for secondary dominants and tritone substitutions. */
  targetDegree?: number;
  startTick: number;
  durationTick: number;
  id: string;
  previousNotes?: readonly number[];
  voiceLeadingStrength?: number;
  /** Deterministically selects sus2 or sus4. */
  suspension?: 2 | 4;
}

// Defined in scales.ts so chords.ts can use it without a circular import;
// re-exported here to keep this module's public surface unchanged.
export { parallelModeFor };

function assertDegree(degree: number, label: string): void {
  if (!Number.isInteger(degree) || degree < 1 || degree > 7) {
    throw new RangeError(`${label} must be an integer from 1 to 7.`);
  }
}

function buildEvent(
  options: CreateAdvancedChordOptions,
  root: ReturnType<typeof semitoneToPitchClass>,
  quality: ChordQuality,
  romanNumeral: string,
  harmonyFunction: HarmonyFunction,
  metadata: Pick<
    ChordEvent,
    "source" | "specialKind" | "targetDegree" | "borrowedFromMode" | "explanation"
  >,
): ChordEvent {
  const voicing = voiceChord(
    root,
    quality,
    options.previousNotes,
    undefined,
    options.voiceLeadingStrength,
  );
  return {
    id: options.id,
    symbol: formatChordSymbol(root, quality),
    romanNumeral,
    function: harmonyFunction,
    degree: options.degree,
    quality,
    root,
    startTick: options.startTick,
    durationTick: options.durationTick,
    notes: voicing.notes,
    inversion: voicing.inversion,
    ...metadata,
  };
}

export function canCreateHarmonyCandidate(
  kind: HarmonyCandidateKind,
  key: PitchClassName,
  mode: Mode,
  degree: number,
  targetDegree?: number,
): boolean {
  if (degree < 1 || degree > 7) return false;
  if (
    (kind === "secondaryDominant" || kind === "tritoneSubstitution") &&
    (!targetDegree || targetDegree < 1 || targetDegree > 7)
  ) {
    return false;
  }
  if (kind === "borrowed") {
    const native = getDiatonicChordDefinition(key, mode, degree);
    const borrowed = getDiatonicChordDefinition(key, parallelModeFor(mode), degree);
    return native.root !== borrowed.root || native.quality !== borrowed.quality;
  }
  if (kind === "addedTone") {
    const quality = getDiatonicChordDefinition(key, mode, degree).quality;
    return quality === "major" || quality === "minor";
  }
  return true;
}

/** Materializes a deterministic style candidate into a fully explained chord. */
export function createAdvancedChordEvent(
  options: CreateAdvancedChordOptions,
): ChordEvent {
  assertDegree(options.degree, "Scale degree");
  if (options.targetDegree !== undefined) {
    assertDegree(options.targetDegree, "Target degree");
  }
  if (!canCreateHarmonyCandidate(
    options.kind,
    options.key,
    options.mode,
    options.degree,
    options.targetDegree,
  )) {
    throw new Error(`Harmony candidate '${options.kind}' is unavailable here.`);
  }

  if (options.kind === "triad" || options.kind === "seventh") {
    return createDiatonicChordEvent({
      key: options.key,
      mode: options.mode,
      degree: options.degree,
      startTick: options.startTick,
      durationTick: options.durationTick,
      id: options.id,
      previousNotes: options.previousNotes,
      seventh: options.kind === "seventh",
      voiceLeadingStrength: options.voiceLeadingStrength,
    });
  }

  const native = getDiatonicChordDefinition(options.key, options.mode, options.degree);
  if (options.kind === "secondaryDominant") {
    const targetDegree = options.targetDegree as number;
    const targetRoot = getScalePitchClasses(options.key, options.mode)[targetDegree - 1] as PitchClassName;
    const root = semitoneToPitchClass(pitchClassToSemitone(targetRoot) + 7);
    const targetRoman = romanNumeralForDegree(targetDegree, options.mode);
    return buildEvent(options, root, "dominant7", `V7/${targetRoman}`, "dominant", {
      source: "secondaryDominant",
      specialKind: "secondaryDominant",
      targetDegree,
      explanation: `Secondary dominant of degree ${targetDegree}; resolves by fifth to ${targetRoot}.`,
    });
  }

  if (options.kind === "borrowed") {
    const borrowedFromMode = parallelModeFor(options.mode);
    const borrowed = getDiatonicChordDefinition(options.key, borrowedFromMode, options.degree);
    return buildEvent(
      options,
      borrowed.root,
      borrowed.quality,
      `${romanNumeralForChordQuality(options.degree, borrowedFromMode, borrowed.quality)} (borrowed)`,
      harmonyFunctionForDegree(options.degree, options.mode),
      {
        source: "borrowed",
        specialKind: "borrowed",
        borrowedFromMode,
        explanation: `Borrowed degree ${options.degree} from parallel ${borrowedFromMode}.`,
      },
    );
  }

  if (options.kind === "tritoneSubstitution") {
    const targetDegree = options.targetDegree as number;
    const targetRoot = getScalePitchClasses(options.key, options.mode)[targetDegree - 1] as PitchClassName;
    const root = semitoneToPitchClass(pitchClassToSemitone(targetRoot) + 1);
    const targetRoman = romanNumeralForDegree(targetDegree, options.mode);
    return buildEvent(options, root, "dominant7", `subV7/${targetRoman}`, "dominant", {
      source: "substitute",
      specialKind: "tritoneSubstitution",
      targetDegree,
      explanation: `Tritone substitute for V7/${targetRoman}; resolves down a semitone to ${targetRoot}.`,
    });
  }

  if (options.kind === "suspended") {
    const quality = options.suspension === 2 ? "sus2" : "sus4";
    return buildEvent(
      options,
      native.root,
      quality,
      romanNumeralForChordQuality(options.degree, options.mode, quality),
      harmonyFunctionForDegree(options.degree, options.mode),
      {
        source: "substitute",
        specialKind: "suspended",
        explanation: `Degree ${options.degree} replaces its third with suspended ${options.suspension === 2 ? "second" : "fourth"}.`,
      },
    );
  }

  const quality = native.quality === "minor" ? "minorAdd9" : "add9";
  return buildEvent(
    options,
    native.root,
    quality,
    romanNumeralForChordQuality(options.degree, options.mode, quality),
    harmonyFunctionForDegree(options.degree, options.mode),
    {
      source: "substitute",
      specialKind: "addedTone",
      explanation: `Degree ${options.degree} keeps its triad and adds the ninth.`,
    },
  );
}

function invalid(code: string, message: string): ChordExplanation {
  return { allowed: false, code, message };
}

function explained(chord: ChordEvent, message: string): ChordExplanation {
  if (!chord.explanation?.trim()) {
    return invalid("missingExplanation", "Special chord must include its harmonic explanation.");
  }
  return { allowed: true, code: chord.specialKind ?? chord.source, message };
}

/** Checks and explains the Phase 2 theory rule used by a special chord. */
export function explainSpecialChord(
  chord: ChordEvent,
  key: PitchClassName,
  mode: Mode,
): ChordExplanation {
  if (chord.source === "secondaryDominant") {
    if (chord.specialKind !== "secondaryDominant" || !chord.targetDegree) {
      return invalid("secondaryDominant.metadata", "Secondary dominant needs a target degree.");
    }
    const target = getScalePitchClasses(key, mode)[chord.targetDegree - 1];
    if (!target || chord.quality !== "dominant7") {
      return invalid("secondaryDominant.quality", "Secondary dominant must be a dominant seventh.");
    }
    const expectedRoot = semitoneToPitchClass(pitchClassToSemitone(target) + 7);
    if (chord.root !== expectedRoot) {
      return invalid("secondaryDominant.root", "Secondary dominant root must be a fifth above its target.");
    }
    return explained(chord, `Allowed V7/${romanNumeralForDegree(chord.targetDegree, mode)} resolving to ${target}.`);
  }

  if (chord.source === "borrowed") {
    // Cadential dominant: minor/modal keys borrow a raised leading tone from the
    // harmonic minor to form a functional major V on scale degree 5.
    if (chord.borrowedFromMode === "harmonicMinor" && chord.degree === 5) {
      const dominantRoot = getScalePitchClasses(key, mode)[4];
      if (
        chord.specialKind === "borrowed" &&
        chord.quality === "major" &&
        chord.root === dominantRoot &&
        chord.romanNumeral === "V"
      ) {
        return explained(chord, "Allowed raised leading-tone dominant (V) from the harmonic minor.");
      }
      return invalid(
        "borrowed.cadentialDominant",
        "Cadential dominant must be a major V on scale degree 5 with a raised leading tone.",
      );
    }
    if (chord.specialKind !== "borrowed" || chord.borrowedFromMode !== parallelModeFor(mode)) {
      return invalid("borrowed.mode", "Borrowed chord must identify the supported parallel mode.");
    }
    try {
      const expected = getDiatonicChordDefinition(key, chord.borrowedFromMode, chord.degree);
      if (expected.root !== chord.root || expected.quality !== chord.quality) {
        return invalid("borrowed.definition", "Borrowed chord does not match its parallel-mode degree.");
      }
    } catch {
      return invalid("borrowed.degree", "Borrowed chord degree must be between 1 and 7.");
    }
    return explained(chord, `Allowed modal interchange from ${chord.borrowedFromMode}.`);
  }

  if (chord.source === "substitute") {
    if (chord.specialKind === "tritoneSubstitution") {
      if (!chord.targetDegree || chord.quality !== "dominant7") {
        return invalid("substitute.metadata", "Tritone substitute needs a target and dominant-seventh quality.");
      }
      const target = getScalePitchClasses(key, mode)[chord.targetDegree - 1];
      const expectedRoot = target
        ? semitoneToPitchClass(pitchClassToSemitone(target) + 1)
        : null;
      if (!target || chord.root !== expectedRoot) {
        return invalid("substitute.root", "Tritone substitute must resolve down a semitone to its target.");
      }
      return explained(chord, `Allowed tritone substitute resolving to ${target}.`);
    }

    let native: ReturnType<typeof getDiatonicChordDefinition>;
    try {
      native = getDiatonicChordDefinition(key, mode, chord.degree);
    } catch {
      return invalid("color.degree", "Suspended/add9 chord degree must be between 1 and 7.");
    }
    if (chord.root !== native.root) {
      return invalid("color.root", "Suspended/add9 chord must retain its diatonic root.");
    }
    if (
      chord.specialKind === "suspended" &&
      (chord.quality === "sus2" || chord.quality === "sus4")
    ) {
      return explained(chord, `Allowed ${chord.quality} color on degree ${chord.degree}.`);
    }
    const expectedAdd9 = native.quality === "minor" ? "minorAdd9" : "add9";
    if (chord.specialKind === "addedTone" && chord.quality === expectedAdd9) {
      return explained(chord, `Allowed add9 color on degree ${chord.degree}.`);
    }
    return invalid("substitute.kind", "Substitute chord does not match a supported Phase 2 rule.");
  }

  return invalid("special.source", `Chord source '${chord.source}' has no supported Phase 2 explanation.`);
}

export function isDiatonicSeventh(chord: ChordEvent, key: PitchClassName, mode: Mode): boolean {
  try {
    const expected = getDiatonicSeventhChordDefinition(key, mode, chord.degree);
    return expected.root === chord.root && expected.quality === chord.quality;
  } catch {
    return false;
  }
}
