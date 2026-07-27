import type {
  CanonicalPitchClass,
  Mode,
  PitchClassName,
} from "../types/music";
import {
  createAdvancedChordEvent,
} from "./advancedHarmony";
import { fixedCardinalityVoiceLeadingDistance } from "./neoRiemannian";
import { deriveSeed, hashSeed, type Seed } from "./random";
import type {
  HarmonyCandidateKind,
} from "./styles";

const CHROMATIC_KINDS = new Set<HarmonyCandidateKind>([
  "secondaryDominant",
  "borrowed",
  "tritoneSubstitution",
]);

const SPECIAL_KINDS = new Set<HarmonyCandidateKind>([
  ...CHROMATIC_KINDS,
  "suspended",
  "addedTone",
]);

export interface AdvancedProgressionPlanOptions {
  key: PitchClassName;
  mode: Mode;
  degrees: readonly number[];
  candidates: readonly (readonly HarmonyCandidateKind[])[];
  /** Existing style policy. Values are converted to ordinal ranks, not costs. */
  preference: Readonly<Record<HarmonyCandidateKind, number>>;
  seed: Seed;
  requireSeventh?: boolean;
  requireSpecial?: boolean;
  /** Seed-selected colour family that must occur at least once when available. */
  requireKind?: HarmonyCandidateKind;
}

interface PlannerScore {
  commonToneLoss: number;
  comparableVoiceLeadingDistance: number;
  preferenceRank: number;
  immediateKindRepetitions: number;
  tieBreak: number;
}

interface PlannerCell {
  kinds: HarmonyCandidateKind[];
  score: PlannerScore;
  pitchClasses: number[];
  chromaticRun: number;
  hasSeventh: boolean;
  hasSpecial: boolean;
}

function compareScore(left: PlannerScore, right: PlannerScore): number {
  return left.commonToneLoss - right.commonToneLoss
    || left.comparableVoiceLeadingDistance - right.comparableVoiceLeadingDistance
    || left.preferenceRank - right.preferenceRank
    || left.immediateKindRepetitions - right.immediateKindRepetitions
    || left.tieBreak - right.tieBreak;
}

function preferenceRanks(
  preference: Readonly<Record<HarmonyCandidateKind, number>>,
): Readonly<Record<HarmonyCandidateKind, number>> {
  const kinds = Object.keys(preference) as HarmonyCandidateKind[];
  const distinct = [...new Set(kinds.map((kind) => preference[kind]))]
    .sort((left, right) => right - left);
  return Object.fromEntries(
    kinds.map((kind) => [kind, distinct.indexOf(preference[kind])]),
  ) as Readonly<Record<HarmonyCandidateKind, number>>;
}

function chordShapeFor(
  options: AdvancedProgressionPlanOptions,
  index: number,
  kind: HarmonyCandidateKind,
): { pitchClasses: number[]; root: CanonicalPitchClass } {
  const event = createAdvancedChordEvent({
    kind,
    key: options.key,
    mode: options.mode,
    degree: options.degrees[index] as number,
    targetDegree: options.degrees[index + 1],
    startTick: index,
    durationTick: 1,
    id: `planner-${index}-${kind}`,
    suspension: hashSeed(deriveSeed(options.seed, "planner-suspension", index)) % 2 === 0
      ? 2
      : 4,
  });
  return {
    pitchClasses: [...new Set(event.notes.map((note) => ((note % 12) + 12) % 12))]
      .sort((left, right) => left - right),
    root: event.root,
  };
}

function transitionFacts(
  from: readonly number[],
  to: readonly number[],
): Pick<PlannerScore, "commonToneLoss" | "comparableVoiceLeadingDistance"> {
  const toSet = new Set(to);
  const commonTones = from.filter((pitchClass) => toSet.has(pitchClass)).length;
  let comparableVoiceLeadingDistance = 0;
  if (from.length === to.length) {
    comparableVoiceLeadingDistance = fixedCardinalityVoiceLeadingDistance(from, to);
  }
  return {
    commonToneLoss: Math.min(from.length, to.length) - commonTones,
    comparableVoiceLeadingDistance,
  };
}

function stateKey(cell: PlannerCell): string {
  return [
    cell.kinds.at(-1),
    cell.chromaticRun,
    cell.hasSeventh ? 1 : 0,
    cell.hasSpecial ? 1 : 0,
  ].join(":");
}

/**
 * Selects chord kinds across the complete span.
 *
 * The degree/function path has already been solved. This pass enforces the
 * chromatic-resolution boundary, then compares integer common-tone retention,
 * fixed-cardinality voice-leading distance, and finally ordinal style policy.
 */
export function planAdvancedProgressionKinds(
  options: AdvancedProgressionPlanOptions,
): HarmonyCandidateKind[] {
  if (options.degrees.length !== options.candidates.length) {
    throw new RangeError("Every progression degree needs a candidate list.");
  }
  if (options.degrees.length === 0) return [];
  if (options.candidates.some((candidates) => candidates.length === 0)) {
    throw new Error("Every progression position needs at least one harmony candidate.");
  }

  const ranks = preferenceRanks(options.preference);
  let row: PlannerCell[] = options.candidates[0]!.map((kind) => {
    const chromatic = CHROMATIC_KINDS.has(kind);
    const shape = chordShapeFor(options, 0, kind);
    return {
      kinds: [kind],
      score: {
        commonToneLoss: 0,
        comparableVoiceLeadingDistance: 0,
        preferenceRank: ranks[kind],
        immediateKindRepetitions: 0,
        tieBreak: hashSeed(deriveSeed(options.seed, "planner-tie", 0, kind)) % 997,
      },
      pitchClasses: shape.pitchClasses,
      chromaticRun: chromatic ? 1 : 0,
      hasSeventh: kind === "seventh",
      hasSpecial: SPECIAL_KINDS.has(kind),
    };
  });

  for (let index = 1; index < options.degrees.length; index += 1) {
    const nextByState = new Map<string, PlannerCell>();
    for (const previous of row) {
      for (const kind of options.candidates[index] as readonly HarmonyCandidateKind[]) {
        const chromaticRun = CHROMATIC_KINDS.has(kind)
          ? previous.chromaticRun + 1
          : 0;
        if (chromaticRun > 2) continue;

        const shape = chordShapeFor(options, index, kind);
        const previousKind = previous.kinds.at(-1);
        if (
          (previousKind === "secondaryDominant" || previousKind === "tritoneSubstitution")
          && shape.root !== createAdvancedChordEvent({
            kind: "triad",
            key: options.key,
            mode: options.mode,
            degree: options.degrees[index] as number,
            startTick: index,
            durationTick: 1,
            id: `planner-target-${index}`,
          }).root
        ) {
          continue;
        }
        const pitchClasses = shape.pitchClasses;
        const transition = transitionFacts(previous.pitchClasses, pitchClasses);
        const next: PlannerCell = {
          kinds: [...previous.kinds, kind],
          score: {
            commonToneLoss: previous.score.commonToneLoss + transition.commonToneLoss,
            comparableVoiceLeadingDistance:
              previous.score.comparableVoiceLeadingDistance
              + transition.comparableVoiceLeadingDistance,
            preferenceRank: previous.score.preferenceRank + ranks[kind],
            immediateKindRepetitions:
              previous.score.immediateKindRepetitions
              + (previous.kinds.at(-1) === kind ? 1 : 0),
            tieBreak:
              previous.score.tieBreak
              + (hashSeed(deriveSeed(options.seed, "planner-tie", index, kind)) % 997),
          },
          pitchClasses,
          chromaticRun,
          hasSeventh: previous.hasSeventh || kind === "seventh",
          hasSpecial: previous.hasSpecial || SPECIAL_KINDS.has(kind),
        };
        const key = stateKey(next);
        const incumbent = nextByState.get(key);
        if (!incumbent || compareScore(next.score, incumbent.score) < 0) {
          nextByState.set(key, next);
        }
      }
    }
    row = [...nextByState.values()];
  }

  const eligible = row.filter(
    (cell) =>
      (!options.requireSeventh || cell.hasSeventh)
      && (!options.requireSpecial || cell.hasSpecial)
      && (!options.requireKind || cell.kinds.includes(options.requireKind)),
  );
  const pool = eligible.length > 0 ? eligible : row;
  const winner = pool.reduce((best, cell) =>
    compareScore(cell.score, best.score) < 0 ? cell : best,
  );
  return winner.kinds;
}
