import type {
  CadenceType,
  Mode,
  ProgressionStep,
} from "../types/music";
import { diatonicQualityForDegree } from "./chords";
import { deriveSeed, hashSeed, type Seed } from "./random";

/**
 * Functional harmony as a state machine.
 *
 * Progressions were chosen as sequences of scale degrees, which makes each chord
 * locally plausible but gives the span no direction: nothing distinguishes a
 * progression that is heading somewhere from one that is merely wandering
 * through legal chords.
 *
 * Modelling harmony as movement between *functions* fixes that. Tonic leaves
 * home, predominant prepares, dominant creates the need to resolve, and
 * resolution answers it. The route from the opening function to the cadence is
 * searched rather than sampled, so the whole span points at its ending.
 */

export type FunctionalHarmonyState =
  | "tonic"
  | "tonicProlongation"
  | "predominant"
  | "dominantPreparation"
  | "dominant"
  | "resolution"
  | "modal"
  | "chromaticSequence";

/** Which states may follow each state, and what that move costs. */
const TRANSITIONS: Readonly<
  Record<FunctionalHarmonyState, Readonly<Partial<Record<FunctionalHarmonyState, number>>>>
> = {
  tonic: {
    tonicProlongation: 0.2,
    predominant: 0.3,
    dominantPreparation: 0.6,
    dominant: 0.5,
    modal: 0.8,
    chromaticSequence: 1.1,
  },
  tonicProlongation: {
    tonicProlongation: 0.5,
    // Settling back onto the tonic proper — how a loop closes without a cadence.
    tonic: 0.3,
    predominant: 0.2,
    dominantPreparation: 0.5,
    dominant: 0.5,
    modal: 0.8,
  },
  predominant: {
    predominant: 0.55,
    dominantPreparation: 0.25,
    dominant: 0.15,
    // IV→I: the plagal move. Legal, but it resolves without the dominant's
    // tension, so it costs more than going through the dominant.
    resolution: 0.5,
    modal: 0.9,
    chromaticSequence: 1.0,
  },
  dominantPreparation: {
    // A preparation exists to reach the dominant; anything else wastes it.
    dominant: 0.1,
    predominant: 0.8,
    chromaticSequence: 1.0,
  },
  dominant: {
    resolution: 0.1,
    // Repeating the dominant prolongs tension, which is usable but not free.
    dominant: 0.6,
    // Going back to a predominant undoes the tension just built.
    predominant: 1.2,
  },
  resolution: {
    tonic: 0.2,
    tonicProlongation: 0.3,
    predominant: 0.4,
    modal: 0.9,
    chromaticSequence: 1.1,
  },
  modal: {
    modal: 0.6,
    tonic: 0.4,
    predominant: 0.5,
    dominant: 0.6,
    resolution: 0.7,
  },
  chromaticSequence: {
    chromaticSequence: 0.5,
    dominant: 0.4,
    predominant: 0.6,
    tonic: 0.7,
  },
};

/** How much tension each state carries, 0..1. Used to shape the span's arc. */
const TENSION: Readonly<Record<FunctionalHarmonyState, number>> = {
  tonic: 0,
  tonicProlongation: 0.15,
  predominant: 0.45,
  dominantPreparation: 0.65,
  dominant: 0.9,
  resolution: 0.1,
  modal: 0.4,
  chromaticSequence: 0.75,
};

/**
 * Scale degrees that can carry each function, with the cost of using them.
 *
 * Lower is more idiomatic. Degrees appear under several functions because a
 * chord's function depends on where it sits, not only on what it is: vi is a
 * tonic substitute after V and a predominant approaching ii.
 */
const DEGREES_FOR_STATE: Readonly<
  Record<FunctionalHarmonyState, ReadonlyArray<readonly [number, number]>>
> = {
  tonic: [[1, 0], [6, 0.5], [3, 0.7]],
  tonicProlongation: [[1, 0.2], [3, 0.4], [6, 0.3]],
  predominant: [[4, 0], [2, 0.1], [6, 0.5]],
  dominantPreparation: [[2, 0.1], [4, 0.2], [6, 0.6]],
  dominant: [[5, 0], [7, 0.4]],
  resolution: [[1, 0], [6, 0.6]],
  modal: [[7, 0.2], [4, 0.4], [3, 0.5], [6, 0.5]],
  chromaticSequence: [[5, 0.3], [2, 0.4], [6, 0.5], [3, 0.6]],
};

export interface FunctionalChordCandidate {
  step: ProgressionStep;
  function: FunctionalHarmonyState;
  transitionCost: number;
  tensionLevel: number;
  expectedNextFunctions: FunctionalHarmonyState[];
}

/** States a cadence needs to pass through at the end of a span. */
function cadenceStates(cadence: CadenceType): FunctionalHarmonyState[] {
  switch (cadence) {
    case "authentic":
      return ["dominant", "resolution"];
    case "half":
      return ["predominant", "dominant"];
    case "deceptive":
      // V→vi: a dominant that resolves somewhere other than home.
      return ["dominant", "resolution"];
    case "plagal":
      return ["predominant", "resolution"];
    case "loop":
      return ["tonicProlongation", "tonic"];
  }
}

export function transitionCost(
  from: FunctionalHarmonyState,
  to: FunctionalHarmonyState,
): number | null {
  return TRANSITIONS[from][to] ?? null;
}

export function tensionOf(state: FunctionalHarmonyState): number {
  return TENSION[state];
}

export function nextFunctionsFor(
  state: FunctionalHarmonyState,
): FunctionalHarmonyState[] {
  return (Object.keys(TRANSITIONS[state]) as FunctionalHarmonyState[]).sort(
    (left, right) =>
      (TRANSITIONS[state][left] as number) - (TRANSITIONS[state][right] as number),
  );
}

export interface FunctionalPathOptions {
  /** Number of chords to place. */
  length: number;
  cadence: CadenceType;
  /** Where the span starts. Defaults to tonic. */
  startState?: FunctionalHarmonyState;
  /**
   * 0..1. Higher lets the path wander through costlier, more colourful states
   * instead of taking the cheapest route.
   */
  exploration?: number;
  seed: Seed;
}

/**
 * Finds the sequence of functions for a span.
 *
 * This is a shortest-path problem over a small graph, so it is solved exactly by
 * dynamic programming rather than sampled: the cadence is pinned at the end and
 * the route to it is the cheapest one that also matches the requested tension
 * shape. Exact search is what stops a late dominant from being stranded with no
 * way home.
 */
export function planFunctionalPath(
  options: FunctionalPathOptions,
): FunctionalHarmonyState[] {
  const { length, cadence, seed } = options;
  const exploration = Math.min(1, Math.max(0, options.exploration ?? 0));
  const tail = cadenceStates(cadence);
  const start = options.startState ?? "tonic";

  if (length <= 0) return [];
  if (length <= tail.length) return tail.slice(tail.length - length);

  const freeLength = length - tail.length;
  const states = Object.keys(TRANSITIONS) as FunctionalHarmonyState[];

  // Tension is expected to rise across the span; a state far from the expected
  // level at its position is penalised, which is what gives the path an arc
  // rather than letting it idle on tonic until the cadence.
  const positionPenalty = (state: FunctionalHarmonyState, index: number): number => {
    const progress = freeLength <= 1 ? 0 : index / (freeLength - 1);
    const expected = 0.1 + progress * 0.5;
    return Math.abs(TENSION[state] - expected) * 0.8;
  };

  // A deterministic per-state nudge, so two spans with the same shape but
  // different seeds do not always pick the identical route.
  const jitter = (state: FunctionalHarmonyState, index: number): number =>
    exploration === 0
      ? 0
      : ((hashSeed(deriveSeed(seed, "harmony-path", index, state)) % 100) / 100) *
        exploration *
        0.9;

  type Cell = { cost: number; previous: FunctionalHarmonyState | null };
  let previousRow = new Map<FunctionalHarmonyState, Cell>();
  previousRow.set(start, { cost: 0, previous: null });

  const rows: Array<Map<FunctionalHarmonyState, Cell>> = [previousRow];
  for (let index = 1; index < freeLength; index += 1) {
    const row = new Map<FunctionalHarmonyState, Cell>();
    for (const to of states) {
      let best: Cell | null = null;
      for (const [from, cell] of previousRow) {
        const move = transitionCost(from, to);
        if (move === null) continue;
        const cost = cell.cost + move + positionPenalty(to, index) + jitter(to, index);
        if (!best || cost < best.cost) best = { cost, previous: from };
      }
      if (best) row.set(to, best);
    }
    rows.push(row);
    previousRow = row;
  }

  // Close onto the cadence: the last free state must be able to reach it.
  const firstTail = tail[0] as FunctionalHarmonyState;
  let endState: FunctionalHarmonyState | null = null;
  let endCost = Number.POSITIVE_INFINITY;
  for (const [state, cell] of previousRow) {
    const move = transitionCost(state, firstTail);
    if (move === null) continue;
    const cost = cell.cost + move;
    if (cost < endCost) {
      endCost = cost;
      endState = state;
    }
  }
  // Nothing could reach the cadence, so fall back to a plain approach rather
  // than emitting a path that does not connect.
  if (!endState) {
    return [
      ...Array.from({ length: freeLength }, () => "tonicProlongation" as const),
      ...tail,
    ];
  }

  const free: FunctionalHarmonyState[] = [];
  let cursor: FunctionalHarmonyState | null = endState;
  for (let index = rows.length - 1; index >= 0 && cursor; index -= 1) {
    free.unshift(cursor);
    cursor = rows[index]!.get(cursor)?.previous ?? null;
  }
  return [...free, ...tail];
}

/**
 * Assigns a concrete chord to each function in a path.
 *
 * Degrees are scored by how idiomatic they are for the function and penalised
 * for repeating the previous chord, so a prolongation moves between tonic
 * substitutes instead of restating one chord.
 */
export function assignChordsToPath(
  path: readonly FunctionalHarmonyState[],
  mode: Mode,
  seed: Seed,
): FunctionalChordCandidate[] {
  const candidates: FunctionalChordCandidate[] = [];
  let previousDegree: number | null = null;

  for (const [index, state] of path.entries()) {
    const options = DEGREES_FOR_STATE[state];
    const scored = options
      .map(([degree, penalty]) => {
        const repeat = degree === previousDegree ? 0.7 : 0;
        const nudge =
          (hashSeed(deriveSeed(seed, "harmony-degree", index, degree)) % 40) / 100;
        return { degree, score: penalty + repeat + nudge };
      })
      .sort((left, right) => left.score - right.score || left.degree - right.degree);

    const degree = (scored[0]?.degree ?? 1) as number;
    const previousState = path[index - 1];
    candidates.push({
      step: {
        degree,
        // A dominant is only functional with a leading tone; the seventh makes
        // that explicit and is idiomatic in every style this engine targets.
        ...(state === "dominant" && diatonicQualityForDegree(degree, mode) === "major"
          ? { quality: "dominant7" as const }
          : {}),
      },
      function: state,
      transitionCost: previousState ? transitionCost(previousState, state) ?? 0 : 0,
      tensionLevel: TENSION[state],
      expectedNextFunctions: nextFunctionsFor(state),
    });
    previousDegree = degree;
  }
  return candidates;
}
