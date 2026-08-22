import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  createAdvancedChordEvent,
  createNeoRiemannianChordEvent,
  createStepChordEvent,
  generateComposition,
  intervalsForQuality,
  pitchClassToSemitone,
  validateComposition,
} from "../src/music";
import {
  createPreferenceModel,
  extractPreferenceFeatures,
  updatePreferenceModel,
} from "../src/preference";
import type { ChordEvent, GeneratorSettings } from "../src/types/music";
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

    const historyBefore = useComposerStore.getState().historyIndex;
    expect(useComposerStore.getState().editChord(chord.id, chord.symbol)).toBe(false);
    expect(useComposerStore.getState().historyIndex).toBe(historyBefore);
    expect(useComposerStore.getState().editChord(chord.id, "F#")).toBe(true);
    const edited = useComposerStore.getState().draftComposition.chords[0];
    expect(edited?.symbol).toBe("F#");
    expect(edited?.root).toBe("F#");
    expect(edited?.source).toBe("other");
    expect(edited?.notes).not.toEqual(chord.notes);
  });

  it("rebuilds structured quality and tension edits into the sounding voicing", () => {
    const target = useComposerStore.getState().draftComposition.chords[0]!;
    const quality = target.quality === "minor" ? "major7" : "minor";

    expect(useComposerStore.getState().editChord(target.id, { quality })).toBe(true);
    let edited = useComposerStore.getState().draftComposition.chords[0]!;
    expect(edited.quality).toBe(quality);
    expect(edited.symbol).toBe(`${edited.root}${quality === "minor" ? "m" : "maj7"}`);
    expect(new Set(edited.notes.map((note) => note % 12))).toEqual(
      new Set(intervalsForQuality(quality).map((interval) => (
        pitchClassToSemitone(edited.root) + interval
      ) % 12)),
    );

    expect(useComposerStore.getState().editChord(edited.id, { tensions: ["9"] })).toBe(true);
    edited = useComposerStore.getState().draftComposition.chords[0]!;
    expect(edited.symbol).toContain("(9)");
    expect(edited.tensions).toEqual(["9"]);
    expect(edited.notes.map((note) => note % 12)).toContain(
      (pitchClassToSemitone(edited.root) + 14) % 12,
    );
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);

    expect(useComposerStore.getState().editChord(edited.id, { tensions: null })).toBe(true);
    edited = useComposerStore.getState().draftComposition.chords[0]!;
    expect(edited.tensions).toBeUndefined();
    expect(edited.symbol).not.toContain("(");
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);
  });

  it("voices structured inversion and slash bass edits, including reharmonisation objects", () => {
    const target = useComposerStore.getState().draftComposition.chords[0]!;
    const inversion = target.inversion === 0 ? 1 : 0;
    expect(useComposerStore.getState().editChord(target.id, { inversion })).toBe(true);
    let edited = useComposerStore.getState().draftComposition.chords[0]!;
    const intervals = intervalsForQuality(edited.quality);
    expect(edited.notes[0]! % 12).toBe(
      (pitchClassToSemitone(edited.root) + intervals[inversion]!) % 12,
    );
    expect(edited.inversion).toBe(inversion);

    const bass = edited.root === "C" ? "F#" : "C";
    expect(useComposerStore.getState().editChord(edited.id, { bass })).toBe(true);
    edited = useComposerStore.getState().draftComposition.chords[0]!;
    expect(edited.symbol).toContain(`/${bass}`);
    expect(edited.bass).toBe(bass);
    expect(edited.inversion).toBe(0);
    expect(edited.notes[0]! % 12).toBe(pitchClassToSemitone(bass));
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);

    expect(useComposerStore.getState().editChord(edited.id, { bass: null })).toBe(true);
    edited = useComposerStore.getState().draftComposition.chords[0]!;
    expect(edited.bass).toBeUndefined();
    expect(edited.symbol).not.toContain("/");

    // Reharmonisation supplies a slash symbol and a legacy source hint. The
    // store rebuilds the actual bass and safely ignores the stale claim.
    expect(useComposerStore.getState().editChord(edited.id, {
      symbol: "D7/F",
      source: "substitute",
    })).toBe(true);
    edited = useComposerStore.getState().draftComposition.chords[0]!;
    expect(edited.symbol).toBe("D7/F");
    expect(edited.root).toBe("D");
    expect(edited.bass).toBe("F");
    expect(edited.source).toBe("other");
    expect(edited.notes[0]! % 12).toBe(pitchClassToSemitone("F"));
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);
  });

  it("rebuilds quality, tensions, and slash bass together", () => {
    const target = useComposerStore.getState().draftComposition.chords[0]!;
    const bass = target.root === "C" ? "F" : "C";
    expect(useComposerStore.getState().editChord(target.id, {
      quality: "dominant7",
      tensions: ["#11", "9"],
      bass,
    })).toBe(true);
    const edited = useComposerStore.getState().draftComposition.chords[0]!;
    expect(edited.symbol).toBe(`${edited.root}7(9,#11)/${bass}`);
    expect(edited.quality).toBe("dominant7");
    expect(edited.tensions).toEqual(["9", "#11"]);
    expect(edited.bass).toBe(bass);
    expect(edited.notes[0]! % 12).toBe(pitchClassToSemitone(bass));
    expect(edited.notes.map((note) => note % 12)).toEqual(
      expect.arrayContaining([
        (pitchClassToSemitone(edited.root) + 14) % 12,
        (pitchClassToSemitone(edited.root) + 18) % 12,
      ]),
    );
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);
  });

  it("rejects invalid, locked, and same-value structured edits without history changes", () => {
    const target = useComposerStore.getState().draftComposition.chords[0]!;
    const before = {
      draftComposition: structuredClone(useComposerStore.getState().draftComposition),
      history: structuredClone(useComposerStore.getState().history),
      historyIndex: useComposerStore.getState().historyIndex,
    };
    const invalidEdits = [
      { root: "H" as never },
      { quality: "not-a-quality" as never },
      { tensions: ["wat"] as never },
      { bass: "H" as never },
      { inversion: Number.NaN },
      { inversion: 99 },
    ];
    for (const edit of invalidEdits) {
      expect(useComposerStore.getState().editChord(target.id, edit)).toBe(false);
    }
    expect(useComposerStore.getState().editChord(target.id, { quality: target.quality })).toBe(false);
    expect(useComposerStore.getState().draftComposition).toEqual(before.draftComposition);
    expect(useComposerStore.getState().history).toEqual(before.history);
    expect(useComposerStore.getState().historyIndex).toBe(before.historyIndex);

    useComposerStore.getState().toggleBarLock(0);
    const lockedBefore = {
      draftComposition: structuredClone(useComposerStore.getState().draftComposition),
      history: structuredClone(useComposerStore.getState().history),
      historyIndex: useComposerStore.getState().historyIndex,
    };
    expect(useComposerStore.getState().editChord(target.id, {
      quality: target.quality === "minor" ? "major" : "minor",
    })).toBe(false);
    expect(useComposerStore.getState().draftComposition).toEqual(lockedBefore.draftComposition);
    expect(useComposerStore.getState().history).toEqual(lockedBefore.history);
    expect(useComposerStore.getState().historyIndex).toBe(lockedBefore.historyIndex);
  });

  it("keeps structured edits pending until the next bar and supports one-step undo/redo", () => {
    const target = useComposerStore.getState().draftComposition.chords[0]!;
    const original = structuredClone(target);
    const nextQuality = target.quality === "minor" ? "major7" : "minor";
    useComposerStore.getState().setPlaybackStatus("playing");
    useComposerStore.getState().setUpdateTiming("nextBar");
    expect(useComposerStore.getState().editChord(target.id, { quality: nextQuality })).toBe(true);
    const state = useComposerStore.getState();
    expect(state.pendingCommit).toBe(true);
    expect(state.committedComposition.chords.find((chord) => chord.id === target.id)).toEqual(original);
    expect(state.draftComposition.chords.find((chord) => chord.id === target.id)?.quality)
      .toBe(nextQuality);
    expect(state.undo()).toBe(true);
    expect(useComposerStore.getState().draftComposition.chords.find((chord) => chord.id === target.id))
      .toEqual(original);
    expect(useComposerStore.getState().redo()).toBe(true);
    expect(useComposerStore.getState().draftComposition.chords.find((chord) => chord.id === target.id)?.quality)
      .toBe(nextQuality);
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

  it("uses the audible meter for a pending next-bar change", () => {
    const initial = useComposerStore.getState().draftComposition;
    expect(initial.timeSignature).toBe("4/4");
    expect(initial.ticksPerBar).toBe(1_920);

    useComposerStore.getState().setPlaybackStatus("playing");
    useComposerStore.getState().setUpdateTiming("nextBar");
    useComposerStore.getState().generateComposition({ timeSignature: "3/4" });

    let state = useComposerStore.getState();
    expect(state.pendingCommit).toBe(true);
    expect(state.draftComposition.ticksPerBar).toBe(1_440);
    expect(state.committedComposition.ticksPerBar).toBe(1_920);
    expect(state.playbackLoopRange.endTick).toBe(initial.totalTicks);
    expect(state.loopRange.endTick).toBe(state.draftComposition.totalTicks);

    state.setCurrentTick(1_439);
    useComposerStore.getState().setCurrentTick(1_440);
    expect(useComposerStore.getState().pendingCommit).toBe(true);
    useComposerStore.getState().setCurrentTick(1_919);
    useComposerStore.getState().setCurrentTick(1_920);

    state = useComposerStore.getState();
    expect(state.pendingCommit).toBe(false);
    expect(state.committedComposition.timeSignature).toBe("3/4");
    expect(state.playbackLoopRange).toEqual(state.loopRange);
  });

  it("uses the audible compound beat for a pending next-beat change", () => {
    useComposerStore.getState().generateComposition({ timeSignature: "6/8" });
    useComposerStore.getState().setPlaybackStatus("playing");
    useComposerStore.getState().setUpdateTiming("nextBeat");
    useComposerStore.getState().generateComposition({ timeSignature: "4/4" });

    useComposerStore.getState().setCurrentTick(479);
    useComposerStore.getState().setCurrentTick(480);
    expect(useComposerStore.getState().pendingCommit).toBe(true);
    useComposerStore.getState().setCurrentTick(719);
    useComposerStore.getState().setCurrentTick(720);
    expect(useComposerStore.getState().pendingCommit).toBe(false);
  });

  it("keeps a pending playback edit isolated while preview candidates are generated", async () => {
    const note = useComposerStore.getState().draftComposition.notes[0];
    expect(note).toBeDefined();
    if (!note) return;

    useComposerStore.getState().setPlaybackStatus("playing");
    useComposerStore.getState().setUpdateTiming("nextBar");
    const committedBeforeEdit = useComposerStore.getState().committedComposition;
    useComposerStore.getState().transposeNote(note.id, 1);
    useComposerStore.getState().setSelectedRange({ startBar: 0, endBar: 1 });

    expect(await useComposerStore.getState().generatePreviewVariations()).toBeGreaterThan(0);
    expect(useComposerStore.getState().pendingCommit).toBe(true);
    expect(useComposerStore.getState().committedComposition).toEqual(committedBeforeEdit);
  });

  it("restores pending playback data after a candidate audition ends", async () => {
    const note = useComposerStore.getState().draftComposition.notes[0];
    expect(note).toBeDefined();
    if (!note) return;

    useComposerStore.getState().setPlaybackStatus("playing");
    useComposerStore.getState().setUpdateTiming("nextBar");
    const committedBeforeEdit = useComposerStore.getState().committedComposition;
    useComposerStore.getState().transposeNote(note.id, 1);
    useComposerStore.getState().setSelectedRange({ startBar: 0, endBar: 1 });
    await useComposerStore.getState().generatePreviewVariations();

    expect(useComposerStore.getState().auditionPreviewVariation(0)).toBe(true);
    expect(useComposerStore.getState().auditionedVariationIndex).toBe(0);
    expect(useComposerStore.getState().auditionPreviewVariation(null)).toBe(true);
    expect(useComposerStore.getState().committedComposition).toEqual(committedBeforeEdit);
    expect(useComposerStore.getState().pendingCommit).toBe(true);
  });

  it("uses the candidate meter only while auditioning a structural pending edit", async () => {
    useComposerStore.getState().setPlaybackStatus("playing");
    useComposerStore.getState().setUpdateTiming("nextBar");
    useComposerStore.getState().generateComposition({ timeSignature: "3/4" });
    useComposerStore.getState().setSelectedRange({ startBar: 0, endBar: 1 });
    const baseLoop = useComposerStore.getState().playbackLoopRange;
    expect(baseLoop.endTick).toBe(1_920);

    await useComposerStore.getState().generatePreviewVariations();
    expect(useComposerStore.getState().auditionPreviewVariation(0)).toBe(true);
    expect(useComposerStore.getState().playbackLoopRange.endTick).toBe(1_440);

    expect(useComposerStore.getState().auditionPreviewVariation(null)).toBe(true);
    expect(useComposerStore.getState().playbackLoopRange).toEqual(baseLoop);
    expect(useComposerStore.getState().committedComposition.timeSignature).toBe("4/4");
    expect(useComposerStore.getState().pendingCommit).toBe(true);
  });

  it("cancels chunked candidate generation without publishing partial previews", async () => {
    useComposerStore.getState().setSelectedRange({ startBar: 0, endBar: 1 });
    const controller = new AbortController();
    controller.abort();

    await expect(
      useComposerStore.getState().generatePreviewVariations({}, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(useComposerStore.getState().previewVariations).toEqual([]);
  });

  it("does not overwrite a manual edit made while candidates are generating", async () => {
    useComposerStore.getState().setSelectedRange({ startBar: 1, endBar: 2 });
    const note = useComposerStore.getState().draftComposition.notes.find(
      (candidate) => candidate.barIndex === 0,
    );
    expect(note).toBeDefined();
    if (!note) return;

    const generation = useComposerStore.getState().generatePreviewVariations();
    useComposerStore.getState().transposeNote(note.id, 1);
    const editedDraft = useComposerStore.getState().draftComposition;
    const editedCommitted = useComposerStore.getState().committedComposition;
    expect(await generation).toBeGreaterThan(0);

    const after = useComposerStore.getState();
    expect(after.draftComposition).toEqual(editedDraft);
    expect(after.committedComposition).toEqual(editedCommitted);
    expect(after.previewVariations[0]?.notes.find((candidate) => candidate.id === note.id)?.midi)
      .toBe(note.midi + 1);
  });

  it("publishes validated external previews without mutating draft, playback, or history", async () => {
    useComposerStore.getState().setSelectedRange({ startBar: 0, endBar: 1 });
    expect(await useComposerStore.getState().generatePreviewVariations({
      target: "chords",
    })).toBeGreaterThan(0);
    const source = useComposerStore.getState().draftComposition;
    const candidate = structuredClone(source);
    candidate.id = `${source.id}-external-preview`;
    useComposerStore.setState({ previewVariations: [] });
    const before = useComposerStore.getState();

    expect(before.publishPreviewVariations(source.id, [candidate])).toBe(1);
    const after = useComposerStore.getState();
    expect(after.previewVariations).toHaveLength(1);
    expect(after.draftComposition).toEqual(before.draftComposition);
    expect(after.committedComposition).toEqual(before.committedComposition);
    expect(after.history).toEqual(before.history);
    expect(after.historyIndex).toBe(before.historyIndex);
  });

  it("does not publish an external preview for a superseded composition", async () => {
    useComposerStore.getState().setSelectedRange({ startBar: 0, endBar: 1 });
    await useComposerStore.getState().generatePreviewVariations({ target: "chords" });
    const candidate = structuredClone(useComposerStore.getState().previewVariations[0]!);
    useComposerStore.setState({ previewVariations: [] });

    expect(useComposerStore.getState().publishPreviewVariations(
      "superseded-source",
      [candidate],
    )).toBe(0);
    expect(useComposerStore.getState().previewVariations).toEqual([]);
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

describe("direct chord timeline edits", () => {
  beforeEach(() => {
    localStorage.clear();
    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "direct-chord",
      bars: 4,
      songForm: { form: "none" },
      harmonicRhythm: { changesPerBar: 1 },
    });
  });

  function expectExactChordCoverage() {
    const composition = useComposerStore.getState().draftComposition;
    let cursor = 0;
    for (const chord of [...composition.chords].sort((a, b) => a.startTick - b.startTick)) {
      expect(chord.startTick).toBe(cursor);
      expect(Number.isInteger(chord.durationTick)).toBe(true);
      expect(chord.durationTick).toBeGreaterThan(0);
      cursor = chord.startTick + chord.durationTick;
    }
    expect(cursor).toBe(composition.totalTicks);
    expect(new Set(composition.chords.map((chord) => chord.id)).size)
      .toBe(composition.chords.length);
  }

  function installChordFixture(chords: ChordEvent[]) {
    const state = useComposerStore.getState();
    const composition = structuredClone(state.draftComposition);
    composition.chords = structuredClone(chords);
    const historyEntry = state.history[0]!;
    useComposerStore.setState({
      settings: structuredClone(composition.settings),
      draftComposition: composition,
      committedComposition: structuredClone(composition),
      history: [{ ...historyEntry, composition: structuredClone(composition) }],
      historyIndex: 0,
      lockedBars: [...composition.lockedBars],
      pendingCommit: false,
    });
  }

  function secondaryDominantFixture() {
    const source = useComposerStore.getState().draftComposition;
    const duration = source.ticksPerBar;
    const secondary = createAdvancedChordEvent({
      kind: "secondaryDominant",
      key: source.settings.key,
      mode: source.settings.mode,
      degree: 1,
      targetDegree: 4,
      startTick: 0,
      durationTick: duration,
      id: "fixture-secondary",
    });
    const resolution = createStepChordEvent({
      step: { degree: 4 },
      key: source.settings.key,
      mode: source.settings.mode,
      startTick: duration,
      durationTick: duration,
      id: "fixture-resolution",
      previousNotes: secondary.notes,
    });
    installChordFixture([secondary, resolution, ...source.chords.slice(2)]);
    return { secondary, resolution };
  }

  function neoRiemannianFixture() {
    const source = useComposerStore.getState().draftComposition;
    const duration = source.ticksPerBar;
    const previous = createStepChordEvent({
      step: { degree: 1 },
      key: source.settings.key,
      mode: source.settings.mode,
      startTick: 0,
      durationTick: duration,
      id: "fixture-neo-previous",
    });
    const transformed = createNeoRiemannianChordEvent({
      key: source.settings.key,
      mode: source.settings.mode,
      previous,
      operation: "P",
      startTick: duration,
      durationTick: duration,
      id: "fixture-neo-transformed",
    });
    const resolution = createStepChordEvent({
      step: { degree: 4 },
      key: source.settings.key,
      mode: source.settings.mode,
      startTick: duration * 2,
      durationTick: duration,
      id: "fixture-neo-resolution",
      previousNotes: transformed.notes,
    });
    installChordFixture([previous, transformed, resolution, ...source.chords.slice(3)]);
    return { previous, transformed, resolution };
  }

  it("adds a left/new/right chord split with rebuilt derived fields", () => {
    const before = useComposerStore.getState().draftComposition;
    const target = before.chords[0]!;
    const startTick = target.startTick + 240;
    const newId = useComposerStore.getState().addChord("F#", startTick, 480);

    expect(newId).toBeTruthy();
    const after = useComposerStore.getState().draftComposition;
    const left = after.chords.find((chord) => chord.id === target.id);
    const added = after.chords.find((chord) => chord.id === newId);
    const right = after.chords.find((chord) => chord.startTick === startTick + 480);
    expect(left).toMatchObject({ startTick: target.startTick, durationTick: 240 });
    expect(added).toMatchObject({ symbol: "F#", root: "F#", startTick, durationTick: 480 });
    expect(added?.notes).not.toEqual(target.notes);
    expect(right).toMatchObject({ startTick: startTick + 480, durationTick: target.durationTick - 720 });
    expectExactChordCoverage();
    expect(validateComposition(after).errors).toEqual([]);
  });

  it("treats equal structured input as a no-op for special chord metadata", () => {
    const { secondary } = secondaryDominantFixture();
    let state = useComposerStore.getState();
    const before = {
      draftComposition: structuredClone(state.draftComposition),
      history: structuredClone(state.history),
      historyIndex: state.historyIndex,
    };
    expect(state.editChord(secondary.id, {
      root: secondary.root,
      quality: secondary.quality,
      tensions: secondary.tensions ?? null,
      bass: secondary.bass ?? null,
      inversion: secondary.inversion,
    })).toBe(false);
    state = useComposerStore.getState();
    expect(state.draftComposition).toEqual(before.draftComposition);
    expect(state.history).toEqual(before.history);
    expect(state.historyIndex).toBe(before.historyIndex);

    const { transformed } = neoRiemannianFixture();
    state = useComposerStore.getState();
    const neoBefore = {
      draftComposition: structuredClone(state.draftComposition),
      history: structuredClone(state.history),
      historyIndex: state.historyIndex,
    };
    expect(state.editChord(transformed.id, {
      root: transformed.root,
      quality: transformed.quality,
      tensions: transformed.tensions ?? null,
      bass: transformed.bass ?? null,
      inversion: transformed.inversion,
    })).toBe(false);
    state = useComposerStore.getState();
    expect(state.draftComposition).toEqual(neoBefore.draftComposition);
    expect(state.history).toEqual(neoBefore.history);
    expect(state.historyIndex).toBe(neoBefore.historyIndex);
  });

  it("rejects derived-only and timing object edits without a Partial escape hatch", () => {
    const target = useComposerStore.getState().draftComposition.chords[0]!;
    const before = {
      draftComposition: structuredClone(useComposerStore.getState().draftComposition),
      history: structuredClone(useComposerStore.getState().history),
      historyIndex: useComposerStore.getState().historyIndex,
    };
    const forbiddenEdits = [
      { notes: [0, 1, 2] },
      { startTick: target.startTick + 1 },
      { durationTick: target.durationTick + 1 },
      { romanNumeral: "V" },
      { source: "other" },
    ];
    for (const edit of forbiddenEdits) {
      expect(useComposerStore.getState().editChord(target.id, edit as never)).toBe(false);
    }
    const after = useComposerStore.getState();
    expect(after.draftComposition).toEqual(before.draftComposition);
    expect(after.history).toEqual(before.history);
    expect(after.historyIndex).toBe(before.historyIndex);
    expect(validateComposition(after.draftComposition).errors).toEqual([]);
  });

  it("splits one chord while preserving its sounding metadata", () => {
    const before = useComposerStore.getState().draftComposition;
    const target = before.chords[1]!;
    const splitTick = target.startTick + Math.floor(target.durationTick / 2);
    const rightId = useComposerStore.getState().splitChord(target.id, splitTick);

    expect(rightId).toBeTruthy();
    const after = useComposerStore.getState().draftComposition;
    const left = after.chords.find((chord) => chord.id === target.id)!;
    const right = after.chords.find((chord) => chord.id === rightId)!;
    expect(left.notes).toEqual(target.notes);
    expect(right.notes).toEqual(target.notes);
    expect(right.root).toBe(target.root);
    expect(right.quality).toBe(target.quality);
    expect(left.durationTick + right.durationTick).toBe(target.durationTick);
    expectExactChordCoverage();
    expect(validateComposition(after).errors).toEqual([]);
  });

  it("moves forward, backward, and across overlapping source/target ranges", () => {
    const source = useComposerStore.getState().draftComposition;
    const target = source.chords[0]!;
    const duration = target.durationTick;
    expect(useComposerStore.getState().moveChord(target.id, source.ticksPerBar * 2)).toBe(true);
    let moved = useComposerStore.getState().draftComposition.chords.find(
      (chord) => chord.id === target.id,
    )!;
    expect(moved).toMatchObject({ startTick: source.ticksPerBar * 2, durationTick: duration });
    expectExactChordCoverage();
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);

    expect(useComposerStore.getState().moveChord(target.id, 0)).toBe(true);
    moved = useComposerStore.getState().draftComposition.chords.find(
      (chord) => chord.id === target.id,
    )!;
    expect(moved).toMatchObject({ startTick: 0, durationTick: duration });
    expectExactChordCoverage();

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "direct-chord", bars: 4, songForm: { form: "none" }, harmonicRhythm: { changesPerBar: 1 },
    });
    const overlapTarget = useComposerStore.getState().draftComposition.chords[0]!;
    expect(useComposerStore.getState().moveChord(overlapTarget.id, 480)).toBe(true);
    expect(useComposerStore.getState().draftComposition.chords.find((chord) => chord.id === overlapTarget.id))
      .toMatchObject({ startTick: 480, durationTick: overlapTarget.durationTick });
    expectExactChordCoverage();
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "direct-chord", bars: 4, songForm: { form: "none" }, harmonicRhythm: { changesPerBar: 1 },
    });
    const wideTarget = useComposerStore.getState().draftComposition.chords[0]!;
    expect(useComposerStore.getState().resizeChord(wideTarget.id, 4_800)).toBe(true);
    expect(useComposerStore.getState().moveChord(wideTarget.id, 1_920)).toBe(true);
    expect(useComposerStore.getState().draftComposition.chords.find((chord) => chord.id === wideTarget.id))
      .toMatchObject({ startTick: 1_920, durationTick: 4_800 });
    expectExactChordCoverage();
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);
  });

  it("resizes by shrinking, consuming one/multiple events, and expanding to the end", () => {
    const source = useComposerStore.getState().draftComposition;
    const first = source.chords[0]!;
    const next = source.chords[1]!;
    expect(useComposerStore.getState().resizeChord(first.id, first.durationTick / 2)).toBe(true);
    expect(useComposerStore.getState().draftComposition.chords.find((chord) => chord.id === first.id))
      .toMatchObject({ startTick: first.startTick, durationTick: first.durationTick / 2 });
    expect(useComposerStore.getState().draftComposition.chords.find((chord) => chord.id === next.id)?.durationTick)
      .toBe(next.durationTick + first.durationTick / 2);
    expectExactChordCoverage();

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "direct-chord", bars: 4, songForm: { form: "none" }, harmonicRhythm: { changesPerBar: 1 },
    });
    const expandTarget = useComposerStore.getState().draftComposition.chords[0]!;
    expect(useComposerStore.getState().resizeChord(expandTarget.id, expandTarget.durationTick * 2.5)).toBe(true);
    expectExactChordCoverage();
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "direct-chord", bars: 4, songForm: { form: "none" }, harmonicRhythm: { changesPerBar: 1 },
    });
    const terminalTarget = useComposerStore.getState().draftComposition.chords[0]!;
    expect(useComposerStore.getState().resizeChord(terminalTarget.id, 7_680)).toBe(true);
    expect(useComposerStore.getState().draftComposition.chords).toHaveLength(1);
    expectExactChordCoverage();
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);

    const finalChord = useComposerStore.getState().draftComposition.chords[0]!;
    expect(useComposerStore.getState().resizeChord(finalChord.id, finalChord.durationTick - 1)).toBe(false);
  });

  it("rejects move/resize when source, absorber, target, or consumed events are locked", () => {
    const first = useComposerStore.getState().draftComposition.chords[0]!;
    const snapshot = () => {
      const state = useComposerStore.getState();
      return {
        draft: structuredClone(state.draftComposition),
        history: structuredClone(state.history),
        historyIndex: state.historyIndex,
      };
    };
    useComposerStore.getState().toggleBarLock(0);
    let before = snapshot();
    expect(useComposerStore.getState().moveChord(first.id, 1_920)).toBe(false);
    expect(useComposerStore.getState().resizeChord(first.id, first.durationTick / 2)).toBe(false);
    expect(snapshot()).toEqual(before);

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "direct-chord", bars: 4, songForm: { form: "none" }, harmonicRhythm: { changesPerBar: 1 },
    });
    const absorberCase = useComposerStore.getState().draftComposition.chords[0]!;
    useComposerStore.getState().toggleBarLock(1);
    before = snapshot();
    expect(useComposerStore.getState().moveChord(absorberCase.id, 3_840)).toBe(false);
    expect(snapshot()).toEqual(before);

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "direct-chord", bars: 4, songForm: { form: "none" }, harmonicRhythm: { changesPerBar: 1 },
    });
    const targetCase = useComposerStore.getState().draftComposition.chords[0]!;
    useComposerStore.getState().toggleBarLock(2);
    before = snapshot();
    expect(useComposerStore.getState().moveChord(targetCase.id, 3_840)).toBe(false);
    expect(snapshot()).toEqual(before);

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "direct-chord", bars: 4, songForm: { form: "none" }, harmonicRhythm: { changesPerBar: 1 },
    });
    const consumedCase = useComposerStore.getState().draftComposition.chords[0]!;
    useComposerStore.getState().toggleBarLock(1);
    before = snapshot();
    expect(useComposerStore.getState().resizeChord(consumedCase.id, 3_840)).toBe(false);
    expect(snapshot()).toEqual(before);

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "direct-chord", bars: 4, songForm: { form: "none" }, harmonicRhythm: { changesPerBar: 1 },
    });
    const shrinkNextCase = useComposerStore.getState().draftComposition.chords[0]!;
    useComposerStore.getState().toggleBarLock(1);
    before = snapshot();
    expect(useComposerStore.getState().resizeChord(shrinkNextCase.id, shrinkNextCase.durationTick / 2))
      .toBe(false);
    expect(snapshot()).toEqual(before);
  });

  it("handles invalid/no-op moves and resizes with one-step undo/redo", () => {
    const state = useComposerStore.getState();
    const target = state.draftComposition.chords[0]!;
    const before = structuredClone(state.draftComposition);
    const historyBefore = state.historyIndex;
    expect(state.moveChord("missing", 0)).toBe(false);
    expect(state.moveChord(target.id, target.startTick)).toBe(false);
    expect(state.moveChord(target.id, Number.NaN)).toBe(false);
    expect(state.moveChord(target.id, 1.5)).toBe(false);
    expect(state.moveChord(target.id, -1)).toBe(false);
    expect(state.moveChord(target.id, state.draftComposition.totalTicks)).toBe(false);
    expect(state.resizeChord("missing", 1)).toBe(false);
    expect(state.resizeChord(target.id, target.durationTick)).toBe(false);
    expect(state.resizeChord(target.id, Number.NaN)).toBe(false);
    expect(state.resizeChord(target.id, 1.5)).toBe(false);
    expect(state.draftComposition).toEqual(before);
    expect(state.historyIndex).toBe(historyBefore);

    expect(state.moveChord(target.id, 1_920)).toBe(true);
    const after = structuredClone(useComposerStore.getState().draftComposition);
    expect(useComposerStore.getState().undo()).toBe(true);
    expect(useComposerStore.getState().draftComposition).toEqual(before);
    expect(useComposerStore.getState().redo()).toBe(true);
    expect(useComposerStore.getState().draftComposition).toEqual(after);
  });

  it("normalizes relationship claims after move and resize", () => {
    const secondary = secondaryDominantFixture();
    expect(useComposerStore.getState().moveChord(secondary.secondary.id, 3_840)).toBe(true);
    expect(useComposerStore.getState().draftComposition.chords
      .find((chord) => chord.id === secondary.secondary.id)?.targetDegree).toBeUndefined();
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "direct-chord", bars: 4, songForm: { form: "none" }, harmonicRhythm: { changesPerBar: 1 },
    });
    const neo = neoRiemannianFixture();
    expect(useComposerStore.getState().moveChord(neo.transformed.id, 5_760)).toBe(true);
    expect(useComposerStore.getState().draftComposition.chords
      .find((chord) => chord.id === neo.transformed.id)?.transformation).toBeUndefined();
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "direct-chord", bars: 4, songForm: { form: "none" }, harmonicRhythm: { changesPerBar: 1 },
    });
    const resizeFixture = secondaryDominantFixture();
    expect(useComposerStore.getState().resizeChord(resizeFixture.secondary.id, 3_840)).toBe(true);
    expect(useComposerStore.getState().draftComposition.chords
      .find((chord) => chord.id === resizeFixture.secondary.id)?.targetDegree).toBeUndefined();
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);
  });

  it("reclassifies a moved chord safely across a modulated section", () => {
    useComposerStore.getState().generateComposition({
      seed: "move-final-lift",
      bars: 16,
      songForm: { form: "verseChorus", finalLift: 2 },
    });
    const source = useComposerStore.getState().draftComposition;
    const lifted = source.sections?.find((section) => section.transpose !== 0);
    expect(lifted).toBeDefined();
    if (!lifted) return;
    const destinationStart = lifted.startBar * source.ticksPerBar;
    const original = source.chords.find(
      (chord) => chord.startTick < destinationStart && chord.source === "diatonic",
    );
    expect(original).toBeDefined();
    if (!original) return;
    const symbol = original.symbol;
    const notes = [...original.notes];
    expect(useComposerStore.getState().moveChord(original.id, destinationStart)).toBe(true);
    const moved = useComposerStore.getState().draftComposition.chords.find(
      (chord) => chord.id === original.id,
    )!;
    expect(moved.symbol).toBe(symbol);
    expect(moved.notes).toEqual(notes);
    expect(moved.startTick).toBe(destinationStart);
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);
  });

  it("leaves same-section tension metadata and unrelated chords unchanged", () => {
    const source = useComposerStore.getState().draftComposition;
    const first = source.chords[0]!;
    const distant = source.chords[source.chords.length - 1]!;
    const firstTension = createStepChordEvent({
      step: { degree: 1 },
      key: source.settings.key,
      mode: source.settings.mode,
      startTick: first.startTick,
      durationTick: first.durationTick,
      id: first.id,
      tensionsFor: () => ["9"],
    });
    const distantTension = createStepChordEvent({
      step: { degree: 4 },
      key: source.settings.key,
      mode: source.settings.mode,
      startTick: distant.startTick,
      durationTick: distant.durationTick,
      id: distant.id,
      tensionsFor: () => ["9"],
    });
    expect(firstTension.tensions).toContain("9");
    expect(distantTension.tensions).toContain("9");
    installChordFixture(source.chords.map((chord) =>
      chord.id === first.id
        ? firstTension
        : chord.id === distant.id
          ? distantTension
          : chord,
    ));
    const beforeFirst = structuredClone(firstTension);
    const beforeDistant = structuredClone(distantTension);
    expect(useComposerStore.getState().moveChord(first.id, 480)).toBe(true);
    const moved = useComposerStore.getState().draftComposition.chords.find(
      (chord) => chord.id === first.id,
    )!;
    expect({ ...moved, startTick: beforeFirst.startTick }).toEqual(beforeFirst);
    expect(useComposerStore.getState().draftComposition.chords.find(
      (chord) => chord.id === distant.id,
    )).toEqual(beforeDistant);
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);
  });

  it("keeps move and resize pending until the next bar while playing", () => {
    const target = useComposerStore.getState().draftComposition.chords[0]!;
    const committed = structuredClone(useComposerStore.getState().committedComposition);
    useComposerStore.getState().setPlaybackStatus("playing");
    useComposerStore.getState().setUpdateTiming("nextBar");
    expect(useComposerStore.getState().moveChord(target.id, 1_920)).toBe(true);
    expect(useComposerStore.getState().pendingCommit).toBe(true);
    expect(useComposerStore.getState().committedComposition).toEqual(committed);
    useComposerStore.getState().setCurrentTick(1_919);
    expect(useComposerStore.getState().pendingCommit).toBe(true);
    useComposerStore.getState().setCurrentTick(1_920);
    expect(useComposerStore.getState().pendingCommit).toBe(false);
    expect(useComposerStore.getState().committedComposition)
      .toEqual(useComposerStore.getState().draftComposition);
  });

  it("normalizes applied-dominant claims across add, split, and delete", () => {
    const { secondary } = secondaryDominantFixture();
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);
    expect(useComposerStore.getState().addChord("F#", 480, 480)).toBeTruthy();
    let chords = useComposerStore.getState().draftComposition.chords;
    expect(chords.find((chord) => chord.id === secondary.id)?.targetDegree).toBeUndefined();
    expect(chords.filter((chord) => chord.specialKind === "secondaryDominant")).toHaveLength(1);
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "direct-chord", bars: 4, songForm: { form: "none" }, harmonicRhythm: { changesPerBar: 1 },
    });
    const splitFixture = secondaryDominantFixture();
    expect(useComposerStore.getState().splitChord(splitFixture.secondary.id, 480)).toBeTruthy();
    chords = useComposerStore.getState().draftComposition.chords;
    expect(chords.find((chord) => chord.startTick === 0)?.targetDegree).toBeUndefined();
    expect(chords.find((chord) => chord.startTick === 480)?.targetDegree)
      .toBe(splitFixture.secondary.targetDegree);
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "direct-chord", bars: 4, songForm: { form: "none" }, harmonicRhythm: { changesPerBar: 1 },
    });
    const deleteFixture = secondaryDominantFixture();
    expect(useComposerStore.getState().deleteChord(deleteFixture.resolution.id)).toBe(true);
    const remaining = useComposerStore.getState().draftComposition.chords[0]!;
    expect(remaining.source).toBe("other");
    expect(remaining.targetDegree).toBeUndefined();
    expect(remaining.specialKind).toBeUndefined();
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);
  });

  it("keeps Neo-Riemannian claims only on the first split and drops deleted references", () => {
    const { transformed } = neoRiemannianFixture();
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);
    expect(useComposerStore.getState().splitChord(transformed.id, 2_400)).toBeTruthy();
    let chords = useComposerStore.getState().draftComposition.chords;
    expect(chords.find((chord) => chord.id === transformed.id)?.transformation).toBeDefined();
    expect(chords.find((chord) => chord.startTick === 2_400)?.transformation).toBeUndefined();
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "direct-chord", bars: 4, songForm: { form: "none" }, harmonicRhythm: { changesPerBar: 1 },
    });
    const addFixture = neoRiemannianFixture();
    expect(useComposerStore.getState().addChord("F#", 2_400, 240)).toBeTruthy();
    chords = useComposerStore.getState().draftComposition.chords;
    expect(chords.find((chord) => chord.id === addFixture.transformed.id)?.transformation)
      .toBeDefined();
    expect(chords.filter((chord) => chord.startTick > addFixture.transformed.startTick
      && chord.startTick < addFixture.transformed.startTick + addFixture.transformed.durationTick)
      .every((chord) => chord.transformation === undefined)).toBe(true);
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "direct-chord", bars: 4, songForm: { form: "none" }, harmonicRhythm: { changesPerBar: 1 },
    });
    const deleteFixture = neoRiemannianFixture();
    expect(useComposerStore.getState().deleteChord(deleteFixture.previous.id)).toBe(true);
    expect(useComposerStore.getState().draftComposition.chords[0]?.transformation).toBeUndefined();
    expect(validateComposition(useComposerStore.getState().draftComposition).errors).toEqual([]);
  });

  it("deletes into an adjacent chord and undoes/redoes in one history step", () => {
    const before = structuredClone(useComposerStore.getState().draftComposition);
    const target = before.chords[1]!;
    const historyBefore = useComposerStore.getState().historyIndex;
    expect(useComposerStore.getState().deleteChord(target.id)).toBe(true);
    const afterDelete = structuredClone(useComposerStore.getState().draftComposition);
    expect(useComposerStore.getState().historyIndex).toBe(historyBefore + 1);
    expectExactChordCoverage();

    expect(useComposerStore.getState().undo()).toBe(true);
    expect(useComposerStore.getState().draftComposition).toEqual(before);
    expect(useComposerStore.getState().redo()).toBe(true);
    expect(useComposerStore.getState().draftComposition).toEqual(afterDelete);
  });

  it("rejects all direct chord edits that intersect a locked bar", () => {
    const target = useComposerStore.getState().draftComposition.chords[0]!;
    useComposerStore.getState().toggleBarLock(0);
    const before = useComposerStore.getState();
    const draftBefore = structuredClone(before.draftComposition);
    const historyBefore = structuredClone(before.history);
    const historyIndexBefore = before.historyIndex;

    expect(useComposerStore.getState().addChord("F#", target.startTick, 120)).toBeNull();
    expect(useComposerStore.getState().splitChord(target.id, target.startTick + 1)).toBeNull();
    expect(useComposerStore.getState().deleteChord(target.id)).toBe(false);
    expect(useComposerStore.getState().editChord(target.id, "F#")).toBe(false);

    const after = useComposerStore.getState();
    expect(after.draftComposition).toEqual(draftBefore);
    expect(after.history).toEqual(historyBefore);
    expect(after.historyIndex).toBe(historyIndexBefore);
  });

  it("treats invalid add and split inputs as no-ops", () => {
    const before = useComposerStore.getState();
    const target = before.draftComposition.chords[0]!;
    const draftBefore = structuredClone(before.draftComposition);
    const historyBefore = structuredClone(before.history);
    const invalidAdds: Array<[string, number, number?]> = [
      ["", target.startTick],
      ["not-a-chord", target.startTick],
      ["F#", Number.NaN],
      ["F#", 1.5],
      ["F#", -1],
      ["F#", before.draftComposition.totalTicks],
      ["F#", target.startTick, 0],
      ["F#", target.startTick, Number.NaN],
    ];
    for (const [symbol, startTick, durationTick] of invalidAdds) {
      expect(useComposerStore.getState().addChord(symbol, startTick, durationTick)).toBeNull();
    }
    expect(useComposerStore.getState().splitChord(target.id, Number.NaN)).toBeNull();
    expect(useComposerStore.getState().splitChord("missing", target.startTick + 1)).toBeNull();
    expect(useComposerStore.getState().draftComposition).toEqual(draftBefore);
    expect(useComposerStore.getState().history).toEqual(historyBefore);
  });

  it("clears progression names only in sections touched by direct edits", () => {
    useComposerStore.getState().generateComposition({
      seed: "section-add", bars: 16, songForm: { form: "verseChorus" },
    });
    let state = useComposerStore.getState();
    const sections = state.draftComposition.sections ?? [];
    const targetSection = sections.find((section) => section.progressionId !== undefined);
    const untouchedSection = sections.find(
      (section) => section.id !== targetSection?.id && section.progressionId !== undefined,
    );
    expect(targetSection).toBeDefined();
    expect(untouchedSection).toBeDefined();
    if (!targetSection || !untouchedSection) return;
    const target = state.draftComposition.chords.find(
      (chord) => chord.startTick >= targetSection.startBar * state.draftComposition.ticksPerBar
        && chord.startTick < targetSection.endBar * state.draftComposition.ticksPerBar,
    )!;
    expect(state.addChord("F#", target.startTick + 1, 1)).toBeTruthy();
    state = useComposerStore.getState();
    expect(state.draftComposition.sections?.find((section) => section.id === targetSection.id)
      ?.progressionId).toBeUndefined();
    expect(state.draftComposition.sections?.find((section) => section.id === untouchedSection.id)
      ?.progressionId).toBe(untouchedSection.progressionId);

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "section-edit", bars: 16, songForm: { form: "verseChorus" },
    });
    state = useComposerStore.getState();
    const editSections = state.draftComposition.sections ?? [];
    const editSection = editSections.find((section) => section.progressionId !== undefined);
    const editUntouchedSection = editSections.find(
      (section) => section.id !== editSection?.id && section.progressionId !== undefined,
    );
    expect(editSection).toBeDefined();
    expect(editUntouchedSection).toBeDefined();
    if (!editSection || !editUntouchedSection) return;
    const editTarget = state.draftComposition.chords.find(
      (chord) => chord.startTick >= editSection.startBar * state.draftComposition.ticksPerBar
        && chord.startTick < editSection.endBar * state.draftComposition.ticksPerBar,
    )!;
    expect(state.editChord(editTarget.id, "F#")).toBe(true);
    state = useComposerStore.getState();
    expect(state.draftComposition.sections?.find((section) => section.id === editSection.id)
      ?.progressionId).toBeUndefined();
    expect(state.draftComposition.sections?.find((section) => section.id === editUntouchedSection.id)
      ?.progressionId).toBe(editUntouchedSection.progressionId);

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "section-delete", bars: 16, songForm: { form: "verseChorus" },
    });
    state = useComposerStore.getState();
    const deleteSection = state.draftComposition.sections?.find((section) => section.progressionId);
    expect(deleteSection).toBeDefined();
    if (!deleteSection) return;
    const deleteTarget = state.draftComposition.chords.find(
      (chord) => chord.startTick >= deleteSection.startBar * state.draftComposition.ticksPerBar
        && chord.startTick < deleteSection.endBar * state.draftComposition.ticksPerBar,
    )!;
    expect(state.deleteChord(deleteTarget.id)).toBe(true);
    expect(useComposerStore.getState().draftComposition.sections?.find((section) => section.id === deleteSection.id)
      ?.progressionId).toBeUndefined();

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "section-split", bars: 16, songForm: { form: "verseChorus" },
    });
    state = useComposerStore.getState();
    const splitSection = state.draftComposition.sections?.find((section) => section.progressionId);
    expect(splitSection).toBeDefined();
    if (!splitSection) return;
    const splitTarget = state.draftComposition.chords.find(
      (chord) => chord.startTick >= splitSection.startBar * state.draftComposition.ticksPerBar
        && chord.startTick < splitSection.endBar * state.draftComposition.ticksPerBar,
    )!;
    expect(state.splitChord(splitTarget.id, splitTarget.startTick + 1)).toBeTruthy();
    expect(useComposerStore.getState().draftComposition.sections?.find((section) => section.id === splitSection.id)
      ?.progressionId).toBeUndefined();

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "section-move", bars: 16, songForm: { form: "verseChorus" },
    });
    state = useComposerStore.getState();
    const moveSections = state.draftComposition.sections ?? [];
    const moveSection = moveSections.find((section) => section.progressionId !== undefined);
    const moveUntouchedSection = moveSections.find(
      (section) => section.id !== moveSection?.id && section.progressionId !== undefined,
    );
    expect(moveSection).toBeDefined();
    expect(moveUntouchedSection).toBeDefined();
    if (!moveSection || !moveUntouchedSection) return;
    const moveTarget = state.draftComposition.chords.find(
      (chord) => chord.startTick >= moveSection.startBar * state.draftComposition.ticksPerBar
        && chord.startTick < moveSection.endBar * state.draftComposition.ticksPerBar,
    )!;
    expect(state.moveChord(moveTarget.id, moveTarget.startTick + 1)).toBe(true);
    state = useComposerStore.getState();
    expect(state.draftComposition.sections?.find((section) => section.id === moveSection.id)
      ?.progressionId).toBeUndefined();
    expect(state.draftComposition.sections?.find((section) => section.id === moveUntouchedSection.id)
      ?.progressionId).toBe(moveUntouchedSection.progressionId);

    useComposerStore.getState().reset({ seed: "direct-chord-tests" });
    useComposerStore.getState().generateComposition({
      seed: "section-resize", bars: 16, songForm: { form: "verseChorus" },
    });
    state = useComposerStore.getState();
    const resizeSections = state.draftComposition.sections ?? [];
    const resizeSection = resizeSections.find((section) => section.progressionId !== undefined);
    const resizeUntouchedSection = resizeSections.find(
      (section) => section.id !== resizeSection?.id && section.progressionId !== undefined,
    );
    expect(resizeSection).toBeDefined();
    expect(resizeUntouchedSection).toBeDefined();
    if (!resizeSection || !resizeUntouchedSection) return;
    const resizeTarget = state.draftComposition.chords.find(
      (chord) => chord.startTick >= resizeSection.startBar * state.draftComposition.ticksPerBar
        && chord.startTick < resizeSection.endBar * state.draftComposition.ticksPerBar,
    )!;
    expect(state.resizeChord(resizeTarget.id, resizeTarget.durationTick / 2)).toBe(true);
    state = useComposerStore.getState();
    expect(state.draftComposition.sections?.find((section) => section.id === resizeSection.id)
      ?.progressionId).toBeUndefined();
    expect(state.draftComposition.sections?.find((section) => section.id === resizeUntouchedSection.id)
      ?.progressionId).toBe(resizeUntouchedSection.progressionId);
  });

  it("keeps playback committed until the next bar for a pending add", () => {
    const before = structuredClone(useComposerStore.getState().committedComposition);
    const target = useComposerStore.getState().draftComposition.chords[0]!;
    useComposerStore.getState().setPlaybackStatus("playing");
    useComposerStore.getState().setUpdateTiming("nextBar");
    expect(useComposerStore.getState().addChord("F#", target.startTick + 1, 1)).toBeTruthy();
    expect(useComposerStore.getState().pendingCommit).toBe(true);
    expect(useComposerStore.getState().committedComposition).toEqual(before);

    const ticksPerBar = useComposerStore.getState().draftComposition.ticksPerBar;
    useComposerStore.getState().setCurrentTick(ticksPerBar - 1);
    expect(useComposerStore.getState().committedComposition).toEqual(before);
    useComposerStore.getState().setCurrentTick(ticksPerBar);
    expect(useComposerStore.getState().pendingCommit).toBe(false);
    expect(useComposerStore.getState().committedComposition)
      .toEqual(useComposerStore.getState().draftComposition);
  });
});

/**
 * Using a progression the search found.
 *
 * The search could list fifteen hundred progressions and do nothing with any of
 * them: 試聴 sounded the first chord and there was no way to put one into the
 * piece. What "use" has to mean is the question this answers -- a progression
 * is a sequence of degrees, not of durations, so the bars keep their harmonic
 * rhythm and only what they spell changes.
 */
describe("applying a progression to the piece", () => {
  beforeEach(() => {
    localStorage.clear();
    useComposerStore.getState().reset({ seed: "apply-tests" });
    useComposerStore.getState().generateComposition({ seed: "apply", bars: 16 });
  });

  const STEPS = [
    { degree: 1 as const }, { degree: 5 as const },
    { degree: 6 as const }, { degree: 4 as const },
  ];

  it("rewrites the degrees of the range it was given and nothing else", () => {
    const before = useComposerStore.getState().draftComposition;
    const outside = before.chords
      .filter((chord) => chord.startTick >= 4 * before.ticksPerBar)
      .map((chord) => chord.symbol);

    expect(useComposerStore.getState()
      .applyProgression(STEPS, { startBar: 0, endBar: 4 })).toBe(true);

    const after = useComposerStore.getState().draftComposition;
    const inside = after.chords
      .filter((chord) => chord.startTick < 4 * before.ticksPerBar);
    expect(inside.map((chord) => chord.degree)).toEqual(
      inside.map((_, index) => STEPS[index % STEPS.length]!.degree),
    );
    expect(
      after.chords
        .filter((chord) => chord.startTick >= 4 * before.ticksPerBar)
        .map((chord) => chord.symbol),
    ).toEqual(outside);
  });

  it("keeps the bars' own harmonic rhythm rather than imposing the progression's", () => {
    // Four steps do not mean four bars. A progression says which degrees and in
    // what order; how long each is held is the piece's business, and a two
    // chord bar stays a two chord bar.
    const before = useComposerStore.getState().draftComposition;
    const timing = before.chords.map((chord) => ({
      id: chord.id, startTick: chord.startTick, durationTick: chord.durationTick,
    }));
    useComposerStore.getState().applyProgression(STEPS, null);
    const after = useComposerStore.getState().draftComposition;
    expect(after.chords.map((chord) => ({
      id: chord.id, startTick: chord.startTick, durationTick: chord.durationTick,
    }))).toEqual(timing);
  });

  it("cycles a progression shorter than the stretch it is used over", () => {
    useComposerStore.getState().applyProgression([{ degree: 2 }, { degree: 5 }], null);
    const degrees = useComposerStore.getState().draftComposition.chords
      .map((chord) => chord.degree);
    expect(degrees.length).toBeGreaterThan(4);
    expect(degrees).toEqual(degrees.map((_, index) => (index % 2 === 0 ? 2 : 5)));
  });

  it("leaves a piece the app still accepts", () => {
    useComposerStore.getState().applyProgression(STEPS, null);
    const outcome = validateComposition(useComposerStore.getState().draftComposition);
    expect(outcome.errors.map((issue) => issue.code)).toEqual([]);
  });

  it("is one undo, not one per chord", () => {
    const before = useComposerStore.getState().draftComposition.chords.map((c) => c.symbol);
    useComposerStore.getState().applyProgression(STEPS, null);
    expect(useComposerStore.getState().draftComposition.chords.map((c) => c.symbol))
      .not.toEqual(before);
    expect(useComposerStore.getState().undo()).toBe(true);
    expect(useComposerStore.getState().draftComposition.chords.map((c) => c.symbol))
      .toEqual(before);
  });

  it("stops a rewritten section claiming the progression it no longer plays", () => {
    // The explanation panel reads the section's progressionId to say "this
    // section is the royal road". Leaving it after replacing the chords makes
    // the app state something false about itself, in the one place a reader
    // goes to find out what it did.
    const before = useComposerStore.getState().draftComposition;
    const section = (before.sections ?? [])[0]!;
    expect(section.progressionId, "no progression to lose").toBeDefined();

    useComposerStore.getState().applyProgression(STEPS, {
      startBar: section.startBar, endBar: section.endBar,
    });
    const rewritten = (useComposerStore.getState().draftComposition.sections ?? [])[0]!;
    expect(rewritten.progressionId).toBeUndefined();

    // And takes the new name when the caller has one.
    useComposerStore.getState().applyProgression(STEPS, {
      startBar: section.startBar, endBar: section.endBar,
    }, "royal-road");
    expect((useComposerStore.getState().draftComposition.sections ?? [])[0]!.progressionId)
      .toBe("royal-road");
  });

  it("does not name a section the rewrite only partly covers", () => {
    // Half a section rewritten is not that progression either way.
    const before = useComposerStore.getState().draftComposition;
    const section = (before.sections ?? [])[0]!;
    useComposerStore.getState().applyProgression(STEPS, {
      startBar: section.startBar, endBar: section.startBar + 1,
    }, "royal-road");
    expect((useComposerStore.getState().draftComposition.sections ?? [])[0]!.progressionId)
      .toBeUndefined();
  });

  it("leaves the sections it never touched alone", () => {
    const before = useComposerStore.getState().draftComposition;
    const sections = before.sections ?? [];
    expect(sections.length, "needs more than one section").toBeGreaterThan(1);
    const last = sections[sections.length - 1]!;
    useComposerStore.getState().applyProgression(STEPS, { startBar: 0, endBar: 1 });
    const after = useComposerStore.getState().draftComposition.sections ?? [];
    expect(after[after.length - 1]!.progressionId).toBe(last.progressionId);
  });

  it("refuses an empty progression rather than emptying the bars", () => {
    const before = useComposerStore.getState().draftComposition.chords.map((c) => c.symbol);
    expect(useComposerStore.getState().applyProgression([], null)).toBe(false);
    expect(useComposerStore.getState().draftComposition.chords.map((c) => c.symbol))
      .toEqual(before);
  });

  it("spells a modulated section against the key it modulated to", () => {
    // A final lift moves a section to another key and says so on the section.
    // Rebuilding its chords against the composition key would transpose it back
    // without anything in the piece recording that it had.
    useComposerStore.getState().generateComposition({
      seed: "lift", bars: 16, songForm: { form: "verseChorus", finalLift: 2 },
    });
    const composition = useComposerStore.getState().draftComposition;
    const lifted = (composition.sections ?? []).find((section) => section.transpose !== 0);
    expect(lifted, "no section modulated").toBeDefined();
    useComposerStore.getState().applyProgression([{ degree: 1 }], {
      startBar: lifted!.startBar, endBar: lifted!.endBar,
    });
    const after = useComposerStore.getState().draftComposition;
    const tonic = after.chords.find((chord) =>
      chord.startTick >= lifted!.startBar * after.ticksPerBar)!;
    expect(tonic.root).toBe(lifted!.key);
  });
});


/**
 * The generate button consulting what the A/B panel learned.
 *
 * The store's job stays generation: whose taste picked the draw is the
 * caller's business, so the model is passed in rather than held here.
 */
describe("generating with preference guidance", () => {
  beforeEach(() => {
    localStorage.clear();
    useComposerStore.getState().reset({ seed: "guide-tests" });
  });

  const seventhRate = (composition: { chords: ReadonlyArray<{ quality: string }> }) =>
    composition.chords.filter((chord) => chord.quality.endsWith("7")).length
      / composition.chords.length;

  function trained() {
    let model = createPreferenceModel();
    for (let index = 0; index + 1 < 20; index += 2) {
      const left = generateComposition({
        ...DEFAULT_GENERATOR_SETTINGS, bars: 16, seed: `t-${index}`,
      } as GeneratorSettings);
      const right = generateComposition({
        ...DEFAULT_GENERATOR_SETTINGS, bars: 16, seed: `t-${index + 1}`,
      } as GeneratorSettings);
      const winner = seventhRate(left) >= seventhRate(right) ? left : right;
      const loser = winner === left ? right : left;
      model = updatePreferenceModel(model, {
        type: "ab",
        winner: extractPreferenceFeatures(winner),
        loser: extractPreferenceFeatures(loser),
      });
    }
    return model;
  }

  it("records the winning draw in the piece's own seed", () => {
    // Which is what keeps the promise: the piece is reproducible from its seed
    // with no model, however much is learned afterwards.
    useComposerStore.getState().generateComposition(
      { seed: "chosen", bars: 16 },
      { model: trained(), candidates: 8 },
    );
    const seed = String(useComposerStore.getState().draftComposition.seed);
    expect(seed).toMatch(/^chosen(#\d+)?$/);
    const settings = useComposerStore.getState().draftComposition.settings;
    expect(JSON.stringify(useComposerStore.getState().draftComposition))
      .toBe(JSON.stringify(generateComposition({ ...settings, seed })));
  }, 60_000);

  it("leaves the seed alone when it was not asked to choose", () => {
    useComposerStore.getState().generateComposition({ seed: "plain", bars: 16 });
    expect(useComposerStore.getState().draftComposition.seed).toBe("plain");
  });

  it("generates what it always did when nothing has been learned", () => {
    useComposerStore.getState().generateComposition({ seed: "same", bars: 16 });
    const without = JSON.stringify(useComposerStore.getState().draftComposition);
    useComposerStore.getState().generateComposition(
      { seed: "same", bars: 16 },
      { model: createPreferenceModel(), candidates: 8 },
    );
    expect(JSON.stringify(useComposerStore.getState().draftComposition)).toBe(without);
  }, 30_000);
});
