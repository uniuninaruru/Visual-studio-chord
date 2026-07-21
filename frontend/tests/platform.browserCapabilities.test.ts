import { describe, expect, it, vi } from "vitest";
import { detectBrowserCapabilities } from "../src/platform";

describe("detectBrowserCapabilities", () => {
  it("is safe without browser globals and reports unavailable APIs", async () => {
    const capabilities = await detectBrowserCapabilities({});

    expect(capabilities.networkStatus).toBe("unknown");
    expect(capabilities.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const capability of Object.values(capabilities.capabilities)) {
      expect(capability.available).toBe(false);
      expect(capability.remedy).toBeTruthy();
    }
  });

  it("does not infer support from object presence without callable APIs", async () => {
    const capabilities = await detectBrowserCapabilities({
      navigator: {
        onLine: false,
        requestMIDIAccess: {},
        gpu: { requestAdapter: "not callable" },
      },
      indexedDB: { open: true },
      showOpenFilePicker: {},
      WebSocket: {},
      WebAssembly: { validate: true, Module: {} },
      AudioContext: {},
    });

    expect(capabilities.networkStatus).toBe("offline");
    expect(capabilities.capabilities.webMidi.status).toBe("unavailable");
    expect(capabilities.capabilities.webGpu.status).toBe("unavailable");
    expect(capabilities.capabilities.indexedDb.status).toBe("unavailable");
    expect(capabilities.capabilities.fileSystemAccess.status).toBe("unavailable");
    expect(capabilities.capabilities.webSocket.status).toBe("unavailable");
    expect(capabilities.capabilities.webAssembly.status).toBe("unavailable");
    expect(capabilities.capabilities.webAudio.status).toBe("unavailable");
  });

  it("constructs Web Audio and requests a WebGPU adapter before reporting availability", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const addModule = vi.fn();
    const requestAdapter = vi.fn().mockResolvedValue({ name: "test-adapter" });
    class TestAudioContext {
      audioWorklet = { addModule };
      close = close;
    }
    class TestWebSocket {
      send() {}
      close() {}
    }

    const capabilities = await detectBrowserCapabilities({
      navigator: { onLine: true, requestMIDIAccess: vi.fn(), gpu: { requestAdapter } },
      AudioContext: TestAudioContext,
      showOpenFilePicker: vi.fn(),
      WebSocket: TestWebSocket,
      WebAssembly,
    });

    expect(capabilities.networkStatus).toBe("online");
    expect(capabilities.capabilities.webAudio.status).toBe("available");
    expect(capabilities.capabilities.audioWorklet.status).toBe("available");
    expect(capabilities.capabilities.webGpu.status).toBe("available");
    expect(capabilities.capabilities.webSocket.status).toBe("available");
    expect(capabilities.capabilities.webAssembly.status).toBe("available");
    expect(requestAdapter).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
