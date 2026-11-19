import type { Side } from "./session";
import type { Instrument } from "./player";
import { clock } from "./format";
import { PauseIcon, PlayIcon, StopIcon } from "./icons";

interface TransportPanelProps {
  playing: boolean;
  position: number;
  duration: number;
  side: Side;
  hasB: boolean;
  instrument: Instrument | "loading" | null;
  onToggle: () => void;
  onStop: () => void;
  onSeek: (seconds: number) => void;
  onSide: (side: Side) => void;
}

export function TransportPanel(props: TransportPanelProps) {
  const { playing, position, duration, side, hasB, instrument } = props;
  return (
    <div className="transport">
      <div className="transport-row">
        <button
          type="button"
          className="transport-play"
          onClick={props.onToggle}
          disabled={instrument === "loading" || duration === 0}
          aria-label={playing ? "一時停止" : "再生"}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button type="button" className="transport-stop" onClick={props.onStop} aria-label="停止して先頭へ">
          <StopIcon />
        </button>
        <label className="scrubber">
          <span className="visually-hidden">再生位置</span>
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(position, duration)}
            onChange={(event) => props.onSeek(Number(event.target.value))}
          />
        </label>
        <span className="clock" aria-live="off">{clock(position)} / {clock(duration)}</span>
      </div>

      {hasB && (
        <div className="sides" role="group" aria-label="聴く版">
          {(["A", "B"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              className="side"
              aria-pressed={side === candidate}
              onClick={() => props.onSide(candidate)}
            >
              {candidate}
            </button>
          ))}
        </div>
      )}

      <p className="hint">
        {instrument === "loading" && "ピアノ音源を読み込んでいます…"}
        {instrument === "synth" && "ピアノ音源を読み込めなかったため、簡易音源で鳴らしています。両方の版に同じ音源を使っています。"}
        {(instrument === "piano" || instrument === null) && (
          hasB ? "スペースで再生・一時停止、A / B キーで再生位置を保ったまま切り替えます。" : "スペースで再生・一時停止します。"
        )}
      </p>
    </div>
  );
}
