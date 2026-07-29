import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendConnection } from "../src/api/inferenceTypes";
import type { HarmonyJobResponse } from "../src/api/inferenceTypes";
import type * as InferenceClientModule from "../src/api/inferenceClient";
import { useCandidateGeneration } from "../src/hooks/useCandidateGeneration";
import { createPreferenceModel } from "../src/preference";
import { useComposerStore } from "../src/state";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const apiMocks = vi.hoisted(() => ({
  createHarmonyRequestId: vi.fn(),
  startHarmonyGeneration: vi.fn(),
  getHarmonyJob: vi.fn(),
  cancelHarmonyGeneration: vi.fn(),
  rankCandidates: vi.fn(),
}));

vi.mock("../src/api/inferenceClient", async (importOriginal) => {
  const actual = await importOriginal<typeof InferenceClientModule>();
  return {
    ...actual,
    createHarmonyRequestId: apiMocks.createHarmonyRequestId,
    startHarmonyGeneration: apiMocks.startHarmonyGeneration,
    getHarmonyJob: apiMocks.getHarmonyJob,
    cancelHarmonyGeneration: apiMocks.cancelHarmonyGeneration,
    rankCandidates: apiMocks.rankCandidates,
  };
});

function failedJob(requestId = "hook-harmony-job"): HarmonyJobResponse {
  return {
    apiVersion: "2",
    requestId,
    state: "failed",
    stage: "Failed",
    progress: 100,
    elapsedMs: 8,
    modelId: "harmonyforge-bimask-base-v1",
    device: null,
    backend: "pytorch",
    dtype: null,
    mock: false,
    trained: true,
    checkpointSha256: "c".repeat(64),
    tokenizerSha256: "d".repeat(64),
    sourceCommit: null,
    batchSize: 1,
    candidateCount: 3,
    deterministic: true,
    cpuFallbackUsed: false,
    fallbackReason: null,
    stageTimingsMs: {},
    partialCandidateStored: false,
    candidates: [],
    error: {
      code: "INFERENCE_FAILED",
      message: "accelerator failed",
      compositionSafe: true,
      fallbackAvailable: true,
    },
  };
}

function queuedJob(requestId = "hook-harmony-job"): HarmonyJobResponse {
  return {
    ...failedJob(requestId),
    state: "queued",
    stage: "Queued",
    progress: 0,
    elapsedMs: 0,
    device: null,
    dtype: null,
    candidates: [],
    error: null,
  };
}

const backend: BackendConnection = {
  state: "connected",
  inferenceAuthorized: true,
  health: {
    apiVersion: "1",
    requestId: "health",
    status: "ok",
    service: "test",
    version: "0.4.0",
    pythonVersion: "3.12.13",
    platformSystem: "Darwin",
    platformMachine: "arm64",
    authRequired: true,
    inferenceAuthorized: true,
    activeModel: "harmony-corpus-ngram-v1",
    runtime: "cpu",
    backend: "corpus",
    mock: false,
    fallbackReason: null,
  },
  device: {
    apiVersion: "1",
    requestId: "device",
    selectedDevice: "mps",
    torchAvailable: true,
    onnxRuntimeAvailable: false,
    cudaAvailable: false,
    torchCudaAvailable: false,
    onnxCudaAvailable: false,
    mpsAvailable: true,
    coremlAvailable: false,
    directmlAvailable: false,
    deviceName: "Apple Silicon",
    cudaDeviceCount: 0,
    totalMemoryMb: null,
  },
  models: {
    apiVersion: "1",
    requestId: "models",
    activeModel: "harmony-corpus-ngram-v1",
    activeRuntime: "cpu",
    activeBackend: "corpus",
    mock: false,
    fallbackReason: null,
    models: [{
      id: "harmonyforge-bimask-base-v1",
      name: "HarmonyForge BiMask",
      runtime: "mps",
      available: true,
      loaded: false,
      capabilities: ["generateHarmony"],
      backend: "pytorch",
      mock: false,
    }],
  },
};

function Harness() {
  const [connection, setConnection] = useState<BackendConnection>(backend);
  const [, setScores] = useState<Record<string, number>>({});
  const [, setRuntime] = useState("browser-linear");
  const [, setRankInfo] = useState<null | {
    runtime: string;
    batchSize: number | null;
    fallback: string | null;
  }>(null);
  const [, setMetadata] = useState({});
  const generation = useCandidateGeneration({
    selectedBarRange: useComposerStore.getState().selectedBarRange,
    generatePreviewVariations: useComposerStore.getState().generatePreviewVariations,
    backend: connection,
    setBackend: setConnection,
    scheduleBackendRecovery: vi.fn(),
    preferenceModel: createPreferenceModel(),
    preferenceCategory: "combined",
    setServerScores: setScores,
    setRankingRuntime: setRuntime,
    setLastRankInfo: setRankInfo,
    setNeuralPreviewMetadata: setMetadata,
    onGenerated: vi.fn(),
    onToast: vi.fn(),
  });
  return (
    <div>
      <button type="button" id="chords" onClick={() => generation.setRegenerationTarget("chords")}>
        chords
      </button>
      <button type="button" id="generate" onClick={() => void generation.regenerate()}>
        generate
      </button>
      <button type="button" id="cancel" onClick={generation.cancel}>
        cancel
      </button>
      <span id="state">{generation.aiJob.state}</span>
      <span id="stage">{generation.aiJob.stage}</span>
      <span id="fallback">{generation.aiJob.fallbackReason}</span>
      <span id="retry">{String(generation.aiJob.canRetryOnCpu ?? false)}</span>
    </div>
  );
}

describe("useCandidateGeneration neural workflow", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    useComposerStore.getState().reset({ seed: "hook-neural" });
    useComposerStore.getState().setSelectedRange({ startBar: 0, endBar: 1 });
    apiMocks.createHarmonyRequestId.mockReset().mockReturnValue("hook-harmony-job");
    apiMocks.startHarmonyGeneration.mockReset().mockResolvedValue(failedJob());
    apiMocks.getHarmonyJob.mockReset();
    apiMocks.cancelHarmonyGeneration.mockReset().mockResolvedValue({
      ...failedJob(),
      state: "cancelRequested",
      stage: "Cancel requested",
    });
    apiMocks.rankCandidates.mockReset().mockImplementation(async (candidates: Array<{ id: string }>) => ({
      apiVersion: "1",
      requestId: "rank",
      ranked: candidates.map((candidate, index) => ({
        id: candidate.id,
        score: 1 - index * 0.1,
      })),
      device: "cpu",
      modelId: "harmony-corpus-ngram-v1",
      runtime: "cpu",
      batchSize: candidates.length,
      backend: "corpus",
      mock: false,
      fallbackReason: null,
    }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("falls back to theory without mutating the draft when neural inference fails", async () => {
    const before = structuredClone(useComposerStore.getState().draftComposition);
    act(() => root.render(<Harness />));
    act(() => host.querySelector<HTMLButtonElement>("#chords")?.click());
    await act(async () => {
      host.querySelector<HTMLButtonElement>("#generate")?.click();
      await new Promise((resolve) => globalThis.setTimeout(resolve, 40));
    });

    expect(apiMocks.startHarmonyGeneration).toHaveBeenCalledOnce();
    expect(apiMocks.startHarmonyGeneration.mock.calls[0]?.[0]).toMatchObject({
      apiVersion: "2",
      candidateCount: 3,
      preferredDevice: "auto",
      modelId: "harmonyforge-bimask-base-v1",
    });
    expect(host.querySelector("#state")?.textContent).toBe("completed");
    expect(host.querySelector("#stage")?.textContent).toBe("Complete");
    expect(host.querySelector("#fallback")?.textContent)
      .toContain("Neural inference failed · theory fallback");
    expect(host.querySelector("#retry")?.textContent).toBe("true");
    expect(useComposerStore.getState().previewVariations.length).toBeGreaterThan(0);
    expect(useComposerStore.getState().draftComposition).toEqual(before);
  });

  it("best-effort cancels a nonterminal server job after the client timeout", async () => {
    vi.useFakeTimers();
    apiMocks.startHarmonyGeneration.mockResolvedValue(queuedJob());
    apiMocks.getHarmonyJob.mockResolvedValue(queuedJob());
    act(() => root.render(<Harness />));
    act(() => host.querySelector<HTMLButtonElement>("#chords")?.click());

    await act(async () => {
      host.querySelector<HTMLButtonElement>("#generate")?.click();
      await vi.advanceTimersByTimeAsync(120_400);
    });

    expect(apiMocks.getHarmonyJob).toHaveBeenCalled();
    expect(apiMocks.cancelHarmonyGeneration)
      .toHaveBeenCalledExactlyOnceWith("hook-harmony-job");
  });

  it("best-effort cancels when polling fails after the server accepted the job", async () => {
    vi.useFakeTimers();
    apiMocks.startHarmonyGeneration.mockResolvedValue(queuedJob());
    apiMocks.getHarmonyJob.mockRejectedValue(new Error("connection dropped"));
    act(() => root.render(<Harness />));
    act(() => host.querySelector<HTMLButtonElement>("#chords")?.click());

    await act(async () => {
      host.querySelector<HTMLButtonElement>("#generate")?.click();
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(apiMocks.cancelHarmonyGeneration)
      .toHaveBeenCalledExactlyOnceWith("hook-harmony-job");
  });

  it("cancels a replaced job once and ignores its late cancellation response", async () => {
    let resolveOldCancellation: ((job: HarmonyJobResponse) => void) | undefined;
    apiMocks.createHarmonyRequestId
      .mockReturnValueOnce("old-job")
      .mockReturnValueOnce("new-job");
    apiMocks.startHarmonyGeneration.mockImplementation(async (request) =>
      request.requestId === "old-job"
        ? queuedJob("old-job")
        : failedJob("new-job")
    );
    apiMocks.cancelHarmonyGeneration.mockImplementation(
      () => new Promise<HarmonyJobResponse>((resolve) => {
        resolveOldCancellation = resolve;
      }),
    );
    act(() => root.render(<Harness />));
    act(() => host.querySelector<HTMLButtonElement>("#chords")?.click());
    await act(async () => {
      host.querySelector<HTMLButtonElement>("#generate")?.click();
      await Promise.resolve();
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>("#generate")?.click();
      await new Promise((resolve) => globalThis.setTimeout(resolve, 40));
    });

    expect(apiMocks.cancelHarmonyGeneration)
      .toHaveBeenCalledExactlyOnceWith("old-job");
    expect(host.querySelector("#state")?.textContent).toBe("completed");

    await act(async () => {
      resolveOldCancellation?.({
        ...queuedJob("old-job"),
        state: "cancelRequested",
        stage: "Cancel requested",
      });
      await Promise.resolve();
    });
    expect(host.querySelector("#state")?.textContent).toBe("completed");
  });

  it("best-effort cancels a nonterminal server job when the hook unmounts", async () => {
    apiMocks.startHarmonyGeneration.mockResolvedValue(queuedJob());
    apiMocks.getHarmonyJob.mockResolvedValue(queuedJob());
    act(() => root.render(<Harness />));
    act(() => host.querySelector<HTMLButtonElement>("#chords")?.click());
    await act(async () => {
      host.querySelector<HTMLButtonElement>("#generate")?.click();
      await Promise.resolve();
    });

    await act(async () => {
      root.render(null);
      await Promise.resolve();
    });

    expect(apiMocks.cancelHarmonyGeneration)
      .toHaveBeenCalledExactlyOnceWith("hook-harmony-job");
  });

  it("aborts polling, sends server cancellation, and never publishes a partial candidate", async () => {
    apiMocks.startHarmonyGeneration.mockImplementation(
      (_request: unknown, signal?: AbortSignal) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("cancelled", "AbortError"));
        }, { once: true });
      }),
    );
    const before = structuredClone(useComposerStore.getState().draftComposition);
    act(() => root.render(<Harness />));
    act(() => host.querySelector<HTMLButtonElement>("#chords")?.click());
    await act(async () => {
      host.querySelector<HTMLButtonElement>("#generate")?.click();
      await Promise.resolve();
    });
    expect(apiMocks.startHarmonyGeneration).toHaveBeenCalledOnce();

    await act(async () => {
      host.querySelector<HTMLButtonElement>("#cancel")?.click();
      await Promise.resolve();
    });

    expect(apiMocks.cancelHarmonyGeneration).toHaveBeenCalledWith("hook-harmony-job");
    expect(host.querySelector("#state")?.textContent).toBe("cancelled");
    expect(useComposerStore.getState().previewVariations).toEqual([]);
    expect(useComposerStore.getState().draftComposition).toEqual(before);
  });
});
