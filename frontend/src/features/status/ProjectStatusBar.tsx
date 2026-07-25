import { useEffect, useState } from "react";
import type { ProjectSaveStatus, UpdateTiming } from "../../state";
import {
  formatBytes,
  storageCapacityLevel,
  type StorageCapacityEstimate,
} from "../../storage";

export interface AiJobStatus {
  state: "idle" | "running" | "completed" | "cancelled" | "error";
  label: string;
  stage: string;
  progress: number;
  startedAt: number | null;
  device: string;
  backend: string;
  message?: string;
}

interface ProjectStatusBarProps {
  playback: "stopped" | "playing" | "paused";
  currentTick: number;
  ticksPerBar: number;
  loopLabel: string;
  pendingLoopLabel?: string | null;
  pendingCommit: boolean;
  updateTiming: UpdateTiming;
  aiJob: AiJobStatus;
  engineLabel: string;
  saveStatus: ProjectSaveStatus;
  lastSavedAt: string | null;
  /** Estimated localStorage headroom. Omitted when it cannot be measured. */
  storageCapacity?: StorageCapacityEstimate | null;
  online: boolean;
  connectionLabel: string;
  onCancelAi: () => void;
  onOpenDiagnostics: () => void;
}

const UPDATE_LABELS: Record<UpdateTiming, string> = {
  immediate: "immediately",
  nextBeat: "at next beat",
  nextBar: "at next bar",
  nextLoop: "at next loop",
};

const PLAYBACK_LABELS = {
  stopped: "Stopped",
  playing: "Playing",
  paused: "Paused",
} as const;

/**
 * Save state is the one thing a user must be able to trust at a glance, so each
 * state says what actually happened to their data rather than naming an internal
 * mode. The rest of the interface is Japanese; these follow it.
 */
const SAVE_LABELS: Record<ProjectSaveStatus, string> = {
  saved: "保存済み",
  saving: "保存中",
  unsaved: "未保存の変更",
  partial: "履歴の一部が未保存",
  session: "このセッションのみ",
  recovery: "復旧モード",
  error: "保存に失敗",
};

/** What each state means for the user's data, shown on hover. */
const SAVE_DESCRIPTIONS: Record<ProjectSaveStatus, string> = {
  saved: "この端末に保存されています。ブラウザを閉じても残ります。",
  saving: "現在の曲は保存済みです。履歴を書き込んでいます。",
  unsaved: "まだ保存されていない変更があります。",
  partial: "現在の曲は保存済みですが、履歴の一部が入りきりませんでした。",
  session: "保存先が使えないため、メモリ上だけに保持しています。タブを閉じると失われます。JSON書き出しで退避できます。",
  recovery: "保存されたデータを読み取れませんでした。上書きを防ぐため書き込みを止めています。",
  error: "保存に失敗しました。JSON書き出しで退避してください。",
};

export function ProjectStatusBar({
  playback,
  currentTick,
  ticksPerBar,
  loopLabel,
  pendingLoopLabel,
  pendingCommit,
  updateTiming,
  aiJob,
  engineLabel,
  saveStatus,
  lastSavedAt,
  storageCapacity,
  online,
  connectionLabel,
  onCancelAi,
  onOpenDiagnostics,
}: ProjectStatusBarProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (aiJob.state !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [aiJob.state]);
  const elapsed = aiJob.startedAt === null ? 0 : Math.max(0, (now - aiJob.startedAt) / 1_000);
  const currentBar = Math.floor(Math.max(0, currentTick) / Math.max(1, ticksPerBar)) + 1;

  // Only shown once it can actually be measured; an unmeasurable store would
  // otherwise read as "0 B left" and look like an emergency.
  const measured = storageCapacity && storageCapacity.confidence === "measured"
    ? storageCapacity
    : null;
  const capacityLevel = measured ? storageCapacityLevel(measured) : "ok";
  const capacityLabel = measured ? formatBytes(measured.remainingBytes) : null;
  const capacityTitle = measured
    ? `保存領域 ${formatBytes(measured.usedBytes)} / 約${formatBytes(measured.quotaBytes)} 使用（推定）`
    : null;
  const savedTime = lastSavedAt
    ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(lastSavedAt))
    : null;

  return (
    <section className="project-status-bar" aria-label="現在のアプリ状態">
      <div className="status-item" title="再生状態と現在の小節" aria-live="polite">
        <strong>Playback</strong>
        <span>{PLAYBACK_LABELS[playback]} · Bar {currentBar}</span>
      </div>
      <div className="status-item" title="現在のループ範囲">
        <strong>Loop</strong>
        <span>{loopLabel}</span>
      </div>
      <div className="status-item" title="編集内容を音へ反映するタイミング" aria-live="polite">
        <strong>Changes</strong>
        <span>
          {pendingCommit
            ? `Edited · Apply ${UPDATE_LABELS[updateTiming]}${pendingLoopLabel ? ` · Pending loop: ${pendingLoopLabel}` : ""}`
            : "Applied"}
        </span>
      </div>
      <div className="status-item ai-status" aria-live="polite">
        <strong>AI</strong>
        {aiJob.state === "running" ? (
          <span>
            {aiJob.stage} · {Math.round(aiJob.progress)}% · {elapsed.toFixed(1)}s
            <button type="button" onClick={onCancelAi}>Cancel</button>
          </span>
        ) : (
          <span>{aiJob.state === "error" ? aiJob.message ?? "Failed safely" : aiJob.label}</span>
        )}
      </div>
      <div className="status-item" title={`推論バックエンド: ${aiJob.backend || engineLabel}`}>
        <strong>Engine</strong>
        <span>{engineLabel}</span>
      </div>
      <div
        className={`status-item save-status is-${saveStatus}`}
        title={[
          SAVE_DESCRIPTIONS[saveStatus],
          savedTime ? `最終保存 ${savedTime}` : null,
          capacityTitle,
        ].filter(Boolean).join("\n")}
        aria-live="polite"
      >
        <strong>保存</strong>
        <span>
          {SAVE_LABELS[saveStatus]}
          {savedTime && saveStatus === "saved" ? ` · ${savedTime}` : ""}
          {capacityLabel && (
            <span className={`storage-capacity is-${capacityLevel}`}> · 残り {capacityLabel}</span>
          )}
        </span>
      </div>
      <div className="status-item" title="ネットワークとローカル推論サーバーの状態" aria-live="polite">
        <strong>Connection</strong>
        <span>{online ? "Online" : "Offline"} · {connectionLabel}</span>
      </div>
      <button className="status-diagnostics-button" type="button" onClick={onOpenDiagnostics}>
        Diagnostics
      </button>
    </section>
  );
}
