import type { SectionEvent } from "../types/music";
import { deriveSeed, hashSeed, type Seed } from "./random";

/**
 * Phrase grammar.
 *
 * Melodies were phrased by a fixed rule — every fourth bar ended a phrase — so
 * an eight-bar line was two equal halves with nothing distinguishing them. Real
 * phrases have roles: an idea is stated, answered, broken into smaller pieces as
 * momentum builds, and then closed. That shape is the classical sentence, and it
 * is what this plans.
 */

export type PhraseFunction =
  | "presentation"
  | "response"
  | "continuation"
  | "sequence"
  | "fragmentation"
  | "cadential";

export interface PhrasePlanEntry {
  id: string;
  startBar: number;
  /** Exclusive. */
  endBar: number;
  function: PhraseFunction;
  /**
   * How firmly this phrase closes, 0..1. Only the cadential phrase of a section
   * closes hard; the others hand over to what follows.
   */
  cadenceStrength: number;
  /**
   * Where the melodic peak sits inside the phrase, 0..1. Placing it after the
   * midpoint is what makes a line feel like it is going somewhere rather than
   * arching symmetrically.
   */
  climaxPosition: number;
}

export interface PhraseGrammarSettings {
  /** Off keeps the original fixed-length phrasing. */
  enabled: boolean;
}

/**
 * Phrase layouts by span length.
 *
 * Each entry is [function, bars]. The four-bar case is an antecedent and a
 * consequent; eight bars is the full sentence; sixteen is two sentences where
 * the second develops rather than restates.
 */
const LAYOUTS: Readonly<Record<number, ReadonlyArray<readonly [PhraseFunction, number]>>> = {
  1: [["cadential", 1]],
  2: [["presentation", 1], ["cadential", 1]],
  3: [["presentation", 1], ["continuation", 1], ["cadential", 1]],
  4: [["presentation", 2], ["cadential", 2]],
  5: [["presentation", 2], ["continuation", 2], ["cadential", 1]],
  6: [["presentation", 2], ["fragmentation", 2], ["cadential", 2]],
  7: [["presentation", 2], ["response", 2], ["fragmentation", 2], ["cadential", 1]],
  8: [
    ["presentation", 2],
    ["response", 2],
    ["fragmentation", 2],
    ["cadential", 2],
  ],
  12: [
    ["presentation", 2],
    ["response", 2],
    ["fragmentation", 2],
    ["cadential", 2],
    ["sequence", 2],
    ["cadential", 2],
  ],
  16: [
    ["presentation", 2],
    ["response", 2],
    ["fragmentation", 2],
    ["cadential", 2],
    ["sequence", 2],
    ["continuation", 2],
    ["fragmentation", 2],
    ["cadential", 2],
  ],
};

/** How hard each phrase function closes. */
const CADENCE_STRENGTH: Readonly<Record<PhraseFunction, number>> = {
  presentation: 0.15,
  response: 0.35,
  continuation: 0.25,
  sequence: 0.2,
  // Fragmentation is the least closed: it exists to build toward the cadence.
  fragmentation: 0.1,
  cadential: 1,
};

/** Where the peak sits within each kind of phrase. */
const CLIMAX_POSITION: Readonly<Record<PhraseFunction, number>> = {
  presentation: 0.35,
  response: 0.5,
  continuation: 0.6,
  sequence: 0.75,
  fragmentation: 0.8,
  // A cadential phrase peaks early and then descends into the close.
  cadential: 0.3,
};

/** Falls back to repeated two-bar units for spans with no explicit layout. */
function layoutFor(bars: number): ReadonlyArray<readonly [PhraseFunction, number]> {
  const known = LAYOUTS[bars];
  if (known) return known;

  const units: Array<readonly [PhraseFunction, number]> = [];
  let remaining = bars;
  const cycle: readonly PhraseFunction[] = [
    "presentation",
    "response",
    "fragmentation",
  ];
  let index = 0;
  while (remaining > 2) {
    const length = Math.min(2, remaining - 2);
    units.push([cycle[index % cycle.length] as PhraseFunction, length]);
    remaining -= length;
    index += 1;
  }
  units.push(["cadential", remaining]);
  return units;
}

function planSpan(
  startBar: number,
  bars: number,
  seed: Seed,
  idPrefix: string,
): PhrasePlanEntry[] {
  const entries: PhrasePlanEntry[] = [];
  let cursor = startBar;
  for (const [index, [phraseFunction, length]] of layoutFor(bars).entries()) {
    // Nudge the peak deterministically so repeated phrases are not identical
    // in shape, without moving it far enough to change the phrase's character.
    const jitter =
      (hashSeed(deriveSeed(seed, "phrase-climax", idPrefix, index)) % 21 - 10) / 100;
    entries.push({
      id: `${idPrefix}-phrase-${index}`,
      startBar: cursor,
      endBar: cursor + length,
      function: phraseFunction,
      cadenceStrength: CADENCE_STRENGTH[phraseFunction],
      climaxPosition: Math.min(
        0.95,
        Math.max(0.05, CLIMAX_POSITION[phraseFunction] + jitter),
      ),
    });
    cursor += length;
  }
  return entries;
}

export interface PhrasePlanOptions {
  bars: number;
  seed: Seed;
  /** When present, phrases are planned inside each section and never cross one. */
  sections?: readonly SectionEvent[];
}

/**
 * Builds the phrase plan for a piece.
 *
 * A phrase never spans a section boundary: a section change is already a formal
 * seam, and a phrase straddling it would blur the thing the section exists to
 * mark.
 */
export function planPhrases(options: PhrasePlanOptions): PhrasePlanEntry[] {
  if (options.bars <= 0) return [];
  if (!options.sections || options.sections.length === 0) {
    return planSpan(0, options.bars, options.seed, "s0");
  }
  return options.sections.flatMap((section, index) =>
    planSpan(
      section.startBar,
      section.endBar - section.startBar,
      options.seed,
      `s${index}-${section.kind}`,
    ),
  );
}

/** The phrase covering a bar, if the piece has a phrase plan. */
export function phraseForBar(
  phrases: readonly PhrasePlanEntry[] | undefined,
  barIndex: number,
): PhrasePlanEntry | undefined {
  if (!phrases) return undefined;
  return phrases.find(
    (phrase) => barIndex >= phrase.startBar && barIndex < phrase.endBar,
  );
}

/** Checks that phrases tile [0, bars) exactly, in order and without gaps. */
export function phrasesTileBars(
  phrases: readonly PhrasePlanEntry[],
  bars: number,
): boolean {
  if (phrases.length === 0) return false;
  let cursor = 0;
  const ids = new Set<string>();
  for (const phrase of phrases) {
    if (phrase.startBar !== cursor || phrase.endBar <= phrase.startBar) return false;
    if (ids.has(phrase.id)) return false;
    ids.add(phrase.id);
    cursor = phrase.endBar;
  }
  return cursor === bars;
}
