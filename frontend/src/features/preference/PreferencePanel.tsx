import {
  PREFERENCE_CATEGORIES,
  type PreferenceCategory,
  type PreferenceExplanation,
} from "../../preference/types";

export interface PreferencePanelProps {
  explanation: PreferenceExplanation;
  category: PreferenceCategory;
  onCategoryChange: (category: PreferenceCategory) => void;
  onExport: () => void;
  onImport: () => void;
  onReset: () => void;
}

const CATEGORY_LABELS: Readonly<Record<PreferenceCategory, string>> = {
  harmony: "ハーモニー",
  melody: "メロディ",
  rhythm: "リズム",
  voicing: "ボイシング",
  combined: "総合",
};

export function PreferencePanel({
  explanation,
  category,
  onCategoryChange,
  onExport,
  onImport,
  onReset,
}: PreferencePanelProps) {
  const confidencePercent = Math.round(
    Math.max(0, Math.min(1, explanation.confidence)) * 100,
  );

  return (
    <section
      className="preference-panel"
      aria-labelledby="preference-panel-title"
      data-status={explanation.status}
    >
      <header className="preference-panel-heading">
        <div>
          <p className="eyebrow">PREFERENCE</p>
          <h2 id="preference-panel-title">好みの学習</h2>
        </div>
        <label className="preference-category-field">
          <span>評価カテゴリ</span>
          <select
            value={category}
            onChange={(event) => onCategoryChange(event.target.value as PreferenceCategory)}
          >
            {PREFERENCE_CATEGORIES.map((item) => (
              <option key={item} value={item}>{CATEGORY_LABELS[item]}</option>
            ))}
          </select>
        </label>
      </header>

      <div className="preference-evidence-summary">
        <div className="preference-confidence">
          <div>
            <span>信頼度</span>
            <strong>{confidencePercent}%</strong>
          </div>
          <progress max={100} value={confidencePercent}>{confidencePercent}%</progress>
        </div>
        <div className="preference-feedback-count">
          <span>フィードバック</span>
          <strong>{explanation.feedbackCount}件</strong>
        </div>
      </div>

      <section className="preference-reasons" aria-labelledby="preference-reasons-title">
        <header>
          <h3 id="preference-reasons-title">学習した傾向</h3>
          <span>{CATEGORY_LABELS[category]}</span>
        </header>
        <p className="preference-explanation-summary">{explanation.summary}</p>

        {explanation.status === "ready" && explanation.reasons.length > 0 ? (
          <ol className="preference-reason-list">
            {explanation.reasons.map((reason) => (
              <li key={reason.feature} className={`is-${reason.direction}`}>
                <span className="preference-reason-direction">
                  {reason.direction === "prefer" ? "好む傾向" : "避ける傾向"}
                </span>
                <strong>{reason.label}</strong>
                <span className="preference-reason-evidence">
                  根拠 {reason.evidenceCount}件 · 影響 {reason.contribution >= 0 ? "+" : ""}{reason.contribution.toFixed(3)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="preference-insufficient-evidence">
            Like / Dislike などの明示的な評価が増えると、根拠のある傾向だけを表示します。
          </p>
        )}
      </section>

      <footer className="preference-data-actions">
        <button type="button" onClick={onExport}>学習データを書き出す</button>
        <button type="button" onClick={onImport}>学習データを読み込む</button>
        <button className="danger-button" type="button" onClick={onReset}>学習をリセット</button>
      </footer>
    </section>
  );
}
