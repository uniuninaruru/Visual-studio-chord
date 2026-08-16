import { useEffect, useState } from "react";
import type { ProjectSaveStatus, UpdateTiming } from "../../state";
import {
  formatBytes,
  storageCapacityLevel,
  type StorageCapacityEstimate,
} from "../../storage";

export interface AiJobStatus {
  state: "idle" | "running" | "cancelling" | "completed" | "cancelled" | "error";
  label: string;
  stage: string;
  progress: number;
  startedAt: number | null;
  elapsedMs?: number;
  device: string | null;
  backend: string;
  message?: string;
  modelId?: string;
  dtype?: string | null;
  mock?: boolean;
  trained?: boolean;
  checkpointSha256?: string | null;
  tokenizerSha256?: string;
  sourceCommit?: string | null;
  candidateCount?: number;
  batchSize?: number;
  deterministic?: boolean;
  cpuFallbackUsed?: boolean;
  fallbackReason?: string | null;
  preferredDevice?: "auto" | "cpu" | "cuda" | "mps";
  canRetryOnCpu?: boolean;
  rebasedAgainstNewerEdits?: boolean;
}

interface ProjectStatusBarProps {
  playback: "stopped" | "playing" | "paused";
  currentTick: number;
  ticksPerBar: number;
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
  onRetryAiOnCpu?: () => void;
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
  onRetryAiOnCpu,
  onOpenDiagnostics,
}: ProjectStatusBarProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (aiJob.state !== "running" && aiJob.state !== "cancelling") return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [aiJob.state]);
  const elapsed = aiJob.elapsedMs !== undefined
    ? Math.max(0, aiJob.elapsedMs / 1_000)
    : aiJob.startedAt === null
      ? 0
      : Math.max(0, (now - aiJob.startedAt) / 1_000);
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
  const aiActive = aiJob.state === "running" || aiJob.state === "cancelling";
  const deviceLabel = aiJob.device === null
    ? "Detecting device…"
    : aiJob.device === "mps"
      ? "Apple Metal (MPS)"
      : aiJob.device?.toUpperCase();
  const checkpointLabel = aiJob.checkpointSha256
    ? `ckpt ${aiJob.checkpointSha256.slice(0, 8)}`
    : aiJob.modelId ? "No checkpoint" : null;

  return (
    <section className="project-status-bar" aria-label="現在のアプリ状態">
      <div className="status-item" title="再生状態と現在の小節" aria-live="polite">
        <strong>Playback</strong>
        <span>{PLAYBACK_LABELS[playback]} · Bar {currentBar}</span>
      </div>
      {/*
        * No Loop item here.
        *
        * App renders the same `loopLabel` string into the transport bar forty
        * pixels above this row, from the same variable. Two readouts of one
        * value, both on screen at once, is not redundancy that protects
        * anything -- it is a column of this strip spent saying what the row
        * above already said. The prop goes with it: the pending-loop note below
        * compares against the committed label, and that comparison already
        * happens in App, which is where both labels are computed.
        */}
      <div className="status-item" title="編集内容を音へ反映するタイミング" aria-live="polite">
        <strong>Changes</strong>
        <span>
          {pendingCommit
            ? `Edited · Apply ${UPDATE_LABELS[updateTiming]}${pendingLoopLabel ? ` · Pending loop: ${pendingLoopLabel}` : ""}`
            : "Applied"}
        </span>
      </div>
      <div className="status-item ai-status" aria-live="polite" aria-atomic="true">
        <strong>AI</strong>
        <div className="ai-status-content">
          <span>
            {aiActive
              ? `${aiJob.stage} · ${Math.round(aiJob.progress)}% · ${elapsed.toFixed(1)}s`
              : aiJob.state === "error" ? aiJob.message ?? "Failed safely" : aiJob.label}
          </span>
          {aiJob.modelId && (
            <span className="ai-provenance-badges" aria-label="推論の由来">
              <span title={`Model: ${aiJob.modelId}`}>
                {aiJob.mock ? "Mock / untrained" : aiJob.trained ? "Neural / trained" : "Untrained"}
              </span>
              <span title="実際に推論したデバイス">{deviceLabel}</span>
              <span title={`Backend: ${aiJob.backend}${aiJob.dtype ? ` · ${aiJob.dtype}` : ""}`}>
                {aiJob.backend}{aiJob.dtype ? ` · ${aiJob.dtype}` : ""}
              </span>
              {checkpointLabel && <span title={aiJob.checkpointSha256 ?? "学習済みcheckpointなし"}>{checkpointLabel}</span>}
              {aiJob.candidateCount !== undefined && (
                <span title="提案数と実際のモデルforward batch">
                  {aiJob.candidateCount}候補 · batch {aiJob.batchSize ?? "—"}
                </span>
              )}
              {aiJob.cpuFallbackUsed && <span title={aiJob.fallbackReason ?? "CPU fallback"}>CPU fallback</span>}
              {aiJob.fallbackReason && !aiJob.cpuFallbackUsed && (
                <span title={aiJob.fallbackReason}>
                  {aiJob.fallbackReason.toLowerCase().includes("theory fallback")
                    ? "Theory fallback"
                    : "Fallback"}
                </span>
              )}
              {aiJob.rebasedAgainstNewerEdits && (
                <span title="ジョブ開始後の編集・ロックへ候補を再検証してリベースしました">
                  Rebased
                </span>
              )}
            </span>
          )}
          <span className="ai-status-actions">
            {aiActive && (
              <button
                type="button"
                onClick={onCancelAi}
                disabled={aiJob.state === "cancelling"}
                title={aiJob.state === "cancelling"
                  ? "サーバーへキャンセルを要求済みです。"
                  : "候補生成だけを停止します。再生と編集内容は維持されます。"}
              >
                {aiJob.state === "cancelling" ? "Cancelling…" : "Cancel"}
              </button>
            )}
            {aiJob.canRetryOnCpu && onRetryAiOnCpu && !aiActive && (
              <button
                type="button"
                onClick={onRetryAiOnCpu}
                title="同じ選択範囲をCPU指定で再実行します。現在の曲は採用まで変わりません。"
              >
                CPUで再試行
              </button>
            )}
          </span>
        </div>
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
      {/*
        * Engine and Connection were two items describing one subsystem: where
        * inference runs, and whether the thing it would run on is reachable.
        * Read separately they invite the question of how they differ; read
        * together they are one sentence. Both strings are kept, because
        * "offline" and "no server" are genuinely different states.
        */}
      <div
        className="status-item engine-status"
        title={[
          `推論バックエンド: ${aiJob.backend || engineLabel}`,
          "ネットワークとローカル推論サーバーの状態",
        ].join("\n")}
        aria-live="polite"
      >
        <strong>Engine</strong>
        <span>{engineLabel}</span>
        <span className="engine-connection">
          {online ? "Online" : "Offline"} · {connectionLabel}
        </span>
      </div>
      <button className="status-diagnostics-button" type="button" onClick={onOpenDiagnostics}>
        Diagnostics
      </button>
    </section>
  );
}
