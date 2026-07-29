import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelHarmonyGeneration,
  createHarmonyRequestId,
  getHarmonyJob,
  isLocalAccessError,
  isLocalConnectivityError,
  LocalApiError,
  rankCandidates as rankCandidatesOnServer,
  startHarmonyGeneration,
  type BackendConnection,
} from "../api/inferenceClient";
import {
  buildHarmonyGenerateRequest,
  materializeHarmonyPreviews,
} from "../api/neuralHarmonyAdapter";
import type {
  HarmonyJobResponse,
  HarmonyPreferredDevice,
  ModelInfo,
  NeuralHarmonyPreviewMetadata,
} from "../api/inferenceTypes";
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

const HARMONY_POLL_INTERVAL_MS = 200;
const HARMONY_JOB_LIMIT_MS = 120_000;

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
  elapsedMs: 0,
  device: "browser",
  backend: "browser-linear",
};

function harmonyModelFor(backend: BackendConnection): ModelInfo | null {
  if (backend.state !== "connected" || !backend.inferenceAuthorized) return null;
  const models = backend.models.models.filter((model) =>
    model.available && model.capabilities.includes("generateHarmony")
  );
  return models.find((model) => !model.mock)
    ?? models.find((model) => model.mock)
    ?? null;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    const handleAbort = () => {
      globalThis.clearTimeout(timeout);
      reject(new DOMException("Harmony generation was cancelled.", "AbortError"));
    };
    if (signal.aborted) handleAbort();
    else signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function jobStatusPatch(job: HarmonyJobResponse): Partial<AiJobStatus> {
  return {
    state: job.state === "cancelRequested" ? "cancelling" : "running",
    label: job.mock ? "Mock harmony preview" : "Neural harmony preview",
    stage: job.stage,
    progress: job.progress,
    elapsedMs: job.elapsedMs,
    device: job.device,
    backend: job.backend,
    modelId: job.modelId,
    dtype: job.dtype,
    mock: job.mock,
    trained: job.trained,
    checkpointSha256: job.checkpointSha256,
    tokenizerSha256: job.tokenizerSha256,
    sourceCommit: job.sourceCommit,
    candidateCount: job.candidateCount,
    batchSize: job.batchSize,
    deterministic: job.deterministic,
    cpuFallbackUsed: job.cpuFallbackUsed,
    fallbackReason: job.fallbackReason,
  };
}

async function pollHarmonyJob(
  initial: HarmonyJobResponse,
  signal: AbortSignal,
  onUpdate: (job: HarmonyJobResponse) => void,
): Promise<HarmonyJobResponse> {
  let job = initial;
  const startedAt = Date.now();
  onUpdate(job);
  while (["queued", "running", "cancelRequested"].includes(job.state)) {
    if (Date.now() - startedAt > HARMONY_JOB_LIMIT_MS) {
      throw new Error("Harmony job exceeded the client time limit.");
    }
    await abortableDelay(HARMONY_POLL_INTERVAL_MS, signal);
    job = await getHarmonyJob(initial.requestId, signal);
    onUpdate(job);
  }
  return job;
}

function neuralFailureLabel(job: HarmonyJobResponse): string {
  switch (job.error?.code) {
    case "MODEL_UNAVAILABLE":
      return "Trained checkpoint unavailable · theory fallback";
    case "CHECKPOINT_INVALID":
      return "Checkpoint invalid · theory fallback";
    case "INFERENCE_FAILED":
      return "Neural inference failed · theory fallback";
    default:
      return "Neural preview unavailable · theory fallback";
  }
}

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
  setNeuralPreviewMetadata: React.Dispatch<
    React.SetStateAction<Record<string, NeuralHarmonyPreviewMetadata>>
  >;
  /** Called once candidates are ready, so stale selections are dropped. */
  onGenerated: () => void;
  onToast: (message: string) => void;
}

export interface CandidateGeneration {
  aiJob: AiJobStatus;
  harmonyModel: ModelInfo | null;
  preferredDevice: HarmonyPreferredDevice;
  setPreferredDevice: React.Dispatch<React.SetStateAction<HarmonyPreferredDevice>>;
  regenerationTarget: RegenerationTarget;
  setRegenerationTarget: React.Dispatch<React.SetStateAction<RegenerationTarget>>;
  regenerationStrength: RegenerationStrength;
  setRegenerationStrength: React.Dispatch<React.SetStateAction<RegenerationStrength>>;
  regenerate: () => Promise<void>;
  retryOnCpu: () => Promise<void>;
  cancel: () => void;
}

/**
 * Owns generation and ranking for immutable A/B/C previews.
 *
 * Harmony-only jobs use the asynchronous v2 neural API when an authorised,
 * available model is discovered. Every other path, and every neural failure,
 * keeps the established in-browser theory generator as a safe fallback.
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
    setNeuralPreviewMetadata,
    onGenerated,
    onToast,
  } = options;

  const [aiJob, setAiJob] = useState<AiJobStatus>(IDLE_JOB);
  const [regenerationTarget, setRegenerationTarget] =
    useState<RegenerationTarget>("all");
  const [regenerationStrength, setRegenerationStrength] =
    useState<RegenerationStrength>("moderate");
  const [preferredDevice, setPreferredDevice] =
    useState<HarmonyPreferredDevice>("auto");
  const controllerRef = useRef<AbortController | null>(null);
  const remoteRequestIdRef = useRef<string | null>(null);
  const runTokenRef = useRef(0);
  const cancellationRequestsRef = useRef(
    new Map<string, Promise<HarmonyJobResponse | null>>(),
  );
  const harmonyModel = useMemo(() => harmonyModelFor(backend), [backend]);

  const requestServerCancellation = useCallback((requestId: string) => {
    const existing = cancellationRequestsRef.current.get(requestId);
    if (existing) return existing;
    const cancellation = cancelHarmonyGeneration(requestId).then(
      (job) => job,
      () => null,
    );
    cancellationRequestsRef.current.set(requestId, cancellation);
    return cancellation;
  }, []);

  // An in-flight request must not outlive the app.
  useEffect(() => () => {
    runTokenRef.current += 1;
    const controller = controllerRef.current;
    const requestId = remoteRequestIdRef.current;
    controllerRef.current = null;
    remoteRequestIdRef.current = null;
    controller?.abort();
    if (requestId) void requestServerCancellation(requestId);
  }, [requestServerCancellation]);

  const cancel = useCallback(() => {
    const controller = controllerRef.current;
    const requestId = remoteRequestIdRef.current;
    const runToken = runTokenRef.current;
    controller?.abort();
    controllerRef.current = null;
    remoteRequestIdRef.current = null;
    if (!controller) return;
    setAiJob((current) => ({
      ...current,
      state: requestId ? "cancelling" : "cancelled",
      label: requestId ? "Cancellation requested · composition unchanged" : "Cancelled · composition unchanged",
      stage: requestId ? "Cancel requested" : "Cancelled",
    }));
    if (requestId) {
      void requestServerCancellation(requestId).then((job) => {
        if (
          runTokenRef.current !== runToken
          || controllerRef.current !== null
        ) return;
        if (job) {
          setAiJob((current) => ({
            ...current,
            ...jobStatusPatch(job),
            state: "cancelled",
            label: "Cancelled · composition unchanged",
            stage: job.state === "cancelled" ? job.stage : "Cancel requested",
          }));
        } else {
          setAiJob((current) => ({
            ...current,
            state: "cancelled",
            label: "Cancelled locally · composition unchanged",
            stage: "Cancelled",
            message: "Server cancellation could not be confirmed.",
          }));
        }
      });
    }
    onToast("AI処理をキャンセルしました。編集中の曲は変更されていません。");
  }, [onToast, requestServerCancellation]);

  const regenerateWithDevice = useCallback(async (
    deviceOverride?: HarmonyPreferredDevice,
  ) => {
    if (!selectedBarRange) {
      onToast("先にコードレーンで小節を選択してください。");
      return;
    }
    const previousController = controllerRef.current;
    const previousRequestId = remoteRequestIdRef.current;
    previousController?.abort();
    if (previousRequestId) void requestServerCancellation(previousRequestId);
    const controller = new AbortController();
    runTokenRef.current += 1;
    controllerRef.current = controller;
    remoteRequestIdRef.current = null;
    const startedAt = Date.now();
    const requestedDevice = deviceOverride ?? preferredDevice;
    const inferring = backend.state === "connected" && backend.inferenceAuthorized
      ? backend
      : null;
    const useNeural = regenerationTarget === "chords" && harmonyModel !== null;
    setNeuralPreviewMetadata({});
    setAiJob({
      state: "running",
      label: useNeural
        ? harmonyModel.mock ? "Starting explicit mock preview" : "Starting neural harmony preview"
        : "Generating theory previews",
      stage: useNeural ? "Queued" : "Generating 3 candidates",
      progress: useNeural ? 0 : 8,
      startedAt,
      elapsedMs: 0,
      device: useNeural ? null : "browser",
      backend: useNeural ? harmonyModel.backend : "browser-linear",
      modelId: useNeural ? harmonyModel.id : undefined,
      mock: useNeural ? harmonyModel.mock : undefined,
      trained: useNeural ? !harmonyModel.mock : undefined,
      preferredDevice: requestedDevice,
    });

    let count = 0;
    let completedNeuralJob: HarmonyJobResponse | null = null;
    let generationFallback: string | null = null;
    let skipServerRanking = false;
    let canRetryOnCpu = false;
    let neuralRequestId: string | null = null;
    let remoteJobTerminal = false;

    try {
      // Yield so playback, editing controls, and the progress state paint first.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (controller.signal.aborted) return;

      if (useNeural) {
        try {
          const requestId = createHarmonyRequestId();
          const source = useComposerStore.getState().draftComposition;
          const context = buildHarmonyGenerateRequest({
            composition: source,
            selectedRange: selectedBarRange,
            modelId: harmonyModel.id as "harmonyforge-bimask-base-v1" | "mock-harmonyforge-bimask-v1",
            requestId,
            candidateCount: 3,
            preferredDevice: requestedDevice,
          });
          neuralRequestId = requestId;
          remoteRequestIdRef.current = requestId;
          const initial = await startHarmonyGeneration(context.request, controller.signal);
          const job = await pollHarmonyJob(
            initial,
            controller.signal,
            (update) => {
              if (
                controllerRef.current === controller
                && !controller.signal.aborted
              ) {
                setAiJob((current) => ({
                  ...current,
                  ...jobStatusPatch(update),
                }));
              }
            },
          );
          remoteJobTerminal = ["completed", "failed", "cancelled"].includes(job.state);
          if (
            remoteJobTerminal
            && controllerRef.current === controller
            && remoteRequestIdRef.current === requestId
          ) {
            remoteRequestIdRef.current = null;
          }
          if (controller.signal.aborted) return;
          if (job.state === "cancelled") {
            setAiJob((current) => ({
              ...current,
              ...jobStatusPatch(job),
              state: "cancelled",
              label: "Cancelled · composition unchanged",
            }));
            return;
          }
          if (job.state === "completed") {
            setAiJob((current) => ({
              ...current,
              ...jobStatusPatch(job),
              stage: "Client theory validation",
              progress: 97,
            }));
            // Three proposals are small, but yielding before the all-track gate
            // still keeps playback/UI work ahead of candidate materialisation.
            await abortableDelay(0, controller.signal);
            const latest = useComposerStore.getState().draftComposition;
            const materialized = materializeHarmonyPreviews(context, job, latest);
            count = useComposerStore.getState().publishPreviewVariations(
              context.sourceCompositionId,
              materialized.previews,
            );
            if (count > 0) {
              completedNeuralJob = job;
              setNeuralPreviewMetadata(materialized.metadataByCompositionId);
              setAiJob((current) => ({
                ...current,
                rebasedAgainstNewerEdits: materialized.rebasedAgainstNewerEdits,
              }));
            } else {
              generationFallback = "Neural candidates failed client safety validation · theory fallback";
              canRetryOnCpu = !harmonyModel.mock && requestedDevice !== "cpu";
            }
          } else {
            generationFallback = neuralFailureLabel(job);
            canRetryOnCpu = !harmonyModel.mock && requestedDevice !== "cpu";
          }
        } catch (error) {
          if (neuralRequestId && !remoteJobTerminal) {
            void requestServerCancellation(neuralRequestId);
          }
          if (controller.signal.aborted) return;
          generationFallback = isLocalAccessError(error)
            ? "Access link expired · theory fallback"
            : "Neural service unavailable · theory fallback";
          canRetryOnCpu = !harmonyModel.mock && requestedDevice !== "cpu";
          if (isLocalAccessError(error)) {
            setBackend((current) => current.state === "connected"
              ? { ...current, inferenceAuthorized: false }
              : current);
          } else if (
            !(error instanceof LocalApiError)
            || isLocalConnectivityError(error)
          ) {
            skipServerRanking = true;
            setBackend({
              state: "browser",
              reason: "unreachable",
              message: "ローカルAIサーバーとの接続が切れました。ブラウザモードへ切り替えました。",
            });
            scheduleBackendRecovery();
          }
        } finally {
          if (
            controllerRef.current === controller
            && remoteRequestIdRef.current === neuralRequestId
          ) {
            remoteRequestIdRef.current = null;
          }
        }
      }

      if (count === 0) {
        setNeuralPreviewMetadata({});
        setAiJob((current) => ({
          ...current,
          state: "running",
          stage: generationFallback ? "Theory fallback" : "Generating 3 candidates",
          progress: Math.max(8, current.progress),
          device: "browser",
          backend: "browser-linear",
          fallbackReason: generationFallback,
          canRetryOnCpu,
        }));
        count = await generatePreviewVariations(
          {
            target: regenerationTarget,
            strength: regenerationStrength,
          },
          {
            signal: controller.signal,
            onProgress: (attempt, maximumAttempts) => setAiJob((current) => ({
              ...current,
              stage: generationFallback
                ? `Theory fallback · ${attempt}/${maximumAttempts}`
                : `Generating candidates · ${attempt}/${maximumAttempts}`,
              progress: 8 + (attempt / maximumAttempts) * 42,
            })),
          },
        );
      }

      if (count === 0) {
        setAiJob((current) => ({
          ...current,
          state: "error",
          stage: "Theory validation",
          progress: 100,
          message: "No valid candidate · composition unchanged",
          canRetryOnCpu,
        }));
        onToast("候補の理論検証に失敗しました。編集中の曲は安全です。設定を変えて再試行できます。");
        return;
      }

      const previews = useComposerStore.getState().previewVariations;
      const features = previews.map(extractPreferenceFeatures);
      const engine = inferring
        ? `Local ${inferring.models.activeRuntime.toUpperCase()}`
        : "Browser linear / theory";
      setAiJob((current) => ({
        ...current,
        stage: `Ranking with ${engine}`,
        progress: 58,
      }));

      let usedRuntime = "browser-linear";
      let completedFallback = generationFallback;
      let usedBrowserFallback = generationFallback !== null;
      if (inferring && !skipServerRanking) {
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
          const rankingFallback = fallbackLabel(response.fallbackReason);
          completedFallback = [generationFallback, rankingFallback].filter(Boolean).join(" · ") || null;
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
            fallback: "Local ranking failed · browser fallback",
          });
          const rankFallback = isLocalAccessError(error)
            ? "Access link expired · browser ranking"
            : "Local ranking failed · browser ranking";
          completedFallback = [generationFallback, rankFallback].filter(Boolean).join(" · ");
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
        setLastRankInfo({
          runtime: "browser-linear",
          batchSize: null,
          fallback: generationFallback,
        });
      }

      if (controller.signal.aborted) return;
      onGenerated();
      setAiJob((current) => ({
        ...current,
        ...(completedNeuralJob ? jobStatusPatch(completedNeuralJob) : {}),
        state: "completed",
        label: `${count} previews ready · ${usedRuntime}${completedFallback ? ` · ${completedFallback}` : ""}`,
        stage: "Complete",
        progress: 100,
        fallbackReason: completedFallback ?? completedNeuralJob?.fallbackReason ?? null,
        canRetryOnCpu,
      }));
      onToast(usedBrowserFallback
        ? `${count}つの候補を安全にフォールバックして生成しました。正式データは変更されていません。`
        : completedNeuralJob?.mock
          ? `${count}つの明示的なMock候補を生成しました。採用するまで正式データは変更されません。`
          : `${count}つの候補を生成しました。正式データはまだ変更されていません。`);
    } catch {
      if (controller.signal.aborted) return;
      setAiJob((current) => ({
        ...current,
        state: "error",
        stage: "Generation failed",
        progress: 100,
        message: "Generation failed safely",
        canRetryOnCpu,
      }));
      onToast("候補生成に失敗しました。編集中の曲は安全です。設定を確認して再試行できます。");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        if (remoteRequestIdRef.current === neuralRequestId) {
          remoteRequestIdRef.current = null;
        }
      }
    }
  }, [
    backend,
    generatePreviewVariations,
    harmonyModel,
    onGenerated,
    onToast,
    preferenceCategory,
    preferenceModel,
    preferredDevice,
    regenerationStrength,
    regenerationTarget,
    requestServerCancellation,
    scheduleBackendRecovery,
    selectedBarRange,
    setBackend,
    setLastRankInfo,
    setNeuralPreviewMetadata,
    setRankingRuntime,
    setServerScores,
  ]);

  const regenerate = useCallback(
    () => regenerateWithDevice(),
    [regenerateWithDevice],
  );
  const retryOnCpu = useCallback(async () => {
    setPreferredDevice("cpu");
    await regenerateWithDevice("cpu");
  }, [regenerateWithDevice]);

  return {
    aiJob,
    harmonyModel,
    preferredDevice,
    setPreferredDevice,
    regenerationTarget,
    setRegenerationTarget,
    regenerationStrength,
    setRegenerationStrength,
    regenerate,
    retryOnCpu,
    cancel,
  };
}
