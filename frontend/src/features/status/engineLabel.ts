export type EngineJobState = "idle" | "running" | "completed" | "cancelled" | "error";

/** Reports the runtime that actually handled the completed ranking job. */
export function formatEngineLabel(
  backendCanInfer: boolean,
  activeRuntime: string,
  rankingRuntime: string,
  jobState: EngineJobState,
): string {
  if (!backendCanInfer) return "Browser / Theory-only";
  if (jobState === "completed") {
    return rankingRuntime === "browser-linear"
      ? "Browser fallback"
      : `Local ${rankingRuntime.toUpperCase()}`;
  }
  return `Local ${activeRuntime.toUpperCase()}`;
}
