import { useEffect, useRef, useState } from "react";
import { detectLocalBackend, type BackendConnection } from "./api/inferenceClient";
import { CompositionTransport } from "./audio/transport";
import { ChordLane } from "./features/editor/ChordLane";
import { InspectorPanel } from "./features/editor/InspectorPanel";
import { midiBlob } from "./features/export";
import { SettingsPanel } from "./features/generator/SettingsPanel";
import { PianoRoll } from "./features/pianoRoll/PianoRoll";
import { TransportBar } from "./features/playback/TransportBar";
import { RegenerationDock } from "./features/variations/RegenerationDock";
import { validateComposition } from "./music";
import { useComposerStore, type NoteMove } from "./state";
import type { BarRange, ChordEvent, NoteEvent, RegenerationTarget } from "./types/music";
import { downloadBlob, formatBarBeat } from "./utils/musicFormat";

function compositionFilename(seed: string, extension: "json" | "mid"): string {
  const safeSeed = seed.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 32) || "composition";
  return `harmony-lab-${safeSeed}.${extension}`;
}

export default function App() {
  const store = useComposerStore();
  const transportRef = useRef<CompositionTransport | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedChordId, setSelectedChordId] = useState<string | null>(null);
  const [regenerationTarget, setRegenerationTarget] = useState<RegenerationTarget>("all");
  const [backend, setBackend] = useState<BackendConnection>({ state: "checking" });
  const [toast, setToast] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"settings" | "inspector" | null>(null);

  const composition = store.draftComposition;
  const playbackComposition = store.committedComposition;
  const selectedNote = composition.notes.find((note) => note.id === selectedNoteId) ?? null;
  const selectedChord = composition.chords.find((chord) => chord.id === selectedChordId) ?? null;
  const validation = validateComposition(composition);

  useEffect(() => {
    const transport = new CompositionTransport();
    transportRef.current = transport;
    return () => {
      transport.dispose();
      transportRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void detectLocalBackend().then((connection) => {
      if (!cancelled) setBackend(connection);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const transport = transportRef.current;
    if (!transport) return;
    const handleTick = (tick: number) => {
      const before = useComposerStore.getState().committedComposition;
      useComposerStore.getState().setCurrentTick(tick);
      const after = useComposerStore.getState();
      if (after.committedComposition !== before) {
        transport.configure(after.committedComposition, after.loopRange, handleTick);
      }
    };
    transport.configure(playbackComposition, store.loopRange, handleTick);
  }, [playbackComposition, store.loopRange]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2_800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const handlePlay = async () => {
    try {
      await transportRef.current?.play();
      store.setPlaybackStatus("playing");
    } catch {
      setToast("ブラウザの音声を開始できませんでした。ページの音声許可を確認してください。");
    }
  };

  const handlePause = () => {
    transportRef.current?.pause();
    store.setPlaybackStatus("paused");
  };

  const handleStop = () => {
    transportRef.current?.stop();
    store.setPlaybackStatus("stopped");
  };

  const handleGenerate = () => {
    store.generateComposition();
    setSelectedNoteId(null);
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
    setSelectedNoteId(null);
  };

  const handleNoteSelect = (note: NoteEvent) => {
    setSelectedNoteId(note.id);
    setSelectedChordId(null);
    store.setSelectedRange({ startBar: note.barIndex, endBar: note.barIndex + 1 });
  };

  const handleMoveNote = (move: NoteMove) => {
    if (!selectedNoteId) return;
    store.moveNote(selectedNoteId, move);
  };

  const handleDeleteNote = () => {
    if (!selectedNoteId) return;
    store.deleteNote(selectedNoteId);
    setSelectedNoteId(null);
    setToast("ノートを削除しました。Undoで戻せます。");
  };

  const handleEditChord = (symbol: string) => {
    if (!selectedChordId) return;
    try {
      const edited = store.editChord(selectedChordId, symbol);
      setToast(edited ? `${symbol} に変更しました。` : "コードを変更できませんでした。");
    } catch {
      setToast("コード記号を解釈できません。C、Am、F#m、Bdim などを入力してください。");
    }
  };

  const handleRegenerate = () => {
    if (!store.selectedBarRange) {
      setToast("先にコードレーンで小節を選択してください。");
      return;
    }
    const changed = store.regenerateSelected({ target: regenerationTarget });
    if (changed) {
      setSelectedNoteId(null);
      setSelectedChordId(null);
      setToast("選択範囲だけを再生成しました。ロック範囲は保持されています。");
    }
  };

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
      store.importJson(await file.text());
      setSelectedNoteId(null);
      setSelectedChordId(null);
      setToast("JSONから楽曲を復元しました。");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "JSONを読み込めませんでした。");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const loopStartBar = Math.floor(store.loopRange.startTick / composition.ticksPerBar) + 1;
  const loopEndBar = Math.ceil(store.loopRange.endTick / composition.ticksPerBar);
  const loopLabel =
    loopStartBar === 1 && loopEndBar === composition.bars.length
      ? "全体ループ"
      : `${loopStartBar}–${loopEndBar} 小節ループ`;

  return (
    <div className="app-shell">
      <TransportBar
        status={store.playback.status}
        position={formatBarBeat(store.playback.currentTick, composition.ppq, composition.ticksPerBar)}
        bpm={composition.settings.bpm}
        loopLabel={loopLabel}
        canUndo={store.historyIndex > 0}
        canRedo={store.historyIndex < store.history.length - 1}
        pendingCommit={store.pendingCommit}
        updateTiming={store.playback.updateTiming}
        onPlay={() => void handlePlay()}
        onPause={handlePause}
        onStop={handleStop}
        onUndo={() => store.undo()}
        onRedo={() => store.redo()}
        onUpdateTiming={store.setUpdateTiming}
        onExport={() => document.getElementById("export-panel")?.scrollIntoView({ behavior: "smooth" })}
      />

      <main className="app-layout">
        <SettingsPanel
          settings={store.settings}
          backend={backend}
          mobileOpen={mobilePanel === "settings"}
          onPatch={store.updateSettings}
          onGenerate={handleGenerate}
          onReset={() => {
            store.reset();
            setSelectedNoteId(null);
            setSelectedChordId(null);
            setToast("初期状態へ戻しました。");
          }}
          onMobileClose={() => setMobilePanel(null)}
        />

        <div className="composition-workspace">
          <div className="workspace-header">
            <div>
              <div className="composition-title-row">
                <h1>{composition.settings.key} {composition.settings.mode === "major" ? "Major" : "Natural Minor"}</h1>
                <span className="style-badge">{composition.resolvedStyle}</span>
              </div>
              <p>{composition.settings.timeSignature} · {composition.bars.length} bars · Seed {composition.seed}</p>
            </div>
            <div className="workspace-status">
              <span className={validation.valid ? "valid" : "invalid"}>
                <i />{validation.valid ? "Theory valid" : `${validation.errors.length} errors`}
              </span>
              <span>{composition.cadence} cadence</span>
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
              currentTick={store.playback.currentTick}
              lockedBars={store.lockedBars}
              onBarSelect={handleBarSelect}
              onChordSelect={handleChordSelect}
              onToggleLock={store.toggleBarLock}
            />
            <PianoRoll
              composition={composition}
              currentTick={store.playback.currentTick}
              selectedRange={store.selectedBarRange}
              selectedNoteId={selectedNoteId}
              onNoteSelect={handleNoteSelect}
            />
          </div>

          <RegenerationDock
            selectedRange={store.selectedBarRange}
            lockedCount={store.lockedBars.length}
            target={regenerationTarget}
            onTargetChange={setRegenerationTarget}
            onRegenerate={handleRegenerate}
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
            setSelectedNoteId(null);
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
