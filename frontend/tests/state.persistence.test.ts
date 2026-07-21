import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import {
  EDITOR_HISTORY_STORAGE_KEY,
  EDITOR_STORAGE_KEY,
  ResilientStorage,
  clearEditorSnapshot,
  loadEditorSnapshotWithStatus,
  readJson,
  saveEditorCurrentSnapshot,
  saveEditorSnapshotInStages,
  saveEditorSnapshotWithStatus,
  writeJson,
  type PersistedEditorSnapshot,
  type StorageLike,
} from "../src/storage";

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new Error("blocked");
  }

  setItem(): void {
    throw new Error("quota exceeded");
  }

  removeItem(): void {
    throw new Error("blocked");
  }
}

class MapStorage implements StorageLike {
  readonly values = new Map<string, string>();
  failWrites = false;
  failRemovals = false;
  failHistoryWrites = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites || (this.failHistoryWrites && key === EDITOR_HISTORY_STORAGE_KEY)) {
      throw new Error("quota exceeded");
    }
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    if (this.failRemovals) throw new Error("deletion denied");
    this.values.delete(key);
  }
}

function editorSnapshot(seed = "persistence-a"): PersistedEditorSnapshot {
  const composition = generateComposition({ ...DEFAULT_GENERATOR_SETTINGS, seed });
  return {
    version: 1,
    settings: composition.settings,
    composition,
    selectedBarRange: null,
    loopRange: { startTick: 0, endTick: composition.totalTicks },
    lockedBars: [],
    updateTiming: "nextBar",
    history: [{
      id: `history-${seed}`,
      name: "Generated",
      action: "generate",
      timestamp: "2026-07-22T00:00:00.000Z",
      seed,
      range: null,
      composition,
    }],
    historyIndex: 0,
    regenerationIteration: 0,
  };
}

describe("safe storage helpers", () => {
  it("does not crash when storage access is denied", () => {
    const storage = new ThrowingStorage();
    expect(
      readJson(
        "key",
        (value): value is object => typeof value === "object" && value !== null,
        storage,
      ),
    ).toBeNull();
    expect(writeJson("key", { ok: true }, storage)).toBe(false);
  });

  it("rejects malformed JSON", () => {
    const storage: StorageLike = {
      getItem: () => "{broken",
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(
      readJson(
        "key",
        (value): value is object => typeof value === "object" && value !== null,
        storage,
      ),
    ).toBeNull();
  });

  it("keeps primary reads and removals available after a quota write failure", () => {
    const primary = new MapStorage();
    const fallback = new MapStorage();
    primary.setItem("existing", "primary-value");
    primary.failWrites = true;
    const storage = new ResilientStorage(primary, fallback);

    storage.setItem("new", "fallback-value");
    expect(storage.mode).toBe("memory");
    expect(storage.getItem("existing")).toBe("primary-value");
    expect(storage.getItem("new")).toBe("fallback-value");

    storage.removeItem("existing");
    expect(primary.getItem("existing")).toBeNull();
    expect(storage.getItem("existing")).toBeNull();
  });

  it("uses fallback values and tombstones instead of resurfacing stale primary data", () => {
    const primary = new MapStorage();
    const fallback = new MapStorage();
    primary.setItem("project", "old");
    primary.failWrites = true;
    const storage = new ResilientStorage(primary, fallback);

    storage.setItem("project", "new");
    expect(storage.getItem("project")).toBe("new");

    primary.failRemovals = true;
    storage.removeItem("project");
    expect(primary.getItem("project")).toBe("old");
    expect(storage.getItem("project")).toBeNull();
  });

  it("salvages the current composition when individual history entries are corrupt", () => {
    const storage = new MapStorage();
    const snapshot = editorSnapshot();
    storage.setItem(EDITOR_STORAGE_KEY, JSON.stringify({
      ...snapshot,
      history: [snapshot.history[0], { id: "broken-entry" }],
      historyIndex: 1,
    }));

    const loaded = loadEditorSnapshotWithStatus(storage);
    expect(loaded.issue).toBe("history-recovered");
    expect(loaded.snapshot?.composition).toEqual(snapshot.composition);
    expect(loaded.snapshot?.history.some((entry) => entry.id === "broken-entry")).toBe(false);
    expect(loaded.snapshot?.history[loaded.snapshot.historyIndex]?.composition)
      .toEqual(snapshot.composition);
  });

  it("distinguishes malformed and future current snapshots from missing storage", () => {
    const storage = new MapStorage();
    expect(loadEditorSnapshotWithStatus(storage)).toEqual({ snapshot: null, issue: "none" });

    storage.setItem(EDITOR_STORAGE_KEY, "{broken");
    expect(loadEditorSnapshotWithStatus(storage)).toEqual({
      snapshot: null,
      issue: "current-invalid",
    });

    storage.setItem(EDITOR_STORAGE_KEY, JSON.stringify({
      ...editorSnapshot(),
      version: 999,
    }));
    expect(loadEditorSnapshotWithStatus(storage)).toEqual({
      snapshot: null,
      issue: "current-unsupported",
    });
  });

  it("persists the current snapshot before building a potentially failing history payload", () => {
    const storage = new MapStorage();
    const snapshot = editorSnapshot("current-before-history");
    let historyFactoryCalled = false;
    const result = saveEditorSnapshotInStages(
      snapshot,
      () => {
        historyFactoryCalled = true;
        throw new Error("history clone exhausted memory");
      },
      storage,
    );

    expect(historyFactoryCalled).toBe(true);
    expect(result).toMatchObject({
      currentSaved: true,
      currentMode: "localStorage",
      historySaved: false,
    });
    expect(JSON.parse(storage.getItem(EDITOR_STORAGE_KEY) ?? "null").composition.id)
      .toBe(snapshot.composition.id);
    expect(loadEditorSnapshotWithStatus(storage).issue).toBe("history-session");
  });

  it("keeps current metadata and reports a stale history sidecar by revision", () => {
    const storage = new MapStorage();
    const original = editorSnapshot("rename-before-close");
    original.historyRevision = 1;
    original.history[0] = { ...original.history[0]!, name: "Original" };
    expect(saveEditorSnapshotWithStatus(original, storage).historySaved).toBe(true);

    const renamed: PersistedEditorSnapshot = {
      ...original,
      historyRevision: 2,
      history: [{ ...original.history[0]!, name: "Renamed before close" }],
    };
    expect(saveEditorCurrentSnapshot(renamed, storage).currentSaved).toBe(true);

    const loaded = loadEditorSnapshotWithStatus(storage);
    expect(loaded.issue).toBe("history-session");
    expect(loaded.snapshot?.history[loaded.snapshot.historyIndex]?.name)
      .toBe("Renamed before close");
    expect(loaded.snapshot?.historyRevision).toBe(2);
  });

  it("saves the current project separately when the full history exceeds quota", () => {
    const primary = new MapStorage();
    const fallback = new MapStorage();
    const storage = new ResilientStorage(primary, fallback);
    const first = editorSnapshot("persistence-first");
    expect(saveEditorSnapshotWithStatus(first, storage).historySaved).toBe(true);

    const second = editorSnapshot("persistence-second");
    second.history = [...first.history, ...second.history];
    second.historyIndex = 1;
    primary.failHistoryWrites = true;
    const saved = saveEditorSnapshotWithStatus(second, storage);

    expect(saved).toMatchObject({
      currentSaved: true,
      currentMode: "localStorage",
      historySaved: true,
      historyMode: "memory",
    });
    expect(JSON.parse(primary.getItem(EDITOR_STORAGE_KEY) ?? "null").history).toHaveLength(1);
    expect(second.history).toHaveLength(2);

    const third = editorSnapshot("persistence-third");
    third.history = [...second.history, ...third.history];
    third.historyIndex = 2;
    const savedAgain = saveEditorSnapshotWithStatus(third, storage);
    expect(savedAgain.currentMode).toBe("localStorage");
    expect(JSON.parse(primary.getItem(EDITOR_STORAGE_KEY) ?? "null").composition.id)
      .toBe(third.composition.id);

    // A fresh session has only durable primary data. It keeps the latest
    // current project and merges the last durable history without pretending
    // that the session-only history was persisted.
    const reloadedStorage = new ResilientStorage(primary, new MapStorage());
    const loaded = loadEditorSnapshotWithStatus(reloadedStorage);
    expect(loaded.issue).toBe("history-session");
    expect(loaded.snapshot?.composition).toEqual(third.composition);
    expect(loaded.snapshot?.history.map((entry) => entry.id)).toEqual([
      first.history[0]?.id,
      third.history[2]?.id,
    ]);
  });

  it("clears both the current snapshot and the history sidecar", () => {
    const storage = new MapStorage();
    saveEditorSnapshotWithStatus(editorSnapshot(), storage);
    expect(clearEditorSnapshot(storage)).toBe(true);
    expect(storage.getItem(EDITOR_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(EDITOR_HISTORY_STORAGE_KEY)).toBeNull();
  });
});
