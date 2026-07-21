import type { BackendConnection, DeviceResponse, HealthResponse } from "./inferenceTypes";

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

export async function detectLocalBackend(): Promise<BackendConnection> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const [health, device] = await Promise.all([
      getJson<HealthResponse>("/api/health", controller.signal),
      getJson<DeviceResponse>("/api/device", controller.signal),
    ]);
    return { state: "connected", health, device };
  } catch {
    return {
      state: "browser",
      message: "ローカルAIサーバーは停止中です。生成・編集はブラウザだけで利用できます。",
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export type { BackendConnection, DeviceResponse, HealthResponse } from "./inferenceTypes";
