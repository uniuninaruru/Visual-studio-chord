import { Icon } from "../../components/Icon";
import type { AutoFixResult } from "../../music";

interface AutoFixPanelProps {
  result: AutoFixResult | null;
  stale: boolean;
  onAnalyze: () => void;
  onApply: () => void;
  onDismiss: () => void;
}

export function AutoFixPanel({
  result,
  stale,
  onAnalyze,
  onApply,
  onDismiss,
}: AutoFixPanelProps) {
  return (
    <section className="auto-fix-panel" aria-labelledby="auto-fix-title">
      <div className="auto-fix-copy">
        <span className="auto-fix-icon"><Icon name="sparkles" /></span>
        <div>
          <p className="eyebrow">AUTO FIX MODE</p>
          <h2 id="auto-fix-title">よく分からなくても、曲を自動で整える</h2>
          <p>
            ①診断 → ②直す内容を確認 → ③適用。診断だけでは曲を変更しません。
            適用後もUndoで元に戻せます。
          </p>
        </div>
      </div>
      {!result ? (
        <button className="auto-fix-start" type="button" onClick={onAnalyze}>
          <Icon name="sparkles" />
          この曲を診断
        </button>
      ) : (
        <div className="auto-fix-result" aria-live="polite">
          <div className="auto-fix-result-heading">
            <div>
              <strong>{result.changes.length > 0 ? `${result.changes.length}個の改善案` : "すでに整っています"}</strong>
              <span>まだ元の曲は変更していません</span>
            </div>
            <button type="button" className="text-button" onClick={onDismiss}>閉じる</button>
          </div>
          {stale && (
            <p className="auto-fix-stale">
              診断後に曲が変わりました。もう一度診断してください。
            </p>
          )}
          <ol className="auto-fix-change-list">
            {result.changes.map((change) => (
              <li key={change.id}>
                <span>✓</span>
                <div><strong>{change.label}</strong><small>{change.reason}</small></div>
              </li>
            ))}
          </ol>
          <div className="auto-fix-checks">
            {result.checks.map((check) => <span key={check}>{check}</span>)}
          </div>
          <div className="auto-fix-actions">
            <button className="secondary-button" type="button" onClick={onAnalyze}>
              再診断
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={stale || result.changes.length === 0}
              onClick={onApply}
            >
              修正版を生成して適用
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
