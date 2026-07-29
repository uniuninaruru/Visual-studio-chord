import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelHarmonyGeneration,
  detectLocalBackend,
  getHarmonyJob,
  rankCandidates,
  startHarmonyGeneration,
} from "../src/api/inferenceClient";
import type {
  HarmonyGenerateRequest,
  HarmonyJobResponse,
} from "../src/api/inferenceTypes";

const SESSION_KEY = "music-theory-composer:lan-access";

function request(): HarmonyGenerateRequest {
  return {
    apiVersion: "2",
    requestId: "harmony-client-test",
    modelId: "harmonyforge-bimask-base-v1",
    seed: "client-test",
    candidateCount: 3,
    preferredDevice: "auto",
    allowCpuFallback: true,
    melody: [],
    existingHarmony: [{
      startTick: 0,
      durationTick: 1_920,
      rootOffsetFromKey: 0,
      quality: "major",
      inversion: 0,
      bassOffsetFromRoot: 0,
      extensions: [],
      locked: false,
    }],
    generationMask: [{ startTick: 0, endTick: 1_920, mode: "generate" }],
    tonalities: [{ startTick: 0, endTick: 1_920, keyRoot: 0, mode: "major" }],
    controls: {
      ppq: 480,
      ticksPerBar: 1_920,
      timeSignature: "4/4",
      startTick: 0,
      endTick: 1_920,
    },
  };
}

function job(
  state: HarmonyJobResponse["state"] = "queued",
  stage: HarmonyJobResponse["stage"] = "Queued",
): HarmonyJobResponse {
  return {
    apiVersion: "2",
    requestId: "harmony-client-test",
    state,
    stage,
    progress: state === "completed" ? 100 : 0,
    elapsedMs: 0,
    modelId: "harmonyforge-bimask-base-v1",
    // A real queued job has not probed the device yet.
    device: null,
    backend: "pytorch",
    dtype: null,
    mock: false,
    trained: true,
    checkpointSha256: "a".repeat(64),
    tokenizerSha256: "b".repeat(64),
    sourceCommit: null,
    batchSize: 1,
    candidateCount: 3,
    deterministic: true,
    cpuFallbackUsed: false,
    fallbackReason: null,
    stageTimingsMs: {},
    partialCandidateStored: false,
    candidates: [],
    error: null,
  };
}

describe("v2 harmony inference client", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.sessionStorage.setItem(SESSION_KEY, "0123456789abcdef0123456789abcdef");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps v2 separate from discovery v1 and sends explicit A/B/C/device controls", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return {
        ok: true,
        json: async () => job(),
        status: 202,
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(startHarmonyGeneration(request())).resolves.toMatchObject({
      apiVersion: "2",
      requestId: "harmony-client-test",
      device: null,
      dtype: null,
    });

    expect(calls[0]?.input).toBe("/api/v2/harmony/generate");
    const init = calls[0]?.init;
    expect(init?.headers).toMatchObject({
      "X-MTC-Token": "0123456789abcdef0123456789abcdef",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      apiVersion: "2",
      requestId: "harmony-client-test",
      candidateCount: 3,
      preferredDevice: "auto",
    });
  });

  it("polls and cancels the same correlated job id", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return {
        ok: true,
        json: async () => String(input).includes("/cancel/")
          ? job("cancelRequested", "Cancel requested")
          : job("running", "Encoding"),
        status: 200,
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getHarmonyJob("harmony-client-test")).resolves.toMatchObject({
      state: "running",
      stage: "Encoding",
    });
    await expect(cancelHarmonyGeneration("harmony-client-test")).resolves.toMatchObject({
      state: "cancelRequested",
    });

    expect(calls[0]?.input).toBe("/api/v2/jobs/harmony-client-test");
    expect(calls[1]?.input)
      .toBe("/api/v2/harmony/cancel/harmony-client-test");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      apiVersion: "2",
      requestId: "harmony-client-test",
    });
  });

  it("rejects malformed or uncorrelated v2 responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...job(), requestId: "different-job" }),
      status: 200,
    }) as Response));

    await expect(getHarmonyJob("harmony-client-test")).rejects.toThrow(
      /unexpected request ID/,
    );
  });

  it("accepts generateHarmony discovery rows without changing the v1 health envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      const shared = { apiVersion: "1", requestId: path };
      const payload = path.endsWith("/api/health")
        ? {
            ...shared,
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
          }
        : path.endsWith("/api/device")
          ? {
              ...shared,
              selectedDevice: "cpu",
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
            }
          : {
              ...shared,
              activeModel: "harmony-corpus-ngram-v1",
              activeRuntime: "cpu",
              activeBackend: "corpus",
              mock: false,
              fallbackReason: null,
            models: [{
              id: "harmonyforge-bimask-base-v1",
              name: "HarmonyForge BiMask",
              runtime: null,
              available: false,
                loaded: false,
                capabilities: ["generateHarmony"],
                backend: "pytorch",
                mock: false,
              }],
            };
      return { ok: true, json: async () => payload } as Response;
    }));

    await expect(detectLocalBackend()).resolves.toMatchObject({
      state: "connected",
      models: {
        models: [{ runtime: null, capabilities: ["generateHarmony"] }],
      },
    });
  });

  it("bounds combined ranking features to the server contract deterministically", async () => {
    const sentBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sentBodies.push(sentBody);
      return {
        ok: true,
        json: async () => ({
          apiVersion: "1",
          requestId: sentBody.requestId,
          ranked: [{ id: "candidate-a", score: 0 }],
          device: "cpu",
          modelId: "local-deterministic-v1",
          runtime: "cpu",
          batchSize: 1,
          backend: "linear",
          mock: false,
          fallbackReason: null,
        }),
        status: 200,
      } as Response;
    }));
    const features = Object.fromEntries(
      Array.from({ length: 160 }, (_, index) => [
        `combined.feature.${index.toString().padStart(3, "0")}`,
        index / 160,
      ]),
    );
    const preferenceWeights = {
      "combined.feature.159": 1,
      "combined.feature.158": -0.9,
    };

    await expect(rankCandidates(
      [{ id: "candidate-a", features }],
      preferenceWeights,
    )).resolves.toMatchObject({ runtime: "cpu" });

    const sentCandidates = sentBodies[0]?.candidates as Array<{
      features: Record<string, number>;
    }>;
    const sentWeights = sentBodies[0]?.preferenceWeights as Record<string, number>;
    expect(Object.keys(sentCandidates[0]!.features)).toHaveLength(128);
    expect(sentCandidates[0]!.features).toHaveProperty("combined.feature.159");
    expect(sentCandidates[0]!.features).toHaveProperty("combined.feature.158");
    expect(sentWeights).toEqual(preferenceWeights);
  });

  it("guards generated OpenAPI for async v2 endpoints and nullable probe fields", () => {
    const openApi = JSON.parse(readFileSync(
      resolve(process.cwd(), "../backend/openapi.json"),
      "utf8",
    )) as {
      paths: Record<string, unknown>;
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    };
    expect(openApi.paths).toHaveProperty("/api/v2/harmony/generate");
    expect(openApi.paths).toHaveProperty("/api/v2/jobs/{request_id}");
    expect(openApi.paths).toHaveProperty("/api/v2/harmony/cancel/{request_id}");
    expect(openApi.components.schemas.HarmonyGenerateRequest?.properties)
      .toHaveProperty("preferredDevice");
    expect(openApi.components.schemas.HarmonyJobResponse?.properties)
      .toHaveProperty("device");
    expect(openApi.components.schemas.ModelInfo?.properties)
      .toHaveProperty("capabilities");
  });
});
