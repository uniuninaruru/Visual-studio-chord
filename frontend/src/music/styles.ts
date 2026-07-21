import type {
  CadenceType,
  Mode,
  StylePresetId,
} from "../types/music";
import type { RandomSource } from "./random";

export type ConcreteStylePresetId = Exclude<StylePresetId, "random">;

export interface StylePreset {
  id: ConcreteStylePresetId;
  label: string;
  majorProgressions: readonly (readonly number[])[];
  minorProgressions: readonly (readonly number[])[];
  cadenceWeights: Readonly<Record<CadenceType, number>>;
  densityMultiplier: number;
  restMultiplier: number;
  syncopationBias: number;
  chordToneBias: number;
}

const cadenceWeights = (
  authentic: number,
  plagal: number,
  half: number,
  deceptive: number,
  loop: number,
): Readonly<Record<CadenceType, number>> => ({
  authentic,
  plagal,
  half,
  deceptive,
  loop,
});

export const STYLE_PRESETS: Readonly<Record<ConcreteStylePresetId, StylePreset>> = {
  pop: {
    id: "pop",
    label: "Pop",
    majorProgressions: [[1, 5, 6, 4], [1, 6, 4, 5], [6, 4, 1, 5]],
    minorProgressions: [[1, 6, 3, 7], [1, 4, 6, 5], [6, 7, 1, 1]],
    cadenceWeights: cadenceWeights(3, 1, 1, 1.5, 4),
    densityMultiplier: 1,
    restMultiplier: 1,
    syncopationBias: 0.05,
    chordToneBias: 0.04,
  },
  "j-pop": {
    id: "j-pop",
    label: "J-Pop",
    majorProgressions: [[4, 5, 3, 6], [1, 5, 6, 3, 4, 1, 4, 5], [6, 2, 5, 1]],
    minorProgressions: [[6, 7, 1, 3], [4, 7, 3, 6], [1, 4, 7, 3]],
    cadenceWeights: cadenceWeights(4, 1, 1.5, 2, 2.5),
    densityMultiplier: 1.16,
    restMultiplier: 0.8,
    syncopationBias: 0.12,
    chordToneBias: 0.02,
  },
  rock: {
    id: "rock",
    label: "Rock",
    majorProgressions: [[1, 4, 5, 4], [1, 5, 4, 1], [6, 4, 1, 5]],
    minorProgressions: [[1, 7, 6, 7], [1, 6, 3, 7], [1, 4, 1, 5]],
    cadenceWeights: cadenceWeights(2.5, 2, 1, 0.5, 4),
    densityMultiplier: 0.92,
    restMultiplier: 0.85,
    syncopationBias: 0.02,
    chordToneBias: 0.1,
  },
  jazz: {
    id: "jazz",
    label: "Jazz",
    majorProgressions: [[2, 5, 1, 6], [3, 6, 2, 5], [1, 6, 2, 5]],
    minorProgressions: [[2, 5, 1, 6], [1, 4, 7, 3], [6, 2, 5, 1]],
    cadenceWeights: cadenceWeights(5, 0.75, 2, 1, 1),
    densityMultiplier: 1.08,
    restMultiplier: 1.05,
    syncopationBias: 0.14,
    chordToneBias: -0.04,
  },
  "lo-fi": {
    id: "lo-fi",
    label: "Lo-fi",
    majorProgressions: [[1, 3, 4, 2], [6, 2, 5, 1], [4, 3, 2, 1]],
    minorProgressions: [[1, 6, 3, 7], [4, 7, 3, 6], [6, 4, 1, 5]],
    cadenceWeights: cadenceWeights(2, 2, 1.5, 1.5, 3),
    densityMultiplier: 0.72,
    restMultiplier: 1.2,
    syncopationBias: 0.08,
    chordToneBias: 0,
  },
  edm: {
    id: "edm",
    label: "EDM",
    majorProgressions: [[6, 4, 1, 5], [1, 5, 6, 4], [4, 1, 6, 5]],
    minorProgressions: [[1, 6, 3, 7], [1, 4, 6, 7], [6, 7, 1, 1]],
    cadenceWeights: cadenceWeights(1.5, 0.5, 0.5, 1, 6),
    densityMultiplier: 1.2,
    restMultiplier: 0.6,
    syncopationBias: 0.18,
    chordToneBias: 0.1,
  },
  ballad: {
    id: "ballad",
    label: "Ballad",
    majorProgressions: [[1, 3, 4, 5], [1, 6, 2, 5], [4, 5, 3, 6]],
    minorProgressions: [[1, 4, 6, 5], [1, 6, 3, 7], [4, 7, 3, 6]],
    cadenceWeights: cadenceWeights(5, 3, 0.75, 1, 1),
    densityMultiplier: 0.65,
    restMultiplier: 1.1,
    syncopationBias: -0.08,
    chordToneBias: 0.12,
  },
  "game-music": {
    id: "game-music",
    label: "Game Music",
    majorProgressions: [[1, 4, 2, 5], [1, 3, 6, 4], [6, 4, 2, 5]],
    minorProgressions: [[1, 6, 4, 5], [1, 3, 7, 4], [6, 7, 1, 5]],
    cadenceWeights: cadenceWeights(3, 1.5, 1.5, 1.5, 3),
    densityMultiplier: 1.04,
    restMultiplier: 0.9,
    syncopationBias: 0.1,
    chordToneBias: 0.02,
  },
};

export const CONCRETE_STYLE_IDS = Object.freeze(
  Object.keys(STYLE_PRESETS) as ConcreteStylePresetId[],
);

export function resolveStylePreset(
  style: StylePresetId,
  random: RandomSource,
): StylePreset {
  const resolved = style === "random" ? random.pick(CONCRETE_STYLE_IDS) : style;
  return STYLE_PRESETS[resolved];
}

export function progressionsForMode(
  preset: StylePreset,
  mode: Mode,
): readonly (readonly number[])[] {
  return mode === "major" ? preset.majorProgressions : preset.minorProgressions;
}

