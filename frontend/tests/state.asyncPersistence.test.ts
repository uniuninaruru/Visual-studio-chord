import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EDITOR_HISTORY_STORAGE_KEY,
  EDITOR_STORAGE_KEY,
  loadEditorSnapshotWithStatus,
} from "../src/storage";

describe("asynchronous editor history persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.resetModules();
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("saves the current project immediately and coalesces history to the latest state", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { useComposerStore } = await import("../src/state/editorStore");

    useComposerStore.getState().generateComposition({ seed: "queue-first" });
    useComposerStore.getState().generateComposition({ seed: "queue-latest" });

    const historyWritesBeforeIdle = setItem.mock.calls.filter(
      ([key]) => key === EDITOR_HISTORY_STORAGE_KEY,
    );
    expect(historyWritesBeforeIdle).toHaveLength(0);
    expect(useComposerStore.getState().projectSaveStatus).toBe("saving");
    expect(
      JSON.parse(localStorage.getItem(EDITOR_STORAGE_KEY) ?? "null")
        .composition.settings.seed,
    ).toBe("queue-latest");

    await vi.runAllTimersAsync();

    const historyWritesAfterIdle = setItem.mock.calls.filter(
      ([key]) => key === EDITOR_HISTORY_STORAGE_KEY,
    );
    expect(historyWritesAfterIdle).toHaveLength(1);
    const historySidecar = JSON.parse(
      localStorage.getItem(EDITOR_HISTORY_STORAGE_KEY) ?? "null",
    );
    expect(
      historySidecar.history[historySidecar.historyIndex].composition.settings.seed,
    ).toBe("queue-latest");
    expect(useComposerStore.getState().projectSaveStatus).toBe("saved");
  });

  it("keeps the current project durable and reports partial when history falls back", async () => {
    const nativeSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function setItem(
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === EDITOR_HISTORY_STORAGE_KEY) {
        throw new Error("history quota exceeded");
      }
      nativeSetItem.call(this, key, value);
    });
    const { useComposerStore } = await import("../src/state/editorStore");

    useComposerStore.getState().generateComposition({ seed: "current-survives" });
    expect(useComposerStore.getState().projectSaveStatus).toBe("saving");
    expect(
      JSON.parse(localStorage.getItem(EDITOR_STORAGE_KEY) ?? "null")
        .composition.settings.seed,
    ).toBe("current-survives");

    await vi.runAllTimersAsync();

    expect(useComposerStore.getState().projectSaveStatus).toBe("partial");
    expect(localStorage.getItem(EDITOR_HISTORY_STORAGE_KEY)).toBeNull();
    expect(
      JSON.parse(localStorage.getItem(EDITOR_STORAGE_KEY) ?? "null")
        .composition.settings.seed,
    ).toBe("current-survives");
  });

  it("does not let an older durable job overwrite a newer session-only status", async () => {
    const nativeSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { useComposerStore } = await import("../src/state/editorStore");

    useComposerStore.getState().generateComposition({ seed: "durable-first" });
    setItem.mockImplementation(function setItemWithCurrentFailure(
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === EDITOR_STORAGE_KEY) {
        throw new Error("current storage unavailable");
      }
      nativeSetItem.call(this, key, value);
    });

    useComposerStore.getState().generateComposition({ seed: "session-latest" });
    expect(useComposerStore.getState().projectSaveStatus).toBe("session");
    expect(
      JSON.parse(localStorage.getItem(EDITOR_STORAGE_KEY) ?? "null")
        .composition.settings.seed,
    ).toBe("durable-first");

    await vi.runAllTimersAsync();

    expect(useComposerStore.getState().projectSaveStatus).toBe("session");
    expect(useComposerStore.getState().draftComposition.settings.seed)
      .toBe("session-latest");
  });

  it("recovers an active rename when the app closes before the idle history flush", async () => {
    const { useComposerStore } = await import("../src/state/editorStore");

    useComposerStore.getState().generateComposition({ seed: "rename-durable-base" });
    await vi.runAllTimersAsync();

    const active = useComposerStore.getState().history.at(-1)!;
    expect(useComposerStore.getState().renameHistoryEntry(active.id, "Renamed before close"))
      .toBe(true);

    // Simulate a new session before requestIdleCallback/setTimeout can write
    // the large history sidecar. The small current snapshot is already safe.
    const loaded = loadEditorSnapshotWithStatus(localStorage);
    expect(loaded.issue).toBe("history-session");
    expect(loaded.snapshot?.history[loaded.snapshot.historyIndex]?.name)
      .toBe("Renamed before close");
  });
});
