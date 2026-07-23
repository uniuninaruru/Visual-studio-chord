import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  detectLocalBackend,
  captureLocalAccessToken,
  isLocalAccessError,
  isLocalConnectivityError,
  LocalApiError,
  rankCandidates as rankCandidatesOnServer,
  updateServerPreference,
  type BackendConnection,
} from "./api/inferenceClient";
import { CompositionTransport } from "./audio/transport";
import { ChordLane } from "./features/editor/ChordLane";
import {
  DiagnosticsPanel,
  type BackendDiagnostics,
  type UserFacingDiagnosticError,
} from "./features/diagnostics";
import { InspectorPanel } from "./features/editor/InspectorPanel";
import { importCompositionFile, midiBlob } from "./features/export";
import { SettingsPanel } from "./features/generator/SettingsPanel";
import { HistoryPanel } from "./features/history/HistoryPanel";
import { OnboardingTutorial } from "./features/onboarding/OnboardingTutorial";
import { PianoRoll } from "./features/pianoRoll/PianoRoll";
import { TransportBar } from "./features/playback/TransportBar";
import { PreferencePanel } from "./features/preference/PreferencePanel";
import {
  ProjectStatusBar,
  type AiJobStatus,
} from "./features/status/ProjectStatusBar";
import { formatEngineLabel } from "./features/status/engineLabel";
import { RegenerationDock } from "./features/variations/RegenerationDock";
import { VariationPanel } from "./features/variations/VariationPanel";
import { sortVariationCandidates } from "./features/variations/variationRanking";
import { usePreferenceProfile } from "./hooks/usePreferenceProfile";
import { validateComposition } from "./music";
import {
  explainPreference,
  extractPreferenceFeatures,
  scorePreference,
  type ExplicitFeedbackType,
  type PreferenceCategory,
  type PreferenceFeatureSet,
} from "./preference";
import {
  detectBrowserCapabilities,
  type BrowserCapabilities,
} from "./platform";
import { useComposerStore, type NoteMove, type TickRange } from "./state";
import { getSafeStorage } from "./storage";
import type {
  BarRange,
  ChordEvent,
  GeneratedComposition,
  NoteEvent,
  RegenerationStrength,
  RegenerationTarget,
} from "./types/music";
import { downloadBlob, formatBarBeat, modeLabel } from "./utils/musicFormat";

function compositionFilename(seed: string, extension: "json" | "mid"): string {
  const safeSeed = seed.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 32) || "composition";
  return `visual-studio-chord-${safeSeed}.${extension}`;
}

function serverPreferenceCategory(category: PreferenceCategory) {
  return category === "harmony" ? "chords" as const : category;
}

function featureVector(features: PreferenceFeatureSet, category: PreferenceCategory) {
  return features[category];
}

function formatLoopLabel(composition: GeneratedComposition, range: TickRange): string {
  const startBar = Math.floor(range.startTick / composition.ticksPerBar) + 1;
  const endBar = Math.ceil(range.endTick / composition.ticksPerBar);
  return startBar === 1 && endBar === composition.bars.length
    ? "全体ループ"
    : `${startBar}–${endBar} 小節ループ`;
}

function mapPlaybackTickToDraft(
  tick: number,
  audible: GeneratedComposition,
  draft: GeneratedComposition,
): number {
  if (audible.ticksPerBar === draft.ticksPerBar) return tick;
  const safeTick = Math.max(0, tick);
  const bar = Math.floor(safeTick / audible.ticksPerBar);
  const barProgress = (safeTick % audible.ticksPerBar) / audible.ticksPerBar;
  return Math.min(
    draft.totalTicks,
    bar * draft.ticksPerBar + Math.round(barProgress * draft.ticksPerBar),
  );
}

const FEEDBACK_LABELS: Record<ExplicitFeedbackType, string> = {
  like: "Like",
  dislike: "Dislike",
  favorite: "Favorite",
  notMyStyle: "Not my style",
};

const ONBOARDING_STORAGE_KEY = "music-theory-composer:onboarding:v1";
const appStorage = getSafeStorage();
const BACKEND_STARTUP_RETRY_DELAYS_MS = [0, 500, 1_500, 3_000, 6_000] as const;

function fallbackLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (/oom/i.test(reason)) return "GPU memory limit · batch reduced or CPU fallback";
  if (/unavailable/i.test(reason)) return "Requested runtime unavailable · CPU fallback";
  if (/autoloadfailed/i.test(reason)) return "Accelerated model load failed · safe fallback";
  if (/invalidpreference/i.test(reason)) return "Invalid runtime setting · CPU fallback";
  return "Runtime fallback applied";
}

export default function App() {
  const store = useComposerStore();
  const preferenceProfile = usePreferenceProfile();
  const transportRef = useRef<CompositionTransport | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const preferenceImportInputRef = useRef<HTMLInputElement | null>(null);
  const aiControllerRef = useRef<AbortController | null>(null);
  const backendRetryTimerRef = useRef<number | null>(null);
  const saveWarningRef = useRef<string | null>(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [copiedNoteIds, setCopiedNoteIds] = useState<string[]>([]);
  const [selectedChordId, setSelectedChordId] = useState<string | null>(null);
  const [regenerationTarget, setRegenerationTarget] = useState<RegenerationTarget>("all");
  const [regenerationStrength, setRegenerationStrength] =
    useState<RegenerationStrength>("moderate");
  const [backend, setBackend] = useState<BackendConnection>({ state: "checking" });
  const [preferenceCategory, setPreferenceCategory] =
    useState<PreferenceCategory>("combined");
  const [historyCompareIds, setHistoryCompareIds] = useState<readonly string[]>([]);
  const [serverScores, setServerScores] = useState<Record<string, number>>({});
  const [rankingRuntime, setRankingRuntime] = useState<string>("browser");
  const [lastRankInfo, setLastRankInfo] = useState<{
    runtime: string;
    batchSize: number | null;
    fallback: string | null;
  } | null>(null);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(
    () => appStorage.getItem(ONBOARDING_STORAGE_KEY) !== "complete",
  );
  const [browserCapabilities, setBrowserCapabilities] =
    useState<BrowserCapabilities | null>(null);
  const [audioError, setAudioError] = useState<UserFacingDiagnosticError | null>(null);
  const [aiJob, setAiJob] = useState<AiJobStatus>({
    state: "idle",
    label: "Ready",
    stage: "Idle",
    progress: 0,
    startedAt: null,
    device: "browser",
    backend: "browser-linear",
  });
  const [toast, setToast] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"settings" | "inspector" | null>(null);
  const backendCanInfer = backend.state === "connected" && backend.inferenceAuthorized;

  const composition = store.draftComposition;
  const playbackComposition = store.committedComposition;
  const selectedNoteId = selectedNoteIds.at(-1) ?? null;
  const selectedNote = composition.notes.find((note) => note.id === selectedNoteId) ?? null;
  const selectedChord = composition.chords.find((chord) => chord.id === selectedChordId) ?? null;
  const validation = validateComposition(composition);
  const currentPreferenceFeatures = useMemo(
    () => extractPreferenceFeatures(composition),
    [composition],
  );
  const candidateFeatureSets = useMemo(
    () => store.previewVariations.map(extractPreferenceFeatures),
    [store.previewVariations],
  );
  const preferenceExplanation = useMemo(
    () => explainPreference(
      preferenceProfile.model,
      currentPreferenceFeatures,
      preferenceCategory,
    ),
    [currentPreferenceFeatures, preferenceCategory, preferenceProfile.model],
  );
  const variationCandidates = useMemo(
    () => sortVariationCandidates(store.previewVariations.map((candidate, index) => {
      const features = candidateFeatureSets[index] as PreferenceFeatureSet;
      const local = scorePreference(preferenceProfile.model, features, preferenceCategory);
      const serverScore = serverScores[candidate.id];
      return {
        composition: candidate,
        sourceIndex: index,
        preference: serverScore === undefined
          ? local
          : { ...local, rawScore: serverScore, score: Math.tanh(serverScore) },
      };
    })),
    [
      candidateFeatureSets,
      preferenceCategory,
      preferenceProfile.model,
      serverScores,
      store.previewVariations,
    ],
  );

  useEffect(() => {
    const transport = new CompositionTransport();
    transportRef.current = transport;
    return () => {
      transport.dispose();
      transportRef.current = null;
    };
  }, []);

  useEffect(() => {
    captureLocalAccessToken();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void detectBrowserCapabilities().then((capabilities) => {
      if (!cancelled) setBrowserCapabilities(capabilities);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshBackend = async () => {
    setBackend({ state: "checking" });
    setBackend(await detectLocalBackend());
  };

  const scheduleBackendRecovery = useCallback((delay = 1_500) => {
    if (backendRetryTimerRef.current !== null) {
      window.clearTimeout(backendRetryTimerRef.current);
    }
    backendRetryTimerRef.current = window.setTimeout(() => {
      backendRetryTimerRef.current = null;
      void detectLocalBackend().then(setBackend);
    }, delay);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    const probe = async (attempt: number) => {
      const connection = await detectLocalBackend();
      if (cancelled) return;
      setBackend(connection);
      if (
        connection.state === "browser"
        && connection.reason === "unreachable"
        && attempt + 1 < BACKEND_STARTUP_RETRY_DELAYS_MS.length
      ) {
        retryTimer = window.setTimeout(
          () => void probe(attempt + 1),
          BACKEND_STARTUP_RETRY_DELAYS_MS[attempt + 1],
        );
      }
    };
    void probe(0);
    const handleOnline = () => {
      setOnline(true);
      scheduleBackendRecovery(0);
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (backendRetryTimerRef.current !== null) {
        window.clearTimeout(backendRetryTimerRef.current);
        backendRetryTimerRef.current = null;
      }
      aiControllerRef.current?.abort();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [scheduleBackendRecovery]);

  useEffect(() => {
    const transport = transportRef.current;
    if (!transport) return;
    const handleTick = (tick: number) => {
      const before = useComposerStore.getState().committedComposition;
      useComposerStore.getState().setCurrentTick(tick);
      const after = useComposerStore.getState();
      if (after.committedComposition !== before) {
        transport.configure(
          after.committedComposition,
          after.playbackLoopRange,
          handleTick,
        );
      }
    };
    transport.configure(playbackComposition, store.playbackLoopRange, handleTick);
  }, [playbackComposition, store.playbackLoopRange]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2_800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (
      store.projectSaveStatus !== "partial"
      && store.projectSaveStatus !== "session"
      && store.projectSaveStatus !== "recovery"
      && store.projectSaveStatus !== "error"
    ) return;
    if (saveWarningRef.current === store.projectSaveStatus) return;
    saveWarningRef.current = store.projectSaveStatus;
    setToast(
      store.projectSaveStatus === "recovery"
        ? store.projectRecoveryReason === "unsupported"
          ? "このプロジェクトは新しいアプリ形式で保存されています。上書きは停止中です。アプリを更新するか、互換JSONをImportしてください。"
          : "保存済みプロジェクトが破損しているため、上書きを停止しました。正しいJSONをImportするか、内容を置き換えてよい場合だけResetしてください。"
        : store.projectSaveStatus === "partial"
        ? "現在の曲はローカル保存済みですが、Undo履歴の一部は保存できないか復旧されました。履歴は画面内に保持されています。閉じる前に現在の曲をJSONへ書き出してください。"
        : store.projectSaveStatus === "session"
          ? "永続ストレージを利用できないため、このセッション内だけに保存しています。閉じる前にJSONを書き出してください。"
          : "ローカル保存に失敗しました。曲は画面内に保持されています。空き容量を確認し、JSONを書き出してください。",
    );
  }, [store.projectRecoveryReason, store.projectSaveStatus]);

  const handlePlay = useCallback(async () => {
    try {
      await transportRef.current?.play();
      useComposerStore.getState().setPlaybackStatus("playing");
      setAudioError(null);
    } catch {
      setAudioError({
        title: "音声再生を開始できませんでした",
        message: "ブラウザまたはOSがAudioContextの開始を拒否しました。曲データとAI処理は安全です。",
        remedy: "ページの音声許可と出力デバイスを確認し、Playをもう一度押してください。",
        canRetry: true,
        diagnosticCode: "AUDIO_CONTEXT_START_FAILED",
      });
      setToast("ブラウザの音声を開始できませんでした。ページの音声許可を確認してください。");
    }
  }, []);

  const handlePause = useCallback(() => {
    transportRef.current?.pause();
    useComposerStore.getState().setPlaybackStatus("paused");
  }, []);

  const handleStop = () => {
    transportRef.current?.stop();
    store.setPlaybackStatus("stopped");
  };

  const handleGenerate = () => {
    store.generateComposition();
    setSelectedNoteIds([]);
    setSelectedChordId(null);
    setToast("同じシードで再現できる新しい曲を生成しました。");
  };

  const handleBarSelect = (barIndex: number, extend: boolean) => {
    let range: BarRange;
    if (extend && store.selectedBarRange) {
      range = {
        startBar: Math.min(store.selectedBarRange.startBar, barIndex),
        endBar: Math.max(store.selectedBarRange.endBar, barIndex + 1),
      };
    } else {
      range = { startBar: barIndex, endBar: barIndex + 1 };
    }
    store.setSelectedRange(range);
  };

  const handleChordSelect = (chord: ChordEvent) => {
    setSelectedChordId(chord.id);
    setSelectedNoteIds([]);
  };

  const handleNoteSelect = (note: NoteEvent, extend = false) => {
    setSelectedNoteIds((current) => {
      if (!extend) return [note.id];
      return current.includes(note.id)
        ? current.filter((id) => id !== note.id)
        : [...current, note.id];
    });
    setSelectedChordId(null);
    store.setSelectedRange({ startBar: note.barIndex, endBar: note.barIndex + 1 });
  };

  const handleMoveNote = (move: NoteMove) => {
    if (selectedNoteIds.length === 0) return;
    store.moveNotes(selectedNoteIds, move);
  };

  const handleDeleteNote = useCallback(() => {
    if (selectedNoteIds.length === 0) return;
    const deleted = useComposerStore.getState().deleteNotes(selectedNoteIds);
    setSelectedNoteIds([]);
    setToast(`${deleted}個のノートを削除しました。Undoで戻せます。`);
  }, [selectedNoteIds]);

  const handleEditChord = (symbol: string) => {
    if (!selectedChordId) return;
    try {
      const edited = store.editChord(selectedChordId, symbol);
      setToast(edited ? `${symbol} に変更しました。` : "コードを変更できませんでした。");
    } catch {
      setToast("コード記号を解釈できません。C、Am、F#m、Bdim などを入力してください。");
    }
  };

  const cancelAiJob = () => {
    aiControllerRef.current?.abort();
    aiControllerRef.current = null;
    setAiJob((current) => ({
      ...current,
      state: "cancelled",
      label: "Cancelled · composition unchanged",
      stage: "Cancelled",
    }));
    setToast("AI処理をキャンセルしました。編集中の曲は変更されていません。");
  };

  const handleRegenerate = async () => {
    if (!store.selectedBarRange) {
      setToast("先にコードレーンで小節を選択してください。");
      return;
    }
    aiControllerRef.current?.abort();
    const controller = new AbortController();
    aiControllerRef.current = controller;
    const startedAt = Date.now();
    const engine = backendCanInfer
      ? `Local ${backend.models.activeRuntime.toUpperCase()}`
      : "Browser linear / theory";
    setAiJob({
      state: "running",
      label: "Generating candidates",
      stage: "Generating 3 candidates",
      progress: 8,
      startedAt,
      device: backendCanInfer ? backend.models.activeRuntime : "browser",
      backend: backendCanInfer ? backend.models.activeModel : "browser-linear",
    });

    try {
      // Yield once so controls, playback, and the progress state paint first.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (controller.signal.aborted) return;
      const count = await store.generatePreviewVariations(
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
        setToast("候補の理論検証に失敗しました。編集中の曲は安全です。設定を変えて再試行できます。");
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
      if (backendCanInfer) {
        try {
          const response = await rankCandidatesOnServer(
            previews.map((candidate, index) => ({
              id: candidate.id,
              features: featureVector(features[index] as PreferenceFeatureSet, preferenceCategory),
            })),
            preferenceProfile.model.categories[preferenceCategory].weights,
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
      setSelectedNoteIds([]);
      setSelectedChordId(null);
      setAiJob((current) => ({
        ...current,
        state: "completed",
        label: `${count} candidates ready · ${usedRuntime}${completedFallback ? ` · ${completedFallback}` : ""}`,
        stage: "Complete",
        progress: 100,
      }));
      setToast(usedBrowserFallback
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
      setToast("候補生成に失敗しました。編集中の曲は安全です。設定を確認して再試行できます。");
    } finally {
      if (aiControllerRef.current === controller) aiControllerRef.current = null;
    }
  };

  const syncPreferenceToServer = (
    features: PreferenceFeatureSet,
    feedback: "like" | "dislike" | "favorite" | "notMyStyle" | "abSelected" | "adopted",
  ) => {
    if (!backendCanInfer) return;
    void updateServerPreference(
      serverPreferenceCategory(preferenceCategory),
      feedback,
      featureVector(features, preferenceCategory),
    ).catch(() => {
      setToast("評価はこのブラウザに保存しました。ローカル推論サーバーへの同期だけ失敗しました。");
    });
  };

  const handleCandidateFeedback = (index: number, feedback: ExplicitFeedbackType) => {
    const features = candidateFeatureSets[index];
    if (!features) return;
    preferenceProfile.record({ type: feedback, features, category: preferenceCategory });
    syncPreferenceToServer(features, feedback);
    setServerScores({});
    setToast(`${FEEDBACK_LABELS[feedback]} を記録しました。根拠が十分になるまで好みを断定しません。`);
  };

  const handleAdoptVariation = (index: number) => {
    const winner = candidateFeatureSets[index];
    if (!winner) return;
    preferenceProfile.record({
      type: "ab",
      winner,
      loser: currentPreferenceFeatures,
      category: preferenceCategory,
    });
    syncPreferenceToServer(winner, "abSelected");
    if (store.adoptPreviewVariation(index)) {
      setServerScores({});
      setToast(`候補 ${String.fromCharCode(65 + index)} を採用し、履歴へ保存しました。Undoで戻せます。`);
    }
  };

  const handleAuditionVariation = (index: number | null) => {
    if (!store.auditionPreviewVariation(index)) return;
    if (index !== null && store.playback.status !== "playing") {
      void handlePlay();
    }
  };

  const handlePreferenceExport = () => {
    downloadBlob(
      new Blob([preferenceProfile.exportJson()], { type: "application/json;charset=utf-8" }),
      "visual-studio-chord-preferences-v1.json",
    );
    setToast("好み学習データを書き出しました。");
  };

  const handlePreferenceImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("学習データが大きすぎます（上限2 MB）。");
      await preferenceProfile.importJson(await file.text());
      setServerScores({});
      setToast("好み学習データを安全に読み込みました。");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "学習データを読み込めませんでした。");
    } finally {
      if (preferenceImportInputRef.current) preferenceImportInputRef.current.value = "";
    }
  };

  const retryDiagnostics = () => {
    setBrowserCapabilities(null);
    void Promise.all([
      detectBrowserCapabilities().then(setBrowserCapabilities),
      refreshBackend(),
    ]).then(() => setToast("環境診断を更新しました。"));
  };

  const closeTutorial = useCallback(() => {
    appStorage.setItem(ONBOARDING_STORAGE_KEY, "complete");
    setTutorialOpen(false);
  }, []);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target;
      const editingText = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable);
      if (event.key === "Escape" && diagnosticsOpen) {
        setDiagnosticsOpen(false);
        return;
      }
      if (editingText) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (useComposerStore.getState().playback.status === "playing") handlePause();
        else void handlePlay();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        const state = useComposerStore.getState();
        const changed = event.shiftKey ? state.redo() : state.undo();
        setToast(changed ? (event.shiftKey ? "Redoしました。" : "Undoしました。") : "これ以上履歴がありません。");
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedNoteIds.length > 0) {
        event.preventDefault();
        handleDeleteNote();
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [diagnosticsOpen, handleDeleteNote, handlePause, handlePlay, selectedNoteIds]);

  const handleExportJson = () => {
    const blob = new Blob([store.exportJson()], { type: "application/json;charset=utf-8" });
    downloadBlob(blob, compositionFilename(String(composition.seed), "json"));
    setToast("編集可能なJSONを書き出しました。");
  };

  const handleExportMidi = () => {
    downloadBlob(midiBlob(composition), compositionFilename(String(composition.seed), "mid"));
    setToast("コードとメロディのMIDIを書き出しました。");
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = await importCompositionFile(file);
      store.importJson(imported.json);
      setSelectedNoteIds([]);
      setSelectedChordId(null);
      setToast("JSONから楽曲を復元しました。");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "JSONを読み込めませんでした。");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const loopLabel = formatLoopLabel(playbackComposition, store.playbackLoopRange);
  const draftLoopLabel = formatLoopLabel(composition, store.loopRange);
  const pendingLoopLabel = store.pendingCommit && draftLoopLabel !== loopLabel
    ? draftLoopLabel
    : null;
  const editorCurrentTick = mapPlaybackTickToDraft(
    store.playback.currentTick,
    playbackComposition,
    composition,
  );
  const engineLabel = formatEngineLabel(
    backendCanInfer,
    backend.state === "connected" ? backend.models.activeRuntime : "cpu",
    rankingRuntime,
    aiJob.state,
  );
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
  const diagnosticProjectStorageMode = store.projectSaveStatus === "recovery"
    ? store.projectRecoveryReason === "unsupported"
      ? "unsupported" as const
      : "recovery" as const
    : store.projectSaveStatus === "error"
    ? "unavailable" as const
    : store.projectSaveStatus === "session"
      ? "memory" as const
      : "localStorage" as const;
  const diagnosticHistoryStorageMode = store.projectSaveStatus === "error"
    ? "unavailable" as const
    : store.projectSaveStatus === "saving"
      ? "pending" as const
    : store.projectSaveStatus === "saved"
      ? "localStorage" as const
      : "memory" as const;
  const diagnosticPreferenceStorageMode = preferenceProfile.persistenceMode === "indexedDB"
    ? "indexeddb" as const
    : preferenceProfile.persistenceMode === "localStorage"
      ? "localStorage" as const
      : "memory" as const;
  const modalOpen = diagnosticsOpen || tutorialOpen;

  return (
    <div className="app-shell">
      <div className="app-content" inert={modalOpen} aria-hidden={modalOpen}>
      <TransportBar
        status={store.playback.status}
        position={formatBarBeat(
          store.playback.currentTick,
          playbackComposition.ppq,
          playbackComposition.ticksPerBar,
        )}
        bpm={playbackComposition.settings.bpm}
        loopLabel={loopLabel}
        canUndo={store.historyIndex > 0}
        canRedo={store.historyIndex < store.history.length - 1}
        pendingCommit={store.pendingCommit}
        updateTiming={store.playback.updateTiming}
        onPlay={() => void handlePlay()}
        onPause={handlePause}
        onStop={handleStop}
        onUndo={() => {
          setToast(store.undo() ? "Undoしました。再生位置は維持されます。" : "これ以上Undoできません。");
        }}
        onRedo={() => {
          setToast(store.redo() ? "Redoしました。再生位置は維持されます。" : "これ以上Redoできません。");
        }}
        onUpdateTiming={store.setUpdateTiming}
        onExport={() => document.getElementById("export-panel")?.scrollIntoView({ behavior: "smooth" })}
      />

      <ProjectStatusBar
        playback={store.playback.status}
        currentTick={store.playback.currentTick}
        ticksPerBar={playbackComposition.ticksPerBar}
        loopLabel={loopLabel}
        pendingLoopLabel={pendingLoopLabel}
        pendingCommit={store.pendingCommit}
        updateTiming={store.playback.updateTiming}
        aiJob={aiJob}
        engineLabel={engineLabel}
        saveStatus={store.projectSaveStatus}
        lastSavedAt={store.lastSavedAt}
        online={online}
        connectionLabel={backend.state === "checking"
          ? "Checking local server"
          : backend.state === "browser"
            ? backend.reason === "api-mismatch" ? "API mismatch · Browser mode" : "Browser mode"
            : backend.inferenceAuthorized
              ? "Local server connected"
              : "Local server connected · access required"}
        onCancelAi={cancelAiJob}
        onOpenDiagnostics={() => setDiagnosticsOpen(true)}
      />

      <main className="app-layout">
        <SettingsPanel
          settings={store.settings}
          backend={backend}
          mobileOpen={mobilePanel === "settings"}
          onPatch={store.updateSettings}
          onGenerate={handleGenerate}
          onReset={() => {
            if (!window.confirm("曲・履歴・編集内容を初期状態へ戻します。JSONへ書き出していない履歴は復元できません。続けますか？")) return;
            store.reset();
            setSelectedNoteIds([]);
            setSelectedChordId(null);
            setToast("初期状態へ戻しました。");
          }}
          onOpenDiagnostics={() => setDiagnosticsOpen(true)}
          onMobileClose={() => setMobilePanel(null)}
        />

        <div className="composition-workspace">
          <div className="workspace-header">
            <div>
              <div className="composition-title-row">
                <h1>{composition.settings.key} {modeLabel(composition.settings.mode)}</h1>
                <span className="style-badge">{composition.resolvedStyle}</span>
              </div>
              <p>{composition.settings.timeSignature} · {composition.bars.length} bars · Seed {composition.seed}</p>
            </div>
            <div className="workspace-status">
              <span className={validation.valid ? "valid" : "invalid"}>
                <i />{validation.valid ? "Theory valid" : `${validation.errors.length} errors`}
              </span>
              <span>{composition.cadence} cadence</span>
              <button type="button" onClick={() => setTutorialOpen(true)} title="初回ガイドを再表示">
                Help
              </button>
            </div>
            <div className="mobile-panel-switcher">
              <button type="button" onClick={() => setMobilePanel("settings")}>生成設定</button>
              <button type="button" onClick={() => setMobilePanel("inspector")}>インスペクター</button>
            </div>
          </div>

          <div className="workspace-scroll">
            <ChordLane
              composition={composition}
              selectedRange={store.selectedBarRange}
              selectedChordId={selectedChordId}
              currentTick={editorCurrentTick}
              lockedBars={store.lockedBars}
              onBarSelect={handleBarSelect}
              onChordSelect={handleChordSelect}
              onToggleLock={store.toggleBarLock}
            />
            <PianoRoll
              composition={composition}
              currentTick={editorCurrentTick}
              selectedRange={store.selectedBarRange}
              selectedNoteIds={selectedNoteIds}
              onNoteSelect={handleNoteSelect}
              onNoteMove={(note, move) => {
                const ids = selectedNoteIds.includes(note.id) ? selectedNoteIds : [note.id];
                store.moveNotes(ids, move);
              }}
              onAddNote={(midi, startTick) => {
                const id = store.addNote(midi, startTick);
                if (id) setSelectedNoteIds([id]);
              }}
              onCopyNotes={() => {
                setCopiedNoteIds([...selectedNoteIds]);
                setToast(`${selectedNoteIds.length}個のノートをコピーしました。`);
              }}
              onPasteNotes={() => {
                const ids = store.duplicateNotes(copiedNoteIds);
                setSelectedNoteIds(ids);
                if (ids.length > 0) setToast(`${ids.length}個のノートを貼り付けました。`);
              }}
              onDuplicateNotes={() => {
                setSelectedNoteIds(store.duplicateNotes(selectedNoteIds));
              }}
              onQuantizeNotes={() => {
                const count = store.quantizeNotes(selectedNoteIds);
                if (count > 0) setToast(`${count}個のノートを1/16へクオンタイズしました。`);
              }}
              onDeleteNotes={handleDeleteNote}
              canPaste={copiedNoteIds.length > 0}
              clipboardNoteCount={copiedNoteIds.length}
            />
            <VariationPanel
              candidates={variationCandidates}
              activeAuditionIndex={store.auditionedVariationIndex}
              onAudition={handleAuditionVariation}
              onAdopt={handleAdoptVariation}
              onFeedback={handleCandidateFeedback}
            />
            <div className="phase-two-panel-grid">
              <PreferencePanel
                explanation={preferenceExplanation}
                category={preferenceCategory}
                onCategoryChange={(category) => {
                  setPreferenceCategory(category);
                  // Scores returned for the previous feature namespace cannot
                  // be reused for another preference category.
                  setServerScores({});
                  setRankingRuntime("browser-linear");
                }}
                onExport={handlePreferenceExport}
                onImport={() => preferenceImportInputRef.current?.click()}
                onReset={() => {
                  if (!window.confirm("好み学習データを完全に削除します。書き出していないデータは復元できません。続けますか？")) return;
                  void preferenceProfile.reset().then(() => {
                    setServerScores({});
                    setToast("好み学習をリセットしました。");
                  });
                }}
              />
              <HistoryPanel
                entries={store.history}
                currentHistoryId={store.history[store.historyIndex]?.id ?? null}
                compareIds={historyCompareIds}
                onCompareChange={setHistoryCompareIds}
                onRename={(historyId, name) => {
                  if (store.renameHistoryEntry(historyId, name)) setToast("履歴名を保存しました。");
                }}
                onRestore={(historyId) => {
                  if (store.restoreHistoryEntry(historyId)) {
                    setSelectedNoteIds([]);
                    setSelectedChordId(null);
                    setToast("選択したバージョンを復元しました。復元操作も履歴に保存されています。");
                  }
                }}
              />
            </div>
          </div>

          <RegenerationDock
            selectedRange={store.selectedBarRange}
            lockedCount={store.lockedBars.length}
            target={regenerationTarget}
            strength={regenerationStrength}
            processing={aiJob.state === "running"}
            onTargetChange={setRegenerationTarget}
            onStrengthChange={setRegenerationStrength}
            onRegenerate={() => void handleRegenerate()}
            onSelectAll={() => store.setSelectedRange({ startBar: 0, endBar: composition.bars.length })}
          />
        </div>

        <InspectorPanel
          composition={composition}
          mobileOpen={mobilePanel === "inspector"}
          selectedNote={selectedNote}
          selectedChord={selectedChord}
          selectedRange={store.selectedBarRange}
          validation={validation}
          backend={backend}
          onEditChord={handleEditChord}
          onMoveNote={handleMoveNote}
          onDeleteNote={handleDeleteNote}
          onClearSelection={() => {
            setSelectedNoteIds([]);
            setSelectedChordId(null);
          }}
          onExportJson={handleExportJson}
          onExportMidi={handleExportMidi}
          onImportJson={() => importInputRef.current?.click()}
          onMobileClose={() => setMobilePanel(null)}
        />
      </main>

      {mobilePanel && (
        <button
          className="mobile-backdrop"
          type="button"
          onClick={() => setMobilePanel(null)}
          aria-label="パネルを閉じる"
        />
      )}

      <input
        ref={importInputRef}
        className="visually-hidden"
        type="file"
        accept="application/json,.json"
        onChange={(event) => void handleImport(event.target.files?.[0])}
        aria-label="楽曲JSONを読み込む"
      />
      <input
        ref={preferenceImportInputRef}
        className="visually-hidden"
        type="file"
        accept="application/json,.json"
        onChange={(event) => void handlePreferenceImport(event.target.files?.[0])}
        aria-label="好み学習JSONを読み込む"
      />
      </div>

      {diagnosticsOpen && (
        <DiagnosticsPanel
          browserCapabilities={browserCapabilities}
          backend={backendDiagnostics}
          projectStorageMode={diagnosticProjectStorageMode}
          historyStorageMode={diagnosticHistoryStorageMode}
          preferenceStorageMode={diagnosticPreferenceStorageMode}
          audioError={audioError}
          onRetry={retryDiagnostics}
          onClose={() => setDiagnosticsOpen(false)}
        />
      )}

      {tutorialOpen && <OnboardingTutorial onClose={closeTutorial} />}

      {toast && (
        <div className="toast" role="status">
          <span><IconCheck /></span>
          {toast}
        </div>
      )}
    </div>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m4 10 4 4 8-9" />
    </svg>
  );
}
