import type {
  ChordEvent,
  ChordQuality,
  HarmonyFunction,
  Mode,
  PitchClassName,
  StylePresetId,
} from "../types/music";
import { deriveSeed, hashSeed, type Seed } from "./random";
import { SCALE_INTERVALS, pitchClassToSemitone, semitoneToPitchClass } from "./scales";
import { voiceChord } from "./chords";
import {
  type ConditionalHarmonyEvidence,
  type HarmonyStatisticsProvider,
} from "./statisticalHarmony";
import {
  profileForStyle,
  revoiceInFourParts,
  scoreVoiceLeading,
  type HarmonyContext,
  type VoiceAssignment,
} from "./voiceLeading";

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
  /**
   * What the approach does, which is not what the chord it approaches does.
   *
   * The event used to inherit the target's function along with everything else
   * it was spread from, so a ♭II7 leading into the tonic was labelled tonic --
   * measured, 132 of 132 chromatic approach chords carried the function of the
   * chord they were pointing at. Four of these six techniques are dominants by
   * construction; the subdominant preparation is a predominant; the chromatic
   * slide claims no function at all, which is the point of using it.
   */
  harmonyFunction: HarmonyFunction;
  explanation: string;
}

/**
 * The scale degree an approach chord sits on, or zero where it sits outside.
 *
 * Zero is the app's own convention for "no degree" -- chords.ts writes it for a
 * root it cannot place in the scale -- and most of these approaches are
 * chromatic by construction, so most of them get it. The spread from the target
 * chord was handing them the target's degree instead, which is a number that
 * happens to be in range and means something else.
 */
function scaleDegreeOf(
  root: PitchClassName,
  tonicSemitone: number,
  mode: Mode,
): number {
  const offset = ((pitchClassToSemitone(root) - tonicSemitone) % 12 + 12) % 12;
  const index = SCALE_INTERVALS[mode].indexOf(offset);
  return index < 0 ? 0 : index + 1;
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
    harmonyFunction: "dominant",
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
    harmonyFunction: "dominant",
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
      harmonyFunction: "dominant",
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
    // ROMAN already names the pitch class relative to the key, accidental and
    // all. Prefixing a sharp onto it produced "#bIIdim7" -- a numeral carrying
    // both accidentals at once, which names nothing.
    label: `${roman(-1)}dim7`,
    harmonyFunction: "dominant",
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
    harmonyFunction: "other",
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
    harmonyFunction: "predominant",
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

export interface TransitionCandidateScore {
  candidate: TransitionChord;
  styleWeight: number;
  /** Existing four-part score over outgoing -> candidate -> incoming. Lower is better. */
  voiceLeadingCost: number;
  /** Null for every candidate when corpus evidence is unavailable or invalid. */
  corpus: {
    /** Number of the two predictions backed by an observed order-2+ gram. */
    supportedTransitions: number;
    meanSurprisalBits: number;
  } | null;
}

export interface TransitionCandidateRanking {
  candidates: readonly TransitionCandidateScore[];
  frontier: readonly TransitionCandidateScore[];
  /** False means the corpus axis was excluded from every candidate. */
  corpusAvailable: boolean;
}

interface TransitionRankingOptions {
  style: StylePresetId;
  mode: Mode;
  tonicSemitone: number;
  provider?: HarmonyStatisticsProvider | null;
}

function corpusToken(
  chord: { root: PitchClassName; quality: ChordQuality },
  tonicSemitone: number,
): string {
  const relative = ((pitchClassToSemitone(chord.root) - tonicSemitone) % 12 + 12) % 12;
  return `${relative}:${chord.quality}`;
}

function validEvidence(
  evidence: ConditionalHarmonyEvidence,
  requestedTokens: readonly string[],
): boolean {
  const finite = [
    evidence.rawConditionalProbability,
    evidence.probability,
    evidence.unigramCount,
    evidence.exactGramCount,
    evidence.contextCount,
    evidence.orderUsed,
    evidence.surprisalBits,
  ].every(Number.isFinite);
  if (!finite
    || evidence.probability <= 0
    || evidence.probability > 1
    || evidence.rawConditionalProbability < 0
    || evidence.rawConditionalProbability > 1
    || evidence.surprisalBits < 0
    || !Number.isSafeInteger(evidence.unigramCount)
    || evidence.unigramCount < 0
    || !Number.isSafeInteger(evidence.exactGramCount)
    || evidence.exactGramCount < 0
    || !Number.isSafeInteger(evidence.contextCount)
    || evidence.contextCount < 0
    || evidence.exactGramCount > evidence.contextCount
    || !Number.isSafeInteger(evidence.orderUsed)
    || evidence.orderUsed < 1
    || evidence.orderUsed > Math.min(3, requestedTokens.length)
    || (evidence.orderUsed >= 2 && evidence.contextCount === 0)
    || typeof evidence.supported !== "boolean") {
    return false;
  }
  const normalizedTokens = requestedTokens.slice(-3);
  return evidence.tokens.length === normalizedTokens.length
    && evidence.tokens.every((token, index) => token === normalizedTokens[index]);
}

function corpusScores(
  outgoing: { root: PitchClassName; quality: ChordQuality },
  incoming: { root: PitchClassName; quality: ChordQuality },
  candidates: readonly TransitionChord[],
  tonicSemitone: number,
  injectedProvider?: HarmonyStatisticsProvider | null,
): ReadonlyMap<TransitionTechnique, NonNullable<TransitionCandidateScore["corpus"]>> | null {
  // Empirical evidence is opt-in. The ordinary browser generation path must
  // rank from theory, voice-leading, and style only, even if a legacy corpus
  // file happens to exist in the checkout.
  if (!injectedProvider) return null;
  try {
    // An injected provider is consulted only after the unchanged rate and
    // theory gates. A broken snapshot then degrades this whole comparison to
    // theory + voice leading + style instead of taking the composition down or
    // mixing partial evidence between candidates.
    const provider = injectedProvider;
    const outgoingToken = corpusToken(outgoing, tonicSemitone);
    const incomingToken = corpusToken(incoming, tonicSemitone);
    const result = new Map<TransitionTechnique, NonNullable<TransitionCandidateScore["corpus"]>>();
    for (const candidate of candidates) {
      const candidateToken = corpusToken(candidate, tonicSemitone);
      const firstTokens = [outgoingToken, candidateToken];
      const secondTokens = [outgoingToken, candidateToken, incomingToken];
      const first = provider.probability(firstTokens);
      const second = provider.probability(secondTokens);
      if (!validEvidence(first, firstTokens) || !validEvidence(second, secondTokens)) return null;
      const firstSurprisal = -Math.log2(first.probability);
      const secondSurprisal = -Math.log2(second.probability);
      if (!Number.isFinite(firstSurprisal) || !Number.isFinite(secondSurprisal)) return null;
      result.set(candidate.technique, {
        supportedTransitions: [first, second].filter(
          (evidence) => evidence.orderUsed >= 2 && evidence.exactGramCount > 0,
        ).length,
        meanSurprisalBits: (firstSurprisal + secondSurprisal) / 2,
      });
    }
    return result;
  } catch {
    return null;
  }
}

function assignment(notes: readonly number[]): VoiceAssignment {
  if (notes.length !== 4 || notes.some((note) => !Number.isFinite(note))) {
    throw new Error("Four-part revoicing did not produce four finite pitches.");
  }
  return {
    bass: notes[0] as number,
    tenor: notes[1] as number,
    alto: notes[2] as number,
    soprano: notes[3] as number,
  };
}

const MAX_VOICE_SCORE_CACHE_ENTRIES = 512;
const VOICE_SCORE_CACHE = new Map<string, number>();

function scoreCandidateVoiceLeading(
  outgoing: { root: PitchClassName; quality: ChordQuality },
  candidate: TransitionChord,
  incoming: { root: PitchClassName; quality: ChordQuality },
  options: TransitionRankingOptions,
): number {
  const cacheKey = [
    options.style,
    options.mode,
    options.tonicSemitone,
    outgoing.root,
    outgoing.quality,
    candidate.root,
    candidate.quality,
    incoming.root,
    incoming.quality,
  ].join("|");
  const cached = VOICE_SCORE_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;
  const base = [outgoing, candidate, incoming].map((chord) => ({
    root: chord.root,
    quality: chord.quality,
    ...voiceChord(chord.root, chord.quality),
  }));
  const key = semitoneToPitchClass(options.tonicSemitone);
  const voiced = revoiceInFourParts(base, {
    key,
    mode: options.mode,
    style: options.style,
    optimizeSequence: true,
  });
  const profile = profileForStyle(options.style);
  const contextFor = (chord: { root: string; quality: ChordQuality }): HarmonyContext => ({
    key,
    mode: options.mode,
    root: chord.root,
    quality: chord.quality,
    tonicSemitone: options.tonicSemitone,
  });
  const first = scoreVoiceLeading(
    assignment((voiced[0] as typeof base[number]).notes),
    assignment((voiced[1] as typeof base[number]).notes),
    contextFor(candidate),
    profile,
  ).total;
  const second = scoreVoiceLeading(
    assignment((voiced[1] as typeof base[number]).notes),
    assignment((voiced[2] as typeof base[number]).notes),
    contextFor(incoming),
    profile,
  ).total;
  const total = first + second;
  if (!Number.isFinite(total)) throw new Error("Four-part voice-leading score is not finite.");
  if (VOICE_SCORE_CACHE.size >= MAX_VOICE_SCORE_CACHE_ENTRIES) {
    const oldest = VOICE_SCORE_CACHE.keys().next().value;
    if (oldest !== undefined) VOICE_SCORE_CACHE.delete(oldest);
  }
  VOICE_SCORE_CACHE.set(cacheKey, total);
  return total;
}

function dominates(
  left: TransitionCandidateScore,
  right: TransitionCandidateScore,
  corpusAvailable: boolean,
): boolean {
  const corpusNoWorse = !corpusAvailable || (
    (left.corpus?.supportedTransitions ?? -1) >= (right.corpus?.supportedTransitions ?? -1)
    && (left.corpus?.meanSurprisalBits ?? Number.POSITIVE_INFINITY)
      <= (right.corpus?.meanSurprisalBits ?? Number.POSITIVE_INFINITY)
  );
  const corpusBetter = corpusAvailable && (
    (left.corpus?.supportedTransitions ?? -1) > (right.corpus?.supportedTransitions ?? -1)
    || (left.corpus?.meanSurprisalBits ?? Number.POSITIVE_INFINITY)
      < (right.corpus?.meanSurprisalBits ?? Number.POSITIVE_INFINITY)
  );
  const voiceNoWorse = left.voiceLeadingCost <= right.voiceLeadingCost;
  const styleNoWorse = left.styleWeight >= right.styleWeight;
  const strictlyBetter = corpusBetter
    || left.voiceLeadingCost < right.voiceLeadingCost
    || left.styleWeight > right.styleWeight;
  return corpusNoWorse && voiceNoWorse && styleNoWorse && strictlyBetter;
}

/**
 * Scores theory-valid approaches and keeps only their Pareto frontier.
 *
 * Exposed so tests and future audit views can inspect the actual quantities;
 * selection remains in `planTransition`, where the existing seeded style draw
 * is applied only after dominated candidates have been removed.
 */
export function rankTransitionCandidates(
  outgoing: { root: PitchClassName; quality: ChordQuality },
  incoming: { root: PitchClassName; quality: ChordQuality },
  options: TransitionRankingOptions,
): TransitionCandidateRanking {
  const profile = transitionProfileFor(options.style);
  const outgoingSemitone = ((pitchClassToSemitone(outgoing.root) % 12) + 12) % 12;
  const candidates = transitionsInto(incoming.root, incoming.quality, options.tonicSemitone)
    .filter((candidate) => (profile.weights[candidate.technique] ?? 0) > 0)
    .filter((candidate) => ((pitchClassToSemitone(candidate.root) % 12) + 12) % 12 !== outgoingSemitone);
  if (candidates.length === 0) {
    return { candidates: [], frontier: [], corpusAvailable: false };
  }
  const evidence = corpusScores(
    outgoing,
    incoming,
    candidates,
    options.tonicSemitone,
    options.provider,
  );
  const corpusAvailable = evidence !== null;
  const scores = candidates.map((candidate): TransitionCandidateScore => ({
    candidate,
    styleWeight: profile.weights[candidate.technique] ?? 0,
    voiceLeadingCost: scoreCandidateVoiceLeading(outgoing, candidate, incoming, options),
    corpus: evidence?.get(candidate.technique) ?? null,
  }));
  const frontier = scores.filter(
    (candidate) => !scores.some(
      (other) => other !== candidate && dominates(other, candidate, corpusAvailable),
    ),
  );
  return { candidates: scores, frontier, corpusAvailable };
}

function rankedExplanation(
  score: TransitionCandidateScore,
  ranking: TransitionCandidateRanking,
): string {
  const comparison = `Auto rank: ${ranking.candidates.length} candidates, ${ranking.frontier.length} on the Pareto frontier`;
  const voice = `four-part cost ${score.voiceLeadingCost.toFixed(2)}`;
  if (!ranking.corpusAvailable || !score.corpus) {
    return `${score.candidate.explanation} ${comparison}; theory-only ranking (no empirical corpus loaded; voice-leading + style prior); ${voice}.`;
  }
  return `${score.candidate.explanation} ${comparison}; hybrid corpus support ${score.corpus.supportedTransitions}/2, mean surprisal ${score.corpus.meanSurprisalBits.toFixed(2)} bits; ${voice}.`;
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
  options: {
    style: StylePresetId;
    seed: Seed;
    boundaryIndex: number;
    tonicSemitone: number;
    mode: Mode;
    provider?: HarmonyStatisticsProvider | null;
  },
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

  const ranking = rankTransitionCandidates(outgoing, incoming, options);
  if (ranking.frontier.length === 0) return null;

  const total = ranking.frontier.reduce(
    (sum, score) => sum + score.styleWeight, 0,
  );
  let pick = hashSeed(deriveSeed(options.seed, "section-transition-pick", options.boundaryIndex)) % total;
  for (const score of ranking.frontier) {
    pick -= score.styleWeight;
    if (pick < 0) {
      return { ...score.candidate, explanation: rankedExplanation(score, ranking) };
    }
  }
  const last = ranking.frontier[ranking.frontier.length - 1] as TransitionCandidateScore;
  return { ...last.candidate, explanation: rankedExplanation(last, ranking) };
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
  options: {
    style: StylePresetId;
    seed: Seed;
    mode: Mode;
    tonicSemitone: number;
    ticksPerBar: number;
  },
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
        mode: options.mode,
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
      // Its own, not the target's. Spreading the incoming chord carries its
      // degree and function across, and an approach chord is neither.
      function: transition.harmonyFunction,
      degree: scaleDegreeOf(transition.root, options.tonicSemitone, options.mode),
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
