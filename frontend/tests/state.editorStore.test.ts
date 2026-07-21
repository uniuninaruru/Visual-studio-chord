import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS } from "../src/music";
import { useComposerStore } from "../src/state";
import { EDITOR_STORAGE_KEY } from "../src/storage";

function barSlice(barIndex: number) {
  const composition = useComposerStore.getState().draftComposition;
  const startTick = barIndex * composition.ticksPerBar;
  const endTick = startTick + composition.ticksPerBar;
  return {
    chords: composition.chords.filter(
      (chord) => chord.startTick >= startTick && chord.startTick < endTick,
    ),
    notes: composition.notes.filter((note) => note.barIndex === barIndex),
  };
}

describe("useComposerStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useComposerStore.getState().reset({ seed: "state-tests" });
  });

  it("generates deterministically for the same settings and seed", () => {
    const store = useComposerStore.getState();
    store.generateComposition({ seed: "repeatable", style: "pop" });
    const first = useComposerStore.getState().draftComposition;

    useComposerStore.getState().generateComposition({ seed: "repeatable", style: "pop" });
    const second = useComposerStore.getState().draftComposition;

    expect(second.chords).toEqual(first.chords);
    expect(second.notes).toEqual(first.notes);
    expect(second.seed).toBe(first.seed);
  });

  it("preserves bars outside the regeneration range and locked bars inside it", () => {
    useComposerStore.getState().setSelectedRange({ startBar: 1, endBar: 3 });
    useComposerStore.getState().toggleBarLock(2);
    const beforeBar0 = barSlice(0);
    const beforeBar2 = barSlice(2);
    const beforeBar3 = barSlice(3);

    expect(useComposerStore.getState().regenerateSelected({ target: "all" })).toBe(true);

    expect(barSlice(0)).toEqual(beforeBar0);
    expect(barSlice(2)).toEqual(beforeBar2);
    expect(barSlice(3)).toEqual(beforeBar3);
    expect(useComposerStore.getState().lockedBars).toEqual([2]);
  });

  it("supports note edits with undo and redo", () => {
    const note = useComposerStore.getState().draftComposition.notes[0];
    expect(note).toBeDefined();
    if (!note) return;

    const originalMidi = note.midi;
    expect(useComposerStore.getState().transposeNote(note.id, 2)).toBe(true);
    expect(useComposerStore.getState().draftComposition.notes[0]?.midi).toBe(originalMidi + 2);

    expect(useComposerStore.getState().undo()).toBe(true);
    expect(useComposerStore.getState().draftComposition.notes[0]?.midi).toBe(originalMidi);

    expect(useComposerStore.getState().redo()).toBe(true);
    expect(useComposerStore.getState().draftComposition.notes[0]?.midi).toBe(originalMidi + 2);
  });

  it("rebuilds derived harmony fields after a direct chord edit", () => {
    const chord = useComposerStore.getState().draftComposition.chords[0];
    expect(chord).toBeDefined();
    if (!chord) return;

    expect(useComposerStore.getState().editChord(chord.id, "F#")).toBe(true);
    const edited = useComposerStore.getState().draftComposition.chords[0];
    expect(edited?.symbol).toBe("F#");
    expect(edited?.root).toBe("F#");
    expect(edited?.source).toBe("other");
    expect(edited?.notes).not.toEqual(chord.notes);
  });

  it("deletes notes non-destructively through history", () => {
    const before = useComposerStore.getState().draftComposition.notes;
    const note = before[0];
    expect(note).toBeDefined();
    if (!note) return;

    expect(useComposerStore.getState().deleteNote(note.id)).toBe(true);
    expect(useComposerStore.getState().draftComposition.notes).toHaveLength(before.length - 1);
    expect(useComposerStore.getState().draftComposition.notes.some((item) => item.id === note.id)).toBe(
      false,
    );

    useComposerStore.getState().undo();
    expect(useComposerStore.getState().draftComposition.notes).toEqual(before);
  });

  it("keeps playing audio on committed data until the next bar boundary", () => {
    const note = useComposerStore.getState().draftComposition.notes[0];
    expect(note).toBeDefined();
    if (!note) return;

    useComposerStore.getState().setPlaybackStatus("playing");
    useComposerStore.getState().setUpdateTiming("nextBar");
    const previousCommittedMidi = useComposerStore.getState().committedComposition.notes[0]?.midi;

    useComposerStore.getState().transposeNote(note.id, 1);
    expect(useComposerStore.getState().pendingCommit).toBe(true);
    expect(useComposerStore.getState().committedComposition.notes[0]?.midi).toBe(
      previousCommittedMidi,
    );

    const ticksPerBar = useComposerStore.getState().draftComposition.ticksPerBar;
    useComposerStore.getState().setCurrentTick(ticksPerBar - 1);
    expect(useComposerStore.getState().pendingCommit).toBe(true);
    useComposerStore.getState().setCurrentTick(ticksPerBar);

    expect(useComposerStore.getState().pendingCommit).toBe(false);
    expect(useComposerStore.getState().committedComposition.notes[0]?.midi).toBe(
      previousCommittedMidi === undefined ? undefined : previousCommittedMidi + 1,
    );
  });

  it("maps the selected half-open bar range to the loop range", () => {
    const ticksPerBar = useComposerStore.getState().draftComposition.ticksPerBar;
    useComposerStore.getState().setSelectedRange({ startBar: 1, endBar: 3 });
    expect(useComposerStore.getState().loopRange).toEqual({
      startTick: ticksPerBar,
      endTick: ticksPerBar * 3,
    });
  });

  it("persists editable state without persisting active playback", () => {
    useComposerStore.getState().updateSettings({
      bpm: DEFAULT_GENERATOR_SETTINGS.bpm + 7,
    });
    useComposerStore.getState().setPlaybackStatus("playing");

    const raw = localStorage.getItem(EDITOR_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const snapshot = JSON.parse(raw ?? "null") as Record<string, unknown>;
    expect((snapshot.settings as Record<string, unknown>).bpm).toBe(
      DEFAULT_GENERATOR_SETTINGS.bpm + 7,
    );
    expect(snapshot).not.toHaveProperty("playback.status");
  });
});
