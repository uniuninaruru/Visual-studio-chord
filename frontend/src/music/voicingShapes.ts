import type { ChordQuality, Tension } from "../types/music";
import { intervalsForQuality } from "./chords";

/**
 * Voicing shapes, as candidate generators rather than as settings.
 *
 * The point is not to offer a menu. It is to widen what the search may consider
 * so the right shape can win on its own cost. Measured before this existed,
 * across eight styles at sixteen bars: every chord in the app was close
 * position, the only intervals between adjacent voices were 3, 4 and 5
 * semitones, and eighty chords produced five distinct shapes -- which is
 * exactly the number of triad inversions available, so the search had reached
 * its own ceiling. The chord track occupied MIDI 55-64, under one octave, while
 * the bass reached 57 and the melody came down to 55. All three lived in the
 * same nine semitones.
 *
 * Every function here is pure and returns semitone offsets from the root, low
 * to high. Placement in a register, and the choice between shapes, belong to
 * the caller.
 */

export type VoicingShape =
  | "close"
  | "drop2"
  | "drop3"
  | "drop24"
  | "spread"
  | "shell"
  | "rootlessA"
  | "rootlessB"
  | "quartal"
  | "doubledRoot"
  | "doubledFifth"
  | "drop2Doubled"
  | "drop3Doubled"
  | "twoHandFifth"
  | "twoHandSeventh"
  | "twoHandClose"
  | "compact";

/**
 * The same tones, folded into as little space as they will fit.
 *
 * reduceStack voices colour tones above the seventh so a thirteenth is not
 * heard as a sixth, which is right for reading the chord and wrong for playing
 * it: measured, an extended chord arrived at the voicer already eighteen
 * semitones wide, and every shape then widened it further to nearly two
 * octaves. At that width the low interval limits start to bite and the top of
 * the chord starts covering the melody.
 *
 * So each tone above the octave is offered an octave lower, taken only where
 * nothing already sounds at that pitch. Whether the folded version is better is
 * left to the cost, which is the only thing that knows where the melody is.
 */
function compactVoicing(stack: readonly number[]): number[] | null {
  if (stack.length < 4) return null;
  // Folded wherever the pitch is free, and the seconds it creates are left
  // alone on purpose.
  //
  // A ninth cannot come down without landing a tone from the root or the third
  // -- that is arithmetic, not a tuning problem -- and refusing the fold on
  // those grounds stops it happening at all: measured, declining crowded
  // landings took the fold from applying everywhere to applying nowhere, and
  // every structural figure went back with it, width 12.1 to 19.8 and inverted
  // spacing 834 to 2005.
  //
  // The seconds are also not the fault they look like. A rootless dominant
  // voicing puts its flat seventh a semitone from its thirteenth, and that
  // grinding is the sound rather than a defect in it. How much a style wants of
  // it is a matter for the cost function, which is where it now lives.
  const folded: number[] = [];
  for (const interval of stack) {
    let candidate = interval;
    while (candidate >= 12 && !folded.includes(candidate - 12)) candidate -= 12;
    folded.push(candidate);
  }
  const sorted = [...folded].sort((left, right) => left - right);
  if (new Set(sorted).size !== sorted.length) return null;
  // Folding that saved nothing is the stack it started from.
  if (shapeSpan(sorted) >= shapeSpan(stack)) return null;
  return sorted;
}

/**
 * A triad as a player actually voices it: four notes, one of them doubled.
 *
 * Nobody plays a triad with three fingers. The measured consequence of
 * pretending otherwise: the drop family needs a four-note stack, so on the
 * default path -- where every chord is a triad -- seven of the nine shapes were
 * unavailable and the search chose between close position and open position and
 * nothing else. Measured over eighty chords, jazz took spread sixty-nine times
 * and close eleven, and that alternation is what a listener hears as
 * mechanical.
 *
 * Doubling adds no pitch class, so the chord stays exactly the chord it was and
 * the drop family becomes available to it.
 */
function doubledStack(stack: readonly number[], which: "root" | "fifth"): number[] | null {
  if (stack.length !== 3) return null;
  const root = stack[0] as number;
  const fifth = stack[2] as number;
  // The root doubles at the octave above; the fifth doubles BELOW, because a
  // fifth added on top leaves the widest gap at the top of the voicing, which
  // is the one arrangement the spacing rule calls wrong. Measured: doubling it
  // upward scored nine semitones of inverted spacing on a plain triad.
  const added = which === "root" ? root + 12 : fifth - 12;
  const doubled = [...stack, added].sort((left, right) => left - right);
  if (new Set(doubled).size !== doubled.length) return null;
  return doubled;
}

/**
 * How a pianist actually holds a chord: two hands with a hole between them.
 *
 * The left hand states the foundation low and sparsely -- root and fifth, or
 * root and seventh, never a close triad down there. The right hand carries the
 * colour, closely voiced, an octave or more above. The empty middle is not a
 * gap in the voicing, it is the voicing: it is what keeps the low register
 * clear and lets the right hand read as a separate line rather than as the top
 * of one stack.
 *
 * A single evenly-spread column of notes is what a synthesiser pad does, and
 * the difference is audible immediately.
 *
 * The left hand takes the seventh where the chord has one, because root and
 * seventh state more than root and fifth do -- the fifth says nothing the root
 * has not already said.
 */
function twoHandVoicing(
  quality: ChordQuality,
  stack: readonly number[],
  lower: "fifth" | "seventh",
): number[] | null {
  const intervals = intervalsForQuality(quality);
  const fifth = intervals.find((interval) => interval === 6 || interval === 7 || interval === 8);
  const seventh = intervals.find((interval) => interval === 10 || interval === 11);
  const bottom = lower === "seventh" ? seventh : fifth;
  if (bottom === undefined) return null;

  const left = [0, bottom];
  // Everything the left hand is not already stating, voiced closely and lifted
  // clear of it. Two octaves up from the root puts the right hand above the
  // muddy register whatever the left hand took.
  // The right hand plays the chord, not the leftovers. It repeats the tone the
  // left hand took where the chord is small -- which is what a pianist does,
  // since a right hand holding one note is not a voicing.
  const right = stack
    .filter((interval) => interval !== 0)
    .map((interval) => interval + 24);
  if (right.length < 2) return null;

  const voicing = [...left, ...right].sort((a, b) => a - b);
  if (new Set(voicing).size !== voicing.length) return null;
  // The hole is the point. Without it this is just a wide stack.
  const gap = (right[0] as number) - bottom;
  if (gap < 9) return null;
  return voicing;
}

/**
 * The same two hands, closer together -- the ordinary one.
 *
 * twoHandVoicing lifts the right hand a rigid two octaves above the root, which
 * puts every voicing it makes between thirty and thirty-five semitones wide. An
 * octave lower lands between nineteen and twenty-two. Nothing in the catalogue
 * produced anything in between, and measured across three styles the gap was
 * total: of three thousand candidates offered per style, the twenty-four to
 * twenty-nine semitone band held none at all.
 *
 * That band is not an obscure corner. Two octaves is the median width of the
 * classical piano reference -- 974 files, engraved and performed, agreeing --
 * and it is the first shape a hand finds: left hand on the root and fifth, right
 * hand holding the chord from its third, an octave and a fourth above. C3-G3
 * under E4-G4-C5.
 *
 * Built by inverting rather than transposing, which is what makes the width
 * come out right. The right hand starts on the third and takes the tones above
 * it in order, wrapping what is left round the octave, so the hand holds a real
 * inversion of the chord instead of the same stack moved bodily upward.
 */
function twoHandCloseVoicing(quality: ChordQuality, stack: readonly number[]): number[] | null {
  const intervals = intervalsForQuality(quality);
  const fifth = intervals.find((interval) => interval === 6 || interval === 7 || interval === 8);
  const third = intervals.find((interval) => interval === 3 || interval === 4);
  if (fifth === undefined || third === undefined) return null;

  // Rotated to start on the third: every tone of the chord, with those below
  // the third coming back an octave up. That is an inversion rather than a
  // transposition, and it is where the width comes from -- the root ends up on
  // top, two octaves above the left hand, instead of underneath the hand where
  // a bodily transposition would leave it.
  const rotated = [...new Set(stack.map((interval) => ((interval % 12) + 12) % 12))]
    .map((pitchClass) => (pitchClass < third ? pitchClass + 12 : pitchClass))
    .sort((a, b) => a - b);
  if (rotated.length < 3) return null;

  // Placed so the hand's lowest tone sits an octave and a fourth above the root.
  const right = rotated.map((interval) => interval + 12);
  const left = [0, fifth];
  const voicing = [...left, ...right].sort((a, b) => a - b);
  if (new Set(voicing).size !== voicing.length) return null;
  // No guard on the hole, unlike twoHandVoicing, because here it cannot close:
  // the right hand starts on the third an octave up, so the gap above the
  // left hand's fifth is 16-7 at its narrowest and 15-8 at its widest -- seven
  // semitones either way. A check would be a branch nothing can reach.
  return voicing;
}

/**
 * Moves the nth voice from the top down an octave.
 *
 * This is the whole of the drop family. Dropping the second voice from the top
 * opens the gap the close stack does not have: the interval that was a third
 * becomes a sixth, and the voicing stops sounding like a block.
 *
 * Returns null when the stack is too small for the drop to mean anything -- a
 * three-note stack has no meaningful third-from-top to drop.
 */
function dropVoices(stack: readonly number[], fromTop: readonly number[]): number[] | null {
  if (stack.length < 4) return null;
  const dropped = [...stack];
  for (const n of fromTop) {
    const index = dropped.length - n;
    if (index < 0 || index >= dropped.length) return null;
    dropped[index] = (dropped[index] as number) - 12;
  }
  const sorted = [...dropped].sort((left, right) => left - right);
  // A drop that collides two voices onto one pitch is not a voicing of this
  // chord any more, it is the chord with a note missing.
  if (new Set(sorted).size !== sorted.length) return null;
  return sorted;
}

/**
 * Open position: alternate chord tones taken up an octave.
 *
 * The classical four-part sense of "open" -- soprano, alto and tenor spread so
 * no two adjacent upper voices sit within a third. Wider than a drop and the
 * reason spread voicings read as dimensional rather than merely loud.
 */
function spreadVoicing(stack: readonly number[]): number[] | null {
  if (stack.length < 3) return null;
  const opened = stack.map((interval, index) => (index % 2 === 1 ? interval + 12 : interval));
  const sorted = [...opened].sort((left, right) => left - right);
  if (new Set(sorted).size !== sorted.length) return null;
  return sorted;
}

/** Root, third, seventh. The least a chord can state and still be that chord. */
function shellVoicing(quality: ChordQuality): number[] | null {
  const intervals = intervalsForQuality(quality);
  const third = intervals.find((interval) => interval === 3 || interval === 4);
  const seventh = intervals.find((interval) => interval === 10 || interval === 11);
  // Without a seventh the shell is just the chord minus its fifth, which the
  // close voicer can already produce; without a third there is nothing to state.
  if (third === undefined || seventh === undefined) return null;
  return [0, third, seventh];
}

/**
 * Rootless voicings, the Bill Evans A and B forms.
 *
 * The left hand stops doubling what the bass is already playing, which is what
 * frees the middle register. The A form is built from the third, the B form
 * from the seventh; between them a progression alternates and the top voice
 * moves by step rather than by leap.
 *
 * Degrees, not pitches: the A form is 3-5-7-9 over most qualities, and
 * 3-13-7-9 over a dominant, where the thirteenth replaces the fifth because the
 * fifth of a dominant carries no information and the thirteenth does. The B
 * form is the same set rotated so the seventh is lowest.
 */
const ROOTLESS_A: Partial<Readonly<Record<ChordQuality, readonly number[]>>> = {
  major7: [4, 7, 11, 14],
  minor7: [3, 7, 10, 14],
  minorMajor7: [3, 7, 11, 14],
  // The fifth gives way to the thirteenth: over a dominant the fifth is the
  // one tone that states nothing the root has not already stated.
  dominant7: [4, 9, 10, 14],
  halfDiminished7: [3, 6, 10, 14],
};

const ROOTLESS_B: Partial<Readonly<Record<ChordQuality, readonly number[]>>> = {
  major7: [11, 14, 16, 19],
  minor7: [10, 14, 15, 19],
  minorMajor7: [11, 14, 15, 19],
  dominant7: [10, 14, 16, 21],
  halfDiminished7: [10, 14, 15, 18],
};

/**
 * The pitch classes a quartal stack may land on, per quality.
 *
 * Chord tones plus the colour tones that quality admits. A stack of literal
 * perfect fourths ignores the chord underneath it: four fourths from the third
 * of a dominant seventh reaches the major seventh, a note the chord does not
 * contain. Real quartal writing is fourth-shaped but stays in the chord scale,
 * so the stack snaps to this set.
 */
const QUARTAL_TONES: Partial<Readonly<Record<ChordQuality, readonly number[]>>> = {
  major: [0, 2, 4, 7, 9],
  add9: [0, 2, 4, 7, 9],
  minorAdd9: [0, 2, 3, 5, 7],
  major7: [0, 2, 4, 7, 9, 11],
  minor: [0, 2, 3, 5, 7],
  minor7: [0, 2, 3, 5, 7, 9, 10],
  minorMajor7: [0, 2, 3, 5, 7, 11],
  dominant7: [0, 2, 4, 7, 9, 10],
  halfDiminished7: [0, 3, 5, 6, 8, 10],
  sus2: [0, 2, 5, 7, 9],
  sus4: [0, 2, 5, 7, 10],
};

/** Builds one fourth-stack upward from a given starting tone. */
function stackFourthsFrom(base: number, tones: readonly number[], height: number): number[] | null {
  const stack = [base];
  for (let step = 1; step < height; step += 1) {
    const from = stack[stack.length - 1] as number;
    const target = from + 5;
    let best: number | null = null;
    // A fourth, give or take a semitone or two -- enough room to find the
    // chord's own tone without the step degenerating into a second or a sixth.
    for (let candidate = from + 3; candidate <= from + 7; candidate += 1) {
      if (!tones.includes(((candidate % 12) + 12) % 12)) continue;
      if (best === null || Math.abs(candidate - target) < Math.abs(best - target)) best = candidate;
    }
    if (best === null) return null;
    stack.push(best);
  }
  return stack;
}

/**
 * A stack of fourths that stays inside the chord.
 *
 * Fourths do not spell a triad, so the ear hears colour before it hears
 * function, which is the whole of what "transparent" means here.
 *
 * Which chord tone the stack starts from is not a free choice: it decides how
 * fourth-like the result is. The So What voicing on a minor seventh runs
 * root-fourth-seventh-third-fifth, four perfect fourths from the root; the same
 * shape started from the third collapses into a tritone. So every chord tone is
 * tried as a base and the most fourth-like stack wins, which lets the chord
 * decide rather than a rule that is right for one quality and wrong for the
 * next.
 */
function quartalVoicing(quality: ChordQuality, height: number): number[] | null {
  const tones = QUARTAL_TONES[quality];
  if (!tones) return null;

  const intervals = intervalsForQuality(quality);
  // The tone that says what the chord is. Without it in the stack the voicing
  // is a colour with no identity: G-C-F over a C bass is a fine sound but it
  // does not tell anyone the chord is minor.
  const defining = intervals.find((interval) => interval === 3 || interval === 4)
    ?? intervals.find((interval) => interval === 2 || interval === 5);

  let best: { stack: number[]; fourths: number; span: number } | null = null;
  for (const base of intervals) {
    const stack = stackFourthsFrom(base, tones, height);
    if (!stack) continue;
    const pitchClasses = stack.map((note) => ((note % 12) + 12) % 12);
    // An octave doubling inside a quartal stack defeats the point of it: the
    // shape exists to avoid stacked thirds, not to restate one tone twice.
    if (new Set(pitchClasses).size !== pitchClasses.length) continue;
    if (defining !== undefined && !pitchClasses.includes(defining % 12)) continue;
    const steps = stack.slice(1).map((note, index) => note - (stack[index] as number));
    const fourths = steps.filter((step) => step === 5).length;
    const span = shapeSpan(stack);
    if (
      best === null
      || fourths > best.fourths
      // A tie on fourths goes to the wider stack, then to the lower base, so
      // the choice is deterministic and does not depend on iteration luck.
      || (fourths === best.fourths && span > best.span)
    ) {
      best = { stack, fourths, span };
    }
  }
  // A stack with no perfect fourth in it is not a quartal voicing, it is a
  // close voicing that took a longer route to the same place.
  if (!best || best.fourths === 0) return null;
  return best.stack;
}

/** How wide a shape is, lowest to highest, in semitones. */
export function shapeSpan(intervals: readonly number[]): number {
  if (intervals.length === 0) return 0;
  return (intervals[intervals.length - 1] as number) - (intervals[0] as number);
}

export interface ShapeRequest {
  quality: ChordQuality;
  /** Colour tones already chosen for this chord. */
  tensions?: readonly Tension[];
  /** Close-position stack to transform, low to high, offsets from the root. */
  stack: readonly number[];
}

/**
 * Every shape this chord can take, as offsets from the root.
 *
 * A shape that cannot be built from this chord returns nothing rather than
 * something approximate: a drop-2 of a three-note stack and a rootless voicing
 * of a triad are both "not available here", and inventing one would put a
 * voicing in the candidate set that no player would use.
 *
 * Deterministic and order-stable, because the search downstream breaks ties by
 * position.
 */
export function shapesFor(request: ShapeRequest): Array<{ shape: VoicingShape; intervals: number[] }> {
  const { quality, stack } = request;
  // A triad is voiced in four parts before the drop family can touch it.
  const rootDoubled = doubledStack(stack, "root");
  const fifthDoubled = doubledStack(stack, "fifth");
  const built: Array<{ shape: VoicingShape; intervals: number[] | null }> = [
    { shape: "close", intervals: [...stack] },
    { shape: "doubledRoot", intervals: rootDoubled },
    { shape: "doubledFifth", intervals: fifthDoubled },
    { shape: "drop2Doubled", intervals: rootDoubled ? dropVoices(rootDoubled, [2]) : null },
    { shape: "drop3Doubled", intervals: rootDoubled ? dropVoices(rootDoubled, [3]) : null },
    { shape: "twoHandFifth", intervals: twoHandVoicing(quality, stack, "fifth") },
    { shape: "twoHandSeventh", intervals: twoHandVoicing(quality, stack, "seventh") },
    { shape: "twoHandClose", intervals: twoHandCloseVoicing(quality, stack) },
    { shape: "compact", intervals: compactVoicing(stack) },
    { shape: "drop2", intervals: dropVoices(stack, [2]) },
    { shape: "drop3", intervals: dropVoices(stack, [3]) },
    { shape: "drop24", intervals: dropVoices(stack, [2, 4]) },
    { shape: "spread", intervals: spreadVoicing(stack) },
    { shape: "shell", intervals: shellVoicing(quality) },
    { shape: "rootlessA", intervals: ROOTLESS_A[quality] ? [...(ROOTLESS_A[quality] as readonly number[])] : null },
    { shape: "rootlessB", intervals: ROOTLESS_B[quality] ? [...(ROOTLESS_B[quality] as readonly number[])] : null },
    { shape: "quartal", intervals: quartalVoicing(quality, stack.length >= 4 ? 5 : 4) },
  ];

  const seen = new Set<string>();
  const result: Array<{ shape: VoicingShape; intervals: number[] }> = [];
  for (const entry of built) {
    if (!entry.intervals || entry.intervals.length < 3) continue;
    // Two shapes that produce the same pitches are one candidate, not two, and
    // the first one wins so the set stays stable as shapes are added.
    const key = entry.intervals.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ shape: entry.shape, intervals: entry.intervals });
  }
  return result;
}


/**
 * Shapes that are two hands by construction, and where the hands divide.
 *
 * spacingInversion has to guess at the division from the pitches alone, and it
 * guesses by looking for a hole of an octave or more. That finds
 * twoHandFifth's twenty-one semitone gap and misses twoHandClose's nine, so
 * the shape added specifically to supply the missing two-octave width is
 * judged as a single stack and charged four semitones of inversion for the
 * hole that makes it what it is -- ten, in pop, which is most of the gap
 * between it and the voicing that beats it.
 *
 * Declared rather than inferred, because the catalogue knows. A shape built as
 * a left hand and a right hand can say so, and nothing that is not built that
 * way is affected by saying it.
 */
export const TWO_HAND_SHAPES: Readonly<Partial<Record<VoicingShape, number>>> = {
  // The left hand is the root and one other tone in each of these.
  twoHandFifth: 2,
  twoHandSeventh: 2,
  twoHandClose: 2,
};

/** Where a shape's hands divide, or undefined where it is played with one. */
export function handSplitFor(shape: VoicingShape): number | undefined {
  return TWO_HAND_SHAPES[shape];
}
