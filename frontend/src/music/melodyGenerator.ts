import {
  PPQ,
  type CadenceType,
  type ChordEvent,
  type GeneratorSettings,
  type NoteEvent,
  type NoteRole,
} from "../types/music";
import { createSeededRandom, deriveSeed, hashSeed, type Seed } from "./random";
import { generateRhythmBar, type RhythmSlot } from "./rhythmGenerator";
import {
  getScaleMidiNotes,
  midiToNoteName,
  pitchClassToSemitone,
} from "./scales";
import { STYLE_PRESETS, type ConcreteStylePresetId } from "./styles";
import { metricStrength, ticksPerBar } from "./time";

export interface MelodyGeneratorOptions {
  settings: GeneratorSettings;
  chords: readonly ChordEvent[];
  resolvedStyle: ConcreteStylePresetId;
  /** Cadence of the progression, used to shape the final phrase landing. */
  cadence?: CadenceType;
  /**
   * Bars per melodic phrase. Only the last note of a phrase boundary bar is
   * treated as a phrase end. Defaults to 4 (clamped to the piece length).
   */
  phraseLengthBars?: number;
  seed?: Seed;
  ppq?: number;
}

/**
 * `none` — an ordinary note. `intermediate` — the last note of an inner phrase,
 * pulled gently toward a chord tone. `final` — the closing note of the piece,
 * pulled strongly toward the cadence's target.
 */
type PhraseEndKind = "none" | "intermediate" | "final";

function normalizePhraseLength(value: number | undefined, totalBars: number): number {
  const fallback = Math.min(4, totalBars);
  if (value === undefined || !Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, totalBars);
}

interface MelodyState {
  previousMidi: number | null;
  previousDelta: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function activeChord(
  chords: readonly ChordEvent[],
  tick: number,
): ChordEvent | undefined {
  return chords.find(
    (chord) => tick >= chord.startTick && tick < chord.startTick + chord.durationTick,
  );
}

function pitchWeight(
  midi: number,
  state: MelodyState,
  chord: ChordEvent,
  metric: number,
  chordToneRate: number,
  leapProbability: number,
  phraseEndKind: PhraseEndKind,
  resolvesToTonic: boolean,
  tonicSemitone: number,
): number {
  const chordPitchClasses = new Set(chord.notes.map((note) => note % 12));
  const isChordTone = chordPitchClasses.has(midi % 12);
  const chordPreference = clamp01(chordToneRate + metric * 0.28);
  let weight = isChordTone ? 0.8 + chordPreference * 7 : 0.8 + (1 - chordPreference) * 2.2;

  if (state.previousMidi === null) {
    weight *= 1 / (1 + Math.abs(midi - 67) * 0.08);
  } else {
    const delta = midi - state.previousMidi;
    const distance = Math.abs(delta);
    if (distance === 0) weight *= 0.85;
    else if (distance <= 2) weight *= 6;
    else if (distance <= 4) weight *= 3.2;
    else if (distance <= 7) weight *= 1.2 + leapProbability;
    else weight *= 0.12 + leapProbability * 1.8;

    // A leap of a fifth or more is normally balanced in the opposite direction.
    if (Math.abs(state.previousDelta) >= 7 && delta !== 0) {
      weight *= Math.sign(delta) === Math.sign(state.previousDelta) ? 0.18 : 3.5;
    }
  }

  if (phraseEndKind !== "none") {
    // A phrase resolves onto a chord tone; the piece's final phrase does so more
    // decisively than the interior ones so inner phrases keep their momentum.
    if (isChordTone) weight *= phraseEndKind === "final" ? 4 : 2;
    // Only pull toward the tonic when the cadence actually lands there. Half and
    // deceptive cadences resolve onto the dominant/submediant instead, so the
    // chord-tone bias above already points the line at the right target.
    if (phraseEndKind === "final" && resolvesToTonic && midi % 12 === tonicSemitone) {
      weight *= 5;
    }
  }
  return Math.max(weight, 0.0001);
}

function noteRole(midi: number, chord: ChordEvent, previousMidi: number | null): NoteRole {
  if (chord.notes.some((note) => note % 12 === midi % 12)) return "chordTone";
  if (previousMidi !== null && Math.abs(previousMidi - midi) <= 2) return "passing";
  return "scaleTone";
}

function adjustedRhythmSettings(
  settings: GeneratorSettings,
  resolvedStyle: ConcreteStylePresetId,
): Pick<GeneratorSettings["melody"], "density" | "restRate" | "syncopation"> {
  const style = STYLE_PRESETS[resolvedStyle];
  return {
    density: clamp01(settings.melody.density * style.densityMultiplier),
    restRate: clamp01(settings.melody.restRate * style.restMultiplier),
    syncopation: clamp01(settings.melody.syncopation + style.syncopationBias),
  };
}

export interface MelodyBarResult {
  notes: NoteEvent[];
  rhythm: RhythmSlot[];
  finalState: MelodyState;
}

export function generateMelodyBar(
  options: MelodyGeneratorOptions,
  barIndex: number,
  initialState: MelodyState = { previousMidi: null, previousDelta: 0 },
): MelodyBarResult {
  const ppq = options.ppq ?? PPQ;
  const seed = options.seed ?? options.settings.seed;
  const barDuration = ticksPerBar(options.settings.timeSignature, ppq);
  const rhythmSettings = adjustedRhythmSettings(options.settings, options.resolvedStyle);
  const rhythm = generateRhythmBar({
    timeSignature: options.settings.timeSignature,
    ...rhythmSettings,
    seed,
    barIndex,
    ppq,
  });
  const candidates = getScaleMidiNotes(
    options.settings.key,
    options.settings.mode,
    options.settings.melody.minMidi,
    options.settings.melody.maxMidi,
  );
  if (candidates.length === 0) {
    throw new RangeError("Melody range does not contain a note from the selected scale.");
  }

  const style = STYLE_PRESETS[options.resolvedStyle];
  const random = createSeededRandom(deriveSeed(seed, "melody-pitch", barIndex));
  const state: MelodyState = { ...initialState };
  const notes: NoteEvent[] = [];
  const soundedSlots = rhythm.filter((slot) => !slot.isRest);

  // A phrase end is the last note of a phrase-boundary bar — not every bar end.
  const totalBars = options.settings.bars;
  const phraseLengthBars = normalizePhraseLength(options.phraseLengthBars, totalBars);
  const isFinalBar = barIndex === totalBars - 1;
  const isPhraseBoundaryBar = (barIndex + 1) % phraseLengthBars === 0 || isFinalBar;
  const resolvesToTonic =
    options.cadence === undefined ||
    options.cadence === "authentic" ||
    options.cadence === "plagal";
  const tonicSemitone = pitchClassToSemitone(options.settings.key);

  for (const [soundedIndex, slot] of soundedSlots.entries()) {
    const chord = activeChord(options.chords, slot.startTick);
    if (!chord) throw new Error(`No chord covers melody tick ${slot.startTick}.`);
    const localTick = slot.startTick - barIndex * barDuration;
    const metric = metricStrength(localTick, options.settings.timeSignature, ppq);
    const isLastSoundedNote = soundedIndex === soundedSlots.length - 1;
    const phraseEndKind: PhraseEndKind =
      isLastSoundedNote && isPhraseBoundaryBar
        ? isFinalBar
          ? "final"
          : "intermediate"
        : "none";
    const weights = candidates.map((midi) =>
      pitchWeight(
        midi,
        state,
        chord,
        metric,
        clamp01(options.settings.melody.chordToneRate + style.chordToneBias),
        clamp01(options.settings.melody.leapProbability),
        phraseEndKind,
        resolvesToTonic,
        tonicSemitone,
      ),
    );
    const midi = random.weightedPick(candidates, weights);
    const idHash = hashSeed(
      deriveSeed(seed, "note", barIndex, slot.startTick, slot.durationTick, midi),
    ).toString(36);
    notes.push({
      id: `note-${barIndex}-${soundedIndex}-${idHash}`,
      midi,
      noteName: midiToNoteName(midi),
      startTick: slot.startTick,
      durationTick: slot.durationTick,
      velocity: Math.round(options.settings.melody.velocity),
      barIndex,
      role: noteRole(midi, chord, state.previousMidi),
    });
    const delta = state.previousMidi === null ? 0 : midi - state.previousMidi;
    state.previousMidi = midi;
    state.previousDelta = delta;
  }

  return { notes, rhythm, finalState: state };
}

export function generateMelody(options: MelodyGeneratorOptions): NoteEvent[] {
  const notes: NoteEvent[] = [];
  let state: MelodyState = { previousMidi: null, previousDelta: 0 };
  for (let barIndex = 0; barIndex < options.settings.bars; barIndex += 1) {
    const result = generateMelodyBar(options, barIndex, state);
    notes.push(...result.notes);
    state = result.finalState;
  }
  return notes;
}

