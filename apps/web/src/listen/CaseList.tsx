import type { ListeningCase } from "@vsc/core";
import type { Judgment } from "./session";
import { caseMeta, caseTitle } from "./format";
import { CheckIcon } from "./icons";

interface CaseListProps {
  cases: ListeningCase[];
  currentId: string;
  judgments: Record<string, Judgment> | null;
  onSelect: (caseId: string) => void;
}

const VERDICT_LABELS = { A: "A", B: "B", same: "同じ" } as const;

export function CaseList({ cases, currentId, judgments, onSelect }: CaseListProps) {
  return (
    <ol className="case-list">
      {cases.map((listeningCase) => {
        const judgment = judgments?.[listeningCase.id];
        return (
          <li key={listeningCase.id}>
            <button
              type="button"
              className="case"
              aria-current={listeningCase.id === currentId ? "true" : undefined}
              onClick={() => onSelect(listeningCase.id)}
            >
              <span className="case-title">{caseTitle(listeningCase)}</span>
              <span className="case-meta">{caseMeta(listeningCase)}</span>
              {judgment && (
                <span className="case-verdict">
                  <CheckIcon />
                  {VERDICT_LABELS[judgment.verdict]}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
