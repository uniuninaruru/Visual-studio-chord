export type EngineJobState =
  | "idle"
  | "running"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "error";

export interface HarmonyEngineProvenance {
  modelId?: string;
  device?: string | null;
  mock?: boolean;
  trained?: boolean;
  fallbackReason?: string | null;
}

/** Reports the runtime that actually handled the completed ranking job. */
export function formatEngineLabel(
  backendCanInfer: boolean,
  activeRuntime: string,
  rankingRuntime: string,
  jobState: EngineJobState,
  harmony?: HarmonyEngineProvenance,
): string {
  if (harmony?.modelId) {
    if (harmony.fallbackReason?.toLowerCase().includes("theory fallback")) {
      return "Browser / Theory fallback";
    }
    if (harmony.mock) return "Mock Harmony / Untrained";
    if (harmony.device === null) return "Neural Harmony / Detecting device…";
    if (harmony.device === "mps") return "Neural Harmony / Apple Metal";
    if (harmony.device) return `Neural Harmony / ${harmony.device.toUpperCase()}`;
  }
  if (!backendCanInfer) return "Browser / Theory-only";
  if (jobState === "completed") {
    return rankingRuntime === "browser-linear"
      ? "Browser fallback"
      : `Local ${rankingRuntime.toUpperCase()}`;
  }
  return `Local ${activeRuntime.toUpperCase()}`;
}
