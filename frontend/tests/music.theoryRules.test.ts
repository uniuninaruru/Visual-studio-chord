import { describe, expect, it } from "vitest";
import type { ChordEvent, NoteEvent } from "../src/types/music";
import { evaluateTheory, type EvaluateTheoryOptions, type TheoryPart } from "../src/music/theoryRules";

const note = (id: string, midi: number, startTick: number, durationTick: number): NoteEvent => ({
  id,
  midi,
  noteName: `n${midi}`,
  startTick,
  durationTick,
  velocity: 90,
  barIndex: 0,
  role: "chordTone",
});

const chord = (
  id: string,
  root: ChordEvent["root"],
  quality: ChordEvent["quality"],
  startTick: number,
  durationTick: number,
  tensions: ChordEvent["tensions"] = [],
): ChordEvent => ({
  id,
  symbol: `${root}${quality}`,
  romanNumeral: "I",
  function: "tonic",
  degree: 1,
  quality,
  root,
  startTick,
  durationTick,
  notes: [],
  inversion: 0,
  source: "other",
  tensions,
});

const part = (id: string, notes: readonly NoteEvent[], extra: Partial<TheoryPart> = {}): TheoryPart => ({
  id,
  notes,
  ...extra,
});

const evaluate = (patch: Partial<EvaluateTheoryOptions> & Pick<EvaluateTheoryOptions, "parts" | "chords">) =>
  evaluateTheory({ timeSignature: "4/4", ppq: 480, profile: "tonal", ...patch });

describe("theory rule evaluator", () => {
  it("uses the app piano range by default and reports a caller-narrowed range", () => {
    const defaultOutOfRange = evaluate({
      chords: [chord("c", "C", "major", 0, 960)],
      parts: [part("lead", [note("too-low", 20, 0, 480)])],
    });
    expect(defaultOutOfRange).toContainEqual(expect.objectContaining({ ruleId: "VL-INDEPENDENCE", tick: 0, voiceIds: ["lead"], severity: "error", message: expect.stringContaining("outside") }));

    const narrowed = evaluate({
      chords: [chord("c", "C", "major", 0, 960)],
      parts: [part("lead", [note("too-high", 76, 0, 480)], { range: [48, 72] })],
    });
    expect(narrowed.some((issue) => issue.ruleId === "VL-INDEPENDENCE" && issue.message.includes("outside"))).toBe(true);
  });

  it("reports crossing throughout the event sweep and aligned parallel perfect motion", () => {
    const low = part("low", [note("low-1", 60, 0, 480), note("low-2", 62, 480, 480)]);
    const high = part("high", [note("high-1", 67, 0, 480), note("high-2", 69, 480, 480)]);
    const parallel = evaluate({
      profile: "strictSpecies",
      chords: [chord("c", "C", "major", 0, 960)],
      parts: [low, high],
    });
    expect(parallel.some((issue) => issue.ruleId === "CP-PARALLEL" && issue.tick === 480)).toBe(true);

    const crossing = evaluate({
      chords: [chord("c", "C", "major", 0, 480)],
      parts: [part("low", [note("low", 72, 0, 480)]), part("high", [note("high", 60, 0, 480)])],
    });
    expect(crossing.some((issue) => issue.ruleId === "VL-INDEPENDENCE")).toBe(true);

    const fifthToOctave = evaluate({
      profile: "strictSpecies",
      chords: [chord("c", "C", "major", 0, 960)],
      parts: [
        part("low", [note("low-1", 60, 0, 480), note("low-2", 62, 480, 480)]),
        part("high", [note("high-1", 67, 0, 480), note("high-2", 74, 480, 480)]),
      ],
    });
    expect(fifthToOctave.some((issue) => issue.ruleId === "CP-PARALLEL")).toBe(false);
  });

  it("counts a held note against the new chord at a chord boundary without requiring a new onset", () => {
    const issues = evaluate({
      chords: [chord("c", "C", "major", 0, 480), chord("g", "G", "major", 480, 480)],
      parts: [part("lead", [note("held-e", 64, 0, 960)])],
    });
    expect(issues).toContainEqual(expect.objectContaining({ ruleId: "CP-4", tick: 480, voiceIds: ["lead"] }));
  });

  it("counts a prepared held note as a suspension when it resolves down by step to the new chord", () => {
    const issues = evaluate({
      profile: "strictSpecies",
      chords: [chord("c", "C", "major", 0, 480), chord("g", "G", "major", 480, 480)],
      parts: [part("lead", [note("held-c", 60, 0, 720), note("resolve-b", 59, 720, 240)])],
    });
    expect(issues.some((issue) => issue.ruleId === "CP-4" && issue.tick === 480)).toBe(false);
    expect(issues.some((issue) => issue.ruleId === "CP-1" && issue.tick === 480)).toBe(false);

    const unpreparedResolution = evaluate({
      profile: "strictSpecies",
      chords: [chord("c", "C", "major", 0, 480), chord("g", "G", "major", 480, 480)],
      parts: [part("lead", [note("held-c", 60, 0, 720), note("resolve-d", 62, 720, 240)])],
    });
    expect(unpreparedResolution.some((issue) => issue.ruleId === "CP-4" && issue.tick === 480)).toBe(true);
  });

  it("recognizes weak stepwise passing tones but keeps neighbor tones species-aware", () => {
    const c = chord("c", "C", "major", 0, 960);
    const passing = [note("e", 64, 0, 120), note("f", 65, 120, 120), note("g", 67, 240, 240)];
    expect(evaluate({ profile: "strictSpecies", chords: [c], parts: [part("lead", passing)] }).some((issue) => issue.ruleId === "CP-2")).toBe(false);

    const neighbor = [note("e", 64, 0, 120), note("f", 65, 120, 120), note("e2", 64, 240, 240)];
    const strictNeighbor = evaluate({ profile: "strictSpecies", chords: [c], parts: [part("lead", neighbor)] });
    expect(strictNeighbor).toContainEqual(expect.objectContaining({ ruleId: "CP-3", tick: 120, severity: "error" }));
    expect(evaluate({ profile: "tonal", chords: [c], parts: [part("lead", neighbor)] }).some((issue) => issue.ruleId === "CP-3")).toBe(false);

    const leap = [note("e", 64, 0, 120), note("dissonance", 70, 120, 120), note("g", 67, 240, 240)];
    expect(evaluate({ profile: "tonal", chords: [c], parts: [part("lead", leap)] }).some((issue) => issue.ruleId === "CP-2")).toBe(true);
  });

  it("does not exempt a note that starts exactly on an offbeat chord change as a passing tone", () => {
    const issues = evaluate({
      chords: [chord("c", "C", "major", 0, 120), chord("g", "G", "major", 120, 360)],
      parts: [part("lead", [note("e", 64, 0, 120), note("f-sharp", 66, 120, 120), note("g", 67, 240, 240)])],
    });
    expect(issues).toContainEqual(expect.objectContaining({ ruleId: "CP-1", tick: 120, voiceIds: ["lead"] }));
    expect(issues.some((issue) => issue.ruleId === "CP-2" && issue.tick === 120)).toBe(false);
  });

  it("accepts declared jazz extensions and real sus/6 chord members", () => {
    const jazz9 = evaluate({
      profile: "jazz",
      chords: [chord("c9", "C", "major7", 0, 960, ["9"])],
      parts: [part("lead", [note("d", 62, 0, 480)])],
    });
    expect(jazz9.some((issue) => issue.ruleId === "J-MELODY")).toBe(false);

    const sixth = evaluate({
      profile: "tonal",
      chords: [chord("c6", "C", "major", 0, 960, ["6"])],
      parts: [part("lead", [note("a", 69, 0, 480)])],
    });
    expect(sixth.some((issue) => issue.ruleId === "CP-1" || issue.ruleId === "J-MELODY")).toBe(false);

    const sus = evaluate({
      profile: "strictSpecies",
      chords: [chord("csus", "C", "sus4", 0, 960)],
      parts: [part("lead", [note("f", 65, 0, 480)])],
    });
    expect(sus.some((issue) => issue.ruleId === "CP-1")).toBe(false);
  });

  it("uses compound-duple strong beats in 6/8", () => {
    const issues = evaluate({
      timeSignature: "6/8",
      profile: "tonal",
      chords: [chord("c", "C", "major", 0, 1440)],
      parts: [part("lead", [note("f-sharp", 66, 720, 240)])],
    });
    expect(issues.some((issue) => issue.ruleId === "CP-1" && issue.tick === 720)).toBe(true);
  });

  it("does not turn jazz extensions or parallel motion into strict global bans", () => {
    const issues = evaluate({
      profile: "jazz",
      chords: [chord("c", "C", "major", 0, 960, ["9"])],
      parts: [
        part("low", [note("c1", 60, 0, 480), note("d1", 62, 480, 480)]),
        part("high", [note("g1", 67, 0, 480), note("a1", 69, 480, 480)]),
      ],
    });
    expect(issues.some((issue) => issue.ruleId === "CP-1" && issue.severity === "error")).toBe(false);
    expect(issues.some((issue) => issue.ruleId === "CP-PARALLEL" && issue.severity === "error")).toBe(false);
  });
});
