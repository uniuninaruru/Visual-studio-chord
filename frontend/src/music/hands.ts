import { LOW_INTERVAL_LIMITS } from "./voicingRegister";

/**
 * Which hand plays which note, decided rather than derived.
 *
 * The app had no left hand. It voiced one chord of three to five notes and then
 * split it by pitch: `pitches[0]` to the bass track, `pitches.slice(1)` to the
 * chord track. A split by lowest note can only ever give the left hand one note,
 * and measured across eight styles and four seeds that is exactly what happened
 * -- 0 polyphonic onsets out of 102 per style, without a single exception, in a
 * band eleven semitones wide.
 *
 * A voicing, by definition, is "which notes are on the top or in the middle,
 * which ones are doubled, which octave each is in, and which instruments or
 * voices perform each note" (Wikipedia, "Voicing (music)"). This app decided the
 * first three and let the fourth fall out of the third.
 *
 * ## The shell
 *
 * What a pianist's left hand actually holds is a shell: root with a fifth, a
 * seventh, an octave or a tenth. Bud Powell's are catalogued as R+3, R+7 and
 * R+10, and the reason the wide ones exist is register -- a tenth or a seventh
 * can be played low without turning to mud where a third or a close four-note
 * structure cannot. The pedagogy states the same bound the other way round: keep
 * a close left-hand voicing's lowest note between C3 and C4, and do not put
 * four-note structures below that.
 *
 * This app already holds that rule as data. LOW_INTERVAL_LIMITS says how low
 * each interval may be placed before its two tones fuse into roughness, and it
 * lists nothing above an octave -- which is not an omission. Past an octave the
 * limit stops binding, and that is precisely why the tenth is the interval a
 * left hand reaches for down there.
 *
 * So the partner interval is not a style preference. It is read off the bass
 * note: the lower the bass, the wider the shell has to be, and the table says
 * how wide. A bass at D2 can carry a seventh (limit D2) but not a third (limit
 * A2).
 *
 * ## The bass does not move
 *
 * The shell is added ABOVE the note the voicer already chose, never below it.
 * Dropping the foundation further to make room would trade one kind of mud for
 * another, and the register the bass occupies now is the product of the whole
 * cost model -- the inversion it preserves, the line it makes with the chord
 * before it. The left hand gets thicker, not lower.
 */

/**
 * Shell intervals above the bass, in the order a left hand reaches for them.
 *
 * Both tenths, then both sevenths, then the fifth, and the octave last.
 *
 * Not widest-first, which was the first ordering and was wrong. The octave is
 * the one interval that is always available -- it is the bass's own pitch class,
 * so it is always a chord tone, and being wider than the table's largest entry
 * it always clears the limits. Tried before the sevenths it wins essentially
 * every time: measured, 414 of 432 shells came out as octaves and not one as a
 * tenth. An octave is a real left hand and a common one, but it is the plainest
 * of these and it should be the fallback, not the default.
 *
 * The minor tenth was missing from that first list altogether, which meant a
 * minor chord could never have one: from the root, a major tenth is 16
 * semitones and a minor tenth is 15.
 */
const SHELL_INTERVALS = [16, 15, 10, 11, 7, 12] as const;

export interface HandAssignment {
  /** Lowest first. One note when no shell partner fits. */
  left: number[];
  /** Lowest first. */
  right: number[];
}

export interface HandOptions {
  /**
   * Off returns the split this replaces -- lowest note left, remainder right --
   * so a piece generated without it is unchanged to the semitone.
   */
  shell: boolean;
  /**
   * The bass note, already placed in its register by the caller. Separate from
   * `notes` because the register drop happens upstream and the pitch it lands
   * on is what the shell has to be measured from.
   */
  bass: number;
}

/**
 * Whether an interval may be placed with its lower tone at this pitch.
 *
 * Intervals wider than an octave are not in the table and are always clear,
 * which is the tenth's whole reason for existing in a left hand.
 */
export function intervalFitsRegister(lower: number, interval: number): boolean {
  const limit = LOW_INTERVAL_LIMITS[interval];
  return limit === undefined || lower >= limit;
}

/**
 * Whether adding this pitch leaves every adjacent interval in the voicing clear.
 *
 * Checking the shell interval alone is not enough, and measured it was wrong:
 * the partner also becomes a neighbour of whatever right-hand note sits above
 * it, and that new pair has its own limit. Thirteen violations appeared in 825
 * chords from exactly this -- an interval that was legal from the bass, illegal
 * against the note above it.
 */
function clearsLimitsWith(sorted: readonly number[], partner: number): boolean {
  const merged = [...sorted, partner].sort((left, right) => left - right);
  for (let index = 1; index < merged.length; index += 1) {
    const lower = merged[index - 1] as number;
    const gap = (merged[index] as number) - lower;
    if (gap <= 0) continue;
    const limit = LOW_INTERVAL_LIMITS[gap];
    if (limit !== undefined && lower < limit) return false;
  }
  return true;
}

/**
 * A semitone or a minor ninth against anything already sounding.
 *
 * The minor ninth is the interval the voicer already treats as the one clash
 * worth naming, and a left-hand partner can create one against a right-hand
 * tension that the voicer never saw because the partner did not exist yet. Ten
 * of them appeared in 825 chords before this check.
 */
function clashesWith(others: readonly number[], partner: number): boolean {
  return others.some((note) => {
    const gap = Math.abs(note - partner);
    return gap === 1 || gap === 13;
  });
}

/**
 * Splits a voicing into two hands, giving the left one a shell where the
 * register allows it.
 *
 * `notes` is the voicing as the cost model chose it; `bass` is its lowest note
 * after the bass register has had its say. The partner is drawn from the
 * chord's own sounding pitch classes, so nothing foreign is introduced and the
 * chord still spells what its symbol says.
 *
 * The two hands are returned as pitch sets rather than as a split point,
 * because there is no split point to return: the partner routinely sits above
 * some right-hand notes, which is what a left hand reaching a tenth does and
 * what the corpus study permits when it lets the hands overlap without
 * restriction. An index into the sorted voicing cannot say that, and saying it
 * with one was the first attempt -- measured, it mislabelled the hands often
 * enough to report shell intervals of four and five semitones that were never
 * chosen.
 */
export function assignHands(
  notes: readonly number[],
  options: HandOptions,
): HandAssignment {
  const sorted = [...notes].sort((left, right) => left - right);
  const upper = sorted.slice(1);
  if (!options.shell || upper.length === 0) {
    return { left: [options.bass], right: upper };
  }

  const sounding = new Set(sorted.map((note) => ((note % 12) + 12) % 12));
  const withBass = [options.bass, ...upper].sort((left, right) => left - right);
  const ceiling = upper[upper.length - 1] as number;

  for (const interval of SHELL_INTERVALS) {
    if (!intervalFitsRegister(options.bass, interval)) continue;
    const partner = options.bass + interval;
    if (!sounding.has(((partner % 12) + 12) % 12)) continue;
    // Doubling at the unison adds no width and no weight, which is the one
    // thing a second left-hand note is for.
    if (upper.includes(partner)) continue;
    // Below the top of the right hand. The left hand may pass through the
    // right hand's register -- real playing does it constantly -- but a left
    // hand over the top of the chord is a different texture than this one.
    if (partner >= ceiling) continue;
    if (clashesWith(upper, partner)) continue;
    if (!clearsLimitsWith(withBass, partner)) continue;
    return { left: [options.bass, partner], right: upper };
  }

  return { left: [options.bass], right: upper };
}

/** The widest reach of one hand, in semitones. */
export function handSpan(hand: readonly number[]): number {
  if (hand.length < 2) return 0;
  return Math.max(...hand) - Math.min(...hand);
}

/**
 * The biomechanical reach of one hand.
 *
 * Nineteen semitones -- roughly a major tenth plus a step -- is the window a
 * corpus study of ~19.3 million playable piano chords uses per hand, and the
 * same study lets the two hands overlap in pitch without restriction. Both
 * halves of that matter here: the shell may be wide, and it may reach into the
 * register the right hand is using.
 */
export const MAX_HAND_SPAN = 19;
