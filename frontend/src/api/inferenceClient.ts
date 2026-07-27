import type {
  BackendConnection,
  DeviceResponse,
  HealthResponse,
  ModelsResponse,
  PreferenceUpdateResponse,
  RankCandidate,
  RankResponse,
  ServerPreferenceCategory,
  ServerPreferenceFeedback,
} from "./inferenceTypes";

const API_TIMEOUT_MS = 1_600;
const INFERENCE_TIMEOUT_MS = 30_000;
const ACCESS_TOKEN_SESSION_KEY = "music-theory-composer:lan-access";
const API_VERSION = "1";
let requestSequence = 0;

export class LocalApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`Local API request failed (${status}${code ? ` · ${code}` : ""}).`);
    this.name = "LocalApiError";
  }
}

export function isLocalAccessError(error: unknown): error is LocalApiError {
  return error instanceof LocalApiError && (error.status === 401 || error.status === 403);
}

export function isLocalConnectivityError(error: unknown): error is LocalApiError {
  return error instanceof LocalApiError
    && error.code === null
    && [500, 502, 503].includes(error.status);
}

function createRequestId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // A monotonic, non-security fallback still provides request correlation.
  }
  requestSequence += 1;
  return `web-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
}

function accessToken(): string | null {
  try {
    const token = window.sessionStorage.getItem(ACCESS_TOKEN_SESSION_KEY);
    return token && /^[A-Za-z0-9_-]{16,512}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

function clearLocalAccessToken(): void {
  try {
    window.sessionStorage.removeItem(ACCESS_TOKEN_SESSION_KEY);
  } catch {
    // The UI still falls back safely when session storage is blocked.
  }
}

export function hasLocalAccessToken(): boolean {
  return accessToken() !== null;
}

function requestHeaders(): Record<string, string> {
  const token = accessToken();
  return token ? { "X-MTC-Token": token } : {};
}

/** Captures a LAN credential from the URL fragment without sending it as a referrer. */
export function captureLocalAccessToken(): boolean {
  try {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = fragment.get("access");
    if (!token || !/^[A-Za-z0-9_-]{16,512}$/.test(token)) return false;
    window.sessionStorage.setItem(ACCESS_TOKEN_SESSION_KEY, token);
    fragment.delete("access");
    const remaining = fragment.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${remaining ? `#${remaining}` : ""}`,
    );
    return true;
  } catch {
    return false;
  }
}

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: "GET",
    headers: { Accept: "application/json", ...requestHeaders() },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Local API responded with ${response.status}.`);
  }
  return (await response.json()) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const RUNTIMES = new Set(["cpu", "cuda", "mps", "coreml", "directml"]);
const MODEL_RUNTIMES = new Set(["browser", ...RUNTIMES]);
const BACKENDS = new Set(["linear", "corpus", "pytorch", "onnx", "browser", "mock"]);

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function hasApiEnvelope(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.apiVersion === API_VERSION && typeof value.requestId === "string";
}

function isHealthResponse(value: unknown): value is HealthResponse {
  return hasApiEnvelope(value)
    && value.status === "ok"
    && typeof value.service === "string"
    && typeof value.version === "string"
    && typeof value.pythonVersion === "string"
    && typeof value.platformSystem === "string"
    && typeof value.platformMachine === "string"
    && typeof value.authRequired === "boolean"
    && typeof value.inferenceAuthorized === "boolean"
    && typeof value.activeModel === "string"
    && RUNTIMES.has(String(value.runtime))
    && BACKENDS.has(String(value.backend))
    && typeof value.mock === "boolean"
    && isNullableString(value.fallbackReason);
}

function isDeviceResponse(value: unknown): value is DeviceResponse {
  if (!hasApiEnvelope(value)) return false;
  const booleans = [
    "torchAvailable",
    "onnxRuntimeAvailable",
    "cudaAvailable",
    "torchCudaAvailable",
    "onnxCudaAvailable",
    "mpsAvailable",
    "coremlAvailable",
    "directmlAvailable",
  ];
  return RUNTIMES.has(String(value.selectedDevice))
    && typeof value.deviceName === "string"
    && booleans.every((key) => typeof value[key] === "boolean")
    && Number.isInteger(value.cudaDeviceCount)
    && (value.totalMemoryMb === null || typeof value.totalMemoryMb === "number");
}

function isModelsResponse(value: unknown): value is ModelsResponse {
  if (!hasApiEnvelope(value) || !Array.isArray(value.models)) return false;
  const validModels = value.models.every((model) =>
    isRecord(model)
    && typeof model.id === "string"
    && typeof model.name === "string"
    && MODEL_RUNTIMES.has(String(model.runtime))
    && typeof model.available === "boolean"
    && typeof model.loaded === "boolean"
    && Array.isArray(model.capabilities)
    && model.capabilities.every((capability) => capability === "rank")
    && BACKENDS.has(String(model.backend))
    && typeof model.mock === "boolean"
  );
  return validModels
    && typeof value.activeModel === "string"
    && RUNTIMES.has(String(value.activeRuntime))
    && BACKENDS.has(String(value.activeBackend))
    && typeof value.mock === "boolean"
    && isNullableString(value.fallbackReason);
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const requestId = createRequestId();
  const controller = new AbortController();
  const handleExternalAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) handleExternalAbort();
  else signal?.addEventListener("abort", handleExternalAbort, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort("timeout"), INFERENCE_TIMEOUT_MS);

  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...requestHeaders(),
      },
      body: JSON.stringify({
        ...(typeof body === "object" && body !== null ? body : { payload: body }),
        apiVersion: API_VERSION,
        requestId,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      let code: string | null = null;
      try {
        const errorBody: unknown = await response.json();
        if (
          isRecord(errorBody)
          && isRecord(errorBody.error)
          && typeof errorBody.error.code === "string"
        ) code = errorBody.error.code;
      } catch {
        // A non-JSON proxy response is still represented by its HTTP status.
      }
      if (response.status === 401 || response.status === 403) clearLocalAccessToken();
      throw new LocalApiError(response.status, code);
    }
    const payload = (await response.json()) as T & { apiVersion?: string; requestId?: string };
    if (payload.apiVersion !== API_VERSION) {
      throw new Error(`Local API version mismatch (expected ${API_VERSION}).`);
    }
    if (payload.requestId !== requestId) {
      throw new Error("Local API returned an unexpected request ID.");
    }
    return payload;
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", handleExternalAbort);
  }
}

export async function detectLocalBackend(): Promise<BackendConnection> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const [healthValue, deviceValue, modelsValue] = await Promise.all([
      getJson<unknown>("/api/health", controller.signal),
      getJson<unknown>("/api/device", controller.signal),
      getJson<unknown>("/api/models", controller.signal),
    ]);
    if (
      !isRecord(healthValue) || healthValue.apiVersion !== API_VERSION
      || !isRecord(deviceValue) || deviceValue.apiVersion !== API_VERSION
      || !isRecord(modelsValue) || modelsValue.apiVersion !== API_VERSION
      || !isHealthResponse(healthValue)
      || !isDeviceResponse(deviceValue)
      || !isModelsResponse(modelsValue)
    ) {
      return {
        state: "browser",
        reason: "api-mismatch",
        message: `ローカルAIサーバーのAPIに互換性がありません（期待 ${API_VERSION}）。ブラウザモードへ切り替えました。`,
      };
    }
    return {
      state: "connected",
      health: healthValue,
      device: deviceValue,
      models: modelsValue,
      inferenceAuthorized: healthValue.inferenceAuthorized,
    };
  } catch {
    return {
      state: "browser",
      reason: "unreachable",
      message: "ローカルAIサーバーは停止中です。生成・編集はブラウザだけで利用できます。",
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export function rankCandidates(
  candidates: RankCandidate[],
  preferenceWeights: Record<string, number>,
  preferenceCategory: ServerPreferenceCategory = "combined",
  signal?: AbortSignal,
): Promise<RankResponse> {
  return postJson<RankResponse>("/api/rank", {
    candidates,
    preferenceWeights,
    preferenceCategory,
    batchSize: 64,
    allowCpuFallback: true,
  }, signal);
}

export function updateServerPreference(
  category: ServerPreferenceCategory,
  feedback: ServerPreferenceFeedback,
  features: Record<string, number>,
  weight = 1,
  signal?: AbortSignal,
): Promise<PreferenceUpdateResponse> {
  return postJson<PreferenceUpdateResponse>("/api/preferences/update", {
    category,
    feedback,
    features,
    weight,
  }, signal);
}

export type {
  BackendConnection,
  DeviceResponse,
  HealthResponse,
  ModelsResponse,
  RankResponse,
} from "./inferenceTypes";
