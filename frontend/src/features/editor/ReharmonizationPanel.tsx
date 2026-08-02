import type { ReharmonizationCandidate, ReharmonizationType } from "../../music/reharmonization";
import type { ChordEvent } from "../../types/music";

export interface ReharmonizationPanelProps {
  /** The chord being replaced, or null when nothing is selected. */
  chord: ChordEvent | null;
  candidates: readonly ReharmonizationCandidate[];
  unavailableReason: string | null;
  auditioningSymbol: string | null;
  onAudition: (candidate: ReharmonizationCandidate) => void;
  onApply: (candidate: ReharmonizationCandidate) => void;
}

const TECHNIQUE_LABELS: Record<ReharmonizationType, string> = {
  diatonicSubstitution: "ダイアトニック代理",
  secondaryDominant: "セカンダリードミナント",
  tritoneSubstitution: "裏コード",
  modalInterchange: "モーダルインターチェンジ",
  diminishedPassing: "経過ディミニッシュ",
  backdoorDominant: "バックドアドミナント",
  pedalPoint: "ペダルポイント",
  slashChord: "分数コード",
  chromaticMediant: "クロマチックメディアント",
};

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function ReharmonizationPanel({
  chord,
  candidates,
  unavailableReason,
  auditioningSymbol,
  onAudition,
  onApply,
}: ReharmonizationPanelProps) {
  return (
    <section
      className="reharmonization-panel"
      aria-labelledby="reharmonization-panel-title"
    >
      <header className="reharmonization-heading">
        <div>
          <p className="eyebrow">REHARMONIZE</p>
          <h2 id="reharmonization-panel-title">
            {chord ? `${chord.symbol} の置き換え候補` : "コードの置き換え"}
          </h2>
        </div>
        <p className="reharmonization-help">
          候補は試聴だけでは曲を変えません。採用を押したときだけ反映され、Undoで戻せます。
        </p>
      </header>

      {unavailableReason !== null ? (
        <p className="reharmonization-empty-state">{unavailableReason}</p>
      ) : (
        <ol className="reharmonization-candidates">
          {candidates.map((candidate) => {
            const auditioning = auditioningSymbol === candidate.symbol;
            return (
              <li
                key={`${candidate.symbol}-${candidate.type}`}
                className={`reharmonization-candidate${auditioning ? " is-auditioning" : ""}`}
                data-technique={candidate.type}
              >
                <div className="reharmonization-candidate-heading">
                  <strong className="reharmonization-symbol">{candidate.symbol}</strong>
                  <span className="reharmonization-technique">
                    {TECHNIQUE_LABELS[candidate.type]}
                  </span>
                  <span
                    className="reharmonization-score"
                    title={
                      `旋律との適合 ${percent(candidate.melodyFit)}・`
                      + `進行としての自然さ ${percent(candidate.functionalFit)}・`
                      + `スタイル適合 ${percent(candidate.styleFit)}`
                    }
                  >
                    {percent(candidate.score)}
                  </span>
                </div>

                <p className="reharmonization-explanation">{candidate.explanation}</p>

                {candidate.unsupportedMelodyNotes.length > 0 && (
                  <p className="reharmonization-warning">
                    旋律の {candidate.unsupportedMelodyNotes.length} 音がこの和音に含まれません。
                  </p>
                )}

                <div className="reharmonization-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    aria-pressed={auditioning}
                    // The accessible name has to contain the visible text, or
                    // someone using voice control cannot activate the button
                    // they can see.
                    aria-label={`${candidate.symbol} を試聴`}
                    onClick={() => onAudition(candidate)}
                  >
                    試聴
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    aria-label={`${candidate.symbol} を採用してコードを置き換え`}
                    onClick={() => onApply(candidate)}
                  >
                    採用
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
