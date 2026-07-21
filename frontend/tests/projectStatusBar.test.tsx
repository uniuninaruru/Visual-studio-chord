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
          loopLabel="全体ループ"
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
    expect(host.textContent).toContain("Loop全体ループ");
    expect(host.textContent).toContain(
      "Edited · Apply at next bar · Pending loop: 1–1 小節ループ",
    );
  });
});
