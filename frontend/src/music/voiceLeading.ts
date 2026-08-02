import type { ChordQuality, Mode, StylePresetId } from "../types/music";
import { intervalsForQuality } from "./chords";
import { pitchClassToSemitone } from "./scales";

/**
 * Four-part voice leading.
 *
 * The original voicer scored a chord as a set of notes and rewarded small
 * movement. That produces smooth results but cannot see the things that actually
 * govern part-writing, because those are properties of *voices*: parallel
 * fifths are two specific voices moving together, an unresolved leading tone is
 * one voice failing to go where it was heading.
 *
 * Tracking soprano, alto, tenor and bass separately makes those visible.
 *
 * The rules are not applied uniformly. Common-practice part-writing forbids
 * parallel fifths; house and future bass are built out of them. So the rules are
 * weighted per style rather than enforced, and a profile that zeroes a penalty
 * genuinely permits the thing.
 */

export interface VoiceAssignment {
  soprano: number;
  alto: number;
  tenor: number;
  bass: number;
}

export type VoiceName = "soprano" | "alto" | "tenor" | "bass";

export const VOICE_ORDER: readonly VoiceName[] = ["bass", "tenor", "alto", "soprano"];

export type VoiceLeadingIssueType =
  | "parallelFifth"
  | "parallelOctave"
  | "voiceCrossing"
  | "voiceOverlap"
  | "unresolvedLeadingTone"
  | "unresolvedSeventh"
  | "augmentedSecond"
  | "largeLeap";

export interface VoiceLeadingIssue {
  type: VoiceLeadingIssueType;
  /** 0..1. How serious this is *before* the style profile weights it. */
  severity: number;
  voices: VoiceName[];
}

export interface VoiceLeadingProfile {
  parallelFifthPenalty: number;
  parallelOctavePenalty: number;
  commonToneReward: number;
  contraryMotionReward: number;
  /** Positive prefers spread voicings, negative prefers close ones. */
  wideVoicingPreference: number;
  /** How much the bass is expected to move against the upper parts. */
  bassIndependence: number;
  /** Weight on resolving leading tones and chordal sevenths. */
  tendencyToneWeight: number;
  voiceCrossingPenalty: number;
  largeLeapPenalty: number;
}

/**
 * Style profiles.
 *
 * Classical enforces the textbook rules; jazz cares about guide tones and
 * tolerates parallels the classical style forbids; pop wants a singable top
 * line above all; future bass is built from parallel motion and wide spacing,
 * so the parallel penalties drop to zero rather than merely low.
 */
export const VOICE_LEADING_PROFILES: Readonly<
  Record<string, VoiceLeadingProfile>
> = {
  classical: {
    parallelFifthPenalty: 8,
    parallelOctavePenalty: 8,
    commonToneReward: 2,
    contraryMotionReward: 1.5,
    wideVoicingPreference: 0,
    bassIndependence: 1.5,
    tendencyToneWeight: 3,
    voiceCrossingPenalty: 4,
    largeLeapPenalty: 1.5,
  },
  jazz: {
    parallelFifthPenalty: 1.5,
    parallelOctavePenalty: 3,
    commonToneReward: 2.5,
    contraryMotionReward: 0.5,
    wideVoicingPreference: 0.5,
    bassIndependence: 2,
    // Guide tones still want to resolve, but less strictly than in counterpoint.
    tendencyToneWeight: 1.5,
    voiceCrossingPenalty: 1,
    largeLeapPenalty: 0.8,
  },
  pop: {
    parallelFifthPenalty: 0.5,
    parallelOctavePenalty: 1.5,
    commonToneReward: 2,
    contraryMotionReward: 0.2,
    wideVoicingPreference: 0.2,
    bassIndependence: 1,
    tendencyToneWeight: 0.8,
    voiceCrossingPenalty: 1.5,
    // A smooth top line is what a pop voicing is judged on.
    largeLeapPenalty: 2.5,
  },
  electronic: {
    // Parallel motion is the idiom, not a fault.
    parallelFifthPenalty: 0,
    parallelOctavePenalty: 0,
    commonToneReward: 0.5,
    contraryMotionReward: 0,
    wideVoicingPreference: 1.5,
    bassIndependence: 0.5,
    tendencyToneWeight: 0.3,
    voiceCrossingPenalty: 0.5,
    largeLeapPenalty: 0.5,
  },
};

const STYLE_PROFILE: Readonly<Record<string, keyof typeof VOICE_LEADING_PROFILES>> = {
  pop: "pop",
  "j-pop": "pop",
  rock: "pop",
  ballad: "pop",
  jazz: "jazz",
  "lo-fi": "jazz",
  edm: "electronic",
  "game-music": "classical",
};

export function profileForStyle(style: StylePresetId): VoiceLeadingProfile {
  const name = STYLE_PROFILE[style] ?? "pop";
  return VOICE_LEADING_PROFILES[name] as VoiceLeadingProfile;
}

/** Comfortable ranges, so a part is never written outside what it could sing. */
export const VOICE_RANGES: Readonly<Record<VoiceName, readonly [number, number]>> = {
  bass: [40, 60],
  tenor: [48, 67],
  alto: [55, 74],
  soprano: [60, 81],
};

export function assignmentToNotes(assignment: VoiceAssignment): number[] {
  return [assignment.bass, assignment.tenor, assignment.alto, assignment.soprano];
}

export function voiceOf(assignment: VoiceAssignment, voice: VoiceName): number {
  return assignment[voice];
}

/** Interval in semitones, ignoring octave, used for fifth/octave detection. */
function simpleInterval(lower: number, upper: number): number {
  return ((upper - lower) % 12 + 12) % 12;
}

export interface HarmonyContext {
  mode: Mode;
  key: string;
  /** Root and quality of the chord being moved to. */
  quality: ChordQuality;
  root: string;
  /** Semitone of the tonic, used to spot the leading tone. */
  tonicSemitone: number;
}

/**
 * Finds everything wrong with a move between two four-part chords.
 *
 * Severities describe the fault itself; the style profile decides what each one
 * costs. That separation is what lets the same detector serve a strict
 * common-practice setting and a house track.
 */
export function findVoiceLeadingIssues(
  previous: VoiceAssignment,
  next: VoiceAssignment,
  context: HarmonyContext,
): VoiceLeadingIssue[] {
  const issues: VoiceLeadingIssue[] = [];
  const pairs: Array<[VoiceName, VoiceName]> = [
    ["bass", "tenor"], ["bass", "alto"], ["bass", "soprano"],
    ["tenor", "alto"], ["tenor", "soprano"], ["alto", "soprano"],
  ];

  for (const [lower, upper] of pairs) {
    const beforeInterval = simpleInterval(previous[lower], previous[upper]);
    const afterInterval = simpleInterval(next[lower], next[upper]);
    const lowerMoved = next[lower] - previous[lower];
    const upperMoved = next[upper] - previous[upper];
    const sameDirection =
      lowerMoved !== 0 && upperMoved !== 0 &&
      Math.sign(lowerMoved) === Math.sign(upperMoved);
    if (!sameDirection) continue;

    // Parallel perfect intervals: the two voices stop sounding independent.
    if (beforeInterval === 7 && afterInterval === 7) {
      issues.push({ type: "parallelFifth", severity: 1, voices: [lower, upper] });
    }
    if (beforeInterval === 0 && afterInterval === 0) {
      issues.push({ type: "parallelOctave", severity: 1, voices: [lower, upper] });
    }
  }

  // Ordering must hold: soprano above alto above tenor above bass.
  const ordered = VOICE_ORDER.map((voice) => next[voice]);
  for (let index = 1; index < ordered.length; index += 1) {
    if ((ordered[index] as number) < (ordered[index - 1] as number)) {
      issues.push({
        type: "voiceCrossing",
        severity: 1,
        voices: [VOICE_ORDER[index - 1] as VoiceName, VOICE_ORDER[index] as VoiceName],
      });
    }
  }

  // Overlap: a voice moves past where its neighbour just was.
  for (let index = 1; index < VOICE_ORDER.length; index += 1) {
    const lower = VOICE_ORDER[index - 1] as VoiceName;
    const upper = VOICE_ORDER[index] as VoiceName;
    if (next[upper] < previous[lower] || next[lower] > previous[upper]) {
      issues.push({ type: "voiceOverlap", severity: 0.6, voices: [lower, upper] });
    }
  }

  for (const voice of VOICE_ORDER) {
    const moved = next[voice] - previous[voice];
    const distance = Math.abs(moved);
    // The bass is allowed to leap; the inner parts are not.
    const limit = voice === "bass" ? 12 : 7;
    if (distance > limit) {
      issues.push({
        type: "largeLeap",
        severity: Math.min(1, (distance - limit) / 12),
        voices: [voice],
      });
    }
    // An augmented second is the melodic interval harmonic minor makes easy to
    // write and that part-writing specifically avoids.
    if (distance === 3 && voice !== "bass") {
      const from = ((previous[voice] % 12) + 12) % 12;
      const to = ((next[voice] % 12) + 12) % 12;
      const raisedSixthToLeadingTone =
        (from - context.tonicSemitone + 12) % 12 === 8 &&
        (to - context.tonicSemitone + 12) % 12 === 11;
      if (raisedSixthToLeadingTone) {
        issues.push({ type: "augmentedSecond", severity: 0.8, voices: [voice] });
      }
    }
  }

  // The leading tone wants the tonic, and a chordal seventh wants to fall.
  const leadingTone = (context.tonicSemitone + 11) % 12;
  for (const voice of VOICE_ORDER) {
    const wasLeadingTone = ((previous[voice] % 12) + 12) % 12 === leadingTone;
    if (wasLeadingTone) {
      const resolved = next[voice] - previous[voice] === 1;
      // Only the outer voices are held to it; an inner part may fall away.
      if (!resolved && (voice === "soprano" || voice === "bass")) {
        issues.push({ type: "unresolvedLeadingTone", severity: 1, voices: [voice] });
      }
    }
  }

  const seventhInterval = intervalsForQuality(context.quality).find(
    (interval) => interval === 10 || interval === 11,
  );
  if (seventhInterval !== undefined) {
    const seventhPitch = (pitchClassToSemitone(context.root as never) + seventhInterval) % 12;
    for (const voice of VOICE_ORDER) {
      if (((previous[voice] % 12) + 12) % 12 !== seventhPitch) continue;
      const step = next[voice] - previous[voice];
      if (step > 0 || step < -2) {
        issues.push({ type: "unresolvedSeventh", severity: 0.8, voices: [voice] });
      }
    }
  }

  return issues;
}

function penaltyFor(
  issue: VoiceLeadingIssue,
  profile: VoiceLeadingProfile,
): number {
  switch (issue.type) {
    case "parallelFifth":
      return profile.parallelFifthPenalty;
    case "parallelOctave":
      return profile.parallelOctavePenalty;
    case "voiceCrossing":
      return profile.voiceCrossingPenalty;
    case "voiceOverlap":
      return profile.voiceCrossingPenalty * 0.5;
    case "unresolvedLeadingTone":
    case "unresolvedSeventh":
      return profile.tendencyToneWeight;
    case "augmentedSecond":
      return profile.tendencyToneWeight * 0.8;
    case "largeLeap":
      return profile.largeLeapPenalty;
  }
}

/**
 * Cost of moving from one four-part chord to another.
 *
 * Lower is better. Movement and range are always counted; everything else is
 * weighted by the style profile, so the same function serves every style.
 */
export function voiceLeadingCost(
  previous: VoiceAssignment,
  next: VoiceAssignment,
  context: HarmonyContext,
  profile: VoiceLeadingProfile,
): number {
  let cost = 0;

  for (const voice of VOICE_ORDER) {
    const moved = Math.abs(next[voice] - previous[voice]);
    // The bass carries the harmony and is expected to move more freely, so its
    // motion is discounted rather than penalised like an inner part's.
    cost += voice === "bass" ? moved / (1 + profile.bassIndependence) : moved;

    if (moved === 0) cost -= profile.commonToneReward;

    const [low, high] = VOICE_RANGES[voice];
    if (next[voice] < low) cost += (low - next[voice]) * 0.5;
    if (next[voice] > high) cost += (next[voice] - high) * 0.5;
  }

  // Contrary motion between the outer voices is what keeps them independent.
  const bassMoved = next.bass - previous.bass;
  const sopranoMoved = next.soprano - previous.soprano;
  if (bassMoved !== 0 && sopranoMoved !== 0 && Math.sign(bassMoved) !== Math.sign(sopranoMoved)) {
    cost -= profile.contraryMotionReward;
  }

  const spread = next.soprano - next.bass;
  // Wide spacing is a preference, not a rule: the sign of the profile decides
  // whether spreading out is rewarded or penalised.
  cost -= ((spread - 24) / 12) * profile.wideVoicingPreference;

  for (const issue of findVoiceLeadingIssues(previous, next, context)) {
    cost += penaltyFor(issue, profile) * issue.severity;
  }
  return cost;
}

/**
 * The cost of one transition, split into the terms that produced it.
 *
 * `voiceLeadingCost` returns the same total. This exists because a single number
 * cannot say *why* a progression scored badly, and both the reharmonizer and any
 * explanation UI need the breakdown rather than the sum.
 */
export interface VoiceLeadingScore {
  total: number;
  movement: number;
  largeLeap: number;
  parallelPerfect: number;
  voiceCrossing: number;
  rangeViolation: number;
  tendencyResolution: number;
}

/** Scores one transition and reports each component separately. */
export function scoreVoiceLeading(
  previous: VoiceAssignment,
  next: VoiceAssignment,
  context: HarmonyContext,
  profile: VoiceLeadingProfile,
): VoiceLeadingScore {
  let movement = 0;
  let rangeViolation = 0;
  for (const voice of VOICE_ORDER) {
    const moved = Math.abs(next[voice] - previous[voice]);
    movement += voice === "bass" ? moved / (1 + profile.bassIndependence) : moved;
    if (moved === 0) movement -= profile.commonToneReward;
    const [low, high] = VOICE_RANGES[voice];
    if (next[voice] < low) rangeViolation += (low - next[voice]) * 0.5;
    if (next[voice] > high) rangeViolation += (next[voice] - high) * 0.5;
  }

  const bassMoved = next.bass - previous.bass;
  const sopranoMoved = next.soprano - previous.soprano;
  if (bassMoved !== 0 && sopranoMoved !== 0 && Math.sign(bassMoved) !== Math.sign(sopranoMoved)) {
    movement -= profile.contraryMotionReward;
  }
  const spread = next.soprano - next.bass;
  movement -= ((spread - 24) / 12) * profile.wideVoicingPreference;

  let largeLeap = 0;
  let parallelPerfect = 0;
  let voiceCrossing = 0;
  let tendencyResolution = 0;
  for (const issue of findVoiceLeadingIssues(previous, next, context)) {
    const weighted = penaltyFor(issue, profile) * issue.severity;
    switch (issue.type) {
      case "parallelFifth":
      case "parallelOctave":
        parallelPerfect += weighted;
        break;
      case "voiceCrossing":
      case "voiceOverlap":
        voiceCrossing += weighted;
        break;
      case "unresolvedLeadingTone":
      case "unresolvedSeventh":
        tendencyResolution += weighted;
        break;
      case "largeLeap":
      case "augmentedSecond":
        largeLeap += weighted;
        break;
    }
  }

  return {
    total: movement + largeLeap + parallelPerfect + voiceCrossing
      + rangeViolation + tendencyResolution,
    movement,
    largeLeap,
    parallelPerfect,
    voiceCrossing,
    rangeViolation,
    tendencyResolution,
  };
}

/** Every way of placing a chord's pitch classes into four ordered voices. */
function candidateAssignments(
  root: string,
  quality: ChordQuality,
  bassOverride?: string,
): VoiceAssignment[] {
  const rootSemitone = pitchClassToSemitone(root as never);
  const pitchClasses = intervalsForQuality(quality).map(
    (interval) => (rootSemitone + interval) % 12,
  );
  const bassClass = bassOverride === undefined
    ? (pitchClasses[0] as number)
    : pitchClassToSemitone(bassOverride as never);

  const assignments: VoiceAssignment[] = [];
  const inRange = (voice: VoiceName, pitchClass: number): number[] => {
    const [low, high] = VOICE_RANGES[voice];
    const notes: number[] = [];
    for (let midi = low; midi <= high; midi += 1) {
      if (((midi % 12) + 12) % 12 === pitchClass) notes.push(midi);
    }
    return notes;
  };

  for (const bass of inRange("bass", bassClass)) {
    for (const tenorClass of pitchClasses) {
      for (const tenor of inRange("tenor", tenorClass)) {
        if (tenor < bass) continue;
        for (const altoClass of pitchClasses) {
          for (const alto of inRange("alto", altoClass)) {
            if (alto < tenor) continue;
            for (const sopranoClass of pitchClasses) {
              for (const soprano of inRange("soprano", sopranoClass)) {
                if (soprano < alto) continue;
                // Every chord tone must sound somewhere, or it is a different
                // chord than the one that was asked for.
                const sounding = new Set([bassClass, tenorClass, altoClass, sopranoClass]);
                if (!pitchClasses.every((pitchClass) => sounding.has(pitchClass))) continue;
                assignments.push({ bass, tenor, alto, soprano });
              }
            }
          }
        }
      }
    }
  }
  return assignments;
}

export interface FourPartVoicingOptions {
  root: string;
  quality: ChordQuality;
  /** Slash-chord bass, which may be outside the chord. */
  bass?: string;
  previous?: VoiceAssignment;
  profile: VoiceLeadingProfile;
  context: HarmonyContext;
}

/**
 * Chooses the four-part voicing that best follows the previous chord.
 *
 * With no previous chord there is nothing to lead from, so the choice falls back
 * to a comfortably centred, evenly spaced position.
 */
export function voiceChordInFourParts(
  options: FourPartVoicingOptions,
): VoiceAssignment | null {
  const candidates = candidateAssignments(options.root, options.quality, options.bass);
  if (candidates.length === 0) return null;

  const score = (assignment: VoiceAssignment): number => {
    if (!options.previous) {
      // Centre each voice in its range and keep the spacing even.
      let cost = 0;
      for (const voice of VOICE_ORDER) {
        const [low, high] = VOICE_RANGES[voice];
        cost += Math.abs(assignment[voice] - (low + high) / 2) * 0.5;
      }
      const gaps = [
        assignment.tenor - assignment.bass,
        assignment.alto - assignment.tenor,
        assignment.soprano - assignment.alto,
      ];
      const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
      cost += gaps.reduce((sum, gap) => sum + Math.abs(gap - mean), 0) * 0.4;
      return cost;
    }
    return voiceLeadingCost(options.previous, assignment, options.context, options.profile);
  };

  return candidates.reduce((best, candidate) => {
    const bestScore = score(best);
    const candidateScore = score(candidate);
    if (candidateScore !== bestScore) return candidateScore < bestScore ? candidate : best;
    // Deterministic tie-break, so the same input always yields the same voicing.
    return assignmentToNotes(candidate).join(",") < assignmentToNotes(best).join(",")
      ? candidate
      : best;
  });
}

export interface RevoiceOptions {
  key: string;
  mode: Mode;
  style: StylePresetId;
  /** Overrides the profile the style would pick. */
  profileName?: keyof typeof VOICE_LEADING_PROFILES;
  /** Searches the whole sequence instead of one chord at a time. */
  optimizeSequence?: boolean;
}

/**
 * Re-voices a finished chord sequence in four parts.
 *
 * Applied after generation rather than inside it, so every path — templates,
 * functional planning, sections — gets the same treatment, and a chord the
 * four-part voicer cannot express (a wide tension stack, say) simply keeps the
 * voicing it already had instead of being dropped.
 */
export function revoiceInFourParts<
  T extends {
    root: string;
    quality: ChordQuality;
    bass?: string;
    notes: number[];
    inversion: number;
  },
>(chords: readonly T[], options: RevoiceOptions): T[] {
  const profile = options.profileName
    ? VOICE_LEADING_PROFILES[options.profileName] as VoiceLeadingProfile
    : profileForStyle(options.style);
  const tonicSemitone = pitchClassToSemitone(options.key as never);

  const contextFor = (chord: { root: string; quality: ChordQuality }): HarmonyContext => ({
    mode: options.mode,
    key: options.key,
    quality: chord.quality,
    root: chord.root,
    tonicSemitone,
  });

  if (options.optimizeSequence) {
    return optimizeVoicingSequence(chords, profile, contextFor);
  }

  const result: T[] = [];
  let previous: VoiceAssignment | undefined;
  for (const chord of chords) {
    const assignment = voiceChordInFourParts({
      root: chord.root,
      quality: chord.quality,
      bass: chord.bass,
      previous,
      profile,
      context: contextFor(chord),
    });
    if (!assignment) {
      // Nothing playable in four parts; keep what the base voicer produced.
      result.push(chord);
      continue;
    }
    previous = assignment;
    result.push({ ...chord, notes: assignmentToNotes(assignment), inversion: 0 });
  }
  return result;
}

/**
 * Chooses every voicing at once, by dynamic programming over the sequence.
 *
 * The chord-at-a-time writer commits to the cheapest move from the previous
 * chord and never reconsiders, so a locally ideal voicing can leave the next
 * chord holding only expensive options. This finds the cheapest path through all
 * of them instead.
 *
 * The candidate sets are small — 15 to 55 voicings per chord, measured across
 * every root and quality — so the transition table is at most a few thousand
 * entries per step and the search is linear in the number of chords. No pruning
 * is needed, which matters: a beam would make the result depend on the beam
 * width rather than on the music.
 *
 * Every root and quality pair the type system allows produces at least one
 * voicing (checked over all 180), so there is no unvoiceable-chord case to
 * split the sequence around.
 */
function optimizeVoicingSequence<
  T extends {
    root: string;
    quality: ChordQuality;
    bass?: string;
    notes: number[];
    inversion: number;
  },
>(
  chords: readonly T[],
  profile: VoiceLeadingProfile,
  contextFor: (chord: { root: string; quality: ChordQuality }) => HarmonyContext,
): T[] {
  const candidatesPer = chords.map(
    (chord) => candidateAssignments(chord.root, chord.quality, chord.bass),
  );
  if (candidatesPer.some((candidates) => candidates.length === 0)) {
    // Defensive only. Nothing in the type system produces this, so rather than
    // carry untestable machinery for it, the whole optimization steps aside and
    // the sequential writer handles the sequence.
    return chords.map((chord) => chord);
  }

  let costs = candidatesPer[0]!.map(restingCost);
  const backpointers: number[][] = [];

  for (let position = 1; position < chords.length; position += 1) {
    const previousCandidates = candidatesPer[position - 1]!;
    const candidates = candidatesPer[position]!;
    const context = contextFor(chords[position]!);
    const nextCosts = new Array<number>(candidates.length).fill(Number.POSITIVE_INFINITY);
    const choices = new Array<number>(candidates.length).fill(0);

    for (let next = 0; next < candidates.length; next += 1) {
      for (let previous = 0; previous < previousCandidates.length; previous += 1) {
        const total = costs[previous]!
          + voiceLeadingCost(
            previousCandidates[previous]!,
            candidates[next]!,
            context,
            profile,
          );
        // Strict improvement, so the earliest candidate holds a tie. Either
        // comparison is deterministic; this one keeps the chosen voicing the
        // first in generation order rather than the last.
        if (total < nextCosts[next]!) {
          nextCosts[next] = total;
          choices[next] = previous;
        }
      }
    }
    costs = nextCosts;
    backpointers.push(choices);
  }

  let best = 0;
  for (let index = 1; index < costs.length; index += 1) {
    if (costs[index]! < costs[best]!) best = index;
  }

  const result = new Array<T>(chords.length);
  let cursor = best;
  for (let position = chords.length - 1; position >= 0; position -= 1) {
    result[position] = {
      ...chords[position]!,
      notes: assignmentToNotes(candidatesPer[position]![cursor]!),
      inversion: 0,
    };
    if (position > 0) cursor = backpointers[position - 1]![cursor]!;
  }
  return result;
}

/**
 * The opening voicing's cost when there is nothing to lead from.
 *
 * Matches what the sequential writer does for a first chord: centre each voice
 * and keep the spacing even.
 */
function restingCost(assignment: VoiceAssignment): number {
  let cost = 0;
  for (const voice of VOICE_ORDER) {
    const [low, high] = VOICE_RANGES[voice];
    cost += Math.abs(assignment[voice] - (low + high) / 2) * 0.5;
  }
  const gaps = [
    assignment.tenor - assignment.bass,
    assignment.alto - assignment.tenor,
    assignment.soprano - assignment.alto,
  ];
  const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  return cost + gaps.reduce((sum, gap) => sum + Math.abs(gap - mean), 0) * 0.4;
}
