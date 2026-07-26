import { useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { Icon } from "../../components/Icon";
import type { NoteMove } from "../../state";
import type { BarRange, GeneratedComposition, NoteEvent } from "../../types/music";
import { midiNoteName } from "../../utils/musicFormat";

interface PianoRollProps {
  composition: GeneratedComposition;
  currentTick: number;
  selectedRange: BarRange | null;
  selectedNoteIds: string[];
  onNoteSelect: (note: NoteEvent, extend: boolean) => void;
  onNoteMove: (note: NoteEvent, move: NoteMove) => void;
  onAddNote: (midi: number, startTick: number) => void;
  onCopyNotes: () => void;
  onPasteNotes: () => void;
  onDuplicateNotes: () => void;
  onQuantizeNotes: () => void;
  onDeleteNotes: () => void;
  canPaste: boolean;
  clipboardNoteCount: number;
  onToggleVoiceMute: (voiceId: string) => void;
}

interface NoteDrag {
  note: NoteEvent;
  pointerId: number;
  originX: number;
  originY: number;
  deltaTick: number;
  semitones: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function PianoRoll({
  composition,
  currentTick,
  selectedRange,
  selectedNoteIds,
  onNoteSelect,
  onNoteMove,
  onAddNote,
  onCopyNotes,
  onPasteNotes,
  onDuplicateNotes,
  onQuantizeNotes,
  onDeleteNotes,
  canPaste,
  clipboardNoteCount,
  onToggleVoiceMute,
}: PianoRollProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [noteDrag, setNoteDrag] = useState<NoteDrag | null>(null);
  const additionalNotes = (composition.voices ?? []).flatMap((voice) => voice.notes);
  const minMidi = Math.min(
    composition.settings.melody.minMidi,
    ...additionalNotes.map((note) => note.midi),
  );
  const maxMidi = Math.max(
    composition.settings.melody.maxMidi,
    ...additionalNotes.map((note) => note.midi),
  );
  const pitchCount = maxMidi - minMidi + 1;
  const pitches = Array.from({ length: pitchCount }, (_, index) => maxMidi - index);
  const clampedTick = clamp(currentTick, 0, composition.totalTicks);
  const selectedIds = new Set(selectedNoteIds);
  const selectedCount = selectedNoteIds.length;
  const editSelectionDisabled = selectedCount === 0;
  const gridTick = Math.max(1, Math.round(composition.ppq / 4));

  const dragMove = (drag: NoteDrag, clientX: number, clientY: number): NoteMove => {
    const canvas = canvasRef.current;
    if (!canvas) return { deltaTick: 0, semitones: 0 };
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return { deltaTick: 0, semitones: 0 };
    }
    const rawTickDelta = ((clientX - drag.originX) / bounds.width) * composition.totalTicks;
    const rowHeight = bounds.height / pitchCount;
    return {
      deltaTick: Math.round(rawTickDelta / gridTick) * gridTick,
      semitones: -Math.round((clientY - drag.originY) / rowHeight),
    };
  };

  const handleCanvasDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("[data-note-id]")) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const horizontalRatio = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const verticalRatio = clamp((event.clientY - bounds.top) / bounds.height, 0, 1 - Number.EPSILON);
    const rawStartTick = horizontalRatio * composition.totalTicks;
    const latestStartTick = Math.max(0, composition.totalTicks - gridTick);
    const startTick = clamp(Math.round(rawStartTick / gridTick) * gridTick, 0, latestStartTick);
    const pitchRow = Math.min(pitchCount - 1, Math.floor(verticalRatio * pitchCount));
    onAddNote(maxMidi - pitchRow, startTick);
  };

  const handleNotePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    note: NoteEvent,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const extend = event.shiftKey || event.metaKey || event.ctrlKey;
    onNoteSelect(note, extend);
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setNoteDrag({
      note,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      deltaTick: 0,
      semitones: 0,
    });
  };

  const handleNotePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!noteDrag || noteDrag.pointerId !== event.pointerId) return;
    const move = dragMove(noteDrag, event.clientX, event.clientY);
    setNoteDrag({
      ...noteDrag,
      deltaTick: move.deltaTick ?? 0,
      semitones: move.semitones ?? 0,
    });
  };

  const handleNotePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!noteDrag || noteDrag.pointerId !== event.pointerId) return;
    const move = dragMove(noteDrag, event.clientX, event.clientY);
    if ((move.deltaTick ?? 0) !== 0 || (move.semitones ?? 0) !== 0) {
      onNoteMove(noteDrag.note, move);
    }
    if (
      typeof event.currentTarget.hasPointerCapture === "function"
      && event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setNoteDrag(null);
  };

  return (
    <section className="lane-section piano-roll-section" aria-labelledby="piano-roll-title">
      <div className="lane-heading">
        <div>
          <p className="eyebrow">MELODY</p>
          <h2 id="piano-roll-title">ピアノロール</h2>
        </div>
        <div className="piano-summary">
          <Icon name="piano" />
          <span>{composition.notes.length + additionalNotes.length} notes</span>
          <span>{1 + (composition.voices?.length ?? 0)} voices</span>
          <span>{midiNoteName(minMidi)}–{midiNoteName(maxMidi)}</span>
        </div>
      </div>

      <div className="voice-strip" role="toolbar" aria-label="声部の表示と再生">
        <span className="voice-chip lead-voice" aria-label="主旋律は編集できます">
          <i />
          主旋律
          <small>編集可</small>
        </span>
        {(composition.voices ?? []).map((voice) => (
          <button
            key={voice.id}
            type="button"
            className={`voice-chip ${voice.muted ? "muted" : ""}`}
            onClick={() => onToggleVoiceMute(voice.id)}
            aria-pressed={!voice.muted}
            aria-label={`${voice.name}を${voice.muted ? "再生する" : "ミュートする"}`}
            title="クリックで再生／ミュート"
          >
            <i style={{ backgroundColor: voice.color }} />
            {voice.name}
            <small>{voice.muted ? "ミュート" : "再生中"}</small>
          </button>
        ))}
      </div>

      <div role="toolbar" aria-label="選択したノートの編集">
        <button
          type="button"
          className="text-button"
          onClick={onCopyNotes}
          disabled={editSelectionDisabled}
          aria-label={`選択した${selectedCount}個のノートをコピー`}
        >
          コピー{selectedCount > 0 ? ` (${selectedCount})` : ""}
        </button>
        <button
          type="button"
          className="text-button"
          onClick={onPasteNotes}
          disabled={!canPaste}
          aria-label={`${clipboardNoteCount}個のノートを貼り付け`}
        >
          貼り付け{clipboardNoteCount > 0 ? ` (${clipboardNoteCount})` : ""}
        </button>
        <button
          type="button"
          className="text-button"
          onClick={onDuplicateNotes}
          disabled={editSelectionDisabled}
        >
          複製
        </button>
        <button
          type="button"
          className="text-button"
          onClick={onQuantizeNotes}
          disabled={editSelectionDisabled}
        >
          クオンタイズ
        </button>
        <button
          type="button"
          className="text-button"
          onClick={onDeleteNotes}
          disabled={editSelectionDisabled}
        >
          削除
        </button>
      </div>

      <div className="piano-shell" data-testid="piano-roll">
        <div className="piano-labels" aria-hidden="true">
          {pitches.map((pitch) => (
            <div
              key={pitch}
              className={`pitch-label ${[1, 3, 6, 8, 10].includes(pitch % 12) ? "accidental" : ""}`}
              style={{ height: `${100 / pitchCount}%` }}
            >
              {pitch % 12 === 0 ? midiNoteName(pitch) : ""}
            </div>
          ))}
        </div>
        <div
          ref={canvasRef}
          className="piano-canvas"
          style={{ "--pitch-count": pitchCount, "--bar-count": composition.bars.length } as CSSProperties}
          role="group"
          tabIndex={0}
          aria-label="ピアノロール編集領域"
          aria-describedby="piano-roll-tip"
          onDoubleClick={handleCanvasDoubleClick}
        >
          <div className="pitch-grid" aria-hidden="true">
            {pitches.map((pitch) => (
              <span
                key={pitch}
                className={[1, 3, 6, 8, 10].includes(pitch % 12) ? "accidental-row" : "natural-row"}
                style={{ height: `${100 / pitchCount}%` }}
              />
            ))}
          </div>
          <div className="bar-grid" aria-hidden="true">
            {composition.bars.map((bar) => (
              <span key={bar.index} style={{ left: `${(bar.index / composition.bars.length) * 100}%` }}>
                <b>{bar.index + 1}</b>
              </span>
            ))}
          </div>
          {selectedRange && (
            <div
              className="selection-overlay"
              style={{
                left: `${(selectedRange.startBar / composition.bars.length) * 100}%`,
                width: `${((selectedRange.endBar - selectedRange.startBar) / composition.bars.length) * 100}%`,
              }}
              aria-hidden="true"
            />
          )}
          {composition.notes.map((note) => {
            const draggingThisNote = noteDrag?.note.id === note.id;
            const displayMidi = clamp(
              note.midi + (draggingThisNote ? noteDrag.semitones : 0),
              minMidi,
              maxMidi,
            );
            const displayStartTick = clamp(
              note.startTick + (draggingThisNote ? noteDrag.deltaTick : 0),
              0,
              Math.max(0, composition.totalTicks - note.durationTick),
            );
            const top = ((maxMidi - displayMidi) / pitchCount) * 100;
            const height = Math.max(2.1, (1 / pitchCount) * 100 - 0.35);
            const selected = selectedIds.has(note.id);
            return (
              <button
                key={note.id}
                type="button"
                data-note-id={note.id}
                className={`piano-note ${note.role} ${selected ? "selected" : ""}`}
                style={{
                  left: `${(displayStartTick / composition.totalTicks) * 100}%`,
                  width: `${Math.max(0.8, (note.durationTick / composition.totalTicks) * 100)}%`,
                  top: `${top}%`,
                  height: `${height}%`,
                  touchAction: "none",
                }}
                onPointerDown={(event) => handleNotePointerDown(event, note)}
                onPointerMove={handleNotePointerMove}
                onPointerUp={handleNotePointerUp}
                onPointerCancel={() => setNoteDrag(null)}
                onClick={(event) => {
                  if (event.detail === 0) {
                    onNoteSelect(note, event.shiftKey || event.metaKey || event.ctrlKey);
                  }
                }}
                aria-label={`${note.noteName}、${note.barIndex + 1}小節目、長さ${note.durationTick} tick`}
                aria-pressed={selected}
                title={`${note.noteName} · ${note.role}`}
              >
                <span>{note.noteName}</span>
              </button>
            );
          })}
          {(composition.voices ?? []).flatMap((voice) =>
            voice.notes.map((note) => {
              const top = ((maxMidi - note.midi) / pitchCount) * 100;
              const height = Math.max(2.1, (1 / pitchCount) * 100 - 0.35);
              return (
                <span
                  key={`${voice.id}:${note.id}`}
                  className={`piano-note secondary-voice-note ${voice.muted ? "muted" : ""}`}
                  style={{
                    left: `${(note.startTick / composition.totalTicks) * 100}%`,
                    width: `${Math.max(0.8, (note.durationTick / composition.totalTicks) * 100)}%`,
                    top: `${top}%`,
                    height: `${height}%`,
                    borderColor: voice.color,
                    backgroundColor: `${voice.color}99`,
                  }}
                  aria-label={`${voice.name}、${note.noteName}、${note.barIndex + 1}小節目`}
                  title={`${voice.name} · ${note.noteName}`}
                >
                  <span>{note.noteName}</span>
                </span>
              );
            }),
          )}
          <div
            className="playhead"
            style={{ left: `${(clampedTick / composition.totalTicks) * 100}%` }}
            aria-hidden="true"
          >
            <i />
          </div>
        </div>
      </div>
      <p className="lane-tip" id="piano-roll-tip">
        青い主旋律を編集できます。色付きの追加声部は上のチップで再生／ミュートを切り替えられます。
      </p>
    </section>
  );
}
