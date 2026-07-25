import type {
  BarCount,
  CadenceType,
  ChordEvent,
  HarmonicRhythmSettings,
  HarmonySettings,
  Mode,
  PitchClassName,
  ProgressionStep,
  ProgressionTemplate,
  StylePresetId,
  TimeSignature,
} from "../types/music";
import {
  canCreateHarmonyCandidate,
  createAdvancedChordEvent,
} from "./advancedHarmony";
import {
  cadentialDominantRaisesLeadingTone,
  createCadentialDominantChordEvent,
  createStepChordEvent,
} from "./chords";
import { chordSlotsFor } from "./harmonicRhythm";
import { getProgressionTemplate } from "./progressions";
import { cadenceDegrees, cadenceDominantPosition } from "./harmonyFunctions";
import { createSeededRandom, deriveSeed, hashSeed, type Seed } from "./random";
import {
  progressionsForMode,
  resolveStylePreset,
  type ConcreteStylePresetId,
  type HarmonyCandidateKind,
  type StylePreset,
} from "./styles";

export interface ProgressionGeneratorSettings {
  key: PitchClassName;
  mode: Mode;
  bars: BarCount;
  timeSignature: TimeSignature;
  style: StylePresetId;
  seed: Seed;
  ppq?: number;
  harmony?: HarmonySettings;
  /** Chord change rate. Omitted means one chord per bar. */
  harmonicRhythm?: HarmonicRhythmSettings;
  /** Named progression to use instead of the seeded style pick. */
  progressionId?: string;
  /**
   * Number of bars to fill, when it differs from `bars`. Used to generate one
   * section of a longer piece; sections are rarely 4, 8 or 16 bars.
   */
  barCount?: number;
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

function harmonyKindWeight(
  preset: StylePreset,
  settings: ProgressionGeneratorSettings,
  kind: HarmonyCandidateKind,
): number {
  const baseWeight = preset.harmonyWeights[kind];
  if (!SPECIAL_KINDS.includes(kind)) return baseWeight;

  const explorationRate = settings.harmony?.explorationRate ?? 1;
  if (explorationRate === 0) return 0;
  if (kind === "borrowed") {
    return baseWeight * explorationRate * (settings.harmony?.borrowedChordRate ?? 1);
  }
  if (kind === "secondaryDominant") {
    return baseWeight * explorationRate * (settings.harmony?.secondaryDominantRate ?? 1);
  }
  return baseWeight * explorationRate;
}

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
    harmonyKindWeight(preset, settings, kind) > 0 &&
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
      available.map((kind) => harmonyKindWeight(preset, settings, kind)),
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
      harmonyKindWeight(preset, settings, kind) > 0 &&
      canCreateHarmonyCandidate(kind, settings.key, settings.mode, degree, targetDegree),
    ).sort((left, right) =>
      harmonyKindWeight(preset, settings, right)
        - harmonyKindWeight(preset, settings, left)
        || left.localeCompare(right),
    );
    kinds[forcedIndex] = availableSpecial[0] ?? "seventh";
  }
  return kinds;
}

/**
 * Builds a progression from an explicitly named template.
 *
 * Kept separate from the legacy degree pipeline because these templates can
 * carry pinned qualities, chromatic roots, colour tones and slash basses, none
 * of which the plain `number[]` path can represent.
 */
function generateNamedProgression(
  settings: ProgressionGeneratorSettings,
  template: ProgressionTemplate,
  preset: StylePreset,
): ProgressionResult {
  // Slots, not bars: harmonic rhythm decides how many chords each bar holds.
  const slots = chordSlotsFor(
    settings.barCount ?? settings.bars,
    settings.timeSignature,
    settings.harmonicRhythm,
    settings.ppq,
  );
  const steps = slots.map(
    (_, index) => template.steps[index % template.steps.length] as ProgressionStep,
  );

  const chords: ChordEvent[] = [];
  for (const [slotIndex, slot] of slots.entries()) {
    const step = steps[slotIndex] as ProgressionStep;
    const idHash = hashSeed(
      deriveSeed(settings.seed, "chord", template.id, slotIndex, step.degree),
    ).toString(36);
    chords.push(
      createStepChordEvent({
        key: settings.key,
        mode: settings.mode,
        step,
        startTick: slot.startTick,
        durationTick: slot.durationTick,
        id: `chord-${slotIndex}-${idHash}`,
        previousNotes: chords[chords.length - 1]?.notes,
        voiceLeadingStrength: settings.harmony?.voiceLeadingStrength ?? 1,
      }),
    );
  }

  const degrees = steps.map((step) => step.degree);
  // Label the cadence from what the template actually ends on, rather than
  // forcing one of the style's cadence weights onto a fixed progression.
  const last = degrees[degrees.length - 1];
  const penultimate = degrees[degrees.length - 2];
  const cadence: CadenceType = last === 1
    ? penultimate === 5
      ? "authentic"
      : penultimate === 4
        ? "plagal"
        : "loop"
    : last === 5
      ? "half"
      : penultimate === 5 && last === 6
        ? "deceptive"
        : "loop";

  return { chords, degrees, cadence, resolvedStyle: preset.id };
}

export function generateProgression(
  settings: ProgressionGeneratorSettings,
): ProgressionResult {
  const styleRandom = createSeededRandom(deriveSeed(settings.seed, "style"));
  const preset = resolveStylePreset(settings.style, styleRandom);

  if (settings.progressionId) {
    const template = getProgressionTemplate(settings.progressionId);
    if (!template) {
      throw new RangeError(`Unknown progression template: ${settings.progressionId}`);
    }
    if (!template.modes.includes(settings.mode)) {
      throw new RangeError(
        `Progression '${template.id}' does not support mode '${settings.mode}'.`,
      );
    }
    return generateNamedProgression(settings, template, preset);
  }
  const templateRandom = createSeededRandom(
    deriveSeed(settings.seed, "progression-template", preset.id, settings.mode),
  );
  const templates = progressionsForMode(preset, settings.mode);
  const template = templateRandom.pick(templates);
  // Chords are placed into harmonic-rhythm slots, so the progression is
  // expanded to the slot count rather than the bar count.
  const slots = chordSlotsFor(
    settings.barCount ?? settings.bars,
    settings.timeSignature,
    settings.harmonicRhythm,
    settings.ppq,
  );
  const degrees = expandTemplate(template, slots.length);
  const cadence = chooseCadence(preset, settings.seed);
  const ending = cadenceDegrees(cadence, settings.mode);
  degrees[degrees.length - 2] = ending[0];
  degrees[degrees.length - 1] = ending[1];

  if (cadence === "loop") degrees[0] = 1;

  const kinds = chooseChordKinds(settings, preset, degrees);

  // Bar carrying the cadence's functional dominant. In modes whose diatonic V is
  // minor (natural minor, dorian, mixolydian) this bar takes a raised leading
  // tone — a major V — so a labelled authentic/half/deceptive cadence is real.
  const dominantPosition = cadenceDominantPosition(cadence);
  const raiseCadentialDominant = cadentialDominantRaisesLeadingTone(settings.mode);
  const dominantSlotIndex =
    !raiseCadentialDominant || dominantPosition === null
      ? null
      : dominantPosition === "penultimate"
        ? degrees.length - 2
        : degrees.length - 1;

  const chords: ChordEvent[] = [];
  for (const [slotIndex, slot] of slots.entries()) {
    const degree = degrees[slotIndex] as number;
    const kind = kinds[slotIndex] as HarmonyCandidateKind;
    const idHash = hashSeed(
      deriveSeed(settings.seed, "chord", preset.id, slotIndex, degree, kind),
    ).toString(36);
    const id = `chord-${slotIndex}-${idHash}`;
    const previousNotes = chords[chords.length - 1]?.notes;
    chords.push(
      slotIndex === dominantSlotIndex
        ? createCadentialDominantChordEvent({
            key: settings.key,
            mode: settings.mode,
            startTick: slot.startTick,
            durationTick: slot.durationTick,
            id,
            previousNotes,
            voiceLeadingStrength: settings.harmony?.voiceLeadingStrength ?? 1,
          })
        : createAdvancedChordEvent({
            kind,
            key: settings.key,
            mode: settings.mode,
            degree,
            targetDegree: degrees[slotIndex + 1],
            startTick: slot.startTick,
            durationTick: slot.durationTick,
            id,
            previousNotes,
            voiceLeadingStrength: settings.harmony?.voiceLeadingStrength ?? 1,
            suspension: hashSeed(deriveSeed(settings.seed, "suspension", slotIndex)) % 2 === 0
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
