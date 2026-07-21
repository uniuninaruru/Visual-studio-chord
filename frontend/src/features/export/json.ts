import type {
  GeneratedComposition,
  GeneratorSettings,
  ValidationResult,
} from "../../types/music";
import { validateComposition } from "../../music";

export const COMPOSITION_JSON_FORMAT = "music-theory-composer";
export const COMPOSITION_JSON_VERSION = 1;
export const MAX_COMPOSITION_JSON_CHARACTERS = 5_000_000;

export interface CompositionJsonDocument {
  format: typeof COMPOSITION_JSON_FORMAT;
  version: typeof COMPOSITION_JSON_VERSION;
  exportedAt: string;
  composition: GeneratedComposition;
}

export class CompositionImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompositionImportError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function registerUnique(values: Set<string>, value: string): boolean {
  if (values.has(value)) {
    return false;
  }
  values.add(value);
  return true;
}

export function isGeneratorSettings(value: unknown): value is GeneratorSettings {
  if (!isRecord(value)) {
    return false;
  }

  const modes = ["major", "naturalMinor", "harmonicMinor", "dorian", "mixolydian"];
  const signatures = ["4/4", "3/4", "6/8"];
  const pitchClasses = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
    "Db", "Eb", "Gb", "Ab", "Bb", "B#", "Cb", "E#", "Fb",
  ];
  const styles = [
    "pop",
    "j-pop",
    "rock",
    "jazz",
    "lo-fi",
    "edm",
    "ballad",
    "game-music",
    "random",
  ];
  if (
    !isFiniteNumber(value.bpm) ||
    value.bpm < 40 ||
    value.bpm > 240 ||
    !Number.isInteger(value.bars) ||
    (value.bars !== 4 && value.bars !== 8 && value.bars !== 16) ||
    typeof value.key !== "string" ||
    !pitchClasses.includes(value.key) ||
    typeof value.mode !== "string" ||
    !modes.includes(value.mode) ||
    typeof value.timeSignature !== "string" ||
    !signatures.includes(value.timeSignature) ||
    typeof value.style !== "string" ||
    !styles.includes(value.style) ||
    (typeof value.seed !== "string" && typeof value.seed !== "number") ||
    (typeof value.seed === "number" && !Number.isFinite(value.seed)) ||
    (typeof value.seed === "string" && value.seed.length === 0) ||
    !isRecord(value.melody)
  ) {
    return false;
  }

  const melody = value.melody;
  const validHarmony = value.harmony === undefined || (
    isRecord(value.harmony) &&
    typeof value.harmony.complexity === "string" &&
    ["triads", "sevenths", "advanced"].includes(value.harmony.complexity)
  );
  const validMotif = value.motif === undefined || (
    isRecord(value.motif) &&
    typeof value.motif.enabled === "boolean" &&
    (value.motif.lengthBars === 1 || value.motif.lengthBars === 2) &&
    isFiniteNumber(value.motif.transformationRate) &&
    value.motif.transformationRate >= 0 &&
    value.motif.transformationRate <= 1
  );
  return (
    validHarmony &&
    validMotif &&
    Number.isInteger(melody.minMidi) &&
    Number.isInteger(melody.maxMidi) &&
    (melody.minMidi as number) >= 0 &&
    (melody.maxMidi as number) <= 127 &&
    (melody.minMidi as number) <= (melody.maxMidi as number) &&
    Number.isInteger(melody.velocity) &&
    (melody.velocity as number) >= 1 &&
    (melody.velocity as number) <= 127 &&
    ["density", "chordToneRate", "restRate", "syncopation", "leapProbability"].every(
      (field) =>
        isFiniteNumber(melody[field]) &&
        (melody[field] as number) >= 0 &&
        (melody[field] as number) <= 1,
    )
  );
}

/**
 * A deliberately strict boundary check for files received from outside the
 * application. The music validator performs the deeper theory checks after
 * this structural check succeeds.
 */
export function isGeneratedComposition(value: unknown): value is GeneratedComposition {
  if (!isRecord(value)) {
    return false;
  }

  if (!isGeneratorSettings(value.settings) || !Array.isArray(value.chords) || !Array.isArray(value.notes)) {
    return false;
  }

  const settings = value.settings;
  const concreteStyles = [
    "pop", "j-pop", "rock", "jazz", "lo-fi", "edm", "ballad", "game-music",
  ];
  const cadences = ["authentic", "plagal", "half", "deceptive", "loop"];
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.version !== COMPOSITION_JSON_VERSION ||
    typeof value.seed !== "string" ||
    !Number.isInteger(value.ppq) ||
    (value.ppq as number) <= 0 ||
    !Number.isInteger(value.ticksPerBar) ||
    (value.ticksPerBar as number) <= 0 ||
    !Number.isInteger(value.totalTicks) ||
    value.totalTicks !== (value.ticksPerBar as number) * (settings.bars as number) ||
    value.timeSignature !== settings.timeSignature ||
    typeof value.resolvedStyle !== "string" ||
    !concreteStyles.includes(value.resolvedStyle) ||
    typeof value.cadence !== "string" ||
    !cadences.includes(value.cadence) ||
    !Array.isArray(value.bars) ||
    value.bars.length !== settings.bars ||
    !Array.isArray(value.lockedBars) ||
    !value.lockedBars.every(
      (bar) => Number.isInteger(bar) && bar >= 0 && bar < (settings.bars as number),
    ) ||
    new Set(value.lockedBars).size !== value.lockedBars.length
  ) {
    return false;
  }

  const validBars = value.bars.every(
    (bar, index) =>
      isRecord(bar) &&
      bar.index === index &&
      bar.startTick === index * (value.ticksPerBar as number) &&
      bar.durationTick === value.ticksPerBar,
  );
  if (!validBars) {
    return false;
  }

  const functions = ["tonic", "predominant", "dominant", "other"];
  const qualities = [
    "major", "minor", "diminished", "augmented", "dominant7", "major7", "minor7",
    "halfDiminished7", "diminished7", "minorMajor7", "augmentedMajor7",
    "sus2", "sus4", "add9", "minorAdd9",
  ];
  const roots = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const sources = ["diatonic", "secondaryDominant", "borrowed", "substitute", "other"];
  const specialKinds = [
    "secondaryDominant", "borrowed", "tritoneSubstitution", "suspended", "addedTone",
  ];
  const modes = ["major", "naturalMinor", "harmonicMinor", "dorian", "mixolydian"];
  const chordIds = new Set<string>();
  const validChord = value.chords.every((item) => {
    if (!isRecord(item)) {
      return false;
    }

    return (
      typeof item.id === "string" &&
      item.id.length > 0 &&
      registerUnique(chordIds, item.id) &&
      typeof item.symbol === "string" &&
      typeof item.romanNumeral === "string" &&
      typeof item.function === "string" &&
      functions.includes(item.function) &&
      Number.isInteger(item.degree) &&
      (item.degree as number) >= 0 &&
      (item.degree as number) <= 7 &&
      typeof item.quality === "string" &&
      qualities.includes(item.quality) &&
      typeof item.root === "string" &&
      roots.includes(item.root) &&
      Number.isInteger(item.startTick) &&
      (item.startTick as number) >= 0 &&
      Number.isInteger(item.durationTick) &&
      (item.durationTick as number) > 0 &&
      (item.startTick as number) + (item.durationTick as number) <=
        (value.totalTicks as number) &&
      Array.isArray(item.notes) &&
      item.notes.length >= 3 &&
      item.notes.every((note) => Number.isInteger(note) && note >= 0 && note <= 127) &&
      Number.isInteger(item.inversion) &&
      (item.inversion as number) >= 0 &&
      (item.inversion as number) < item.notes.length &&
      typeof item.source === "string" &&
      sources.includes(item.source) &&
      (item.specialKind === undefined || (
        typeof item.specialKind === "string" && specialKinds.includes(item.specialKind)
      )) &&
      (item.targetDegree === undefined || (
        Number.isInteger(item.targetDegree) &&
        (item.targetDegree as number) >= 1 &&
        (item.targetDegree as number) <= 7
      )) &&
      (item.borrowedFromMode === undefined || (
        typeof item.borrowedFromMode === "string" && modes.includes(item.borrowedFromMode)
      )) &&
      (item.explanation === undefined || (
        typeof item.explanation === "string" && item.explanation.length <= 1_000
      ))
    );
  });

  const roles = ["chordTone", "scaleTone", "passing", "neighbor", "approach"];
  const noteIds = new Set<string>();
  const validNote = value.notes.every((item) => {
    if (!isRecord(item)) {
      return false;
    }

    return (
      typeof item.id === "string" &&
      item.id.length > 0 &&
      registerUnique(noteIds, item.id) &&
      Number.isInteger(item.midi) &&
      (item.midi as number) >= 0 &&
      (item.midi as number) <= 127 &&
      typeof item.noteName === "string" &&
      Number.isInteger(item.startTick) &&
      (item.startTick as number) >= 0 &&
      Number.isInteger(item.durationTick) &&
      (item.durationTick as number) > 0 &&
      (item.startTick as number) + (item.durationTick as number) <=
        (value.totalTicks as number) &&
      isFiniteNumber(item.velocity) &&
      item.velocity >= 1 &&
      item.velocity <= 127 &&
      Number.isInteger(item.barIndex) &&
      (item.barIndex as number) >= 0 &&
      (item.barIndex as number) < settings.bars &&
      typeof item.role === "string" &&
      roles.includes(item.role)
    );
  });

  return validChord && validNote;
}

function makeDocument(
  composition: GeneratedComposition,
  exportedAt = new Date().toISOString(),
): CompositionJsonDocument {
  return {
    format: COMPOSITION_JSON_FORMAT,
    version: COMPOSITION_JSON_VERSION,
    exportedAt,
    composition,
  };
}

export function exportCompositionJson(
  composition: GeneratedComposition,
  space: number | string = 2,
): string {
  return JSON.stringify(makeDocument(composition), null, space);
}

export function importCompositionJson(json: string): GeneratedComposition {
  if (json.length > MAX_COMPOSITION_JSON_CHARACTERS) {
    throw new CompositionImportError("The selected JSON file is too large.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CompositionImportError("The selected file is not valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new CompositionImportError("The JSON document must be an object.");
  }

  if (parsed.format !== COMPOSITION_JSON_FORMAT) {
    throw new CompositionImportError("This is not a Music Theory Composer document.");
  }

  if (parsed.version !== COMPOSITION_JSON_VERSION) {
    throw new CompositionImportError(`Unsupported composition version: ${String(parsed.version)}.`);
  }

  if (!isGeneratedComposition(parsed.composition)) {
    throw new CompositionImportError("The composition data is incomplete or out of range.");
  }

  let validation: ValidationResult;
  try {
    validation = validateComposition(parsed.composition);
  } catch {
    throw new CompositionImportError("The composition could not be validated.");
  }
  if (!validation.valid) {
    const summary = validation.errors.map((issue) => issue.message).join(" ");
    throw new CompositionImportError(`The composition failed validation. ${summary}`.trim());
  }

  return structuredClone(parsed.composition);
}
