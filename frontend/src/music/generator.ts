import {
  PPQ,
  type BarRange,
  type ChordEvent,
  type GeneratedComposition,
  type GeneratorSettings,
  type HarmonySettings,
  type MotifSettings,
  type NoteEvent,
  type RegenerationOptions,
} from "../types/music";
import { voiceChord } from "./chords";
import { generateMelody } from "./melodyGenerator";
import { generateProgression } from "./progressionGenerator";
import { deriveSeed, hashSeed, seedToString } from "./random";
import { midiToNoteName } from "./scales";
import { createBars, tickToBarIndex, ticksPerBar } from "./time";
import { assertValidGeneratorSettings } from "./validation";

export const DEFAULT_HARMONY_SETTINGS: Readonly<Required<HarmonySettings>> = Object.freeze({
  complexity: "triads",
  borrowedChordRate: 1,
  secondaryDominantRate: 1,
  explorationRate: 1,
  voiceLeadingStrength: 1,
});

export const DEFAULT_MOTIF_SETTINGS: Readonly<MotifSettings> = Object.freeze({
  enabled: false,
  lengthBars: 1,
  transformationRate: 0.65,
});

export const DEFAULT_GENERATOR_SETTINGS: Readonly<GeneratorSettings> = Object.freeze({
  key: "C",
  mode: "major",
  bpm: 120,
  timeSignature: "4/4",
  bars: 8,
  style: "pop",
  seed: "phase-1",
  melody: Object.freeze({
    minMidi: 60,
    maxMidi: 84,
    density: 0.52,
    velocity: 92,
    chordToneRate: 0.68,
    restRate: 0.14,
    syncopation: 0.18,
    leapProbability: 0.12,
  }),
  harmony: DEFAULT_HARMONY_SETTINGS,
  motif: DEFAULT_MOTIF_SETTINGS,
});

function copySettings(settings: GeneratorSettings): GeneratorSettings {
  return {
    ...settings,
    melody: { ...settings.melody },
    harmony: settings.harmony ? { ...settings.harmony } : undefined,
    motif: settings.motif ? { ...settings.motif } : undefined,
  };
}

function compositionFingerprint(settings: GeneratorSettings): string {
  const harmonyRates = [
    settings.harmony?.borrowedChordRate ?? DEFAULT_HARMONY_SETTINGS.borrowedChordRate,
    settings.harmony?.secondaryDominantRate ?? DEFAULT_HARMONY_SETTINGS.secondaryDominantRate,
    settings.harmony?.explorationRate ?? DEFAULT_HARMONY_SETTINGS.explorationRate,
    settings.harmony?.voiceLeadingStrength ?? DEFAULT_HARMONY_SETTINGS.voiceLeadingStrength,
  ];
  // Keep legacy/default composition IDs byte-for-byte stable. Non-default
  // controls still participate in the fingerprint and therefore create a
  // distinct project identity even if a particular seed happens to pick the
  // same musical material.
  const harmonyRateFingerprint = harmonyRates.every((value) => value === 1)
    ? []
    : ["harmony-controls", ...harmonyRates];
  return [
    settings.key,
    settings.mode,
    settings.bpm,
    settings.timeSignature,
    settings.bars,
    settings.style,
    seedToString(settings.seed),
    settings.melody.minMidi,
    settings.melody.maxMidi,
    settings.melody.density,
    settings.melody.velocity,
    settings.melody.chordToneRate,
    settings.melody.restRate,
    settings.melody.syncopation,
    settings.melody.leapProbability,
    settings.harmony?.complexity ?? DEFAULT_HARMONY_SETTINGS.complexity,
    ...harmonyRateFingerprint,
    settings.motif?.enabled ?? DEFAULT_MOTIF_SETTINGS.enabled,
    settings.motif?.lengthBars ?? DEFAULT_MOTIF_SETTINGS.lengthBars,
    settings.motif?.transformationRate ?? DEFAULT_MOTIF_SETTINGS.transformationRate,
  ].join("|");
}

export function generateComposition(settings: GeneratorSettings): GeneratedComposition {
  assertValidGeneratorSettings(settings);
  const copiedSettings = copySettings(settings);
  const progression = generateProgression({ ...copiedSettings, ppq: PPQ });
  const notes = generateMelody({
    settings: copiedSettings,
    chords: progression.chords,
    resolvedStyle: progression.resolvedStyle,
    ppq: PPQ,
  });
  const durationTick = ticksPerBar(copiedSettings.timeSignature, PPQ);
  const fingerprint = compositionFingerprint(copiedSettings);
  return {
    id: `composition-${hashSeed(fingerprint).toString(36)}`,
    version: 1,
    seed: seedToString(copiedSettings.seed),
    settings: copiedSettings,
    ppq: PPQ,
    ticksPerBar: durationTick,
    totalTicks: durationTick * copiedSettings.bars,
    timeSignature: copiedSettings.timeSignature,
    resolvedStyle: progression.resolvedStyle,
    cadence: progression.cadence,
    bars: createBars(copiedSettings.bars, copiedSettings.timeSignature, PPQ),
    chords: progression.chords,
    notes,
    lockedBars: [],
  };
}

function validateRange(composition: GeneratedComposition, range: BarRange): void {
  if (
    !Number.isInteger(range.startBar) ||
    !Number.isInteger(range.endBar) ||
    range.startBar < 0 ||
    range.endBar > composition.settings.bars ||
    range.startBar >= range.endBar
  ) {
    throw new RangeError(
      `Bar range must satisfy 0 <= startBar < endBar <= ${composition.settings.bars}.`,
    );
  }
}

function eventBar(chord: ChordEvent, durationTick: number): number {
  return tickToBarIndex(chord.startTick, durationTick);
}

function sortEvents<T extends { startTick: number; id: string }>(events: T[]): T[] {
  return events.sort((left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id));
}

function replaceChordBars(
  current: readonly ChordEvent[],
  candidate: readonly ChordEvent[],
  durationTick: number,
  shouldReplace: (barIndex: number) => boolean,
): ChordEvent[] {
  return sortEvents([
    ...current.filter((event) => !shouldReplace(eventBar(event, durationTick))),
    ...candidate.filter((event) => shouldReplace(eventBar(event, durationTick))),
  ]);
}

function replaceNoteBars(
  current: readonly NoteEvent[],
  candidate: readonly NoteEvent[],
  shouldReplace: (barIndex: number) => boolean,
): NoteEvent[] {
  return sortEvents([
    ...current.filter((event) => !shouldReplace(event.barIndex)),
    ...candidate.filter((event) => shouldReplace(event.barIndex)),
  ]);
}

function groupNotesByBar(notes: readonly NoteEvent[]): Map<number, NoteEvent[]> {
  const result = new Map<number, NoteEvent[]>();
  for (const note of notes) {
    const barNotes = result.get(note.barIndex) ?? [];
    barNotes.push(note);
    result.set(note.barIndex, barNotes);
  }
  for (const barNotes of result.values()) sortEvents(barNotes);
  return result;
}

function replacePitches(
  current: readonly NoteEvent[],
  candidate: readonly NoteEvent[],
  shouldReplace: (barIndex: number) => boolean,
): NoteEvent[] {
  const candidateBars = groupNotesByBar(candidate);
  const barPositions = new Map<number, number>();
  return sortEvents(
    current.map((note) => {
      if (!shouldReplace(note.barIndex)) return note;
      const choices = candidateBars.get(note.barIndex);
      if (!choices || choices.length === 0) return note;
      const position = barPositions.get(note.barIndex) ?? 0;
      barPositions.set(note.barIndex, position + 1);
      const source = choices[position % choices.length] as NoteEvent;
      return {
        ...note,
        midi: source.midi,
        noteName: source.noteName,
        role: source.role,
      };
    }),
  );
}

function replaceRhythm(
  current: readonly NoteEvent[],
  candidate: readonly NoteEvent[],
  shouldReplace: (barIndex: number) => boolean,
): NoteEvent[] {
  const currentBars = groupNotesByBar(current);
  const barPositions = new Map<number, number>();
  const mappedCandidate = candidate.map((note) => {
    const pitches = currentBars.get(note.barIndex);
    if (!pitches || pitches.length === 0) return note;
    const position = barPositions.get(note.barIndex) ?? 0;
    barPositions.set(note.barIndex, position + 1);
    const pitch = pitches[position % pitches.length] as NoteEvent;
    return {
      ...note,
      midi: pitch.midi,
      noteName: midiToNoteName(pitch.midi),
      role: pitch.role,
      velocity: pitch.velocity,
    };
  });
  return replaceNoteBars(current, mappedCandidate, shouldReplace);
}

function revoiceBars(
  chords: readonly ChordEvent[],
  shouldReplace: (barIndex: number) => boolean,
  durationTick: number,
  seedOffset: number,
  voiceLeadingStrength: number,
): ChordEvent[] {
  let previousNotes: readonly number[] | undefined;
  return chords.map((chord) => {
    const barIndex = eventBar(chord, durationTick);
    if (!shouldReplace(barIndex)) {
      previousNotes = chord.notes;
      return chord;
    }
    const inversionCount = chord.notes.length;
    const requestedInversion =
      ((chord.inversion + Math.abs(Math.trunc(seedOffset || 1))) % inversionCount + inversionCount) %
      inversionCount;
    const voicing = voiceChord(
      chord.root,
      chord.quality,
      previousNotes,
      requestedInversion,
      voiceLeadingStrength,
    );
    previousNotes = voicing.notes;
    return { ...chord, notes: voicing.notes, inversion: voicing.inversion };
  });
}

/**
 * Regenerates only [startBar, endBar). Events outside that interval and events
 * in locked bars retain their original object identity.
 */
export function regenerateRange(
  composition: GeneratedComposition,
  settings: GeneratorSettings,
  range: BarRange,
  options: RegenerationOptions = {},
): GeneratedComposition {
  validateRange(composition, range);
  assertValidGeneratorSettings(settings);
  if (
    settings.bars !== composition.settings.bars ||
    settings.timeSignature !== composition.timeSignature
  ) {
    throw new Error("Partial regeneration cannot change bar count or time signature.");
  }

  const target = options.target ?? "all";
  const seedOffset = options.seedOffset ?? 1;
  const strength = options.strength ?? "moderate";
  if (!["all", "chords", "melody", "pitch", "rhythm", "voicing"].includes(target)) {
    throw new RangeError("Unsupported regeneration target.");
  }
  if (!Number.isFinite(seedOffset)) {
    throw new RangeError("seedOffset must be finite.");
  }
  if (!["subtle", "moderate", "strong"].includes(strength)) {
    throw new RangeError("Unsupported regeneration strength.");
  }
  const respectLocks = options.respectLocks ?? true;
  const locked = new Set(respectLocks ? composition.lockedBars : []);
  const shouldReplace = (barIndex: number): boolean =>
    barIndex >= range.startBar && barIndex < range.endBar && !locked.has(barIndex);
  const hasReplaceableBar = Array.from(
    { length: composition.settings.bars },
    (_, barIndex) => barIndex,
  ).some(shouldReplace);
  if (!hasReplaceableBar) return composition;
  const replaceableBars = Array.from(
    { length: composition.settings.bars },
    (_, barIndex) => barIndex,
  ).filter(shouldReplace);
  const subtleAnchor = replaceableBars[
    hashSeed(deriveSeed(settings.seed, "subtle-anchor", seedOffset)) % replaceableBars.length
  ] as number;
  const shouldReplaceForStrength = (barIndex: number): boolean =>
    shouldReplace(barIndex) &&
    (strength !== "subtle" ||
      barIndex === subtleAnchor ||
      hashSeed(deriveSeed(settings.seed, "subtle-bar", seedOffset, barIndex)) % 3 === 0);
  const variationSeed = deriveSeed(settings.seed, "regenerate", strength, seedOffset);
  const variationSettings: GeneratorSettings = {
    ...copySettings(settings),
    seed: variationSeed,
  };

  let chords = composition.chords;
  let cadence = composition.cadence;
  let resolvedStyle = composition.resolvedStyle;

  if (target === "all" || target === "chords") {
    const progression = generateProgression({ ...variationSettings, ppq: composition.ppq });
    chords = replaceChordBars(
      composition.chords,
      progression.chords,
      composition.ticksPerBar,
      shouldReplaceForStrength,
    );
    const finalBar = composition.settings.bars - 1;
    if (shouldReplaceForStrength(finalBar - 1) && shouldReplaceForStrength(finalBar)) {
      cadence = progression.cadence;
    }
    const everyBarReplaced = Array.from(
      { length: composition.settings.bars },
      (_, barIndex) => barIndex,
    ).every(shouldReplaceForStrength);
    if (everyBarReplaced) {
      resolvedStyle = progression.resolvedStyle;
    }
  } else if (target === "voicing") {
    chords = revoiceBars(
      composition.chords,
      shouldReplaceForStrength,
      composition.ticksPerBar,
      seedOffset,
      settings.harmony?.voiceLeadingStrength ?? DEFAULT_HARMONY_SETTINGS.voiceLeadingStrength,
    );
  }

  let notes = composition.notes;
  if (target === "all" || target === "melody" || target === "pitch" || target === "rhythm") {
    const candidateNotes = generateMelody({
      settings: variationSettings,
      chords,
      resolvedStyle,
      seed: variationSeed,
      ppq: composition.ppq,
      strength,
    });
    if (target === "pitch" || (target === "all" && strength === "subtle")) {
      notes = replacePitches(composition.notes, candidateNotes, shouldReplaceForStrength);
    } else if (target === "rhythm") {
      notes = replaceRhythm(composition.notes, candidateNotes, shouldReplaceForStrength);
    } else {
      notes = replaceNoteBars(composition.notes, candidateNotes, shouldReplaceForStrength);
    }
  }

  const idSeed = deriveSeed(
    composition.id,
    variationSeed,
    range.startBar,
    range.endBar,
    target,
    strength,
  );
  return {
    ...composition,
    id: `composition-${hashSeed(idSeed).toString(36)}`,
    seed: variationSeed,
    settings: variationSettings,
    cadence,
    resolvedStyle,
    chords,
    notes,
    lockedBars: [...composition.lockedBars],
  };
}

export function setBarLocked(
  composition: GeneratedComposition,
  barIndex: number,
  locked: boolean,
): GeneratedComposition {
  if (!Number.isInteger(barIndex) || barIndex < 0 || barIndex >= composition.settings.bars) {
    throw new RangeError("Locked bar index is outside the composition.");
  }
  const locks = new Set(composition.lockedBars);
  if (locked) locks.add(barIndex);
  else locks.delete(barIndex);
  return { ...composition, lockedBars: [...locks].sort((left, right) => left - right) };
}
