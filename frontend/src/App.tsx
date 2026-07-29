import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChordLane } from "./features/editor/ChordLane";
import { AutoFixPanel } from "./features/autoFix/AutoFixPanel";
import { DiagnosticsPanel } from "./features/diagnostics";
import { InspectorPanel } from "./features/editor/InspectorPanel";
import { SettingsPanel } from "./features/generator/SettingsPanel";
import { HistoryPanel } from "./features/history/HistoryPanel";
import { OnboardingTutorial } from "./features/onboarding/OnboardingTutorial";
import { PianoRoll } from "./features/pianoRoll/PianoRoll";
import { TransportBar } from "./features/playback/TransportBar";
import { PreferencePanel } from "./features/preference/PreferencePanel";
import { ProjectStatusBar } from "./features/status/ProjectStatusBar";
import { formatEngineLabel } from "./features/status/engineLabel";
import { RegenerationDock } from "./features/variations/RegenerationDock";
import { VariationPanel } from "./features/variations/VariationPanel";
import { useBackendConnection } from "./hooks/useBackendConnection";
import { useCandidateGeneration } from "./hooks/useCandidateGeneration";
import { useCandidateRanking } from "./hooks/useCandidateRanking";
import { useDiagnostics } from "./hooks/useDiagnostics";
import { useEditorKeyboardShortcuts } from "./hooks/useEditorKeyboardShortcuts";
import { usePlaybackController } from "./hooks/usePlaybackController";
import { usePreferenceLearning } from "./hooks/usePreferenceLearning";
import { useProjectImportExport } from "./hooks/useProjectImportExport";
import { usePreferenceProfile } from "./hooks/usePreferenceProfile";
import { useStorageCapacity } from "./hooks/useStorageCapacity";
import { createAutoFixPreview, validateComposition, type AutoFixResult } from "./music";
import {
  explainPreference,
  extractPreferenceFeatures,
  type PreferenceCategory,
} from "./preference";
import { useComposerStore, type NoteMove, type TickRange } from "./state";
import { getSafeStorage } from "./storage";
import type {
  BarRange,
  ChordEvent,
  GeneratedComposition,
  NoteEvent,
} from "./types/music";
import { formatBarBeat, modeLabel } from "./utils/musicFormat";
import type { NeuralHarmonyPreviewMetadata } from "./api/inferenceTypes";




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

const ONBOARDING_STORAGE_KEY = "music-theory-composer:onboarding:v1";
const appStorage = getSafeStorage();


export default function App() {
  const store = useComposerStore();
  const preferenceProfile = usePreferenceProfile();
  // Cross-cutting: several hooks report through the toast, so it is declared
  // before them and passed down rather than owned by any single one.
  const [toast, setToast] = useState<string | null>(null);
  const {
    backend,
    setBackend,
    online,
    backendCanInfer,
    refreshBackend,
    scheduleBackendRecovery,
  } = useBackendConnection();
  const [preferenceCategory, setPreferenceCategory] =
    useState<PreferenceCategory>("combined");
  const [neuralPreviewMetadata, setNeuralPreviewMetadata] = useState<
    Record<string, NeuralHarmonyPreviewMetadata>
  >({});
  const candidateFeatureSets = useMemo(
    () => store.previewVariations.map(extractPreferenceFeatures),
    [store.previewVariations],
  );

  const {
    candidates: variationCandidates,
    setServerScores,
    rankingRuntime,
    setRankingRuntime,
    lastRankInfo,
    setLastRankInfo,
    clearServerScores,
  } = useCandidateRanking({
    previewVariations: store.previewVariations,
    candidateFeatureSets,
    preferenceModel: preferenceProfile.model,
    preferenceCategory,
    neuralMetadataByCompositionId: neuralPreviewMetadata,
  });

  const [mutedTrackIds, setMutedTrackIds] = useState<string[]>([]);
  const [soloTrackId, setSoloTrackId] = useState<string | null>(null);
  const saveWarningRef = useRef<string | null>(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [copiedNoteIds, setCopiedNoteIds] = useState<string[]>([]);
  const [selectedChordId, setSelectedChordId] = useState<string | null>(null);
  const [historyCompareIds, setHistoryCompareIds] = useState<readonly string[]>([]);
  const [autoFix, setAutoFix] = useState<{
    result: AutoFixResult;
    historyIndex: number;
  } | null>(null);
  const [tutorialOpen, setTutorialOpen] = useState(
    () => appStorage.getItem(ONBOARDING_STORAGE_KEY) !== "complete",
  );
  const [mobilePanel, setMobilePanel] = useState<"settings" | "inspector" | null>(null);
  // Re-measured whenever a save lands, which is when the figure moves and when
  // the user is most likely to be looking at it.
  const storageCapacity = useStorageCapacity(store.lastSavedAt);

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
  const preferenceExplanation = useMemo(
    () => explainPreference(
      preferenceProfile.model,
      currentPreferenceFeatures,
      preferenceCategory,
    ),
    [currentPreferenceFeatures, preferenceCategory, preferenceProfile.model],
  );

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

  const clearSelection = useCallback(() => {
    setSelectedNoteIds([]);
    setSelectedChordId(null);
  }, []);

  const {
    importInputRef,
    preferenceImportInputRef,
    exportJson: handleExportJson,
    exportMidi: handleExportMidi,
    importProject: handleImport,
    exportPreferences: handlePreferenceExport,
    importPreferences: handlePreferenceImport,
  } = useProjectImportExport({
    composition,
    exportProjectJson: store.exportJson,
    importProjectJson: store.importJson,
    exportPreferenceJson: preferenceProfile.exportJson,
    importPreferenceJson: preferenceProfile.importJson,
    onImported: clearSelection,
    onPreferenceChanged: clearServerScores,
    onToast: setToast,
  });

  const {
    aiJob,
    harmonyModel,
    preferredDevice,
    setPreferredDevice,
    regenerationTarget,
    setRegenerationTarget,
    regenerationStrength,
    setRegenerationStrength,
    regenerate: handleRegenerate,
    retryOnCpu,
    cancel: cancelAiJob,
  } = useCandidateGeneration({
    selectedBarRange: store.selectedBarRange,
    generatePreviewVariations: store.generatePreviewVariations,
    backend,
    setBackend,
    scheduleBackendRecovery,
    preferenceModel: preferenceProfile.model,
    preferenceCategory,
    setServerScores,
    setRankingRuntime,
    setLastRankInfo,
    setNeuralPreviewMetadata,
    onGenerated: clearSelection,
    onToast: setToast,
  });

  const {
    browserCapabilities,
    diagnosticsOpen,
    setDiagnosticsOpen,
    audioError,
    setAudioError,
    backendDiagnostics,
    retryDiagnostics,
  } = useDiagnostics(backend, lastRankInfo, refreshBackend, aiJob);

  const {
    play: handlePlay,
    pause: handlePause,
    stop: handleStop,
  } = usePlaybackController({
    playbackComposition: store.committedComposition,
    playbackLoopRange: store.playbackLoopRange,
    mutedTrackIds,
    soloTrackId,
    onAudioError: setAudioError,
    onToast: setToast,
  });

  const {
    recordCandidateFeedback: handleCandidateFeedback,
    adoptCandidate: handleAdoptVariation,
  } = usePreferenceLearning({
    preferenceProfile,
    preferenceCategory,
    candidateFeatureSets,
    currentPreferenceFeatures,
    backendCanInfer,
    adoptPreviewVariation: store.adoptPreviewVariation,
    onPreferenceChanged: clearServerScores,
    onToast: setToast,
  });

  const closeDiagnostics = useCallback(
    () => setDiagnosticsOpen(false),
    [setDiagnosticsOpen],
  );
  const startPlayback = useCallback(() => void handlePlay(), [handlePlay]);

  useEditorKeyboardShortcuts({
    diagnosticsOpen,
    closeDiagnostics,
    hasSelectedNotes: selectedNoteIds.length > 0,
    play: startPlayback,
    pause: handlePause,
    deleteSelectedNotes: handleDeleteNote,
    onToast: setToast,
  });

  const handleEditChord = (symbol: string) => {
    if (!selectedChordId) return;
    try {
      const edited = store.editChord(selectedChordId, symbol);
      setToast(edited ? `${symbol} に変更しました。` : "コードを変更できませんでした。");
    } catch {
      setToast("コード記号を解釈できません。C、Am、F#m、Bdim などを入力してください。");
    }
  };






  const handleAuditionVariation = (index: number | null) => {
    if (!store.auditionPreviewVariation(index)) return;
    if (index !== null && store.playback.status !== "playing") {
      void handlePlay();
    }
  };




  const closeTutorial = useCallback(() => {
    appStorage.setItem(ONBOARDING_STORAGE_KEY, "complete");
    setTutorialOpen(false);
  }, []);





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
    aiJob,
  );
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
        storageCapacity={storageCapacity}
        online={online}
        connectionLabel={backend.state === "checking"
          ? "Checking local server"
          : backend.state === "browser"
            ? backend.reason === "api-mismatch" ? "API mismatch · Browser mode" : "Browser mode"
            : backend.inferenceAuthorized
              ? "Local server connected"
              : "Local server connected · access required"}
        onCancelAi={cancelAiJob}
        onRetryAiOnCpu={() => void retryOnCpu()}
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
            <AutoFixPanel
              result={autoFix?.result ?? null}
              stale={autoFix !== null && autoFix.historyIndex !== store.historyIndex}
              onAnalyze={() => {
                try {
                  const result = createAutoFixPreview(composition);
                  setAutoFix({ result, historyIndex: store.historyIndex });
                  setToast("修正案を作りました。確認するまで曲は変更されません。");
                } catch {
                  setToast("Auto Fixの診断に失敗しました。現在の曲は変更されていません。");
                }
              }}
              onApply={() => {
                if (!autoFix || autoFix.historyIndex !== store.historyIndex) return;
                if (store.adoptAutoFixPreview(autoFix.result.preview)) {
                  setSelectedNoteIds([]);
                  setSelectedChordId(null);
                  setAutoFix(null);
                  setToast("Auto Fixを適用しました。Undoで元に戻せます。");
                } else {
                  setToast("修正版を適用できませんでした。現在の曲は変更されていません。");
                }
              }}
              onDismiss={() => setAutoFix(null)}
            />
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
              mutedTrackIds={mutedTrackIds}
              soloTrackId={soloTrackId}
              onToggleTrackMute={(trackId) => {
                setMutedTrackIds((current) =>
                  current.includes(trackId)
                    ? current.filter((candidate) => candidate !== trackId)
                    : [...current, trackId],
                );
                setToast(
                  `${trackId === "track-bass" ? "Bass" : trackId === "track-chords" ? "Chords" : "Melody"}のミュートを切り替えました。`,
                );
              }}
              onSoloTrack={(trackId) => {
                setSoloTrackId(trackId);
                setToast(trackId ? "選択したトラックだけを再生します。" : "全トラック再生へ戻しました。");
              }}
              onToggleVoiceMute={(voiceId) => {
                if (store.toggleVoiceMute(voiceId)) {
                  const voice = store.draftComposition.voices?.find(
                    (candidate) => candidate.id === voiceId,
                  );
                  setToast(`${voice?.name ?? "追加声部"}を${voice?.muted ? "ミュート" : "再生"}します。`);
                }
              }}
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
            processing={aiJob.state === "running" || aiJob.state === "cancelling"}
            harmonyModel={harmonyModel}
            preferredDevice={preferredDevice}
            onTargetChange={setRegenerationTarget}
            onStrengthChange={setRegenerationStrength}
            onPreferredDeviceChange={setPreferredDevice}
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
