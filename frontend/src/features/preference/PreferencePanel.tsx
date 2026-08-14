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
  /** Draws the generate button makes before the model picks one. 1 is off. */
  guidanceCandidates: number;
  onGuidanceCandidatesChange: (value: number) => void;
  /** The highest the field allows, so the panel does not name its own bound. */
  maxGuidanceCandidates: number;
  /** What the last guided press actually chose, when there was one. */
  lastChoice?: { index: number; considered: number } | null;
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
  guidanceCandidates,
  onGuidanceCandidatesChange,
  maxGuidanceCandidates,
  lastChoice,
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

      {/*
        * What the learning is for. Until this existed the model reordered the
        * A/B list and nothing else: every judgement changed which of five
        * already-drawn candidates appeared first, and never what the generator
        * drew.
        *
        * Off by default and stated as what it is -- several draws, the model
        * picks one -- because it costs a draw's worth of time each and because
        * handing the choice over is a decision rather than a default.
        */}
      <section className="preference-guidance" aria-labelledby="preference-guidance-title">
        <header>
          <h3 id="preference-guidance-title">生成に反映する</h3>
        </header>
        <label className="preference-guidance-field">
          <span>1回の生成で作る案</span>
          <input
            type="number"
            min={1}
            max={maxGuidanceCandidates}
            step={1}
            value={guidanceCandidates}
            onChange={(event) => onGuidanceCandidatesChange(Number(event.target.value))}
          />
        </label>
        <p className="preference-guidance-note">
          {guidanceCandidates <= 1
            ? "1のあいだ、生成は学習を参照しません。2以上にすると、その数だけ作って学習した好みに近いものを残します。"
            : `${guidanceCandidates}案を作り、${CATEGORY_LABELS[category]}の学習に最も近いものを残します。`
              + "選ばれた案のシードが曲に記録されるので、同じシードなら学習なしでも同じ曲になります。"}
        </p>
        {lastChoice && lastChoice.considered > 1 && (
          <p className="preference-guidance-last" role="status">
            前回は{lastChoice.considered}案のうち
            {lastChoice.index + 1}番目を選びました。
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
