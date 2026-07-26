import {
  PPQ,
  type CadenceType,
  type ChordEvent,
  type GeneratorSettings,
  type NoteEvent,
  type NoteRole,
  type RegenerationStrength,
  type SectionEvent,
} from "../types/music";
import { developMelodyWithMotif } from "./motifs";
import {
  skeletonNotesInBar,
  skeletonRegisterAt,
  type MelodicSkeletonNote,
} from "./melodicSkeleton";
import { euclideanRhythmBar } from "./euclideanRhythm";
import { applyGroove } from "./groove";
import { applyNonChordTones } from "./nonChordTones";
import { phraseForBar, type PhrasePlanEntry } from "./phrases";
import { sectionForBar } from "./sections";
import { createSeededRandom, deriveSeed, hashSeed, type Seed } from "./random";
import { generateRhythmBar, type RhythmSlot } from "./rhythmGenerator";
import {
  getMelodyScaleMidiNotes,
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
   * Bars per melodic phrase. Only the last note of a phrase-boundary bar is
   * treated as a phrase end. Defaults to 4 (clamped to the piece length).
   */
  phraseLengthBars?: number;
  /**
   * Song sections. Each supplies the key, mode and scale for its own bars, so
   * the melody follows a modulation and can run in its own mode or pentatonic.
   */
  sections?: readonly SectionEvent[];
  /**
   * Phrase plan. When present it replaces the fixed-length phrasing, so a
   * line is shaped by where it is in the phrase rather than by bar count.
   */
  phrases?: readonly PhrasePlanEntry[];
  /**
   * Structural notes planned ahead of the line. When present the note nearest
   * each one is pulled onto it, so the phrase reaches the pitches its shape
   * was designed around.
   */
  skeleton?: readonly MelodicSkeletonNote[];
  seed?: Seed;
  ppq?: number;
  strength?: RegenerationStrength;
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
  /** 0..1, how firmly the phrase this note ends is meant to close. */
  cadenceStrength: number,
  /** Structural pitch this slot is meant to land on, if it carries one. */
  skeletonTarget: MelodicSkeletonNote | null,
  /** Register the plan implies here, between structural notes. */
  skeletonRegister: number | null,
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
    // decisively than the interior ones, which keep their forward momentum.
    // Scaled by how much this particular phrase is meant to close, so a
    // fragmentation phrase drives on while a cadential one settles.
    const base = phraseEndKind === "final" ? 4 : 2;
    if (isChordTone) weight *= 1 + (base - 1) * cadenceStrength;
    // Only pull toward the tonic when the cadence actually lands there. Half and
    // deceptive cadences resolve onto the dominant/submediant instead, so the
    // chord-tone bias above already points the line at the right target.
    if (phraseEndKind === "final" && resolvesToTonic && midi % 12 === tonicSemitone) {
      weight *= 1 + 4 * cadenceStrength;
    }
  }

  if (skeletonTarget) {
    // Structural notes are the point of the phrase, so they outweigh the local
    // preferences above rather than competing with them. The same pitch class in
    // another octave still counts for something — it keeps the harmony intact
    // when the intended register is unreachable from the previous note.
    if (midi === skeletonTarget.targetMidi) weight *= 40;
    else if (midi % 12 === skeletonTarget.pitchClass) weight *= 5;
    else weight *= 0.3;
  } else if (skeletonRegister !== null) {
    // Between the structural notes, weigh each candidate by how far it sits from
    // the register the plan implies. Pinning the structural notes alone does not
    // shape a line — the free notes around them are still chosen locally, so the
    // arch never appears in the music.
    //
    // The coefficient was swept over 24 seeds. Raising it from 0.08 to 0.4 lifts
    // how closely the line tracks the plan (correlation 0.30 to 0.56) while chord
    // tones barely move (0.768 to 0.752) and stepwise motion actually improves
    // (0.348 to 0.401) — following a slow-moving target means smaller intervals.
    // 0.25 is the knee: the shape lands and nothing musical is given up.
    weight *= 1 / (1 + Math.abs(midi - skeletonRegister) * 0.25);
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
  // A Euclidean pattern replaces the partition wholesale rather than filtering
  // it: the point is the spacing between hits, and a rest rate applied on top
  // would take out exactly the hits that make the pattern recognisable.
  const euclidean = options.settings.euclideanRhythm;
  const rhythm = euclidean?.enabled
    ? euclideanRhythmBar({
        timeSignature: options.settings.timeSignature,
        settings: euclidean,
        barIndex,
        ppq,
      })
    : generateRhythmBar({
        timeSignature: options.settings.timeSignature,
        ...rhythmSettings,
        seed,
        barIndex,
        ppq,
      });
  // A section overrides the piece's key/mode for its own bars. `melodyMode`
  // lets the melody run in a different mode than the harmony (polytonality),
  // and `melodyScale` narrows it to a pentatonic.
  const section = sectionForBar(options.sections, barIndex);
  const barKey = section?.key ?? options.settings.key;
  const barMode = section?.melodyMode ?? section?.mode ?? options.settings.mode;
  const barScale = section?.melodyScale ?? "diatonic";

  let candidates = getMelodyScaleMidiNotes(
    barKey,
    barMode,
    options.settings.melody.minMidi,
    options.settings.melody.maxMidi,
    barScale,
  );
  if (candidates.length === 0 && barScale !== "diatonic") {
    // A narrow range can contain no pentatonic pitch even though it holds
    // several diatonic ones; widening to the parent scale keeps the bar
    // playable rather than aborting the whole piece.
    candidates = getMelodyScaleMidiNotes(
      barKey,
      barMode,
      options.settings.melody.minMidi,
      options.settings.melody.maxMidi,
      "diatonic",
    );
  }
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
  // A section boundary is a phrase boundary: the line should land before the
  // music moves to a new key or a new progression.
  const isSectionEnd = section !== undefined && barIndex === section.endBar - 1;
  const phrase = phraseForBar(options.phrases, barIndex);
  const isPhraseBoundaryBar = phrase
    ? barIndex === phrase.endBar - 1 || isFinalBar
    : (barIndex + 1) % phraseLengthBars === 0 || isFinalBar || isSectionEnd;
  // How firmly this phrase closes. Without a plan every boundary closed equally,
  // which is why an eight-bar line used to read as two interchangeable halves.
  const cadenceStrength = phrase?.cadenceStrength ?? 1;
  const resolvesToTonic =
    options.cadence === undefined ||
    options.cadence === "authentic" ||
    options.cadence === "plagal";
  const tonicSemitone = pitchClassToSemitone(barKey);

  // Bind each structural note to the sounded slot nearest its planned tick. The
  // plan plots points on a beat grid, but the rhythm may have nothing on that
  // beat; snapping to the nearest note means the shape survives a syncopated or
  // sparse bar instead of being silently dropped.
  const skeletonForSlot = new Map<number, MelodicSkeletonNote>();
  const skeletonDistance = new Map<number, number>();
  for (const structural of skeletonNotesInBar(options.skeleton, barIndex)) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [index, slot] of soundedSlots.entries()) {
      const distance = Math.abs(slot.startTick - structural.tick);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) continue;
    const claimed = skeletonDistance.get(bestIndex);
    if (claimed === undefined || bestDistance < claimed) {
      skeletonForSlot.set(bestIndex, structural);
      skeletonDistance.set(bestIndex, bestDistance);
    }
  }

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
        cadenceStrength,
        // A structural pitch outside the bar's scale — from a borrowed chord —
        // matches nothing here, which scales every candidate equally and leaves
        // the ordinary weighting untouched rather than distorting it.
        skeletonForSlot.get(soundedIndex) ?? null,
        skeletonRegisterAt(options.skeleton, slot.startTick),
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

/** The scale a bar runs in, honouring a section's own key, mode and scale. */
function scaleForBarOf(options: MelodyGeneratorOptions): (barIndex: number) => number[] {
  return (barIndex: number) => {
    const section = sectionForBar(options.sections, barIndex);
    const key = section?.key ?? options.settings.key;
    const mode = section?.melodyMode ?? section?.mode ?? options.settings.mode;
    const scale = section?.melodyScale ?? "diatonic";
    const { minMidi, maxMidi } = options.settings.melody;
    const pitches = getMelodyScaleMidiNotes(key, mode, minMidi, maxMidi, scale);
    return pitches.length > 0
      ? pitches
      : getMelodyScaleMidiNotes(key, mode, minMidi, maxMidi, "diatonic");
  };
}

export function generateMelody(options: MelodyGeneratorOptions): NoteEvent[] {
  const notes: NoteEvent[] = [];
  let state: MelodyState = { previousMidi: null, previousDelta: 0 };
  for (let barIndex = 0; barIndex < options.settings.bars; barIndex += 1) {
    const result = generateMelodyBar(options, barIndex, state);
    notes.push(...result.notes);
    state = result.finalState;
  }
  const seed = options.seed ?? options.settings.seed;
  const developed = developMelodyWithMotif(notes, {
    settings: options.settings,
    chords: options.chords,
    resolvedStyle: options.resolvedStyle,
    seed,
    ticksPerBar: ticksPerBar(options.settings.timeSignature, options.ppq ?? PPQ),
    strength: options.strength,
    sections: options.sections,
  });
  // Ornaments are surface detail, so they go on last — after the motif work has
  // decided what the line actually is. Decorating first would leave the motif
  // transposing and inverting figures whose whole meaning is where they resolve.
  const ornamented = applyNonChordTones(developed, {
    chords: options.chords,
    scaleForBar: scaleForBarOf(options),
    range: [options.settings.melody.minMidi, options.settings.melody.maxMidi],
    settings: options.settings.nonChordTones,
    seed,
  }).notes;
  // The groove goes on last of all. It is a performance of the notes rather than
  // a choice of them, and everything upstream reasons about where notes sit on
  // the grid — running it earlier would have the ornament pass reading positions
  // that are deliberately no longer true.
  return options.settings.groove
    ? applyGroove(ornamented, {
        timeSignature: options.settings.timeSignature,
        settings: options.settings.groove,
        ppq: options.ppq ?? PPQ,
      })
    : ornamented;
}
