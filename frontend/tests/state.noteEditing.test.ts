import { beforeEach, describe, expect, it } from "vitest";
import { useComposerStore } from "../src/state";

describe("note editing integrity", () => {
  beforeEach(() => {
    localStorage.clear();
    useComposerStore.getState().reset({ seed: "note-locks", bars: 4 });
  });

  it("rejects an entire batch when a locked note would be moved, deleted or quantized", () => {
    const store = useComposerStore.getState();
    const barTicks = store.draftComposition.ticksPerBar;
    const free = store.addNote(72, 0, 120)!;
    const locked = store.addNote(74, barTicks + 10, 120)!;
    store.toggleBarLock(1);
    const before = useComposerStore.getState();
    expect(store.moveNotes([free, locked], { semitones: 2 })).toBe(0);
    expect(store.deleteNotes([free, locked])).toBe(0);
    expect(store.quantizeNotes([free, locked])).toBe(0);
    expect(store.addNote(72, barTicks, 120)).toBeNull();
    expect(useComposerStore.getState().draftComposition).toBe(before.draftComposition);
    expect(useComposerStore.getState().historyIndex).toBe(before.historyIndex);
  });

  it("also protects the destination from move, paste and boundary quantization", () => {
    const store = useComposerStore.getState();
    const barTicks = store.draftComposition.ticksPerBar;
    const id = store.addNote(72, barTicks - 10, 5)!;
    store.toggleBarLock(1);
    const before = useComposerStore.getState().draftComposition;
    expect(store.moveNote(id, { deltaTick: 20 })).toBe(false);
    expect(store.duplicateNotes([id], 20)).toEqual([]);
    expect(store.quantizeNotes([id], 120)).toBe(0);
    expect(useComposerStore.getState().draftComposition).toBe(before);
  });

  it("pastes a captured note after its original has been changed and deleted, with undo", () => {
    const store = useComposerStore.getState();
    const id = store.addNote(72, 0, 240)!;
    const copied = [{ ...useComposerStore.getState().draftComposition.notes.find((note) => note.id === id)! }];
    store.transposeNote(id, 3);
    store.deleteNote(id);
    const before = useComposerStore.getState().draftComposition;
    const added = store.pasteNotes(copied, 480);
    expect(added).toHaveLength(1);
    expect(useComposerStore.getState().draftComposition.notes.find((note) => note.id === added[0]))
      .toMatchObject({ midi: 72, startTick: 480, durationTick: 240 });
    expect(store.undo()).toBe(true);
    expect(useComposerStore.getState().draftComposition.notes).toEqual(before.notes);
  });
});
