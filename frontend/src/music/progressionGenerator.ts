import type {
  BarCount,
  CadenceType,
  ChordEvent,
  HarmonySettings,
  Mode,
  PitchClassName,
  StylePresetId,
  TimeSignature,
} from "../types/music";
import {
  canCreateHarmonyCandidate,
  createAdvancedChordEvent,
} from "./advancedHarmony";
import { cadenceDegrees } from "./harmonyFunctions";
import { createSeededRandom, deriveSeed, hashSeed, type Seed } from "./random";
import {
  progressionsForMode,
  resolveStylePreset,
  type ConcreteStylePresetId,
  type HarmonyCandidateKind,
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
  harmony?: HarmonySettings;
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

const SPECIAL_KINDS: readonly HarmonyCandidateKind[] = [
  "secondaryDominant",
  "borrowed",
  "tritoneSubstitution",
  "suspended",
  "addedTone",
];

function availableKinds(
  preset: StylePreset,
  settings: ProgressionGeneratorSettings,
  degree: number,
  targetDegree: number | undefined,
  protectedEnding: boolean,
): HarmonyCandidateKind[] {
  const complexity = settings.harmony?.complexity ?? "triads";
  const requested: readonly HarmonyCandidateKind[] = complexity === "triads"
    ? ["triad"]
    : complexity === "sevenths" || protectedEnding
      ? ["triad", "seventh"]
      : ["triad", "seventh", ...SPECIAL_KINDS];
  return requested.filter((kind) =>
    preset.harmonyWeights[kind] > 0 &&
    canCreateHarmonyCandidate(kind, settings.key, settings.mode, degree, targetDegree),
  );
}

function chooseChordKinds(
  settings: ProgressionGeneratorSettings,
  preset: StylePreset,
  degrees: readonly number[],
): HarmonyCandidateKind[] {
  const complexity = settings.harmony?.complexity ?? "triads";
  const kinds = degrees.map((degree, barIndex) => {
    const targetDegree = degrees[barIndex + 1];
    const protectedEnding = barIndex >= degrees.length - 2;
    const available = availableKinds(
      preset,
      settings,
      degree,
      targetDegree,
      protectedEnding,
    );
    const random = createSeededRandom(
      deriveSeed(settings.seed, "harmony-kind", preset.id, barIndex, degree),
    );
    return random.weightedPick(
      available,
      available.map((kind) => preset.harmonyWeights[kind]),
    );
  });

  const eligible = Array.from(
    { length: Math.max(1, degrees.length - 2) },
    (_, index) => index,
  );
  const forcedIndex = eligible[hashSeed(deriveSeed(settings.seed, "harmony-guarantee")) % eligible.length] as number;
  if (complexity === "sevenths" && !kinds.includes("seventh")) {
    kinds[forcedIndex] = "seventh";
  }
  if (complexity === "advanced" && !kinds.some((kind) => SPECIAL_KINDS.includes(kind))) {
    const degree = degrees[forcedIndex] as number;
    const targetDegree = degrees[forcedIndex + 1];
    const availableSpecial = SPECIAL_KINDS.filter((kind) =>
      preset.harmonyWeights[kind] > 0 &&
      canCreateHarmonyCandidate(kind, settings.key, settings.mode, degree, targetDegree),
    ).sort((left, right) =>
      preset.harmonyWeights[right] - preset.harmonyWeights[left] || left.localeCompare(right),
    );
    kinds[forcedIndex] = availableSpecial[0] ?? "seventh";
  }
  return kinds;
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

  const kinds = chooseChordKinds(settings, preset, degrees);

  const durationTick = ticksPerBar(settings.timeSignature, settings.ppq);
  const chords: ChordEvent[] = [];
  for (let barIndex = 0; barIndex < degrees.length; barIndex += 1) {
    const degree = degrees[barIndex] as number;
    const kind = kinds[barIndex] as HarmonyCandidateKind;
    const idHash = hashSeed(
      deriveSeed(settings.seed, "chord", preset.id, barIndex, degree, kind),
    ).toString(36);
    chords.push(
      createAdvancedChordEvent({
        kind,
        key: settings.key,
        mode: settings.mode,
        degree,
        targetDegree: degrees[barIndex + 1],
        startTick: barIndex * durationTick,
        durationTick,
        id: `chord-${barIndex}-${idHash}`,
        previousNotes: chords[chords.length - 1]?.notes,
        suspension: hashSeed(deriveSeed(settings.seed, "suspension", barIndex)) % 2 === 0
          ? 2
          : 4,
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
