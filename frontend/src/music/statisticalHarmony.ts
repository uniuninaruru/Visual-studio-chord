import {
  createStepChordEvent,
} from "./chords";
import { buildCompositionTracks } from "./compositionTracks";
import { PROGRESSION_TEMPLATES } from "./progressions";
import { pitchClassToSemitone } from "./scales";
import { ticksPerBeat } from "./time";
import { romanFor } from "./progressionSearch";
import { planGuideToneLines } from "./guideToneLines";
import {
  profileForStyle,
  revoiceInFourParts,
  scoreVoiceLeading,
  type VoiceAssignment,
} from "./voiceLeading";
import type {
  BarRange,
  ChordEvent,
  ChordQuality,
  GeneratedComposition,
  Mode,
  ProgressionStep,
  PitchClassName,
} from "../types/music";

export type StatisticalProfile = "familiar" | "balanced" | "adventurous";

export interface HarmonyStatisticsProvenance {
  sourceKind: string;
  modelId: string;
  modelVersion: string;
  schemaVersion: number;
  sourceModelOrders: readonly number[];
  browserOrders: readonly number[];
  pop909Commit: string;
  pop909Repository: string;
  pop909SongCount: number;
  sequenceCount: number;
  tokenCount: number;
  fullSourceSha256: string;
  rawSongDataBundled: boolean;
}

export interface ConditionalHarmonyEvidence {
  rawConditionalProbability: number;
  probability: number;
  unigramCount: number;
  exactGramCount: number;
  contextCount: number;
  orderUsed: number;
  surprisalBits: number;
  tokens: readonly string[];
  supported: boolean;
}

export interface HarmonyStatisticsProvider {
  readonly id: string;
  readonly provenance: HarmonyStatisticsProvenance;
  probability(tokens: readonly string[]): ConditionalHarmonyEvidence;
}

export interface StatisticalChordSuggestion {
  step: ProgressionStep;
  chord: ChordEvent;
  romanNumeral: string;
  /** Null when this is a theory-only suggestion and no corpus was supplied. */
  rawConditionalProbability: number | null;
  probability: number | null;
  unigramCount: number | null;
  exactGramCount: number | null;
  contextCount: number | null;
  orderUsed: number | null;
  surprisalBits: number | null;
  /** Lower is better; computed from the existing style voice-leading profile. */
  voiceLeadingCost: number;
  /** Bounded authored contrast (root distance + quality change), not a probability. */
  harmonicContrast: number;
  source: string;
  provenance: HarmonyStatisticsProvenance | null;
  reasons: readonly string[];
}

export interface HarmonyTransitionEvidence {
  fromIndex: number;
  toIndex: number;
  tokens: readonly string[];
  probability: number | null;
  exactGramCount: number | null;
  contextCount: number | null;
  orderUsed: number | null;
  surprisalBits: number | null;
  supported: boolean;
}

export interface HarmonyInsights {
  scope: BarRange | null;
  chordCount: number;
  transitionCount: number;
  geometricMeanConditionalProbability: number | null;
  meanSurprisalBits: number | null;
  supportedTransitionRate: number | null;
  complexChordRate: number;
  complexChordFormula: string;
  extensionRate: number;
  nonDiatonicRate: number;
  advancedQualityRate: number;
  guideToneCoverageRate: number;
  guideToneStepwiseMotionRate: number;
  melodyOnsetsPerBar: number;
  durationWeightedMelodyNonChordTension: number;
  actualBassStepwiseMotionRate: number;
  syncopationRate: number;
  transitions: readonly HarmonyTransitionEvidence[];
  source: string;
  provenance: HarmonyStatisticsProvenance | null;
  /** Whether corpus-derived transition metrics are available for this result. */
  empiricalStatisticsAvailable: boolean;
}

type Snapshot = {
  schemaVersion: number;
  artifactVersion: number;
  provenance: HarmonyStatisticsProvenance;
  orders: Record<string, Record<string, number>>;
};

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clampProbability(value: number): number {
  return Math.min(1, Math.max(Number.MIN_VALUE, finite(value, Number.MIN_VALUE)));
}

const KNOWN_CHORD_QUALITIES: ReadonlySet<ChordQuality> = new Set<ChordQuality>([
  "major",
  "minor",
  "diminished",
  "augmented",
  "dominant7",
  "major7",
  "minor7",
  "halfDiminished7",
  "diminished7",
  "minorMajor7",
  "augmentedMajor7",
  "sus2",
  "sus4",
  "add9",
  "minorAdd9",
]);

const EXPECTED_BROWSER_ORDER_ENTRIES: Readonly<Record<1 | 2 | 3, number>> = {
  1: 106,
  2: 1591,
  3: 7540,
};
const EXPECTED_BROWSER_ORDER_TOTALS: Readonly<Record<1 | 2 | 3, number>> = {
  1: 93904,
  2: 92773,
  3: 91642,
};

function isSupportedCorpusToken(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split(":");
  if (parts.length !== 2 || !/^\d+$/.test(parts[0] ?? "")) return false;
  const root = Number(parts[0]);
  return Number.isInteger(root) && root >= 0 && root <= 11
    && KNOWN_CHORD_QUALITIES.has(parts[1] as ChordQuality);
}

function validateSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Harmony statistics snapshot must be an object.");
  }
  const snapshot = value as Partial<Snapshot>;
  if (snapshot.schemaVersion !== 1 || snapshot.artifactVersion !== 1) {
    throw new Error("Unsupported harmony statistics snapshot version.");
  }
  const provenance = snapshot.provenance;
  if (!provenance || typeof provenance !== "object") {
    throw new Error("Harmony statistics snapshot has no provenance.");
  }
  if (provenance.sourceKind !== "local-corpus"
    || provenance.modelId !== "harmony-corpus-ngram-v1"
    || provenance.modelVersion !== "local-corpus-v1"
    || provenance.schemaVersion !== 1
    || provenance.pop909SongCount !== 909
    || provenance.sequenceCount !== 1131
    || provenance.tokenCount !== 93904
    || provenance.fullSourceSha256 !== "dfa28603b2aa0247abe5265a6975ae8267042a91e72e8c1ddd2221e2624209ae"
    || provenance.rawSongDataBundled !== false
    || provenance.pop909Commit !== "d83e6edba6872a704f5d3b8b32f5cb540088dae6"
    || provenance.pop909Repository !== "https://github.com/music-x-lab/POP909-Dataset"
    || !Array.isArray(provenance.sourceModelOrders)
    || provenance.sourceModelOrders.join(",") !== "1,2,3,4,5"
    || !Array.isArray(provenance.browserOrders)
    || provenance.browserOrders.join(",") !== "1,2,3") {
    throw new Error("Harmony statistics snapshot provenance is invalid.");
  }
  if (!snapshot.orders || typeof snapshot.orders !== "object"
    || Object.keys(snapshot.orders).length !== 3
    || Object.keys(snapshot.orders).some((key) => !["1", "2", "3"].includes(key))) {
    throw new Error("Harmony statistics snapshot has no orders.");
  }
  for (const order of [1, 2, 3] as const) {
    const counts = snapshot.orders[String(order)];
    if (!counts || typeof counts !== "object" || Array.isArray(counts)
      || Object.keys(counts).length !== EXPECTED_BROWSER_ORDER_ENTRIES[order]) {
      throw new Error(`Harmony statistics order ${order} is invalid.`);
    }
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (total !== EXPECTED_BROWSER_ORDER_TOTALS[order]) {
      throw new Error(`Harmony statistics order ${order} total is invalid.`);
    }
    for (const [gram, count] of Object.entries(counts)) {
      if (gram.split(">").length !== order
        || gram.split(">").some((token) => !isSupportedCorpusToken(token))
        || !Number.isInteger(count)
        || count <= 0) {
        throw new Error(`Harmony statistics gram ${gram} is invalid.`);
      }
    }
  }
  return snapshot as Snapshot;
}

function contextTotals(
  counts: Record<string, number>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const [gram, count] of Object.entries(counts)) {
    const parts = gram.split(">");
    const context = parts.slice(0, -1).join(">");
    totals[context] = (totals[context] ?? 0) + count;
  }
  return totals;
}

class LocalCorpusHarmonyProvider implements HarmonyStatisticsProvider {
  /** Explicit legacy provider; never created by the normal browser runtime. */
  readonly id = "legacy-pop909-ngram-3";
  readonly provenance: HarmonyStatisticsProvenance;
  private readonly orders: {
    1: Record<string, number>;
    2: Record<string, number>;
    3: Record<string, number>;
  };
  private readonly totals: { 1: number; 2: number; 3: number };
  private readonly contexts: {
    2: Record<string, number>;
    3: Record<string, number>;
  };
  private readonly vocabularySize: number;

  constructor(snapshot: unknown) {
    const checked = validateSnapshot(snapshot);
    this.provenance = checked.provenance;
    const order1 = checked.orders["1"];
    const order2 = checked.orders["2"];
    const order3 = checked.orders["3"];
    if (!order1 || !order2 || !order3) throw new Error("Harmony statistics orders are incomplete.");
    this.orders = { 1: order1, 2: order2, 3: order3 };
    this.totals = {
      1: Object.values(this.orders[1]).reduce((sum, count) => sum + count, 0),
      2: Object.values(this.orders[2]).reduce((sum, count) => sum + count, 0),
      3: Object.values(this.orders[3]).reduce((sum, count) => sum + count, 0),
    };
    this.contexts = {
      2: contextTotals(this.orders[2]),
      3: contextTotals(this.orders[3]),
    };
    this.vocabularySize = Object.keys(this.orders[1]).length;
    if ([this.totals[1], this.totals[2], this.totals[3]].some((total) => !Number.isFinite(total) || total <= 0)) {
      throw new Error("Harmony statistics snapshot totals are invalid.");
    }
  }

  private interpolated(tokens: readonly string[]): number {
    const normalized = tokens.slice(-3);
    if (normalized.length <= 1) {
      const count = this.orders[1][normalized[0] ?? ""] ?? 0;
      return clampProbability((count + 1) / (this.totals[1] + this.vocabularySize));
    }
    const order = normalized.length;
    const gram = normalized.join(">");
    const context = normalized.slice(0, -1).join(">");
    const contextCount = this.contexts[order as 2 | 3][context] ?? 0;
    const lower = this.interpolated(normalized.slice(1));
    if (contextCount === 0) return lower;
    const maximumLikelihood = (this.orders[order as 2 | 3][gram] ?? 0) / contextCount;
    const interpolation = contextCount / (contextCount + this.vocabularySize);
    return clampProbability(interpolation * maximumLikelihood + (1 - interpolation) * lower);
  }

  probability(tokens: readonly string[]): ConditionalHarmonyEvidence {
    if (tokens.length > 0 && tokens.some((token) => !isSupportedCorpusToken(token))) {
      throw new Error("Harmony statistics tokens are malformed.");
    }
    const normalized = tokens.slice(-3);
    if (normalized.length === 0) {
      return {
        rawConditionalProbability: 0,
        probability: 1,
        unigramCount: 0,
        exactGramCount: 0,
        contextCount: 0,
        orderUsed: 0,
        surprisalBits: 0,
        tokens: [],
        supported: false,
      };
    }
    const probability = this.interpolated(normalized);
    let orderUsed = 1;
    for (let order = normalized.length; order >= 2; order -= 1) {
      const context = normalized.slice(-order, -1).join(">");
      if ((this.contexts[order as 2 | 3][context] ?? 0) > 0) {
        orderUsed = order;
        break;
      }
    }
    const gram = normalized.slice(-(orderUsed)).join(">");
    const exactGramCount = this.orders[orderUsed as 1 | 2 | 3][gram] ?? 0;
    const unigramCount = this.orders[1][normalized.at(-1) ?? ""] ?? 0;
    const contextCount = orderUsed === 1
      ? this.totals[1]
      : this.contexts[orderUsed as 2 | 3][normalized.slice(-orderUsed, -1).join(">")] ?? 0;
    const safeProbability = clampProbability(probability);
    const rawConditionalProbability = contextCount > 0
      ? finite(exactGramCount / contextCount)
      : 0;
    return {
      rawConditionalProbability,
      probability: safeProbability,
      unigramCount,
      exactGramCount,
      contextCount,
      orderUsed,
      surprisalBits: finite(-Math.log2(safeProbability), 0),
      tokens: normalized,
      supported: exactGramCount > 0,
    };
  }
}

export { LocalCorpusHarmonyProvider };
export { LocalCorpusHarmonyProvider as LocalCorpusProvider };

/** Validate an artifact before handing it to a provider or a diagnostic view. */
export function validateHarmonyStatisticsSnapshot(value: unknown): HarmonyStatisticsProvenance {
  return validateSnapshot(value).provenance;
}

/**
 * Construct the legacy corpus provider from an explicitly supplied snapshot.
 *
 * The browser generation path intentionally has no default snapshot. Callers
 * running a research recipe may import the generated artifact in that recipe
 * and pass it here; the application itself does not do so.
 */
export function createLocalCorpusProvider(snapshot: unknown): HarmonyStatisticsProvider {
  return new LocalCorpusHarmonyProvider(snapshot);
}

/** No empirical corpus is bundled or selected by the normal browser runtime. */
export function getLocalCorpusProvider(): HarmonyStatisticsProvider | null {
  return null;
}

function canonicalStep(step: ProgressionStep): string {
  return JSON.stringify({
    degree: step.degree,
    alteration: step.alteration ?? 0,
    quality: step.quality ?? "",
    tensions: [...(step.tensions ?? [])].sort(),
    bassDegree: step.bassDegree ?? 0,
    bassAlteration: step.bassAlteration ?? 0,
    role: step.role ?? "",
    targetDegree: step.targetDegree ?? 0,
  });
}

/**
 * Corpus tokens do not contain voicing, tensions, slash bass, or functional
 * targets. Keep a statistical preview equally honest: it ranks root+quality,
 * then lets the theory/arrangement editor choose those acoustic details.
 */
function statisticalStep(step: ProgressionStep): ProgressionStep {
  return {
    degree: step.degree,
    ...(step.alteration !== undefined ? { alteration: step.alteration } : {}),
    ...(step.quality !== undefined ? { quality: step.quality } : {}),
  };
}

function activeKeyAndMode(
  composition: GeneratedComposition,
  startBar: number,
): { key: PitchClassName; mode: Mode } {
  const section = composition.sections?.find((entry) => startBar >= entry.startBar && startBar < entry.endBar);
  return { key: section?.key ?? composition.settings.key, mode: section?.mode ?? composition.settings.mode };
}

function contextForChord(composition: GeneratedComposition, chord: ChordEvent): { key: PitchClassName; mode: Mode } {
  const bar = Math.floor(chord.startTick / composition.ticksPerBar);
  const section = composition.sections?.find((entry) => bar >= entry.startBar && bar < entry.endBar);
  return { key: section?.key ?? composition.settings.key, mode: section?.mode ?? composition.settings.mode };
}

function sameContext(
  left: { key: PitchClassName; mode: Mode },
  right: { key: PitchClassName; mode: Mode },
): boolean {
  return left.key === right.key && left.mode === right.mode;
}

function rootToken(chord: ChordEvent, key: PitchClassName): string {
  const relative = ((pitchClassToSemitone(chord.root) - pitchClassToSemitone(key)) % 12 + 12) % 12;
  return `${relative}:${chord.quality}`;
}

function targetChords(composition: GeneratedComposition, scope: BarRange | null): ChordEvent[] {
  if (!scope) return [...composition.chords].sort((a, b) => a.startTick - b.startTick);
  const start = scope.startBar * composition.ticksPerBar;
  const end = scope.endBar * composition.ticksPerBar;
  return composition.chords
    .filter((chord) => chord.startTick < end
      && chord.startTick + chord.durationTick > start)
    .sort((a, b) => a.startTick - b.startTick);
}

function analysisTokens(
  composition: GeneratedComposition,
  chords: readonly ChordEvent[],
  index: number,
): string[] {
  const current = contextForChord(composition, chords[index]!);
  const tokens: string[] = [];
  for (let cursor = index; cursor >= 0 && tokens.length < 3; cursor -= 1) {
    const chord = chords[cursor]!;
    const candidate = contextForChord(composition, chord);
    if (!sameContext(current, candidate)) break;
    tokens.unshift(rootToken(chord, candidate.key));
  }
  return tokens;
}

function candidateSteps(mode: Mode): ProgressionStep[] {
  const seen = new Set<string>();
  const candidates: ProgressionStep[] = [];
  for (const template of PROGRESSION_TEMPLATES) {
    if (!template.modes.includes(mode)) continue;
    for (const step of template.steps) {
      const plainStep = statisticalStep(step);
      const key = canonicalStep(plainStep);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(plainStep);
    }
  }
  return candidates;
}

function suggestionReasons(
  evidence: ConditionalHarmonyEvidence,
  profile: StatisticalProfile,
): string[] {
  const support = evidence.orderUsed === 1
    ? `${evidence.exactGramCount}出現 / コーパス総token ${evidence.contextCount}出現`
    : evidence.supported
      ? `${evidence.exactGramCount}出現 / 文脈${evidence.contextCount}出現`
      : `この完全一致の文脈は未観測（${evidence.contextCount}出現の文脈からbackoff）`;
  const profileReason = profile === "familiar"
    ? "この文脈で定番寄り"
    : profile === "adventurous"
      ? "観測済みの中では意外性が高め"
      : "定番度と意外性の中間";
  return [`補間推定確率 ${(evidence.probability * 100).toFixed(2)}%`, support, profileReason];
}

function theorySuggestionReasons(
  voiceLeadingCost: number,
  harmonicContrast: number,
  profile: StatisticalProfile,
): string[] {
  const profileReason = profile === "familiar"
    ? "ボイスリーディングの移動コストが低い候補"
    : profile === "adventurous"
      ? "理論上有効で、別のボイスリーディングを試せる候補"
      : "理論上有効で、滑らかさと変化のバランスを取った候補";
  return [
    "内蔵のコード理論テンプレートから生成",
    profileReason,
    `スタイル別ボイスリーディングコスト ${voiceLeadingCost.toFixed(2)}（低いほど滑らか）`,
    `理論上の変化度 ${harmonicContrast.toFixed(2)}（根音距離とコード品質の差から算出）`,
  ];
}

export function harmonicContrast(
  previous: ChordEvent | undefined,
  candidate: ChordEvent,
): number {
  if (!previous) return 0;
  const previousRoot = pitchClassToSemitone(previous.root);
  const candidateRoot = pitchClassToSemitone(candidate.root);
  const difference = Math.abs(candidateRoot - previousRoot) % 12;
  const interval = Math.min(difference, 12 - difference);
  const rootDistance = interval / 6;
  const qualityChange = previous.quality === candidate.quality ? 0 : 1;
  // This is intentionally a bounded, transparent theory heuristic. It ranks
  // valid alternatives with some harmonic colour without treating a rough
  // voice-leading move as evidence of quality.
  return Math.min(1, rootDistance * 0.7 + qualityChange * 0.3);
}

function assignmentFromNotes(notes: readonly number[]): VoiceAssignment | null {
  if (notes.length !== 4 || notes.some((note) => !Number.isFinite(note))) return null;
  return {
    bass: notes[0] as number,
    tenor: notes[1] as number,
    alto: notes[2] as number,
    soprano: notes[3] as number,
  };
}

/**
 * Score a theory candidate using the same style-aware four-part evaluator as
 * generation and section transitions. This is deliberately not normalized as a
 * probability: a local voice-leading cost is a diagnostic, not empirical data.
 */
function theoryVoiceLeadingCost(
  composition: GeneratedComposition,
  previous: ChordEvent | undefined,
  candidate: ChordEvent,
  key: PitchClassName,
  mode: Mode,
): number {
  const sequence = previous ? [previous, candidate] : [candidate];
  const voiced = revoiceInFourParts(sequence, {
    key,
    mode,
    style: composition.resolvedStyle,
    optimizeSequence: true,
  });
  const candidateAssignment = assignmentFromNotes(voiced.at(-1)?.notes ?? []);
  if (!candidateAssignment) return Number.POSITIVE_INFINITY;
  if (!previous || voiced.length < 2) {
    // There is no prior chord at the song end of an empty composition. Keep a
    // deterministic resting cost for the first candidate based on its register.
    return candidateAssignment.soprano - candidateAssignment.bass;
  }
  const previousAssignment = assignmentFromNotes(voiced[0]?.notes ?? []);
  if (!previousAssignment) return Number.POSITIVE_INFINITY;
  return scoreVoiceLeading(
    previousAssignment,
    candidateAssignment,
    {
      key,
      mode,
      root: candidate.root,
      quality: candidate.quality,
      tonicSemitone: pitchClassToSemitone(key),
    },
    profileForStyle(composition.resolvedStyle),
  ).total;
}

export interface StatisticalSuggestionOptions {
  profile?: StatisticalProfile;
  provider?: HarmonyStatisticsProvider | null;
  limit?: number;
  /** Scores a replacement at this exact event. Omit for a song-end continuation preview. */
  targetChord?: ChordEvent;
}

export function suggestNextChords(
  composition: GeneratedComposition,
  options: StatisticalSuggestionOptions = {},
): StatisticalChordSuggestion[] {
  const provider = options.provider ?? getLocalCorpusProvider();
  const profile = options.profile ?? "balanced";
  const targetStartTick = options.targetChord?.startTick ?? composition.totalTicks;
  const targetStartBar = options.targetChord
    ? Math.floor(targetStartTick / composition.ticksPerBar)
    : Math.max(0, Math.ceil(composition.totalTicks / composition.ticksPerBar) - 1);
  const { key, mode } = activeKeyAndMode(composition, targetStartBar);
  const prior = composition.chords
    .filter((chord) => chord.startTick < targetStartTick)
    .sort((a, b) => a.startTick - b.startTick);
  const targetContext = options.targetChord
    ? contextForChord(composition, options.targetChord)
    : { key, mode };
  const fallback: ChordEvent[] = [];
  for (let index = prior.length - 1; index >= 0 && fallback.length < 2; index -= 1) {
    const chord = prior[index]!;
    if (!sameContext(targetContext, contextForChord(composition, chord))) break;
    fallback.unshift(chord);
  }
  const contextTokens = fallback.map((chord) => rootToken(chord, contextForChord(composition, chord).key));
  const candidatesByToken = new Map<string, StatisticalChordSuggestion>();
  const durationTick = options.targetChord?.durationTick ?? composition.ticksPerBar;
  for (const step of candidateSteps(mode)) {
    let chord: ChordEvent;
    try {
      chord = createStepChordEvent({
        step,
        key,
        mode,
        startTick: targetStartTick,
        durationTick,
        id: `statistics-preview-${canonicalStep(step)}`,
        previousNotes: fallback.at(-1)?.notes,
      });
    } catch {
      continue;
    }
    if (options.targetChord
      && chord.root === options.targetChord.root
      && chord.quality === options.targetChord.quality) {
      continue;
    }
    const tokens = [...contextTokens, rootToken(chord, key)];
    const evidence = provider?.probability(tokens);
    // A corpus-backed candidate must have unigram evidence. In the normal
    // browser path there is no corpus, so theory-valid candidates remain
    // available and carry null empirical fields rather than invented zeros.
    if (evidence && evidence.unigramCount === 0) continue;
    if (evidence && profile === "adventurous" && evidence.exactGramCount === 0) continue;
    const voiceLeadingCost = theoryVoiceLeadingCost(
      composition,
      fallback.at(-1),
      chord,
      key,
      mode,
    );
    if (!Number.isFinite(voiceLeadingCost)) continue;
    const contrast = harmonicContrast(fallback.at(-1), chord);
    const resolvedStep: ProgressionStep = {
      degree: step.degree,
      ...(step.alteration !== undefined ? { alteration: step.alteration } : {}),
      quality: chord.quality,
    };
    const suggestion: StatisticalChordSuggestion = {
      step: resolvedStep,
      chord,
      romanNumeral: romanFor(step, mode),
      rawConditionalProbability: evidence?.rawConditionalProbability ?? null,
      probability: evidence?.probability ?? null,
      unigramCount: evidence?.unigramCount ?? null,
      exactGramCount: evidence?.exactGramCount ?? null,
      contextCount: evidence?.contextCount ?? null,
      orderUsed: evidence?.orderUsed ?? null,
      surprisalBits: evidence?.surprisalBits ?? null,
      voiceLeadingCost,
      harmonicContrast: contrast,
      source: evidence
        ? (provider?.id.startsWith("legacy-pop909")
          ? "legacy POP909 corpus (explicit)"
          : `empirical provider: ${provider?.id}`)
        : "内蔵音楽理論・スタイル別ボイスリーディング",
      provenance: provider?.provenance ?? null,
      reasons: evidence
        ? suggestionReasons(evidence, profile)
        : theorySuggestionReasons(voiceLeadingCost, contrast, profile),
    };
    const token = rootToken(chord, key);
    const existing = candidatesByToken.get(token);
    if (!existing || canonicalStep(resolvedStep).localeCompare(canonicalStep(existing.step)) < 0) {
      candidatesByToken.set(token, suggestion);
    }
  }
  const sorted = [...candidatesByToken.values()];
  const median = sorted.length === 0
    ? 0
    : (() => {
      // Selection avoids a second output sort: the only comparator below is
      // the profile ordering comparator, whose final key is canonicalStep.
      const values = sorted.map((entry) => entry.surprisalBits);
      const rank = Math.floor(values.length / 2);
      for (let target = 0; target <= rank; target += 1) {
        let minimum = target;
        for (let index = target + 1; index < values.length; index += 1) {
          if ((values[index] ?? 0) < (values[minimum] ?? 0)) minimum = index;
        }
        [values[target], values[minimum]] = [values[minimum] as number, values[target] as number];
      }
      return values[rank] ?? 0;
    })();
  const medianVoiceLeading = sorted.length === 0
    ? 0
    : (() => {
      const values = sorted.map((entry) => entry.voiceLeadingCost).sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)] ?? 0;
    })();
  if (!provider && sorted.length > 0) {
    // Keep adventurous choices inside a bounded quality envelope around the
    // smoothest valid option. Contrast can provide colour, but a poor move is
    // never promoted merely because it has a larger voice-leading penalty.
    const minimumVoiceLeading = Math.min(...sorted.map((entry) => entry.voiceLeadingCost));
    const maximumVoiceLeading = minimumVoiceLeading + 6;
    const qualityBounded = sorted.filter((entry) => entry.voiceLeadingCost <= maximumVoiceLeading);
    if (qualityBounded.length > 0) {
      sorted.splice(0, sorted.length, ...qualityBounded);
    }
  }
  sorted.sort((left, right) => {
    if (!provider) {
      const primary = profile === "balanced"
        ? Math.abs(left.voiceLeadingCost - medianVoiceLeading)
          - Math.abs(right.voiceLeadingCost - medianVoiceLeading)
        : profile === "adventurous"
          ? right.harmonicContrast - left.harmonicContrast
          : left.voiceLeadingCost - right.voiceLeadingCost;
      const secondary = profile === "adventurous"
        ? left.voiceLeadingCost - right.voiceLeadingCost
        : right.harmonicContrast - left.harmonicContrast;
      return primary || secondary || canonicalStep(left.step).localeCompare(canonicalStep(right.step));
    }
    const primary = profile === "balanced"
      ? Math.abs((left.surprisalBits ?? 0) - median)
        - Math.abs((right.surprisalBits ?? 0) - median)
      : profile === "adventurous"
        ? (right.surprisalBits ?? 0) - (left.surprisalBits ?? 0)
          || (right.exactGramCount ?? 0) - (left.exactGramCount ?? 0)
        : (right.probability ?? 0) - (left.probability ?? 0);
    const secondary = profile === "familiar"
      ? (left.surprisalBits ?? 0) - (right.surprisalBits ?? 0)
      : profile === "balanced"
        ? (right.probability ?? 0) - (left.probability ?? 0)
        : 0;
    return primary || secondary || canonicalStep(left.step).localeCompare(canonicalStep(right.step));
  });
  return sorted.slice(0, options.limit ?? 6);
}

function scopeTicks(composition: GeneratedComposition, scope: BarRange | null): { start: number; end: number } {
  return scope
    ? { start: scope.startBar * composition.ticksPerBar, end: scope.endBar * composition.ticksPerBar }
    : { start: 0, end: composition.totalTicks };
}

function rangeNotes(composition: GeneratedComposition, scope: BarRange | null) {
  const { start, end } = scopeTicks(composition, scope);
  return composition.notes.filter((note) => note.startTick < end && note.startTick + note.durationTick > start);
}

export function analyzeHarmonyStatistics(
  composition: GeneratedComposition,
  scope: BarRange | null = null,
  provider: HarmonyStatisticsProvider | null = getLocalCorpusProvider(),
): HarmonyInsights {
  const allChords = [...composition.chords].sort((a, b) => a.startTick - b.startTick);
  const chords = targetChords(composition, scope);
  const transitions: HarmonyTransitionEvidence[] = [];
  let transitionLogProbability = 0;
  let supported = 0;
  for (let index = 0; index < chords.length; index += 1) {
    const chord = chords[index]!;
    const fullIndex = allChords.indexOf(chord);
    const tokens = analysisTokens(composition, allChords, fullIndex);
    const evidence = provider?.probability(tokens);
    const previous = index > 0 ? chords[index - 1] : undefined;
    const isEligibleTransition = previous !== undefined
      && sameContext(contextForChord(composition, previous), contextForChord(composition, chord));
    if (isEligibleTransition) {
      if (evidence) {
        transitionLogProbability += Math.log(clampProbability(evidence.probability));
        if (evidence.supported) supported += 1;
      }
      transitions.push({
        fromIndex: index - 1,
        toIndex: index,
        tokens,
        probability: evidence?.probability ?? null,
        exactGramCount: evidence?.exactGramCount ?? null,
        contextCount: evidence?.contextCount ?? null,
        orderUsed: evidence?.orderUsed ?? null,
        surprisalBits: evidence?.surprisalBits ?? null,
        supported: evidence?.supported ?? false,
      });
    }
  }
  const count = chords.length;
  const extensionCount = chords.filter((chord) => (chord.tensions?.length ?? 0) > 0
    || ["dominant7", "major7", "minor7", "halfDiminished7", "diminished7", "minorMajor7", "augmentedMajor7", "add9", "minorAdd9", "sus2", "sus4"].includes(chord.quality)).length;
  const nonDiatonicCount = chords.filter((chord) => chord.source !== "diatonic").length;
  const advancedQualityCount = chords.filter((chord) => ["diminished", "augmented", "halfDiminished7", "diminished7", "minorMajor7", "augmentedMajor7"].includes(chord.quality)).length;
  const notes = rangeNotes(composition, scope);
  let weightedTension = 0;
  let totalNoteDuration = 0;
  const { start: scopeStart, end: scopeEnd } = scopeTicks(composition, scope);
  for (const note of notes) {
    const noteStart = Math.max(scopeStart, note.startTick);
    const noteEnd = Math.min(scopeEnd, note.startTick + Math.max(0, note.durationTick));
    if (noteEnd <= noteStart) continue;
    for (const chord of allChords) {
      const segmentStart = Math.max(noteStart, chord.startTick);
      const segmentEnd = Math.min(noteEnd, chord.startTick + chord.durationTick);
      if (segmentEnd <= segmentStart) continue;
      const duration = segmentEnd - segmentStart;
      totalNoteDuration += duration;
      if (!chord.notes.some((pitch) => pitch % 12 === note.midi % 12)) weightedTension += duration;
    }
  }
  let stepwise = 0;
  let bassTransitions = 0;
  const bassTrack = buildCompositionTracks(composition).find((track) => track.role === "bass");
  const actualBass = (chord: ChordEvent): number => {
    if (!bassTrack) return Number.NaN;
    const onsetNotes = bassTrack.notes.filter((note) => note.startTick === chord.startTick);
    const activeNotes = onsetNotes.length > 0
      ? onsetNotes
      : bassTrack.notes.filter((note) => note.startTick <= chord.startTick
        && note.startTick + note.durationTick > chord.startTick);
    return activeNotes.length === 0
      ? Number.NaN
      : Math.min(...activeNotes.map((note) => note.midi));
  };
  for (let index = 1; index < chords.length; index += 1) {
    const previousBass = actualBass(chords[index - 1]!);
    const bass = actualBass(chords[index]!);
    if (Number.isFinite(previousBass) && Number.isFinite(bass)) {
      bassTransitions += 1;
      if (Math.abs(bass - previousBass) <= 2) stepwise += 1;
    }
  }
  const guideToneLines = planGuideToneLines(chords);
  const guideToneCount = guideToneLines[0]?.notes.length ?? 0;
  const guideToneCoverageRate = count === 0 ? 0 : guideToneCount / count;
  const guideToneMotions = guideToneLines.flatMap((line) => line.notes.slice(1));
  const guideToneStepwiseMotionRate = guideToneMotions.length === 0
    ? 0
    : guideToneMotions.filter((note) => Math.abs(note.motion) <= 2).length / guideToneMotions.length;
  const beatTick = ticksPerBeat(composition.timeSignature, composition.ppq);
  const onsetNotes = composition.notes.filter((note) => note.startTick >= scopeStart
    && note.startTick < scopeEnd);
  const syncopated = onsetNotes.filter((note) => note.startTick >= scopeStart
    && note.startTick < scopeEnd
    && note.startTick % beatTick !== 0).length;
  const scopeBars = Math.max(1, (scopeEnd - scopeStart) / composition.ticksPerBar);
  const safeCount = Math.max(1, count);
  return {
    scope,
    chordCount: count,
    transitionCount: transitions.length,
    geometricMeanConditionalProbability: !provider
      ? null
      : transitions.length === 0
        ? 0
        : clampProbability(Math.exp(transitionLogProbability / transitions.length)),
    meanSurprisalBits: !provider
      ? null
      : transitions.length === 0
        ? 0
        : finite((-transitionLogProbability / Math.LN2) / transitions.length),
    supportedTransitionRate: !provider
      ? null
      : transitions.length === 0
        ? 0
        : supported / transitions.length,
    complexChordRate: (extensionCount + nonDiatonicCount + advancedQualityCount) / (3 * safeCount),
    complexChordFormula: "(extensions + non-diatonic + advanced qualities) / (3 × chord count)",
    extensionRate: extensionCount / safeCount,
    nonDiatonicRate: nonDiatonicCount / safeCount,
    advancedQualityRate: advancedQualityCount / safeCount,
    guideToneCoverageRate,
    guideToneStepwiseMotionRate,
    melodyOnsetsPerBar: onsetNotes.length / scopeBars,
    durationWeightedMelodyNonChordTension: totalNoteDuration === 0 ? 0 : weightedTension / totalNoteDuration,
    actualBassStepwiseMotionRate: bassTransitions === 0 ? 0 : stepwise / bassTransitions,
    syncopationRate: onsetNotes.length === 0 ? 0 : syncopated / onsetNotes.length,
    transitions,
    source: provider
      ? (provider.id.startsWith("legacy-pop909")
        ? "legacy POP909 corpus (explicit)"
        : `empirical provider: ${provider.id}`)
      : "内蔵音楽診断（実曲コーパス未読込）",
    provenance: provider?.provenance ?? null,
    empiricalStatisticsAvailable: provider !== null,
  };
}

export const analyzeHarmony = analyzeHarmonyStatistics;
export const suggestStatisticalChords = suggestNextChords;
