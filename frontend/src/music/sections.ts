import type {
  CanonicalPitchClass,
  GeneratorSettings,
  Mode,
  ProgressionTemplate,
  SectionEvent,
  SectionKind,
  SongFormId,
} from "../types/music";
import { PROGRESSION_TEMPLATES } from "./progressions";
import { deriveSeed, hashSeed, type Seed } from "./random";
import { parallelModeFor, semitoneToPitchClass, pitchClassToSemitone } from "./scales";

/**
 * Section planning: turning a bar budget into a song form.
 *
 * The research found that Japanese pop is strongly sectional — A-melo, B-melo
 * and sabi each run their own progression rather than repeating one loop — and
 * that the final chorus is very often lifted a semitone or two. Both need a
 * plan that exists before any chord is generated, which is what this produces.
 */

/**
 * Section layouts per form and bar count.
 *
 * Every layout divides its bar count evenly, so allocation is exact and no
 * section can be squeezed to zero bars. Bar counts above the largest entry
 * reuse the richest layout that still fits, stretched to length.
 */
const FORM_LAYOUTS: Readonly<
  Record<Exclude<SongFormId, "none">, Readonly<Record<number, readonly SectionKind[]>>>
> = {
  verseChorus: {
    4: ["verse", "chorus"],
    8: ["verse", "preChorus", "chorus", "chorus"],
    16: [
      "intro",
      "verse",
      "preChorus",
      "chorus",
      "verse",
      "preChorus",
      "chorus",
      "outro",
    ],
  },
  aaba: {
    4: ["verse", "verse", "bridge", "verse"],
    8: ["verse", "verse", "bridge", "verse"],
    16: ["verse", "verse", "bridge", "verse"],
  },
  throughComposed: {
    4: ["intro", "verse", "chorus", "outro"],
    8: ["intro", "verse", "chorus", "outro"],
    16: [
      "intro",
      "verse",
      "preChorus",
      "chorus",
      "bridge",
      "chorus",
      "outro",
      "outro",
    ],
  },
};

/** Progression usages that suit each section kind, most specific first. */
const USAGE_FOR_KIND: Readonly<Record<SectionKind, readonly string[]>> = {
  intro: ["verse", "any"],
  verse: ["verse", "any"],
  preChorus: ["preChorus", "verse", "any"],
  chorus: ["chorus", "any"],
  bridge: ["bridge", "any"],
  outro: ["chorus", "any"],
};

export function isSongFormId(value: unknown): value is SongFormId {
  return (
    value === "none" ||
    value === "verseChorus" ||
    value === "aaba" ||
    value === "throughComposed"
  );
}

/**
 * The most detailed layout a bar count can carry, for lengths with no entry of
 * their own.
 *
 * The largest table entry that is not longer than the piece, stretched across
 * it. Falling back to the eight-bar layout instead — as this did — gives a
 * forty-eight bar song four twelve-bar blocks with no intro or outro, and a
 * twelve-bar pre-chorus is not a pre-chorus. Taking the sixteen-bar layout
 * gives the same song eight six-bar sections, which is what the form means.
 */
function richestLayoutWithin(
  layouts: Readonly<Record<number, readonly SectionKind[]>>,
  bars: number,
): readonly SectionKind[] {
  let best: readonly SectionKind[] = [];
  let bestBars = 0;
  for (const [key, kinds] of Object.entries(layouts)) {
    const layoutBars = Number(key);
    if (layoutBars > bars || layoutBars < bestBars) continue;
    // A section must never be squeezed to zero bars.
    if (kinds.length > bars) continue;
    best = kinds;
    bestBars = layoutBars;
  }
  return best;
}

/**
 * Splits `bars` across `count` sections, distributing any remainder to the
 * earliest sections so the parts always sum to exactly `bars`.
 */
/**
 * How much of the piece each kind of section is worth.
 *
 * An even split is not a song shape. Measured before this existed: a sixteen
 * bar verse-chorus form is eight sections, so every one of them got two bars --
 * a two-bar verse followed by a two-bar pre-chorus followed by a two-bar
 * chorus. That is not a structure, it is a slideshow, and nothing at that rate
 * reads as an arrival.
 */
const SECTION_WEIGHT: Readonly<Record<SectionKind, number>> = {
  intro: 1,
  verse: 2,
  preChorus: 1,
  chorus: 2,
  bridge: 1.5,
  outro: 1,
};

/**
 * Splits the piece between its sections by weight, in whole bars.
 *
 * Allocated per KIND rather than per section, so the two choruses of a
 * verse-chorus form are the same length as each other. Distributing bar by bar
 * gave one verse three bars and the next two, which stops a repeated section
 * being a repeat at all -- the progression is restated over a different number
 * of bars and comes out as different music.
 *
 * Every section keeps at least one bar however thin its share, because a
 * section of no length is a section that is not there, and the remainder goes
 * to the heaviest kinds first so a chorus gains the odd bar rather than an
 * intro.
 */
function allocateBars(bars: number, kinds: readonly SectionKind[]): number[] {
  const count = kinds.length;
  if (count === 0) return [];
  if (bars <= count) return Array.from({ length: count }, () => 1);

  const occurrences = new Map<SectionKind, number>();
  for (const kind of kinds) occurrences.set(kind, (occurrences.get(kind) ?? 0) + 1);

  // Weight per kind is its own weight times how often it appears, since two
  // choruses take twice the room of one.
  const order = [...occurrences.keys()]
    .sort((left, right) => SECTION_WEIGHT[right] - SECTION_WEIGHT[left] || left.localeCompare(right));
  const total = order.reduce(
    (sum, kind) => sum + SECTION_WEIGHT[kind] * (occurrences.get(kind) as number), 0,
  );

  const perKind = new Map<SectionKind, number>();
  for (const kind of order) {
    const times = occurrences.get(kind) as number;
    const share = Math.floor((bars * SECTION_WEIGHT[kind] * times) / total / times);
    perKind.set(kind, Math.max(1, share));
  }

  let spare = bars - order.reduce(
    (sum, kind) => sum + (perKind.get(kind) as number) * (occurrences.get(kind) as number), 0,
  );
  let cursor = 0;
  // A whole kind at a time, so its instances stay equal to one another.
  while (spare > 0 && order.length > 0) {
    const kind = order[cursor % order.length] as SectionKind;
    const times = occurrences.get(kind) as number;
    if (times <= spare) {
      perKind.set(kind, (perKind.get(kind) as number) + 1);
      spare -= times;
    }
    cursor += 1;
    // Nothing left that fits: the remaining bars go to the last section rather
    // than leaving the piece short of the length that was asked for.
    if (cursor > order.length * 2) break;
  }

  const lengths = kinds.map((kind) => perKind.get(kind) as number);
  const allocated = lengths.reduce((sum, length) => sum + length, 0);
  if (allocated !== bars && lengths.length > 0) {
    lengths[lengths.length - 1] = Math.max(1, (lengths[lengths.length - 1] as number) + (bars - allocated));
  }
  return lengths;
}

/**
 * Picks a progression for one section.
 *
 * Selection hashes the candidate's stable id rather than indexing the array, so
 * adding a template to the catalogue does not silently rewrite every existing
 * seed's output.
 */
function chooseProgression(
  seed: Seed,
  kind: SectionKind,
  mode: Mode,
  sectionIndex: number,
  exclude: ReadonlySet<string>,
  widenThinTiers = false,
): ProgressionTemplate | undefined {
  const usable = PROGRESSION_TEMPLATES.filter((template) =>
    template.modes.includes(mode),
  );
  if (usable.length === 0) return undefined;

  const gathered: ProgressionTemplate[] = [];
  for (const usage of USAGE_FOR_KIND[kind]) {
    const matching = usable.filter((template) => (template.usage ?? "any") === usage);
    const fresh = matching.filter((template) => !exclude.has(template.id));
    const pool = fresh.length > 0 ? fresh : matching;
    if (pool.length === 0) continue;
    gathered.push(...pool.filter((template) => !gathered.includes(template)));
    // A tier with one template in it is not a choice, it is a constant, and a
    // tier with two is a coin toss.
    //
    // Measured: exactly one template in the whole catalogue was marked for a
    // bridge, so every major-key bridge in every piece was the same four
    // chords -- forty out of forty. Stopping as soon as there were two moved
    // the problem rather than fixing it. Once the minor catalogue was widened,
    // a minor chorus had exactly two templates marked for it and drew from
    // those two across forty seeds; merging until there are more than two takes
    // it to eight.
    //
    // Major output is unchanged by the threshold -- every major tier is already
    // deeper than two -- and mixolydian and the minor modes are not, which is
    // the point of the setting rather than a side effect of it.
    if (!widenThinTiers || gathered.length > 2) break;
  }
  if (gathered.length === 0) return usable[0];

  // Rank by a per-section hash of the id, then take the winner. Stable under
  // catalogue growth because each id scores independently of the others.
  const ranked = [...gathered].sort((left, right) => {
    const l = hashSeed(deriveSeed(seed, "section-progression", sectionIndex, left.id));
    const r = hashSeed(deriveSeed(seed, "section-progression", sectionIndex, right.id));
    return l - r || left.id.localeCompare(right.id);
  });
  return ranked[0];
}

export interface SectionPlanOptions {
  key: GeneratorSettings["key"];
  mode: Mode;
  bars: number;
  seed: Seed;
  form: SongFormId;
  /** Semitones the last section lifts by. 0 or undefined disables. */
  finalLift?: number;
  /** Runs melodies in the parallel mode of each section's harmony. */
  polytonal?: boolean;
  melodyScale?: SectionEvent["melodyScale"];
  /** Lets a section whose own usage tier holds one template draw from the next. */
  variedThinSections?: boolean;
}

/**
 * Builds the section plan for a piece.
 *
 * Returns undefined for form "none" so a piece without a requested form keeps
 * generating exactly as it did before sections existed.
 */
export function planSections(
  options: SectionPlanOptions,
): SectionEvent[] | undefined {
  if (options.form === "none") return undefined;

  const layouts = FORM_LAYOUTS[options.form];
  const kinds = layouts[options.bars] ?? richestLayoutWithin(layouts, options.bars);
  if (kinds.length === 0) return undefined;

  const lengths = allocateBars(options.bars, kinds);
  const rootSemitone = pitchClassToSemitone(options.key);
  const lift = Number.isFinite(options.finalLift) ? Math.trunc(options.finalLift ?? 0) : 0;
  const throughComposed = options.form === "throughComposed";
  const used = new Set<string>();
  /** Progression chosen for each kind, so repeated sections restate it. */
  const byKind = new Map<SectionKind, string>();

  const sections: SectionEvent[] = [];
  let startBar = 0;
  for (const [index, kind] of kinds.entries()) {
    const length = lengths[index] as number;
    const isLast = index === kinds.length - 1;
    // Only the final section lifts; that is the "truck driver" modulation the
    // research describes, not a key change on every section.
    const transpose = isLast && lift !== 0 ? lift : 0;
    const key = transpose === 0
      ? semitoneToPitchClass(rootSemitone)
      : semitoneToPitchClass(rootSemitone + transpose);

    // Repeated sections are the point of a repeating form: the second A of an
    // AABA and the returning chorus must restate their material, not invent new
    // material. Through-composed is the opposite — it never looks back, so each
    // section takes a progression none of the earlier ones used.
    let progressionId = throughComposed ? undefined : byKind.get(kind);
    if (progressionId === undefined) {
      // `used` is excluded in every form: repeats are already served by the
      // byKind lookup above, so reaching here means this is a *new* kind, and a
      // pre-chorus that restates the verse note-for-note is not a pre-chorus.
      const template = chooseProgression(
        options.seed,
        kind,
        options.mode,
        throughComposed ? index : 0,
        used,
        options.variedThinSections ?? false,
      );
      progressionId = template?.id;
      if (template) {
        used.add(template.id);
        if (!throughComposed) byKind.set(kind, template.id);
      }
    }

    sections.push({
      id: `section-${index}-${kind}`,
      kind,
      startBar,
      endBar: startBar + length,
      key: key as CanonicalPitchClass,
      mode: options.mode,
      transpose,
      ...(options.polytonal ? { melodyMode: parallelModeFor(options.mode) } : {}),
      ...(options.melodyScale && options.melodyScale !== "diatonic"
        ? { melodyScale: options.melodyScale }
        : {}),
      ...(progressionId ? { progressionId } : {}),
    });
    startBar += length;
  }
  return sections;
}

/** The section covering a bar, or undefined when the piece has no sections. */
export function sectionForBar(
  sections: readonly SectionEvent[] | undefined,
  barIndex: number,
): SectionEvent | undefined {
  if (!sections) return undefined;
  return sections.find(
    (section) => barIndex >= section.startBar && barIndex < section.endBar,
  );
}

/**
 * Checks that sections tile [0, bars) exactly: ordered, contiguous, no gaps or
 * overlaps, each at least one bar, and unique ids.
 */
export function sectionsTileBars(
  sections: readonly SectionEvent[],
  bars: number,
): boolean {
  if (sections.length === 0) return false;
  const ids = new Set<string>();
  let cursor = 0;
  for (const section of sections) {
    if (!Number.isInteger(section.startBar) || !Number.isInteger(section.endBar)) {
      return false;
    }
    if (section.startBar !== cursor || section.endBar <= section.startBar) return false;
    if (ids.has(section.id)) return false;
    ids.add(section.id);
    cursor = section.endBar;
  }
  return cursor === bars;
}
