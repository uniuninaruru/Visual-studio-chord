import { renderProblems, RENDER_FORMAT, type Render } from "../src";

function render(overrides: Partial<Render> = {}): Render {
  return {
    format: RENDER_FORMAT,
    caseId: "x",
    engine: "test",
    bpm: 120,
    timeSignature: "4/4",
    ppq: 480,
    totalTicks: 1920,
    chords: [{ symbol: "C", start: 0, dur: 1920 }],
    sections: [],
    tracks: [{ role: "melody", notes: [{ midi: 60, start: 0, dur: 480, vel: 90 }] }],
    ...overrides,
  };
}

describe("renderProblems", () => {
  it("accepts a valid render", () => {
    expect(renderProblems(render())).toEqual([]);
  });

  it.each([
    ["a pitch below the piano", { midi: 20, start: 0, dur: 480, vel: 90 }, /outside the piano/],
    ["a zero duration", { midi: 60, start: 0, dur: 0, vel: 90 }, /duration/],
    ["a note past the end", { midi: 60, start: 1800, dur: 480, vel: 90 }, /outside 0\.\.1920/],
    ["a silent velocity", { midi: 60, start: 0, dur: 480, vel: 0 }, /velocity/],
  ])("reports %s", (_label, note, message) => {
    const problems = renderProblems(render({ tracks: [{ role: "melody", notes: [note] }] }));
    expect(problems.join("\n")).toMatch(message);
  });

  it("reports overlapping chords", () => {
    const problems = renderProblems(render({
      chords: [{ symbol: "C", start: 0, dur: 1000 }, { symbol: "F", start: 960, dur: 960 }],
    }));
    expect(problems.join("\n")).toMatch(/overlaps/);
  });
});
