import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { caseSetProblems, renderProblems, renderSeconds, type CaseSet, type Render } from "../src";

const evalDir = join(import.meta.dirname, "../../../eval");
const caseSet = JSON.parse(readFileSync(join(evalDir, "cases.json"), "utf8")) as CaseSet;
const engines = readdirSync(join(evalDir, "renders"));

describe("listening set", () => {
  it("is well formed", () => {
    expect(caseSetProblems(caseSet)).toEqual([]);
    expect(caseSet.cases).toHaveLength(12);
  });
});

describe.each(engines)("renders from %s", (engine) => {
  it.each(caseSet.cases.map((listeningCase) => listeningCase.id))("%s plays as specified", (caseId) => {
    const render = JSON.parse(readFileSync(join(evalDir, "renders", engine, `${caseId}.json`), "utf8")) as Render;
    const spec = caseSet.cases.find((listeningCase) => listeningCase.id === caseId)!;
    expect(renderProblems(render)).toEqual([]);
    expect(render.caseId).toBe(caseId);
    expect(render.bpm).toBe(spec.bpm);
    // Two renders of one case must be the same length to be switched between mid-play.
    const beatsPerBar = render.timeSignature === "3/4" ? 3 : render.timeSignature === "6/8" ? 3 : 4;
    expect(render.totalTicks).toBe(spec.bars * beatsPerBar * render.ppq);
    expect(renderSeconds(render)).toBeGreaterThan(0);
  });
});
