import { describe, expect, it } from "vitest";
import { describeSelection } from "../src/features/editor/selectionSummary";
import type { ChordEvent } from "../src/types/music";

/**
 * The one line that says what the next action will affect.
 *
 * Three selection concepts, read by three different sets of actions, and
 * nothing on screen said which was live. The sentence has to be true of all of
 * them at once, which is why it names what is selected rather than what any
 * particular button would do to it.
 */

const chord = (startTick: number, symbol: string) =>
  ({ startTick, symbol } as ChordEvent);

const TICKS = 1920;

describe("describing the selection", () => {
  it("counts notes when notes are selected", () => {
    expect(describeSelection({
      noteCount: 3, chord: null, range: null, ticksPerBar: TICKS,
    })).toEqual({ text: "3個のノートを選択中", active: true });
  });

  it("names the chord and the bar it is in, counted from one", () => {
    // The lane prints bar numbers from one; the data counts from zero. A
    // sentence read against the lane has to use the lane's numbering.
    expect(describeSelection({
      noteCount: 0, chord: chord(TICKS * 5, "G7"), range: null, ticksPerBar: TICKS,
    }).text).toBe("6小節目 G7 を選択中");
  });

  it("names the range inclusively at the start and exclusively at the end", () => {
    // startBar 4, endBar 8 is bars five through eight, which is what the lane
    // highlights and what the regeneration acts on.
    expect(describeSelection({
      noteCount: 0, chord: null, range: { startBar: 4, endBar: 8 }, ticksPerBar: TICKS,
    }).text).toBe("5〜8小節を選択中");
  });

  it("prefers the narrowest live selection", () => {
    // A chord sits inside a range and both can be highlighted at once. The
    // narrower one is where the user is actually looking.
    expect(describeSelection({
      noteCount: 0, chord: chord(0, "C"), range: { startBar: 0, endBar: 8 }, ticksPerBar: TICKS,
    }).text).toContain("C");
    expect(describeSelection({
      noteCount: 2, chord: chord(0, "C"), range: { startBar: 0, endBar: 8 }, ticksPerBar: TICKS,
    }).text).toContain("ノート");
  });

  it("says what nothing selected means, rather than only that nothing is", () => {
    // "Nothing selected" alone leaves the reader to guess whether the next
    // press does nothing or does everything. It does everything.
    const empty = describeSelection({
      noteCount: 0, chord: null, range: null, ticksPerBar: TICKS,
    });
    expect(empty.active).toBe(false);
    expect(empty.text).toContain("曲全体");
  });

  it("does not divide by a zero bar length", () => {
    // ticksPerBar comes from the composition, and a malformed import could
    // carry a zero. Infinity in a bar number is a worse failure than a wrong
    // one, because it renders.
    expect(describeSelection({
      noteCount: 0, chord: chord(100, "C"), range: null, ticksPerBar: 0,
    }).text).toBe("101小節目 C を選択中");
  });
});
