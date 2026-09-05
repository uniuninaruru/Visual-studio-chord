import type {
  GeneratedComposition,
  GeneratorSettings,
  PitchClassName,
  SectionArrangementPlan,
  ValidationResult,
} from "../../types/music";
import { handsAreConsistent } from "../../music/hands";
import { normalizePitchClass } from "../../music/scales";
import { validateSectionArrangement } from "../../music/sectionArrangement";
import { validateComposition } from "../../music/validation";

export const COMPOSITION_JSON_FORMAT = "music-theory-composer";
export const COMPOSITION_JSON_VERSION = 1;
export const PROJECT_SCHEMA_VERSION = 3;
export const PROJECT_APP_VERSION = "0.5.0";
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

const ORDINARY_EDITOR_BAR_COUNTS = [4, 8, 16, 24, 32, 48] as const;
const ARRANGEMENT_BAR_COUNTS = [40, 56, 64, 72, 80, 88, 96, 104, 112, 120, 128] as const;

function isGeneratorSettingsWithBars(
  value: unknown,
  allowArrangementBars: boolean,
): value is GeneratorSettings {
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
    !(
      ORDINARY_EDITOR_BAR_COUNTS.includes(value.bars as (typeof ORDINARY_EDITOR_BAR_COUNTS)[number])
      || (
        allowArrangementBars
        && ARRANGEMENT_BAR_COUNTS.includes(value.bars as (typeof ARRANGEMENT_BAR_COUNTS)[number])
      )
    ) ||
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
    (value.progressionId !== undefined && typeof value.progressionId !== "string") ||
    (value.tonalTension !== undefined && !isRecord(value.tonalTension)) ||
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
  const validTonalTension = value.tonalTension === undefined ||
    typeof value.tonalTension.enabled === "boolean";
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
    validTonalTension &&
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

export function isGeneratorSettings(value: unknown): value is GeneratorSettings {
  return isGeneratorSettingsWithBars(value, false);
}

/**
 * A deliberately strict boundary check for files received from outside the
 * application. The music validator performs the deeper theory checks after
 * this structural check succeeds.
 */
function isFlatGeneratedComposition(
  value: unknown,
  allowArrangementBars: boolean,
  allowArrangementPlan: boolean,
): value is GeneratedComposition {
  if (!isRecord(value)) {
    return false;
  }

  if (
    (!allowArrangementPlan && Object.prototype.hasOwnProperty.call(value, "arrangementPlan"))
    || !isGeneratorSettingsWithBars(value.settings, allowArrangementBars)
    || !Array.isArray(value.chords)
    || !Array.isArray(value.notes)
  ) {
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
    !isNonEmptyString(value.seed) ||
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
    const tonalMarkerAllowed = settings.tonalTension?.enabled === true
      && settings.functionalHarmony?.enabled === true
      && settings.progressionId === undefined
      && !Object.prototype.hasOwnProperty.call(value, "arrangementPlan");
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
        (section.progressionId !== undefined && typeof section.progressionId !== "string") ||
        (section.tonalTensionApplied !== undefined && section.tonalTensionApplied !== true) ||
        (section.tonalTensionApplied === true && !tonalMarkerAllowed)
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
      // A hand assignment is a set of the chord's own pitches. A file naming
      // pitches the chord does not contain would put a note in the bass that
      // the harmony never sounds, and fail to take it out of the right hand.
      (item.leftHand === undefined || (
        Array.isArray(item.leftHand) &&
        item.leftHand.every((note) => Number.isInteger(note)) &&
        handsAreConsistent({
          notes: item.notes as number[],
          leftHand: item.leftHand as number[],
        })
      )) &&
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

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isArrangementSeed(value: unknown): value is string | number {
  return (
    (typeof value === "string" && value.length > 0)
    || (typeof value === "number" && Number.isFinite(value))
  );
}

function hasSectionMaterialBarCount(value: unknown): boolean {
  return isRecord(value)
    && isRecord(value.settings)
    && [8, 16, 24, 32].includes(value.settings.bars as number);
}

const ARRANGEMENT_ROLES = ["intro", "aMelo", "bMelo", "cMelo"] as const;
const ARRANGEMENT_TEMPLATE_IDS = [
  "intro-ambient", "intro-hook", "a-narrative", "a-groove",
  "b-build", "b-lift", "c-release", "c-contrast",
] as const;
const ARRANGEMENT_MODES = [
  "major", "naturalMinor", "harmonicMinor", "dorian", "mixolydian",
] as const;
const ARRANGEMENT_STYLES = [
  "pop", "j-pop", "rock", "jazz", "lo-fi", "edm", "ballad", "game-music", "random",
] as const;
const ARRANGEMENT_LINK_MODES = ["auto", "direct", "dominant", "pivot"] as const;
const ARRANGEMENT_LINK_TECHNIQUES = [
  "direct", "pivot", "secondaryDominant", "commonTone", "voiceLeading",
  "tritoneSub", "backdoor", "diminishedApproach", "chromaticApproach", "subdominantPrep",
] as const;

function isSectionArrangementPlanShape(value: unknown): value is SectionArrangementPlan {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "id", "seed", "revision", "assembledRevision", "manualSongEdited",
    "sections", "sequence", "links", "resolvedLinks",
  ])) {
    return false;
  }
  if (
    value.version !== 1
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.seed)
    || !isSafeNonNegativeInteger(value.revision)
    || (
      value.assembledRevision !== null
      && !isSafeNonNegativeInteger(value.assembledRevision)
    )
    || (
      isSafeNonNegativeInteger(value.assembledRevision)
      && value.assembledRevision > value.revision
    )
    || typeof value.manualSongEdited !== "boolean"
    || !Array.isArray(value.sections)
    || !Array.isArray(value.sequence)
    || !Array.isArray(value.links)
    || !Array.isArray(value.resolvedLinks)
  ) {
    return false;
  }

  const sections = value.sections;
  const sectionIds = new Set<string>();
  for (const source of sections) {
    if (!isRecord(source) || !hasExactKeys(source, ["design", "material", "generationRevision", "dirty"])) {
      return false;
    }
    if (
      !isRecord(source.design)
      || !hasExactKeys(source.design, ["id", "role", "name", "templateId", "bars", "key", "mode", "style", "seed"])
      || !isNonEmptyString(source.design.id)
      || !registerUnique(sectionIds, source.design.id)
      || !ARRANGEMENT_ROLES.includes(source.design.role as (typeof ARRANGEMENT_ROLES)[number])
      || !isNonEmptyString(source.design.name)
      || !ARRANGEMENT_TEMPLATE_IDS.includes(source.design.templateId as (typeof ARRANGEMENT_TEMPLATE_IDS)[number])
      || ![8, 16, 24, 32].includes(source.design.bars as number)
      || typeof source.design.key !== "string"
      || !ARRANGEMENT_MODES.includes(source.design.mode as (typeof ARRANGEMENT_MODES)[number])
      || !ARRANGEMENT_STYLES.includes(source.design.style as (typeof ARRANGEMENT_STYLES)[number])
      || !isArrangementSeed(source.design.seed)
      || !isFlatGeneratedComposition(source.material, false, false)
      || !hasSectionMaterialBarCount(source.material)
      || !isSafeNonNegativeInteger(source.generationRevision)
      || typeof source.dirty !== "boolean"
    ) {
      return false;
    }
    try {
      normalizePitchClass(source.design.key as PitchClassName);
    } catch {
      return false;
    }
  }

  const sequence = value.sequence;
  const instanceIds = new Set<string>();
  for (const instance of sequence) {
    if (
      !isRecord(instance)
      || !hasExactKeys(instance, ["id", "sourceSectionId"])
      || !isNonEmptyString(instance.id)
      || !registerUnique(instanceIds, instance.id)
      || !isNonEmptyString(instance.sourceSectionId)
    ) {
      return false;
    }
  }

  const links = value.links;
  const linkIds = new Set<string>();
  for (const link of links) {
    if (
      !isRecord(link)
      || !hasExactKeys(link, ["id", "fromInstanceId", "toInstanceId", "mode", "seed"])
      || !isNonEmptyString(link.id)
      || !registerUnique(linkIds, link.id)
      || !isNonEmptyString(link.fromInstanceId)
      || !isNonEmptyString(link.toInstanceId)
      || !ARRANGEMENT_LINK_MODES.includes(link.mode as (typeof ARRANGEMENT_LINK_MODES)[number])
      || !isNonEmptyString(link.seed)
    ) {
      return false;
    }
  }

  const resolvedLinks = value.resolvedLinks;
  const resolvedIds = new Set<string>();
  for (const resolved of resolvedLinks) {
    if (
      !isRecord(resolved)
      || !hasExactKeys(resolved, [
        "linkId", "fromInstanceId", "toInstanceId", "boundaryBar", "mode",
        "technique", "label", "explanation",
      ])
      || !isNonEmptyString(resolved.linkId)
      || !registerUnique(resolvedIds, resolved.linkId)
      || !isNonEmptyString(resolved.fromInstanceId)
      || !isNonEmptyString(resolved.toInstanceId)
      || !isSafeNonNegativeInteger(resolved.boundaryBar)
      || !ARRANGEMENT_LINK_MODES.includes(resolved.mode as (typeof ARRANGEMENT_LINK_MODES)[number])
      || !ARRANGEMENT_LINK_TECHNIQUES.includes(resolved.technique as (typeof ARRANGEMENT_LINK_TECHNIQUES)[number])
      || typeof resolved.label !== "string"
      || resolved.label.length === 0
      || typeof resolved.explanation !== "string"
      || resolved.explanation.length === 0
    ) {
      return false;
    }
  }

  if (value.assembledRevision !== value.revision && resolvedLinks.length > 0) {
    return false;
  }
  if (value.assembledRevision === value.revision) {
    const sourcesById = new Map(
      sections.map((source) => [
        (source.design as Record<string, unknown>).id,
        source,
      ]),
    );
    for (const instance of sequence) {
      const source = sourcesById.get((instance as Record<string, unknown>).sourceSectionId as string);
      if (source && source.dirty === true) return false;
    }
  }
  try {
    const validationTarget = value.assembledRevision === value.revision
      ? { ...value, manualSongEdited: false }
      : value;
    return validateSectionArrangement(validationTarget as unknown as SectionArrangementPlan).valid;
  } catch {
    return false;
  }
}

const ARRANGEMENT_ROLE_TO_KIND: Readonly<Record<(typeof ARRANGEMENT_ROLES)[number], string>> = {
  intro: "intro",
  aMelo: "verse",
  bMelo: "preChorus",
  cMelo: "chorus",
};

function matchesCurrentArrangementComposition(
  composition: GeneratedComposition,
  plan: SectionArrangementPlan,
): boolean {
  if (plan.assembledRevision !== plan.revision || plan.manualSongEdited) return true;
  const sources = new Map(plan.sections.map((source) => [source.design.id, source]));
  let totalBars = 0;
  for (const instance of plan.sequence) {
    const source = sources.get(instance.sourceSectionId);
    if (!source) return false;
    totalBars += source.design.bars;
  }
  if (composition.settings.bars !== totalBars || !Array.isArray(composition.sections)) return false;
  if (composition.sections.length !== plan.sequence.length) return false;
  let offsetBar = 0;
  for (const [index, instance] of plan.sequence.entries()) {
    const source = sources.get(instance.sourceSectionId);
    const section = composition.sections[index];
    if (!source || !section) return false;
    let key: string;
    try {
      key = normalizePitchClass(source.design.key);
    } catch {
      return false;
    }
    if (
      section.id !== instance.id
      || section.kind !== ARRANGEMENT_ROLE_TO_KIND[source.design.role]
      || section.startBar !== offsetBar
      || section.endBar !== offsetBar + source.design.bars
      || section.key !== key
      || section.mode !== source.design.mode
      || section.progressionId !== source.material.settings.progressionId
    ) {
      return false;
    }
    offsetBar += source.design.bars;
  }
  return offsetBar === totalBars;
}

export function isGeneratedComposition(value: unknown): value is GeneratedComposition {
  if (!isRecord(value)) return false;
  const hasArrangementPlan = Object.prototype.hasOwnProperty.call(value, "arrangementPlan");
  if (hasArrangementPlan && !isSectionArrangementPlanShape(value.arrangementPlan)) return false;
  if (!isFlatGeneratedComposition(value, hasArrangementPlan, hasArrangementPlan)) return false;
  return !hasArrangementPlan || matchesCurrentArrangementComposition(
    value,
    value.arrangementPlan as SectionArrangementPlan,
  );
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

  // Files exported before schemaVersion/appVersion were added are schema v1;
  // schema v2 is also a supported pre-arrangement document. Unknown newer
  // schemas are rejected instead of guessed.
  const schemaVersion = parsed.schemaVersion === undefined ? 1 : parsed.schemaVersion;
  if (
    !Number.isInteger(schemaVersion)
    || ![1, 2, PROJECT_SCHEMA_VERSION].includes(schemaVersion as number)
  ) {
    throw new CompositionImportError(
      `Unsupported project schema version: ${String(schemaVersion)}.`,
    );
  }
  if (parsed.appVersion !== undefined && typeof parsed.appVersion !== "string") {
    throw new CompositionImportError("The project app version is invalid.");
  }

  let composition: unknown;
  try {
    composition = structuredClone(parsed.composition);
  } catch {
    throw new CompositionImportError("The composition data could not be cloned safely.");
  }
  if (schemaVersion !== PROJECT_SCHEMA_VERSION && isRecord(composition)) {
    // Schemas 1 and 2 never defined arrangementPlan. Remove an injected plan
    // before structural validation so property presence cannot unlock wide bars.
    delete composition.arrangementPlan;
  }
  if (
    schemaVersion === PROJECT_SCHEMA_VERSION
    && isRecord(composition)
    && isRecord(composition.arrangementPlan)
    && composition.arrangementPlan.version !== 1
  ) {
    throw new CompositionImportError(
      `Unsupported arrangement plan version: ${String(composition.arrangementPlan.version)}.`,
    );
  }

  if (!isGeneratedComposition(composition)) {
    throw new CompositionImportError("The composition data is incomplete or out of range.");
  }

  let validation: ValidationResult;
  try {
    validation = validateComposition(composition);
  } catch {
    throw new CompositionImportError("The composition could not be validated.");
  }
  if (!validation.valid) {
    const summary = validation.errors.map((issue) => issue.message).join(" ");
    throw new CompositionImportError(`The composition failed validation. ${summary}`.trim());
  }

  return structuredClone(composition);
}
