import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  generateComposition,
  validateComposition,
} from "../src/music";
import {
  createPreferenceModel,
  extractPreferenceFeatures,
  updatePreferenceModel,
} from "../src/preference";
import type { GeneratorSettings } from "../src/types/music";
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
