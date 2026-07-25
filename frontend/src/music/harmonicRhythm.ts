import type { TimeSignature } from "../types/music";
import { ticksPerBar } from "./time";

/**
 * Harmonic rhythm: how often the chord changes.
 *
 * The engine used to place exactly one chord per bar, which made the bar the
 * unit of harmony. That is only one of several idioms — a cadence often halves
 * its chord durations to push into the resolution, and a slow ballad may hold
 * one chord for two bars — so chords are placed into *slots* measured in ticks
 * instead.
 */

/** One chord's place on the timeline. */
export interface ChordSlot {
  startTick: number;
  durationTick: number;
  /** Bar the slot starts in. Kept so the UI can still group by bar. */
  barIndex: number;
  /** 0 for the downbeat slot, 1 for the second chord of the bar, and so on. */
  indexInBar: number;
}

export interface HarmonicRhythmSettings {
  /**
   * Chords per bar. 1 reproduces the original one-chord-per-bar behaviour.
   * Values above 1 subdivide the bar; a bar count below 1 is expressed with
   * `barsPerChord` instead.
   */
  changesPerBar?: number;
  /** Bars each chord is held for. Mutually exclusive with `changesPerBar` > 1. */
  barsPerChord?: number;
  /**
   * Doubles the chord rate over the final bars, the standard way of tightening
   * into a cadence.
   */
  cadentialAcceleration?: boolean;
}

/** Explicit per-bar plan: how many chords each bar holds. */
export interface HarmonicRhythmPlan {
  changesPerBar: readonly number[];
}

function isPositiveInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0;
}

/**
 * Builds the per-bar chord count for a span.
 *
 * Returns all ones unless something asks otherwise, so a caller that supplies
 * no settings gets exactly the previous behaviour.
 */
export function planHarmonicRhythm(
  bars: number,
  settings: HarmonicRhythmSettings | undefined,
): HarmonicRhythmPlan {
  if (bars <= 0) return { changesPerBar: [] };

  const barsPerChord = isPositiveInteger(settings?.barsPerChord)
    ? settings.barsPerChord
    : 1;
  const changesPerBar = isPositiveInteger(settings?.changesPerBar)
    ? settings.changesPerBar
    : 1;

  const plan: number[] = [];
  if (barsPerChord > 1) {
    // A chord spanning several bars is expressed as one change on the bar it
    // starts on and none on the bars it continues through.
    for (let bar = 0; bar < bars; bar += 1) {
      plan.push(bar % barsPerChord === 0 ? 1 : 0);
    }
  } else {
    for (let bar = 0; bar < bars; bar += 1) plan.push(changesPerBar);
  }

  // The cadence is where harmonic rhythm most often tightens, so the last two
  // bars double their rate. Skipped for spans too short to have an approach.
  if (settings?.cadentialAcceleration && bars >= 4) {
    for (let bar = bars - 2; bar < bars; bar += 1) {
      plan[bar] = Math.max(1, (plan[bar] as number)) * 2;
    }
  }

  return { changesPerBar: plan };
}

/**
 * Splits a duration into `count` parts that sum exactly to it.
 *
 * Ticks are integers and a bar does not always divide evenly (a 3/4 bar into
 * two chords, say), so the remainder goes to the earliest parts. That keeps the
 * downbeat chord the longest, which is also the musically expected weighting.
 */
function splitTicks(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  let remainder = total - base * count;
  return Array.from({ length: count }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return base + extra;
  });
}

/**
 * Turns a per-bar plan into concrete tick slots.
 *
 * Slots always tile the span exactly: every tick belongs to one chord, with no
 * gaps or overlaps, which is the invariant the validator and the scheduler both
 * rely on.
 */
export function buildChordSlots(
  plan: HarmonicRhythmPlan,
  timeSignature: TimeSignature,
  ppq?: number,
  startBar = 0,
): ChordSlot[] {
  const barTicks = ticksPerBar(timeSignature, ppq);
  const slots: ChordSlot[] = [];

  for (const [offset, changes] of plan.changesPerBar.entries()) {
    const barIndex = startBar + offset;
    const barStart = barIndex * barTicks;
    if (changes <= 0) {
      // This bar continues the previous chord rather than starting one.
      const previous = slots[slots.length - 1];
      if (previous) previous.durationTick += barTicks;
      else {
        // A leading zero has nothing to extend, so it holds a chord of its own.
        slots.push({ startTick: barStart, durationTick: barTicks, barIndex, indexInBar: 0 });
      }
      continue;
    }
    let cursor = barStart;
    for (const [indexInBar, durationTick] of splitTicks(barTicks, changes).entries()) {
      slots.push({ startTick: cursor, durationTick, barIndex, indexInBar });
      cursor += durationTick;
    }
  }
  return slots;
}

/** Convenience: plan and build in one step. */
export function chordSlotsFor(
  bars: number,
  timeSignature: TimeSignature,
  settings?: HarmonicRhythmSettings,
  ppq?: number,
  startBar = 0,
): ChordSlot[] {
  return buildChordSlots(planHarmonicRhythm(bars, settings), timeSignature, ppq, startBar);
}

/** True when every slot is exactly one bar — the original behaviour. */
export function isOneChordPerBar(slots: readonly ChordSlot[], barTicks: number): boolean {
  return slots.every((slot) => slot.durationTick === barTicks && slot.indexInBar === 0);
}
