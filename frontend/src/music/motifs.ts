import type {
  BarRange,
  ChordEvent,
  GeneratorSettings,
  MotifTransformation,
  NoteEvent,
  NoteRole,
  RegenerationStrength,
} from "../types/music";
import { createSeededRandom, deriveSeed, hashSeed, type Seed } from "./random";
import { getScaleMidiNotes, midiToNoteName } from "./scales";
import type { ConcreteStylePresetId } from "./styles";

export interface MotifNote {
  relativeStartTick: number;
  durationTick: number;
  midi: number;
  velocity: number;
  role: NoteRole;
}

export interface MelodyMotif {
  sourceRange: BarRange;
  lengthTicks: number;
  anchorMidi: number;
  notes: MotifNote[];
}

export interface MotifTransformOptions {
  /** Used by transposition and sequence. Defaults to 2. */
  semitones?: number;
  /** Used by rhythmic variation. Defaults to one eighth of a quarter note. */
  rhythmicShiftTicks?: number;
}

function sortMotifNotes(notes: MotifNote[]): MotifNote[] {
  return notes.sort(
    (left, right) =>
      left.relativeStartTick - right.relativeStartTick || left.midi - right.midi,
  );
}

export function extractMotif(
  notes: readonly NoteEvent[],
  sourceRange: BarRange,
  ticksPerBar: number,
): MelodyMotif {
  if (
    !Number.isInteger(sourceRange.startBar) ||
    !Number.isInteger(sourceRange.endBar) ||
    sourceRange.startBar < 0 ||
    sourceRange.endBar <= sourceRange.startBar ||
    !Number.isInteger(ticksPerBar) ||
    ticksPerBar <= 0
  ) {
    throw new RangeError("Motif source range and ticksPerBar must form a positive bar grid.");
  }
  const startTick = sourceRange.startBar * ticksPerBar;
  const endTick = sourceRange.endBar * ticksPerBar;
  const motifNotes = sortMotifNotes(
    notes
      .filter((note) => note.startTick >= startTick && note.startTick < endTick)
      .map((note) => ({
        relativeStartTick: note.startTick - startTick,
        durationTick: Math.min(note.durationTick, endTick - note.startTick),
        midi: note.midi,
        velocity: note.velocity,
        role: note.role,
      })),
  );
  return {
    sourceRange: { ...sourceRange },
    lengthTicks: endTick - startTick,
    anchorMidi: motifNotes[0]?.midi ?? 60,
    notes: motifNotes,
  };
}

function withoutOverlaps(notes: MotifNote[], lengthTicks: number): MotifNote[] {
  const sorted = sortMotifNotes(notes);
  const result: MotifNote[] = [];
  let cursor = 0;
  for (const note of sorted) {
    const start = Math.max(cursor, Math.max(0, Math.round(note.relativeStartTick)));
    if (start >= lengthTicks) continue;
    const duration = Math.min(
      Math.max(1, Math.round(note.durationTick)),
      lengthTicks - start,
    );
    result.push({ ...note, relativeStartTick: start, durationTick: duration });
    cursor = start + duration;
  }
  return result;
}

/** Pure, deterministic motif transformation independent of key and range. */
export function transformMotif(
  motif: MelodyMotif,
  transformation: MotifTransformation,
  options: MotifTransformOptions = {},
): MelodyMotif {
  const semitones = Math.trunc(options.semitones ?? 2);
  const shiftTicks = Math.trunc(options.rhythmicShiftTicks ?? 60);
  let notes = motif.notes.map((note) => ({ ...note }));

  switch (transformation) {
    case "repetition":
      break;
    case "transposition":
    case "sequence":
      notes = notes.map((note) => ({ ...note, midi: note.midi + semitones }));
      break;
    case "rhythmicVariation":
      notes = notes.map((note, index) => ({
        ...note,
        relativeStartTick: index % 2 === 1
          ? note.relativeStartTick + shiftTicks
          : note.relativeStartTick,
      }));
      break;
    case "inversion":
      notes = notes.map((note) => ({
        ...note,
        midi: motif.anchorMidi - (note.midi - motif.anchorMidi),
      }));
      break;
    case "fragmentation":
      notes = notes.slice(0, Math.max(1, Math.ceil(notes.length / 2)));
      break;
    case "augmentation":
      notes = notes.map((note) => ({
        ...note,
        durationTick: note.durationTick * 2,
      }));
      break;
  }

  return {
    ...motif,
    anchorMidi: transformation === "transposition" || transformation === "sequence"
      ? motif.anchorMidi + semitones
      : motif.anchorMidi,
    notes: withoutOverlaps(notes, motif.lengthTicks),
  };
}

const TRANSFORMATIONS: readonly MotifTransformation[] = [
  "repetition",
  "transposition",
  "rhythmicVariation",
  "inversion",
  "sequence",
  "fragmentation",
  "augmentation",
];

const STYLE_TRANSFORMATION_WEIGHTS: Readonly<
  Record<ConcreteStylePresetId, Readonly<Record<MotifTransformation, number>>>
> = {
  pop: { repetition: 5, transposition: 2, rhythmicVariation: 2, inversion: 0.5, sequence: 2, fragmentation: 1, augmentation: 0.5 },
  "j-pop": { repetition: 3, transposition: 3, rhythmicVariation: 3, inversion: 1, sequence: 4, fragmentation: 2, augmentation: 1 },
  rock: { repetition: 5, transposition: 2, rhythmicVariation: 1, inversion: 0.5, sequence: 2, fragmentation: 3, augmentation: 0.5 },
  jazz: { repetition: 1, transposition: 3, rhythmicVariation: 5, inversion: 2, sequence: 4, fragmentation: 3, augmentation: 1 },
  "lo-fi": { repetition: 4, transposition: 2, rhythmicVariation: 4, inversion: 1, sequence: 2, fragmentation: 2, augmentation: 2 },
  edm: { repetition: 6, transposition: 2, rhythmicVariation: 3, inversion: 1, sequence: 3, fragmentation: 3, augmentation: 0.5 },
  ballad: { repetition: 4, transposition: 2, rhythmicVariation: 1, inversion: 1, sequence: 2, fragmentation: 1, augmentation: 3 },
  "game-music": { repetition: 2, transposition: 3, rhythmicVariation: 2, inversion: 4, sequence: 5, fragmentation: 2, augmentation: 2 },
};

function transformationsForStrength(
  strength: RegenerationStrength,
): readonly MotifTransformation[] {
  if (strength === "subtle") return ["repetition", "transposition"];
  if (strength === "moderate") {
    return ["repetition", "transposition", "rhythmicVariation", "sequence"];
  }
  return TRANSFORMATIONS;
}

function activeChord(chords: readonly ChordEvent[], tick: number): ChordEvent | undefined {
  return chords.find(
    (chord) => tick >= chord.startTick && tick < chord.startTick + chord.durationTick,
  );
}

function nearestScaleMidi(midi: number, candidates: readonly number[]): number {
  return candidates.reduce((best, candidate) => {
    const distance = Math.abs(candidate - midi);
    const bestDistance = Math.abs(best - midi);
    return distance < bestDistance || (distance === bestDistance && candidate < best)
      ? candidate
      : best;
  });
}

function roleForMidi(midi: number, chord: ChordEvent | undefined): NoteRole {
  return chord?.notes.some((note) => note % 12 === midi % 12)
    ? "chordTone"
    : "scaleTone";
}

export interface MotifDevelopmentOptions {
  settings: GeneratorSettings;
  chords: readonly ChordEvent[];
  resolvedStyle: ConcreteStylePresetId;
  seed: Seed;
  ticksPerBar: number;
  strength?: RegenerationStrength;
}

/** Develops the opening one/two-bar idea across later phrases. */
export function developMelodyWithMotif(
  baseNotes: readonly NoteEvent[],
  options: MotifDevelopmentOptions,
): NoteEvent[] {
  const motifSettings = options.settings.motif;
  if (!motifSettings?.enabled) return [...baseNotes];

  const lengthBars = Math.min(motifSettings.lengthBars, options.settings.bars) as 1 | 2;
  const sourceRange = { startBar: 0, endBar: lengthBars };
  const motif = extractMotif(baseNotes, sourceRange, options.ticksPerBar);
  if (motif.notes.length === 0) return [...baseNotes];

  const strength = options.strength ?? "moderate";
  const strengthRate = strength === "subtle" ? 0.6 : strength === "strong" ? 1.25 : 1;
  const rate = Math.min(1, Math.max(0, motifSettings.transformationRate * strengthRate));
  const allowed = transformationsForStrength(strength);
  const scaleNotes = getScaleMidiNotes(
    options.settings.key,
    options.settings.mode,
    options.settings.melody.minMidi,
    options.settings.melody.maxMidi,
  );
  const result = [...baseNotes];

  for (let targetBar = lengthBars; targetBar < options.settings.bars; targetBar += lengthBars) {
    const random = createSeededRandom(deriveSeed(options.seed, "motif", targetBar, strength));
    if (!random.chance(rate)) continue;
    const weights = STYLE_TRANSFORMATION_WEIGHTS[options.resolvedStyle];
    const transformation = random.weightedPick(
      allowed,
      allowed.map((candidate) => weights[candidate]),
    );
    const sequenceStep = random.pick([-5, -2, 2, 5]);
    const transformed = transformMotif(motif, transformation, {
      semitones: transformation === "sequence"
        ? sequenceStep * Math.max(1, Math.floor(targetBar / lengthBars))
        : sequenceStep,
      rhythmicShiftTicks: Math.max(1, Math.round(options.ticksPerBar / 16)),
    });
    const targetStart = targetBar * options.ticksPerBar;
    const targetEnd = Math.min(
      options.settings.bars * options.ticksPerBar,
      targetStart + transformed.lengthTicks,
    );
    const replacement: NoteEvent[] = [];
    let previousEnd = targetStart;

    for (const [noteIndex, motifNote] of transformed.notes.entries()) {
      const rawStart = targetStart + motifNote.relativeStartTick;
      const startTick = Math.max(previousEnd, rawStart);
      if (startTick >= targetEnd) continue;
      const barIndex = Math.floor(startTick / options.ticksPerBar);
      const barEnd = (barIndex + 1) * options.ticksPerBar;
      const durationTick = Math.min(
        motifNote.durationTick,
        barEnd - startTick,
        targetEnd - startTick,
      );
      if (durationTick <= 0) continue;
      const midi = nearestScaleMidi(motifNote.midi, scaleNotes);
      const chord = activeChord(options.chords, startTick);
      const idHash = hashSeed(
        deriveSeed(options.seed, "motif-note", targetBar, transformation, noteIndex, midi),
      ).toString(36);
      replacement.push({
        id: `note-${barIndex}-motif-${noteIndex}-${idHash}`,
        midi,
        noteName: midiToNoteName(midi),
        startTick,
        durationTick,
        velocity: motifNote.velocity,
        barIndex,
        role: roleForMidi(midi, chord),
      });
      previousEnd = startTick + durationTick;
    }

    if (replacement.length > 0) {
      for (let index = result.length - 1; index >= 0; index -= 1) {
        const note = result[index] as NoteEvent;
        if (note.startTick >= targetStart && note.startTick < targetEnd) result.splice(index, 1);
      }
      result.push(...replacement);
    }
  }

  return result.sort(
    (left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id),
  );
}
