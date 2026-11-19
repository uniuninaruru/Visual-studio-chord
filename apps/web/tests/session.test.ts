import { createSession, isComplete, judge, sessionResult, tally } from "../src/listen/session";

function sequence(...values: number[]) {
  let index = 0;
  return () => values[index++ % values.length]!;
}

describe("listening session", () => {
  const cases = ["c1", "c2", "c3"];
  const engines: [string, string] = ["old", "new"];

  it("puts each version behind A and B by chance, per case", () => {
    const session = createSession(cases, engines, sequence(0.9, 0.1, 0.9, 0.1));
    expect(session.pairings.map((pairing) => pairing.A)).toEqual(["old", "new", "old"]);
    for (const pairing of session.pairings) expect(new Set([pairing.A, pairing.B])).toEqual(new Set(engines));
  });

  it("credits the version behind the chosen side, not the side", () => {
    let session = createSession(cases, engines, sequence(0.9, 0.1, 0.9, 0.1));
    session = judge(session, "c1", "A", ""); // old behind A
    session = judge(session, "c2", "A", ""); // new behind A
    session = judge(session, "c3", "same", "");
    expect(tally(session)).toEqual({
      old: { wins: 1, losses: 1, ties: 1 },
      new: { wins: 1, losses: 1, ties: 1 },
    });
  });

  it("is complete only when every case is judged", () => {
    // Every draw below one half puts the second version behind A, so "old" is B throughout.
    let session = createSession(cases, engines, sequence(0.3));
    session = judge(session, "c1", "B", "");
    session = judge(session, "c2", "B", "");
    expect(isComplete(session)).toBe(false);
    session = judge(session, "c3", "B", "bass is muddy");
    expect(isComplete(session)).toBe(true);
    const result = sessionResult(session);
    expect(result.judgments[2]).toMatchObject({ caseId: "c3", A: "new", B: "old", preferred: "old", note: "bass is muddy" });
  });
});
