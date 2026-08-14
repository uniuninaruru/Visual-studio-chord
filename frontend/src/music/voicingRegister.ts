/**
 * The whole vertical space at one moment.
 *
 * A voicer that looks only at the chord it is writing cannot tell that the bass
 * is already on that note, that the melody is about to cross under it, or that
 * the interval it just wrote is too low to stay clear. Measured before this
 * existed: the bass reached MIDI 57, the chord track occupied 55-64, and the
 * melody came down to 55. All three tracks shared the same nine semitones, and
 * nothing in the code was in a position to notice.
 *
 * Everything here is a pure function of pitches. No settings, no seeds.
 */

/**
 * The lowest pitch at which each interval still sounds as a chord rather than
 * as a rumble, in MIDI numbers, keyed by the interval in semitones.
 *
 * This is the standard orchestration low-interval-limit table. The reason it
 * exists is critical bandwidth: two tones closer together than the ear's
 * resolving bandwidth at that frequency fuse into roughness instead of
 * harmony, and that bandwidth widens as frequency falls. So a major third that
 * is perfectly clear at middle C is mud two octaves down, while a fifth, being
 * wider, stays clear much lower.
 *
 * Intervals wider than an octave are not listed: above an octave the limit
 * stops binding, which is precisely why spread and drop voicings can sit low
 * where a close voicing cannot.
 */
export const LOW_INTERVAL_LIMITS: Readonly<Record<number, number>> = {
  1: 52,  // minor 2nd  -- E3
  2: 52,  // major 2nd  -- E3
  3: 45,  // minor 3rd  -- A2
  4: 41,  // major 3rd  -- F2
  5: 38,  // perfect 4th -- D2
  6: 42,  // tritone    -- F#2
  7: 35,  // perfect 5th -- B1
  8: 44,  // minor 6th  -- G#2
  9: 41,  // major 6th  -- F2
  10: 38, // minor 7th  -- D2
  11: 38, // major 7th  -- D2
  12: 28, // octave     -- E1
};

/**
 * How far below its limit each adjacent interval sits, summed.
 *
 * Zero means every interval is clear. The figure is in semitones of violation,
 * so it is comparable across chords and can be reported as a number rather than
 * as an opinion.
 */
export function lowIntervalViolation(notes: readonly number[]): number {
  let total = 0;
  for (let index = 1; index < notes.length; index += 1) {
    const lower = notes[index - 1] as number;
    const gap = (notes[index] as number) - lower;
    // Only intervals up to an octave are constrained; wider ones are clear by
    // construction, which is the whole reason an open voicing can sit low.
    if (gap <= 0) continue;
    // Nothing above an octave is listed, and that absence is the rule rather
    // than an omission: past an octave the limit stops binding, which is
    // precisely why an open voicing can sit where a close one cannot.
    const limit = LOW_INTERVAL_LIMITS[gap];
    if (limit !== undefined && lower < limit) total += limit - lower;
  }
  return total;
}

/**
 * How far the voicing departs from wide-at-the-bottom, close-at-the-top.
 *
 * The natural spacing of a sounding body, and of every idiomatic keyboard
 * voicing: the gaps shrink as the voicing rises. A voicing spaced the other way
 * -- a tight cluster underneath and a gaping hole on top -- is the specific
 * arrangement that reads as thin and unresolved.
 *
 * Returns the total inversion of that order, in semitones, so zero means the
 * gaps never widen going up.
 */
export function spacingInversion(notes: readonly number[]): number {
  if (notes.length < 3) return 0;

  // A two-handed voicing is not one stack, it is two, with a deliberate hole
  // between them. The rule that gaps should shrink going up is a rule about
  // what one hand does; applied across the hole it condemns exactly the
  // voicing a pianist reaches for first. Measured: it scored fourteen
  // semitones of "inversion" against a left-hand root and fifth under a
  // close right-hand chord, which is the most ordinary shape there is.
  //
  // So a gap of an octave or more splits the voicing, and each side is judged
  // on its own.
  let splitAt = -1;
  let widest = 0;
  for (let index = 1; index < notes.length; index += 1) {
    // Both sides must be a hand. A lone voice above a gap is not a right hand,
    // it is a stray note an octave up, and reading it as a second hand excuses
    // exactly the top-heavy spacing this measures.
    if (index < 2 || notes.length - index < 2) continue;
    const gap = (notes[index] as number) - (notes[index - 1] as number);
    if (gap >= 12 && gap > widest) { widest = gap; splitAt = index; }
  }
  if (splitAt > 0) {
    return spacingInversion(notes.slice(0, splitAt)) + spacingInversion(notes.slice(splitAt));
  }

  let total = 0;
  for (let index = 2; index < notes.length; index += 1) {
    const lower = (notes[index - 1] as number) - (notes[index - 2] as number);
    const upper = (notes[index] as number) - (notes[index - 1] as number);
    if (upper > lower) total += upper - lower;
  }
  return total;
}

export interface RegisterContext {
  /** The bass track's sounding pitch under this chord, if there is one. */
  bass?: number;
  /** Melody pitches sounding while this chord is held. */
  melody?: readonly number[];
}

/**
 * How badly the voicing sits against the melody above it.
 *
 * Two separate faults, both measured in semitones.
 *
 * A chord voice at or above the melody covers it: the ear takes the highest
 * pitch as the line, so a chord tone above the melody note simply becomes the
 * melody, and the written melody disappears into the texture. Measured before
 * this existed, in the jazz style, forty-five of eighty chord spans had the
 * melody at or below the chord's top note.
 *
 * A chord tone a minor ninth below a melody note is the specific harsh clash --
 * thirteen semitones, not one and not fourteen. The octave displacement is what
 * makes it harsh rather than merely dissonant. The one accepted exception is a
 * dominant chord's own flat ninth, which is why the caller passes the tones
 * that are allowed to form it.
 */
export function melodyConflict(
  notes: readonly number[],
  melody: readonly number[] | undefined,
  permittedMinorNinths: ReadonlySet<number> = new Set(),
): { covering: number; minorNinth: number } {
  if (!melody || melody.length === 0) return { covering: 0, minorNinth: 0 };
  const top = Math.max(...notes);
  const lowestMelody = Math.min(...melody);

  // Only the amount by which it covers, so a chord that clears the melody by a
  // wide margin is not rewarded over one that clears it by a comfortable one.
  const covering = Math.max(0, top - lowestMelody + 1);

  let minorNinth = 0;
  for (const melodyNote of melody) {
    for (const chordNote of notes) {
      if (melodyNote - chordNote !== 13) continue;
      if (permittedMinorNinths.has(((chordNote % 12) + 12) % 12)) continue;
      minorNinth += 1;
    }
  }
  return { covering, minorNinth };
}

/**
 * There is no bass-crowding term, and that is deliberate.
 *
 * There was one: it charged a voicing whose lowest note sat closer than a major
 * tenth to the bass, on the orchestration convention that the next voice up
 * needs that much room. It never charged anything, because no caller ever
 * passed it a bass -- and wiring one would not have helped. buildCompositionTracks
 * takes the bass from the chord's own lowest note, so the gap it would measure
 * is either zero, before bassRegisterPitch moves it, or a whole number of
 * octaves after. Zero for every candidate and twelve for every candidate are
 * the same thing to a search: a constant added to the whole field, deciding
 * nothing.
 *
 * The convention is real. It applies where the bass is an independent line,
 * which is not this architecture. If one ever arrives, this is the term to
 * write, and the reason it was removed is that it could not have worked rather
 * than that the idea is wrong.
 */

/** Lowest to highest, in semitones. */
export function span(notes: readonly number[]): number {
  if (notes.length === 0) return 0;
  return Math.max(...notes) - Math.min(...notes);
}

/**
 * Adjacent voices a tone or less apart, weighted by how low they sound.
 *
 * A second inside a chord is a colour in some hands and a smear in others. A
 * ninth sounding against the root is the whole point of an add9, and a rock
 * keyboard playing the same interval is a mistake -- so how much it costs is a
 * style decision, and this only counts them.
 *
 * Weighted downward by register because the same interval that reads as colour
 * at the top of the keyboard reads as mud at the bottom, for the same reason
 * the low interval limits exist.
 */
export function clusterCount(notes: readonly number[]): number {
  let total = 0;
  for (let index = 1; index < notes.length; index += 1) {
    const gap = (notes[index] as number) - (notes[index - 1] as number);
    if (gap <= 0 || gap > 2) continue;
    const lower = notes[index - 1] as number;
    // Middle C and above is where a second stops being mud; below that it
    // counts for more, up to double at the bottom of the register.
    total += lower >= 60 ? 1 : 1 + Math.min(1, (60 - lower) / 24);
  }
  return total;
}
