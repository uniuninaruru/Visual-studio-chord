import type {
  BarCount,
  CadenceType,
  ChordEvent,
  Mode,
  PitchClassName,
  StylePresetId,
  TimeSignature,
} from "../types/music";
import { createCadentialDominantChordEvent, createDiatonicChordEvent } from "./chords";
import { cadenceDegrees, cadenceDominantPosition } from "./harmonyFunctions";
import { createSeededRandom, deriveSeed, hashSeed, type Seed } from "./random";
import {
  progressionsForMode,
  resolveStylePreset,
  type ConcreteStylePresetId,
  type StylePreset,
} from "./styles";
import { ticksPerBar } from "./time";

export interface ProgressionGeneratorSettings {
  key: PitchClassName;
  mode: Mode;
  bars: BarCount;
  timeSignature: TimeSignature;
  style: StylePresetId;
  seed: Seed;
  ppq?: number;
}

export interface ProgressionResult {
  chords: ChordEvent[];
  degrees: number[];
  cadence: CadenceType;
  resolvedStyle: ConcreteStylePresetId;
}

const CADENCES: readonly CadenceType[] = [
  "authentic",
  "plagal",
  "half",
  "deceptive",
  "loop",
];

function chooseCadence(preset: StylePreset, seed: Seed): CadenceType {
  const random = createSeededRandom(deriveSeed(seed, "cadence", preset.id));
  return random.weightedPick(
    CADENCES,
    CADENCES.map((cadence) => preset.cadenceWeights[cadence]),
  );
}

function expandTemplate(template: readonly number[], bars: number): number[] {
  if (template.length === 0) throw new RangeError("Progression template cannot be empty.");
  return Array.from({ length: bars }, (_, index) => template[index % template.length] as number);
}

export function generateProgression(
  settings: ProgressionGeneratorSettings,
): ProgressionResult {
  const styleRandom = createSeededRandom(deriveSeed(settings.seed, "style"));
  const preset = resolveStylePreset(settings.style, styleRandom);
  const templateRandom = createSeededRandom(
    deriveSeed(settings.seed, "progression-template", preset.id, settings.mode),
  );
  const templates = progressionsForMode(preset, settings.mode);
  const template = templateRandom.pick(templates);
  const degrees = expandTemplate(template, settings.bars);
  const cadence = chooseCadence(preset, settings.seed);
  const ending = cadenceDegrees(cadence, settings.mode);
  degrees[degrees.length - 2] = ending[0];
  degrees[degrees.length - 1] = ending[1];

  if (cadence === "loop") degrees[0] = 1;

  // Bar carrying the cadence's functional dominant; it takes a raised leading
  // tone (a major V) even in minor, where the diatonic degree-5 triad is minor.
  const dominantPosition = cadenceDominantPosition(cadence);
  const dominantBarIndex =
    dominantPosition === "penultimate"
      ? degrees.length - 2
      : dominantPosition === "final"
        ? degrees.length - 1
        : null;

  const durationTick = ticksPerBar(settings.timeSignature, settings.ppq);
  const chords: ChordEvent[] = [];
  for (let barIndex = 0; barIndex < degrees.length; barIndex += 1) {
    const degree = degrees[barIndex] as number;
    const idHash = hashSeed(
      deriveSeed(settings.seed, "chord", preset.id, barIndex, degree),
    ).toString(36);
    const id = `chord-${barIndex}-${idHash}`;
    const previousNotes = chords[chords.length - 1]?.notes;
    chords.push(
      barIndex === dominantBarIndex
        ? createCadentialDominantChordEvent({
            key: settings.key,
            mode: settings.mode,
            startTick: barIndex * durationTick,
            durationTick,
            id,
            previousNotes,
          })
        : createDiatonicChordEvent({
            key: settings.key,
            mode: settings.mode,
            degree,
            startTick: barIndex * durationTick,
            durationTick,
            id,
            previousNotes,
          }),
    );
  }

  return {
    chords,
    degrees,
    cadence,
    resolvedStyle: preset.id,
  };
}

