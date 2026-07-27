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

/**
 * Which states may follow each state, expressed as ordinal preference tiers.
 *
 * The former engine stored decimal "costs" such as 0.15 and 0.55. Those values
 * looked precise but were not estimated from a corpus or listening experiment.
 * A tier is honest about what the theory supplies: preferred, ordinary, or
 * exceptional-but-legal. Search compares these integers lexicographically and
 * never pretends that a predominant→dominant move is 3.67 times "better" than
 * a plagal resolution.
 */
type TransitionTier = 1 | 2 | 3;

const TRANSITIONS: Readonly<
  Record<FunctionalHarmonyState, Readonly<Partial<Record<FunctionalHarmonyState, TransitionTier>>>>
> = {
  tonic: {
    tonicProlongation: 1,
    predominant: 1,
    dominantPreparation: 2,
    dominant: 2,
    modal: 2,
    chromaticSequence: 3,
  },
  tonicProlongation: {
    tonicProlongation: 2,
    // Settling back onto the tonic proper — how a loop closes without a cadence.
    tonic: 1,
    predominant: 1,
    dominantPreparation: 2,
    dominant: 2,
    modal: 3,
  },
  predominant: {
    predominant: 2,
    dominantPreparation: 1,
    dominant: 1,
    // IV→I: the plagal move. Legal, but it resolves without the dominant's
    // tension, so it belongs to the ordinary rather than preferred tier.
    resolution: 2,
    modal: 3,
    chromaticSequence: 3,
  },
  dominantPreparation: {
    // A preparation exists to reach the dominant; anything else wastes it.
    dominant: 1,
    predominant: 3,
    chromaticSequence: 3,
  },
  dominant: {
    resolution: 1,
    // Repeating the dominant prolongs tension, which is usable but not free.
    dominant: 2,
    // Going back to a predominant undoes the tension just built.
    predominant: 3,
  },
  resolution: {
    tonic: 1,
    tonicProlongation: 1,
    predominant: 2,
    modal: 3,
    chromaticSequence: 3,
  },
  modal: {
    modal: 2,
    tonic: 1,
    predominant: 2,
    dominant: 2,
    resolution: 3,
  },
  chromaticSequence: {
    chromaticSequence: 2,
    dominant: 1,
    predominant: 2,
    tonic: 2,
  },
};

/**
 * Ordinal functional tension.
 *
 * These are ranks, not pseudo-measurements. Perceptual tonal-tension models are
 * implemented separately from this grammar; the path planner only needs the
 * well-established ordering tonic < predominant < dominant.
 */
const TENSION: Readonly<Record<FunctionalHarmonyState, number>> = {
  tonic: 0,
  tonicProlongation: 1,
  predominant: 2,
  dominantPreparation: 3,
  dominant: 4,
  resolution: 0,
  modal: 2,
  chromaticSequence: 3,
};

/**
 * Scale degrees that can carry each function, with the cost of using them.
 *
 * Lower is more idiomatic. Degrees appear under several functions because a
 * chord's function depends on where it sits, not only on what it is: vi is a
 * tonic substitute after V and a predominant approaching ii.
 */
const DEGREES_FOR_STATE: Readonly<Record<FunctionalHarmonyState, readonly number[]>> = {
  tonic: [1, 6, 3],
  tonicProlongation: [6, 3, 1],
  predominant: [4, 2, 6],
  dominantPreparation: [2, 4, 6],
  dominant: [5, 7],
  resolution: [1, 6],
  modal: [7, 4, 3, 6],
  chromaticSequence: [5, 2, 6, 3],
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

  /**
   * The grammar supplies an ordinal tension target. Exploration changes that
   * target by one adjacent rank at selected interior positions; it never adds a
   * floating random cost to the theory rules.
   */
  const targetTension = (index: number): number => {
    const progress = freeLength <= 1 ? 0 : index / (freeLength - 1);
    const base = Math.round(progress * 3);
    if (exploration === 0 || index === 0) return base;
    const draw = hashSeed(deriveSeed(seed, "harmony-exploration", index)) % 1000;
    if (draw >= Math.round(exploration * 1000)) return base;
    const direction =
      hashSeed(deriveSeed(seed, "harmony-exploration-direction", index)) % 2 === 0
        ? -1
        : 1;
    return Math.min(4, Math.max(0, base + direction));
  };

  interface PathScore {
    /** Distance from the requested ordinal tension curve. */
    contourDeviation: number;
    /** Sum of preferred/ordinary/exceptional transition tiers. */
    transitionTier: number;
    /** Number of immediately repeated functions. */
    repetitions: number;
    /** Deterministic final tie break only; never outweighs musical criteria. */
    tieBreak: number;
  }
  type Cell = {
    score: PathScore;
    previous: FunctionalHarmonyState | null;
  };
  const compareScore = (left: PathScore, right: PathScore): number =>
    left.contourDeviation - right.contourDeviation
    || left.transitionTier - right.transitionTier
    || left.repetitions - right.repetitions
    || left.tieBreak - right.tieBreak;

  let previousRow = new Map<FunctionalHarmonyState, Cell>();
  previousRow.set(start, {
    score: {
      contourDeviation: Math.abs(TENSION[start] - targetTension(0)),
      transitionTier: 0,
      repetitions: 0,
      tieBreak: 0,
    },
    previous: null,
  });

  const rows: Array<Map<FunctionalHarmonyState, Cell>> = [previousRow];
  for (let index = 1; index < freeLength; index += 1) {
    const row = new Map<FunctionalHarmonyState, Cell>();
    for (const to of states) {
      let best: Cell | null = null;
      for (const [from, cell] of previousRow) {
        const move = transitionCost(from, to);
        if (move === null) continue;
        const score: PathScore = {
          contourDeviation:
            cell.score.contourDeviation
            + Math.abs(TENSION[to] - targetTension(index)),
          transitionTier: cell.score.transitionTier + move,
          repetitions: cell.score.repetitions + (from === to ? 1 : 0),
          tieBreak:
            cell.score.tieBreak
            + (hashSeed(deriveSeed(seed, "harmony-path-tie", index, from, to)) % 997),
        };
        if (!best || compareScore(score, best.score) < 0) {
          best = { score, previous: from };
        }
      }
      if (best) row.set(to, best);
    }
    rows.push(row);
    previousRow = row;
  }

  // Close onto the cadence: the last free state must be able to reach it.
  const firstTail = tail[0] as FunctionalHarmonyState;
  let endState: FunctionalHarmonyState | null = null;
  let endScore: PathScore | null = null;
  for (const [state, cell] of previousRow) {
    const move = transitionCost(state, firstTail);
    if (move === null) continue;
    const score = {
      ...cell.score,
      transitionTier: cell.score.transitionTier + move,
    };
    if (!endScore || compareScore(score, endScore) < 0) {
      endScore = score;
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
    // The array order is the theory rank. Within the best rank that avoids an
    // immediate repetition, the seed is only a deterministic tie breaker.
    const nonRepeating = options.filter((degree) => degree !== previousDegree);
    const pool = nonRepeating.length > 0 ? nonRepeating : options;
    const preferredCount =
      state === "modal" || state === "chromaticSequence" || state === "tonicProlongation"
        ? Math.min(2, pool.length)
        : 1;
    const preferred = pool.slice(0, preferredCount);
    const degree = (preferred[
      hashSeed(deriveSeed(seed, "harmony-degree-tie", index, state)) % preferred.length
    ] ?? 1) as number;
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
