import {
  analyzeArrangementQuality,
  diatonicQualityForDegree,
  diatonicSeventhQualityForDegree,
  formatChordSymbol,
  harmonyFunctionForDegree,
  intervalForTension,
  pitchClassToSemitone,
  romanNumeralForChordQuality,
  scaleDegreeForPitchClass,
  semitoneToPitchClass,
  validateComposition,
  voiceChord,
} from "../music";
import type {
  BarRange,
  ChordEvent,
  GeneratedComposition,
  Mode,
  Tension,
} from "../types/music";
import type {
  HarmonyCandidate,
  HarmonyEditSpan,
  HarmonyFactorEvent,
  HarmonyGenerateRequest,
  HarmonyJobResponse,
  HarmonyMaskMode,
  HarmonyModelId,
  HarmonyPreferredDevice,
  HarmonyTonalitySpan,
  NeuralHarmonyPreviewMetadata,
} from "./inferenceTypes";

export interface HarmonyRequestContext {
  request: HarmonyGenerateRequest;
  sourceCompositionId: string;
  sourceFingerprint: string;
  selectedRange: BarRange;
}

export interface BuildHarmonyRequestOptions {
  composition: GeneratedComposition;
  selectedRange: BarRange;
  modelId: HarmonyModelId;
  requestId: string;
  candidateCount?: number;
  preferredDevice?: HarmonyPreferredDevice;
}

export interface MaterializedHarmonyPreviews {
  previews: GeneratedComposition[];
  metadataByCompositionId: Record<string, NeuralHarmonyPreviewMetadata>;
  rebasedAgainstNewerEdits: boolean;
}

interface Tonality {
  keyRoot: number;
  mode: Mode;
}

interface TimelinePiece {
  startTick: number;
  endTick: number;
  kind: "generated" | "preserved";
  sourceKey: string;
  factor?: HarmonyFactorEvent;
  chord?: ChordEvent;
}

interface ValidatedPreview {
  composition: GeneratedComposition;
  theoryWarnings: string[];
  arrangementWarnings: string[];
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function compositionFingerprint(composition: GeneratedComposition): string {
  return JSON.stringify({
    settings: composition.settings,
    chords: composition.chords,
    notes: composition.notes,
    voices: composition.voices ?? [],
    lockedBars: composition.lockedBars,
    sections: composition.sections ?? [],
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function maskModeAt(spans: readonly HarmonyEditSpan[], tick: number): HarmonyMaskMode | null {
  return spans.find((span) => span.startTick <= tick && tick < span.endTick)?.mode ?? null;
}

function tonalityAt(
  spans: readonly HarmonyTonalitySpan[],
  tick: number,
): Tonality | null {
  const span = spans.find((candidate) =>
    candidate.startTick <= tick && tick < candidate.endTick
  );
  return span ? { keyRoot: span.keyRoot, mode: span.mode } : null;
}

function chordAt(
  composition: GeneratedComposition,
  tick: number,
): ChordEvent | null {
  return composition.chords.find((chord) =>
    chord.startTick <= tick && tick < chord.startTick + chord.durationTick
  ) ?? null;
}

function mergeSpans<T extends { startTick: number; endTick: number }>(
  spans: readonly T[],
  equivalent: (left: T, right: T) => boolean,
): T[] {
  const merged: T[] = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (
      previous
      && previous.endTick === span.startTick
      && equivalent(previous, span)
    ) {
      previous.endTick = span.endTick;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function generationMask(
  composition: GeneratedComposition,
  range: BarRange,
): HarmonyEditSpan[] {
  const locked = new Set(composition.lockedBars);
  const raw = composition.bars.map((bar) => ({
    startTick: bar.startTick,
    endTick: bar.startTick + bar.durationTick,
    mode: (
      bar.index >= range.startBar
      && bar.index < range.endBar
      && !locked.has(bar.index)
        ? "generate"
        : "preserve"
    ) as HarmonyMaskMode,
  }));
  return mergeSpans(raw, (left, right) => left.mode === right.mode);
}

function tonalities(composition: GeneratedComposition): HarmonyTonalitySpan[] {
  const raw = composition.sections?.map((section) => ({
    startTick: section.startBar * composition.ticksPerBar,
    endTick: section.endBar * composition.ticksPerBar,
    keyRoot: pitchClassToSemitone(section.key),
    mode: section.mode,
  })) ?? [{
    startTick: 0,
    endTick: composition.totalTicks,
    keyRoot: pitchClassToSemitone(composition.settings.key),
    mode: composition.settings.mode,
  }];
  return mergeSpans(
    raw,
    (left, right) => left.keyRoot === right.keyRoot && left.mode === right.mode,
  );
}

function soundingBassOffset(chord: ChordEvent): number {
  const root = pitchClassToSemitone(chord.root);
  const bass = chord.bass
    ? pitchClassToSemitone(chord.bass)
    : chord.notes.length > 0
      ? Math.min(...chord.notes) % 12
      : root;
  return (bass - root + 12) % 12;
}

function existingHarmony(
  composition: GeneratedComposition,
  masks: readonly HarmonyEditSpan[],
  keys: readonly HarmonyTonalitySpan[],
) {
  const boundaries = new Set<number>([0, composition.totalTicks]);
  for (const chord of composition.chords) {
    boundaries.add(chord.startTick);
    boundaries.add(chord.startTick + chord.durationTick);
  }
  for (const span of [...masks, ...keys]) {
    boundaries.add(span.startTick);
    boundaries.add(span.endTick);
  }
  const ordered = [...boundaries].sort((left, right) => left - right);
  return ordered.slice(0, -1).map((startTick, index) => {
    const endTick = ordered[index + 1] as number;
    const chord = chordAt(composition, startTick);
    const key = tonalityAt(keys, startTick);
    const mode = maskModeAt(masks, startTick);
    if (!chord || !key || !mode || endTick <= startTick) {
      throw new Error("Composition does not provide a complete harmony timeline.");
    }
    return {
      startTick,
      durationTick: endTick - startTick,
      rootOffsetFromKey:
        (pitchClassToSemitone(chord.root) - key.keyRoot + 12) % 12,
      quality: chord.quality,
      inversion: clamp(Math.round(chord.inversion), 0, 3),
      bassOffsetFromRoot: soundingBassOffset(chord),
      extensions: [...(chord.tensions ?? [])],
      locked: mode !== "generate",
    };
  });
}

function hasSameModelContext(
  composition: GeneratedComposition,
  request: HarmonyGenerateRequest,
): boolean {
  return composition.timeSignature === request.controls.timeSignature
    && JSON.stringify(tonalities(composition)) === JSON.stringify(request.tonalities);
}

export function buildHarmonyGenerateRequest(
  options: BuildHarmonyRequestOptions,
): HarmonyRequestContext {
  const { composition, selectedRange, modelId, requestId } = options;
  if (
    selectedRange.startBar < 0
    || selectedRange.endBar > composition.settings.bars
    || selectedRange.startBar >= selectedRange.endBar
  ) {
    throw new RangeError("Harmony generation requires a valid selected bar range.");
  }
  const masks = generationMask(composition, selectedRange);
  if (!masks.some((span) => span.mode === "generate")) {
    throw new Error("Every selected bar is locked; there is nothing to generate.");
  }
  const keys = tonalities(composition);
  const request: HarmonyGenerateRequest = {
    apiVersion: "2",
    requestId,
    modelId,
    seed: String(composition.seed).slice(0, 128),
    candidateCount: clamp(Math.round(options.candidateCount ?? 3), 1, 32),
    preferredDevice: options.preferredDevice ?? "auto",
    allowCpuFallback: true,
    melody: composition.notes.map((note) => ({
      startTick: note.startTick,
      durationTick: note.durationTick,
      midi: note.midi,
      velocity: note.velocity,
      role: note.role,
    })),
    existingHarmony: existingHarmony(composition, masks, keys),
    generationMask: masks,
    tonalities: keys,
    controls: {
      ppq: composition.ppq,
      ticksPerBar: composition.ticksPerBar,
      timeSignature: composition.timeSignature,
      startTick: 0,
      endTick: composition.totalTicks,
    },
  };
  return {
    request,
    sourceCompositionId: composition.id,
    sourceFingerprint: compositionFingerprint(composition),
    selectedRange: { ...selectedRange },
  };
}

function validateCandidateTimeline(
  candidate: HarmonyCandidate,
  context: HarmonyRequestContext,
): boolean {
  if (
    !candidate.requiresClientValidation
    || candidate.adoptable
    || candidate.hardRuleValidation !== "pendingClient"
    || candidate.events.length === 0
    || !Object.values(candidate.hardRuleVector).every(Number.isFinite)
  ) return false;
  let cursor = context.request.controls.startTick;
  for (const event of candidate.events) {
    if (
      !Number.isInteger(event.startTick)
      || !Number.isInteger(event.durationTick)
      || event.startTick !== cursor
      || event.durationTick <= 0
      || event.rootOffsetFromKey < 0
      || event.rootOffsetFromKey > 11
      || event.inversion < 0
      || event.inversion > 3
      || event.bassOffsetFromRoot < 0
      || event.bassOffsetFromRoot > 11
      || !Number.isFinite(event.confidence)
      || event.confidence < 0
      || event.confidence > 1
    ) return false;
    const lockedCondition = context.request.existingHarmony.find((condition) =>
      condition.locked
      && condition.startTick <= event.startTick
      && event.startTick < condition.startTick + condition.durationTick
    );
    const expected = lockedCondition
      ? "preserve"
      : maskModeAt(context.request.generationMask, event.startTick);
    const actual = event.maskMode === "generated"
      ? "generate"
      : event.maskMode === "preserved"
        ? "preserve"
        : "conditionOnly";
    if (actual !== expected) return false;
    cursor = event.startTick + event.durationTick;
  }
  return cursor === context.request.controls.endTick;
}

function addTensionsAndBass(
  root: ChordEvent["root"],
  quality: ChordEvent["quality"],
  inversion: number,
  tensions: readonly Tension[],
  bassOffsetFromRoot: number,
  previousNotes: readonly number[] | undefined,
  voiceLeadingStrength: number,
): { notes: number[]; inversion: number; bass?: ChordEvent["bass"] } {
  const voiced = voiceChord(
    root,
    quality,
    previousNotes,
    inversion,
    voiceLeadingStrength,
  );
  const notes = [...voiced.notes];
  const rootSemitone = pitchClassToSemitone(root);
  for (const tension of tensions) {
    const pitchClass = (rootSemitone + intervalForTension(tension)) % 12;
    let midi = pitchClass + 60;
    while (midi <= Math.max(...notes)) midi += 12;
    if (midi <= 127) notes.push(midi);
  }
  let bass: ChordEvent["bass"];
  if (bassOffsetFromRoot !== 0) {
    bass = semitoneToPitchClass(rootSemitone + bassOffsetFromRoot);
    const bassPitchClass = pitchClassToSemitone(bass);
    let midi = bassPitchClass + 48;
    while (midi >= Math.min(...notes)) midi -= 12;
    while (midi < 0) midi += 12;
    notes.push(midi);
  }
  notes.sort((left, right) => left - right);
  return { notes, inversion: voiced.inversion, bass };
}

function factorToChord(
  factor: HarmonyFactorEvent,
  startTick: number,
  endTick: number,
  tonality: Tonality,
  id: string,
  previousNotes: readonly number[] | undefined,
  composition: GeneratedComposition,
): ChordEvent {
  const root = semitoneToPitchClass(tonality.keyRoot + factor.rootOffsetFromKey);
  const degree = scaleDegreeForPitchClass(
    root,
    semitoneToPitchClass(tonality.keyRoot),
    tonality.mode,
  );
  const tensions = [...factor.extensions];
  const voiced = addTensionsAndBass(
    root,
    factor.quality,
    factor.inversion,
    tensions,
    factor.bassOffsetFromRoot,
    previousNotes,
    composition.settings.harmony?.voiceLeadingStrength ?? 1,
  );
  const baseSymbol = formatChordSymbol(root, factor.quality);
  const symbol = [
    baseSymbol,
    tensions.length > 0 ? `(${tensions.join(",")})` : "",
    voiced.bass ? `/${voiced.bass}` : "",
  ].join("");
  const diatonic = degree !== null
    && factor.bassOffsetFromRoot === 0
    && tensions.length === 0
    && (
      factor.quality === diatonicQualityForDegree(degree, tonality.mode)
      || factor.quality === diatonicSeventhQualityForDegree(degree, tonality.mode)
    );
  const specialKind = factor.quality === "sus2" || factor.quality === "sus4"
    ? "suspended" as const
    : factor.quality === "add9"
      || factor.quality === "minorAdd9"
      || tensions.length > 0
        ? "addedTone" as const
        : "chromatic" as const;
  return {
    id,
    symbol,
    romanNumeral: degree
      ? romanNumeralForChordQuality(degree, tonality.mode, factor.quality)
      : symbol,
    function: degree ? harmonyFunctionForDegree(degree, tonality.mode) : "other",
    degree: degree ?? 1,
    quality: factor.quality,
    root,
    startTick,
    durationTick: endTick - startTick,
    notes: voiced.notes,
    inversion: voiced.inversion,
    source: diatonic ? "diatonic" : "other",
    ...(tensions.length > 0 ? { tensions } : {}),
    ...(voiced.bass ? { bass: voiced.bass } : {}),
    ...(diatonic ? {} : {
      specialKind,
      explanation: "Neural preview; client theory validation passed before adoption.",
    }),
  };
}

function timelinePieces(
  candidate: HarmonyCandidate,
  context: HarmonyRequestContext,
  composition: GeneratedComposition,
): TimelinePiece[] | null {
  const boundaries = new Set<number>([
    context.request.controls.startTick,
    context.request.controls.endTick,
  ]);
  for (const event of candidate.events) {
    boundaries.add(event.startTick);
    boundaries.add(event.startTick + event.durationTick);
  }
  for (const chord of composition.chords) {
    boundaries.add(chord.startTick);
    boundaries.add(chord.startTick + chord.durationTick);
  }
  for (const span of context.request.tonalities) {
    boundaries.add(span.startTick);
    boundaries.add(span.endTick);
  }
  for (const bar of composition.bars) {
    boundaries.add(bar.startTick);
    boundaries.add(bar.startTick + bar.durationTick);
  }
  const ordered = [...boundaries].sort((left, right) => left - right);
  const locked = new Set(composition.lockedBars);
  const raw: TimelinePiece[] = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const startTick = ordered[index] as number;
    const endTick = ordered[index + 1] as number;
    if (endTick <= startTick) continue;
    const factorIndex = candidate.events.findIndex((event) =>
      event.startTick <= startTick
      && startTick < event.startTick + event.durationTick
    );
    const factor = candidate.events[factorIndex];
    const chord = chordAt(composition, startTick);
    const barIndex = Math.floor(startTick / composition.ticksPerBar);
    if (!factor || !chord) return null;
    const useGenerated = factor.maskMode === "generated" && !locked.has(barIndex);
    raw.push(useGenerated
      ? {
          startTick,
          endTick,
          kind: "generated",
          sourceKey: `factor:${factorIndex}`,
          factor,
        }
      : {
          startTick,
          endTick,
          kind: "preserved",
          sourceKey: `chord:${chord.id}`,
          chord,
        });
  }
  const merged: TimelinePiece[] = [];
  for (const piece of raw) {
    const previous = merged.at(-1);
    if (
      previous
      && previous.endTick === piece.startTick
      && previous.kind === piece.kind
      && previous.sourceKey === piece.sourceKey
    ) {
      previous.endTick = piece.endTick;
    } else {
      merged.push({ ...piece });
    }
  }
  return merged;
}

function materializeCandidate(
  candidate: HarmonyCandidate,
  context: HarmonyRequestContext,
  composition: GeneratedComposition,
  candidateIndex: number,
): ValidatedPreview | null {
  const pieces = timelinePieces(candidate, context, composition);
  if (!pieces) return null;
  const safeCandidateId = candidate.candidateId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
  const compositionId = `${composition.id}-neural-${safeCandidateId || candidateIndex}`;
  const chords: ChordEvent[] = [];
  for (const [index, piece] of pieces.entries()) {
    if (piece.kind === "generated") {
      const key = tonalityAt(context.request.tonalities, piece.startTick);
      if (!piece.factor || !key) return null;
      chords.push(factorToChord(
        piece.factor,
        piece.startTick,
        piece.endTick,
        key,
        `${compositionId}-chord-${index}`,
        chords.at(-1)?.notes,
        composition,
      ));
      continue;
    }
    const source = piece.chord;
    if (!source) return null;
    const completeSource = source.startTick === piece.startTick
      && source.startTick + source.durationTick === piece.endTick;
    chords.push(completeSource
      ? clone(source)
      : {
          ...clone(source),
          id: `${compositionId}-preserved-${index}`,
          startTick: piece.startTick,
          durationTick: piece.endTick - piece.startTick,
          source: "other",
          specialKind: "chromatic",
          explanation: "Preserved source chord split at the neural edit boundary.",
          targetDegree: undefined,
          borrowedFromMode: undefined,
          transformation: undefined,
        });
  }
  const preview: GeneratedComposition = {
    ...clone(composition),
    id: compositionId,
    chords,
    lockedBars: [...composition.lockedBars],
  };
  const theory = validateComposition(preview);
  const arrangement = analyzeArrangementQuality(preview);
  if (!theory.valid || arrangement.errors > 0) return null;
  return {
    composition: preview,
    theoryWarnings: theory.warnings.map((warning) => warning.message),
    arrangementWarnings: arrangement.issues
      .filter((issue) => issue.severity === "warning")
      .map((warning) => warning.message),
  };
}

function metadata(
  candidate: HarmonyCandidate,
  job: HarmonyJobResponse,
  rebasedAgainstNewerEdits: boolean,
  theoryWarnings: readonly string[],
  arrangementWarnings: readonly string[],
): NeuralHarmonyPreviewMetadata {
  return {
    candidateId: candidate.candidateId,
    modelId: job.modelId,
    device: job.device,
    backend: job.backend,
    dtype: job.dtype,
    mock: job.mock,
    trained: job.trained,
    checkpointSha256: job.checkpointSha256,
    tokenizerSha256: job.tokenizerSha256,
    sourceCommit: job.sourceCommit,
    candidateCount: job.candidateCount,
    batchSize: job.batchSize,
    cpuFallbackUsed: job.cpuFallbackUsed,
    fallbackReason: job.fallbackReason,
    neuralMeanLogProbability: candidate.neuralMeanLogProbability,
    meanConfidence: candidate.events.length === 0
      ? 0
      : candidate.events.reduce((sum, event) => sum + event.confidence, 0)
        / candidate.events.length,
    hardRuleVector: { ...candidate.hardRuleVector },
    clientTheoryValidated: true,
    rebasedAgainstNewerEdits,
    theoryWarnings: [...theoryWarnings],
    arrangementWarnings: [...arrangementWarnings],
  };
}

export function materializeHarmonyPreviews(
  context: HarmonyRequestContext,
  job: HarmonyJobResponse,
  latestComposition: GeneratedComposition,
): MaterializedHarmonyPreviews {
  if (
    job.state !== "completed"
    || job.stage !== "Complete"
    || job.error !== null
    || job.requestId !== context.request.requestId
    || latestComposition.id !== context.sourceCompositionId
    || latestComposition.totalTicks !== context.request.controls.endTick
    || latestComposition.ppq !== context.request.controls.ppq
    || latestComposition.ticksPerBar !== context.request.controls.ticksPerBar
    || !hasSameModelContext(latestComposition, context.request)
    || job.partialCandidateStored
  ) {
    return {
      previews: [],
      metadataByCompositionId: {},
      rebasedAgainstNewerEdits: false,
    };
  }
  const rebasedAgainstNewerEdits =
    compositionFingerprint(latestComposition) !== context.sourceFingerprint;
  const validatedCandidates: Array<{
    candidate: HarmonyCandidate;
    preview: ValidatedPreview;
    hardViolationCount: number;
    meanConfidence: number;
  }> = [];
  for (const [index, candidate] of job.candidates.entries()) {
    if (!validateCandidateTimeline(candidate, context)) continue;
    const preview = materializeCandidate(candidate, context, latestComposition, index);
    if (!preview) continue;
    validatedCandidates.push({
      candidate,
      preview,
      hardViolationCount: Object.values(candidate.hardRuleVector)
        .reduce((sum, value) => sum + Math.max(0, value), 0),
      meanConfidence: candidate.events.reduce((sum, event) => sum + event.confidence, 0)
        / Math.max(1, candidate.events.length),
    });
  }
  validatedCandidates.sort((left, right) =>
    left.hardViolationCount - right.hardViolationCount
    || (right.candidate.neuralMeanLogProbability ?? Number.NEGATIVE_INFINITY)
      - (left.candidate.neuralMeanLogProbability ?? Number.NEGATIVE_INFINITY)
    || right.meanConfidence - left.meanConfidence
    || left.candidate.candidateId.localeCompare(right.candidate.candidateId)
  );
  const previews: GeneratedComposition[] = [];
  const metadataByCompositionId: Record<string, NeuralHarmonyPreviewMetadata> = {};
  for (const { candidate, preview } of validatedCandidates.slice(0, 3)) {
    previews.push(preview.composition);
    metadataByCompositionId[preview.composition.id] = metadata(
      candidate,
      job,
      rebasedAgainstNewerEdits,
      preview.theoryWarnings,
      preview.arrangementWarnings,
    );
  }
  return {
    previews,
    metadataByCompositionId,
    rebasedAgainstNewerEdits,
  };
}
