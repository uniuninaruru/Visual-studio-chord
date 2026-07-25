import { Icon } from "../../components/Icon";
import type { BarRange, ChordEvent, GeneratedComposition, HarmonyFunction } from "../../types/music";

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
}: ChordLaneProps) {
  const currentBar = Math.min(
    composition.bars.length - 1,
    Math.floor(currentTick / composition.ticksPerBar),
  );

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
              <div className={`chord-content-group count-${Math.max(1, barChords.length)}`}>
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
                        aria-pressed={selected}
                        title={heldOver ? `${item.symbol}（前の小節から継続）` : item.symbol}
                        onClick={(event) => {
                          onBarSelect(bar.index, event.shiftKey);
                          onChordSelect(item);
                        }}
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
    </section>
  );
}
