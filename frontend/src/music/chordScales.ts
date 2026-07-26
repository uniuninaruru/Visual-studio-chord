import type {
  ChordEvent,
  ChordQuality,
  Mode,
  PitchClassName,
  Tension,
} from "../types/music";
import { intervalsForQuality } from "./chords";
import { getScaleSemitones, pitchClassToSemitone } from "./scales";

/**
 * Chord-scale theory.
 *
 * The engine knew which notes were in a chord and which were in the key, and
 * treated everything else as outside. That is enough to write a correct line and
 * not enough to write an idiomatic one, because it cannot say *which* outside
 * notes belong over *which* chord. Over a V7 in C the note Ab is wrong if the
 * scale is Mixolydian and is the whole point if the scale is altered; over a
 * Imaj7 the note F is diatonic and still has to be passed through rather than
 * landed on.
 *
 * A chord-scale answers that. Each chord is matched with the scales that contain
 * it, ranked by how much of the key they keep, and each match reports the notes
 * that are available and the ones that are avoid notes — the classic rule being
 * that a non-chord tone a semitone above a chord tone will not bear weight.
 */

export type ChordScaleName =
  | "ionian"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "aeolian"
  | "locrian"
  | "harmonicMinor"
  | "melodicMinor"
  | "lydianDominant"
  | "altered"
  | "phrygianDominant"
  | "wholeTone"
  | "halfWholeDiminished"
  | "wholeHalfDiminished";

/** Each scale as semitones above the chord root. */
export const CHORD_SCALES: Readonly<Record<ChordScaleName, readonly number[]>> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  /** Fourth mode of melodic minor: a dominant with a natural 13 and a #11. */
  lydianDominant: [0, 2, 4, 6, 7, 9, 10],
  /** Seventh mode of melodic minor. Every extension of a dominant, altered. */
  altered: [0, 1, 3, 4, 6, 8, 10],
  /** Fifth mode of harmonic minor: the dominant of a minor key. */
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  /** For dominants: gives b9, #9, #11 and a natural 13. */
  halfWholeDiminished: [0, 1, 3, 4, 6, 7, 9, 10],
  /** For diminished sevenths. */
  wholeHalfDiminished: [0, 2, 3, 5, 6, 8, 9, 11],
};

export const CHORD_SCALE_NAMES = Object.keys(CHORD_SCALES) as ChordScaleName[];

export interface ChordScaleCandidate {
  scale: ChordScaleName;
  /** Semitones above the chord root. */
  intervals: readonly number[];
  /** Absolute pitch classes, 0..11. */
  pitchClasses: number[];
  /**
   * Pitch classes that will not bear weight over this chord.
   *
   * A non-chord scale tone a semitone above a chord tone rubs against it hard
   * enough that it has to be passed through. The root is exempt: the semitone
   * below the root is the leading tone, which is the opposite of a problem.
   */
  avoidNotes: number[];
  /** Pitch classes that are neither chord tones nor avoid notes. */
  availableNotes: number[];
  /** Colour tones this scale makes available over the chord. */
  tensions: Tension[];
  /** 0..1. Higher fits the chord and the key better. */
  fit: number;
  /** Notes of the scale that are outside the key. */
  outsideKey: number;
}

/** Which colour tone a semitone distance above the root corresponds to. */
const TENSION_FOR_INTERVAL: Readonly<Record<number, Tension>> = {
  1: "b9",
  2: "9",
  3: "#9",
  5: "11",
  6: "#11",
  8: "b13",
  9: "13",
};

/**
 * Scales that are idiomatic for a quality, best first.
 *
 * Every scale containing the chord is a candidate, but "contains it" is a weak
 * test — Lydian contains a major triad and so does Ionian, and the difference
 * between them is the whole question. These are the conventional answers, and
 * they are what breaks the tie.
 */
const IDIOMATIC_SCALES: Readonly<Partial<Record<ChordQuality, readonly ChordScaleName[]>>> = {
  major: ["ionian", "lydian", "mixolydian"],
  major7: ["ionian", "lydian"],
  minor: ["dorian", "aeolian", "phrygian"],
  minor7: ["dorian", "aeolian", "phrygian"],
  dominant7: ["mixolydian", "lydianDominant", "altered", "phrygianDominant", "halfWholeDiminished"],
  halfDiminished7: ["locrian"],
  diminished: ["locrian", "wholeHalfDiminished"],
  diminished7: ["wholeHalfDiminished"],
  minorMajor7: ["melodicMinor", "harmonicMinor"],
  augmented: ["wholeTone"],
  augmentedMajor7: ["melodicMinor", "wholeTone"],
  minorAdd9: ["dorian", "aeolian"],
  add9: ["ionian", "lydian"],
  sus4: ["mixolydian", "dorian"],
  sus2: ["ionian", "mixolydian", "dorian"],
};

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

/** A major third with a minor seventh: the chords that take altered tensions. */
function isDominantQuality(quality: ChordQuality): boolean {
  const intervals = intervalsForQuality(quality);
  return intervals.includes(4) && intervals.includes(10);
}

/** Modes whose tonic triad is minor. */
const MINOR_MODES: ReadonlySet<Mode> = new Set<Mode>([
  "naturalMinor",
  "harmonicMinor",
  "dorian",
]);

/**
 * The idiomatic scales for a chord, given where it sits.
 *
 * The quality alone cannot decide this. A dominant seventh takes Mixolydian in a
 * major key and Phrygian dominant when it is the V of a minor one — the same
 * chord, and what separates them is the key it is resolving into. Ranking by
 * quality alone put Mixolydian first for the V7 of C minor, which is the one
 * case the theory is unambiguous about.
 */
function idiomaticScalesFor(
  quality: ChordQuality,
  rootSemitone: number,
  key: PitchClassName | undefined,
  mode: Mode | undefined,
): readonly ChordScaleName[] {
  const base = IDIOMATIC_SCALES[quality] ?? [];
  if (quality !== "dominant7" || !key || !mode || !MINOR_MODES.has(mode)) return base;
  const degree = mod12(rootSemitone - pitchClassToSemitone(key));
  if (degree !== 7) return base;
  return ["phrygianDominant", ...base.filter((name) => name !== "phrygianDominant")];
}

export interface ChordScaleOptions {
  root: PitchClassName;
  quality: ChordQuality;
  /** Key context. Scales that keep more of it rank higher. */
  key?: PitchClassName;
  mode?: Mode;
  /** Colour tones the chord already carries; a scale must contain them. */
  tensions?: readonly Tension[];
  /** Return only scales named as idiomatic for the quality. Defaults to false. */
  idiomaticOnly?: boolean;
}

/**
 * The scales that fit a chord, best first.
 *
 * A scale qualifies only if it contains every note the chord actually sounds —
 * a scale that omits the chord's own third or seventh is not a chord-scale for
 * it, however well it fits the key.
 */
export function chordScalesFor(options: ChordScaleOptions): ChordScaleCandidate[] {
  const rootSemitone = pitchClassToSemitone(options.root);
  const chordIntervals = [...intervalsForQuality(options.quality)];
  const tensionIntervals = (options.tensions ?? []).map((tension) => {
    const entry = Object.entries(TENSION_FOR_INTERVAL).find(
      ([, name]) => name === tension,
    );
    return entry ? Number(entry[0]) : null;
  });
  // A "6" is a thirteenth an octave down; both are the same pitch class.
  const required = new Set(
    [...chordIntervals, ...tensionIntervals.filter((value): value is number => value !== null)]
      .map(mod12),
  );
  if ((options.tensions ?? []).includes("6")) required.add(9);

  const keySemitones = options.key && options.mode
    ? new Set(getScaleSemitones(options.key, options.mode).map(mod12))
    : null;

  const idiomatic = idiomaticScalesFor(
    options.quality,
    rootSemitone,
    options.key,
    options.mode,
  );
  const names = options.idiomaticOnly ? idiomatic : CHORD_SCALE_NAMES;

  const candidates: ChordScaleCandidate[] = [];
  for (const scale of names) {
    const intervals = CHORD_SCALES[scale];
    const set = new Set(intervals.map(mod12));
    if ([...required].some((interval) => !set.has(interval))) continue;

    const chordTones = new Set(chordIntervals.map(mod12));
    const avoid: number[] = [];
    const available: number[] = [];
    const tensions: Tension[] = [];
    for (const interval of intervals) {
      const relative = mod12(interval);
      if (chordTones.has(relative)) continue;
      // A semitone above a chord tone will not bear weight. The one exception
      // is the flat ninth over a dominant, where the rub against the root is
      // the sound being reached for rather than a fault — over any other
      // quality that same note is the textbook avoid note.
      const below = mod12(relative - 1);
      const isFlatNinth = below === 0;
      const rubs =
        chordTones.has(below) && !(isFlatNinth && isDominantQuality(options.quality));
      if (rubs) avoid.push(mod12(rootSemitone + relative));
      else {
        available.push(mod12(rootSemitone + relative));
        const tension = TENSION_FOR_INTERVAL[relative];
        if (tension) tensions.push(tension);
      }
    }

    const outsideKey = keySemitones
      ? intervals.filter((interval) => !keySemitones.has(mod12(rootSemitone + interval))).length
      : 0;

    // Avoid notes are reported, not scored. Every chord-scale has them — Ionian
    // over Imaj7 has one, and it is still the answer — so subtracting for them
    // ranks scales by how bland they are rather than by whether they fit. Doing
    // so made Em7 in C come out Dorian, which puts an F# and a C# over a chord
    // that has neither.
    const idiomaticIndex = idiomatic.indexOf(scale);
    const idiomaticScore = idiomaticIndex < 0 ? 0 : 1 - idiomaticIndex * 0.12;
    const keyScore = keySemitones ? 1 - Math.min(1, outsideKey / 4) : 0.5;
    const fit = Math.max(0, Math.min(1, idiomaticScore * 0.6 + keyScore * 0.4));

    candidates.push({
      scale,
      intervals,
      pitchClasses: intervals.map((interval) => mod12(rootSemitone + interval)),
      avoidNotes: avoid,
      availableNotes: available,
      tensions,
      fit,
      outsideKey,
    });
  }

  return candidates.sort((left, right) => {
    if (right.fit !== left.fit) return right.fit - left.fit;
    return CHORD_SCALE_NAMES.indexOf(left.scale) - CHORD_SCALE_NAMES.indexOf(right.scale);
  });
}

/** The best chord-scale for a chord in its key, or null if nothing contains it. */
export function bestChordScale(
  chord: Pick<ChordEvent, "root" | "quality" | "tensions">,
  key?: PitchClassName,
  mode?: Mode,
): ChordScaleCandidate | null {
  const [best] = chordScalesFor({
    root: chord.root,
    quality: chord.quality,
    tensions: chord.tensions,
    key,
    mode,
  });
  return best ?? null;
}

/**
 * The chord-scale of every chord in a progression.
 *
 * Returned in step with the input, so index N is the scale for chord N; a chord
 * nothing contains yields null rather than shifting everything after it.
 */
export function chordScalesForProgression(
  chords: readonly Pick<ChordEvent, "root" | "quality" | "tensions">[],
  key?: PitchClassName,
  mode?: Mode,
): (ChordScaleCandidate | null)[] {
  return chords.map((chord) => bestChordScale(chord, key, mode));
}
