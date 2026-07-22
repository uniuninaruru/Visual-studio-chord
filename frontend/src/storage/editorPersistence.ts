import type { BarRange, GeneratedComposition, GeneratorSettings } from "../types/music";
import { isGeneratedComposition, isGeneratorSettings } from "../features/export/json";
import {
  getSafeStorage,
  readJson,
  removeStoredValue,
  type StorageLike,
  writeJson,
} from "./safeStorage";

export const EDITOR_STORAGE_KEY = "visual-studio-chord:editor:v1";
/** Storage key from an earlier project name; migrated on first load. */
export const LEGACY_EDITOR_STORAGE_KEYS = ["music-theory-composer:editor:v1"] as const;
export const EDITOR_STORAGE_VERSION = 1;

export interface PersistedTickRange {
  startTick: number;
  endTick: number;
}

export interface PersistedHistoryEntry {
  id: string;
  action: string;
  timestamp: string;
  seed: string;
  range: BarRange | null;
  composition: GeneratedComposition;
}

export interface PersistedEditorSnapshot {
  version: typeof EDITOR_STORAGE_VERSION;
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
    Number.isFinite(value.startTick) &&
    Number.isFinite(value.endTick) &&
    (value.startTick as number) >= 0 &&
    (value.endTick as number) > (value.startTick as number)
  );
}

function isHistoryEntry(value: unknown): value is PersistedHistoryEntry {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.action === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.seed === "string" &&
    isRange(value.range) &&
    isGeneratedComposition(value.composition)
  );
}

export function isPersistedEditorSnapshot(value: unknown): value is PersistedEditorSnapshot {
  if (!isRecord(value) || value.version !== EDITOR_STORAGE_VERSION) {
    return false;
  }

  if (!isGeneratedComposition(value.composition)) {
    return false;
  }

  const timings = ["immediate", "nextBeat", "nextBar", "nextLoop"];
  return (
    isGeneratorSettings(value.settings) &&
    isRange(value.selectedBarRange) &&
    isTickRange(value.loopRange) &&
    Array.isArray(value.lockedBars) &&
    value.lockedBars.every((bar) => Number.isInteger(bar) && bar >= 0) &&
    typeof value.updateTiming === "string" &&
    timings.includes(value.updateTiming) &&
    Array.isArray(value.history) &&
    value.history.length > 0 &&
    value.history.every(isHistoryEntry) &&
    Number.isInteger(value.historyIndex) &&
    (value.historyIndex as number) >= 0 &&
    (value.historyIndex as number) < value.history.length &&
    Number.isInteger(value.regenerationIteration) &&
    (value.regenerationIteration as number) >= 0
  );
}

export function loadEditorSnapshot(
  storage: StorageLike = getSafeStorage(),
): PersistedEditorSnapshot | null {
  const current = readJson(EDITOR_STORAGE_KEY, isPersistedEditorSnapshot, storage);
  if (current) {
    return current;
  }
  // Migrate a snapshot saved under an earlier project name so a rename does not
  // orphan the user's local work. The first successful read is re-saved under
  // the current key and the legacy copy removed.
  for (const legacyKey of LEGACY_EDITOR_STORAGE_KEYS) {
    const legacy = readJson(legacyKey, isPersistedEditorSnapshot, storage);
    if (legacy) {
      writeJson(EDITOR_STORAGE_KEY, legacy, storage);
      removeStoredValue(legacyKey, storage);
      return legacy;
    }
  }
  return null;
}

export function saveEditorSnapshot(
  snapshot: PersistedEditorSnapshot,
  storage: StorageLike = getSafeStorage(),
): boolean {
  return writeJson(EDITOR_STORAGE_KEY, snapshot, storage);
}

export function clearEditorSnapshot(storage: StorageLike = getSafeStorage()): boolean {
  return removeStoredValue(EDITOR_STORAGE_KEY, storage);
}
