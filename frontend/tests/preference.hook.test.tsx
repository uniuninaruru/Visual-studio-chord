import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { usePreferenceProfile, type PreferenceProfileController } from "../src/hooks/usePreferenceProfile";
import {
  createPreferenceModel,
  updatePreferenceModel,
  type PreferenceFeedback,
  type PreferenceModel,
} from "../src/preference";
import type { PreferencePersistenceMode } from "../src/storage";

const features = {
  version: 2 as const,
  compositionId: "hook-test",
  harmony: { tension: 0.5 },
  melody: {},
  rhythm: {},
  voicing: {},
  combined: { "harmony.tension": 0.5 },
};

const storedFeedback: PreferenceFeedback = {
  type: "favorite",
  category: "combined",
  features,
};
const earlyFeedback: PreferenceFeedback = {
  type: "like",
  category: "combined",
  features,
};

interface DeferredStorage {
  mode: PreferencePersistenceMode;
  load(): Promise<PreferenceModel | null>;
  save(model: PreferenceModel): Promise<PreferencePersistenceMode>;
  importJson(json: string): Promise<PreferenceModel>;
  reset(): Promise<PreferencePersistenceMode>;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("usePreferenceProfile", () => {
  it("merges feedback recorded before IndexedDB finishes loading", async () => {
    let resolveLoad: (model: PreferenceModel | null) => void = () => undefined;
    const load = new Promise<PreferenceModel | null>((resolve) => {
      resolveLoad = resolve;
    });
    const saved: PreferenceModel[] = [];
    const storage: DeferredStorage = {
      mode: "indexedDB",
      load: () => load,
      save: async (model) => {
        saved.push(structuredClone(model));
        return "indexedDB";
      },
      importJson: async () => createPreferenceModel(),
      reset: async () => "indexedDB",
    };
    let controller: PreferenceProfileController | null = null;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    function Probe() {
      controller = usePreferenceProfile(storage);
      return null;
    }

    await act(async () => root.render(<Probe />));
    act(() => {
      controller!.record(earlyFeedback);
    });
    expect(controller!.model.categories.combined.feedbackCount).toBe(1);

    const stored = updatePreferenceModel(createPreferenceModel(), storedFeedback);
    await act(async () => {
      resolveLoad(stored);
      await load;
      await Promise.resolve();
    });

    expect(controller!.loaded).toBe(true);
    expect(controller!.model.categories.combined.feedbackCount).toBe(2);
    expect(saved.at(-1)?.categories.combined.feedbackCount).toBe(2);
    await act(async () => root.unmount());
  });

  it("serializes an import after an older queued feedback save", async () => {
    let releaseSave: () => void = () => undefined;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    let durableModel: PreferenceModel | null = createPreferenceModel();
    let importStarted = false;
    const imported = createPreferenceModel();
    imported.categories.combined.weights["harmony.tension"] = 0.9;
    const storage: DeferredStorage = {
      mode: "indexedDB",
      load: async () => createPreferenceModel(),
      save: async (model) => {
        await saveGate;
        durableModel = structuredClone(model);
        return "indexedDB";
      },
      importJson: async () => {
        importStarted = true;
        durableModel = structuredClone(imported);
        return structuredClone(imported);
      },
      reset: async () => "indexedDB",
    };
    let controller: PreferenceProfileController | null = null;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    function Probe() {
      controller = usePreferenceProfile(storage);
      return null;
    }

    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
    });
    act(() => { controller!.record(earlyFeedback); });
    let importPromise: Promise<void> = Promise.resolve();
    act(() => { importPromise = controller!.importJson("imported"); });
    await Promise.resolve();
    expect(importStarted).toBe(false);

    await act(async () => {
      releaseSave();
      await importPromise;
    });
    expect(importStarted).toBe(true);
    expect(durableModel).toEqual(imported);
    expect(controller!.model).toEqual(imported);
    await act(async () => root.unmount());
  });

  it("serializes reset after an older queued feedback save", async () => {
    let releaseSave: () => void = () => undefined;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    let durableModel: PreferenceModel | null = createPreferenceModel();
    let resetStarted = false;
    const storage: DeferredStorage = {
      mode: "indexedDB",
      load: async () => createPreferenceModel(),
      save: async (model) => {
        await saveGate;
        durableModel = structuredClone(model);
        return "indexedDB";
      },
      importJson: async () => createPreferenceModel(),
      reset: async () => {
        resetStarted = true;
        durableModel = null;
        return "indexedDB";
      },
    };
    let controller: PreferenceProfileController | null = null;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    function Probe() {
      controller = usePreferenceProfile(storage);
      return null;
    }

    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
    });
    act(() => { controller!.record(earlyFeedback); });
    let resetPromise: Promise<void> = Promise.resolve();
    act(() => { resetPromise = controller!.reset(); });
    await Promise.resolve();
    expect(resetStarted).toBe(false);

    await act(async () => {
      releaseSave();
      await resetPromise;
    });
    expect(resetStarted).toBe(true);
    expect(durableModel).toBeNull();
    expect(controller!.model).toEqual(createPreferenceModel());
    await act(async () => root.unmount());
  });
});
