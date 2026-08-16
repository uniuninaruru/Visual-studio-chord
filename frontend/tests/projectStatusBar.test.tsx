import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProjectStatusBar,
  type AiJobStatus,
} from "../src/features/status/ProjectStatusBar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const idleJob: AiJobStatus = {
  state: "idle",
  label: "Ready",
  stage: "Idle",
  progress: 0,
  startedAt: null,
  device: "browser",
  backend: "browser-linear",
};

describe("ProjectStatusBar", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("keeps the audible loop visible and labels a different draft loop as pending", () => {
    act(() => {
      root.render(
        <ProjectStatusBar
          playback="playing"
          currentTick={1_440}
          ticksPerBar={1_920}
          pendingLoopLabel="1–1 小節ループ"
          pendingCommit
          updateTiming="nextBar"
          aiJob={idleJob}
          engineLabel="Browser / Theory-only"
          saveStatus="unsaved"
          lastSavedAt={null}
          online={false}
          connectionLabel="Browser mode"
          onCancelAi={vi.fn()}
          onOpenDiagnostics={vi.fn()}
        />,
      );
    });

    expect(host.textContent).toContain("Playing · Bar 1");
    // No Loop item: App renders the same string into the transport bar forty
    // pixels above this row, from the same variable, and two readouts of one
    // value both on screen is a column spent repeating the row above. The
    // PENDING loop is a different value and stays.
    expect(host.textContent).not.toContain("Loop全体ループ");
    expect(host.textContent).toContain(
      "Edited · Apply at next bar · Pending loop: 1–1 小節ループ",
    );
  });

  it("does not claim CPU before device probing and exposes cancellable progress", () => {
    const onCancelAi = vi.fn();
    act(() => {
      root.render(
        <ProjectStatusBar
          playback="playing"
          currentTick={0}
          ticksPerBar={1_920}
          pendingCommit={false}
          updateTiming="nextBar"
          aiJob={{
            state: "running",
            label: "Neural harmony preview",
            stage: "Loading checkpoint",
            progress: 5,
            startedAt: Date.now(),
            elapsedMs: 420,
            device: null,
            backend: "pytorch",
            modelId: "harmonyforge-bimask-base-v1",
            dtype: null,
            mock: false,
            trained: true,
            checkpointSha256: "abcdef0123456789",
            candidateCount: 3,
            batchSize: 1,
          }}
          engineLabel="Neural Harmony / Detecting device…"
          saveStatus="saved"
          lastSavedAt={null}
          online
          connectionLabel="Local server connected"
          onCancelAi={onCancelAi}
          onOpenDiagnostics={vi.fn()}
        />,
      );
    });

    expect(host.textContent).toContain("Loading checkpoint · 5% · 0.4s");
    expect(host.textContent).toContain("Detecting device…");
    expect(host.textContent).not.toContain("CPU");
    expect(host.textContent).toContain("3候補 · batch 1");
    act(() => host.querySelector<HTMLButtonElement>(".ai-status button")?.click());
    expect(onCancelAi).toHaveBeenCalledOnce();
  });

  it("marks explicit mock/untrained provenance and offers a real CPU retry", () => {
    const onRetry = vi.fn();
    act(() => {
      root.render(
        <ProjectStatusBar
          playback="stopped"
          currentTick={0}
          ticksPerBar={1_920}
          pendingCommit={false}
          updateTiming="nextBar"
          aiJob={{
            state: "completed",
            label: "3 previews ready · theory fallback",
            stage: "Complete",
            progress: 100,
            startedAt: Date.now(),
            elapsedMs: 50,
            device: "cpu",
            backend: "mock",
            modelId: "mock-harmonyforge-bimask-v1",
            dtype: "float32",
            mock: true,
            trained: false,
            checkpointSha256: null,
            candidateCount: 3,
            batchSize: 1,
            fallbackReason: "Accelerator failed · theory fallback",
            canRetryOnCpu: true,
          }}
          engineLabel="Browser / Theory fallback"
          saveStatus="saved"
          lastSavedAt={null}
          online
          connectionLabel="Local server connected"
          onCancelAi={vi.fn()}
          onRetryAiOnCpu={onRetry}
          onOpenDiagnostics={vi.fn()}
        />,
      );
    });

    expect(host.textContent).toContain("Mock / untrained");
    expect(host.textContent).toContain("No checkpoint");
    expect(host.textContent).toContain("Theory fallback");
    const retry = [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "CPUで再試行");
    act(() => retry?.click());
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
