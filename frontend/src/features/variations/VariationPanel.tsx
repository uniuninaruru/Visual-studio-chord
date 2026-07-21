import type { ExplicitFeedbackType, PreferenceScore } from "../../preference/types";
import type { GeneratedComposition } from "../../types/music";

export interface VariationCandidate {
  composition: GeneratedComposition;
  /** Index in the store's immutable previewVariations array. */
  sourceIndex: number;
  preference?: PreferenceScore | null;
}

export interface VariationPanelProps {
  candidates: readonly VariationCandidate[];
  activeAuditionIndex: number | null;
  onAudition: (index: number | null) => void;
  onAdopt: (index: number) => void;
  onFeedback: (index: number, feedback: ExplicitFeedbackType) => void;
}

const FEEDBACK_ACTIONS: ReadonlyArray<{
  type: ExplicitFeedbackType;
  label: string;
}> = [
  { type: "like", label: "Like" },
  { type: "dislike", label: "Dislike" },
  { type: "favorite", label: "Favorite" },
  { type: "notMyStyle", label: "Not my style" },
];

function candidateLabel(index: number): string {
  return ["A", "B", "C"][index] ?? String(index + 1);
}

function formatPreferenceScore(score: number): string {
  const normalized = Math.max(-1, Math.min(1, score));
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(2)}`;
}

function chordSummary(composition: GeneratedComposition): string {
  const symbols = composition.chords.map((chord) => chord.symbol);
  const visible = symbols.slice(0, 8);
  return `${visible.join(" — ")}${symbols.length > visible.length ? " …" : ""}`;
}

export function VariationPanel({
  candidates,
  activeAuditionIndex,
  onAudition,
  onAdopt,
  onFeedback,
}: VariationPanelProps) {
  const visibleCandidates = candidates.slice(0, 3);

  return (
    <section className="variation-panel" aria-labelledby="variation-panel-title">
      <header className="variation-panel-heading">
        <div>
          <p className="eyebrow">VARIATIONS</p>
          <h2 id="variation-panel-title">候補 A / B / C</h2>
        </div>
        <p className="variation-panel-help">
          試聴だけでは編集中の曲は変わりません。採用すると履歴へ保存されます。
        </p>
      </header>

      {visibleCandidates.length === 0 ? (
        <p className="variation-empty-state">
          範囲を選択して再生成すると、比較できる候補がここに表示されます。
        </p>
      ) : (
        <div className="variation-card-grid">
          {visibleCandidates.map((candidate) => {
            const label = candidateLabel(candidate.sourceIndex);
            const isAuditioning = activeAuditionIndex === candidate.sourceIndex;
            const { composition, preference, sourceIndex } = candidate;

            return (
              <article
                key={composition.id}
                className={`variation-card${isAuditioning ? " is-auditioning" : ""}`}
                data-candidate={label}
              >
                <header className="variation-card-heading">
                  <span className="variation-candidate-label" aria-label={`候補 ${label}`}>
                    {label}
                  </span>
                  <div className="variation-candidate-meta">
                    <strong>{composition.resolvedStyle}</strong>
                    <span>{composition.cadence} cadence</span>
                  </div>
                  {isAuditioning && <span className="variation-audition-badge">試聴中</span>}
                </header>

                <div className="variation-chord-summary">
                  <span>コード</span>
                  <p>{chordSummary(composition) || "コードなし"}</p>
                </div>

                <dl className="variation-preference-score">
                  <div>
                    <dt>好みスコア</dt>
                    <dd>{preference ? formatPreferenceScore(preference.score) : "学習前"}</dd>
                  </div>
                  <div>
                    <dt>信頼度</dt>
                    <dd>{preference ? `${Math.round(preference.confidence * 100)}%` : "—"}</dd>
                  </div>
                </dl>

                <div className="variation-primary-actions">
                  <button
                    className="secondary-button variation-audition-button"
                    type="button"
                    aria-pressed={isAuditioning}
                    onClick={() => onAudition(isAuditioning ? null : sourceIndex)}
                  >
                    {isAuditioning ? "試聴を停止" : "同じ位置から試聴"}
                  </button>
                  <button
                    className="primary-button variation-adopt-button"
                    type="button"
                    onClick={() => onAdopt(sourceIndex)}
                  >
                    この候補を採用
                  </button>
                </div>

                <div className="variation-feedback-actions" aria-label={`候補 ${label} の評価`}>
                  {FEEDBACK_ACTIONS.map((action) => (
                    <button
                      key={action.type}
                      className={`preference-action preference-${action.type}`}
                      type="button"
                      onClick={() => onFeedback(sourceIndex, action.type)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
