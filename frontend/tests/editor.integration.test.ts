import { Midi } from "@tonejs/midi";
import { beforeEach, describe, expect, it } from "vitest";
import {
  pitchClassToSemitone,
  validateComposition,
} from "../src/music";
import { buildCompositionTracks } from "../src/music/compositionTracks";
import {
  exportCompositionJson,
  exportCompositionMidi,
  importCompositionJson,
} from "../src/features/export";
import { useComposerStore } from "../src/state";
import type { ChordEvent, GeneratedComposition } from "../src/types/music";

function resetStore(): void {
  localStorage.clear();
  useComposerStore.getState().reset({ seed: "editor-integration" });
}

function applyAcousticEdit(): { before: ChordEvent; after: ChordEvent } {
  const store = useComposerStore.getState();
  const before = structuredClone(store.draftComposition.chords[0]!);
  const root = before.root === "C" ? "D" : "C";
  const bass = root === "C" ? "F" : "G";
  expect(store.editChord(before.id, {
    root,
    quality: "dominant7",
    tensions: ["9", "#11"],
    bass,
    inversion: 0,
  })).toBe(true);
  const after = structuredClone(useComposerStore.getState().draftComposition.chords[0]!);
  return { before, after };
}

function assertExactChordCoverage(composition: GeneratedComposition): void {
  const chords = [...composition.chords].sort((left, right) => left.startTick - right.startTick);
  expect(chords[0]?.startTick).toBe(0);
  let cursor = 0;
  for (const chord of chords) {
    expect(Number.isInteger(chord.startTick), chord.id).toBe(true);
    expect(Number.isInteger(chord.durationTick), chord.id).toBe(true);
    expect(chord.startTick).toBe(cursor);
    expect(chord.durationTick).toBeGreaterThan(0);
    cursor = chord.startTick + chord.durationTick;
  }
  expect(cursor).toBe(composition.totalTicks);
  expect(new Set(chords.map((chord) => chord.id)).size).toBe(chords.length);
  expect(validateComposition(composition).errors).toEqual([]);
}

function notesInRange(track: { notes: readonly { midi: number; startTick: number }[] }, chord: ChordEvent) {
  return track.notes.filter(
    (note) => note.startTick >= chord.startTick
      && note.startTick < chord.startTick + chord.durationTick,
  );
}

describe("structured chord editor integration", () => {
  beforeEach(resetStore);

  it("propagates acoustic edits to left/right tracks without stale voicing", () => {
    const { before, after } = applyAcousticEdit();
    const composition = useComposerStore.getState().draftComposition;
    const tracks = buildCompositionTracks(composition);
    const bass = tracks.find((track) => track.role === "bass");
    const chords = tracks.find((track) => track.role === "chords");
    expect(bass).toBeDefined();
    expect(chords).toBeDefined();
    if (!bass || !chords) return;

    const bassNotes = notesInRange(bass, after);
    const chordNotes = notesInRange(chords, after);
    const editedPitchClasses = new Set(after.notes.map((note) => note % 12));
    const oldPitchClasses = new Set(before.notes.map((note) => note % 12));
    expect(after.notes).not.toEqual(before.notes);
    expect(bassNotes.length).toBeGreaterThan(0);
    expect(new Set(bassNotes.map((note) => note.midi % 12))).toEqual(
      new Set([pitchClassToSemitone(after.bass ?? after.root)]),
    );
    expect(chordNotes.length).toBeGreaterThan(0);
    expect(chordNotes.every((note) => editedPitchClasses.has(note.midi % 12))).toBe(true);
    expect(chordNotes.some((note) => !oldPitchClasses.has(note.midi % 12))).toBe(true);
  });

  it("exports edited pitches to MIDI, including the explicit slash bass", () => {
    const { before, after } = applyAcousticEdit();
    const composition = useComposerStore.getState().draftComposition;
    const midi = new Midi(exportCompositionMidi(composition, {
      includeMelody: false,
      includeAdditionalVoices: false,
    }));
    expect(midi.tracks.map((track) => track.name)).toEqual([
      "Bass / Left Hand",
      "Chords / Right Hand",
    ]);
    const ratio = midi.header.ppq / composition.ppq;
    const start = Math.round(after.startTick * ratio);
    const end = Math.round((after.startTick + after.durationTick) * ratio);
    const bass = midi.tracks[0]!.notes.filter((note) => note.ticks >= start && note.ticks < end);
    const chords = midi.tracks[1]!.notes.filter((note) => note.ticks >= start && note.ticks < end);
    const oldPitchClasses = new Set(before.notes.map((note) => note % 12));
    expect(bass.length).toBeGreaterThan(0);
    expect(new Set(bass.map((note) => note.midi % 12))).toEqual(
      new Set([pitchClassToSemitone(after.bass ?? after.root)]),
    );
    expect(chords.length).toBeGreaterThan(0);
    expect(chords.some((note) => !oldPitchClasses.has(note.midi % 12))).toBe(true);
    expect(chords.some((note) => note.midi % 12 === (pitchClassToSemitone(after.root) + 14) % 12))
      .toBe(true);
    expect(chords.some((note) => note.midi % 12 === (pitchClassToSemitone(after.root) + 18) % 12))
      .toBe(true);
  });

  it("round-trips edited chord data and a gap-free timeline through JSON", () => {
    applyAcousticEdit();
    let state = useComposerStore.getState();
    const initial = state.draftComposition.chords.find((chord) => chord.durationTick > 4);
    expect(initial).toBeDefined();
    if (!initial) return;
    expect(state.addChord("F#", initial.startTick + 1, 1)).toBeTruthy();

    state = useComposerStore.getState();
    const splitTarget = state.draftComposition.chords.find((chord) => chord.durationTick > 4);
    expect(splitTarget).toBeDefined();
    if (!splitTarget) return;
    expect(state.splitChord(
      splitTarget.id,
      splitTarget.startTick + Math.floor(splitTarget.durationTick / 2),
    )).toBeTruthy();

    state = useComposerStore.getState();
    const moveTarget = state.draftComposition.chords.find(
      (chord) => chord.startTick > 0 && chord.durationTick > 2,
    );
    expect(moveTarget).toBeDefined();
    if (!moveTarget) return;
    expect(state.moveChord(moveTarget.id, 0)).toBe(true);

    state = useComposerStore.getState();
    const resizeTarget = state.draftComposition.chords.find(
      (chord, index, chords) => index < chords.length - 1 && chord.durationTick > 2,
    );
    expect(resizeTarget).toBeDefined();
    if (!resizeTarget) return;
    expect(state.resizeChord(resizeTarget.id, resizeTarget.durationTick - 1)).toBe(true);

    const composition = useComposerStore.getState().draftComposition;
    assertExactChordCoverage(composition);
    const document = JSON.parse(exportCompositionJson(composition)) as {
      schemaVersion: number;
    };
    expect(document.schemaVersion).toBe(2);
    expect(importCompositionJson(exportCompositionJson(composition))).toEqual(composition);
  });

  it("keeps committed playback and loop state old until the next bar boundary", () => {
    const store = useComposerStore.getState();
    store.setCurrentTick(240);
    store.setPlaybackStatus("playing");
    store.setUpdateTiming("nextBar");
    const before = structuredClone(useComposerStore.getState().committedComposition);
    const currentTick = useComposerStore.getState().playback.currentTick;
    const playbackLoop = structuredClone(useComposerStore.getState().playbackLoopRange);
    const loop = structuredClone(useComposerStore.getState().loopRange);
    const target = useComposerStore.getState().draftComposition.chords[0]!;
    const root = target.root === "C" ? "D" : "C";
    expect(useComposerStore.getState().editChord(target.id, {
      root,
      quality: "dominant7",
      tensions: ["9"],
      bass: root === "C" ? "F" : "G",
      inversion: 0,
    })).toBe(true);
    const draft = useComposerStore.getState().draftComposition.chords[0]!;
    expect(draft.root).toBe(root);
    expect(useComposerStore.getState().committedComposition.chords[0]).toEqual(before.chords[0]);
    expect(useComposerStore.getState().pendingCommit).toBe(true);
    expect(useComposerStore.getState().playback.currentTick).toBe(currentTick);
    expect(useComposerStore.getState().playbackLoopRange).toEqual(playbackLoop);
    expect(useComposerStore.getState().loopRange).toEqual(loop);
    const committedBass = buildCompositionTracks(useComposerStore.getState().committedComposition)
      .find((track) => track.role === "bass")?.notes[0];
    expect(committedBass).toBeDefined();
    expect(committedBass!.midi % 12).toBe(before.chords[0]!.notes[0]! % 12);

    const ticksPerBar = useComposerStore.getState().draftComposition.ticksPerBar;
    useComposerStore.getState().setCurrentTick(ticksPerBar - 1);
    expect(useComposerStore.getState().pendingCommit).toBe(true);
    useComposerStore.getState().setCurrentTick(ticksPerBar);
    const after = useComposerStore.getState();
    expect(after.pendingCommit).toBe(false);
    expect(after.committedComposition).toEqual(after.draftComposition);
    expect(after.playback.status).toBe("playing");
    expect(after.playbackLoopRange).toEqual(after.loopRange);
  });

  it("undoes and redoes structured and timeline edits without losing playback selection", () => {
    const state = useComposerStore.getState();
    state.setCurrentTick(480);
    state.setSelectedRange({ startBar: 1, endBar: 2 });
    const currentTick = useComposerStore.getState().playback.currentTick;
    const selectedRange = structuredClone(useComposerStore.getState().selectedBarRange);
    const loop = structuredClone(useComposerStore.getState().loopRange);
    const target = useComposerStore.getState().draftComposition.chords[0]!;
    const root = target.root === "C" ? "D" : "C";
    expect(useComposerStore.getState().editChord(target.id, {
      root,
      quality: "major7",
      tensions: ["9"],
      bass: root === "C" ? "F" : "G",
      inversion: 0,
    })).toBe(true);
    const afterEdit = structuredClone(useComposerStore.getState().draftComposition);
    const splitTarget = useComposerStore.getState().draftComposition.chords
      .find((chord) => chord.durationTick > 4)!;
    expect(splitTarget).toBeDefined();
    expect(useComposerStore.getState().splitChord(
      splitTarget.id,
      splitTarget.startTick + Math.floor(splitTarget.durationTick / 2),
    )).toBeTruthy();
    const afterTimeline = structuredClone(useComposerStore.getState().draftComposition);

    expect(useComposerStore.getState().undo()).toBe(true);
    expect(useComposerStore.getState().draftComposition).toEqual(afterEdit);
    expect(useComposerStore.getState().undo()).toBe(true);
    expect(useComposerStore.getState().draftComposition.chords).toEqual(
      useComposerStore.getState().committedComposition.chords,
    );
    expect(useComposerStore.getState().redo()).toBe(true);
    expect(useComposerStore.getState().draftComposition).toEqual(afterEdit);
    expect(useComposerStore.getState().redo()).toBe(true);
    const afterRedo = useComposerStore.getState();
    expect(afterRedo.draftComposition).toEqual(afterTimeline);
    expect(afterRedo.playback.currentTick).toBe(currentTick);
    expect(afterRedo.selectedBarRange).toEqual(selectedRange);
    expect(afterRedo.loopRange).toEqual(loop);
    assertExactChordCoverage(afterRedo.draftComposition);
    const tracks = buildCompositionTracks(afterRedo.draftComposition);
    const midi = new Midi(exportCompositionMidi(afterRedo.draftComposition));
    expect(midi.tracks[0]?.notes).toHaveLength(tracks.find((track) => track.role === "bass")!.notes.length);
    expect(midi.tracks[1]?.notes).toHaveLength(tracks.find((track) => track.role === "chords")!.notes.length);
  });
});
