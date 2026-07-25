import { useCallback, useEffect, useRef, useState } from "react";
import {
  isLocalAccessError,
  isLocalConnectivityError,
  LocalApiError,
  rankCandidates as rankCandidatesOnServer,
  type BackendConnection,
} from "../api/inferenceClient";
import { fallbackLabel } from "../features/status/fallbackLabel";
import type { AiJobStatus } from "../features/status/ProjectStatusBar";
import {
  extractPreferenceFeatures,
  type PreferenceCategory,
  type PreferenceFeatureSet,
  type PreferenceModel,
} from "../preference";
import { useComposerStore } from "../state";
import type {
  BarRange,
  RegenerationStrength,
  RegenerationTarget,
} from "../types/music";
import type { RankInfo } from "./useCandidateRanking";

/** The server names the harmony category differently from the client. */
function serverPreferenceCategory(category: PreferenceCategory) {
  return category === "harmony" ? "chords" as const : category;
}

function featureVector(features: PreferenceFeatureSet, category: PreferenceCategory) {
  return features[category];
}

const IDLE_JOB: AiJobStatus = {
  state: "idle",
  label: "Ready",
  stage: "Idle",
  progress: 0,
  startedAt: null,
  device: "browser",
  backend: "browser-linear",
};

export interface CandidateGenerationOptions {
  selectedBarRange: BarRange | null;
  generatePreviewVariations: (
    options: { target: RegenerationTarget; strength: RegenerationStrength },
    signal: {
      signal: AbortSignal;
      onProgress: (attempt: number, maximumAttempts: number) => void;
    },
  ) => Promise<number>;
  backend: BackendConnection;
  setBackend: React.Dispatch<React.SetStateAction<BackendConnection>>;
  scheduleBackendRecovery: (delay?: number) => void;
  preferenceModel: PreferenceModel;
  preferenceCategory: PreferenceCategory;
  setServerScores: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setRankingRuntime: React.Dispatch<React.SetStateAction<string>>;
  setLastRankInfo: React.Dispatch<React.SetStateAction<RankInfo | null>>;
  /** Called once candidates are ready, so stale selections are dropped. */
  onGenerated: () => void;
  onToast: (message: string) => void;
}

export interface CandidateGeneration {
  aiJob: AiJobStatus;
  regenerationTarget: RegenerationTarget;
  setRegenerationTarget: React.Dispatch<React.SetStateAction<RegenerationTarget>>;
  regenerationStrength: RegenerationStrength;
  setRegenerationStrength: React.Dispatch<React.SetStateAction<RegenerationStrength>>;
  regenerate: () => Promise<void>;
  cancel: () => void;
}

/**
 * Owns generating A/B/C candidates and reporting progress.
 *
 * Two guarantees shape this: the composition on screen is never modified by a
 * generation attempt, and a failure at any stage — theory validation, the local
 * server, the network — degrades to a safe outcome rather than surfacing as a
 * broken app. Ranking failures additionally downgrade the backend connection so
 * the rest of the app stops trying to use it.
 */
export function useCandidateGeneration(
  options: CandidateGenerationOptions,
): CandidateGeneration {
  const {
    selectedBarRange,
    generatePreviewVariations,
    backend,
    setBackend,
    scheduleBackendRecovery,
    preferenceModel,
    preferenceCategory,
    setServerScores,
    setRankingRuntime,
    setLastRankInfo,
    onGenerated,
    onToast,
  } = options;

  const [aiJob, setAiJob] = useState<AiJobStatus>(IDLE_JOB);
  const [regenerationTarget, setRegenerationTarget] =
    useState<RegenerationTarget>("all");
  const [regenerationStrength, setRegenerationStrength] =
    useState<RegenerationStrength>("moderate");
  const controllerRef = useRef<AbortController | null>(null);

  // An in-flight request must not outlive the app.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setAiJob((current) => ({
      ...current,
      state: "cancelled",
      label: "Cancelled · composition unchanged",
      stage: "Cancelled",
    }));
    onToast("AI処理をキャンセルしました。編集中の曲は変更されていません。");
  }, [onToast]);

  const regenerate = useCallback(async () => {
    if (!selectedBarRange) {
      onToast("先にコードレーンで小節を選択してください。");
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const startedAt = Date.now();
    // Read through the connected shape directly so the models field narrows;
    // backendCanInfer is the same condition but opaque to the type checker.
    const inferring = backend.state === "connected" && backend.inferenceAuthorized
      ? backend
      : null;
    const engine = inferring
      ? `Local ${inferring.models.activeRuntime.toUpperCase()}`
      : "Browser linear / theory";
    setAiJob({
      state: "running",
      label: "Generating candidates",
      stage: "Generating 3 candidates",
      progress: 8,
      startedAt,
      device: inferring ? inferring.models.activeRuntime : "browser",
      backend: inferring ? inferring.models.activeModel : "browser-linear",
    });

    try {
      // Yield once so controls, playback, and the progress state paint first.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (controller.signal.aborted) return;
      const count = await generatePreviewVariations(
        {
          target: regenerationTarget,
          strength: regenerationStrength,
        },
        {
          signal: controller.signal,
          onProgress: (attempt, maximumAttempts) => setAiJob((current) => ({
            ...current,
            stage: `Generating candidates · ${attempt}/${maximumAttempts}`,
            progress: 8 + (attempt / maximumAttempts) * 42,
          })),
        },
      );
      if (count === 0) {
        setAiJob((current) => ({
          ...current,
          state: "error",
          stage: "Theory validation",
          progress: 100,
          message: "No valid candidate · composition unchanged",
        }));
        onToast("候補の理論検証に失敗しました。編集中の曲は安全です。設定を変えて再試行できます。");
        return;
      }

      const previews = useComposerStore.getState().previewVariations;
      const features = previews.map(extractPreferenceFeatures);
      setAiJob((current) => ({
        ...current,
        stage: `Ranking with ${engine}`,
        progress: 58,
      }));

      let usedRuntime = "browser-linear";
      let completedFallback: string | null = null;
      let usedBrowserFallback = false;
      if (inferring) {
        try {
          const response = await rankCandidatesOnServer(
            previews.map((candidate, index) => ({
              id: candidate.id,
              features: featureVector(features[index] as PreferenceFeatureSet, preferenceCategory),
            })),
            preferenceModel.categories[preferenceCategory].weights,
            serverPreferenceCategory(preferenceCategory),
            controller.signal,
          );
          setServerScores(Object.fromEntries(
            response.ranked.map((candidate) => [candidate.id, candidate.score]),
          ));
          setRankingRuntime(response.runtime);
          completedFallback = fallbackLabel(response.fallbackReason);
          setLastRankInfo({
            runtime: response.runtime,
            batchSize: response.batchSize,
            fallback: completedFallback,
          });
          usedRuntime = response.runtime;
        } catch (error) {
          if (controller.signal.aborted) return;
          setServerScores({});
          setRankingRuntime("browser-linear");
          setLastRankInfo({
            runtime: "browser-linear",
            batchSize: null,
            fallback: "Local inference failed · browser fallback",
          });
          completedFallback = isLocalAccessError(error)
            ? "Access link expired · browser fallback"
            : "Local inference failed · browser fallback";
          usedBrowserFallback = true;
          if (isLocalAccessError(error)) {
            setBackend((current) => current.state === "connected"
              ? { ...current, inferenceAuthorized: false }
              : current);
          } else if (
            !(error instanceof LocalApiError)
            || isLocalConnectivityError(error)
          ) {
            setBackend({
              state: "browser",
              reason: "unreachable",
              message: "ローカルAIサーバーとの接続が切れました。ブラウザモードへ切り替えました。",
            });
            scheduleBackendRecovery();
          }
        }
      } else {
        setServerScores({});
        setRankingRuntime("browser-linear");
        setLastRankInfo({ runtime: "browser-linear", batchSize: null, fallback: null });
      }

      if (controller.signal.aborted) return;
      onGenerated();
      setAiJob((current) => ({
        ...current,
        state: "completed",
        label: `${count} candidates ready · ${usedRuntime}${completedFallback ? ` · ${completedFallback}` : ""}`,
        stage: "Complete",
        progress: 100,
      }));
      onToast(usedBrowserFallback
        ? `${count}つの候補をブラウザへ安全にフォールバックして生成しました。正式データは変更されていません。`
        : completedFallback
          ? `${count}つの候補を生成しました。${completedFallback}。正式データは変更されていません。`
          : `${count}つの候補を生成しました。正式データはまだ変更されていません。`);
    } catch {
      if (controller.signal.aborted) return;
      setAiJob((current) => ({
        ...current,
        state: "error",
        stage: "Generation failed",
        progress: 100,
        message: "Generation failed safely",
      }));
      onToast("候補生成に失敗しました。編集中の曲は安全です。設定を確認して再試行できます。");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [
    backend,
    generatePreviewVariations,
    onGenerated,
    onToast,
    preferenceCategory,
    preferenceModel,
    regenerationStrength,
    regenerationTarget,
    scheduleBackendRecovery,
    selectedBarRange,
    setBackend,
    setLastRankInfo,
    setRankingRuntime,
    setServerScores,
  ]);

  return {
    aiJob,
    regenerationTarget,
    setRegenerationTarget,
    regenerationStrength,
    setRegenerationStrength,
    regenerate,
    cancel,
  };
}
