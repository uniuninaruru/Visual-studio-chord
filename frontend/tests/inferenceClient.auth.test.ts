import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureLocalAccessToken,
  detectLocalBackend,
  isLocalConnectivityError,
  rankCandidates,
  updateServerPreference,
} from "../src/api/inferenceClient";

const SESSION_KEY = "music-theory-composer:lan-access";

describe("local inference LAN credential", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("captures a valid fragment credential, removes it from the URL, and authenticates POSTs", async () => {
    const token = "0123456789abcdef0123456789abcdef";
    window.history.replaceState(null, "", `/#access=${token}&panel=developer`);

    expect(captureLocalAccessToken()).toBe(true);
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBe(token);
    expect(window.location.hash).toBe("#panel=developer");

    const fetchMock = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { requestId: string; apiVersion: string };
      return {
        ok: true,
        json: async () => ({
          apiVersion: "1",
          requestId: request.requestId,
          weights: {},
          evaluationCount: 1,
          confidence: 0.1,
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await updateServerPreference("chords", "like", { tension: 0.5 });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ "X-MTC-Token": token });
    expect(JSON.parse(String(init?.body))).toMatchObject({ apiVersion: "1" });
  });

  it("does not retain malformed or short fragment credentials", () => {
    window.history.replaceState(null, "", "/#access=too-short");
    expect(captureLocalAccessToken()).toBe(false);
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("reports a connected server but keeps inference in browser mode until access is present", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      const shared = { apiVersion: "1", requestId: `response-${path}` };
      const payload = path.endsWith("/api/health")
        ? {
            ...shared,
            status: "ok",
            service: "test",
            version: "0.3.0",
            pythonVersion: "3.12.13",
            platformSystem: "Darwin",
            platformMachine: "arm64",
            authRequired: true,
            inferenceAuthorized: false,
            activeModel: "harmony-corpus-ngram-v1",
            runtime: "cpu",
            backend: "corpus",
            mock: false,
            fallbackReason: null,
          }
        : path.endsWith("/api/device")
          ? {
              ...shared,
              selectedDevice: "cpu",
              torchAvailable: false,
              onnxRuntimeAvailable: false,
              cudaAvailable: false,
              torchCudaAvailable: false,
              onnxCudaAvailable: false,
              mpsAvailable: false,
              coremlAvailable: false,
              directmlAvailable: false,
              deviceName: "CPU",
              cudaDeviceCount: 0,
              totalMemoryMb: null,
            }
          : {
              ...shared,
              models: [],
              activeModel: "harmony-corpus-ngram-v1",
              activeRuntime: "cpu",
              activeBackend: "corpus",
              mock: false,
              fallbackReason: null,
            };
      return { ok: true, json: async () => payload } as Response;
    }));

    const connection = await detectLocalBackend();
    expect(connection.state).toBe("connected");
    if (connection.state === "connected") {
      expect(connection.inferenceAuthorized).toBe(false);
      expect(connection.health.authRequired).toBe(true);
    }
  });

  it("falls back safely when the server API version is incompatible", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      const payload = path.endsWith("/api/health")
        ? { apiVersion: "2", requestId: "health", status: "ok" }
        : path.endsWith("/api/device")
          ? { apiVersion: "1", requestId: "device" }
          : { apiVersion: "1", requestId: "models" };
      return { ok: true, json: async () => payload } as Response;
    }));

    await expect(detectLocalBackend()).resolves.toMatchObject({
      state: "browser",
      reason: "api-mismatch",
    });
  });

  it("rejects a response correlated to a different request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        apiVersion: "1",
        requestId: "wrong-request",
        ranked: [],
        device: "cpu",
        modelId: "local-deterministic-v1",
        runtime: "cpu",
        batchSize: 1,
        backend: "linear",
        mock: false,
      }),
    }) as Response));

    await expect(rankCandidates([{ id: "one", features: {} }], {})).rejects.toThrow(
      /unexpected request ID/,
    );
  });

  it("sends the selected preference category when ranking", async () => {
    const fetchMock = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        requestId: string;
        preferenceCategory: string;
      };
      return {
        ok: true,
        json: async () => ({
          apiVersion: "1",
          requestId: request.requestId,
          ranked: [],
          device: "cpu",
          modelId: "local-deterministic-v1",
          runtime: "cpu",
          batchSize: 1,
          backend: "linear",
          mock: false,
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await rankCandidates([{ id: "one", features: {} }], {}, "rhythm");

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(request.preferenceCategory).toBe("rhythm");
  });

  it("classifies a code-less gateway response as a connectivity failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("HTML proxy response");
      },
    }) as unknown as Response));

    const error = await rankCandidates([{ id: "one", features: {} }], {}).catch(
      (reason: unknown) => reason,
    );

    expect(isLocalConnectivityError(error)).toBe(true);
  });

  it("does not classify a coded backend 503 as a connectivity failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({
        apiVersion: "1",
        requestId: "unavailable",
        success: false,
        error: { code: "SERVICE_UNAVAILABLE", message: "Model is unavailable." },
      }),
    }) as unknown as Response));

    const error = await rankCandidates([{ id: "one", features: {} }], {}).catch(
      (reason: unknown) => reason,
    );

    expect(error).toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE" });
    expect(isLocalConnectivityError(error)).toBe(false);
  });

  it("rejects malformed version-one discovery payloads instead of crashing the UI", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ apiVersion: "1", requestId: "malformed" }),
    }) as Response));

    await expect(detectLocalBackend()).resolves.toMatchObject({
      state: "browser",
      reason: "api-mismatch",
    });
  });

  it("clears a stale LAN credential after a protected request is rejected", async () => {
    const token = "stale-token-0123456789abcdef";
    window.history.replaceState(null, "", `/#access=${token}`);
    expect(captureLocalAccessToken()).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({
        apiVersion: "1",
        requestId: "forbidden",
        success: false,
        error: { code: "INVALID_AUTHENTICATION_TOKEN", message: "Access denied." },
      }),
    }) as Response));

    await expect(rankCandidates([{ id: "one", features: {} }], {})).rejects.toMatchObject({
      status: 403,
      code: "INVALID_AUTHENTICATION_TOKEN",
    });
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });
});
