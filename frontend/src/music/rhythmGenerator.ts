import { PPQ, type TimeSignature } from "../types/music";
import { createSeededRandom, deriveSeed, type Seed } from "./random";
import {
  metricStrength,
  ticksPerBar,
  TIME_SIGNATURE_PARTS,
} from "./time";

export interface RhythmSlot {
  startTick: number;
  durationTick: number;
  isRest: boolean;
}

export interface RhythmGeneratorSettings {
  timeSignature: TimeSignature;
  density: number;
  restRate: number;
  syncopation: number;
  seed: Seed;
  barIndex: number;
  ppq?: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Creates a complete rhythmic partition. Rests are explicit here even though
 * only sounded slots become NoteEvents later.
 */
export function generateRhythmBar(settings: RhythmGeneratorSettings): RhythmSlot[] {
  const ppq = settings.ppq ?? PPQ;
  if (!Number.isInteger(ppq) || ppq <= 0 || ppq % 4 !== 0) {
    throw new RangeError("PPQ must be a positive integer divisible by four.");
  }
  const durationTick = ticksPerBar(settings.timeSignature, ppq);
  const minimumUnit = ppq / 4;
  const availableUnits = durationTick / minimumUnit;
  if (!Number.isInteger(availableUnits)) {
    throw new RangeError("Bar duration must be divisible by the sixteenth-note grid.");
  }

  const minimumSlots = TIME_SIGNATURE_PARTS[settings.timeSignature].numerator;
  const targetSlots = Math.max(
    1,
    Math.min(
      availableUnits,
      Math.round(minimumSlots + (availableUnits - minimumSlots) * clamp01(settings.density)),
    ),
  );
  const random = createSeededRandom(
    deriveSeed(settings.seed, "rhythm", settings.barIndex, settings.timeSignature),
  );

  const baseUnits = Math.floor(availableUnits / targetSlots);
  const remainder = availableUnits % targetSlots;
  const slotUnits = Array.from(
    { length: targetSlots },
    (_, index) => baseUnits + (index < remainder ? 1 : 0),
  );
  const shuffledUnits = random.shuffle(slotUnits);

  let cursor = settings.barIndex * durationTick;
  const barStart = cursor;
  const slots = shuffledUnits.map((units, index): RhythmSlot => {
    const localTick = cursor - barStart;
    const strength = metricStrength(localTick, settings.timeSignature, ppq);
    const syncopationShift = (strength >= 0.65 ? 1 : -0.45) * clamp01(settings.syncopation) * 0.45;
    const restProbability = clamp01(settings.restRate + syncopationShift);
    const duration = units * minimumUnit;
    const slot: RhythmSlot = {
      startTick: cursor,
      durationTick: duration,
      // Keep the final slot sounding so phrases have an explicit landing.
      isRest: index === shuffledUnits.length - 1 ? false : random.chance(restProbability),
    };
    cursor += duration;
    return slot;
  });

  if (!slots.some((slot) => !slot.isRest)) {
    (slots[slots.length - 1] as RhythmSlot).isRest = false;
  }
  return slots;
}

export function rhythmDuration(slots: readonly RhythmSlot[]): number {
  return slots.reduce((total, slot) => total + slot.durationTick, 0);
}

export function rhythmExactlyCoversBar(
  slots: readonly RhythmSlot[],
  barIndex: number,
  timeSignature: TimeSignature,
  ppq: number = PPQ,
): boolean {
  if (slots.length === 0) return false;
  const durationTick = ticksPerBar(timeSignature, ppq);
  const barStart = barIndex * durationTick;
  let cursor = barStart;
  for (const slot of slots) {
    if (
      !Number.isInteger(slot.startTick) ||
      !Number.isInteger(slot.durationTick) ||
      slot.durationTick <= 0 ||
      slot.startTick !== cursor
    ) {
      return false;
    }
    cursor += slot.durationTick;
  }
  return cursor === barStart + durationTick;
}
