import type { ChordQuality, Tension, TensionSettings } from "../types/music";
import { deriveSeed, hashSeed, type Seed } from "./random";

/**
 * Colour tones on the ordinary generation path.
 *
 * The machinery to voice them already existed -- reduceStack drops the fifth to
 * make room and keeps colour tones above the seventh so a 13th is not heard as
 * a 6th -- but only a named progression could ask for one. Measured across all
 * eight styles at sixteen bars, every chord the default path produced was a
 * plain triad, and even harmony.complexity "advanced" never exceeded four
 * notes. Nothing in the app could sound a ninth.
 *
 * What each quality may take is not a preference. A natural eleventh sits a
 * semitone above a major third and clashes with it, which is why it is an avoid
 * note there; resolveAvoidNotes already raises it to a sharp eleventh, so the
 * lists below stay in terms of what the chord is actually asked for.
 */

/**
 * The colour tones each quality accepts, in the order they are reached for.
 *
 * Qualities absent from this table are left alone. A sus chord has already
 * replaced its third with a colour tone, a diminished seventh is a closed
 * symmetrical shape, and an add9 by definition already carries its ninth --
 * stacking more on any of them produces a cluster rather than a colour.
 */
const TENSIONS_BY_QUALITY: Partial<Readonly<Record<ChordQuality, readonly Tension[]>>> = {
  major: ["9", "13"],
  major7: ["9", "13", "#11"],
  minor: ["9", "11"],
  minor7: ["9", "11", "13"],
  minorMajor7: ["9", "11"],
  dominant7: ["9", "13"],
  halfDiminished7: ["11"],
  augmented: ["9"],
  augmentedMajor7: ["9"],
};

/** How high a colour tone the ceiling admits. */
const TENSION_HEIGHT: Readonly<Record<Tension, number>> = {
  "6": 9,
  b9: 13,
  "9": 14,
  "#9": 15,
  "11": 17,
  "#11": 18,
  b13: 20,
  "13": 21,
};

const CEILING_HEIGHT: Readonly<Record<NonNullable<TensionSettings["ceiling"]>, number>> = {
  "9": TENSION_HEIGHT["9"],
  "11": TENSION_HEIGHT["#11"],
  "13": TENSION_HEIGHT["13"],
};

/** Default share of chords that take a colour tone. */
const DEFAULT_TENSION_RATE = 0.5;

/**
 * Which colour tones this chord takes.
 *
 * Deterministic in the seed and the slot, so the same piece is the same piece.
 * Returns nothing at all unless asked, which is what keeps the existing output
 * byte-identical.
 *
 * At most two, and only ever from the chord's own list. Three stacked colour
 * tones over a four-note seventh leaves a seven-note voicing that reduceStack
 * has to thin so aggressively the chord stops being recognisable.
 */
export function chooseTensions(
  quality: ChordQuality,
  settings: TensionSettings | undefined,
  seed: Seed,
  slotIndex: number,
): Tension[] {
  if (!settings?.enabled) return [];

  const requested = settings.rate ?? DEFAULT_TENSION_RATE;
  const rate = Number.isFinite(requested) ? Math.min(1, Math.max(0, requested)) : DEFAULT_TENSION_RATE;

  const available = TENSIONS_BY_QUALITY[quality];
  if (!available || available.length === 0) return [];

  const ceiling = CEILING_HEIGHT[settings.ceiling ?? "13"] ?? CEILING_HEIGHT["13"];
  const permitted = available.filter((tension) => TENSION_HEIGHT[tension] <= ceiling);
  if (permitted.length === 0) return [];

  // A hash rather than a running random stream, so adding the setting cannot
  // shift any other seeded decision in the piece.
  const roll = hashSeed(deriveSeed(seed, "tension", slotIndex)) % 1000;
  if (roll >= Math.round(rate * 1000)) return [];

  const chosen = permitted[
    hashSeed(deriveSeed(seed, "tension-pick", slotIndex)) % permitted.length
  ] as Tension;

  // A second colour tone only on the richer half of the roll, so a piece with
  // tensions on still moves between plainer and fuller chords rather than
  // sounding uniformly dense.
  const wantsSecond = permitted.length > 1
    && hashSeed(deriveSeed(seed, "tension-second", slotIndex)) % 1000 < Math.round(rate * 500);
  if (!wantsSecond) return [chosen];

  const others = permitted.filter((tension) => tension !== chosen);
  const second = others[
    hashSeed(deriveSeed(seed, "tension-second-pick", slotIndex)) % others.length
  ] as Tension;
  // Ordered low to high so the voicing stacks the way it reads.
  return [chosen, second].sort((left, right) => TENSION_HEIGHT[left] - TENSION_HEIGHT[right]);
}
