import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiagnosticsPanel, type BackendDiagnostics } from "../src/features/diagnostics";
import type { BrowserCapabilities } from "../src/platform";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const browserCapabilities: BrowserCapabilities = {
  checkedAt: "2026-07-22T00:00:00.000Z",
  networkStatus: "offline",
  capabilities: {
    webAudio: { id: "webAudio", label: "Web Audio", status: "available", available: true, detail: "利用できます。" },
    audioWorklet: { id: "audioWorklet", label: "AudioWorklet", status: "unavailable", available: false, detail: "利用できません。", remedy: "基本再生を使用してください。" },
    indexedDb: { id: "indexedDb", label: "IndexedDB", status: "available", available: true, detail: "利用できます。" },
    fileSystemAccess: { id: "fileSystemAccess", label: "File System Access", status: "unavailable", available: false, detail: "利用できません。", remedy: "通常のダウンロードを使用してください。" },
    webMidi: { id: "webMidi", label: "Web MIDI", status: "unavailable", available: false, detail: "利用できません。", remedy: "MIDIファイルを使用してください。" },
    webSocket: { id: "webSocket", label: "WebSocket", status: "available", available: true, detail: "利用できます。" },
    webAssembly: { id: "webAssembly", label: "WebAssembly", status: "available", available: true, detail: "利用できます。" },
    webGpu: { id: "webGpu", label: "WebGPU", status: "unavailable", available: false, detail: "利用できません。", remedy: "CPUを使用してください。" },
  },
};

const backend: BackendDiagnostics = {
  connection: "disconnected",
  device: null,
  inferenceBackend: "Browser theory-only",
  models: [],
  apiCompatibility: "unknown",
};

describe("DiagnosticsPanel", () => {
  let host: HTMLDivElement;
  let root: Root;
  let opener: HTMLButtonElement;
  const onClose = vi.fn();

  beforeEach(() => {
    opener = document.createElement("button");
    opener.textContent = "Open diagnostics";
    document.body.append(opener);
    opener.focus();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    onClose.mockReset();

    act(() => {
      root.render(
        <DiagnosticsPanel
          browserCapabilities={browserCapabilities}
          backend={backend}
          projectStorageMode="localStorage"
          historyStorageMode="memory"
          preferenceStorageMode="indexeddb"
          onRetry={vi.fn()}
          onClose={onClose}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    opener.remove();
  });

  it("provides an accessible modal, actionable fallbacks, and initial focus", () => {
    const dialog = host.querySelector<HTMLElement>("[role='dialog']");
    const closeButton = host.querySelector<HTMLButtonElement>("[aria-label='環境診断を閉じる']");

    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(closeButton).toBe(document.activeElement);
    expect(host.textContent).toContain("オフラインでも生成・再生・編集・保存を続けられます");
    expect(host.textContent).toContain("モデルなしでもブラウザ / 理論ベース生成を利用できます");
    expect(host.textContent).toContain("現在のプロジェクトlocalStorage");
    expect(host.textContent).toContain("Undo履歴セッション内メモリ");
    expect(host.textContent).toContain("好み学習IndexedDB");
    expect(host.textContent).toContain("Frontend Node.js");
    expect(host.textContent).toContain("Server Pythonサーバー未接続");
    expect(host.textContent).toContain("対処:");
  });

  it("closes on Escape and traps Tab focus inside the dialog", () => {
    const buttons = host.querySelectorAll<HTMLButtonElement>("button");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    expect(first).toBeTruthy();
    expect(last).toBeTruthy();
    last?.focus();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(first);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("restores focus to the opener when unmounted", () => {
    act(() => root.unmount());
    expect(document.activeElement).toBe(opener);
    root = createRoot(host);
  });

  it("shows HarmonyForge checkpoint/mock rows and last-job provenance", () => {
    act(() => {
      root.render(
        <DiagnosticsPanel
          browserCapabilities={browserCapabilities}
          backend={{
            connection: "connected",
            device: "Apple Silicon",
            inferenceBackend: "harmony-corpus-ngram-v1 / cpu",
            apiCompatibility: "compatible",
            models: [
              {
                id: "harmonyforge-bimask-base-v1",
                name: "HarmonyForge BiMask",
                status: "missing",
                detail: "mps · capability: generateHarmony · trained checkpoint missing",
              },
              {
                id: "mock-harmonyforge-bimask-v1",
                name: "HarmonyForge Mock",
                status: "ready",
                detail: "cpu · capability: generateHarmony · explicit Mock · untrained",
              },
            ],
            lastHarmonyJob: {
              modelId: "mock-harmonyforge-bimask-v1",
              stage: "Complete",
              device: "CPU",
              backend: "mock / float32",
              checkpoint: "checkpointなし",
              candidateSummary: "3候補 · batch 1",
              mock: true,
              trained: false,
              fallback: "Theory fallback",
            },
          }}
          projectStorageMode="localStorage"
          historyStorageMode="memory"
          preferenceStorageMode="indexeddb"
          onRetry={vi.fn()}
          onClose={onClose}
        />,
      );
    });

    expect(host.textContent).toContain("trained checkpoint missing");
    expect(host.textContent).toContain("explicit Mock · untrained");
    expect(host.textContent).toContain("Last Harmony jobMock / untrained · Complete");
    expect(host.textContent).toContain("CPU · mock / float32 · checkpointなし · 3候補 · batch 1");
  });
});
