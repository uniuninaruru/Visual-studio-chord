import { create } from "zustand";
import {
  DEFAULT_GENERATOR_SETTINGS,
  analyzeArrangementQuality,
  generateComposition as buildComposition,
  createStepChordEvent,
  regenerateRange,
  replaceChordSymbol,
  ticksPerBeat,
  validateComposition,
  appliedDominantResolves,
  explainSpecialChord,
  getDiatonicChordDefinition,
  getDiatonicSeventhChordDefinition,
  getScalePitchClasses,
  harmonyFunctionForDegree,
  romanNumeralForChordQuality,
  scaleDegreeForPitchClass,
  transformTriad,
} from "../music";
import type {
  BarRange,
  ChordEvent,
  ProgressionStep,
  GeneratedComposition,
  GeneratorSettings,
  NoteEvent,
  RegenerationOptions,
  SectionEvent,
} from "../types/music";
import {
  exportCompositionJson,
  exportCompositionMidi,
  importCompositionJson,
} from "../features/export";
import {
  clearEditorSnapshot,
  getSafeStorage,
  getSafeStorageMode,
  loadEditorSnapshotWithStatus,
  saveEditorCurrentSnapshot,
  serializeHistoryState,
  parseHistorySnapshotJson,
  migrateEditorHistoryToDatabase,
  EditorDatabase,
  EDITOR_HISTORY_RECORD,
  type PersistedHistoryState,
  type PersistedEditorSnapshot,
  type StoragePersistenceMode,
} from "../storage";
import { generatePreferred, type PreferenceGuidance } from "../preference/generation";

export type PlaybackStatus = "stopped" | "playing" | "paused";
export type UpdateTiming = "immediate" | "nextBeat" | "nextBar" | "nextLoop";
export type ProjectSaveStatus =
  | "saved"
  | "saving"
  | "unsaved"
  | "partial"
  | "session"
  | "recovery"
  | "error";
export type ProjectRecoveryReason = "invalid" | "unsupported";

export interface TickRange {
  startTick: number;
  endTick: number;
}

export interface PlaybackState {
  status: PlaybackStatus;
  currentTick: number;
  updateTiming: UpdateTiming;
}

export interface HistoryEntry {
  id: string;
  name: string;
  action: string;
  timestamp: string;
  seed: string;
  range: BarRange | null;
  composition: GeneratedComposition;
}

export type GeneratorSettingsPatch = Omit<
  Partial<GeneratorSettings>,
  "melody" | "harmony"
> & {
  melody?: Partial<GeneratorSettings["melody"]>;
  harmony?: Partial<NonNullable<GeneratorSettings["harmony"]>>;
};

export type ChordEdit = string | Partial<Omit<ChordEvent, "id">>;

export interface NoteMove {
  /** Absolute MIDI pitch. */
  midi?: number;
  /** Relative pitch movement. Ignored when midi is supplied. */
  semitones?: number;
  /** Absolute start position in ticks. */
  startTick?: number;
  /** Relative time movement. Ignored when startTick is supplied. */
  deltaTick?: number;
  durationTick?: number;
}

export interface PreviewGenerationControl {
  signal?: AbortSignal;
  onProgress?: (attempt: number, maximumAttempts: number) => void;
}

export interface ComposerStoreState {
  settings: GeneratorSettings;
  committedComposition: GeneratedComposition;
  draftComposition: GeneratedComposition;
  previewVariations: GeneratedComposition[];
  auditionedVariationIndex: number | null;
  auditionBaseComposition: GeneratedComposition | null;
  auditionBasePendingCommit: boolean;
  auditionBasePlaybackLoopRange: TickRange | null;
  selectedBarRange: BarRange | null;
  loopRange: TickRange;
  /** Loop expressed in the timebase of the composition that is currently audible. */
  playbackLoopRange: TickRange;
  lockedBars: number[];
  playback: PlaybackState;
  history: HistoryEntry[];
  historyIndex: number;
  regenerationIteration: number;
  pendingCommit: boolean;
  /** Prevents an invalid or newer stored project from being overwritten implicitly. */
  projectPersistenceBlocked: boolean;
  projectRecoveryReason: ProjectRecoveryReason | null;
  projectSaveStatus: ProjectSaveStatus;
  lastSavedAt: string | null;
}

export interface ComposerStoreActions {
  /**
   * `guidance` lets the preference model pick among several draws.
   *
   * Passed in rather than held here, because the learned model belongs to the
   * profile and not to the piece: the store's job is to generate, and whose
   * taste decided which draw is the caller's business. Absent means one draw,
   * which is what this always did.
   */
  generateComposition(
    settings?: GeneratorSettingsPatch,
    guidance?: PreferenceGuidance,
  ): void;
  adoptAutoFixPreview(composition: GeneratedComposition): boolean;
  regenerateSelected(options?: RegenerationOptions): boolean;
  generatePreviewVariations(
    options?: RegenerationOptions,
    control?: PreviewGenerationControl,
  ): Promise<number>;
  /**
   * Atomically publishes already validated external previews without changing
   * the draft, committed composition, playback, or history.
   */
  publishPreviewVariations(
    sourceCompositionId: string,
    candidates: readonly GeneratedComposition[],
  ): number;
  auditionPreviewVariation(index: number | null): boolean;
  adoptPreviewVariation(index: number): boolean;
  editChord(chordId: string, edit: ChordEdit): boolean;
  addChord(symbol: string, startTick: number, durationTick?: number): string | null;
  deleteChord(chordId: string): boolean;
  splitChord(chordId: string, splitTick: number): string | null;
  moveChord(chordId: string, startTick: number): boolean;
  resizeChord(chordId: string, durationTick: number): boolean;
  /**
   * Rewrites a stretch of the piece onto a progression.
   *
   * The bars keep their harmonic rhythm and the chords keep their ids: what
   * changes is which degree each one spells. A progression is a sequence of
   * degrees, not a sequence of durations, so imposing its length on the bars
   * would be reading it as something it does not say -- and the selection, the
   * locks and the undo entry all key off the ids.
   *
   * Cycled when the stretch is longer than the progression, which is what a
   * four-chord loop over eight bars already is.
   *
   * Any section the rewrite touches gives up the progression it recorded, and
   * takes the new one only where the rewrite covers all of it and the caller
   * has a catalogued name to give. The section's progressionId is what the
   * explanation panel reads to say "this section is the royal road", and a
   * section rewritten onto other chords that still claims the royal road is a
   * false statement the app makes about itself.
   */
  applyProgression(
    steps: readonly ProgressionStep[],
    range?: BarRange | null,
    progressionId?: string,
  ): boolean;
  transposeNote(noteId: string, semitones: number): boolean;
  moveNote(noteId: string, move: NoteMove): boolean;
  moveNotes(noteIds: string[], move: NoteMove): number;
  addNote(midi: number, startTick: number, durationTick?: number): string | null;
  deleteNote(noteId: string): boolean;
  deleteNotes(noteIds: string[]): number;
  duplicateNotes(noteIds: string[], deltaTick?: number): string[];
  quantizeNotes(noteIds: string[], gridTick?: number): number;
  toggleBarLock(barIndex: number): void;
  toggleVoiceMute(voiceId: string): boolean;
  setSelectedRange(range: BarRange | null): void;
  setLoopRange(range: TickRange | BarRange | null): void;
  /** Widens playback back to the whole piece without dropping the selection. */
  playWholePiece(): void;
  undo(): boolean;
  redo(): boolean;
  renameHistoryEntry(historyId: string, name: string): boolean;
  restoreHistoryEntry(historyId: string): boolean;
  setPlaybackStatus(status: PlaybackStatus): void;
  setCurrentTick(tick: number): void;
  setUpdateTiming(updateTiming: UpdateTiming): void;
  commitDraft(): void;
  updateSettings(settings: GeneratorSettingsPatch): void;
  setSeed(seed: string | number): void;
  exportJson(): string;
  importJson(json: string): void;
  importMelody(composition: GeneratedComposition): void;
  exportMidi(): Uint8Array;
  reset(settings?: GeneratorSettingsPatch): void;
}

export type ComposerStore = ComposerStoreState & ComposerStoreActions;

const storage = getSafeStorage();

/**
 * The history sidecar lives here rather than in Web Storage.
 *
 * History is unbounded and every entry holds a whole composition: a 48-bar
 * arranged piece serializes to roughly 180KB, so a 5MB quota is reached in
 * under thirty edits. That is a certainty over a long session, not a risk.
 * The current project stays in Web Storage because hydration below is
 * synchronous and the first paint depends on it.
 */
const historyDatabase = new EditorDatabase();
let historySerial = 0;
let noteSerial = 0;
let chordSerial = 0;

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function settingsWithPatch(
  current: GeneratorSettings,
  patch: GeneratorSettingsPatch = {},
): GeneratorSettings {
  const harmony = patch.harmony
    ? {
        complexity: patch.harmony.complexity ?? current.harmony?.complexity ?? "triads",
        borrowedChordRate:
          patch.harmony.borrowedChordRate ?? current.harmony?.borrowedChordRate,
        secondaryDominantRate:
          patch.harmony.secondaryDominantRate ?? current.harmony?.secondaryDominantRate,
        explorationRate:
          patch.harmony.explorationRate ?? current.harmony?.explorationRate,
        voiceLeadingStrength:
          patch.harmony.voiceLeadingStrength ?? current.harmony?.voiceLeadingStrength,
      }
    : current.harmony;
  return {
    ...current,
    ...patch,
    harmony,
    melody: {
      ...current.melody,
      ...patch.melody,
    },
  };
}

function noteName(midi: number): string {
  const pitches = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${pitches[midi % 12] ?? "C"}${Math.floor(midi / 12) - 1}`;
}

function movedNote(
  composition: GeneratedComposition,
  current: NoteEvent,
  move: NoteMove,
): NoteEvent {
  const midi = clampInteger(
    move.midi ?? current.midi + (move.semitones ?? 0),
    composition.settings.melody.minMidi,
    composition.settings.melody.maxMidi,
  );
  const startTick = clampInteger(
    move.startTick ?? current.startTick + (move.deltaTick ?? 0),
    0,
    Math.max(0, composition.totalTicks - 1),
  );
  const barIndex = Math.floor(startTick / composition.ticksPerBar);
  const durationTick = clampInteger(
    move.durationTick ?? current.durationTick,
    1,
    Math.max(1, (barIndex + 1) * composition.ticksPerBar - startTick),
  );
  return {
    ...current,
    midi,
    noteName: noteName(midi),
    startTick,
    durationTick,
    barIndex,
  };
}

function sortNotes(notes: NoteEvent[]): NoteEvent[] {
  return notes.sort(
    (left, right) => left.startTick - right.startTick || left.midi - right.midi || left.id.localeCompare(right.id),
  );
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function nextChordId(existing: ReadonlyArray<ChordEvent>): string {
  const ids = new Set(existing.map((chord) => chord.id));
  let id: string;
  do {
    chordSerial += 1;
    id = `chord-user-${chordSerial}`;
  } while (ids.has(id));
  return id;
}

function sectionForTick(
  composition: GeneratedComposition,
  tick: number,
): SectionEvent | undefined {
  const bar = Math.floor(tick / composition.ticksPerBar);
  return composition.sections?.find(
    (section) => bar >= section.startBar && bar < section.endBar,
  );
}

function crossesLockedBar(
  composition: GeneratedComposition,
  startTick: number,
  endTick: number,
  lockedBars: ReadonlyArray<number> = composition.lockedBars,
): boolean {
  return lockedBars.some((bar) => {
    const barStart = bar * composition.ticksPerBar;
    const barEnd = barStart + composition.ticksPerBar;
    return startTick < barEnd && endTick > barStart;
  });
}

function clearProgressionsForRanges(
  composition: GeneratedComposition,
  ranges: ReadonlyArray<TickRange>,
): void {
  if (!composition.sections || ranges.length === 0) return;
  composition.sections = composition.sections.map((section) => {
    const sectionStart = section.startBar * composition.ticksPerBar;
    const sectionEnd = section.endBar * composition.ticksPerBar;
    const touched = ranges.some(
      (range) => range.startTick < sectionEnd && range.endTick > sectionStart,
    );
    if (!touched || section.progressionId === undefined) return section;
    const next = { ...section };
    delete next.progressionId;
    return next;
  });
}

function rebuiltChordForSymbol(
  chord: ChordEvent,
  symbol: string,
  composition: GeneratedComposition,
  id: string,
  startTick: number,
  durationTick: number,
): ChordEvent {
  const section = sectionForTick(composition, startTick);
  const rebuilt = cleanReplacedChord(replaceChordSymbol(
    chord,
    symbol,
    section?.key ?? composition.settings.key,
    section?.mode ?? composition.settings.mode,
  ));
  return { ...rebuilt, id, startTick, durationTick };
}

function cleanReplacedChord(chord: ChordEvent): ChordEvent {
  const next = { ...chord };
  // replaceChordSymbol receives the old event as its base. These fields belong
  // to the old spelling and must not survive onto a plain replacement (an old
  // colour tone or slash bass would otherwise make the voicing metadata false).
  delete next.tensions;
  delete next.bass;
  delete next.transformation;
  delete next.targetDegree;
  delete next.borrowedFromMode;
  return next;
}

function clearDependentHarmonyClaim(chord: ChordEvent): ChordEvent {
  const next = { ...chord };
  if (
    next.source === "secondaryDominant"
    || next.specialKind === "secondaryDominant"
    || next.specialKind === "tritoneSubstitution"
  ) {
    next.source = "other";
    delete next.specialKind;
    delete next.targetDegree;
    delete next.explanation;
  }
  return next;
}

function clearContextSpecialClaim(chord: ChordEvent): ChordEvent {
  const next = { ...chord, source: "other" as const };
  delete next.specialKind;
  delete next.targetDegree;
  delete next.borrowedFromMode;
  delete next.explanation;
  return next;
}

function clearTransformationClaim(chord: ChordEvent): ChordEvent {
  const next = { ...chord };
  if (next.transformation) {
    delete next.transformation;
    // The chromatic marker and explanation below described this exact
    // transformation, so retaining them after its source disappeared would
    // leave a false theory claim even though validation only requires the
    // transformation field itself to be absent.
    if (next.specialKind === "chromatic") {
      delete next.specialKind;
      delete next.explanation;
    }
  }
  return next;
}

function sameSectionContext(
  composition: GeneratedComposition,
  leftTick: number,
  rightTick: number,
): boolean {
  const leftSection = sectionForTick(composition, leftTick);
  const rightSection = sectionForTick(composition, rightTick);
  return (
    (leftSection?.key ?? composition.settings.key) === (rightSection?.key ?? composition.settings.key)
    && (leftSection?.mode ?? composition.settings.mode) === (rightSection?.mode ?? composition.settings.mode)
  );
}

function reclassifyChordForSection(
  composition: GeneratedComposition,
  chord: ChordEvent,
): ChordEvent {
  const section = sectionForTick(composition, chord.startTick);
  const key = section?.key ?? composition.settings.key;
  const mode = section?.mode ?? composition.settings.mode;
  let normalized = chord;
  if (chord.source === "diatonic") {
    try {
      const degree = scaleDegreeForPitchClass(chord.root, key, mode);
      if (degree === null) throw new RangeError("Chord root has no scale degree in this section.");
      const triad = getDiatonicChordDefinition(key, mode, degree);
      const seventh = getDiatonicSeventhChordDefinition(key, mode, degree);
      const matches = chord.tensions === undefined
        && chord.bass === undefined
        && (
          (chord.quality === triad.quality && chord.symbol === triad.symbol)
          || (chord.quality === seventh.quality && chord.symbol === seventh.symbol)
        );
      normalized = matches
        ? {
          ...chord,
          degree,
          romanNumeral: romanNumeralForChordQuality(degree, mode, chord.quality),
          function: harmonyFunctionForDegree(degree, mode),
        }
        : clearContextSpecialClaim(chord);
    } catch {
      normalized = clearContextSpecialClaim(chord);
    }
  } else if (
    chord.source !== "other"
    && !explainSpecialChord(chord, key, mode).allowed
  ) {
    normalized = clearContextSpecialClaim(chord);
  }
  return normalized;
}

function normalizeChordSectionContext(
  composition: GeneratedComposition,
  changes: ReadonlyArray<ChordStartContextChange>,
): void {
  const handled = new Set<string>();
  for (const change of changes) {
    if (handled.has(change.chordId)) continue;
    handled.add(change.chordId);
    const index = composition.chords.findIndex((chord) => chord.id === change.chordId);
    if (index < 0) continue;
    const chord = composition.chords[index]!;
    if (sameSectionContext(composition, change.originalStartTick, chord.startTick)) continue;
    const normalized = reclassifyChordForSection(composition, chord);
    if (normalized !== chord) composition.chords[index] = normalized;
  }
}

function normalizeChordRelationshipMetadata(composition: GeneratedComposition): void {
  const chords = [...composition.chords].sort(
    (left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id),
  );
  for (const [index, chord] of chords.entries()) {
    const previous = chords[index - 1];
    const next = chords[index + 1]
      ?? (composition.cadence === "loop" ? chords[0] : undefined);
    let normalized = chord;
    if (
      chord.source === "secondaryDominant"
      || chord.specialKind === "secondaryDominant"
      || chord.specialKind === "tritoneSubstitution"
    ) {
      const section = sectionForTick(composition, chord.startTick);
      const expectedTargetRoot = chord.targetDegree === undefined
        ? undefined
        : getScalePitchClasses(
          section?.key ?? composition.settings.key,
          section?.mode ?? composition.settings.mode,
        )[chord.targetDegree - 1];
      const dependentKind = chord.specialKind === "secondaryDominant"
        || chord.specialKind === "tritoneSubstitution";
      if (
        !dependentKind
        || chord.targetDegree === undefined
        || !appliedDominantResolves(chord, next, expectedTargetRoot)
      ) {
        normalized = clearDependentHarmonyClaim(normalized);
      }
    }
    const transformation = normalized.transformation;
    if (transformation) {
      const transformed = transformTriad(
        { root: transformation.fromRoot, quality: transformation.fromQuality },
        transformation.operation,
      );
      if (
        !previous
        || previous.root !== transformation.fromRoot
        || previous.quality !== transformation.fromQuality
        || normalized.source !== "other"
        || normalized.specialKind !== "chromatic"
        || normalized.root !== transformed.root
        || normalized.quality !== transformed.quality
      ) {
        normalized = clearTransformationClaim(normalized);
      }
    }
    if (normalized !== chord) {
      const compositionIndex = composition.chords.findIndex((candidate) => candidate.id === chord.id);
      if (compositionIndex >= 0) composition.chords[compositionIndex] = normalized;
      chords[index] = normalized;
    }
  }
}

function chordEnd(chord: ChordEvent): number {
  return chord.startTick + chord.durationTick;
}

function intervalsOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

interface RemovedChordHealing {
  target: ChordEvent;
  absorberBefore: ChordEvent;
  absorberAfter: ChordEvent;
}

interface ChordStartContextChange {
  chordId: string;
  originalStartTick: number;
}

function removeChordAndHeal(
  composition: GeneratedComposition,
  chordId: string,
): RemovedChordHealing | null {
  composition.chords.sort(
    (left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id),
  );
  const index = composition.chords.findIndex((chord) => chord.id === chordId);
  if (index < 0 || composition.chords.length <= 1) return null;
  const target = composition.chords[index]!;
  const previous = composition.chords[index - 1];
  const next = composition.chords[index + 1];
  const absorber = previous ?? next;
  if (!absorber) return null;
  const absorberBefore = { ...absorber };
  if (previous) {
    absorber.durationTick += target.durationTick;
  } else {
    absorber.startTick = target.startTick;
    absorber.durationTick += target.durationTick;
  }
  const absorberAfter = { ...absorber };
  composition.chords.splice(index, 1);
  return { target, absorberBefore, absorberAfter };
}

interface RangeReplacement {
  chords: ChordEvent[];
  changedRanges: TickRange[];
  contextChanges: ChordStartContextChange[];
}

function replaceChordRange(
  chords: readonly ChordEvent[],
  replacement: ChordEvent,
  startTick: number,
  endTick: number,
): RangeReplacement {
  const result: ChordEvent[] = [];
  const changedRanges: TickRange[] = [];
  const contextChanges: ChordStartContextChange[] = [];
  for (const chord of chords) {
    const eventEnd = chordEnd(chord);
    if (!intervalsOverlap(chord.startTick, eventEnd, startTick, endTick)) {
      result.push(chord);
      continue;
    }
    changedRanges.push({ startTick: chord.startTick, endTick: eventEnd });
    const hasLeft = chord.startTick < startTick;
    const hasRight = eventEnd > endTick;
    if (hasLeft) {
      result.push({ ...chord, durationTick: startTick - chord.startTick });
    }
    if (hasRight) {
      const rightId = hasLeft ? nextChordId([...chords, replacement]) : chord.id;
      result.push({
        ...chord,
        id: rightId,
        startTick: endTick,
        durationTick: eventEnd - endTick,
      });
      if (chord.startTick !== endTick) {
        contextChanges.push({ chordId: rightId, originalStartTick: chord.startTick });
      }
    }
  }
  result.push(replacement);
  result.sort(
    (left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id),
  );
  changedRanges.push({ startTick, endTick });
  return { chords: result, changedRanges, contextChanges };
}

function normalizedBarRange(
  range: BarRange | null,
  composition: GeneratedComposition,
): BarRange | null {
  if (range === null) {
    return null;
  }
  const startBar = clampInteger(range.startBar, 0, composition.settings.bars - 1);
  const endBar = clampInteger(range.endBar, startBar + 1, composition.settings.bars);
  return { startBar, endBar };
}

function rangeToTicks(range: BarRange, composition: GeneratedComposition): TickRange {
  return {
    startTick: range.startBar * composition.ticksPerBar,
    endTick: range.endBar * composition.ticksPerBar,
  };
}

function normalizedTickRange(
  range: TickRange,
  composition: GeneratedComposition,
): TickRange {
  const startTick = clampInteger(range.startTick, 0, Math.max(0, composition.totalTicks - 1));
  const endTick = clampInteger(range.endTick, startTick + 1, composition.totalTicks);
  return { startTick, endTick };
}

function seedString(composition: GeneratedComposition): string {
  return String(composition.seed ?? composition.settings.seed);
}

function makeHistoryEntry(
  composition: GeneratedComposition,
  action: string,
  range: BarRange | null,
): HistoryEntry {
  historySerial += 1;
  const barLabel = range ? ` · ${range.startBar + 1}–${range.endBar}小節` : "";
  return {
    id: `history-${Date.now()}-${historySerial}`,
    name: `${action}${barLabel}`,
    action,
    timestamp: new Date().toISOString(),
    seed: seedString(composition),
    range: range ? { ...range } : null,
    composition: clone(composition),
  };
}

function freshState(settingsPatch: GeneratorSettingsPatch = {}): ComposerStoreState {
  const settings = settingsWithPatch(clone(DEFAULT_GENERATOR_SETTINGS), settingsPatch);
  const composition = buildComposition(settings);
  const history = [makeHistoryEntry(composition, "generate", null)];
  return {
    settings: clone(composition.settings),
    committedComposition: clone(composition),
    draftComposition: clone(composition),
    previewVariations: [],
    auditionedVariationIndex: null,
    auditionBaseComposition: null,
    auditionBasePendingCommit: false,
    auditionBasePlaybackLoopRange: null,
    selectedBarRange: null,
    loopRange: { startTick: 0, endTick: composition.totalTicks },
    playbackLoopRange: { startTick: 0, endTick: composition.totalTicks },
    lockedBars: [...composition.lockedBars],
    playback: {
      status: "stopped",
      currentTick: 0,
      updateTiming: "nextBar",
    },
    history,
    historyIndex: 0,
    regenerationIteration: 0,
    pendingCommit: false,
    projectPersistenceBlocked: false,
    projectRecoveryReason: null,
    projectSaveStatus: getSafeStorageMode() === "localStorage" ? "saved" : "session",
    lastSavedAt: new Date().toISOString(),
  };
}

function restoredState(snapshot: PersistedEditorSnapshot): ComposerStoreState {
  const composition = clone(snapshot.composition);
  const selectedBarRange = normalizedBarRange(snapshot.selectedBarRange, composition);
  const loopRange = normalizedTickRange(snapshot.loopRange, composition);
  const lockedBars = [...new Set(snapshot.lockedBars)]
    .filter((bar) => bar >= 0 && bar < composition.settings.bars)
    .sort((a, b) => a - b);
  composition.lockedBars = lockedBars;

  return {
    settings: clone(snapshot.settings),
    committedComposition: clone(composition),
    draftComposition: composition,
    previewVariations: [],
    auditionedVariationIndex: null,
    auditionBaseComposition: null,
    auditionBasePendingCommit: false,
    auditionBasePlaybackLoopRange: null,
    selectedBarRange,
    loopRange,
    playbackLoopRange: { ...loopRange },
    lockedBars,
    playback: {
      status: "stopped",
      currentTick: 0,
      updateTiming: snapshot.updateTiming,
    },
    history: snapshot.history.map((entry) => ({
      ...clone(entry),
      name: entry.name?.trim() || entry.action,
    })),
    historyIndex: snapshot.historyIndex,
    regenerationIteration: snapshot.regenerationIteration,
    pendingCommit: false,
    projectPersistenceBlocked: false,
    projectRecoveryReason: null,
    projectSaveStatus: getSafeStorageMode() === "localStorage" ? "saved" : "session",
    lastSavedAt: new Date().toISOString(),
  };
}

function crossesGrid(previous: number, current: number, gridSize: number): boolean {
  if (current < previous) {
    return true;
  }
  return Math.floor(previous / gridSize) !== Math.floor(current / gridSize);
}

function shouldApplyPending(
  state: ComposerStoreState,
  previousTick: number,
  currentTick: number,
): boolean {
  if (!state.pendingCommit) {
    return false;
  }

  switch (state.playback.updateTiming) {
    case "immediate":
      return true;
    case "nextBeat":
      return crossesGrid(
        previousTick,
        currentTick,
        ticksPerBeat(
          state.committedComposition.timeSignature,
          state.committedComposition.ppq,
        ),
      );
    case "nextBar":
      return crossesGrid(
        previousTick,
        currentTick,
        state.committedComposition.ticksPerBar,
      );
    case "nextLoop":
      return (
        currentTick < previousTick ||
        (previousTick < state.playbackLoopRange.endTick
          && currentTick >= state.playbackLoopRange.endTick)
      );
  }
}

function persistentCurrentSnapshot(
  state: ComposerStoreState,
  historyRevision?: number,
): PersistedEditorSnapshot {
  const composition = clone(state.draftComposition);
  const activeHistory = state.history[state.historyIndex]
    ?? makeHistoryEntry(composition, "recovered", null);
  return {
    version: 1,
    historyRevision,
    settings: clone(state.settings),
    composition,
    selectedBarRange: state.selectedBarRange ? { ...state.selectedBarRange } : null,
    loopRange: { ...state.loopRange },
    lockedBars: [...state.lockedBars],
    updateTiming: state.playback.updateTiming,
    history: [{
      ...activeHistory,
      range: activeHistory.range ? { ...activeHistory.range } : null,
      composition,
    }],
    historyIndex: 0,
    regenerationIteration: state.regenerationIteration,
  };
}

function persistentHistoryState(
  state: ComposerStoreState,
  historyRevision?: number,
): PersistedHistoryState {
  return {
    history: clone(state.history),
    historyIndex: state.historyIndex,
    historyRevision,
  };
}

function stateAfterComposition(
  state: ComposerStoreState,
  composition: GeneratedComposition,
  action: string,
  range: BarRange | null,
  syncSettings = false,
): Partial<ComposerStoreState> {
  const next = clone(composition);
  const entry = makeHistoryEntry(next, action, range);
  // Never discard old user history silently. Storage failures are surfaced via
  // projectSaveStatus so the user can export before deciding what to remove.
  const history = [...state.history.slice(0, state.historyIndex + 1), entry];
  const applyImmediately =
    state.playback.status !== "playing" || state.playback.updateTiming === "immediate";
  const committedBeforeAudition = state.auditionBaseComposition ?? state.committedComposition;
  const playbackLoopBeforeAudition =
    state.auditionBasePlaybackLoopRange ?? state.playbackLoopRange;

  return {
    settings: syncSettings ? clone(next.settings) : state.settings,
    draftComposition: next,
    committedComposition: applyImmediately ? clone(next) : committedBeforeAudition,
    previewVariations: [],
    auditionedVariationIndex: null,
    auditionBaseComposition: null,
    auditionBasePendingCommit: false,
    auditionBasePlaybackLoopRange: null,
    lockedBars: [...next.lockedBars],
    history,
    historyIndex: history.length - 1,
    pendingCommit: !applyImmediately,
    playbackLoopRange: applyImmediately
      ? normalizedTickRange(state.loopRange, next)
      : playbackLoopBeforeAudition,
    projectSaveStatus: "unsaved",
  };
}

const hydration = loadEditorSnapshotWithStatus(storage);
const initialState = hydration.snapshot ? restoredState(hydration.snapshot) : freshState();
if (
  hydration.issue === "current-invalid"
  || hydration.issue === "current-unsupported"
) {
  initialState.projectPersistenceBlocked = true;
  initialState.projectRecoveryReason = hydration.issue === "current-unsupported"
    ? "unsupported"
    : "invalid";
  initialState.projectSaveStatus = "recovery";
} else if (hydration.issue !== "none") {
  initialState.projectSaveStatus = "partial";
}

export const useComposerStore = create<ComposerStore>()((set, get) => ({
  ...initialState,

  generateComposition: (patch = {}, guidance) => {
    const state = get();
    const settings = settingsWithPatch(state.settings, patch);
    // The piece carries the seed of the draw that won, so it stays reproducible
    // from the seed alone with no model in the picture.
    const composition = guidance
      ? generatePreferred(settings, guidance, buildComposition).composition
      : buildComposition(settings);
    const update = stateAfterComposition(state, composition, "generate", null, true);
    const loopRange = { startTick: 0, endTick: composition.totalTicks };
    set({
      ...update,
      selectedBarRange: null,
      loopRange,
      playbackLoopRange: update.pendingCommit ? state.playbackLoopRange : loopRange,
      regenerationIteration: 0,
    });
  },

  adoptAutoFixPreview: (composition) => {
    const validation = validateComposition(composition);
    if (!validation.valid) return false;
    const state = get();
    const next = clone(composition);
    const update = stateAfterComposition(state, next, "auto-fix", null, true);
    const loopRange = { startTick: 0, endTick: next.totalTicks };
    set({
      ...update,
      selectedBarRange: null,
      loopRange,
      playbackLoopRange: update.pendingCommit ? state.playbackLoopRange : loopRange,
      regenerationIteration: 0,
    });
    return true;
  },

  regenerateSelected: (options = {}) => {
    const state = get();
    const range = normalizedBarRange(state.selectedBarRange, state.draftComposition);
    if (range === null) {
      return false;
    }

    const source = clone(state.draftComposition);
    source.lockedBars = [...state.lockedBars];
    const iteration = state.regenerationIteration + 1;
    const composition = regenerateRange(source, source.settings, range, {
      ...options,
      seedOffset: options.seedOffset ?? iteration,
      respectLocks: options.respectLocks ?? true,
    });
    set({
      ...stateAfterComposition(
        state,
        composition,
        `regenerate:${options.target ?? "all"}`,
        range,
      ),
      regenerationIteration: iteration,
    });
    return true;
  },

  generatePreviewVariations: async (options = {}, control = {}) => {
    let state = get();
    if (state.auditionBaseComposition) {
      set({
        auditionedVariationIndex: null,
        committedComposition: clone(state.auditionBaseComposition),
        pendingCommit: state.auditionBasePendingCommit,
        playbackLoopRange: state.auditionBasePlaybackLoopRange
          ?? state.playbackLoopRange,
        auditionBaseComposition: null,
        auditionBasePendingCommit: false,
        auditionBasePlaybackLoopRange: null,
      });
      state = get();
    }
    const range = normalizedBarRange(state.selectedBarRange, state.draftComposition);
    if (range === null) return 0;

    const source = clone(state.draftComposition);
    source.lockedBars = [...state.lockedBars];
    const previews: GeneratedComposition[] = [];
    const firstOffset = state.regenerationIteration + 1;
    // Invalid candidates are discarded before they can be auditioned or adopted.
    for (let attempt = 0; attempt < 9 && previews.length < 3; attempt += 1) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
      if (control.signal?.aborted) {
        throw new DOMException("Candidate generation was cancelled.", "AbortError");
      }
      const seedOffset = options.seedOffset ?? firstOffset + attempt;
      const candidate = regenerateRange(source, source.settings, range, {
        ...options,
        seedOffset,
        respectLocks: options.respectLocks ?? true,
      });
      if (validateComposition(candidate).valid) previews.push(candidate);
      control.onProgress?.(attempt + 1, 9);
      if (options.seedOffset !== undefined) break;
    }
    const latest = get();
    // A different composition supersedes this job. Manual edits keep the same
    // composition id and are preserved outside the explicitly regenerated bars.
    if (latest.draftComposition.id !== source.id) return 0;
    const locked = new Set(latest.lockedBars);
    const useCandidateBar = (barIndex: number) =>
      barIndex >= range.startBar && barIndex < range.endBar && !locked.has(barIndex);
    const rebasedPreviews = previews.map((candidate) => ({
      ...candidate,
      lockedBars: [...latest.lockedBars],
      chords: [
        ...latest.draftComposition.chords.filter(
          (chord) => !useCandidateBar(Math.floor(chord.startTick / candidate.ticksPerBar)),
        ),
        ...candidate.chords.filter(
          (chord) => useCandidateBar(Math.floor(chord.startTick / candidate.ticksPerBar)),
        ),
      ].sort((left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id)),
      notes: [
        ...latest.draftComposition.notes.filter((note) => !useCandidateBar(note.barIndex)),
        ...candidate.notes.filter((note) => useCandidateBar(note.barIndex)),
      ].sort((left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id)),
    })).filter((candidate) => validateComposition(candidate).valid);
    set({
      previewVariations: rebasedPreviews,
      auditionedVariationIndex: null,
      auditionBaseComposition: null,
      auditionBasePendingCommit: false,
      auditionBasePlaybackLoopRange: null,
      regenerationIteration: latest.regenerationIteration + Math.max(1, rebasedPreviews.length),
    });
    return rebasedPreviews.length;
  },

  publishPreviewVariations: (sourceCompositionId, candidates) => {
    const state = get();
    if (state.draftComposition.id !== sourceCompositionId) return 0;
    const source = state.draftComposition;
    const sameNonHarmonyData = (candidate: GeneratedComposition) =>
      candidate.ppq === source.ppq
      && candidate.ticksPerBar === source.ticksPerBar
      && candidate.totalTicks === source.totalTicks
      && candidate.timeSignature === source.timeSignature
      && JSON.stringify(candidate.settings) === JSON.stringify(source.settings)
      && JSON.stringify(candidate.bars) === JSON.stringify(source.bars)
      && JSON.stringify(candidate.notes) === JSON.stringify(source.notes)
      && JSON.stringify(candidate.voices ?? []) === JSON.stringify(source.voices ?? [])
      && JSON.stringify(candidate.sections ?? []) === JSON.stringify(source.sections ?? [])
      && JSON.stringify(candidate.lockedBars) === JSON.stringify(source.lockedBars);
    const previews = candidates
      .slice(0, 3)
      .filter((candidate) =>
        candidate.id !== source.id
        && sameNonHarmonyData(candidate)
        && validateComposition(candidate).valid
        && analyzeArrangementQuality(candidate).errors === 0
      )
      .map(clone);
    if (previews.length === 0) return 0;
    const auditionBase = state.auditionBaseComposition;
    set({
      previewVariations: previews,
      auditionedVariationIndex: null,
      committedComposition: auditionBase
        ? clone(auditionBase)
        : state.committedComposition,
      pendingCommit: auditionBase
        ? state.auditionBasePendingCommit
        : state.pendingCommit,
      playbackLoopRange: auditionBase
        ? state.auditionBasePlaybackLoopRange ?? state.playbackLoopRange
        : state.playbackLoopRange,
      auditionBaseComposition: null,
      auditionBasePendingCommit: false,
      auditionBasePlaybackLoopRange: null,
      regenerationIteration: state.regenerationIteration + previews.length,
    });
    return previews.length;
  },

  auditionPreviewVariation: (index) => {
    const state = get();
    if (index === null) {
      set({
        auditionedVariationIndex: null,
        committedComposition: state.auditionBaseComposition
          ? clone(state.auditionBaseComposition)
          : state.committedComposition,
        pendingCommit: state.auditionBaseComposition
          ? state.auditionBasePendingCommit
          : state.pendingCommit,
        playbackLoopRange: state.auditionBasePlaybackLoopRange
          ?? state.playbackLoopRange,
        auditionBaseComposition: null,
        auditionBasePendingCommit: false,
        auditionBasePlaybackLoopRange: null,
      });
      return true;
    }
    const candidate = state.previewVariations[index];
    if (!candidate || !validateComposition(candidate).valid) return false;
    const alreadyAuditioning = state.auditionBaseComposition !== null;
    set({
      auditionedVariationIndex: index,
      committedComposition: clone(candidate),
      playbackLoopRange: normalizedTickRange(state.loopRange, candidate),
      pendingCommit: alreadyAuditioning
        ? state.auditionBasePendingCommit
        : state.pendingCommit,
      auditionBaseComposition: alreadyAuditioning
        ? state.auditionBaseComposition
        : clone(state.committedComposition),
      auditionBasePendingCommit: alreadyAuditioning
        ? state.auditionBasePendingCommit
        : state.pendingCommit,
      auditionBasePlaybackLoopRange: alreadyAuditioning
        ? state.auditionBasePlaybackLoopRange
        : { ...state.playbackLoopRange },
    });
    return true;
  },

  adoptPreviewVariation: (index) => {
    const state = get();
    const candidate = state.previewVariations[index];
    const range = normalizedBarRange(state.selectedBarRange, state.draftComposition);
    if (!candidate || !validateComposition(candidate).valid) return false;
    const label = String.fromCharCode(65 + index);
    set(stateAfterComposition(state, candidate, `adopt-variation-${label}`, range));
    return true;
  },

  addChord: (symbol, startTick, durationTick) => {
    const state = get();
    const source = state.draftComposition;
    if (
      typeof symbol !== "string"
      || symbol.trim().length === 0
      || !Number.isInteger(startTick)
      || startTick < 0
      || startTick >= source.totalTicks
      || (durationTick !== undefined
        && (!Number.isInteger(durationTick) || durationTick <= 0))
    ) {
      return null;
    }

    const targetIndex = source.chords.findIndex(
      (chord) => startTick >= chord.startTick
        && startTick < chord.startTick + chord.durationTick,
    );
    const target = targetIndex < 0 ? undefined : source.chords[targetIndex];
    if (!target) return null;
    const targetEnd = target.startTick + target.durationTick;
    if (crossesLockedBar(source, target.startTick, targetEnd, state.lockedBars)) {
      return null;
    }

    const requestedDuration = durationTick
      ?? ticksPerBeat(source.timeSignature, source.ppq);
    const boundedDuration = Math.min(requestedDuration, targetEnd - startTick);
    if (!Number.isInteger(boundedDuration) || boundedDuration <= 0) return null;

    const composition = clone(source);
    const newId = nextChordId(composition.chords);
    let newChord: ChordEvent;
    try {
      newChord = rebuiltChordForSymbol(
        target,
        symbol,
        composition,
        newId,
        startTick,
        boundedDuration,
      );
    } catch {
      return null;
    }

    const left = startTick > target.startTick
      ? { ...target, durationTick: startTick - target.startTick }
      : undefined;
    const rightStart = startTick + boundedDuration;
    const right = rightStart < targetEnd
      ? {
        ...target,
        id: left ? nextChordId([...composition.chords, newChord]) : target.id,
        startTick: rightStart,
        durationTick: targetEnd - rightStart,
      }
      : undefined;
    const hasDependentClaim = target.source === "secondaryDominant"
      || target.specialKind === "secondaryDominant"
      || target.specialKind === "tritoneSubstitution";
    const leftPiece = hasDependentClaim && left
      ? clearDependentHarmonyClaim(left)
      : left;
    let rightPiece = right;
    if (rightPiece && target.transformation) {
      rightPiece = clearTransformationClaim(rightPiece);
    }
    if (rightPiece && hasDependentClaim && !left) {
      rightPiece = clearDependentHarmonyClaim(rightPiece);
    }
    const replacement = [
      ...(leftPiece ? [leftPiece] : []),
      newChord,
      ...(rightPiece ? [rightPiece] : []),
    ];
    composition.chords.splice(targetIndex, 1, ...replacement);
    composition.chords.sort(
      (a, b) => a.startTick - b.startTick || a.id.localeCompare(b.id),
    );
    clearProgressionsForRanges(composition, [
      { startTick: target.startTick, endTick: targetEnd },
      { startTick, endTick: rightStart },
    ]);
    normalizeChordRelationshipMetadata(composition);
    set(stateAfterComposition(state, composition, "add-chord", {
      startBar: Math.floor(startTick / composition.ticksPerBar),
      endBar: Math.ceil(rightStart / composition.ticksPerBar),
    }));
    return newId;
  },

  deleteChord: (chordId) => {
    const state = get();
    const source = state.draftComposition;
    const targetIndex = source.chords.findIndex((chord) => chord.id === chordId);
    if (targetIndex < 0 || source.chords.length <= 1) return false;
    const target = source.chords[targetIndex]!;
    const targetEnd = target.startTick + target.durationTick;
    if (crossesLockedBar(source, target.startTick, targetEnd, state.lockedBars)) {
      return false;
    }

    const previous = source.chords[targetIndex - 1];
    const next = source.chords[targetIndex + 1];
    const absorbing = previous ?? next;
    if (!absorbing) return false;
    const absorbingEnd = absorbing.startTick + absorbing.durationTick;
    const changedAbsorbingStart = previous ? absorbing.startTick : target.startTick;
    const changedAbsorbingEnd = previous ? targetEnd : absorbingEnd;
    if (
      crossesLockedBar(source, absorbing.startTick, absorbingEnd, state.lockedBars)
      || crossesLockedBar(
        source,
        changedAbsorbingStart,
        changedAbsorbingEnd,
        state.lockedBars,
      )
    ) {
      return false;
    }

    const composition = clone(source);
    const clonedTargetIndex = composition.chords.findIndex((chord) => chord.id === chordId);
    const clonedAbsorbing = composition.chords[
      previous ? clonedTargetIndex - 1 : clonedTargetIndex + 1
    ];
    if (!clonedAbsorbing) return false;
    if (previous) {
      clonedAbsorbing.durationTick += target.durationTick;
    } else {
      clonedAbsorbing.startTick = target.startTick;
      clonedAbsorbing.durationTick += target.durationTick;
    }
    composition.chords.splice(clonedTargetIndex, 1);
    if (previous) {
      const previousIndex = composition.chords.findIndex((chord) => chord.id === previous.id);
      if (previousIndex >= 0 && (
        previous.source === "secondaryDominant"
        || previous.specialKind === "secondaryDominant"
        || previous.specialKind === "tritoneSubstitution"
      )) {
        composition.chords[previousIndex] = clearDependentHarmonyClaim(
          composition.chords[previousIndex]!,
        );
      }
    }
    if (next?.transformation) {
      const nextIndex = composition.chords.findIndex((chord) => chord.id === next.id);
      if (nextIndex >= 0) {
        composition.chords[nextIndex] = clearTransformationClaim(
          composition.chords[nextIndex]!,
        );
      }
    }
    clearProgressionsForRanges(composition, [
      { startTick: target.startTick, endTick: targetEnd },
      { startTick: absorbing.startTick, endTick: absorbingEnd },
      { startTick: changedAbsorbingStart, endTick: changedAbsorbingEnd },
    ]);
    normalizeChordRelationshipMetadata(composition);
    set(stateAfterComposition(state, composition, "delete-chord", {
      startBar: Math.floor(target.startTick / composition.ticksPerBar),
      endBar: Math.ceil(targetEnd / composition.ticksPerBar),
    }));
    return true;
  },

  splitChord: (chordId, splitTick) => {
    const state = get();
    const source = state.draftComposition;
    const targetIndex = source.chords.findIndex((chord) => chord.id === chordId);
    const target = targetIndex < 0 ? undefined : source.chords[targetIndex];
    if (
      !target
      || !Number.isInteger(splitTick)
      || splitTick <= target.startTick
      || splitTick >= target.startTick + target.durationTick
      || splitTick <= 0
      || splitTick >= source.totalTicks
      || crossesLockedBar(
        source,
        target.startTick,
        target.startTick + target.durationTick,
        state.lockedBars,
      )
    ) {
      return null;
    }

    const composition = clone(source);
    const rightId = nextChordId(composition.chords);
    const left = {
      ...target,
      durationTick: splitTick - target.startTick,
    };
    const right = {
      ...target,
      id: rightId,
      startTick: splitTick,
      durationTick: target.startTick + target.durationTick - splitTick,
    };
    const hasDependentClaim = target.source === "secondaryDominant"
      || target.specialKind === "secondaryDominant"
      || target.specialKind === "tritoneSubstitution";
    composition.chords[targetIndex] = hasDependentClaim
      ? clearDependentHarmonyClaim(left)
      : left;
    const continuation = target.transformation
      ? clearTransformationClaim(right)
      : right;
    composition.chords.splice(targetIndex + 1, 0, continuation);
    clearProgressionsForRanges(composition, [{
      startTick: target.startTick,
      endTick: target.startTick + target.durationTick,
    }]);
    normalizeChordRelationshipMetadata(composition);
    set(stateAfterComposition(state, composition, "split-chord", {
      startBar: Math.floor(target.startTick / composition.ticksPerBar),
      endBar: Math.ceil((target.startTick + target.durationTick) / composition.ticksPerBar),
    }));
    return rightId;
  },

  moveChord: (chordId, startTick) => {
    const state = get();
    const source = state.draftComposition;
    const target = source.chords.find((chord) => chord.id === chordId);
    if (
      !target
      || source.chords.length <= 1
      || !Number.isInteger(startTick)
      || startTick < 0
      || startTick === target.startTick
      || startTick + target.durationTick > source.totalTicks
    ) {
      return false;
    }

    const composition = clone(source);
    const healing = removeChordAndHeal(composition, chordId);
    if (!healing) return false;
    const targetEnd = startTick + healing.target.durationTick;
    const destinationEvents = composition.chords.filter((chord) =>
      intervalsOverlap(chord.startTick, chordEnd(chord), startTick, targetEnd),
    );
    const lockRanges = [
      { startTick: target.startTick, endTick: chordEnd(target) },
      { startTick: healing.absorberBefore.startTick, endTick: chordEnd(healing.absorberBefore) },
      { startTick: healing.absorberAfter.startTick, endTick: chordEnd(healing.absorberAfter) },
      { startTick, endTick: targetEnd },
      ...destinationEvents.map((chord) => ({
        startTick: chord.startTick,
        endTick: chordEnd(chord),
      })),
    ];
    if (lockRanges.some((range) => crossesLockedBar(source, range.startTick, range.endTick, state.lockedBars))) {
      return false;
    }

    const moved = {
      ...healing.target,
      startTick,
      durationTick: healing.target.durationTick,
    };
    const replacement = replaceChordRange(composition.chords, moved, startTick, targetEnd);
    composition.chords = replacement.chords;
    const contextChanges: ChordStartContextChange[] = [
      ...replacement.contextChanges,
      { chordId: healing.target.id, originalStartTick: healing.target.startTick },
    ];
    if (healing.absorberBefore.startTick !== healing.absorberAfter.startTick) {
      contextChanges.push({
        chordId: healing.absorberAfter.id,
        originalStartTick: healing.absorberBefore.startTick,
      });
    }
    clearProgressionsForRanges(composition, [
      ...lockRanges,
      ...replacement.changedRanges,
    ]);
    normalizeChordSectionContext(composition, contextChanges);
    normalizeChordRelationshipMetadata(composition);
    const affectedStarts = [target.startTick, startTick];
    const affectedEnds = [chordEnd(target), targetEnd];
    set(stateAfterComposition(state, composition, "move-chord", {
      startBar: Math.min(...affectedStarts.map((tick) => Math.floor(tick / composition.ticksPerBar))),
      endBar: Math.max(...affectedEnds.map((tick) => Math.ceil(tick / composition.ticksPerBar))),
    }));
    return true;
  },

  resizeChord: (chordId, durationTick) => {
    const state = get();
    const source = state.draftComposition;
    const index = source.chords.findIndex((chord) => chord.id === chordId);
    const target = index < 0 ? undefined : source.chords[index];
    if (
      !target
      || !Number.isInteger(durationTick)
      || durationTick <= 0
      || durationTick === target.durationTick
      || target.startTick + durationTick > source.totalTicks
      || crossesLockedBar(source, target.startTick, chordEnd(target), state.lockedBars)
      || crossesLockedBar(source, target.startTick, target.startTick + durationTick, state.lockedBars)
    ) {
      return false;
    }

    const composition = clone(source);
    const clonedTarget = composition.chords[index]!;
    const oldEnd = chordEnd(target);
    const newEnd = target.startTick + durationTick;
    const changedRanges: TickRange[] = [
      { startTick: target.startTick, endTick: oldEnd },
      { startTick: target.startTick, endTick: newEnd },
    ];
    const contextChanges: ChordStartContextChange[] = [];

    if (durationTick < target.durationTick) {
      const next = source.chords[index + 1];
      if (!next) return false;
      const expandedNext = {
        ...next,
        startTick: newEnd,
        durationTick: next.durationTick + (target.durationTick - durationTick),
      };
      if (
        crossesLockedBar(source, next.startTick, chordEnd(next), state.lockedBars)
        || crossesLockedBar(source, expandedNext.startTick, chordEnd(expandedNext), state.lockedBars)
      ) {
        return false;
      }
      clonedTarget.durationTick = durationTick;
      const clonedNext = composition.chords[index + 1]!;
      clonedNext.startTick = expandedNext.startTick;
      clonedNext.durationTick = expandedNext.durationTick;
      if (next.startTick !== expandedNext.startTick) {
        contextChanges.push({ chordId: next.id, originalStartTick: next.startTick });
      }
      changedRanges.push(
        { startTick: next.startTick, endTick: chordEnd(next) },
        { startTick: expandedNext.startTick, endTick: chordEnd(expandedNext) },
      );
    } else {
      const consumed = source.chords.slice(index + 1).filter(
        (chord) => chord.startTick < newEnd,
      );
      for (const chord of consumed) {
        const originalEnd = chordEnd(chord);
        if (
          crossesLockedBar(source, chord.startTick, originalEnd, state.lockedBars)
        ) {
          return false;
        }
        changedRanges.push({ startTick: chord.startTick, endTick: originalEnd });
        if (originalEnd > newEnd) {
          const remainder = {
            ...chord,
            startTick: newEnd,
            durationTick: originalEnd - newEnd,
          };
          if (crossesLockedBar(source, remainder.startTick, chordEnd(remainder), state.lockedBars)) {
            return false;
          }
          changedRanges.push({ startTick: remainder.startTick, endTick: chordEnd(remainder) });
          if (chord.startTick !== remainder.startTick) {
            contextChanges.push({ chordId: remainder.id, originalStartTick: chord.startTick });
          }
        }
      }
      clonedTarget.durationTick = durationTick;
      composition.chords = composition.chords.filter((chord, chordIndex) => {
        if (chordIndex <= index || chord.startTick >= newEnd) return true;
        return chordEnd(chord) > newEnd;
      }).map((chord) => chord.startTick < newEnd && chordEnd(chord) > newEnd
        ? { ...chord, startTick: newEnd, durationTick: chordEnd(chord) - newEnd }
        : chord);
      const firstConsumed = consumed[0];
      const firstFullyConsumed = firstConsumed !== undefined && chordEnd(firstConsumed) <= newEnd;
      if (
        firstFullyConsumed
        && (target.source === "secondaryDominant"
          || target.specialKind === "secondaryDominant"
          || target.specialKind === "tritoneSubstitution")
      ) {
        const resized = composition.chords.find((chord) => chord.id === target.id);
        if (resized) {
          const normalized = clearDependentHarmonyClaim(resized);
          const resizedIndex = composition.chords.findIndex((chord) => chord.id === target.id);
          composition.chords[resizedIndex] = normalized;
        }
      }
    }

    composition.chords.sort(
      (left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id),
    );
    clearProgressionsForRanges(composition, changedRanges);
    normalizeChordSectionContext(composition, contextChanges);
    normalizeChordRelationshipMetadata(composition);
    set(stateAfterComposition(state, composition, "resize-chord", {
      startBar: Math.floor(target.startTick / composition.ticksPerBar),
      endBar: Math.ceil(Math.max(oldEnd, newEnd) / composition.ticksPerBar),
    }));
    return true;
  },

  editChord: (chordId, edit) => {
    const state = get();
    const index = state.draftComposition.chords.findIndex((chord) => chord.id === chordId);
    if (index < 0) {
      return false;
    }

    const currentSource = state.draftComposition.chords[index]!;
    if (
      crossesLockedBar(
        state.draftComposition,
        currentSource.startTick,
        currentSource.startTick + currentSource.durationTick,
        state.lockedBars,
      )
    ) {
      return false;
    }

    const composition = clone(state.draftComposition);
    const current = composition.chords[index]!;
    const section = sectionForTick(composition, current.startTick);
    const key = section?.key ?? composition.settings.key;
    const mode = section?.mode ?? composition.settings.mode;
    if (typeof edit === "string") {
      composition.chords[index] = cleanReplacedChord(replaceChordSymbol(
        current, edit, key, mode,
      ));
    } else if (
      (edit.symbol !== undefined && edit.symbol !== current.symbol) ||
      (edit.inversion !== undefined && edit.inversion !== current.inversion)
    ) {
      const {
        symbol = current.symbol,
        inversion = current.inversion,
        ...changes
      } = edit;
      composition.chords[index] = {
        ...cleanReplacedChord(replaceChordSymbol(
          current,
          symbol,
          key,
          mode,
          inversion,
        )),
        ...changes,
        id: current.id,
      };
    } else {
      composition.chords[index] = { ...current, ...edit, id: current.id };
    }
    clearProgressionsForRanges(composition, [{
      startTick: current.startTick,
      endTick: current.startTick + current.durationTick,
    }]);
    set(stateAfterComposition(state, composition, "edit-chord", {
      startBar: Math.floor(current.startTick / composition.ticksPerBar),
      endBar: Math.floor(current.startTick / composition.ticksPerBar) + 1,
    }));
    return true;
  },

  applyProgression: (steps, range, progressionId) => {
    const state = get();
    if (steps.length === 0) return false;

    const source = state.draftComposition;
    const bars = normalizedBarRange(
      range ?? state.selectedBarRange,
      source,
    ) ?? { startBar: 0, endBar: Math.ceil(source.totalTicks / source.ticksPerBar) };

    const composition = clone(source);
    const startTick = bars.startBar * composition.ticksPerBar;
    const endTick = bars.endBar * composition.ticksPerBar;
    const targets = composition.chords
      .map((chord, index) => ({ chord, index }))
      .filter(({ chord }) => chord.startTick >= startTick && chord.startTick < endTick);
    if (targets.length === 0) return false;

    // The section's key, not the piece's. A modulated final section spells its
    // degrees against where it modulated to, and rebuilding it against the
    // composition key would transpose it back without saying so.
    let previousNotes: readonly number[] | undefined;
    for (const [position, { chord, index }] of targets.entries()) {
      const bar = Math.floor(chord.startTick / composition.ticksPerBar);
      const section = composition.sections?.find(
        (entry) => bar >= entry.startBar && bar < entry.endBar,
      );
      composition.chords[index] = createStepChordEvent({
        step: steps[position % steps.length] as ProgressionStep,
        key: section?.key ?? composition.settings.key,
        mode: section?.mode ?? composition.settings.mode,
        startTick: chord.startTick,
        durationTick: chord.durationTick,
        id: chord.id,
        previousNotes,
      });
      previousNotes = composition.chords[index]!.notes;
    }

    if (composition.sections) {
      composition.sections = composition.sections.map((section) => {
        if (section.endBar <= bars.startBar || section.startBar >= bars.endBar) return section;
        const covered = section.startBar >= bars.startBar && section.endBar <= bars.endBar;
        // Rebuilt without the field rather than set to undefined, so a
        // section that plays no named progression does not serialise one.
        const rest = { ...section };
        delete rest.progressionId;
        return covered && progressionId !== undefined
          ? { ...rest, progressionId }
          : rest;
      });
    }

    set(stateAfterComposition(state, composition, "apply-progression", bars));
    return true;
  },

  transposeNote: (noteId, semitones) => get().moveNotes([noteId], { semitones }) > 0,

  moveNote: (noteId, move) => get().moveNotes([noteId], move) > 0,

  moveNotes: (noteIds, move) => {
    const state = get();
    const ids = new Set(noteIds);
    const selected = state.draftComposition.notes.filter((note) => ids.has(note.id));
    if (selected.length === 0) return 0;
    const composition = clone(state.draftComposition);
    const moved = new Map<string, NoteEvent>();
    composition.notes = sortNotes(composition.notes.map((note) => {
      if (!ids.has(note.id)) return note;
      const next = movedNote(composition, note, move);
      moved.set(note.id, next);
      return next;
    }));
    const bars = [
      ...selected.map((note) => note.barIndex),
      ...Array.from(moved.values(), (note) => note.barIndex),
    ];
    set(stateAfterComposition(state, composition, selected.length > 1 ? "move-notes" : "move-note", {
      startBar: Math.min(...bars),
      endBar: Math.max(...bars) + 1,
    }));
    return selected.length;
  },

  addNote: (midi, startTick, durationTick) => {
    const state = get();
    const composition = clone(state.draftComposition);
    const boundedMidi = clampInteger(
      midi,
      composition.settings.melody.minMidi,
      composition.settings.melody.maxMidi,
    );
    const boundedStart = clampInteger(startTick, 0, Math.max(0, composition.totalTicks - 1));
    const barIndex = Math.floor(boundedStart / composition.ticksPerBar);
    const boundedDuration = clampInteger(
      durationTick ?? composition.ppq / 2,
      1,
      Math.max(1, (barIndex + 1) * composition.ticksPerBar - boundedStart),
    );
    noteSerial += 1;
    const id = `note-user-${Date.now()}-${noteSerial}`;
    composition.notes = sortNotes([...composition.notes, {
      id,
      midi: boundedMidi,
      noteName: noteName(boundedMidi),
      startTick: boundedStart,
      durationTick: boundedDuration,
      velocity: composition.settings.melody.velocity,
      barIndex,
      role: "scaleTone",
    }]);
    set(stateAfterComposition(state, composition, "add-note", {
      startBar: barIndex,
      endBar: barIndex + 1,
    }));
    return id;
  },

  deleteNote: (noteId) => {
    return get().deleteNotes([noteId]) > 0;
  },

  deleteNotes: (noteIds) => {
    const state = get();
    const ids = new Set(noteIds);
    const notes = state.draftComposition.notes.filter((item) => ids.has(item.id));
    if (notes.length === 0) return 0;
    const composition = clone(state.draftComposition);
    composition.notes = composition.notes.filter((item) => !ids.has(item.id));
    set(stateAfterComposition(state, composition, "delete-note", {
      startBar: Math.min(...notes.map((note) => note.barIndex)),
      endBar: Math.max(...notes.map((note) => note.barIndex)) + 1,
    }));
    return notes.length;
  },

  duplicateNotes: (noteIds, deltaTick) => {
    const state = get();
    const ids = new Set(noteIds);
    const source = state.draftComposition.notes.filter((note) => ids.has(note.id));
    if (source.length === 0) return [];
    const composition = clone(state.draftComposition);
    const offset = Math.round(deltaTick ?? composition.ppq / 2);
    const added: NoteEvent[] = [];
    for (const note of source) {
      noteSerial += 1;
      const duplicate = movedNote(composition, {
        ...note,
        id: `note-user-${Date.now()}-${noteSerial}`,
      }, { deltaTick: offset });
      added.push(duplicate);
    }
    composition.notes = sortNotes([...composition.notes, ...added]);
    const bars = [...source, ...added].map((note) => note.barIndex);
    set(stateAfterComposition(state, composition, "duplicate-notes", {
      startBar: Math.min(...bars),
      endBar: Math.max(...bars) + 1,
    }));
    return added.map((note) => note.id);
  },

  quantizeNotes: (noteIds, gridTick) => {
    const state = get();
    const ids = new Set(noteIds);
    const selected = state.draftComposition.notes.filter((note) => ids.has(note.id));
    if (selected.length === 0) return 0;
    const composition = clone(state.draftComposition);
    const grid = clampInteger(gridTick ?? composition.ppq / 4, 1, composition.ticksPerBar);
    composition.notes = sortNotes(composition.notes.map((note) => {
      if (!ids.has(note.id)) return note;
      const startTick = Math.round(note.startTick / grid) * grid;
      const durationTick = Math.max(grid, Math.round(note.durationTick / grid) * grid);
      return movedNote(composition, note, { startTick, durationTick });
    }));
    set(stateAfterComposition(state, composition, "quantize-notes", {
      startBar: Math.min(...selected.map((note) => note.barIndex)),
      endBar: Math.max(...selected.map((note) => note.barIndex)) + 1,
    }));
    return selected.length;
  },

  toggleBarLock: (barIndex) => {
    const state = get();
    if (!Number.isInteger(barIndex) || barIndex < 0 || barIndex >= state.settings.bars) {
      return;
    }
    const locks = new Set(state.lockedBars);
    if (locks.has(barIndex)) {
      locks.delete(barIndex);
    } else {
      locks.add(barIndex);
    }
    const composition = clone(state.draftComposition);
    composition.lockedBars = [...locks].sort((a, b) => a - b);
    set(stateAfterComposition(state, composition, "toggle-bar-lock", {
      startBar: barIndex,
      endBar: barIndex + 1,
    }));
  },

  toggleVoiceMute: (voiceId) => {
    const state = get();
    const voice = state.draftComposition.voices?.find((candidate) => candidate.id === voiceId);
    if (!voice) return false;
    const composition = clone(state.draftComposition);
    composition.voices = composition.voices?.map((candidate) =>
      candidate.id === voiceId
        ? { ...candidate, muted: !candidate.muted }
        : candidate
    );
    set(stateAfterComposition(state, composition, voice.muted ? "unmute-voice" : "mute-voice", null));
    return true;
  },

  setSelectedRange: (range) => {
    const state = get();
    const normalized = normalizedBarRange(range, state.draftComposition);
    const loopRange = normalized
      ? rangeToTicks(normalized, state.draftComposition)
      : { startTick: 0, endTick: state.draftComposition.totalTicks };
    const audibleRange = normalizedBarRange(range, state.committedComposition);
    set({
      selectedBarRange: normalized,
      loopRange,
      playbackLoopRange: audibleRange
        ? rangeToTicks(audibleRange, state.committedComposition)
        : { startTick: 0, endTick: state.committedComposition.totalTicks },
    });
  },

  playWholePiece: () => {
    const state = get();
    // Selecting a chord narrows what plays to its bar, and there was no way
    // back: the loop readout displayed the range and nothing cleared it, so
    // pressing stop and play returned to the same single bar. Stopping means
    // going back to the top of the song, so it widens the range -- and leaves
    // the selection alone, because a chord being edited should stay selected
    // when the piece is stopped.
    set({
      loopRange: { startTick: 0, endTick: state.draftComposition.totalTicks },
      playbackLoopRange: { startTick: 0, endTick: state.committedComposition.totalTicks },
    });
  },

  setLoopRange: (range) => {
    const state = get();
    if (range === null) {
      const loopRange = state.selectedBarRange
        ? rangeToTicks(state.selectedBarRange, state.draftComposition)
        : { startTick: 0, endTick: state.draftComposition.totalTicks };
      const audibleSelectedRange = normalizedBarRange(
        state.selectedBarRange,
        state.committedComposition,
      );
      set({
        loopRange,
        playbackLoopRange: audibleSelectedRange
          ? rangeToTicks(audibleSelectedRange, state.committedComposition)
          : { startTick: 0, endTick: state.committedComposition.totalTicks },
      });
      return;
    }
    const ticks = "startBar" in range ? rangeToTicks(range, state.draftComposition) : range;
    const audibleTicks = "startBar" in range
      ? rangeToTicks(range, state.committedComposition)
      : range;
    set({
      loopRange: normalizedTickRange(ticks, state.draftComposition),
      playbackLoopRange: normalizedTickRange(audibleTicks, state.committedComposition),
    });
  },

  undo: () => {
    const state = get();
    if (state.historyIndex <= 0) {
      return false;
    }
    const historyIndex = state.historyIndex - 1;
    const composition = clone(state.history[historyIndex]!.composition);
    const selectedBarRange = normalizedBarRange(state.selectedBarRange, composition);
    const applyImmediately =
      state.playback.status !== "playing" || state.playback.updateTiming === "immediate";
    const committedBeforeAudition = state.auditionBaseComposition ?? state.committedComposition;
    const loopRange = normalizedTickRange(state.loopRange, composition);
    set({
      settings: clone(composition.settings),
      draftComposition: composition,
      committedComposition: applyImmediately ? clone(composition) : committedBeforeAudition,
      lockedBars: [...composition.lockedBars],
      selectedBarRange,
      loopRange,
      playbackLoopRange: applyImmediately ? loopRange : state.playbackLoopRange,
      historyIndex,
      pendingCommit: !applyImmediately,
      previewVariations: [],
      auditionedVariationIndex: null,
      auditionBaseComposition: null,
      auditionBasePendingCommit: false,
      auditionBasePlaybackLoopRange: null,
    });
    return true;
  },

  redo: () => {
    const state = get();
    if (state.historyIndex >= state.history.length - 1) {
      return false;
    }
    const historyIndex = state.historyIndex + 1;
    const composition = clone(state.history[historyIndex]!.composition);
    const selectedBarRange = normalizedBarRange(state.selectedBarRange, composition);
    const applyImmediately =
      state.playback.status !== "playing" || state.playback.updateTiming === "immediate";
    const committedBeforeAudition = state.auditionBaseComposition ?? state.committedComposition;
    const loopRange = normalizedTickRange(state.loopRange, composition);
    set({
      settings: clone(composition.settings),
      draftComposition: composition,
      committedComposition: applyImmediately ? clone(composition) : committedBeforeAudition,
      lockedBars: [...composition.lockedBars],
      selectedBarRange,
      loopRange,
      playbackLoopRange: applyImmediately ? loopRange : state.playbackLoopRange,
      historyIndex,
      pendingCommit: !applyImmediately,
      previewVariations: [],
      auditionedVariationIndex: null,
      auditionBaseComposition: null,
      auditionBasePendingCommit: false,
      auditionBasePlaybackLoopRange: null,
    });
    return true;
  },

  renameHistoryEntry: (historyId, name) => {
    const normalized = name.trim().slice(0, 80);
    if (!normalized) return false;
    const state = get();
    const index = state.history.findIndex((entry) => entry.id === historyId);
    if (index < 0) return false;
    const history = state.history.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, name: normalized } : entry
    );
    set({ history });
    return true;
  },

  restoreHistoryEntry: (historyId) => {
    const state = get();
    const entry = state.history.find((item) => item.id === historyId);
    if (!entry) return false;
    const composition = clone(entry.composition);
    const loopRange = entry.range
      ? rangeToTicks(entry.range, composition)
      : { startTick: 0, endTick: composition.totalTicks };
    const update = stateAfterComposition(
      state,
      composition,
      `restore:${entry.name}`,
      entry.range,
      true,
    );
    set({
      ...update,
      selectedBarRange: normalizedBarRange(entry.range, composition),
      loopRange,
      playbackLoopRange: update.pendingCommit ? state.playbackLoopRange : loopRange,
    });
    return true;
  },

  setPlaybackStatus: (status) => {
    const state = get();
    const canCommit = status !== "playing" && state.pendingCommit;
    const playbackLoopRange = canCommit
      ? normalizedTickRange(state.loopRange, state.draftComposition)
      : state.playbackLoopRange;
    set({
      playback: {
        ...state.playback,
        status,
        currentTick: status === "stopped"
          ? playbackLoopRange.startTick
          : state.playback.currentTick,
      },
      committedComposition: canCommit
        ? clone(state.draftComposition)
        : state.committedComposition,
      playbackLoopRange,
      pendingCommit: canCommit ? false : state.pendingCommit,
      auditionedVariationIndex: canCommit ? null : state.auditionedVariationIndex,
      auditionBaseComposition: canCommit ? null : state.auditionBaseComposition,
      auditionBasePendingCommit: canCommit ? false : state.auditionBasePendingCommit,
      auditionBasePlaybackLoopRange: canCommit
        ? null
        : state.auditionBasePlaybackLoopRange,
    });
  },

  setCurrentTick: (tick) => {
    const state = get();
    const currentTick = Math.max(0, Math.round(tick));
    const apply = shouldApplyPending(state, state.playback.currentTick, currentTick);
    set({
      playback: { ...state.playback, currentTick },
      committedComposition: apply
        ? clone(state.draftComposition)
        : state.committedComposition,
      playbackLoopRange: apply
        ? normalizedTickRange(state.loopRange, state.draftComposition)
        : state.playbackLoopRange,
      pendingCommit: apply ? false : state.pendingCommit,
      auditionedVariationIndex: apply ? null : state.auditionedVariationIndex,
      auditionBaseComposition: apply ? null : state.auditionBaseComposition,
      auditionBasePendingCommit: apply ? false : state.auditionBasePendingCommit,
      auditionBasePlaybackLoopRange: apply
        ? null
        : state.auditionBasePlaybackLoopRange,
    });
  },

  setUpdateTiming: (updateTiming) => {
    const state = get();
    const apply = updateTiming === "immediate" && state.pendingCommit;
    set({
      playback: { ...state.playback, updateTiming },
      committedComposition: apply
        ? clone(state.draftComposition)
        : state.committedComposition,
      playbackLoopRange: apply
        ? normalizedTickRange(state.loopRange, state.draftComposition)
        : state.playbackLoopRange,
      pendingCommit: apply ? false : state.pendingCommit,
      auditionedVariationIndex: apply ? null : state.auditionedVariationIndex,
      auditionBaseComposition: apply ? null : state.auditionBaseComposition,
      auditionBasePendingCommit: apply ? false : state.auditionBasePendingCommit,
      auditionBasePlaybackLoopRange: apply
        ? null
        : state.auditionBasePlaybackLoopRange,
    });
  },

  commitDraft: () => {
    const state = get();
    if (!state.pendingCommit) {
      return;
    }
    set({
      committedComposition: clone(state.draftComposition),
      playbackLoopRange: normalizedTickRange(state.loopRange, state.draftComposition),
      pendingCommit: false,
      auditionedVariationIndex: null,
      auditionBaseComposition: null,
      auditionBasePendingCommit: false,
      auditionBasePlaybackLoopRange: null,
    });
  },

  updateSettings: (patch) => {
    const state = get();
    set({ settings: settingsWithPatch(state.settings, patch) });
  },

  setSeed: (seed) => {
    const state = get();
    set({ settings: settingsWithPatch(state.settings, { seed }), regenerationIteration: 0 });
  },

  exportJson: () => exportCompositionJson(get().draftComposition),
  importJson: (json) => {
    const state = get();
    const composition = importCompositionJson(json);
    const loopRange = { startTick: 0, endTick: composition.totalTicks };
    const update = stateAfterComposition(state, composition, "import-json", null, true);
    set({
      ...update,
      selectedBarRange: null,
      loopRange,
      playbackLoopRange: update.pendingCommit ? state.playbackLoopRange : loopRange,
      regenerationIteration: 0,
      projectPersistenceBlocked: false,
      projectRecoveryReason: null,
    });
  },
  importMelody: (composition) => {
    const state = get();
    const loopRange = { startTick: 0, endTick: composition.totalTicks };
    // Same path as a project import: an imported melody replaces the piece and
    // must not leave a selection pointing at notes that no longer exist.
    const update = stateAfterComposition(state, composition, "import-melody", null, true);
    set({
      ...update,
      selectedBarRange: null,
      loopRange,
      playbackLoopRange: update.pendingCommit ? state.playbackLoopRange : loopRange,
      regenerationIteration: 0,
      projectPersistenceBlocked: false,
      projectRecoveryReason: null,
    });
  },
  exportMidi: () => exportCompositionMidi(get().draftComposition),

  reset: (patch = {}) => {
    clearEditorSnapshot(storage);
    set(freshState(patch));
  },
}));

interface PendingHistorySave {
  revision: number;
  historyRevision: number;
  state: ComposerStoreState;
  currentMode: StoragePersistenceMode;
}

let persistenceRevision = 0;
let historyPersistenceRevision = hydration.snapshot?.historyRevision ?? 0;
let pendingHistorySave: PendingHistorySave | null = null;
let historySaveScheduled = false;

function runWhenIdle(task: () => void): void {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => task(), { timeout: 500 });
    return;
  }
  globalThis.setTimeout(task, 0);
}

function scheduleHistorySave(): void {
  if (historySaveScheduled) return;
  historySaveScheduled = true;
  runWhenIdle(flushPendingHistorySave);
}

function flushPendingHistorySave(): void {
  historySaveScheduled = false;
  const pending = pendingHistorySave;
  pendingHistorySave = null;
  if (!pending) return;

  // Already off the edit call stack, and the status was always published
  // asynchronously, so awaiting a database write changes the timing of nothing
  // the user can observe.
  void (async () => {
    let projectSaveStatus: ProjectSaveStatus;
    try {
      const serialized = serializeHistoryState(
        persistentHistoryState(pending.state, pending.historyRevision),
      );
      const mode = serialized === null
        ? "memory"
        : await historyDatabase.write(EDITOR_HISTORY_RECORD, serialized);
      projectSaveStatus = pending.currentMode === "memory"
        ? "session"
        : mode === "memory"
          ? "partial"
          : "saved";
    } catch {
      projectSaveStatus = pending.currentMode === "memory" ? "session" : "partial";
    }

    const current = useComposerStore.getState();
    if (
      pending.revision === persistenceRevision
      && !current.projectPersistenceBlocked
    ) {
      useComposerStore.setState({ projectSaveStatus });
    }

    if (pendingHistorySave) scheduleHistorySave();
  })();
}

/**
 * Carries the Web Storage sidecar across and adopts whatever the database holds.
 *
 * Runs after hydration, so the app has already painted from the synchronously
 * loaded project. The adopted history is only taken while the session is still
 * pristine: once an edit has bumped the revision, the in-memory history is
 * newer than anything on disk and replacing it would discard real work.
 */
async function restoreHistoryFromDatabase(): Promise<void> {
  try {
    await migrateEditorHistoryToDatabase(historyDatabase, storage);
    const stored = await historyDatabase.read(EDITOR_HISTORY_RECORD);
    if (stored === null) return;
    const recovered = parseHistorySnapshotJson(stored);
    if (!recovered || recovered.history.length === 0) return;
    if (historyPersistenceRevision !== 0) return;

    const state = useComposerStore.getState();
    if (state.projectPersistenceBlocked) return;
    const index = recovered.activeHistoryId
      ? recovered.history.findIndex((entry) => entry.id === recovered.activeHistoryId)
      : -1;
    useComposerStore.setState({
      // Same normalization hydration applies: a stored entry may omit the
      // display name, which falls back to the action that produced it.
      history: recovered.history.map((entry) => ({
        ...entry,
        name: entry.name?.trim() || entry.action,
      })),
      historyIndex: index >= 0 ? index : recovered.history.length - 1,
      projectSaveStatus: state.projectSaveStatus === "partial"
        ? "saved"
        : state.projectSaveStatus,
    });
  } catch {
    // The project itself is already loaded; a history that will not come back
    // leaves the session-only state the status bar already reports.
  }
}

// Started here rather than from a component: hydration is a module-scope
// concern already, and a React effect would run after the first edit is
// possible, which is exactly when adopting stored history becomes unsafe.
void restoreHistoryFromDatabase();

useComposerStore.subscribe((state, previous) => {
  const changed =
    state.settings !== previous.settings ||
    state.draftComposition !== previous.draftComposition ||
    state.selectedBarRange !== previous.selectedBarRange ||
    state.loopRange !== previous.loopRange ||
    state.lockedBars !== previous.lockedBars ||
    state.playback.updateTiming !== previous.playback.updateTiming ||
    state.history !== previous.history ||
    state.historyIndex !== previous.historyIndex ||
    state.regenerationIteration !== previous.regenerationIteration;
  if (changed) {
    const revision = ++persistenceRevision;
    if (state.history !== previous.history || state.historyIndex !== previous.historyIndex) {
      historyPersistenceRevision += 1;
    }
    if (state.projectPersistenceBlocked) {
      pendingHistorySave = null;
      if (state.projectSaveStatus !== "recovery") {
        useComposerStore.setState({ projectSaveStatus: "recovery" });
      }
      return;
    }
    const saved = saveEditorCurrentSnapshot(
      persistentCurrentSnapshot(state, historyPersistenceRevision),
      storage,
    );
    if (!saved.currentSaved) {
      pendingHistorySave = null;
    }
    const projectSaveStatus: ProjectSaveStatus = !saved.currentSaved
      ? "error"
      : saved.currentMode === "memory"
        ? "session"
        : "saving";
    useComposerStore.setState({
      projectSaveStatus,
      lastSavedAt: saved.currentSaved ? new Date().toISOString() : state.lastSavedAt,
    });
    if (saved.currentSaved) {
      // Keep only the newest immutable Zustand state. Cloning and serializing
      // the potentially large Undo history happens outside the edit call stack.
      pendingHistorySave = {
        revision,
        historyRevision: historyPersistenceRevision,
        state,
        currentMode: saved.currentMode,
      };
      scheduleHistorySave();
    }
  }
});
