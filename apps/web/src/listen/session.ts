/**
 * A blind listening session: which version sits behind A and B for each case,
 * and what the listener chose. Version names stay hidden until every case is
 * judged.
 */

export type Side = "A" | "B";
export type Verdict = Side | "same";

export interface Pairing {
  caseId: string;
  A: string;
  B: string;
}

export interface Judgment {
  verdict: Verdict;
  note: string;
  judgedAt: string;
}

export interface Session {
  id: string;
  engines: [string, string];
  pairings: Pairing[];
  judgments: Record<string, Judgment>;
  startedAt: string;
}

export interface EngineTally {
  wins: number;
  losses: number;
  ties: number;
}

export const LISTENING_FORMAT = "vsc-listening/1";

export function createSession(
  caseIds: readonly string[],
  engines: [string, string],
  random: () => number,
  now: Date = new Date(),
): Session {
  const pairings = caseIds.map((caseId) => {
    const flip = random() < 0.5;
    return { caseId, A: flip ? engines[1] : engines[0], B: flip ? engines[0] : engines[1] };
  });
  return {
    id: `${now.toISOString()}-${Math.floor(random() * 1e9).toString(36)}`,
    engines,
    pairings,
    judgments: {},
    startedAt: now.toISOString(),
  };
}

export function judge(session: Session, caseId: string, verdict: Verdict, note: string, now: Date = new Date()): Session {
  return {
    ...session,
    judgments: { ...session.judgments, [caseId]: { verdict, note, judgedAt: now.toISOString() } },
  };
}

export function isComplete(session: Session): boolean {
  return session.pairings.every((pairing) => session.judgments[pairing.caseId] !== undefined);
}

/** The engine the listener preferred for one case, or null for a tie. */
export function winnerOf(pairing: Pairing, verdict: Verdict): string | null {
  return verdict === "same" ? null : pairing[verdict];
}

export function tally(session: Session): Record<string, EngineTally> {
  const result: Record<string, EngineTally> = {};
  for (const engine of session.engines) result[engine] = { wins: 0, losses: 0, ties: 0 };
  for (const pairing of session.pairings) {
    const judgment = session.judgments[pairing.caseId];
    if (!judgment) continue;
    const winner = winnerOf(pairing, judgment.verdict);
    for (const engine of session.engines) {
      const entry = result[engine]!;
      if (winner === null) entry.ties += 1;
      else if (winner === engine) entry.wins += 1;
      else entry.losses += 1;
    }
  }
  return result;
}

/** What gets written to eval/results: every choice, with the versions revealed. */
export function sessionResult(session: Session, finishedAt: Date = new Date()) {
  return {
    format: LISTENING_FORMAT,
    sessionId: session.id,
    startedAt: session.startedAt,
    finishedAt: finishedAt.toISOString(),
    engines: session.engines,
    tally: tally(session),
    judgments: session.pairings.map((pairing) => {
      const judgment = session.judgments[pairing.caseId];
      return {
        caseId: pairing.caseId,
        A: pairing.A,
        B: pairing.B,
        verdict: judgment?.verdict ?? null,
        preferred: judgment ? winnerOf(pairing, judgment.verdict) : null,
        note: judgment?.note ?? "",
      };
    }),
  };
}

export function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Session>;
  return typeof candidate.id === "string"
    && Array.isArray(candidate.engines) && candidate.engines.length === 2
    && Array.isArray(candidate.pairings)
    && typeof candidate.judgments === "object" && candidate.judgments !== null;
}
