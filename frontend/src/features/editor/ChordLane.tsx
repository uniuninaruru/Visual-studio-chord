import { useMemo, useState } from "react";
import { Icon } from "../../components/Icon";
import { ChordEditor } from "./ChordEditor";
import type { StructuredChordEdit } from "../../state";
import type { BarRange, ChordEvent, GeneratedComposition, HarmonyFunction } from "../../types/music";
import { formatBarBeat } from "../../utils/musicFormat";

const FUNCTION_LABELS: Record<HarmonyFunction, string> = {
  tonic: "Tonic",
  predominant: "Predominant",
  dominant: "Dominant",
  other: "Other",
};

interface ChordLaneProps {
  composition: GeneratedComposition;
  selectedRange: BarRange | null;
  selectedChordId: string | null;
  currentTick: number;
  lockedBars: number[];
  onBarSelect: (barIndex: number, extend: boolean) => void;
  onChordSelect: (chord: ChordEvent) => void;
  onToggleLock: (barIndex: number) => void;
  onAddChord: (symbol: string, startTick: number, durationTick: number) => string | null;
  onDeleteChord: (chordId: string) => boolean;
  onSplitChord: (chordId: string, splitTick: number) => string | null;
  onMoveChord: (chordId: string, startTick: number) => boolean;
  onResizeChord: (chordId: string, durationTick: number) => boolean;
  chordEditorOpen: boolean;
  onOpenChordEditor: () => void;
  onCloseChordEditor: () => void;
  onEditChord: (chordId: string, edit: StructuredChordEdit) => boolean;
}

function overlapsLockedBar(
  composition: GeneratedComposition,
  startTick: number,
  endTick: number,
  lockedBars: readonly number[],
): boolean {
  const firstBar = Math.floor(startTick / composition.ticksPerBar);
  const lastBar = Math.ceil(endTick / composition.ticksPerBar);
  return lockedBars.some((bar) => bar >= firstBar && bar < lastBar);
}

function quantizeTick(tick: number, gridTick: number): number {
  return Math.round(tick / gridTick) * gridTick;
}

function durationLabel(durationTick: number, beatTick: number): string {
  const beats = durationTick / beatTick;
  return `${durationTick} ticks（${Number.isInteger(beats) ? beats : beats.toFixed(2)}拍）`;
}

export function ChordLane({
  composition,
  selectedRange,
  selectedChordId,
  currentTick,
  lockedBars,
  onBarSelect,
  onChordSelect,
  onToggleLock,
  onAddChord,
  onDeleteChord,
  onSplitChord,
  onMoveChord,
  onResizeChord,
  chordEditorOpen,
  onOpenChordEditor,
  onCloseChordEditor,
  onEditChord,
}: ChordLaneProps) {
  const [addSymbol, setAddSymbol] = useState("");
  const currentBar = Math.min(
    composition.bars.length - 1,
    Math.floor(currentTick / composition.ticksPerBar),
  );
  const selectedChord = composition.chords.find((chord) => chord.id === selectedChordId) ?? null;
  const beatTick = Math.max(1, Math.round(
    composition.timeSignature === "6/8" ? composition.ppq * 1.5 : composition.ppq,
  ));
  const gridTick = Math.max(1, Math.round(composition.ppq / 4));
  const selectedEndTick = selectedChord
    ? selectedChord.startTick + selectedChord.durationTick
    : 0;
  const selectedLocked = selectedChord
    ? overlapsLockedBar(
      composition,
      selectedChord.startTick,
      selectedEndTick,
      lockedBars,
    )
    : false;
  const selectedMidpoint = selectedChord
    ? selectedChord.startTick + selectedChord.durationTick / 2
    : 0;
  const addStartTick = selectedChord
    ? quantizeTick(selectedMidpoint, gridTick)
    : 0;
  const addDurationTick = selectedChord
    ? Math.min(beatTick, selectedEndTick - addStartTick)
    : 0;
  const splitTick = selectedChord ? quantizeTick(selectedMidpoint, gridTick) : 0;
  const addDisabledReason = !selectedChord
    ? "コードを選ぶと追加できます。"
    : selectedLocked
      ? "ロックされた小節に交差するため追加できません。"
      : addStartTick <= selectedChord.startTick || addStartTick >= selectedEndTick || addDurationTick <= 0
        ? "選択コード内に1拍を置けるグリッド位置がありません。"
        : addSymbol.trim().length === 0
          ? "コード記号を入力してください。"
          : "";
  const splitDisabledReason = !selectedChord
    ? "コードを選ぶと分割できます。"
    : selectedLocked
      ? "ロックされた小節に交差するため分割できません。"
      : splitTick <= selectedChord.startTick || splitTick >= selectedEndTick
        ? "選択コード内に分割できるグリッド位置がありません。"
        : "";
  const moveLeftDisabledReason = !selectedChord
    ? "コードを選ぶと移動できます。"
    : selectedLocked
      ? "ロックされた小節に交差するため移動できません。"
      : selectedChord.startTick < beatTick
        ? "これ以上左へ移動できません。"
        : "";
  const moveRightDisabledReason = !selectedChord
    ? "コードを選ぶと移動できます。"
    : selectedLocked
      ? "ロックされた小節に交差するため移動できません。"
      : selectedEndTick + beatTick > composition.totalTicks
        ? "これ以上右へ移動できません。"
        : "";
  const shortenDisabledReason = !selectedChord
    ? "コードを選ぶと長さを変更できます。"
    : selectedLocked
      ? "ロックされた小節に交差するため長さを変更できません。"
      : selectedEndTick >= composition.totalTicks
        ? "終端のコードは短くできません。"
        : selectedChord.durationTick <= beatTick
          ? "これ以上短くできません。"
          : "";
  const lengthenDisabledReason = !selectedChord
    ? "コードを選ぶと長さを変更できます。"
    : selectedLocked
      ? "ロックされた小節に交差するため長さを変更できません。"
      : selectedEndTick + beatTick > composition.totalTicks
        ? "曲の終端を越えて長くできません。"
        : "";
  const deleteDisabledReason = !selectedChord
    ? "コードを選ぶと削除できます。"
    : selectedLocked
      ? "ロックされた小節に交差するため削除できません。"
      : composition.chords.length <= 1
        ? "最後の1コードは削除できません。"
        : "";
  const actionState = useMemo(() => ({
    selectedChord,
    selectedLocked,
    addStartTick,
    addDurationTick,
    splitTick,
    beatTick,
  }), [selectedChord, selectedLocked, addStartTick, addDurationTick, splitTick, beatTick]);
  const actionHint = [...new Set([
    addDisabledReason,
    splitDisabledReason,
    moveLeftDisabledReason,
    moveRightDisabledReason,
    shortenDisabledReason,
    lengthenDisabledReason,
    deleteDisabledReason,
  ].filter(Boolean))].join(" ") || "Undoで復元できます。";

  return (
    <section className="lane-section chord-lane-section" aria-labelledby="chord-lane-title">
      <div className="lane-heading">
        <div>
          <p className="eyebrow">HARMONY</p>
          <h2 id="chord-lane-title">コードレーン</h2>
        </div>
        <div className="function-legend" aria-label="和声機能の凡例">
          {(Object.keys(FUNCTION_LABELS) as HarmonyFunction[]).slice(0, 3).map((item) => (
            <span key={item} className={`legend-item ${item}`}>
              <i />{FUNCTION_LABELS[item]}
            </span>
          ))}
        </div>
      </div>

      <div className="chord-action-toolbar" data-testid="chord-action-toolbar">
        {actionState.selectedChord ? (
          <>
            <div className="chord-action-summary">
              <strong>{actionState.selectedChord.symbol}</strong>
              <span>
                Bar/Beat {formatBarBeat(
                  actionState.selectedChord.startTick,
                  composition.ppq,
                  composition.ticksPerBar,
                )}
                –{formatBarBeat(
                  selectedEndTick,
                  composition.ppq,
                  composition.ticksPerBar,
                )}
              </span>
              <span>長さ {durationLabel(actionState.selectedChord.durationTick, actionState.beatTick)}</span>
              <span className={actionState.selectedLocked ? "is-locked" : "is-editable"}>
                {actionState.selectedLocked ? "ロック中" : "編集可能"}
              </span>
            </div>
            <button
              type="button"
              className="primary-button chord-editor-open-button"
              onClick={onOpenChordEditor}
              aria-haspopup="dialog"
            >
              響きを編集
            </button>
            <form
              className="chord-add-control"
              onSubmit={(event) => {
                event.preventDefault();
                if (addDisabledReason !== "") return;
                if (onAddChord(
                  addSymbol.trim(),
                  actionState.addStartTick,
                  actionState.addDurationTick,
                )) {
                  setAddSymbol("");
                }
              }}
            >
              <label htmlFor="chord-add-symbol">コード追加</label>
              <input
                id="chord-add-symbol"
                type="text"
                value={addSymbol}
                onChange={(event) => setAddSymbol(event.target.value)}
                placeholder="例: F#7"
                aria-label="追加するコード記号"
                title="選択コード内の中点へ、最大1拍で追加"
              />
              <button
                type="submit"
                className="secondary-button"
                disabled={addDisabledReason !== ""}
                title={addDisabledReason || "選択コード内の中点へ追加"}
              >
                実行
              </button>
            </form>
            <div className="chord-action-buttons" role="group" aria-label="選択コードの操作">
              <button
                type="button"
                className="danger-button"
                disabled={deleteDisabledReason !== ""}
                title={deleteDisabledReason || "Undoで戻せます"}
                onClick={() => {
                  if (deleteDisabledReason === "") onDeleteChord(actionState.selectedChord!.id);
                }}
              >
                削除
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={splitDisabledReason !== ""}
                title={splitDisabledReason || "中点をグリッドに合わせて分割"}
                onClick={() => {
                  if (splitDisabledReason === "") onSplitChord(actionState.selectedChord!.id, actionState.splitTick);
                }}
              >
                分割
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={moveLeftDisabledReason !== ""}
                title={moveLeftDisabledReason || "1拍左へ移動"}
                onClick={() => {
                  if (moveLeftDisabledReason === "") onMoveChord(
                    actionState.selectedChord!.id,
                    actionState.selectedChord!.startTick - actionState.beatTick,
                  );
                }}
              >
                1拍左へ
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={moveRightDisabledReason !== ""}
                title={moveRightDisabledReason || "1拍右へ移動"}
                onClick={() => {
                  if (moveRightDisabledReason === "") onMoveChord(
                    actionState.selectedChord!.id,
                    actionState.selectedChord!.startTick + actionState.beatTick,
                  );
                }}
              >
                1拍右へ
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={shortenDisabledReason !== ""}
                title={shortenDisabledReason || "1拍短く"}
                onClick={() => {
                  if (shortenDisabledReason === "") onResizeChord(
                    actionState.selectedChord!.id,
                    actionState.selectedChord!.durationTick - actionState.beatTick,
                  );
                }}
              >
                1拍短く
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={lengthenDisabledReason !== ""}
                title={lengthenDisabledReason || "1拍長く"}
                onClick={() => {
                  if (lengthenDisabledReason === "") onResizeChord(
                    actionState.selectedChord!.id,
                    actionState.selectedChord!.durationTick + actionState.beatTick,
                  );
                }}
              >
                1拍長く
              </button>
            </div>
            <p className="chord-action-hint" role="status">
              {actionHint}
            </p>
          </>
        ) : (
          <p className="chord-action-empty">コードを選ぶと直接編集できます。</p>
        )}
      </div>

      <div
        className="chord-lane"
        style={{ "--bar-count": composition.bars.length } as React.CSSProperties}
        data-testid="chord-lane"
      >
        {composition.bars.map((bar) => {
          // A bar can hold several chords once harmonic rhythm subdivides it,
          // and a held chord can span bars — so take every chord that sounds
          // during this bar, and mark the ones that started earlier.
          const barEnd = bar.startTick + bar.durationTick;
          const barChords = composition.chords.filter(
            (item) =>
              item.startTick < barEnd && item.startTick + item.durationTick > bar.startTick,
          );
          const chord = barChords[0];
          const selected = Boolean(
            selectedRange && bar.index >= selectedRange.startBar && bar.index < selectedRange.endBar,
          );
          const locked = lockedBars.includes(bar.index);
          return (
            <article
              key={bar.index}
              className={[
                "chord-cell",
                chord?.function ?? "other",
                selected ? "selected" : "",
                currentBar === bar.index ? "playing" : "",
                locked ? "locked" : "",
              ].filter(Boolean).join(" ")}
              data-bar={bar.index}
            >
              <div className="bar-number">
                <span>{String(bar.index + 1).padStart(2, "0")}</span>
                <button
                  type="button"
                  className="bar-lock-button"
                  onClick={() => onToggleLock(bar.index)}
                  aria-label={`${bar.index + 1}小節目を${locked ? "ロック解除" : "ロック"}`}
                  title={locked ? "ロック解除" : "再生成から保護"}
                >
                  <Icon name={locked ? "lock" : "unlock"} />
                </button>
              </div>
              <div
                className={`chord-content-group count-${Math.max(1, barChords.length)}`}
                style={barChords.length > 0
                  ? {
                    gridTemplateColumns: barChords.map((item) => {
                      const overlapStart = Math.max(item.startTick, bar.startTick);
                      const overlapEnd = Math.min(item.startTick + item.durationTick, barEnd);
                      return `${Math.max(1, overlapEnd - overlapStart)}fr`;
                    }).join(" "),
                  }
                  : undefined}
              >
                {barChords.length === 0 ? (
                  <button
                    type="button"
                    className="chord-content"
                    aria-pressed={selected}
                    onClick={(event) => onBarSelect(bar.index, event.shiftKey)}
                  >
                    <strong>—</strong>
                    <span className="roman-numeral" />
                    <span className="function-name">Empty</span>
                  </button>
                ) : (
                  barChords.map((item) => {
                    const heldOver = item.startTick < bar.startTick;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={[
                          "chord-content",
                          item.function,
                          selectedChordId === item.id ? "inspected" : "",
                          heldOver ? "held-over" : "",
                        ].filter(Boolean).join(" ")}
                        aria-pressed={selectedChordId === item.id}
                        title={heldOver ? `${item.symbol}（前の小節から継続）` : item.symbol}
                        onClick={(event) => {
                          if (selectedChordId !== item.id) onCloseChordEditor();
                          onBarSelect(bar.index, event.shiftKey);
                          onChordSelect(item);
                        }}
                        onDoubleClick={onOpenChordEditor}
                      >
                        <strong>{heldOver ? `(${item.symbol})` : item.symbol}</strong>
                        <span className="roman-numeral">{item.romanNumeral}</span>
                        <span className="function-name">
                          {FUNCTION_LABELS[item.function]}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </article>
          );
        })}
      </div>
      <p className="lane-tip">クリックで1小節、Shift＋クリックで範囲を選択。鍵は部分再生成から小節を保護します。</p>
      {chordEditorOpen && selectedChord && (
        <ChordEditor
          chord={selectedChord}
          locked={selectedLocked}
          onApply={(edit) => onEditChord(selectedChord.id, edit)}
          onClose={onCloseChordEditor}
        />
      )}
    </section>
  );
}
