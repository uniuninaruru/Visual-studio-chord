import { PPQ, type TimeSignature } from "../types/music";
import type { RhythmSlot } from "./rhythmGenerator";
import { ticksPerBar } from "./time";

/**
 * Polyrhythm and polymeter.
 *
 * Both put two pulses against each other, and they are not the same thing. A
 * polyrhythm divides the same span differently — three against two inside one
 * bar, so the layers meet at the bar line and nowhere else. A polymeter keeps
 * the pulse and changes the bar: a seven-step pattern over a four-step bar has
 * both layers agreeing on the beat and disagreeing on where the downbeat is,
 * and the pattern walks around the bar until it comes back.
 *
 * The difference matters because it determines when the layers realign, which
 * is the thing the listener is actually tracking. A polyrhythm resolves every
 * cycle; a polymeter can take many bars, and a seven-over-four takes seven.
 */

export interface PolyrhythmSettings {
  /** Off produces nothing. */
  enabled: boolean;
  /** Pulses in this layer across the span. */
  pulses: number;
  /** Bars the layer's cycle covers. Defaults to 1. */
  spanBars?: number;
}

export interface PolyrhythmOptions {
  timeSignature: TimeSignature;
  settings: PolyrhythmSettings;
  /** Bar the cycle starts on. */
  startBar: number;
  ppq?: number;
}

/**
 * One cycle of an evenly divided layer.
 *
 * Every pulse gets the same span, and any tick that does not divide evenly goes
 * to the earliest pulses. Distributing the remainder rather than rounding each
 * pulse independently is what keeps the layer from drifting: the last pulse
 * always ends exactly on the cycle boundary, so the two layers meet where they
 * are supposed to.
 */
export function polyrhythmSlots(options: PolyrhythmOptions): RhythmSlot[] {
  const { settings } = options;
  if (!settings.enabled) return [];
  const pulses = Math.trunc(settings.pulses);
  if (pulses <= 0) return [];

  const ppq = options.ppq ?? PPQ;
  const barTicks = ticksPerBar(options.timeSignature, ppq);
  const spanBars = Math.max(1, Math.trunc(settings.spanBars ?? 1));
  const spanTicks = barTicks * spanBars;

  const base = Math.floor(spanTicks / pulses);
  const remainder = spanTicks % pulses;
  let cursor = options.startBar * barTicks;

  return Array.from({ length: pulses }, (_, index) => {
    const durationTick = base + (index < remainder ? 1 : 0);
    const slot: RhythmSlot = { startTick: cursor, durationTick, isRest: false };
    cursor += durationTick;
    return slot;
  });
}

/** The ratio a layer forms against the bar's own beat, in lowest terms. */
export function polyrhythmRatio(
  pulses: number,
  timeSignature: TimeSignature,
  spanBars = 1,
): readonly [number, number] {
  const beatsPerBar = timeSignature === "6/8" ? 2 : Number(timeSignature.split("/")[0]);
  const against = beatsPerBar * Math.max(1, Math.trunc(spanBars));
  const divisor = greatestCommonDivisor(Math.abs(pulses), against);
  return divisor === 0 ? [pulses, against] : [pulses / divisor, against / divisor];
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.trunc(left));
  let b = Math.abs(Math.trunc(right));
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

/** Ticks at which two evenly divided layers land together inside one cycle. */
export function polyrhythmCoincidences(
  pulsesA: number,
  pulsesB: number,
  spanTicks: number,
): number[] {
  if (pulsesA <= 0 || pulsesB <= 0 || spanTicks <= 0) return [];
  const meetings = greatestCommonDivisor(pulsesA, pulsesB);
  // Two layers meet exactly gcd(a, b) times per cycle. Three against two meet
  // once — at the start — which is why the figure sounds like one gesture
  // rather than two loops.
  return Array.from({ length: meetings }, (_, index) =>
    Math.round((index * spanTicks) / meetings),
  );
}

export interface PolymeterSettings {
  /** Off produces nothing. */
  enabled: boolean;
  /** Steps in the repeating pattern. */
  patternSteps: number;
  /** Steps the bar is counted in. */
  barSteps: number;
}

/**
 * How many bars a polymeter takes to come back to the downbeat.
 *
 * The pattern realigns after the least common multiple of the two step counts,
 * which is the number that decides whether a polymeter is a device or a
 * structure: seven over four takes seven bars, and a piece shorter than that
 * never hears it resolve.
 */
export function polymeterCycleBars(patternSteps: number, barSteps: number): number {
  const pattern = Math.max(1, Math.trunc(patternSteps));
  const bar = Math.max(1, Math.trunc(barSteps));
  const lcm = (pattern * bar) / greatestCommonDivisor(pattern, bar);
  return lcm / bar;
}

export interface PolymeterOptions {
  timeSignature: TimeSignature;
  settings: PolymeterSettings;
  /** Bars to lay the pattern across. */
  bars: number;
  /** Which steps of the pattern are onsets. Defaults to all of them. */
  pattern?: readonly boolean[];
  ppq?: number;
}

/**
 * A repeating pattern laid across bars it does not fit.
 *
 * The step length is taken from the bar, so both layers keep the same pulse —
 * that is what makes it polymeter rather than polyrhythm. What moves is the
 * downbeat: the pattern starts one step earlier relative to the bar on each
 * repeat, and only comes home after the full cycle.
 */
export function polymeterSlots(options: PolymeterOptions): RhythmSlot[] {
  const { settings } = options;
  if (!settings.enabled) return [];
  const patternSteps = Math.max(1, Math.trunc(settings.patternSteps));
  const barSteps = Math.max(1, Math.trunc(settings.barSteps));
  const bars = Math.max(0, Math.trunc(options.bars));
  if (bars === 0) return [];

  const ppq = options.ppq ?? PPQ;
  const barTicks = ticksPerBar(options.timeSignature, ppq);
  const stepTicks = barTicks / barSteps;
  const totalSteps = barSteps * bars;
  const onsets = options.pattern ?? Array.from({ length: patternSteps }, () => true);

  const slots: RhythmSlot[] = [];
  for (let step = 0; step < totalSteps; step += 1) {
    if (!onsets[step % patternSteps]) continue;
    const startTick = Math.round(step * stepTicks);
    // Each hit lasts until the next one, so the phase against the bar is heard
    // as spacing rather than as a row of identical notes.
    let nextStep = step + 1;
    while (nextStep < totalSteps && !onsets[nextStep % patternSteps]) nextStep += 1;
    const end = Math.round(Math.min(nextStep, totalSteps) * stepTicks);
    slots.push({ startTick, durationTick: Math.max(1, end - startTick), isRest: false });
  }
  return slots;
}

export interface PolymeterPhase {
  bar: number;
  /** Steps the pattern's start has drifted from the bar line. */
  offsetSteps: number;
  /** True on the bars where the pattern begins on the downbeat again. */
  aligned: boolean;
}

/** Where the pattern's downbeat falls, bar by bar. */
export function polymeterPhases(
  patternSteps: number,
  barSteps: number,
  bars: number,
): PolymeterPhase[] {
  const pattern = Math.max(1, Math.trunc(patternSteps));
  const bar = Math.max(1, Math.trunc(barSteps));
  return Array.from({ length: Math.max(0, Math.trunc(bars)) }, (_, index) => {
    const offsetSteps = (index * bar) % pattern;
    return { bar: index, offsetSteps, aligned: offsetSteps === 0 };
  });
}
