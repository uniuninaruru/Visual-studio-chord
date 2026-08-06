import type { BackendConnection } from "../../api/inferenceClient";
import { Icon } from "../../components/Icon";
import type { NoteMove } from "../../state";
import type {
  BarRange,
  ChordEvent,
  GeneratedComposition,
  NoteEvent,
  ValidationResult,
} from "../../types/music";
import { modeLabel } from "../../utils/musicFormat";

interface InspectorPanelProps {
  composition: GeneratedComposition;
  mobileOpen: boolean;
  selectedNote: NoteEvent | null;
  selectedChord: ChordEvent | null;
  selectedRange: BarRange | null;
  validation: ValidationResult;
  backend: BackendConnection;
  onEditChord: (symbol: string) => void;
  onMoveNote: (move: NoteMove) => void;
  onDeleteNote: () => void;
  onClearSelection: () => void;
  onExportJson: () => void;
  onExportMidi: () => void;
  onImportJson: () => void;
  onImportMelody: () => void;
  onMobileClose: () => void;
}

export function InspectorPanel({
  composition,
  mobileOpen,
  selectedNote,
  selectedChord,
  selectedRange,
  validation,
  backend,
  onEditChord,
  onMoveNote,
  onDeleteNote,
  onClearSelection,
  onExportJson,
  onExportMidi,
  onImportJson,
  onImportMelody,
  onMobileClose,
}: InspectorPanelProps) {
  const submitChord = (value: string) => {
    const symbol = value.trim();
    if (selectedChord && symbol && symbol !== selectedChord.symbol) {
      onEditChord(symbol);
    }
  };

  return (
    <aside className={`inspector-panel ${mobileOpen ? "mobile-open" : ""}`} aria-label="インスペクター">
      <div className="panel-heading inspector-heading">
        <div>
          <p className="eyebrow">INSPECTOR</p>
          <h2>{selectedNote ? "ノート" : selectedChord ? "コード" : "楽曲"}</h2>
        </div>
        <div className="panel-actions">
          {(selectedNote || selectedChord) && (
            <button className="text-button" type="button" onClick={onClearSelection}>選択解除</button>
          )}
          <button className="text-button mobile-close-button" type="button" onClick={onMobileClose}>閉じる</button>
        </div>
      </div>

      {selectedNote ? (
        <section className="inspector-section selected-object">
          <div className="object-identity">
            <span className="object-icon note"><Icon name="piano" /></span>
            <div>
              <strong>{selectedNote.noteName}</strong>
              <span>{selectedNote.role} · Bar {selectedNote.barIndex + 1}</span>
            </div>
          </div>
          <div className="inspector-label">音高</div>
          <div className="button-grid four">
            <button type="button" onClick={() => onMoveNote({ semitones: -12 })}>−12</button>
            <button type="button" onClick={() => onMoveNote({ semitones: -1 })}><Icon name="arrowDown" />−1</button>
            <button type="button" onClick={() => onMoveNote({ semitones: 1 })}><Icon name="arrowUp" />+1</button>
            <button type="button" onClick={() => onMoveNote({ semitones: 12 })}>+12</button>
          </div>
          <div className="inspector-label">位置</div>
          <div className="button-grid two">
            <button type="button" onClick={() => onMoveNote({ deltaTick: -composition.ppq / 4 })}>
              <Icon name="chevronLeft" /> 1/16
            </button>
            <button type="button" onClick={() => onMoveNote({ deltaTick: composition.ppq / 4 })}>
              1/16 <Icon name="chevronRight" />
            </button>
          </div>
          <label className="field inspector-field">
            <span>音価</span>
            <select
              aria-label="ノート音価"
              value={selectedNote.durationTick}
              onChange={(event) => onMoveNote({ durationTick: Number(event.target.value) })}
            >
              <option value={composition.ppq / 4}>1/16</option>
              <option value={composition.ppq / 2}>1/8</option>
              <option value={composition.ppq}>1/4</option>
              <option value={composition.ppq * 2}>1/2</option>
            </select>
          </label>
          <button className="danger-button" type="button" onClick={onDeleteNote}>
            <Icon name="trash" /> ノートを削除
          </button>
        </section>
      ) : selectedChord ? (
        <section className="inspector-section selected-object">
          <div className="object-identity">
            <span className={`object-icon chord ${selectedChord.function}`}><Icon name="wave" /></span>
            <div>
              <strong>{selectedChord.symbol}</strong>
              <span>{selectedChord.romanNumeral} · {selectedChord.function}</span>
            </div>
          </div>
          <label className="field inspector-field">
            <span>コード記号</span>
            <input
              key={`${selectedChord.id}:${selectedChord.symbol}`}
              aria-label="コード記号"
              defaultValue={selectedChord.symbol}
              onBlur={(event) => submitChord(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              spellCheck="false"
            />
          </label>
          <dl className="property-list">
            <div><dt>ルート</dt><dd>{selectedChord.root}</dd></div>
            <div><dt>品質</dt><dd>{selectedChord.quality}</dd></div>
            <div><dt>転回形</dt><dd>{selectedChord.inversion}</dd></div>
            <div><dt>由来</dt><dd>{selectedChord.source}</dd></div>
          </dl>
          {selectedChord.explanation && (
            <p className="theory-explanation">{selectedChord.explanation}</p>
          )}
          <p className="field-hint">例: C、Am、F#m、Bdim。Enterで反映します。</p>
        </section>
      ) : (
        <section className="inspector-section composition-summary">
          <div className="summary-score">
            <span className={validation.valid ? "valid" : "invalid"}>
              <Icon name={validation.valid ? "check" : "wave"} />
            </span>
            <div>
              <strong>{validation.valid ? "理論チェック OK" : `${validation.errors.length}件の要確認`}</strong>
              <span>{validation.warnings.length} warnings</span>
            </div>
          </div>
          <dl className="property-list">
            <div><dt>キー</dt><dd>{composition.settings.key} {modeLabel(composition.settings.mode)}</dd></div>
            <div><dt>終止</dt><dd>{composition.cadence}</dd></div>
            <div><dt>スタイル</dt><dd>{composition.resolvedStyle}</dd></div>
            <div><dt>シード</dt><dd className="seed-value">{composition.seed}</dd></div>
          </dl>
        </section>
      )}

      <section className="inspector-section range-summary">
        <div className="inspector-section-heading">
          <span>選択範囲</span>
          <strong>{selectedRange ? `${selectedRange.startBar + 1}–${selectedRange.endBar} 小節` : "曲全体"}</strong>
        </div>
        <div className="mini-timeline" aria-hidden="true">
          {composition.bars.map((bar) => (
            <span
              key={bar.index}
              className={selectedRange && bar.index >= selectedRange.startBar && bar.index < selectedRange.endBar ? "selected" : ""}
            />
          ))}
        </div>
      </section>

      <section className="inspector-section local-engine">
        <div className="inspector-section-heading">
          <span>推論エンジン</span>
          <strong>{backend.state === "connected" && backend.inferenceAuthorized ? backend.models.activeRuntime.toUpperCase() : "BROWSER"}</strong>
        </div>
        <p>
          {backend.state === "connected" && backend.inferenceAuthorized
            ? backend.models.activeRuntime !== "cpu"
              ? `${backend.device.deviceName} · ${backend.models.activeModel}`
              : backend.device.torchAvailable || backend.device.onnxRuntimeAvailable
                ? `ローカルCPU推論 · ${backend.models.activeModel}`
                : "決定的CPUランキングとブラウザ生成を使用しています。"
            : backend.state === "checking"
              ? "ローカルサーバーを確認しています。"
              : backend.state === "connected"
                ? "ローカルサーバーは接続済みです。起動ログの #access=... 付きURLを開くまでは、ブラウザ推論を使用します。"
                : backend.message}
        </p>
      </section>

      <section className="inspector-section export-section" id="export-panel">
        <div className="inspector-section-heading"><span>書き出し</span></div>
        <div className="export-grid">
          <button type="button" onClick={onExportMidi}>
            <Icon name="download" />
            <span>
              <strong>MIDI</strong>
              <small>{3 + (composition.voices?.length ?? 0)} tracks</small>
            </span>
          </button>
          <button type="button" onClick={onExportJson}><Icon name="download" /><span><strong>JSON</strong><small>編集データ</small></span></button>
          <button type="button" onClick={onImportJson}><Icon name="upload" /><span><strong>読込</strong><small>JSON</small></span></button>
          <button type="button" onClick={onImportMelody}>
            <Icon name="upload" />
            <span><strong>メロディ</strong><small>MIDIから作曲</small></span>
          </button>
        </div>
      </section>
    </aside>
  );
}
