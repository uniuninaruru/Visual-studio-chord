import { Icon } from "../../components/Icon";
import type { BarRange, RegenerationTarget } from "../../types/music";

interface RegenerationDockProps {
  selectedRange: BarRange | null;
  lockedCount: number;
  target: RegenerationTarget;
  onTargetChange: (target: RegenerationTarget) => void;
  onRegenerate: () => void;
  onSelectAll: () => void;
}

const TARGETS: Array<{ value: RegenerationTarget; label: string }> = [
  { value: "all", label: "コード＋メロディ" },
  { value: "chords", label: "コードのみ" },
  { value: "melody", label: "メロディのみ" },
  { value: "pitch", label: "音高のみ" },
  { value: "rhythm", label: "リズムのみ" },
];

export function RegenerationDock({
  selectedRange,
  lockedCount,
  target,
  onTargetChange,
  onRegenerate,
  onSelectAll,
}: RegenerationDockProps) {
  return (
    <section className="regeneration-dock" aria-label="部分再生成">
      <div className="selection-status">
        <span className="selection-icon"><Icon name="sparkles" /></span>
        <div>
          <strong>{selectedRange ? `${selectedRange.startBar + 1}–${selectedRange.endBar} 小節を選択中` : "再生成する範囲を選択"}</strong>
          <span>{lockedCount > 0 ? `${lockedCount}小節を保護中` : "ロックした小節は変更されません"}</span>
        </div>
      </div>

      <div className="target-control" role="group" aria-label="再生成対象">
        {TARGETS.map((item) => (
          <button
            key={item.value}
            className={target === item.value ? "active" : ""}
            type="button"
            onClick={() => onTargetChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="regeneration-actions">
        {selectedRange ? (
          <button className="primary-button regenerate-button" type="button" onClick={onRegenerate}>
            <Icon name="sparkles" />
            選択範囲を再生成
          </button>
        ) : (
          <button className="secondary-button select-all-button" type="button" onClick={onSelectAll}>
            曲全体を選択
          </button>
        )}
      </div>
    </section>
  );
}
