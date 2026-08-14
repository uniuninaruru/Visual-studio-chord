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
/**
 * The fewest bars a section can be and still be that section.
 *
 * Four, because that is where this app's own phrase grammar begins: its
 * four-bar layout is an antecedent and a consequent, and eight is the full
 * sentence. Below that a section has no room to state anything and then
 * answer it.
 *
 * Measured before this bound existed: sixteen bars took the eight-section
 * layout and produced intro(1) verse(3) preChorus(1) chorus(3) verse(3)
 * preChorus(1) chorus(3) outro(1). A one-bar pre-chorus is not a pre-chorus,
 * and everything downstream reads it as one -- the register arc, the dynamics
 * arc, the progression choice and the approach chord at its seam all treat a
 * single bar as a formal section.
 */
const MIN_SECTION_BARS = 4;

/**
 * The richest layout the piece has room for.
 *
 * Room means bars per section, not bars: a layout is only available if every
 * section it asks for can reach MIN_SECTION_BARS. Where nothing does -- a
 * four-bar piece cannot hold two four-bar sections -- the simplest layout is
 * used rather than none, since a short piece with a crowded form is still
 * better than a short piece the section work cannot reach at all.
 */
function richestLayoutWithin(
  layouts: Readonly<Record<number, readonly SectionKind[]>>,
  bars: number,
): readonly SectionKind[] {
  let best: readonly SectionKind[] = [];
  let bestBars = 0;
  let fewest: readonly SectionKind[] = [];
  for (const [key, kinds] of Object.entries(layouts)) {
    const layoutBars = Number(key);
    // A section must never be squeezed to zero bars.
    if (kinds.length > bars) continue;
    if (fewest.length === 0 || kinds.length < fewest.length) fewest = kinds;
    if (layoutBars > bars || layoutBars < bestBars) continue;
    if (bars / kinds.length < MIN_SECTION_BARS) continue;
    best = kinds;
    bestBars = layoutBars;
  }
  return best.length > 0 ? best : fewest;
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

  // The floor every kind gets before weight is applied at all.
  //
  // Choosing a layout by bars-per-section is not enough on its own: the weights
  // then redistribute, and a light kind falls back under the minimum. Measured
  // with only the layout bound in place, sixteen bars gave verse(4)
  // preChorus(2) chorus(5) chorus(5) -- a two-bar pre-chorus in a form that had
  // just been chosen for having room for four.
  //
  // Never more than the piece can pay for, so a short piece still divides
  // evenly rather than demanding bars it does not have.
  const floorBars = Math.min(MIN_SECTION_BARS, Math.floor(bars / count));

  // The floor first, the weights only over what is left.
  //
  // Weighting first and then repairing the result does not work: applying the
  // floor afterwards overshoots the bar count, and trimming back takes the
  // bars from the lightest kinds -- which are exactly the ones that were at
  // the floor. Measured that way, thirty-two bars gave preChorus two bars in a
  // layout that had just been chosen for having room for four.
  //
  // Distributing the floor first cannot overshoot, since floorBars is at most
  // bars/count, and the spare below is what carries the weighting.
  const perKind = new Map<SectionKind, number>(order.map((kind) => [kind, floorBars]));

  // What is left after the floor, shared out by weight.
  //
  // Proportional with a largest-remainder pass, not the round robin this
  // replaced. Round robin gave every kind one bar per cycle whatever its
  // weight, so with enough spare every section came out the same length and
  // the weights only decided who won the final partial cycle -- measured,
  // forty-eight bars gave all eight sections six bars each. Its fallback,
  // dumping whatever would not divide into the last section, gave one verse of
  // an AABA piece twenty-eight bars.
  //
  // A kind is bought in whole units of its own occurrences, so two choruses
  // stay the same length as each other.
  const spare = bars - floorBars * count;
  if (spare > 0) {
    const weightOf = (kind: SectionKind) =>
      SECTION_WEIGHT[kind] * (occurrences.get(kind) as number);
    const totalWeight = order.reduce((sum, kind) => sum + weightOf(kind), 0);

    const wanted = new Map<SectionKind, number>();
    let handedOut = 0;
    for (const kind of order) {
      const times = occurrences.get(kind) as number;
      // Rounded down to a whole number of bars per instance, so the kind's
      // instances stay equal.
      const perInstance = Math.floor((spare * weightOf(kind)) / totalWeight / times);
      wanted.set(kind, perInstance);
      handedOut += perInstance * times;
    }

    // The remainder, a bar at a time to the heaviest kind that can still take
    // one, so the chorus gains it rather than the intro.
    let remaining = spare - handedOut;
    for (const kind of order) {
      const times = occurrences.get(kind) as number;
      while (remaining >= times) {
        wanted.set(kind, (wanted.get(kind) as number) + 1);
        remaining -= times;
      }
    }

    for (const kind of order) {
      perKind.set(kind, (perKind.get(kind) as number) + (wanted.get(kind) as number));
    }
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
  // The exact-length layout is subject to the same room rule as the fallback:
  // sixteen bars has an entry asking for eight sections, and two bars each is
  // not a form.
  const exact = layouts[options.bars];
  const kinds = exact !== undefined && options.bars / exact.length >= MIN_SECTION_BARS
    ? exact
    : richestLayoutWithin(layouts, options.bars);
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
