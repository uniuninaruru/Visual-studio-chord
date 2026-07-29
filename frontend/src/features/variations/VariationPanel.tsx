import type { ExplicitFeedbackType, PreferenceScore } from "../../preference/types";
import type { NeuralHarmonyPreviewMetadata } from "../../api/inferenceTypes";
import type { GeneratedComposition } from "../../types/music";

export interface VariationCandidate {
  composition: GeneratedComposition;
  /** Index in the store's immutable previewVariations array. */
  sourceIndex: number;
  preference?: PreferenceScore | null;
  neural?: NeuralHarmonyPreviewMetadata;
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

function neuralDeviceLabel(metadata: NeuralHarmonyPreviewMetadata): string {
  if (metadata.device === null) return "Device unknown";
  return metadata.device === "mps" ? "Apple Metal" : metadata.device.toUpperCase();
}

function neuralTitle(metadata: NeuralHarmonyPreviewMetadata): string {
  return [
    `Model: ${metadata.modelId}`,
    `Backend: ${metadata.backend}`,
    `Device: ${metadata.device ?? "not reported"}`,
    `Dtype: ${metadata.dtype ?? "not reported"}`,
    `Checkpoint: ${metadata.checkpointSha256 ?? "none"}`,
    `Tokenizer: ${metadata.tokenizerSha256}`,
    metadata.sourceCommit ? `Source commit: ${metadata.sourceCommit}` : null,
    `${metadata.candidateCount} proposals · forward batch ${metadata.batchSize}`,
    metadata.cpuFallbackUsed ? `CPU fallback: ${metadata.fallbackReason ?? "used"}` : null,
  ].filter(Boolean).join("\n");
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
    <section
      className="variation-panel"
      aria-labelledby="variation-panel-title"
      aria-live="polite"
    >
      <header className="variation-panel-heading">
        <div>
          <p className="eyebrow">VARIATIONS</p>
          <h2 id="variation-panel-title">候補 A / B / C</h2>
        </div>
        <p className="variation-panel-help">
          すべてプレビューです。試聴だけでは編集中の曲は変わらず、採用時だけ履歴へ保存されます。
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
            const { composition, preference, sourceIndex, neural } = candidate;

            return (
              <article
                key={composition.id}
                className={`variation-card${isAuditioning ? " is-auditioning" : ""}`}
                data-candidate={label}
                title={neural ? neuralTitle(neural) : undefined}
              >
                <header className="variation-card-heading">
                  <span className="variation-candidate-label" aria-label={`候補 ${label}`}>
                    {label}
                  </span>
                  <div className="variation-candidate-meta">
                    <strong>{composition.resolvedStyle}</strong>
                    <span>{composition.cadence} cadence</span>
                  </div>
                  {neural && (
                    <span
                      className={`variation-neural-badge${neural.mock ? " is-mock" : ""}`}
                      aria-label={neural.mock
                        ? "明示的な未学習Mock候補"
                        : `学習済みニューラル候補、${neuralDeviceLabel(neural)}`}
                    >
                      {neural.mock ? "Mock · untrained" : `Neural · ${neuralDeviceLabel(neural)}`}
                    </span>
                  )}
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
                  {neural && (
                    <>
                      <div>
                        <dt>Neural confidence</dt>
                        <dd>{Math.round(neural.meanConfidence * 100)}%</dd>
                      </div>
                      <div>
                        <dt>Client gate</dt>
                        <dd>
                          Validated
                          {neural.theoryWarnings.length + neural.arrangementWarnings.length > 0
                            ? ` · ${neural.theoryWarnings.length + neural.arrangementWarnings.length} warnings`
                            : ""}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>

                {neural && (
                  <div className="variation-provenance-row" aria-label="候補の推論情報">
                    <span>{neural.backend}</span>
                    <span>{neural.checkpointSha256
                      ? `ckpt ${neural.checkpointSha256.slice(0, 8)}`
                      : "checkpointなし"}</span>
                    <span>{neural.candidateCount}候補 · batch {neural.batchSize}</span>
                    {neural.cpuFallbackUsed && <span>CPU fallback</span>}
                    {neural.rebasedAgainstNewerEdits && (
                      <span title="生成中の編集内容へ再検証してリベース済み">Rebased</span>
                    )}
                  </div>
                )}

                <div className="variation-primary-actions">
                  <button
                    className="secondary-button variation-audition-button"
                    type="button"
                    aria-pressed={isAuditioning}
                    aria-label={`候補 ${label} を同じ位置から${isAuditioning ? "試聴停止" : "試聴"}`}
                    onClick={() => onAudition(isAuditioning ? null : sourceIndex)}
                  >
                    {isAuditioning ? "試聴を停止" : "同じ位置から試聴"}
                  </button>
                  <button
                    className="primary-button variation-adopt-button"
                    type="button"
                    // The accessible name has to contain the visible text, or a
                    // voice-control user reading "この候補を採用" off the screen
                    // cannot activate the button they are looking at. An
                    // aria-label replaces the text rather than adding to it, so
                    // the extra context is wrapped around the visible words
                    // instead of paraphrasing them away.
                    aria-label={`候補 ${label}: この候補を採用して履歴へ保存`}
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
