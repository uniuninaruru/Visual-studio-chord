import { PPQ, type BarCount, type BarEvent, type TimeSignature } from "../types/music";

export interface TimeSignatureParts {
  numerator: number;
  denominator: number;
}

export const TIME_SIGNATURE_PARTS: Readonly<Record<TimeSignature, TimeSignatureParts>> = {
  "4/4": { numerator: 4, denominator: 4 },
  "3/4": { numerator: 3, denominator: 4 },
  "6/8": { numerator: 6, denominator: 8 },
};

export function ticksPerDenominatorUnit(
  timeSignature: TimeSignature,
  ppq: number = PPQ,
): number {
  const { denominator } = TIME_SIGNATURE_PARTS[timeSignature];
  const ticks = (ppq * 4) / denominator;
  if (!Number.isInteger(ticks)) {
    throw new RangeError("PPQ does not produce integer ticks for this time signature.");
  }
  return ticks;
}

export function ticksPerBar(timeSignature: TimeSignature, ppq: number = PPQ): number {
  const { numerator } = TIME_SIGNATURE_PARTS[timeSignature];
  return ticksPerDenominatorUnit(timeSignature, ppq) * numerator;
}

/** Musical beat length. 6/8 uses a dotted-quarter compound beat. */
export function ticksPerBeat(timeSignature: TimeSignature, ppq: number = PPQ): number {
  return timeSignature === "6/8" ? (ppq * 3) / 2 : ppq;
}

export function createBars(
  barCount: BarCount,
  timeSignature: TimeSignature,
  ppq: number = PPQ,
): BarEvent[] {
  const durationTick = ticksPerBar(timeSignature, ppq);
  return Array.from({ length: barCount }, (_, index) => ({
    index,
    startTick: index * durationTick,
    durationTick,
  }));
}

export function tickToBarIndex(tick: number, durationTick: number): number {
  if (!Number.isFinite(tick) || tick < 0 || !Number.isInteger(durationTick) || durationTick <= 0) {
    throw new RangeError("tick must be non-negative and ticksPerBar must be positive.");
  }
  return Math.floor(tick / durationTick);
}

/** 0..1 metric strength used by melody weighting. */
export function metricStrength(
  tickWithinBar: number,
  timeSignature: TimeSignature,
  ppq: number = PPQ,
): number {
  const barTicks = ticksPerBar(timeSignature, ppq);
  const tick = ((tickWithinBar % barTicks) + barTicks) % barTicks;
  if (tick === 0) return 1;

  if (timeSignature === "6/8") {
    if (tick === ppq * 1.5) return 0.85;
    if (tick % (ppq / 2) === 0) return 0.48;
    return 0.2;
  }

  if (timeSignature === "4/4" && tick === ppq * 2) return 0.85;
  if (tick % ppq === 0) return 0.68;
  if (tick % (ppq / 2) === 0) return 0.38;
  return 0.18;
}

