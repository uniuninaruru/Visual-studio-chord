import { Icon } from "../../components/Icon";
import type { BarRange, GeneratedComposition, NoteEvent } from "../../types/music";
import { midiNoteName } from "../../utils/musicFormat";

interface PianoRollProps {
  composition: GeneratedComposition;
  currentTick: number;
  selectedRange: BarRange | null;
  selectedNoteId: string | null;
  onNoteSelect: (note: NoteEvent) => void;
}

export function PianoRoll({
  composition,
  currentTick,
  selectedRange,
  selectedNoteId,
  onNoteSelect,
}: PianoRollProps) {
  const minMidi = composition.settings.melody.minMidi;
  const maxMidi = composition.settings.melody.maxMidi;
  const pitchCount = maxMidi - minMidi + 1;
  const pitches = Array.from({ length: pitchCount }, (_, index) => maxMidi - index);
  const clampedTick = Math.max(0, Math.min(composition.totalTicks, currentTick));

  return (
    <section className="lane-section piano-roll-section" aria-labelledby="piano-roll-title">
      <div className="lane-heading">
        <div>
          <p className="eyebrow">MELODY</p>
          <h2 id="piano-roll-title">ピアノロール</h2>
        </div>
        <div className="piano-summary">
          <Icon name="piano" />
          <span>{composition.notes.length} notes</span>
          <span>{midiNoteName(minMidi)}–{midiNoteName(maxMidi)}</span>
        </div>
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
          className="piano-canvas"
          style={{ "--pitch-count": pitchCount, "--bar-count": composition.bars.length } as React.CSSProperties}
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
            const top = ((maxMidi - note.midi) / pitchCount) * 100;
            const height = Math.max(2.1, (1 / pitchCount) * 100 - 0.35);
            return (
              <button
                key={note.id}
                type="button"
                className={`piano-note ${note.role} ${selectedNoteId === note.id ? "selected" : ""}`}
                style={{
                  left: `${(note.startTick / composition.totalTicks) * 100}%`,
                  width: `${Math.max(0.8, (note.durationTick / composition.totalTicks) * 100)}%`,
                  top: `${top}%`,
                  height: `${height}%`,
                }}
                onClick={() => onNoteSelect(note)}
                aria-label={`${note.noteName}、${note.barIndex + 1}小節目、長さ${note.durationTick} tick`}
                title={`${note.noteName} · ${note.role}`}
              >
                <span>{note.noteName}</span>
              </button>
            );
          })}
          <div
            className="playhead"
            style={{ left: `${(clampedTick / composition.totalTicks) * 100}%` }}
            aria-hidden="true"
          >
            <i />
          </div>
        </div>
      </div>
      <p className="lane-tip">ノートを選択すると右側のインスペクターで移動・長さ変更・削除ができます。</p>
    </section>
  );
}
