import type { ChordEvent, ChordQuality, Mode, PitchClassName } from "../types/music";
import { deriveSeed, hashSeed, type Seed } from "./random";
import { pitchClassToSemitone, semitoneToPitchClass } from "./scales";
import { voiceChord } from "./chords";

/**
 * Approach chords at a section boundary.
 *
 * Measured before this existed, on a thirty-two bar verse-chorus piece: the
 * chorus arrives straight from the preceding chord with nothing between them --
 * V followed immediately by IVmaj7, verse landing on I from vi with no
 * preparation. Every boundary in the piece was a butt joint. The section plan
 * knew where the seams were and the chord writer never saw them.
 *
 * The techniques here are the standard ways of arriving somewhere. Each states
 * exactly when it is available, because an approach chord that does not point
 * at the chord after it is just an extra chord.
 */

export type TransitionTechnique =
  | "secondaryDominant"
  | "tritoneSub"
  | "backdoor"
  | "diminishedApproach"
  | "chromaticApproach"
  | "subdominantPrep";

export interface TransitionChord {
  technique: TransitionTechnique;
  root: PitchClassName;
  quality: ChordQuality;
  /** Roman-numeral label relative to the piece's key, for the chord lane. */
  label: string;
  explanation: string;
}

/** Whether the target chord is major-ish, which several techniques require. */
function isMajorish(quality: ChordQuality): boolean {
  return quality === "major" || quality === "major7" || quality === "add9"
    || quality === "sus2" || quality === "sus4" || quality === "dominant7";
}

function isMinorish(quality: ChordQuality): boolean {
  return quality === "minor" || quality === "minor7" || quality === "minorAdd9"
    || quality === "minorMajor7";
}

/**
 * Every approach that works into this target.
 *
 * Order is fixed, because the choice between them is made by a seeded hash over
 * this list and a list that reordered itself would change existing pieces.
 */
export function transitionsInto(
  targetRoot: PitchClassName,
  targetQuality: ChordQuality,
  tonicSemitone: number,
): TransitionChord[] {
  const target = ((pitchClassToSemitone(targetRoot) % 12) + 12) % 12;
  const at = (offset: number) => semitoneToPitchClass((target + offset + 120) % 12);
  const degreeFrom = (semitone: number) => (((semitone - tonicSemitone) % 12) + 12) % 12;
  const ROMAN = ["I", "bII", "II", "bIII", "III", "IV", "bV", "V", "bVI", "VI", "bVII", "VII"];
  const roman = (offset: number) => ROMAN[degreeFrom(target + offset)] as string;

  const available: TransitionChord[] = [];

  // The dominant of whatever comes next. Available into anything, and the
  // reason a section can arrive rather than merely start.
  available.push({
    technique: "secondaryDominant",
    root: at(7),
    quality: "dominant7",
    label: `${roman(7)}7`,
    explanation: `Secondary dominant of ${targetRoot}; resolves down a fifth into the section.`,
  });

  // The same resolution with a chromatic bass: the tritone substitute shares
  // its third and seventh with the secondary dominant, so it pulls just as
  // hard while the bass steps down a semitone instead of a fifth.
  available.push({
    technique: "tritoneSub",
    root: at(1),
    quality: "dominant7",
    label: `${roman(1)}7`,
    explanation: `Tritone substitute of the dominant of ${targetRoot}; the bass steps down a semitone.`,
  });

  // The backdoor resolves up a tone rather than down a fifth. It wants a major
  // target: into a minor chord the flat seventh of the approach collides with
  // the target's own third.
  if (isMajorish(targetQuality)) {
    available.push({
      technique: "backdoor",
      root: at(10),
      quality: "dominant7",
      label: `${roman(10)}7`,
      explanation: `Backdoor dominant; resolves up a tone into ${targetRoot}.`,
    });
  }

  // A diminished seventh a semitone below leads by half step in the bass and
  // shares three tones with the dominant, so it approaches without stating a
  // key of its own.
  available.push({
    technique: "diminishedApproach",
    root: at(-1),
    quality: "diminished7",
    label: `#${roman(-1)}dim7`,
    explanation: `Diminished approach; the bass leads by semitone into ${targetRoot}.`,
  });

  // The plainest approach: the same quality a semitone above, sliding down.
  // Idiomatic where a dominant would be too strong a claim -- a section that
  // continues rather than arrives.
  available.push({
    technique: "chromaticApproach",
    root: at(1),
    quality: targetQuality,
    label: `${roman(1)}`,
    explanation: `Chromatic approach; the whole chord slides down a semitone into ${targetRoot}.`,
  });

  // A subdominant preparation states no chromaticism at all, which is what a
  // pop or game-music boundary usually wants. Into a minor target it is the
  // minor subdominant, which is why the quality follows the target.
  available.push({
    technique: "subdominantPrep",
    root: at(5),
    quality: isMinorish(targetQuality) ? "minor7" : "major7",
    label: `${roman(5)}${isMinorish(targetQuality) ? "m7" : "maj7"}`,
    explanation: `Subdominant preparation a fourth above ${targetRoot}; approaches without leaving the key.`,
  });

  return available;
}

/**
 * How willing each style is to use each approach, and how often at all.
 *
 * A tritone substitute into the chorus of a game-music cue is wrong in the same
 * way a plain subdominant into a jazz bridge is limp. The weights decide which
 * technique wins; the rate decides how many boundaries get one at all, because
 * an approach chord at every seam stops being an event.
 */
interface TransitionProfile {
  rate: number;
  weights: Readonly<Partial<Record<TransitionTechnique, number>>>;
}

const TRANSITION_PROFILES: Readonly<Record<string, TransitionProfile>> = {
  jazz: {
    rate: 0.85,
    weights: { secondaryDominant: 3, tritoneSub: 3, backdoor: 2, diminishedApproach: 2, chromaticApproach: 1, subdominantPrep: 1 },
  },
  "lo-fi": {
    rate: 0.7,
    weights: { secondaryDominant: 2, tritoneSub: 2, backdoor: 2, diminishedApproach: 1, chromaticApproach: 2, subdominantPrep: 2 },
  },
  ballad: {
    rate: 0.7,
    weights: { secondaryDominant: 3, tritoneSub: 1, backdoor: 1, diminishedApproach: 2, chromaticApproach: 1, subdominantPrep: 3 },
  },
  "j-pop": {
    rate: 0.75,
    weights: { secondaryDominant: 3, tritoneSub: 1, backdoor: 1, diminishedApproach: 2, chromaticApproach: 1, subdominantPrep: 3 },
  },
  pop: {
    rate: 0.6,
    weights: { secondaryDominant: 3, tritoneSub: 0, backdoor: 1, diminishedApproach: 1, chromaticApproach: 0, subdominantPrep: 3 },
  },
  rock: {
    rate: 0.5,
    weights: { secondaryDominant: 3, tritoneSub: 0, backdoor: 1, diminishedApproach: 0, chromaticApproach: 0, subdominantPrep: 3 },
  },
  edm: {
    rate: 0.5,
    weights: { secondaryDominant: 2, tritoneSub: 0, backdoor: 0, diminishedApproach: 0, chromaticApproach: 1, subdominantPrep: 3 },
  },
  "game-music": {
    rate: 0.6,
    weights: { secondaryDominant: 3, tritoneSub: 0, backdoor: 1, diminishedApproach: 2, chromaticApproach: 0, subdominantPrep: 2 },
  },
};

export function transitionProfileFor(style: string): TransitionProfile {
  return TRANSITION_PROFILES[style] ?? TRANSITION_PROFILES.pop as TransitionProfile;
}

/**
 * The approach chord for one boundary, or nothing.
 *
 * Deterministic in the seed and the boundary's position. Returns nothing when
 * the roll says this seam stays plain, and when the outgoing chord is already
 * the dominant of the target -- a section that is already being approached does
 * not need approaching twice.
 */
export function planTransition(
  outgoing: { root: PitchClassName; quality: ChordQuality },
  incoming: { root: PitchClassName; quality: ChordQuality },
  options: { style: string; seed: Seed; boundaryIndex: number; tonicSemitone: number },
): TransitionChord | null {
  const profile = transitionProfileFor(options.style);
  const roll = hashSeed(deriveSeed(options.seed, "section-transition", options.boundaryIndex)) % 1000;
  if (roll >= Math.round(profile.rate * 1000)) return null;

  const outgoingSemitone = ((pitchClassToSemitone(outgoing.root) % 12) + 12) % 12;
  const targetSemitone = ((pitchClassToSemitone(incoming.root) % 12) + 12) % 12;
  // Already a fifth above the target and already a dominant: the seam is
  // prepared, and replacing it would remove the preparation to add one.
  if ((outgoingSemitone - targetSemitone + 12) % 12 === 7 && outgoing.quality === "dominant7") {
    return null;
  }

  const candidates = transitionsInto(incoming.root, incoming.quality, options.tonicSemitone)
    .filter((candidate) => (profile.weights[candidate.technique] ?? 0) > 0)
    // An approach chord identical to the chord it replaces changes nothing.
    .filter((candidate) => ((pitchClassToSemitone(candidate.root) % 12) + 12) % 12 !== outgoingSemitone);
  if (candidates.length === 0) return null;

  const total = candidates.reduce(
    (sum, candidate) => sum + (profile.weights[candidate.technique] ?? 0), 0,
  );
  let pick = hashSeed(deriveSeed(options.seed, "section-transition-pick", options.boundaryIndex)) % total;
  for (const candidate of candidates) {
    pick -= profile.weights[candidate.technique] ?? 0;
    if (pick < 0) return candidate;
  }
  return candidates[candidates.length - 1] as TransitionChord;
}

export interface SectionBoundary {
  /** Bar the incoming section starts on. */
  startBar: number;
}

/**
 * Splits the chord before each boundary so its second half approaches the next.
 *
 * The chord is halved rather than replaced. Replacing it would delete a chord
 * the progression needs, and inserting one would push every later chord along
 * and break the tick tiling the whole app depends on. Halving keeps the total
 * unchanged and is also what a player does: the approach is a pickup into the
 * next section, not a bar of its own.
 *
 * A chord too short to halve is left alone, because two chords of a few ticks
 * each is a stumble rather than a turnaround.
 */
export function applySectionTransitions(
  chords: readonly ChordEvent[],
  boundaries: readonly SectionBoundary[],
  options: { style: string; seed: Seed; mode: Mode; tonicSemitone: number; ticksPerBar: number },
): ChordEvent[] {
  if (chords.length === 0 || boundaries.length === 0) return [...chords];

  const result = [...chords];
  // Latest boundary first, so an index computed against the original array
  // stays valid while earlier boundaries are still being inserted.
  const ordered = [...boundaries]
    .filter((boundary) => boundary.startBar > 0)
    .sort((left, right) => right.startBar - left.startBar);

  for (const [order, boundary] of ordered.entries()) {
    const boundaryTick = boundary.startBar * options.ticksPerBar;
    const incomingIndex = result.findIndex((chord) => chord.startTick === boundaryTick);
    if (incomingIndex <= 0) continue;
    const incoming = result[incomingIndex] as ChordEvent;
    const outgoing = result[incomingIndex - 1] as ChordEvent;
    // Half of the outgoing chord has to be worth hearing as a chord.
    if (outgoing.durationTick < options.ticksPerBar / 2) continue;

    const transition = planTransition(
      { root: outgoing.root, quality: outgoing.quality },
      { root: incoming.root, quality: incoming.quality },
      {
      style: options.style,
      seed: options.seed,
      // Counted from the boundary's own bar, so adding a section elsewhere in
      // the piece does not reshuffle every other boundary's choice.
      boundaryIndex: boundary.startBar,
      tonicSemitone: options.tonicSemitone,
      },
    );
    void order;
    if (!transition) continue;

    const half = Math.floor(outgoing.durationTick / 2);
    if (half <= 0) continue;

    result[incomingIndex - 1] = { ...outgoing, durationTick: outgoing.durationTick - half };
    // Voiced against the chord it follows, so the approach leads rather than
    // jumps. The melody has not been written yet at this point, which is why
    // the transition is planned here and not after.
    const voicing = voiceChord(transition.root, transition.quality, outgoing.notes);
    result.splice(incomingIndex, 0, {
      ...incoming,
      id: `${outgoing.id}-approach`,
      symbol: `${transition.root}${qualitySuffix(transition.quality)}`,
      romanNumeral: transition.label,
      root: transition.root,
      quality: transition.quality,
      startTick: outgoing.startTick + (outgoing.durationTick - half),
      durationTick: half,
      notes: voicing.notes,
      inversion: voicing.inversion,
      source: "other",
      specialKind: undefined,
      tensions: undefined,
      bass: undefined,
      explanation: transition.explanation,
    } as ChordEvent);
  }
  return result;
}

/** Chord-symbol suffix for the qualities a transition can produce. */
function qualitySuffix(quality: ChordQuality): string {
  switch (quality) {
    case "dominant7": return "7";
    case "diminished7": return "dim7";
    case "major7": return "maj7";
    case "minor7": return "m7";
    case "minor": return "m";
    case "minorMajor7": return "mMaj7";
    case "minorAdd9": return "madd9";
    case "add9": return "add9";
    case "sus2": return "sus2";
    case "sus4": return "sus4";
    case "diminished": return "dim";
    case "augmented": return "aug";
    case "halfDiminished7": return "m7b5";
    case "augmentedMajor7": return "augMaj7";
    default: return "";
  }
}
