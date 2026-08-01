import type {
  BackendConnection,
  DeviceResponse,
  HarmonyGenerateRequest,
  HarmonyJobResponse,
  HarmonyModelId,
  HarmonyModelManifestResponse,
  HealthResponse,
  ModelsResponse,
  PreferenceUpdateResponse,
  RankCandidate,
  RankResponse,
  ServerPreferenceCategory,
  ServerPreferenceFeedback,
} from "./inferenceTypes";

/**
 * Set for the published static build, where no backend exists to find.
 *
 * Without it the app probes `/api/health`, `/api/device`, and `/api/models`
 * twelve times across fourteen seconds before its backoff gives up — requests
 * that can only 404 on a static host — and then reports that a local server is
 * stopped, to a visitor who never ran one.
 */
const BROWSER_ONLY_BUILD = import.meta.env.VITE_PUBLIC_BUILD === "1";

const API_TIMEOUT_MS = 1_600;
const INFERENCE_TIMEOUT_MS = 30_000;
const SERVER_FEATURE_ENTRY_LIMIT = 128;
const ACCESS_TOKEN_SESSION_KEY = "music-theory-composer:lan-access";
const API_VERSION = "1";
const HARMONY_API_VERSION = "2";
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

/** Creates the correlation id that stays stable across a v2 harmony job. */
export function createHarmonyRequestId(): string {
  return createRequestId();
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
const MODEL_CAPABILITIES = new Set(["rank", "generateHarmony"]);
const HARMONY_MODELS = new Set([
  "harmonyforge-bimask-base-v1",
  "mock-harmonyforge-bimask-v1",
]);
const HARMONY_TASKS = new Set([
  "melody_conditioned_variable_rhythm_harmonization",
  "harmony_only_pretraining",
]);
const HARMONY_EVALUATION_STATUSES = new Set([
  "notEvaluated",
  "researchOnly",
  "validated",
]);
const HARMONY_JOB_STATES = new Set([
  "queued",
  "running",
  "cancelRequested",
  "completed",
  "cancelled",
  "failed",
]);
const HARMONY_STAGES = new Set([
  "Queued",
  "Loading checkpoint",
  "Encoding",
  "Neural proposal",
  "Decoding",
  "Schema validation",
  "Client theory validation",
  "Complete",
  "Cancel requested",
  "Cancelled",
  "Failed",
]);
const HARMONY_DTYPES = new Set(["float32", "float16", "bfloat16"]);
const HARMONY_QUALITIES = new Set([
  "major",
  "minor",
  "diminished",
  "augmented",
  "dominant7",
  "major7",
  "minor7",
  "halfDiminished7",
  "diminished7",
  "minorMajor7",
  "augmentedMajor7",
  "sus2",
  "sus4",
  "add9",
  "minorAdd9",
]);
const HARMONY_EXTENSIONS = new Set(["6", "9", "b9", "#9", "11", "#11", "13", "b13"]);

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
  const validModels = value.models.every((model) => {
    if (
      !isRecord(model)
      || typeof model.id !== "string"
      || typeof model.name !== "string"
      || (model.runtime !== null && !MODEL_RUNTIMES.has(String(model.runtime)))
      || typeof model.available !== "boolean"
      || typeof model.loaded !== "boolean"
      || !Array.isArray(model.capabilities)
      || !model.capabilities.every(
        (capability) => MODEL_CAPABILITIES.has(String(capability)),
      )
      || !BACKENDS.has(String(model.backend))
      || typeof model.mock !== "boolean"
      || !(
        model.task === undefined
        || model.task === null
        || HARMONY_TASKS.has(String(model.task))
      )
      || !(
        model.trained === undefined
        || model.trained === null
        || typeof model.trained === "boolean"
      )
      || !(
        model.evaluationStatus === undefined
        || model.evaluationStatus === null
        || HARMONY_EVALUATION_STATUSES.has(String(model.evaluationStatus))
      )
      || !(
        model.checkpointSha256 === undefined
        || isNullableString(model.checkpointSha256)
      )
      || !(
        model.unavailableReason === undefined
        || isNullableString(model.unavailableReason)
      )
    ) {
      return false;
    }
    const realHarmony = model.mock === false
      && model.capabilities.includes("generateHarmony");
    if (
      realHarmony
      && model.available
      && model.task !== "melody_conditioned_variable_rhythm_harmonization"
    ) {
      return false;
    }
    return model.task !== "harmony_only_pretraining"
      || model.available === false;
  });
  return validModels
    && typeof value.activeModel === "string"
    && RUNTIMES.has(String(value.activeRuntime))
    && BACKENDS.has(String(value.activeBackend))
    && typeof value.mock === "boolean"
    && isNullableString(value.fallbackReason);
}

function isHarmonyCandidate(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.events)) return false;
  return typeof value.candidateId === "string"
    && value.adoptable === false
    && value.requiresClientValidation === true
    && value.hardRuleValidation === "pendingClient"
    && (value.neuralMeanLogProbability === null
      || (
        typeof value.neuralMeanLogProbability === "number"
        && Number.isFinite(value.neuralMeanLogProbability)
      ))
    && isRecord(value.hardRuleVector)
    && Object.values(value.hardRuleVector).every((number) =>
      typeof number === "number" && Number.isFinite(number)
    )
    && value.events.every((event) =>
      isRecord(event)
      && Number.isInteger(event.startTick)
      && Number(event.startTick) >= 0
      && Number.isInteger(event.durationTick)
      && Number(event.durationTick) > 0
      && Number.isInteger(event.rootOffsetFromKey)
      && Number(event.rootOffsetFromKey) >= 0
      && Number(event.rootOffsetFromKey) <= 11
      && HARMONY_QUALITIES.has(String(event.quality))
      && Number.isInteger(event.inversion)
      && Number(event.inversion) >= 0
      && Number(event.inversion) <= 3
      && Number.isInteger(event.bassOffsetFromRoot)
      && Number(event.bassOffsetFromRoot) >= 0
      && Number(event.bassOffsetFromRoot) <= 11
      && Array.isArray(event.extensions)
      && event.extensions.every((extension) => HARMONY_EXTENSIONS.has(String(extension)))
      && typeof event.confidence === "number"
      && Number.isFinite(event.confidence)
      && event.confidence >= 0
      && event.confidence <= 1
      && ["generated", "preserved", "conditionOnly"].includes(String(event.maskMode))
    );
}

function isHarmonyJobResponse(
  value: unknown,
  expectedRequestId: string,
): value is HarmonyJobResponse {
  return isRecord(value)
    && value.apiVersion === HARMONY_API_VERSION
    && value.requestId === expectedRequestId
    && HARMONY_JOB_STATES.has(String(value.state))
    && HARMONY_STAGES.has(String(value.stage))
    && typeof value.progress === "number"
    && value.progress >= 0
    && value.progress <= 100
    && typeof value.elapsedMs === "number"
    && value.elapsedMs >= 0
    && HARMONY_MODELS.has(String(value.modelId))
    && (value.device === null || RUNTIMES.has(String(value.device)))
    && (value.backend === "pytorch" || value.backend === "mock")
    && (value.dtype === null || HARMONY_DTYPES.has(String(value.dtype)))
    && typeof value.mock === "boolean"
    && typeof value.trained === "boolean"
    && isNullableString(value.checkpointSha256)
    && typeof value.tokenizerSha256 === "string"
    && isNullableString(value.sourceCommit)
    && Number.isInteger(value.batchSize)
    && Number.isInteger(value.candidateCount)
    && typeof value.deterministic === "boolean"
    && typeof value.cpuFallbackUsed === "boolean"
    && isNullableString(value.fallbackReason)
    && isRecord(value.stageTimingsMs)
    && value.partialCandidateStored === false
    && Array.isArray(value.candidates)
    && value.candidates.every(isHarmonyCandidate)
    && (value.error === null || (
      isRecord(value.error)
      && typeof value.error.code === "string"
      && typeof value.error.message === "string"
      && value.error.compositionSafe === true
      && value.error.fallbackAvailable === true
    ));
}

function isHarmonyManifestResponse(value: unknown): value is HarmonyModelManifestResponse {
  if (!isRecord(value)) return false;
  const taskIsValid = value.task === null || HARMONY_TASKS.has(String(value.task));
  const availabilityMatchesTask = value.task !== "harmony_only_pretraining"
    || value.available === false;
  const availableRealModelHasInferenceTask = value.available !== true
    || value.mock === true
    || value.task === "melody_conditioned_variable_rhythm_harmonization";
  return taskIsValid
    && availabilityMatchesTask
    && availableRealModelHasInferenceTask
    && value.apiVersion === HARMONY_API_VERSION
    && typeof value.requestId === "string"
    && HARMONY_MODELS.has(String(value.modelId))
    && typeof value.available === "boolean"
    && typeof value.mock === "boolean"
    && typeof value.trained === "boolean"
    && ["notEvaluated", "researchOnly", "validated"].includes(String(value.evaluationStatus))
    && isNullableString(value.checkpointSha256)
    && typeof value.tokenizerSha256 === "string"
    && isRecord(value.architecture)
    && Array.isArray(value.supportedDevices)
    && value.supportedDevices.every((device) => ["cpu", "cuda", "mps"].includes(String(device)))
    && isNullableString(value.unavailableReason);
}

async function localApiError(response: Response): Promise<LocalApiError> {
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
  return new LocalApiError(response.status, code);
}

async function requestHarmonyApi(
  path: string,
  method: "GET" | "POST",
  expectedRequestId: string | null,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const handleExternalAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) handleExternalAbort();
  else signal?.addEventListener("abort", handleExternalAbort, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort("timeout"), INFERENCE_TIMEOUT_MS);

  try {
    const response = await fetch(path, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...requestHeaders(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (!response.ok) throw await localApiError(response);
    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.apiVersion !== HARMONY_API_VERSION) {
      throw new Error(`Local harmony API version mismatch (expected ${HARMONY_API_VERSION}).`);
    }
    if (expectedRequestId !== null && payload.requestId !== expectedRequestId) {
      throw new Error("Local harmony API returned an unexpected request ID.");
    }
    return payload;
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", handleExternalAbort);
  }
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
  if (BROWSER_ONLY_BUILD) {
    return {
      state: "browser",
      reason: "browser-only",
      message: "このアプリはブラウザの中だけで動いています。曲データはどこにも送信されません。",
    };
  }
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
  const candidateFeatureKeys = new Set(
    candidates.flatMap((candidate) => Object.keys(candidate.features)),
  );
  const selectedFeatureKeys = [...candidateFeatureKeys]
    .sort((left, right) => {
      const weightDifference =
        Math.abs(preferenceWeights[right] ?? 0)
        - Math.abs(preferenceWeights[left] ?? 0);
      return weightDifference || left.localeCompare(right);
    })
    .slice(0, SERVER_FEATURE_ENTRY_LIMIT);
  const selected = new Set(selectedFeatureKeys);
  const boundedCandidates = candidates.map((candidate) => ({
    ...candidate,
    features: Object.fromEntries(
      Object.entries(candidate.features)
        .filter(([feature]) => selected.has(feature))
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  }));
  const boundedWeights = Object.fromEntries(
    Object.entries(preferenceWeights)
      .filter(([feature]) => selected.has(feature))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return postJson<RankResponse>("/api/rank", {
    candidates: boundedCandidates,
    preferenceWeights: boundedWeights,
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

export async function startHarmonyGeneration(
  request: HarmonyGenerateRequest,
  signal?: AbortSignal,
): Promise<HarmonyJobResponse> {
  const payload = await requestHarmonyApi(
    "/api/v2/harmony/generate",
    "POST",
    request.requestId,
    request,
    signal,
  );
  if (!isHarmonyJobResponse(payload, request.requestId)) {
    throw new Error("Local harmony API returned a malformed job response.");
  }
  return payload;
}

export async function getHarmonyJob(
  requestId: string,
  signal?: AbortSignal,
): Promise<HarmonyJobResponse> {
  const payload = await requestHarmonyApi(
    `/api/v2/jobs/${encodeURIComponent(requestId)}`,
    "GET",
    requestId,
    undefined,
    signal,
  );
  if (!isHarmonyJobResponse(payload, requestId)) {
    throw new Error("Local harmony API returned a malformed job response.");
  }
  return payload;
}

export async function cancelHarmonyGeneration(
  requestId: string,
  signal?: AbortSignal,
): Promise<HarmonyJobResponse> {
  const payload = await requestHarmonyApi(
    `/api/v2/harmony/cancel/${encodeURIComponent(requestId)}`,
    "POST",
    requestId,
    { apiVersion: HARMONY_API_VERSION, requestId },
    signal,
  );
  if (!isHarmonyJobResponse(payload, requestId)) {
    throw new Error("Local harmony API returned a malformed cancellation response.");
  }
  return payload;
}

export async function getHarmonyModelManifest(
  modelId: HarmonyModelId,
  signal?: AbortSignal,
): Promise<HarmonyModelManifestResponse> {
  const payload = await requestHarmonyApi(
    `/api/v2/models/${encodeURIComponent(modelId)}/manifest`,
    "GET",
    null,
    undefined,
    signal,
  );
  if (!isHarmonyManifestResponse(payload) || payload.modelId !== modelId) {
    throw new Error("Local harmony API returned a malformed model manifest.");
  }
  return payload;
}

export type {
  BackendConnection,
  DeviceResponse,
  HarmonyGenerateRequest,
  HarmonyJobResponse,
  HarmonyModelId,
  HarmonyModelManifestResponse,
  HealthResponse,
  ModelsResponse,
  RankResponse,
} from "./inferenceTypes";
