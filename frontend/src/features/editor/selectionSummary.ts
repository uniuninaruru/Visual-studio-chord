import type { BarRange, ChordEvent } from "../../types/music";

/**
 * What is selected, said in one line.
 *
 * There are three selection concepts in this editor and they live in two
 * places: the chord and the notes are React state in App, the bar range is in
 * the store. Each is read by a different set of actions -- regenerating reads
 * the range, the note tools read the notes, the chord symbol field reads the
 * chord -- and nothing on screen said which one was live. A user could see a
 * highlighted chord and a highlighted range at the same time with no way to
 * know that 選択範囲を再生成 would ignore the chord.
 *
 * This names what IS selected rather than what any one action would do, which
 * is the only version of the sentence that stays true for all of them.
 *
 * The order is by narrowness, not by importance: notes sit inside a chord which
 * sits inside a range, so the narrowest live selection is the one that
 * describes the user's actual attention. Selecting a chord clears the notes and
 * selecting notes clears the chord, so the first two never both hold -- the
 * order between them is stated anyway rather than left to depend on that.
 */

export interface SelectionSummary {
  text: string;
  /** False only for "nothing selected", which is a different sentence, not a quieter one. */
  active: boolean;
}

export interface SelectionSummaryInput {
  noteCount: number;
  chord: ChordEvent | null;
  range: BarRange | null;
  ticksPerBar: number;
}

export function describeSelection(input: SelectionSummaryInput): SelectionSummary {
  if (input.noteCount > 0) {
    return { text: `${input.noteCount}個のノートを選択中`, active: true };
  }
  if (input.chord) {
    // Bars are counted from one on screen and from zero in the data, and this
    // string is read against the bar numbers printed on the lane.
    const bar = Math.floor(input.chord.startTick / Math.max(1, input.ticksPerBar)) + 1;
    return { text: `${bar}小節目 ${input.chord.symbol} を選択中`, active: true };
  }
  if (input.range) {
    return {
      text: `${input.range.startBar + 1}〜${input.range.endBar}小節を選択中`,
      active: true,
    };
  }
  // Said positively. "Nothing selected" alone leaves the reader to guess
  // whether the next thing they press will do nothing or do everything.
  return { text: "選択なし — 操作は曲全体に働きます", active: false };
}
