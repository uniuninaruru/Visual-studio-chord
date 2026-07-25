import { useCallback, useEffect, useMemo, useState } from "react";
import type { BackendConnection } from "../api/inferenceClient";
import type {
  BackendDiagnostics,
  UserFacingDiagnosticError,
} from "../features/diagnostics";
import { fallbackLabel } from "../features/status/fallbackLabel";
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
): DiagnosticsState {
  const [browserCapabilities, setBrowserCapabilities] =
    useState<BrowserCapabilities | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [audioError, setAudioError] = useState<UserFacingDiagnosticError | null>(null);

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
        .map((model) => ({
          id: model.id,
          name: model.name,
          status: model.available ? "ready" as const : "missing" as const,
          detail: `${model.runtime}${model.loaded ? " · loaded" : " · available on demand"}${model.id === backend.models.activeModel && fallbackLabel(backend.models.fallbackReason) ? ` · ${fallbackLabel(backend.models.fallbackReason)}` : ""}`,
        })),
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
  }, [backend, lastRankInfo]);

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
