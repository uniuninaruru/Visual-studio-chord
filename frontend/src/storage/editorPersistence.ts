import type { BarRange, GeneratedComposition, GeneratorSettings } from "../types/music";
import { isGeneratedComposition, isGeneratorSettings } from "../features/export/json";
import {
  getSafeStorage,
  getStoragePersistenceMode,
  removeStoredValue,
  type StoragePersistenceMode,
  type StorageLike,
  writeJson,
} from "./safeStorage";

export const EDITOR_STORAGE_KEY = "music-theory-composer:editor:v1";
export const EDITOR_HISTORY_STORAGE_KEY = "music-theory-composer:editor-history:v1";
export const EDITOR_STORAGE_VERSION = 1;

export interface PersistedTickRange {
  startTick: number;
  endTick: number;
}

export interface PersistedHistoryEntry {
  id: string;
  name?: string;
  action: string;
  timestamp: string;
  seed: string;
  range: BarRange | null;
  composition: GeneratedComposition;
}

export interface PersistedEditorSnapshot {
  version: typeof EDITOR_STORAGE_VERSION;
  /** Present on bounded current snapshots whose full Undo history lives in the sidecar. */
  historySidecarExpected?: boolean;
  /** Monotonic revision shared with the full-history sidecar. */
  historyRevision?: number;
  settings: GeneratorSettings;
  composition: GeneratedComposition;
  selectedBarRange: BarRange | null;
  loopRange: PersistedTickRange;
  lockedBars: number[];
  updateTiming: "immediate" | "nextBeat" | "nextBar" | "nextLoop";
  history: PersistedHistoryEntry[];
  historyIndex: number;
  regenerationIteration: number;
}

interface PersistedHistorySnapshot {
  version: typeof EDITOR_STORAGE_VERSION;
  historyRevision?: number;
  activeHistoryId: string;
  history: PersistedHistoryEntry[];
  historyIndex: number;
}

export type EditorPersistenceIssue =
  | "none"
  | "current-invalid"
  | "current-unsupported"
  | "history-recovered"
  | "history-session";

export interface EditorSnapshotLoadResult {
  snapshot: PersistedEditorSnapshot | null;
  issue: EditorPersistenceIssue;
}

export interface EditorSnapshotSaveResult {
  currentSaved: boolean;
  currentMode: StoragePersistenceMode;
  historySaved: boolean;
  historyMode: StoragePersistenceMode;
}

export interface EditorCurrentSaveResult {
  currentSaved: boolean;
  currentMode: StoragePersistenceMode;
}

export interface EditorHistorySaveResult {
  historySaved: boolean;
  historyMode: StoragePersistenceMode;
}

export type PersistedHistoryState = Pick<
  PersistedEditorSnapshot,
  "history" | "historyIndex" | "historyRevision"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRange(value: unknown): value is BarRange | null {
  if (value === null) {
    return true;
  }
  return (
    isRecord(value) &&
    Number.isInteger(value.startBar) &&
    Number.isInteger(value.endBar) &&
    (value.startBar as number) >= 0 &&
    (value.endBar as number) > (value.startBar as number)
  );
}

function isTickRange(value: unknown): value is PersistedTickRange {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.startTick) &&
    Number.isSafeInteger(value.endTick) &&
    (value.startTick as number) >= 0 &&
    (value.endTick as number) > (value.startTick as number)
  );
}

function isHistoryEntry(value: unknown): value is PersistedHistoryEntry {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.name === undefined || typeof value.name === "string") &&
    typeof value.action === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.seed === "string" &&
    isRange(value.range) &&
    isGeneratedComposition(value.composition)
  );
}

function hasValidSnapshotBase(value: unknown): value is Record<string, unknown> & {
  version: typeof EDITOR_STORAGE_VERSION;
  settings: GeneratorSettings;
  composition: GeneratedComposition;
  selectedBarRange: BarRange | null;
  loopRange: PersistedTickRange;
  lockedBars: number[];
  updateTiming: PersistedEditorSnapshot["updateTiming"];
  regenerationIteration: number;
  historyRevision?: number;
} {
  if (!isRecord(value) || value.version !== EDITOR_STORAGE_VERSION) return false;
  const timings = ["immediate", "nextBeat", "nextBar", "nextLoop"];
  return (
    isGeneratorSettings(value.settings) &&
    isGeneratedComposition(value.composition) &&
    isRange(value.selectedBarRange) &&
    isTickRange(value.loopRange) &&
    Array.isArray(value.lockedBars) &&
    value.lockedBars.every((bar) => Number.isSafeInteger(bar) && bar >= 0) &&
    typeof value.updateTiming === "string" &&
    timings.includes(value.updateTiming) &&
    Number.isSafeInteger(value.regenerationIteration) &&
    (value.regenerationIteration as number) >= 0 &&
    (
      value.historyRevision === undefined
      || (Number.isSafeInteger(value.historyRevision) && (value.historyRevision as number) >= 0)
    )
  );
}

function recoveredHistoryEntry(
  composition: GeneratedComposition,
  timestamp = new Date().toISOString(),
): PersistedHistoryEntry {
  return {
    id: `recovered-${composition.id}`,
    name: "Recovered current project",
    action: "recovered",
    timestamp,
    seed: String(composition.seed ?? composition.settings.seed),
    range: null,
    composition,
  };
}

function recoverEditorSnapshot(value: unknown): {
  snapshot: PersistedEditorSnapshot;
  recovered: boolean;
} | null {
  if (!hasValidSnapshotBase(value)) return null;

  const rawHistory = Array.isArray(value.history) ? value.history : [];
  const validHistory = rawHistory.filter(isHistoryEntry);
  const requestedIndex = Number.isSafeInteger(value.historyIndex)
    ? value.historyIndex as number
    : -1;
  const requestedEntry = requestedIndex >= 0 && requestedIndex < rawHistory.length
    && isHistoryEntry(rawHistory[requestedIndex])
    ? rawHistory[requestedIndex]
    : null;
  let history = validHistory;
  let historyIndex = requestedEntry
    ? history.findIndex((entry) => entry.id === requestedEntry.id)
    : -1;

  if (historyIndex < 0) {
    history = [
      ...history,
      recoveredHistoryEntry(value.composition),
    ];
    historyIndex = history.length - 1;
  } else {
    history = history.map((entry, index) => index === historyIndex
      ? { ...entry, composition: value.composition }
      : entry);
  }

  return {
    snapshot: {
      version: EDITOR_STORAGE_VERSION,
      settings: value.settings,
      composition: value.composition,
      selectedBarRange: value.selectedBarRange,
      loopRange: value.loopRange,
      lockedBars: value.lockedBars,
      updateTiming: value.updateTiming,
      history,
      historyIndex,
      regenerationIteration: value.regenerationIteration,
      historyRevision: value.historyRevision,
    },
    recovered:
      rawHistory.length !== validHistory.length
      || requestedEntry === null
      || !isPersistedEditorSnapshot(value),
  };
}

type ParsedStoredValue =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "value"; value: unknown };

function parseStoredValue(storage: StorageLike, key: string): ParsedStoredValue {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { status: "missing" };
    try {
      return { status: "value", value: JSON.parse(raw) as unknown };
    } catch {
      return { status: "invalid" };
    }
  } catch {
    return { status: "invalid" };
  }
}

function isUnsupportedCurrentVersion(value: unknown): boolean {
  return isRecord(value)
    && Number.isInteger(value.version)
    && (value.version as number) > EDITOR_STORAGE_VERSION;
}

export function isPersistedEditorSnapshot(value: unknown): value is PersistedEditorSnapshot {
  if (!hasValidSnapshotBase(value)) return false;
  return (
    Array.isArray(value.history) &&
    value.history.length > 0 &&
    value.history.every(isHistoryEntry) &&
    Number.isSafeInteger(value.historyIndex) &&
    (value.historyIndex as number) >= 0 &&
    (value.historyIndex as number) < value.history.length &&
    Number.isSafeInteger(value.regenerationIteration) &&
    (value.regenerationIteration as number) >= 0
  );
}

function recoverHistorySnapshot(value: unknown): {
  history: PersistedHistoryEntry[];
  activeHistoryId: string | null;
  historyRevision?: number;
  recovered: boolean;
} | null {
  if (!isRecord(value) || value.version !== EDITOR_STORAGE_VERSION) return null;
  const rawHistory = Array.isArray(value.history) ? value.history : [];
  const history = rawHistory.filter(isHistoryEntry);
  const requestedIndex = Number.isSafeInteger(value.historyIndex)
    ? value.historyIndex as number
    : -1;
  const requestedEntry = requestedIndex >= 0 && requestedIndex < rawHistory.length
    && isHistoryEntry(rawHistory[requestedIndex])
    ? rawHistory[requestedIndex]
    : null;
  const declaredActiveId = typeof value.activeHistoryId === "string"
    ? value.activeHistoryId
    : null;
  const historyRevision = Number.isSafeInteger(value.historyRevision)
    && (value.historyRevision as number) >= 0
    ? value.historyRevision as number
    : undefined;
  return {
    history,
    activeHistoryId: requestedEntry?.id ?? declaredActiveId,
    historyRevision,
    recovered:
      history.length !== rawHistory.length
      || requestedEntry === null
      || declaredActiveId !== requestedEntry?.id
      || (
        value.historyRevision !== undefined
        && historyRevision === undefined
      ),
  };
}

export function loadEditorSnapshotWithStatus(
  storage: StorageLike = getSafeStorage(),
): EditorSnapshotLoadResult {
  const storedCore = parseStoredValue(storage, EDITOR_STORAGE_KEY);
  if (storedCore.status === "missing") return { snapshot: null, issue: "none" };
  if (storedCore.status === "invalid") {
    return { snapshot: null, issue: "current-invalid" };
  }
  const core = recoverEditorSnapshot(storedCore.value);
  if (!core) {
    return {
      snapshot: null,
      issue: isUnsupportedCurrentVersion(storedCore.value)
        ? "current-unsupported"
        : "current-invalid",
    };
  }

  const storedHistory = parseStoredValue(storage, EDITOR_HISTORY_STORAGE_KEY);
  if (storedHistory.status === "missing") {
    const historySidecarExpected = isRecord(storedCore.value)
      && storedCore.value.historySidecarExpected === true;
    return {
      snapshot: core.snapshot,
      issue: historySidecarExpected
        ? "history-session"
        : core.recovered
          ? "history-recovered"
          : "none",
    };
  }
  if (storedHistory.status === "invalid") {
    return { snapshot: core.snapshot, issue: "history-recovered" };
  }
  const sidecar = recoverHistorySnapshot(storedHistory.value);
  if (!sidecar) {
    return { snapshot: core.snapshot, issue: "history-recovered" };
  }

  const coreActive = core.snapshot.history[core.snapshot.historyIndex]!;
  let history = sidecar.history;
  let historyIndex = history.findIndex((entry) => entry.id === coreActive.id);
  let issue: EditorPersistenceIssue = core.recovered || sidecar.recovered
    ? "history-recovered"
    : "none";
  // Legacy snapshots omit both revisions. Any one-sided or unequal revision
  // means the full Undo sidecar did not catch up with the durable current item.
  const revisionMismatch = sidecar.historyRevision !== core.snapshot.historyRevision;

  if (historyIndex < 0 || sidecar.activeHistoryId !== coreActive.id) {
    history = [...history, coreActive];
    historyIndex = history.length - 1;
    issue = "history-session";
  } else {
    history = history.map((entry, index) => index === historyIndex
      ? { ...entry, ...coreActive, composition: core.snapshot.composition }
      : entry);
    if (revisionMismatch) issue = "history-session";
  }

  return {
    snapshot: { ...core.snapshot, history, historyIndex },
    issue,
  };
}

export function loadEditorSnapshot(
  storage: StorageLike = getSafeStorage(),
): PersistedEditorSnapshot | null {
  return loadEditorSnapshotWithStatus(storage).snapshot;
}

function coreSnapshot(snapshot: PersistedEditorSnapshot): PersistedEditorSnapshot {
  const active = snapshot.history[snapshot.historyIndex]
    ?? recoveredHistoryEntry(snapshot.composition);
  return {
    ...snapshot,
    historySidecarExpected: true,
    history: [{ ...active, composition: snapshot.composition }],
    historyIndex: 0,
  };
}

export function saveEditorSnapshotWithStatus(
  snapshot: PersistedEditorSnapshot,
  storage: StorageLike = getSafeStorage(),
): EditorSnapshotSaveResult {
  return saveEditorSnapshotInStages(snapshot, () => snapshot, storage);
}

export function saveEditorCurrentSnapshot(
  snapshot: PersistedEditorSnapshot,
  storage: StorageLike = getSafeStorage(),
): EditorCurrentSaveResult {
  return {
    currentSaved: writeJson(EDITOR_STORAGE_KEY, coreSnapshot(snapshot), storage),
    currentMode: getStoragePersistenceMode(storage, EDITOR_STORAGE_KEY),
  };
}

export function saveEditorHistoryState(
  historyState: PersistedHistoryState,
  storage: StorageLike = getSafeStorage(),
): EditorHistorySaveResult {
  const active = historyState.history[historyState.historyIndex];
  if (!active) {
    return {
      historySaved: false,
      historyMode: getStoragePersistenceMode(storage, EDITOR_HISTORY_STORAGE_KEY),
    };
  }
  const historySnapshot: PersistedHistorySnapshot = {
    version: EDITOR_STORAGE_VERSION,
    historyRevision: historyState.historyRevision,
    activeHistoryId: active.id,
    history: historyState.history,
    historyIndex: historyState.historyIndex,
  };
  return {
    historySaved: writeJson(EDITOR_HISTORY_STORAGE_KEY, historySnapshot, storage),
    historyMode: getStoragePersistenceMode(storage, EDITOR_HISTORY_STORAGE_KEY),
  };
}

/**
 * Persists the bounded current-project snapshot before constructing the
 * potentially large history payload. A history clone/stringify failure cannot
 * prevent the current composition from reaching durable storage.
 */
export function saveEditorSnapshotInStages(
  currentSnapshot: PersistedEditorSnapshot,
  historyFactory: () => PersistedHistoryState,
  storage: StorageLike = getSafeStorage(),
): EditorSnapshotSaveResult {
  const current = saveEditorCurrentSnapshot(currentSnapshot, storage);
  let historySaved = false;
  let historyMode = getStoragePersistenceMode(storage, EDITOR_HISTORY_STORAGE_KEY);
  if (current.currentSaved) {
    try {
      const history = saveEditorHistoryState({
        ...historyFactory(),
        // The current snapshot was already persisted. Keep the sidecar on the
        // exact same revision even if a caller constructs it independently.
        historyRevision: currentSnapshot.historyRevision,
      }, storage);
      historySaved = history.historySaved;
      historyMode = history.historyMode;
    } catch {
      historySaved = false;
    }
  }
  return {
    currentSaved: current.currentSaved,
    currentMode: current.currentMode,
    historySaved,
    historyMode,
  };
}

export function saveEditorSnapshot(
  snapshot: PersistedEditorSnapshot,
  storage: StorageLike = getSafeStorage(),
): boolean {
  const result = saveEditorSnapshotWithStatus(snapshot, storage);
  return result.currentSaved && result.historySaved;
}

export function clearEditorSnapshot(storage: StorageLike = getSafeStorage()): boolean {
  const currentRemoved = removeStoredValue(EDITOR_STORAGE_KEY, storage);
  const historyRemoved = removeStoredValue(EDITOR_HISTORY_STORAGE_KEY, storage);
  return currentRemoved && historyRemoved;
}

/**
 * Serializes a history sidecar without deciding where it goes.
 *
 * The Web Storage writer builds this same payload inline. Exposing it lets the
 * IndexedDB path reuse the exact snapshot shape, so a record written by one and
 * read by the other cannot drift apart.
 */
export function serializeHistoryState(
  historyState: PersistedHistoryState,
): string | null {
  const active = historyState.history[historyState.historyIndex];
  if (!active) return null;
  const snapshot: PersistedHistorySnapshot = {
    version: EDITOR_STORAGE_VERSION,
    historyRevision: historyState.historyRevision,
    activeHistoryId: active.id,
    history: historyState.history,
    historyIndex: historyState.historyIndex,
  };
  try {
    return JSON.stringify(snapshot);
  } catch {
    // A history that will not serialize cannot be stored anywhere, and the
    // caller reports the session-only state rather than throwing at an edit.
    return null;
  }
}

/**
 * Reads a serialized sidecar back, applying the same recovery the Web Storage
 * loader applies, so a malformed record degrades instead of throwing.
 */
export function parseHistorySnapshotJson(json: string): {
  history: PersistedHistoryEntry[];
  activeHistoryId: string | null;
  historyRevision?: number;
  recovered: boolean;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  return recoverHistorySnapshot(parsed);
}
