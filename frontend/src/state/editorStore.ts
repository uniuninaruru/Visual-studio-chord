import { create } from "zustand";
import {
  DEFAULT_GENERATOR_SETTINGS,
  generateComposition as buildComposition,
  regenerateRange,
  replaceChordSymbol,
} from "../music";
import type {
  BarRange,
  ChordEvent,
  GeneratedComposition,
  GeneratorSettings,
  NoteEvent,
  RegenerationOptions,
} from "../types/music";
import {
  exportCompositionJson,
  exportCompositionMidi,
  importCompositionJson,
} from "../features/export";
import {
  clearEditorSnapshot,
  getSafeStorage,
  loadEditorSnapshot,
  saveEditorSnapshot,
  type PersistedEditorSnapshot,
} from "../storage";

export type PlaybackStatus = "stopped" | "playing" | "paused";
export type UpdateTiming = "immediate" | "nextBeat" | "nextBar" | "nextLoop";

export interface TickRange {
  startTick: number;
  endTick: number;
}

export interface PlaybackState {
  status: PlaybackStatus;
  currentTick: number;
  updateTiming: UpdateTiming;
}

export interface HistoryEntry {
  id: string;
  action: string;
  timestamp: string;
  seed: string;
  range: BarRange | null;
  composition: GeneratedComposition;
}

export type GeneratorSettingsPatch = Omit<Partial<GeneratorSettings>, "melody"> & {
  melody?: Partial<GeneratorSettings["melody"]>;
};

export type ChordEdit = string | Partial<Omit<ChordEvent, "id">>;

export interface NoteMove {
  /** Absolute MIDI pitch. */
  midi?: number;
  /** Relative pitch movement. Ignored when midi is supplied. */
  semitones?: number;
  /** Absolute start position in ticks. */
  startTick?: number;
  /** Relative time movement. Ignored when startTick is supplied. */
  deltaTick?: number;
  durationTick?: number;
}

export interface ComposerStoreState {
  settings: GeneratorSettings;
  committedComposition: GeneratedComposition;
  draftComposition: GeneratedComposition;
  previewVariations: GeneratedComposition[];
  selectedBarRange: BarRange | null;
  loopRange: TickRange;
  lockedBars: number[];
  playback: PlaybackState;
  history: HistoryEntry[];
  historyIndex: number;
  regenerationIteration: number;
  pendingCommit: boolean;
}

export interface ComposerStoreActions {
  generateComposition(settings?: GeneratorSettingsPatch): void;
  regenerateSelected(options?: RegenerationOptions): boolean;
  editChord(chordId: string, edit: ChordEdit): boolean;
  transposeNote(noteId: string, semitones: number): boolean;
  moveNote(noteId: string, move: NoteMove): boolean;
  deleteNote(noteId: string): boolean;
  toggleBarLock(barIndex: number): void;
  setSelectedRange(range: BarRange | null): void;
  setLoopRange(range: TickRange | BarRange | null): void;
  undo(): boolean;
  redo(): boolean;
  setPlaybackStatus(status: PlaybackStatus): void;
  setCurrentTick(tick: number): void;
  setUpdateTiming(updateTiming: UpdateTiming): void;
  commitDraft(): void;
  updateSettings(settings: GeneratorSettingsPatch): void;
  setSeed(seed: string | number): void;
  exportJson(): string;
  importJson(json: string): void;
  exportMidi(): Uint8Array;
  reset(settings?: GeneratorSettingsPatch): void;
}

export type ComposerStore = ComposerStoreState & ComposerStoreActions;

const HISTORY_LIMIT = 100;
const storage = getSafeStorage();
let historySerial = 0;

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function settingsWithPatch(
  current: GeneratorSettings,
  patch: GeneratorSettingsPatch = {},
): GeneratorSettings {
  return {
    ...current,
    ...patch,
    melody: {
      ...current.melody,
      ...patch.melody,
    },
  };
}

function noteName(midi: number): string {
  const pitches = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${pitches[midi % 12] ?? "C"}${Math.floor(midi / 12) - 1}`;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function normalizedBarRange(
  range: BarRange | null,
  composition: GeneratedComposition,
): BarRange | null {
  if (range === null) {
    return null;
  }
  const startBar = clampInteger(range.startBar, 0, composition.settings.bars - 1);
  const endBar = clampInteger(range.endBar, startBar + 1, composition.settings.bars);
  return { startBar, endBar };
}

function rangeToTicks(range: BarRange, composition: GeneratedComposition): TickRange {
  return {
    startTick: range.startBar * composition.ticksPerBar,
    endTick: range.endBar * composition.ticksPerBar,
  };
}

function normalizedTickRange(
  range: TickRange,
  composition: GeneratedComposition,
): TickRange {
  const startTick = clampInteger(range.startTick, 0, Math.max(0, composition.totalTicks - 1));
  const endTick = clampInteger(range.endTick, startTick + 1, composition.totalTicks);
  return { startTick, endTick };
}

function seedString(composition: GeneratedComposition): string {
  return String(composition.seed ?? composition.settings.seed);
}

function makeHistoryEntry(
  composition: GeneratedComposition,
  action: string,
  range: BarRange | null,
): HistoryEntry {
  historySerial += 1;
  return {
    id: `history-${Date.now()}-${historySerial}`,
    action,
    timestamp: new Date().toISOString(),
    seed: seedString(composition),
    range: range ? { ...range } : null,
    composition: clone(composition),
  };
}

function freshState(settingsPatch: GeneratorSettingsPatch = {}): ComposerStoreState {
  const settings = settingsWithPatch(clone(DEFAULT_GENERATOR_SETTINGS), settingsPatch);
  const composition = buildComposition(settings);
  const history = [makeHistoryEntry(composition, "generate", null)];
  return {
    settings: clone(composition.settings),
    committedComposition: clone(composition),
    draftComposition: clone(composition),
    previewVariations: [],
    selectedBarRange: null,
    loopRange: { startTick: 0, endTick: composition.totalTicks },
    lockedBars: [...composition.lockedBars],
    playback: {
      status: "stopped",
      currentTick: 0,
      updateTiming: "nextBar",
    },
    history,
    historyIndex: 0,
    regenerationIteration: 0,
    pendingCommit: false,
  };
}

function restoredState(snapshot: PersistedEditorSnapshot): ComposerStoreState {
  const composition = clone(snapshot.composition);
  const selectedBarRange = normalizedBarRange(snapshot.selectedBarRange, composition);
  const loopRange = normalizedTickRange(snapshot.loopRange, composition);
  const lockedBars = [...new Set(snapshot.lockedBars)]
    .filter((bar) => bar >= 0 && bar < composition.settings.bars)
    .sort((a, b) => a - b);
  composition.lockedBars = lockedBars;

  return {
    settings: clone(snapshot.settings),
    committedComposition: clone(composition),
    draftComposition: composition,
    previewVariations: [],
    selectedBarRange,
    loopRange,
    lockedBars,
    playback: {
      status: "stopped",
      currentTick: 0,
      updateTiming: snapshot.updateTiming,
    },
    history: clone(snapshot.history),
    historyIndex: snapshot.historyIndex,
    regenerationIteration: snapshot.regenerationIteration,
    pendingCommit: false,
  };
}

function crossesGrid(previous: number, current: number, gridSize: number): boolean {
  if (current < previous) {
    return true;
  }
  return Math.floor(previous / gridSize) !== Math.floor(current / gridSize);
}

function shouldApplyPending(
  state: ComposerStoreState,
  previousTick: number,
  currentTick: number,
): boolean {
  if (!state.pendingCommit) {
    return false;
  }

  switch (state.playback.updateTiming) {
    case "immediate":
      return true;
    case "nextBeat":
      return crossesGrid(previousTick, currentTick, state.draftComposition.ppq);
    case "nextBar":
      return crossesGrid(previousTick, currentTick, state.draftComposition.ticksPerBar);
    case "nextLoop":
      return (
        currentTick < previousTick ||
        (previousTick < state.loopRange.endTick && currentTick >= state.loopRange.endTick)
      );
  }
}

function persistentSnapshot(state: ComposerStoreState): PersistedEditorSnapshot {
  return {
    version: 1,
    settings: clone(state.settings),
    composition: clone(state.draftComposition),
    selectedBarRange: state.selectedBarRange ? { ...state.selectedBarRange } : null,
    loopRange: { ...state.loopRange },
    lockedBars: [...state.lockedBars],
    updateTiming: state.playback.updateTiming,
    history: clone(state.history),
    historyIndex: state.historyIndex,
    regenerationIteration: state.regenerationIteration,
  };
}

function stateAfterComposition(
  state: ComposerStoreState,
  composition: GeneratedComposition,
  action: string,
  range: BarRange | null,
  syncSettings = false,
): Partial<ComposerStoreState> {
  const next = clone(composition);
  const entry = makeHistoryEntry(next, action, range);
  const history = [...state.history.slice(0, state.historyIndex + 1), entry].slice(-HISTORY_LIMIT);
  const applyImmediately =
    state.playback.status !== "playing" || state.playback.updateTiming === "immediate";

  return {
    settings: syncSettings ? clone(next.settings) : state.settings,
    draftComposition: next,
    committedComposition: applyImmediately ? clone(next) : state.committedComposition,
    previewVariations: [],
    lockedBars: [...next.lockedBars],
    history,
    historyIndex: history.length - 1,
    pendingCommit: !applyImmediately,
  };
}

const hydrated = loadEditorSnapshot(storage);
const initialState = hydrated ? restoredState(hydrated) : freshState();

export const useComposerStore = create<ComposerStore>()((set, get) => ({
  ...initialState,

  generateComposition: (patch = {}) => {
    const state = get();
    const settings = settingsWithPatch(state.settings, patch);
    const composition = buildComposition(settings);
    const update = stateAfterComposition(state, composition, "generate", null, true);
    set({
      ...update,
      selectedBarRange: null,
      loopRange: { startTick: 0, endTick: composition.totalTicks },
      regenerationIteration: 0,
    });
  },

  regenerateSelected: (options = {}) => {
    const state = get();
    const range = normalizedBarRange(state.selectedBarRange, state.draftComposition);
    if (range === null) {
      return false;
    }

    const source = clone(state.draftComposition);
    source.lockedBars = [...state.lockedBars];
    const iteration = state.regenerationIteration + 1;
    const composition = regenerateRange(source, source.settings, range, {
      ...options,
      seedOffset: options.seedOffset ?? iteration,
      respectLocks: options.respectLocks ?? true,
    });
    set({
      ...stateAfterComposition(
        state,
        composition,
        `regenerate:${options.target ?? "all"}`,
        range,
      ),
      regenerationIteration: iteration,
    });
    return true;
  },

  editChord: (chordId, edit) => {
    const state = get();
    const index = state.draftComposition.chords.findIndex((chord) => chord.id === chordId);
    if (index < 0) {
      return false;
    }

    const composition = clone(state.draftComposition);
    const current = composition.chords[index]!;
    if (typeof edit === "string") {
      composition.chords[index] = replaceChordSymbol(
        current,
        edit,
        composition.settings.key,
        composition.settings.mode,
      );
    } else if (
      (edit.symbol !== undefined && edit.symbol !== current.symbol) ||
      (edit.inversion !== undefined && edit.inversion !== current.inversion)
    ) {
      const {
        symbol = current.symbol,
        inversion = current.inversion,
        ...changes
      } = edit;
      composition.chords[index] = {
        ...replaceChordSymbol(
          current,
          symbol,
          composition.settings.key,
          composition.settings.mode,
          inversion,
        ),
        ...changes,
        id: current.id,
      };
    } else {
      composition.chords[index] = { ...current, ...edit, id: current.id };
    }
    set(stateAfterComposition(state, composition, "edit-chord", {
      startBar: Math.floor(current.startTick / composition.ticksPerBar),
      endBar: Math.floor(current.startTick / composition.ticksPerBar) + 1,
    }));
    return true;
  },

  transposeNote: (noteId, semitones) => get().moveNote(noteId, { semitones }),

  moveNote: (noteId, move) => {
    const state = get();
    const index = state.draftComposition.notes.findIndex((note) => note.id === noteId);
    if (index < 0) {
      return false;
    }

    const composition = clone(state.draftComposition);
    const current = composition.notes[index]!;
    const midi = clampInteger(
      move.midi ?? current.midi + (move.semitones ?? 0),
      composition.settings.melody.minMidi,
      composition.settings.melody.maxMidi,
    );
    const startTick = clampInteger(
      move.startTick ?? current.startTick + (move.deltaTick ?? 0),
      0,
      Math.max(0, composition.totalTicks - 1),
    );
    const barIndex = Math.floor(startTick / composition.ticksPerBar);
    const durationTick = clampInteger(
      move.durationTick ?? current.durationTick,
      1,
      (barIndex + 1) * composition.ticksPerBar - startTick,
    );
    const nextNote: NoteEvent = {
      ...current,
      midi,
      noteName: noteName(midi),
      startTick,
      durationTick,
      barIndex,
    };
    composition.notes[index] = nextNote;
    set(stateAfterComposition(state, composition, "move-note", {
      startBar: Math.min(current.barIndex, nextNote.barIndex),
      endBar: Math.max(current.barIndex, nextNote.barIndex) + 1,
    }));
    return true;
  },

  deleteNote: (noteId) => {
    const state = get();
    const note = state.draftComposition.notes.find((item) => item.id === noteId);
    if (!note) {
      return false;
    }
    const composition = clone(state.draftComposition);
    composition.notes = composition.notes.filter((item) => item.id !== noteId);
    set(stateAfterComposition(state, composition, "delete-note", {
      startBar: note.barIndex,
      endBar: note.barIndex + 1,
    }));
    return true;
  },

  toggleBarLock: (barIndex) => {
    const state = get();
    if (!Number.isInteger(barIndex) || barIndex < 0 || barIndex >= state.settings.bars) {
      return;
    }
    const locks = new Set(state.lockedBars);
    if (locks.has(barIndex)) {
      locks.delete(barIndex);
    } else {
      locks.add(barIndex);
    }
    const composition = clone(state.draftComposition);
    composition.lockedBars = [...locks].sort((a, b) => a - b);
    set(stateAfterComposition(state, composition, "toggle-bar-lock", {
      startBar: barIndex,
      endBar: barIndex + 1,
    }));
  },

  setSelectedRange: (range) => {
    const state = get();
    const normalized = normalizedBarRange(range, state.draftComposition);
    set({
      selectedBarRange: normalized,
      loopRange: normalized
        ? rangeToTicks(normalized, state.draftComposition)
        : { startTick: 0, endTick: state.draftComposition.totalTicks },
    });
  },

  setLoopRange: (range) => {
    const state = get();
    if (range === null) {
      set({
        loopRange: state.selectedBarRange
          ? rangeToTicks(state.selectedBarRange, state.draftComposition)
          : { startTick: 0, endTick: state.draftComposition.totalTicks },
      });
      return;
    }
    const ticks = "startBar" in range ? rangeToTicks(range, state.draftComposition) : range;
    set({ loopRange: normalizedTickRange(ticks, state.draftComposition) });
  },

  undo: () => {
    const state = get();
    if (state.historyIndex <= 0) {
      return false;
    }
    const historyIndex = state.historyIndex - 1;
    const composition = clone(state.history[historyIndex]!.composition);
    const selectedBarRange = normalizedBarRange(state.selectedBarRange, composition);
    const applyImmediately =
      state.playback.status !== "playing" || state.playback.updateTiming === "immediate";
    set({
      settings: clone(composition.settings),
      draftComposition: composition,
      committedComposition: applyImmediately ? clone(composition) : state.committedComposition,
      lockedBars: [...composition.lockedBars],
      selectedBarRange,
      loopRange: normalizedTickRange(state.loopRange, composition),
      historyIndex,
      pendingCommit: !applyImmediately,
      previewVariations: [],
    });
    return true;
  },

  redo: () => {
    const state = get();
    if (state.historyIndex >= state.history.length - 1) {
      return false;
    }
    const historyIndex = state.historyIndex + 1;
    const composition = clone(state.history[historyIndex]!.composition);
    const selectedBarRange = normalizedBarRange(state.selectedBarRange, composition);
    const applyImmediately =
      state.playback.status !== "playing" || state.playback.updateTiming === "immediate";
    set({
      settings: clone(composition.settings),
      draftComposition: composition,
      committedComposition: applyImmediately ? clone(composition) : state.committedComposition,
      lockedBars: [...composition.lockedBars],
      selectedBarRange,
      loopRange: normalizedTickRange(state.loopRange, composition),
      historyIndex,
      pendingCommit: !applyImmediately,
      previewVariations: [],
    });
    return true;
  },

  setPlaybackStatus: (status) => {
    const state = get();
    const canCommit = status !== "playing" && state.pendingCommit;
    set({
      playback: {
        ...state.playback,
        status,
        currentTick: status === "stopped" ? 0 : state.playback.currentTick,
      },
      committedComposition: canCommit
        ? clone(state.draftComposition)
        : state.committedComposition,
      pendingCommit: canCommit ? false : state.pendingCommit,
    });
  },

  setCurrentTick: (tick) => {
    const state = get();
    const currentTick = Math.max(0, Math.round(tick));
    const apply = shouldApplyPending(state, state.playback.currentTick, currentTick);
    set({
      playback: { ...state.playback, currentTick },
      committedComposition: apply
        ? clone(state.draftComposition)
        : state.committedComposition,
      pendingCommit: apply ? false : state.pendingCommit,
    });
  },

  setUpdateTiming: (updateTiming) => {
    const state = get();
    const apply = updateTiming === "immediate" && state.pendingCommit;
    set({
      playback: { ...state.playback, updateTiming },
      committedComposition: apply
        ? clone(state.draftComposition)
        : state.committedComposition,
      pendingCommit: apply ? false : state.pendingCommit,
    });
  },

  commitDraft: () => {
    const state = get();
    if (!state.pendingCommit) {
      return;
    }
    set({ committedComposition: clone(state.draftComposition), pendingCommit: false });
  },

  updateSettings: (patch) => {
    const state = get();
    set({ settings: settingsWithPatch(state.settings, patch) });
  },

  setSeed: (seed) => {
    const state = get();
    set({ settings: settingsWithPatch(state.settings, { seed }), regenerationIteration: 0 });
  },

  exportJson: () => exportCompositionJson(get().draftComposition),
  importJson: (json) => {
    const state = get();
    const composition = importCompositionJson(json);
    set({
      ...stateAfterComposition(state, composition, "import-json", null, true),
      selectedBarRange: null,
      loopRange: { startTick: 0, endTick: composition.totalTicks },
      regenerationIteration: 0,
    });
  },
  exportMidi: () => exportCompositionMidi(get().draftComposition),

  reset: (patch = {}) => {
    clearEditorSnapshot(storage);
    set(freshState(patch));
  },
}));

useComposerStore.subscribe((state, previous) => {
  const changed =
    state.settings !== previous.settings ||
    state.draftComposition !== previous.draftComposition ||
    state.selectedBarRange !== previous.selectedBarRange ||
    state.loopRange !== previous.loopRange ||
    state.lockedBars !== previous.lockedBars ||
    state.playback.updateTiming !== previous.playback.updateTiming ||
    state.history !== previous.history ||
    state.historyIndex !== previous.historyIndex ||
    state.regenerationIteration !== previous.regenerationIteration;
  if (changed) {
    saveEditorSnapshot(persistentSnapshot(state), storage);
  }
});
