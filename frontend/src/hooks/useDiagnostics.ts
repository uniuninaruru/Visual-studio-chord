import { useCallback, useEffect, useMemo, useState } from "react";
import type { BackendConnection } from "../api/inferenceClient";
import type {
  BackendDiagnostics,
  HarmonyJobDiagnostic,
  UserFacingDiagnosticError,
} from "../features/diagnostics";
import { fallbackLabel } from "../features/status/fallbackLabel";
import type { AiJobStatus } from "../features/status/ProjectStatusBar";
import {
  detectBrowserCapabilities,
  type BrowserCapabilities,
} from "../platform";

export interface RankInfo {
  runtime: string;
  batchSize: number | null;
  fallback: string | null;
}

export interface DiagnosticsState {
  browserCapabilities: BrowserCapabilities | null;
  diagnosticsOpen: boolean;
  setDiagnosticsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** Audio failures are surfaced as a diagnostic, separately from AI failures. */
  audioError: UserFacingDiagnosticError | null;
  setAudioError: React.Dispatch<React.SetStateAction<UserFacingDiagnosticError | null>>;
  backendDiagnostics: BackendDiagnostics;
  /** Re-probes both the browser capabilities and the backend. */
  retryDiagnostics: () => Promise<void>;
}

/**
 * Owns what the diagnostics panel reports: probed browser capabilities, the
 * panel's open state, the last audio failure, and the backend's health
 * translated into user-facing language.
 *
 * Capabilities are probed against real APIs rather than inferred from the user
 * agent, so the result is asynchronous.
 */
export function useDiagnostics(
  backend: BackendConnection,
  lastRankInfo: RankInfo | null,
  refreshBackend: () => Promise<void>,
  aiJob?: AiJobStatus,
): DiagnosticsState {
  const [browserCapabilities, setBrowserCapabilities] =
    useState<BrowserCapabilities | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [audioError, setAudioError] = useState<UserFacingDiagnosticError | null>(null);
  const lastHarmonyJob = useMemo<HarmonyJobDiagnostic | undefined>(() => {
    if (!aiJob?.modelId) return undefined;
    return {
      modelId: aiJob.modelId,
      stage: aiJob.stage,
      device: aiJob.device === null
        ? aiJob.state === "running" || aiJob.state === "cancelling"
          ? "Detecting device…"
          : "device not reported"
        : aiJob.device === "mps" ? "Apple Metal (MPS)" : aiJob.device.toUpperCase(),
      backend: `${aiJob.backend}${aiJob.dtype ? ` / ${aiJob.dtype}` : ""}`,
      checkpoint: aiJob.checkpointSha256
        ? `ckpt ${aiJob.checkpointSha256.slice(0, 12)}`
        : "checkpointなし",
      candidateSummary: aiJob.candidateCount === undefined
        ? undefined
        : `${aiJob.candidateCount}候補 · batch ${aiJob.batchSize ?? "—"}`,
      mock: aiJob.mock ?? false,
      trained: aiJob.trained ?? false,
      fallback: aiJob.fallbackReason,
    };
  }, [aiJob]);

  useEffect(() => {
    let cancelled = false;
    void detectBrowserCapabilities().then((capabilities) => {
      if (!cancelled) setBrowserCapabilities(capabilities);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const backendDiagnostics = useMemo<BackendDiagnostics>(() => {
    if (backend.state === "checking") {
      return {
        connection: "checking",
        device: null,
        inferenceBackend: "確認中",
        models: [],
        lastHarmonyJob,
        apiCompatibility: "checking",
        expectedApiVersion: "1",
      };
    }
    if (backend.state === "browser") {
      const apiMismatch = backend.reason === "api-mismatch";
      return {
        connection: "disconnected",
        device: "Browser / CPU",
        inferenceBackend: "Browser linear / Theory-only",
        models: [],
        lastHarmonyJob,
        apiCompatibility: apiMismatch ? "incompatible" : "unknown",
        expectedApiVersion: "1",
        error: {
          title: apiMismatch
            ? "ローカル推論サーバーのAPIに互換性がありません"
            : "ローカル推論サーバーへ接続できません",
          message: "生成・再生・編集・保存はブラウザ内で継続できます。曲データは安全です。",
          remedy: apiMismatch
            ? "フロントエンドとバックエンドを同じリリースへ更新してください。"
            : "高速推論が必要ならデスクトップ側のサーバーを起動し、「診断を再実行」を押してください。",
          canRetry: true,
          diagnosticCode: apiMismatch ? "LOCAL_API_VERSION_MISMATCH" : "LOCAL_API_UNREACHABLE",
        },
      };
    }
    const serverApiVersion = backend.health.apiVersion;
    return {
      connection: "connected",
      device: backend.device.deviceName,
      inferenceBackend: `${backend.models.activeModel} / ${backend.models.activeRuntime}${lastRankInfo ? ` · last ${lastRankInfo.runtime}${lastRankInfo.batchSize ? ` batch ${lastRankInfo.batchSize}` : ""}${lastRankInfo.fallback ? ` · ${lastRankInfo.fallback}` : ""}` : ""}`,
      models: backend.models.models
        .filter((model) => model.id !== "browser-linear-v1")
        .map((model) => {
          const harmony = model.capabilities.includes("generateHarmony");
          const pretraining = model.task === "harmony_only_pretraining";
          const validPretraining = pretraining
            && model.trained === true
            && typeof model.checkpointSha256 === "string";
          const modelKind = model.mock
            ? model.available
              ? "explicit Mock · untrained"
              : "explicit Mock disabled"
            : validPretraining
              ? "installed pretraining checkpoint · inference disabled"
            : pretraining
              ? "invalid pretraining artifact · inference blocked"
            : harmony
              ? model.available
                ? "trained checkpoint ready"
                : "trained checkpoint missing"
              : "ranking model";
          const task = model.task === "harmony_only_pretraining"
            ? "task: harmony-only pretraining（推論利用不可）"
            : model.task === "melody_conditioned_variable_rhythm_harmonization"
              ? "task: melody-conditioned inference"
              : harmony
                ? "task: 未配置または未報告"
                : null;
          return {
            id: model.id,
            name: model.name,
            status: model.available
              ? "ready" as const
              : validPretraining
                ? "blocked" as const
                : pretraining
                  ? "error" as const
                  : "missing" as const,
            detail: [
              model.loaded
                ? model.runtime ?? "runtime not reported"
                : "not loaded",
              model.loaded
                ? "loaded"
                : model.available ? "available on demand" : "unavailable",
              `capability: ${model.capabilities.join(", ")}`,
              modelKind,
              task,
              model.evaluationStatus
                ? `evaluation: ${model.evaluationStatus}`
                : null,
              model.checkpointSha256
                ? `ckpt ${model.checkpointSha256.slice(0, 12)}`
                : null,
              model.id === backend.models.activeModel
                ? fallbackLabel(backend.models.fallbackReason)
                : null,
            ].filter(Boolean).join(" · "),
          };
        }),
      lastHarmonyJob,
      apiCompatibility: serverApiVersion === undefined
        ? "unknown"
        : serverApiVersion === "1"
          ? "compatible"
          : "incompatible",
      serverApiVersion,
      expectedApiVersion: "1",
      serverVersion: backend.health.version,
      pythonVersion: backend.health.pythonVersion,
      platformSystem: backend.health.platformSystem,
      platformMachine: backend.health.platformMachine,
      error: backend.inferenceAuthorized ? undefined : {
        title: "ローカル推論にはアクセスリンクが必要です",
        message: "サーバー診断には接続できていますが、保護された推論操作はブラウザモードへフォールバックします。曲データは安全です。",
        remedy: "デスクトップの起動ログに表示された #access=... 付きURLを、この端末で開いてください。",
        canRetry: true,
        diagnosticCode: "LOCAL_API_ACCESS_REQUIRED",
      },
    };
  }, [backend, lastHarmonyJob, lastRankInfo]);

  const retryDiagnostics = useCallback(async () => {
    // Clearing first makes the panel show the probe running rather than
    // leaving stale values on screen while it re-runs.
    setBrowserCapabilities(null);
    await Promise.all([
      detectBrowserCapabilities().then(setBrowserCapabilities),
      refreshBackend(),
    ]);
  }, [refreshBackend]);

  return {
    browserCapabilities,
    diagnosticsOpen,
    setDiagnosticsOpen,
    audioError,
    setAudioError,
    backendDiagnostics,
    retryDiagnostics,
  };
}
