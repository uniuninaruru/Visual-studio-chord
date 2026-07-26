import type { ChordEvent, ChordQuality } from "../types/music";
import { intervalsForQuality } from "./chords";
import { pitchClassToSemitone } from "./scales";

/**
 * Guide tone lines.
 *
 * The third and the seventh are what actually identify a chord: the third says
 * major or minor, the seventh says which kind of seventh, and together they
 * separate a ii7 from a V7 from a Imaj7 far more than the root does. Played
 * horizontally they form two voices that move mostly by step, and a jazz
 * voicing is built around keeping them smooth.
 *
 * The important part is that a voice does not stay on one chord member. In a
 * ii-V-I the smooth connections are the seventh of ii falling a semitone to the
 * third of V, and the seventh of V falling a semitone to the third of I — the
 * voice alternates. Following all the thirds instead gives F to B, a tritone, in
 * exactly the progression the whole idea exists to explain.
 *
 * So the two voices are solved together: at each chord one takes the third and
 * the other takes the seventh, and which one takes which is part of what the
 * search decides, along with the octaves. The voicer had no notion of any of
 * this — it minimises movement across the whole chord, which will happily leap
 * the seventh if that buys smaller movement elsewhere.
 *
 * This reports; it does not re-voice. An earlier version rebuilt each chord
 * around its planned guide tones, and measuring it settled the question: over
 * sixty pieces and 1129 chord-to-chord moves the sounding guide tones improved
 * on none of them, were worse on three, and were unchanged on the rest, while
 * 98% of chords were rewritten. The existing four-part voicer already places
 * the third and seventh about as well as they can be placed — around 1.35
 * semitones of motion per move — so there was nothing to win and a working
 * voicing to disturb.
 */

export type GuideToneRole = "third" | "seventh";

export interface GuideToneNote {
  chordId: string;
  startTick: number;
  durationTick: number;
  midi: number;
  /** Which chord member this note carries. It changes along the line. */
  role: GuideToneRole;
  /** Semitones from the previous note of this line. 0 is a common tone. */
  motion: number;
  /**
   * True when the chord has no tone of this role and a stand-in was used.
   *
   * A triad has no seventh, and a sus chord has no third; rather than dropping
   * the line where that happens — which would break it exactly where the ear is
   * following it — the nearest structural tone stands in.
   */
  substituted: boolean;
}

export interface GuideToneLine {
  /** 0 or 1. The two voices; neither is "the third line" — they alternate. */
  index: number;
  notes: GuideToneNote[];
  /** Total absolute motion across the line. Lower is smoother. */
  totalMotion: number;
}

/** Where guide tones sit in a normal voicing: roughly G3 to E5. */
export const DEFAULT_GUIDE_TONE_REGISTER: readonly [number, number] = [55, 76];

/**
 * Beyond this many semitones a move stops reading as a line and starts reading
 * as a new entry, so the search pays a surcharge on top of the distance.
 */
const STEP_LIMIT = 2;
const LEAP_SURCHARGE = 2;

function intervalFor(quality: ChordQuality, role: GuideToneRole): {
  interval: number;
  substituted: boolean;
} | null {
  const intervals = intervalsForQuality(quality);
  const has = (semitones: number) => intervals.includes(semitones);

  if (role === "third") {
    if (has(4)) return { interval: 4, substituted: false };
    if (has(3)) return { interval: 3, substituted: false };
    // A sus chord replaces its third outright; the suspension is the tone
    // carrying the same structural weight, so the line follows it.
    if (has(5)) return { interval: 5, substituted: true };
    if (has(2)) return { interval: 2, substituted: true };
    return null;
  }

  if (has(10)) return { interval: 10, substituted: false };
  if (has(11)) return { interval: 11, substituted: false };
  // A sixth chord's sixth does the seventh's job.
  if (has(9)) return { interval: 9, substituted: true };
  // A plain triad has neither; the fifth is the remaining structural tone.
  if (has(7)) return { interval: 7, substituted: true };
  if (has(6)) return { interval: 6, substituted: true };
  if (has(8)) return { interval: 8, substituted: true };
  return null;
}

/** Every octave of a pitch class inside the register. */
function octavesOf(pitchClass: number, register: readonly [number, number]): number[] {
  const [low, high] = register;
  const base = ((pitchClass % 12) + 12) % 12;
  const options: number[] = [];
  for (let midi = base; midi <= 127; midi += 12) {
    if (midi >= low && midi <= high) options.push(midi);
  }
  return options;
}

function transitionCost(previous: number, next: number): number {
  const distance = Math.abs(next - previous);
  return distance + (distance > STEP_LIMIT ? LEAP_SURCHARGE : 0);
}

interface ChordMembers {
  chord: ChordEvent;
  third: { pitchClass: number; substituted: boolean };
  seventh: { pitchClass: number; substituted: boolean };
  /** Guide tones must sound above the chord's own bass. */
  floor: number;
}

/** One way of placing both voices on one chord. */
interface Placement {
  /** True when voice 0 carries the third and voice 1 carries the seventh. */
  straight: boolean;
  first: number;
  second: number;
}

function placementsFor(
  members: ChordMembers,
  register: readonly [number, number],
): Placement[] {
  const low = Math.max(register[0], members.floor);
  // The register is a preference; sounding above the chord's own bass is not.
  // A chord voiced high can push the floor to the register's ceiling, leaving
  // no octave of the pitch class inside it — so the ceiling yields instead.
  const high = Math.max(register[1], low + 12);
  const thirds = octavesOf(members.third.pitchClass, [low, high]);
  const sevenths = octavesOf(members.seventh.pitchClass, [low, high]);
  const options: Placement[] = [];
  for (const straight of [true, false]) {
    const firstOptions = straight ? thirds : sevenths;
    const secondOptions = straight ? sevenths : thirds;
    for (const first of firstOptions) {
      for (const second of secondOptions) {
        // The two voices are distinct parts; doubling one pitch would leave the
        // progression carrying only one guide tone at that chord.
        if (first !== second) options.push({ straight, first, second });
      }
    }
  }
  return options;
}

/**
 * The smoothest pair of voices, by shortest path.
 *
 * Both voices are solved in one search rather than separately, because which
 * voice takes the third and which takes the seventh is the decision that makes
 * the lines smooth. Solving them apart forces each voice onto one chord member
 * for the whole progression, which is what turns a ii-V-I into a tritone leap.
 *
 * A greedy walk cannot do this either: one chord whose members sit awkwardly can
 * force the rest of both lines into the wrong register, and greedy has no way to
 * pay a little now to save more later.
 */
function solveLines(
  members: readonly ChordMembers[],
  register: readonly [number, number],
): Placement[] {
  if (members.length === 0) return [];
  const centre = (register[0] + register[1]) / 2;

  const columns = members.map((entry) => {
    const options = placementsFor(entry, register);
    if (options.length > 0) return options;
    // Only reachable with a register narrower than the chord needs; place both
    // voices at the nearest octave rather than abandoning the line.
    const nearest = (pitchClass: number) => {
      let best = ((pitchClass % 12) + 12) % 12;
      for (let midi = best; midi <= 127; midi += 12) {
        if (Math.abs(midi - centre) < Math.abs(best - centre)) best = midi;
      }
      return best;
    };
    return [
      {
        straight: true,
        first: nearest(entry.third.pitchClass),
        second: nearest(entry.seventh.pitchClass) + 12,
      },
    ];
  });

  const firstColumn = columns[0] as Placement[];
  let costs = firstColumn.map(
    (option) =>
      (Math.abs(option.first - centre) + Math.abs(option.second - centre)) * 0.5,
  );
  const backPointers: number[][] = [];

  for (let index = 1; index < columns.length; index += 1) {
    const previousColumn = columns[index - 1] as Placement[];
    const column = columns[index] as Placement[];
    const nextCosts: number[] = [];
    const pointers: number[] = [];
    for (const option of column) {
      let bestCost = Number.POSITIVE_INFINITY;
      let bestFrom = 0;
      for (const [fromIndex, previous] of previousColumn.entries()) {
        const cost =
          (costs[fromIndex] as number) +
          transitionCost(previous.first, option.first) +
          transitionCost(previous.second, option.second);
        if (cost < bestCost) {
          bestCost = cost;
          bestFrom = fromIndex;
        }
      }
      nextCosts.push(bestCost);
      pointers.push(bestFrom);
    }
    costs = nextCosts;
    backPointers.push(pointers);
  }

  let index = 0;
  for (const [candidate, cost] of costs.entries()) {
    if (cost < (costs[index] as number)) index = candidate;
  }
  const path: Placement[] = [
    (columns[columns.length - 1] as Placement[])[index] as Placement,
  ];
  for (let step = backPointers.length - 1; step >= 0; step -= 1) {
    index = (backPointers[step] as number[])[index] as number;
    path.unshift((columns[step] as Placement[])[index] as Placement);
  }
  return path;
}

export interface GuideToneOptions {
  register?: readonly [number, number];
}

/** Plans the two guide tone voices across a progression. */
export function planGuideToneLines(
  chords: readonly ChordEvent[],
  options: GuideToneOptions = {},
): GuideToneLine[] {
  const register = options.register ?? DEFAULT_GUIDE_TONE_REGISTER;

  const members: ChordMembers[] = [];
  for (const chord of chords) {
    const third = intervalFor(chord.quality, "third");
    const seventh = intervalFor(chord.quality, "seventh");
    // A quality with neither is not something a guide tone line can describe;
    // it drops out rather than being represented by an invented pitch.
    if (!third || !seventh) continue;
    const rootSemitone = pitchClassToSemitone(chord.root);
    members.push({
      chord,
      third: {
        pitchClass: (rootSemitone + third.interval) % 12,
        substituted: third.substituted,
      },
      seventh: {
        pitchClass: (rootSemitone + seventh.interval) % 12,
        substituted: seventh.substituted,
      },
      floor: chord.notes.length > 0 ? Math.min(...chord.notes) + 1 : register[0],
    });
  }

  const path = solveLines(members, register);
  return [0, 1].map((voice) => {
    let previous: number | null = null;
    let totalMotion = 0;
    const notes = members.map((entry, index) => {
      const placement = path[index] as Placement;
      const carriesThird = voice === 0 ? placement.straight : !placement.straight;
      const midi = voice === 0 ? placement.first : placement.second;
      const member = carriesThird ? entry.third : entry.seventh;
      const motion = previous === null ? 0 : midi - previous;
      totalMotion += Math.abs(motion);
      previous = midi;
      return {
        chordId: entry.chord.id,
        startTick: entry.chord.startTick,
        durationTick: entry.chord.durationTick,
        midi,
        role: carriesThird ? "third" : "seventh",
        motion,
        substituted: member.substituted,
      } satisfies GuideToneNote;
    });
    return { index: voice, notes, totalMotion };
  });
}

export interface GuideToneSummary {
  /** Fraction of moves that are a step or a common tone. */
  smoothness: number;
  /** Largest single move in either line, in semitones. */
  largestLeap: number;
  totalMotion: number;
  /** Notes standing in for a third or seventh the chord does not have. */
  substitutions: number;
}

/**
 * How well the lines behave.
 *
 * Smoothness is the number worth watching: guide tones that move by step or
 * hold a common tone are what makes a progression sound connected rather than
 * like a series of separate chords.
 */
export function summarizeGuideTones(
  lines: readonly GuideToneLine[],
): GuideToneSummary | null {
  const moves: number[] = [];
  let substitutions = 0;
  for (const line of lines) {
    for (const [index, note] of line.notes.entries()) {
      if (index > 0) moves.push(Math.abs(note.motion));
      if (note.substituted) substitutions += 1;
    }
  }
  if (moves.length === 0) return null;
  return {
    smoothness: moves.filter((move) => move <= STEP_LIMIT).length / moves.length,
    largestLeap: Math.max(...moves),
    totalMotion: moves.reduce((sum, move) => sum + move, 0),
    substitutions,
  };
}
