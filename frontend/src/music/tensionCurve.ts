import type {
  ChordEvent,
  NoteEvent,
  SectionEvent,
  SectionKind,
} from "../types/music";
import { tensionOf, type FunctionalHarmonyState } from "./functionalHarmony";

/**
 * Tension and energy curves.
 *
 * The engine could say what every chord and note was, but not how the piece
 * *felt* over time — where it was building, where it released. Without that
 * there is no way to check whether a chorus actually arrives, or for a generator
 * to aim at anything.
 *
 * Two related things are measured. Tension is derived from the music that
 * exists: how far the harmony is from home, how far the melody has climbed, how
 * dense the rhythm is. Energy is planned in advance per section, and is what a
 * generator can be told to hit.
 */

export interface TensionCurvePoint {
  tick: number;
  barIndex: number;
  /** 0..1. Distance from the tonic in functional terms. */
  harmonicTension: number;
  /** 0..1. Register and leap activity in the melody. */
  melodicTension: number;
  /** 0..1. Note density and off-beat placement. */
  rhythmicTension: number;
  /** 0..1. Weighted combination of the three. */
  totalTension: number;
}

/** How much each dimension contributes to the total. */
const WEIGHTS = { harmonic: 0.45, melodic: 0.35, rhythmic: 0.2 } as const;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/**
 * Maps a chord's scale degree onto the function it most likely serves.
 *
 * A rough reading is enough here: this measures tension, not analysis, and the
 * difference between a vi read as tonic substitute or as predominant moves the
 * curve less than a rounding error in the melodic term.
 */
function functionForDegree(degree: number): FunctionalHarmonyState {
  switch (degree) {
    case 1:
      return "tonic";
    case 3:
    case 6:
      return "tonicProlongation";
    case 2:
    case 4:
      return "predominant";
    case 5:
    case 7:
      return "dominant";
    default:
      return "modal";
  }
}

export interface TensionCurveOptions {
  chords: readonly ChordEvent[];
  notes: readonly NoteEvent[];
  ticksPerBar: number;
  bars: number;
  /** Melody range, used to normalise how high the line has climbed. */
  melodyRange: readonly [number, number];
}

/**
 * Measures the tension of each bar of a finished piece.
 *
 * Chromatic chords are pushed above their functional tension, because a
 * borrowed or altered chord is unsettling regardless of the function it serves.
 */
export function analyzeTensionCurve(
  options: TensionCurveOptions,
): TensionCurvePoint[] {
  const { chords, notes, ticksPerBar, bars, melodyRange } = options;
  const [lowMidi, highMidi] = melodyRange;
  const span = Math.max(1, highMidi - lowMidi);

  const points: TensionCurvePoint[] = [];
  for (let barIndex = 0; barIndex < bars; barIndex += 1) {
    const start = barIndex * ticksPerBar;
    const end = start + ticksPerBar;

    const barChords = chords.filter(
      (chord) => chord.startTick < end && chord.startTick + chord.durationTick > start,
    );
    const harmonic = barChords.length === 0
      ? 0
      : barChords.reduce((sum, chord) => {
          const functionRank = tensionOf(functionForDegree(chord.degree));
          // Keep the three theory facts ordinal. The maximum rank is six:
          // functional dominant (4), non-diatonic colour (1), extension (1).
          // This replaces unsourced decimal bonuses with an inspectable scale.
          const colourRank = chord.source === "diatonic" ? 0 : 1;
          const extensionRank = (chord.tensions?.length ?? 0) > 0 ? 1 : 0;
          return sum + (functionRank + colourRank + extensionRank) / 6;
        }, 0) / barChords.length;

    const barNotes = notes.filter((note) => note.barIndex === barIndex);
    let melodic = 0;
    if (barNotes.length > 0) {
      const averageMidi =
        barNotes.reduce((sum, note) => sum + note.midi, 0) / barNotes.length;
      const height = clamp01((averageMidi - lowMidi) / span);
      let leapTotal = 0;
      for (let index = 1; index < barNotes.length; index += 1) {
        leapTotal += Math.abs(
          (barNotes[index] as NoteEvent).midi - (barNotes[index - 1] as NoteEvent).midi,
        );
      }
      const leap = clamp01(leapTotal / (barNotes.length * 7));
      // Register dominates; leaps colour it.
      melodic = clamp01(height * 0.7 + leap * 0.3);
    }

    // Density is measured against a moderate eight notes per bar, and notes off
    // the beat add unrest beyond their count.
    const density = clamp01(barNotes.length / 8);
    const offBeat = barNotes.length === 0
      ? 0
      : barNotes.filter((note) => (note.startTick - start) % (ticksPerBar / 4) !== 0).length /
        barNotes.length;
    const rhythmic = clamp01(density * 0.7 + offBeat * 0.3);

    points.push({
      tick: start,
      barIndex,
      harmonicTension: clamp01(harmonic),
      melodicTension: melodic,
      rhythmicTension: rhythmic,
      totalTension: clamp01(
        harmonic * WEIGHTS.harmonic +
          melodic * WEIGHTS.melodic +
          rhythmic * WEIGHTS.rhythmic,
      ),
    });
  }
  return points;
}

export interface SectionEnergyPlan {
  sectionId: string;
  kind: SectionKind;
  startEnergy: number;
  peakEnergy: number;
  endEnergy: number;
}

/**
 * Target energy per section kind, as [start, peak, end].
 *
 * A pre-chorus rises and hands over without resolving; a chorus arrives high and
 * stays there; a bridge drops so the final chorus has somewhere to climb from.
 */
const SECTION_ENERGY: Readonly<Record<SectionKind, readonly [number, number, number]>> = {
  intro: [0.15, 0.25, 0.3],
  verse: [0.3, 0.4, 0.4],
  preChorus: [0.45, 0.75, 0.75],
  chorus: [0.85, 0.95, 0.8],
  bridge: [0.35, 0.5, 0.45],
  outro: [0.5, 0.5, 0.15],
};

/**
 * Plans the energy each section should reach.
 *
 * A repeated section is lifted slightly above its earlier appearance, so a
 * returning chorus outdoes the first rather than merely restating it — which is
 * what makes a final chorus read as the climax.
 */
export function planSectionEnergy(
  sections: readonly SectionEvent[],
): SectionEnergyPlan[] {
  const seen = new Map<SectionKind, number>();
  return sections.map((section) => {
    const occurrence = seen.get(section.kind) ?? 0;
    seen.set(section.kind, occurrence + 1);
    const [start, peak, end] = SECTION_ENERGY[section.kind];
    const lift = Math.min(0.1, occurrence * 0.05);
    return {
      sectionId: section.id,
      kind: section.kind,
      startEnergy: clamp01(start + lift),
      peakEnergy: clamp01(peak + lift),
      endEnergy: clamp01(end + lift),
    };
  });
}

/** Energy the plan expects at a given bar, interpolated within its section. */
export function energyAtBar(
  sections: readonly SectionEvent[],
  plans: readonly SectionEnergyPlan[],
  barIndex: number,
): number | null {
  const index = sections.findIndex(
    (section) => barIndex >= section.startBar && barIndex < section.endBar,
  );
  if (index < 0) return null;
  const section = sections[index] as SectionEvent;
  const plan = plans[index];
  if (!plan) return null;

  const length = Math.max(1, section.endBar - section.startBar);
  const progress = length === 1 ? 0 : (barIndex - section.startBar) / (length - 1);
  // Rise to the peak across the first half, settle to the end across the second.
  return progress <= 0.5
    ? plan.startEnergy + (plan.peakEnergy - plan.startEnergy) * (progress * 2)
    : plan.peakEnergy + (plan.endEnergy - plan.peakEnergy) * ((progress - 0.5) * 2);
}

/**
 * Summary of a curve, for reporting rather than generation.
 *
 * `peakBar` is where the piece is most tense, which is the single most useful
 * number for judging whether the climax landed where it was meant to.
 */
export interface TensionSummary {
  peakBar: number;
  peakTension: number;
  averageTension: number;
  /** Positive when the second half is more tense than the first. */
  buildDirection: number;
}

export function summarizeTension(
  points: readonly TensionCurvePoint[],
): TensionSummary | null {
  if (points.length === 0) return null;
  let peak = points[0] as TensionCurvePoint;
  let total = 0;
  for (const point of points) {
    total += point.totalTension;
    if (point.totalTension > peak.totalTension) peak = point;
  }
  const midpoint = Math.floor(points.length / 2);
  const firstHalf = points.slice(0, midpoint);
  const secondHalf = points.slice(midpoint);
  const mean = (list: readonly TensionCurvePoint[]) =>
    list.length === 0
      ? 0
      : list.reduce((sum, point) => sum + point.totalTension, 0) / list.length;

  return {
    peakBar: peak.barIndex,
    peakTension: peak.totalTension,
    averageTension: total / points.length,
    buildDirection: mean(secondHalf) - mean(firstHalf),
  };
}
