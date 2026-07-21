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

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Local API responded with ${response.status}.`);
  }
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(`Local API responded with ${response.status}.`);
  return (await response.json()) as T;
}

export async function detectLocalBackend(): Promise<BackendConnection> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const [health, device, models] = await Promise.all([
      getJson<HealthResponse>("/api/health", controller.signal),
      getJson<DeviceResponse>("/api/device", controller.signal),
      getJson<ModelsResponse>("/api/models", controller.signal),
    ]);
    return { state: "connected", health, device, models };
  } catch {
    return {
      state: "browser",
      message: "ローカルAIサーバーは停止中です。生成・編集はブラウザだけで利用できます。",
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export function rankCandidates(
  candidates: RankCandidate[],
  preferenceWeights: Record<string, number>,
  signal?: AbortSignal,
): Promise<RankResponse> {
  return postJson<RankResponse>("/api/rank", {
    candidates,
    preferenceWeights,
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
