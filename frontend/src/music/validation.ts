import type {
  BarRange,
  ChordEvent,
  GeneratedComposition,
  GeneratorSettings,
  NoteEvent,
  ValidationIssue,
  ValidationResult,
} from "../types/music";
import {
  diatonicQualityForDegree,
  getDiatonicChordDefinition,
  intervalsForQuality,
} from "./chords";
import { hasCadence, romanNumeralForDegree } from "./harmonyFunctions";
import {
  getScaleMidiNotes,
  getScalePitchClasses,
  midiToNoteName,
  normalizePitchClass,
  pitchClassToSemitone,
} from "./scales";
import { ticksPerBar } from "./time";

function result(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return { valid: errors.length === 0, errors, warnings };
}

function error(code: string, message: string, context: Partial<ValidationIssue> = {}): ValidationIssue {
  return { code, severity: "error", message, ...context };
}

function warning(
  code: string,
  message: string,
  context: Partial<ValidationIssue> = {},
): ValidationIssue {
  return { code, severity: "warning", message, ...context };
}

function isProbability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateGeneratorSettings(settings: GeneratorSettings): ValidationResult {
  const issues: ValidationIssue[] = [];
  let keyIsValid = true;
  try {
    normalizePitchClass(settings.key);
  } catch {
    keyIsValid = false;
    issues.push(error("settings.key", "Key must be a supported pitch class."));
  }
  if (settings.mode !== "major" && settings.mode !== "naturalMinor") {
    issues.push(error("settings.mode", "Mode must be major or naturalMinor."));
  }
  if (!Number.isFinite(settings.bpm) || settings.bpm < 40 || settings.bpm > 240) {
    issues.push(error("settings.bpm", "BPM must be between 40 and 240."));
  }
  if (!["4/4", "3/4", "6/8"].includes(settings.timeSignature)) {
    issues.push(error("settings.timeSignature", "Time signature must be 4/4, 3/4, or 6/8."));
  }
  if (![4, 8, 16].includes(settings.bars)) {
    issues.push(error("settings.bars", "Bar count must be 4, 8, or 16."));
  }
  if (
    ![
      "pop",
      "j-pop",
      "rock",
      "jazz",
      "lo-fi",
      "edm",
      "ballad",
      "game-music",
      "random",
    ].includes(settings.style)
  ) {
    issues.push(error("settings.style", "Style must be a supported Phase 1 preset."));
  }
  if (
    (typeof settings.seed !== "string" && typeof settings.seed !== "number") ||
    (typeof settings.seed === "number" && !Number.isFinite(settings.seed)) ||
    (typeof settings.seed === "string" && settings.seed.length === 0)
  ) {
    issues.push(error("settings.seed", "Seed must be a non-empty string or finite number."));
  }

  const melody = settings.melody;
  if (
    !Number.isInteger(melody.minMidi) ||
    !Number.isInteger(melody.maxMidi) ||
    melody.minMidi < 0 ||
    melody.maxMidi > 127 ||
    melody.minMidi > melody.maxMidi
  ) {
    issues.push(error("settings.melody.range", "Melody range must use ordered MIDI integers from 0 to 127."));
  } else if (
    keyIsValid &&
    (settings.mode === "major" || settings.mode === "naturalMinor") &&
    getScaleMidiNotes(
      settings.key,
      settings.mode,
      melody.minMidi,
      melody.maxMidi,
    ).length === 0
  ) {
    issues.push(error("settings.melody.scaleRange", "Melody range must contain a note in the selected scale."));
  }
  if (!Number.isInteger(melody.velocity) || melody.velocity < 1 || melody.velocity > 127) {
    issues.push(error("settings.melody.velocity", "Velocity must be an integer from 1 to 127."));
  }
  for (const [name, value] of Object.entries({
    density: melody.density,
    chordToneRate: melody.chordToneRate,
    restRate: melody.restRate,
    syncopation: melody.syncopation,
    leapProbability: melody.leapProbability,
  })) {
    if (!isProbability(value)) {
      issues.push(error(`settings.melody.${name}`, `${name} must be between 0 and 1.`));
    }
  }
  return result(issues);
}

export function assertValidGeneratorSettings(settings: GeneratorSettings): void {
  const validation = validateGeneratorSettings(settings);
  if (!validation.valid) {
    throw new RangeError(validation.errors.map((issue) => issue.message).join(" "));
  }
}

function validateNote(
  note: NoteEvent,
  composition: GeneratedComposition,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const context = { eventId: note.id, barIndex: note.barIndex };
  if (!Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127) {
    issues.push(error("note.midi", "MIDI note must be an integer from 0 to 127.", context));
  }
  if (
    Number.isInteger(note.midi) &&
    note.midi >= 0 &&
    note.midi <= 127 &&
    note.noteName !== midiToNoteName(note.midi)
  ) {
    issues.push(error("note.name", "noteName does not match the MIDI note.", context));
  }
  if (!Number.isInteger(note.startTick) || note.startTick < 0) {
    issues.push(error("note.startTick", "Note startTick must be a non-negative integer.", context));
  }
  if (!Number.isInteger(note.durationTick) || note.durationTick <= 0) {
    issues.push(error("note.durationTick", "Note durationTick must be a positive integer.", context));
  }
  if (!Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127) {
    issues.push(error("note.velocity", "Note velocity must be an integer from 1 to 127.", context));
  }
  if (!Number.isInteger(note.barIndex) || note.barIndex < 0 || note.barIndex >= composition.settings.bars) {
    issues.push(error("note.barIndex", "Note barIndex is outside the composition.", context));
    return issues;
  }
  if (Number.isInteger(note.startTick) && Number.isInteger(note.durationTick)) {
    const barStart = note.barIndex * composition.ticksPerBar;
    const barEnd = barStart + composition.ticksPerBar;
    if (note.startTick < barStart || note.startTick + note.durationTick > barEnd) {
      issues.push(error("note.barBoundary", "Note crosses its declared bar boundary.", context));
    }
  }
  if (note.midi < composition.settings.melody.minMidi || note.midi > composition.settings.melody.maxMidi) {
    issues.push(error("note.range", "Note is outside the configured melody range.", context));
  }
  return issues;
}

/**
 * A minor cadence's dominant is a major `V` borrowed from the harmonic minor.
 * It is non-diatonic but fully explained, so it should not raise a warning. The
 * voicing check below still confirms the notes match a major triad on degree 5.
 */
function isCadentialDominant(
  chord: ChordEvent,
  composition: GeneratedComposition,
): boolean {
  if (chord.source !== "borrowed") return false;
  const dominantRoot = getScalePitchClasses(
    composition.settings.key,
    composition.settings.mode,
  )[4];
  return (
    chord.degree === 5 &&
    chord.quality === "major" &&
    chord.romanNumeral === "V" &&
    chord.root === dominantRoot
  );
}

function validateChord(
  chord: ChordEvent,
  composition: GeneratedComposition,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const barIndex = Math.floor(chord.startTick / composition.ticksPerBar);
  const context = { eventId: chord.id, barIndex };
  if (!Number.isInteger(chord.startTick) || chord.startTick < 0) {
    issues.push(error("chord.startTick", "Chord startTick must be a non-negative integer.", context));
  }
  if (!Number.isInteger(chord.durationTick) || chord.durationTick <= 0) {
    issues.push(error("chord.durationTick", "Chord durationTick must be a positive integer.", context));
  }
  if (
    chord.notes.length < 3 ||
    chord.notes.some((note) => !Number.isInteger(note) || note < 0 || note > 127)
  ) {
    issues.push(error("chord.notes", "Chord voicing must contain at least three valid MIDI notes.", context));
  }
  if (!Number.isInteger(chord.inversion) || chord.inversion < 0 || chord.inversion >= chord.notes.length) {
    issues.push(error("chord.inversion", "Chord inversion is outside its voicing.", context));
  }
  if (chord.source === "diatonic") {
    try {
      const expected = getDiatonicChordDefinition(
        composition.settings.key,
        composition.settings.mode,
        chord.degree,
      );
      if (
        expected.root !== chord.root ||
        expected.quality !== chord.quality ||
        expected.symbol !== chord.symbol ||
        chord.quality !== diatonicQualityForDegree(chord.degree, composition.settings.mode) ||
        chord.romanNumeral !== romanNumeralForDegree(chord.degree, composition.settings.mode)
      ) {
        issues.push(error("chord.diatonic", "Chord is not explained by its declared diatonic degree.", context));
      }
    } catch {
      issues.push(error("chord.degree", "Diatonic chord degree must be between 1 and 7.", context));
    }
  } else if (!isCadentialDominant(chord, composition)) {
    issues.push(
      warning(
        "chord.special",
        `Chord source '${chord.source}' requires an explicit non-diatonic explanation.`,
        context,
      ),
    );
  }
  try {
    const root = pitchClassToSemitone(chord.root);
    const expectedPitchClasses = new Set(
      intervalsForQuality(chord.quality).map((interval) => (root + interval) % 12),
    );
    const actualPitchClasses = new Set(chord.notes.map((note) => note % 12));
    if (
      expectedPitchClasses.size !== actualPitchClasses.size ||
      [...expectedPitchClasses].some((pitchClass) => !actualPitchClasses.has(pitchClass))
    ) {
      issues.push(error("chord.voicing", "Chord voicing does not match its root and quality.", context));
    }
  } catch {
    issues.push(error("chord.definition", "Chord root or quality is unsupported.", context));
  }
  return issues;
}

export function validateComposition(composition: GeneratedComposition): ValidationResult {
  const settingsValidation = validateGeneratorSettings(composition.settings);
  const issues: ValidationIssue[] = [
    ...settingsValidation.errors,
    ...settingsValidation.warnings,
  ];
  if (!Number.isInteger(composition.ppq) || composition.ppq <= 0) {
    issues.push(error("composition.ppq", "PPQ must be a positive integer."));
    return result(issues);
  }
  if (!["4/4", "3/4", "6/8"].includes(composition.timeSignature)) {
    issues.push(error("composition.timeSignature", "Composition time signature is unsupported."));
    return result(issues);
  }
  const expectedTicksPerBar = ticksPerBar(composition.timeSignature, composition.ppq);
  if (composition.settings.timeSignature !== composition.timeSignature) {
    issues.push(error("composition.timeSignature", "Composition and settings time signatures differ."));
  }
  if (composition.ticksPerBar !== expectedTicksPerBar) {
    issues.push(error("composition.ticksPerBar", "ticksPerBar does not match time signature and PPQ."));
  }
  if (composition.totalTicks !== expectedTicksPerBar * composition.settings.bars) {
    issues.push(error("composition.totalTicks", "totalTicks does not match the bar grid."));
  }

  if (composition.bars.length !== composition.settings.bars) {
    issues.push(error("bars.count", "Bar metadata count does not match settings."));
  }
  for (let index = 0; index < composition.bars.length; index += 1) {
    const bar = composition.bars[index];
    if (
      !bar ||
      bar.index !== index ||
      bar.startTick !== index * expectedTicksPerBar ||
      bar.durationTick !== expectedTicksPerBar
    ) {
      issues.push(error("bars.grid", "Bar metadata does not form an exact tick grid.", { barIndex: index }));
    }
  }

  const sortedChords = [...composition.chords].sort((left, right) => left.startTick - right.startTick);
  const chordIds = new Set<string>();
  let chordCursor = 0;
  for (const chord of sortedChords) {
    if (chordIds.has(chord.id)) {
      issues.push(error("chords.duplicateId", "Chord IDs must be unique.", { eventId: chord.id }));
    }
    chordIds.add(chord.id);
    issues.push(...validateChord(chord, composition));
    if (chord.startTick !== chordCursor) {
      issues.push(error("chords.coverage", "Chord timeline contains a gap or overlap.", { eventId: chord.id }));
    }
    chordCursor = chord.startTick + chord.durationTick;
  }
  if (chordCursor !== composition.totalTicks) {
    issues.push(error("chords.end", "Chord timeline does not end at totalTicks."));
  }

  const sortedNotes = [...composition.notes].sort(
    (left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id),
  );
  const noteIds = new Set<string>();
  let previousEnd = -1;
  for (const note of sortedNotes) {
    if (noteIds.has(note.id)) {
      issues.push(error("notes.duplicateId", "Note IDs must be unique.", { eventId: note.id }));
    }
    noteIds.add(note.id);
    issues.push(...validateNote(note, composition));
    if (note.startTick < previousEnd) {
      issues.push(error("notes.overlap", "Phase 1 melody notes must not overlap.", { eventId: note.id }));
    }
    previousEnd = Math.max(previousEnd, note.startTick + note.durationTick);
  }

  const lockSet = new Set<number>();
  for (const [lockPosition, barIndex] of composition.lockedBars.entries()) {
    if (
      !Number.isInteger(barIndex) ||
      barIndex < 0 ||
      barIndex >= composition.settings.bars ||
      lockSet.has(barIndex) ||
      (lockPosition > 0 && barIndex < (composition.lockedBars[lockPosition - 1] as number))
    ) {
      issues.push(error("locks.invalid", "Locked bars must be unique valid bar indices.", { barIndex }));
    }
    lockSet.add(barIndex);
  }

  if (
    sortedChords.length >= 2 &&
    !hasCadence(
      sortedChords.slice(-2).map((chord) => chord.degree),
      composition.cadence,
      composition.settings.mode,
      sortedChords.slice(-2).map((chord) => ({ degree: chord.degree, quality: chord.quality })),
    )
  ) {
    issues.push(
      warning(
        "cadence.metadata",
        "Ending chords do not match the stored cadence label or its dominant lacks a leading tone.",
      ),
    );
  }
  return result(issues);
}

function equivalent(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Checks the non-destructive invariant of partial regeneration. */
export function validateRegenerationPreservation(
  before: GeneratedComposition,
  after: GeneratedComposition,
  range: BarRange,
  respectLocks = true,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const locked = new Set(respectLocks ? before.lockedBars : []);
  const mustPreserve = (barIndex: number): boolean =>
    barIndex < range.startBar || barIndex >= range.endBar || locked.has(barIndex);

  const beforeNotes = groupByBar(before.notes, (note) => note.barIndex);
  const afterNotes = groupByBar(after.notes, (note) => note.barIndex);
  const beforeChords = groupByBar(before.chords, (chord) =>
    Math.floor(chord.startTick / before.ticksPerBar),
  );
  const afterChords = groupByBar(after.chords, (chord) =>
    Math.floor(chord.startTick / after.ticksPerBar),
  );
  for (let barIndex = 0; barIndex < before.settings.bars; barIndex += 1) {
    if (!mustPreserve(barIndex)) continue;
    if (!equivalent(beforeNotes.get(barIndex) ?? [], afterNotes.get(barIndex) ?? [])) {
      issues.push(error("regeneration.notes", "Regeneration changed preserved melody data.", { barIndex }));
    }
    if (!equivalent(beforeChords.get(barIndex) ?? [], afterChords.get(barIndex) ?? [])) {
      issues.push(error("regeneration.chords", "Regeneration changed preserved chord data.", { barIndex }));
    }
  }
  return result(issues);
}

function groupByBar<T>(
  events: readonly T[],
  getBar: (event: T) => number,
): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const event of events) {
    const bar = getBar(event);
    const values = grouped.get(bar) ?? [];
    values.push(event);
    grouped.set(bar, values);
  }
  return grouped;
}

export function assertValidComposition(composition: GeneratedComposition): void {
  const validation = validateComposition(composition);
  if (!validation.valid) {
    throw new Error(validation.errors.map((issue) => issue.message).join(" "));
  }
}
