import type {
  GeneratedComposition,
  GeneratorSettings,
  ValidationResult,
} from "../../types/music";
import { validateComposition } from "../../music";

export const COMPOSITION_JSON_FORMAT = "music-theory-composer";
export const COMPOSITION_JSON_VERSION = 1;
export const PROJECT_SCHEMA_VERSION = 2;
export const PROJECT_APP_VERSION = "0.3.0";
export const MAX_COMPOSITION_JSON_CHARACTERS = 5_000_000;
export const MAX_COMPOSITION_FILE_BYTES = 6_000_000;

export interface CompositionJsonDocument {
  format: typeof COMPOSITION_JSON_FORMAT;
  version: typeof COMPOSITION_JSON_VERSION;
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  appVersion: string;
  exportedAt: string;
  composition: GeneratedComposition;
}

export class CompositionImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompositionImportError";
  }
}

export interface CompositionFileLike {
  name: string;
  size: number;
  type: string;
  text(): Promise<string>;
}

export interface ValidatedCompositionFile {
  json: string;
  composition: GeneratedComposition;
}

/**
 * Checks size, MIME/extension hints, and finally the document content. Empty
 * MIME types are accepted for Safari and desktop file pickers only when the
 * extension is JSON; the strict schema validator remains the source of truth.
 */
export async function importCompositionFile(
  file: CompositionFileLike,
): Promise<ValidatedCompositionFile> {
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_COMPOSITION_FILE_BYTES) {
    throw new CompositionImportError("Project file is too large (maximum 6 MB).");
  }
  const mime = file.type.trim().toLowerCase();
  const jsonMime = mime === "application/json" || mime === "text/json" || mime === "application/x-json";
  const neutralMime = mime === "" || mime === "application/octet-stream";
  const jsonExtension = /\.json$/i.test(file.name.trim());
  if (!jsonMime && !(neutralMime && jsonExtension)) {
    throw new CompositionImportError("Choose a JSON project file. The current composition is unchanged.");
  }
  const json = await file.text();
  return { json, composition: importCompositionJson(json) };
}

/**
 * A colour a voice may carry into an inline style.
 *
 * Either a six-digit hex, which is what every project saved before the theme
 * work holds, or a reference to one of this app's own track tokens. Kept to a
 * closed pattern rather than "any string": the value is written straight into a
 * style attribute by the piano roll, so an imported file must not be able to
 * put arbitrary CSS there.
 */
function isTrackColour(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value) || /^var\(--track-[a-z]+(-fill)?\)$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalProbability(
  value: Record<string, unknown>,
  field: string,
): boolean {
  const candidate = value[field];
  return candidate === undefined || (
    isFiniteNumber(candidate) && candidate >= 0 && candidate <= 1
  );
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
    ![4, 8, 16, 24, 32, 48].includes(value.bars as number) ||
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
    ["triads", "sevenths", "advanced"].includes(value.harmony.complexity) &&
    [
      "borrowedChordRate",
      "secondaryDominantRate",
      "explorationRate",
      "voiceLeadingStrength",
    ].every((field) => isOptionalProbability(value.harmony as Record<string, unknown>, field))
  );
  const validMotif = value.motif === undefined || (
    isRecord(value.motif) &&
    typeof value.motif.enabled === "boolean" &&
    (value.motif.lengthBars === 1 || value.motif.lengthBars === 2) &&
    isFiniteNumber(value.motif.transformationRate) &&
    value.motif.transformationRate >= 0 &&
    value.motif.transformationRate <= 1
  );
  const arrangement = value.arrangement;
  const validArrangement = arrangement === undefined || (
    isRecord(arrangement) &&
    (
      arrangement.counterpoint === undefined
      || (
        isRecord(arrangement.counterpoint)
        && typeof arrangement.counterpoint.enabled === "boolean"
        && (
          arrangement.counterpoint.position === undefined
          || arrangement.counterpoint.position === "above"
          || arrangement.counterpoint.position === "below"
        )
        && (
          arrangement.counterpoint.independence === undefined
          || (
            isFiniteNumber(arrangement.counterpoint.independence)
            && arrangement.counterpoint.independence >= 0
            && arrangement.counterpoint.independence <= 1
          )
        )
      )
    )
    && (
      arrangement.canon === undefined
      || (
        isRecord(arrangement.canon)
        && typeof arrangement.canon.enabled === "boolean"
        && isFiniteNumber(arrangement.canon.delayBeats)
        && arrangement.canon.delayBeats > 0
        && arrangement.canon.delayBeats <= 16
        && (
          arrangement.canon.interval === undefined
          || (
            Number.isInteger(arrangement.canon.interval)
            && Math.abs(arrangement.canon.interval as number) <= 24
          )
        )
        && (
          arrangement.canon.inverted === undefined
          || typeof arrangement.canon.inverted === "boolean"
        )
      )
    )
    && (
      arrangement.polyrhythm === undefined
      || (
        isRecord(arrangement.polyrhythm)
        && typeof arrangement.polyrhythm.enabled === "boolean"
        && Number.isInteger(arrangement.polyrhythm.pulses)
        && (arrangement.polyrhythm.pulses as number) >= 1
        && (arrangement.polyrhythm.pulses as number) <= 16
        && (
          arrangement.polyrhythm.spanBars === undefined
          || (
            Number.isInteger(arrangement.polyrhythm.spanBars)
            && (arrangement.polyrhythm.spanBars as number) >= 1
            && (arrangement.polyrhythm.spanBars as number) <= 4
          )
        )
      )
    )
  );
  return (
    validHarmony &&
    validMotif &&
    validArrangement &&
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

  // Sections are optional, so a file written before they existed still loads.
  // When present they must tile the bar grid exactly, which is the invariant
  // the rest of the engine relies on to resolve a chord's key.
  if (value.sections !== undefined) {
    const sectionKinds = [
      "intro", "verse", "preChorus", "chorus", "bridge",
      "quietChorus", "finalChorus", "outro",
    ];
    const sectionModes = ["major", "naturalMinor", "harmonicMinor", "dorian", "mixolydian"];
    const melodyScales = ["diatonic", "yonaNuki", "niroNuki"];
    const pitchClasses = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    if (!Array.isArray(value.sections) || value.sections.length === 0) return false;
    const sectionIds = new Set<string>();
    let cursor = 0;
    for (const section of value.sections) {
      if (
        !isRecord(section) ||
        typeof section.id !== "string" ||
        section.id.length === 0 ||
        !registerUnique(sectionIds, section.id) ||
        typeof section.kind !== "string" ||
        !sectionKinds.includes(section.kind) ||
        !Number.isInteger(section.startBar) ||
        section.startBar !== cursor ||
        !Number.isInteger(section.endBar) ||
        (section.endBar as number) <= (section.startBar as number) ||
        typeof section.key !== "string" ||
        !pitchClasses.includes(section.key) ||
        typeof section.mode !== "string" ||
        !sectionModes.includes(section.mode) ||
        !Number.isInteger(section.transpose) ||
        (section.melodyMode !== undefined &&
          (typeof section.melodyMode !== "string" || !sectionModes.includes(section.melodyMode))) ||
        (section.melodyScale !== undefined &&
          (typeof section.melodyScale !== "string" || !melodyScales.includes(section.melodyScale))) ||
        (section.progressionId !== undefined && typeof section.progressionId !== "string")
      ) {
        return false;
      }
      cursor = section.endBar as number;
    }
    if (cursor !== settings.bars) return false;
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
    "passingDiminished", "chromatic",
  ];
  const tensions = ["6", "9", "b9", "#9", "11", "#11", "13", "b13"];
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
      (item.tensions === undefined || (
        Array.isArray(item.tensions) &&
        item.tensions.every((tension) =>
          typeof tension === "string" && tensions.includes(tension))
      )) &&
      (item.bass === undefined || (
        typeof item.bass === "string" && roots.includes(item.bass)
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
      )) &&
      (item.transformation === undefined || (
        isRecord(item.transformation) &&
        item.transformation.theory === "neoRiemannian" &&
        typeof item.transformation.operation === "string" &&
        ["P", "L", "R"].includes(item.transformation.operation) &&
        typeof item.transformation.fromRoot === "string" &&
        roots.includes(item.transformation.fromRoot) &&
        typeof item.transformation.fromQuality === "string" &&
        ["major", "minor"].includes(item.transformation.fromQuality)
      ))
    );
  });

  const roles = ["chordTone", "scaleTone", "passing", "neighbor", "approach"];
  const noteIds = new Set<string>();
  const validNoteItem = (item: unknown): boolean => {
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
  };
  const validNote = value.notes.every(validNoteItem);

  const voiceIds = new Set<string>();
  const voiceRoles = ["countermelody", "canon", "pulse"];
  const voiceInstruments = ["softLead", "pluck", "bass"];
  const validVoices = value.voices === undefined || (
    Array.isArray(value.voices)
    && value.voices.every((voice) =>
      isRecord(voice)
      && typeof voice.id === "string"
      && voice.id.length > 0
      && registerUnique(voiceIds, voice.id)
      && typeof voice.name === "string"
      && voice.name.length > 0
      && typeof voice.role === "string"
      && voiceRoles.includes(voice.role)
      && typeof voice.instrument === "string"
      && voiceInstruments.includes(voice.instrument)
      && typeof voice.color === "string"
      && isTrackColour(voice.color)
      && (voice.fill === undefined
        || (typeof voice.fill === "string" && isTrackColour(voice.fill)))
      && Number.isInteger(voice.midiChannel)
      && (voice.midiChannel as number) >= 0
      && (voice.midiChannel as number) <= 15
      && (voice.muted === undefined || typeof voice.muted === "boolean")
      && Array.isArray(voice.notes)
      && voice.notes.every(validNoteItem)
    )
  );

  return validChord && validNote && validVoices;
}

function makeDocument(
  composition: GeneratedComposition,
  exportedAt = new Date().toISOString(),
): CompositionJsonDocument {
  return {
    format: COMPOSITION_JSON_FORMAT,
    version: COMPOSITION_JSON_VERSION,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    appVersion: PROJECT_APP_VERSION,
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
    throw new CompositionImportError("This is not a Visual studio chord document.");
  }

  if (parsed.version !== COMPOSITION_JSON_VERSION) {
    throw new CompositionImportError(`Unsupported composition version: ${String(parsed.version)}.`);
  }

  // Files exported before schemaVersion/appVersion were added are migrated as
  // schema v1. Unknown newer schemas are rejected instead of guessed.
  if (
    parsed.schemaVersion !== undefined
    && parsed.schemaVersion !== 1
    && parsed.schemaVersion !== PROJECT_SCHEMA_VERSION
  ) {
    throw new CompositionImportError(
      `Unsupported project schema version: ${String(parsed.schemaVersion)}.`,
    );
  }
  if (parsed.appVersion !== undefined && typeof parsed.appVersion !== "string") {
    throw new CompositionImportError("The project app version is invalid.");
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
