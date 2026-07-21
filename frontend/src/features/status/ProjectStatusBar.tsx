import { useEffect, useState } from "react";
import type { ProjectSaveStatus, UpdateTiming } from "../../state";

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

const SAVE_LABELS: Record<ProjectSaveStatus, string> = {
  saved: "Saved locally",
  saving: "Current saved · saving history",
  unsaved: "Unsaved changes",
  partial: "Current saved · history incomplete",
  session: "Session only",
  recovery: "Recovery required · write protected",
  error: "Save failed",
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
      <div className={`status-item save-status is-${saveStatus}`} title={savedTime ? `Last saved ${savedTime}` : undefined} aria-live="polite">
        <strong>Project</strong>
        <span>{SAVE_LABELS[saveStatus]}{savedTime && saveStatus === "saved" ? ` · ${savedTime}` : ""}</span>
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
