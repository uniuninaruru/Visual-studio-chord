import { beforeEach, describe, expect, it } from "vitest";
import { useComposerStore } from "../src/state/editorStore";

/**
 * Stop means back to the beginning of the piece.
 *
 * Clicking a chord in the progression lane also selects its bar, and a bar
 * selection sets the playback loop. So inspecting a chord quietly locked
 * playback to a single bar, and stop returned the playhead to the top of that
 * bar rather than of the piece -- pressing stop and playing again replayed the
 * same bar forever, with nothing in the interface offering a way out.
 */

describe("stopping releases a selection loop", () => {
  beforeEach(() => {
    useComposerStore.getState().reset();
  });

  it("loops one bar while a bar is selected", () => {
    const store = useComposerStore.getState();
    const total = store.committedComposition.totalTicks;
    const barTicks = store.committedComposition.ticksPerBar;

    store.setSelectedRange({ startBar: 2, endBar: 3 });
    const looped = useComposerStore.getState();
    expect(looped.playbackLoopRange.startTick).toBe(2 * barTicks);
    expect(looped.playbackLoopRange.endTick).toBe(3 * barTicks);
    // Which is the feature, not the fault: it is only a trap without a way back.
    expect(looped.playbackLoopRange.endTick).toBeLessThan(total);
  });

  it("gives the whole piece back when the selection is cleared", () => {
    const store = useComposerStore.getState();
    store.setSelectedRange({ startBar: 2, endBar: 3 });
    useComposerStore.getState().setSelectedRange(null);

    const cleared = useComposerStore.getState();
    expect(cleared.selectedBarRange).toBeNull();
    expect(cleared.playbackLoopRange.startTick).toBe(0);
    expect(cleared.playbackLoopRange.endTick).toBe(cleared.committedComposition.totalTicks);
    expect(cleared.loopRange.startTick).toBe(0);
    expect(cleared.loopRange.endTick).toBe(cleared.draftComposition.totalTicks);
  });

  it("clears a multi-bar selection too", () => {
    const store = useComposerStore.getState();
    store.setSelectedRange({ startBar: 1, endBar: 4 });
    expect(useComposerStore.getState().playbackLoopRange.startTick).toBeGreaterThan(0);

    useComposerStore.getState().setSelectedRange(null);
    expect(useComposerStore.getState().playbackLoopRange.startTick).toBe(0);
  });

  it("is safe to clear when nothing was selected", () => {
    const before = useComposerStore.getState().playbackLoopRange;
    useComposerStore.getState().setSelectedRange(null);
    expect(useComposerStore.getState().playbackLoopRange).toEqual(before);
  });
});
