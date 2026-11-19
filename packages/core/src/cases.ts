/**
 * The fixed listening set.
 *
 * Twelve pieces every engine version is rendered on. A change to generation
 * becomes the default only after it wins or ties these, blind, by ear.
 */

export const CASES_FORMAT = "vsc-cases/1";

export interface ListeningCase {
  id: string;
  style: string;
  key: string;
  mode: string;
  bpm: number;
  bars: number;
  seed: string;
}

export interface CaseSet {
  format: typeof CASES_FORMAT;
  cases: ListeningCase[];
}

export function caseSetProblems(set: CaseSet): string[] {
  const problems: string[] = [];
  if (set.format !== CASES_FORMAT) problems.push(`format is ${String(set.format)}`);
  const seen = new Set<string>();
  for (const listeningCase of set.cases) {
    if (seen.has(listeningCase.id)) problems.push(`duplicate case ${listeningCase.id}`);
    seen.add(listeningCase.id);
    if (!(listeningCase.bpm > 0)) problems.push(`${listeningCase.id}: bpm ${listeningCase.bpm}`);
    if (!Number.isInteger(listeningCase.bars) || listeningCase.bars < 1) {
      problems.push(`${listeningCase.id}: bars ${listeningCase.bars}`);
    }
  }
  return problems;
}
