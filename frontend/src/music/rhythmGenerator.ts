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
  /**
   * This bar ends a phrase, so its last note is where the line lands.
   *
   * Only `generateNoteValueBar` reads it. The equal partition has no long value
   * to land on -- measured, every phrase in every piece ended on a sixteenth or
   * an eighth, because those were the only two lengths it could produce.
   */
  closesPhrase?: boolean;
  /** 0..1, how firmly. A hard close lands on a longer note. */
  cadenceStrength?: number;
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

/**
 * Note values the meter admits, longest first, in sixteenths.
 *
 * A whole, a dotted half, a half, a dotted quarter, a quarter, a dotted eighth,
 * an eighth, a sixteenth. Not a corpus and not a style: these are the durations
 * that exist in a metric hierarchy, which is the same hierarchy `metricStrength`
 * already reads to decide which beats are strong.
 */
const NOTE_VALUE_UNITS = [16, 12, 8, 6, 4, 3, 2, 1] as const;

/**
 * How much a value is wanted at this density.
 *
 * Density is the app's existing dial and it means "how many notes in a bar", so
 * it has to keep meaning that: at 0 the long values dominate, at 1 the short
 * ones do, and at 0.5 the weight is flat. Expressed as a power of the value so
 * the preference is smooth rather than a table of thresholds.
 */
function valueWeight(units: number, density: number): number {
  const exponent = 1 - 2 * clamp01(density);
  return Math.pow(units, exponent);
}

/**
 * Whether a note of this length starting here agrees with the beat, and how much
 * it is worth if it does not.
 *
 * A value that spans a stronger beat than the one it starts on obscures the
 * metre -- that is what syncopation IS, so it is not forbidden, it is priced.
 * A note aligned to its own length (a quarter starting on a quarter, a half on a
 * half) is metrically well formed and always available.
 */
function metricFit(localUnits: number, units: number, syncopation: number): number {
  if (localUnits % units === 0) return 1;
  // Dotted values never align to their own length; judge them by the plain
  // value they are dotted from, so a dotted quarter on a beat is well formed.
  const undotted = units % 3 === 0 ? (units / 3) * 2 : units;
  if (localUnits % undotted === 0) return 1;
  return 0.15 + 0.85 * clamp01(syncopation);
}

/**
 * A bar of note values rather than a bar cut into equal pieces.
 *
 * The partition this replaces takes the bar's sixteenth count, divides by a
 * target slot count and hands out the remainder one unit at a time. That is
 * arithmetic, not rhythm: it can only ever emit floor(n/k) and floor(n/k)+1, so
 * every bar of every piece has exactly two note lengths in it. Measured across
 * 24 seeds and 3349 notes, the whole melody was 59% eighths and 41% sixteenths
 * with nothing else -- no quarter, nothing held, nothing dotted. The pitches
 * meanwhile carried 94% of the available trigram entropy. What sounded the same
 * about the output was never the notes; it was that every note was one of two
 * lengths.
 *
 * Filled left to right from the values the meter admits, weighted by density
 * for length and by the beat for placement. The bar is always exactly covered,
 * because a sixteenth fits wherever anything fits.
 */
export function generateNoteValueBar(settings: RhythmGeneratorSettings): RhythmSlot[] {
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

  const random = createSeededRandom(
    deriveSeed(settings.seed, "note-values", settings.barIndex, settings.timeSignature),
  );
  const density = clamp01(settings.density);
  const syncopation = clamp01(settings.syncopation);

  /*
   * A phrase lands on a note long enough to be heard landing.
   *
   * Reserved before the bar is filled rather than fixed up afterwards, because
   * a bar that has already been filled has no room left to lengthen anything.
   * A quarter for a soft close, a half for a firm one -- the phrase plan's own
   * cadenceStrength, which the melody generator already uses to decide how
   * firmly the line resolves.
   */
  const landing = settings.closesPhrase
    ? Math.min(
      availableUnits,
      clamp01(settings.cadenceStrength ?? 1) >= 0.75 ? 8 : 4,
    )
    : 0;
  const fillUnits = Math.max(0, availableUnits - landing);

  const slots: RhythmSlot[] = [];
  const barStart = settings.barIndex * durationTick;
  let localUnits = 0;
  while (localUnits < fillUnits) {
    const remaining = fillUnits - localUnits;
    const choices = NOTE_VALUE_UNITS.filter((units) => units <= remaining);
    const weights = choices.map((units) =>
      valueWeight(units, density) * metricFit(localUnits, units, syncopation));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let pick = random.next() * total;
    let chosen = choices[choices.length - 1] as number;
    for (const [index, units] of choices.entries()) {
      pick -= weights[index] as number;
      if (pick <= 0) { chosen = units; break; }
    }

    const startTick = barStart + localUnits * minimumUnit;
    const strength = metricStrength(localUnits * minimumUnit, settings.timeSignature, ppq);
    const syncopationShift = (strength >= 0.65 ? 1 : -0.45) * syncopation * 0.45;
    slots.push({
      startTick,
      durationTick: chosen * minimumUnit,
      // A rest is likelier where the bar is weak, and a long value is a poor
      // rest: silence measured in half notes reads as the piece stopping.
      isRest: chosen <= 4 && random.chance(clamp01(settings.restRate + syncopationShift)),
    });
    localUnits += chosen;
  }

  if (landing > 0) {
    slots.push({
      startTick: barStart + localUnits * minimumUnit,
      durationTick: landing * minimumUnit,
      isRest: false,
    });
  }

  // Something has to sound, and the last slot is where a phrase lands.
  if (!slots.some((slot) => !slot.isRest)) {
    (slots[slots.length - 1] as RhythmSlot).isRest = false;
  }
  return slots;
}
