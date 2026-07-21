import { Icon } from "../../components/Icon";
import type { PlaybackStatus, UpdateTiming } from "../../state";

interface TransportBarProps {
  status: PlaybackStatus;
  position: string;
  bpm: number;
  loopLabel: string;
  canUndo: boolean;
  canRedo: boolean;
  pendingCommit: boolean;
  updateTiming: UpdateTiming;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onUpdateTiming: (value: UpdateTiming) => void;
  onExport: () => void;
}

const UPDATE_TIMING_LABELS: Record<UpdateTiming, string> = {
  immediate: "すぐ反映",
  nextBeat: "次の拍",
  nextBar: "次の小節",
  nextLoop: "次のループ",
};

export function TransportBar({
  status,
  position,
  bpm,
  loopLabel,
  canUndo,
  canRedo,
  pendingCommit,
  updateTiming,
  onPlay,
  onPause,
  onStop,
  onUndo,
  onRedo,
  onUpdateTiming,
  onExport,
}: TransportBarProps) {
  return (
    <header className="transport-bar">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <strong>Harmony Lab</strong>
          <span>THEORY COMPOSER</span>
        </div>
      </div>

      <div className="transport-controls" aria-label="再生操作">
        <button
          className={`transport-button play-button ${status === "playing" ? "active" : ""}`}
          type="button"
          onClick={status === "playing" ? onPause : onPlay}
          aria-label={status === "playing" ? "一時停止" : "再生"}
          title={status === "playing" ? "一時停止" : "再生"}
        >
          <Icon name={status === "playing" ? "pause" : "play"} />
        </button>
        <button className="transport-button" type="button" onClick={onStop} aria-label="停止" title="停止">
          <Icon name="stop" />
        </button>
        <div className="transport-readout" aria-label={`再生位置 ${position}`}>
          <span className="readout-position">{position}</span>
          <span className="readout-meta">{bpm} BPM</span>
        </div>
        <div className="loop-readout">
          <Icon name="wave" />
          <span>{loopLabel}</span>
        </div>
      </div>

      <div className="transport-actions">
        <div className="history-buttons">
          <button className="icon-button" type="button" onClick={onUndo} disabled={!canUndo} aria-label="元に戻す" title="元に戻す">
            <Icon name="undo" />
          </button>
          <button className="icon-button" type="button" onClick={onRedo} disabled={!canRedo} aria-label="やり直す" title="やり直す">
            <Icon name="redo" />
          </button>
        </div>
        <label className={`timing-control ${pendingCommit ? "pending" : ""}`}>
          <span>{pendingCommit ? "変更待機中" : "編集反映"}</span>
          <select
            aria-label="編集反映タイミング"
            value={updateTiming}
            onChange={(event) => onUpdateTiming(event.target.value as UpdateTiming)}
          >
            {Object.entries(UPDATE_TIMING_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <button className="secondary-button export-top-button" type="button" onClick={onExport}>
          <Icon name="download" />
          書き出し
        </button>
      </div>
    </header>
  );
}
