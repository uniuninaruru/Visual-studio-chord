import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportCompositionJson } from "../src/features/export";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import { EDITOR_STORAGE_KEY } from "../src/storage";

describe("persisted project recovery guard", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("does not overwrite an invalid stored project until the user imports a replacement", async () => {
    const invalidStoredProject = "{broken-project";
    localStorage.setItem(EDITOR_STORAGE_KEY, invalidStoredProject);
    const { useComposerStore } = await import("../src/state/editorStore");

    expect(useComposerStore.getState().projectPersistenceBlocked).toBe(true);
    expect(useComposerStore.getState().projectSaveStatus).toBe("recovery");

    useComposerStore.getState().generateComposition({ seed: "must-not-overwrite" });
    expect(useComposerStore.getState().projectSaveStatus).toBe("recovery");
    expect(localStorage.getItem(EDITOR_STORAGE_KEY)).toBe(invalidStoredProject);

    const replacement = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      seed: "explicit-replacement",
    });
    useComposerStore.getState().importJson(exportCompositionJson(replacement));
    expect(useComposerStore.getState().projectPersistenceBlocked).toBe(false);
    expect(useComposerStore.getState().projectSaveStatus).toBe("saving");
    await vi.waitFor(() => {
      expect(useComposerStore.getState().projectSaveStatus).toBe("saved");
    });
    expect(localStorage.getItem(EDITOR_STORAGE_KEY)).not.toBe(invalidStoredProject);
  });

  it("does not overwrite a project from a newer schema version", async () => {
    const composition = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      seed: "future-project",
    });
    const futureStoredProject = JSON.stringify({
      version: 999,
      settings: composition.settings,
      composition,
      selectedBarRange: null,
      loopRange: { startTick: 0, endTick: composition.totalTicks },
      lockedBars: [],
      updateTiming: "nextBar",
      history: [{
        id: "future-history",
        action: "generate",
        timestamp: "2026-07-22T00:00:00.000Z",
        seed: "future-project",
        range: null,
        composition,
      }],
      historyIndex: 0,
      regenerationIteration: 0,
    });
    localStorage.setItem(EDITOR_STORAGE_KEY, futureStoredProject);
    const { useComposerStore } = await import("../src/state/editorStore");

    expect(useComposerStore.getState().projectRecoveryReason).toBe("unsupported");
    expect(useComposerStore.getState().projectPersistenceBlocked).toBe(true);

    useComposerStore.getState().generateComposition({ seed: "must-not-downgrade" });
    expect(localStorage.getItem(EDITOR_STORAGE_KEY)).toBe(futureStoredProject);
    expect(useComposerStore.getState().projectSaveStatus).toBe("recovery");
  });
});
