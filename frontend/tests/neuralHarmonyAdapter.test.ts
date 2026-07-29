import { describe, expect, it } from "vitest";
import {
  buildHarmonyGenerateRequest,
  materializeHarmonyPreviews,
  type HarmonyRequestContext,
} from "../src/api/neuralHarmonyAdapter";
import type {
  HarmonyCandidate,
  HarmonyJobResponse,
} from "../src/api/inferenceTypes";
import {
  analyzeArrangementQuality,
  DEFAULT_GENERATOR_SETTINGS,
  generateComposition,
  midiToNoteName,
  validateComposition,
} from "../src/music";
import type { GeneratedComposition } from "../src/types/music";

function sourceComposition(): GeneratedComposition {
  const composition = structuredClone(generateComposition({
    ...DEFAULT_GENERATOR_SETTINGS,
    seed: "neural-adapter",
    bars: 4,
  }));
  // The adapter safety tests control melody explicitly.
  composition.notes = [];
  composition.voices = undefined;
  return composition;
}

function candidateFromContext(
  context: HarmonyRequestContext,
  candidateId: string,
  neuralMeanLogProbability: number | null = -1,
): HarmonyCandidate {
  return {
    candidateId,
    events: context.request.existingHarmony.map((condition) => {
      const mask = context.request.generationMask.find((span) =>
        span.startTick <= condition.startTick && condition.startTick < span.endTick
      );
      if (!mask) throw new Error("test request mask is incomplete");
      return {
        startTick: condition.startTick,
        durationTick: condition.durationTick,
        rootOffsetFromKey: mask.mode === "generate" ? 0 : condition.rootOffsetFromKey,
        quality: mask.mode === "generate" ? "major" : condition.quality,
        inversion: mask.mode === "generate" ? 0 : condition.inversion,
        bassOffsetFromRoot: mask.mode === "generate" ? 0 : condition.bassOffsetFromRoot,
        extensions: mask.mode === "generate" ? [] : condition.extensions ?? [],
        confidence: mask.mode === "generate" ? 0.8 : 1,
        maskMode: mask.mode === "generate"
          ? "generated"
          : mask.mode === "preserve" ? "preserved" : "conditionOnly",
      };
    }),
    neuralMeanLogProbability,
    hardRuleVector: {},
    hardRuleValidation: "pendingClient",
    adoptable: false,
    requiresClientValidation: true,
  };
}

function sourceConditionedMockCandidate(
  context: HarmonyRequestContext,
  candidateId: string,
): HarmonyCandidate {
  return {
    candidateId,
    events: context.request.existingHarmony.map((condition) => {
      const mask = context.request.generationMask.find((span) =>
        span.startTick <= condition.startTick && condition.startTick < span.endTick
      );
      if (!mask) throw new Error("test request mask is incomplete");
      return {
        startTick: condition.startTick,
        durationTick: condition.durationTick,
        rootOffsetFromKey: condition.rootOffsetFromKey,
        quality: condition.quality,
        inversion: condition.inversion,
        bassOffsetFromRoot: condition.bassOffsetFromRoot,
        extensions: condition.extensions ?? [],
        confidence: 1,
        maskMode: mask.mode === "generate"
          ? "generated"
          : mask.mode === "preserve" ? "preserved" : "conditionOnly",
      };
    }),
    neuralMeanLogProbability: null,
    hardRuleVector: {},
    hardRuleValidation: "pendingClient",
    adoptable: false,
    requiresClientValidation: true,
  };
}

function completedJob(
  context: HarmonyRequestContext,
  candidates: HarmonyCandidate[],
): HarmonyJobResponse {
  return {
    apiVersion: "2",
    requestId: context.request.requestId,
    state: "completed",
    stage: "Complete",
    progress: 100,
    elapsedMs: 42,
    modelId: context.request.modelId,
    device: "cpu",
    backend: "mock",
    dtype: "float32",
    mock: true,
    trained: false,
    checkpointSha256: null,
    tokenizerSha256: "tokenizer-test",
    sourceCommit: null,
    batchSize: 1,
    candidateCount: candidates.length,
    deterministic: true,
    cpuFallbackUsed: false,
    fallbackReason: null,
    stageTimingsMs: { Encoding: 3 },
    partialCandidateStored: false,
    candidates,
    error: null,
  };
}

describe("neural harmony request and candidate adapter", () => {
  it("builds a complete factor request with explicit A/B/C count, device, locks, and masks", () => {
    const composition = sourceComposition();
    composition.lockedBars = [1];
    const context = buildHarmonyGenerateRequest({
      composition,
      selectedRange: { startBar: 0, endBar: 2 },
      requestId: "request-build",
      modelId: "mock-harmonyforge-bimask-v1",
      candidateCount: 3,
      preferredDevice: "mps",
    });

    expect(context.request).toMatchObject({
      apiVersion: "2",
      requestId: "request-build",
      candidateCount: 3,
      preferredDevice: "mps",
      allowCpuFallback: true,
    });
    expect(context.request.generationMask).toEqual([
      { startTick: 0, endTick: composition.ticksPerBar, mode: "generate" },
      {
        startTick: composition.ticksPerBar,
        endTick: composition.totalTicks,
        mode: "preserve",
      },
    ]);
    expect(context.request.tonalities[0]).toMatchObject({
      startTick: 0,
      endTick: composition.totalTicks,
      keyRoot: 0,
      mode: "major",
    });
    expect(context.request.controls).toEqual({
      ppq: composition.ppq,
      ticksPerBar: composition.ticksPerBar,
      timeSignature: composition.timeSignature,
      startTick: 0,
      endTick: composition.totalTicks,
    });
    expect(context.request.controls).not.toHaveProperty("style");
    expect(context.request.controls).not.toHaveProperty("mood");
    expect(context.request.controls).not.toHaveProperty("harmonicDensity");
    expect(context.request.controls).not.toHaveProperty("complexity");
    expect(context.request.existingHarmony[0]?.startTick).toBe(0);
    expect(
      context.request.existingHarmony
        .filter((condition) => condition.locked)
        .reduce((sum, condition) => sum + condition.durationTick, 0),
    ).toBe(composition.totalTicks - composition.ticksPerBar);
  });

  it("orders client-valid proposals deterministically before publishing A/B/C", () => {
    const composition = sourceComposition();
    const context = buildHarmonyGenerateRequest({
      composition,
      selectedRange: { startBar: 0, endBar: 1 },
      requestId: "request-order",
      modelId: "mock-harmonyforge-bimask-v1",
      candidateCount: 3,
    });
    const low = candidateFromContext(context, "low", -4);
    const high = candidateFromContext(context, "high", -0.5);
    const middle = candidateFromContext(context, "middle", -2);
    const result = materializeHarmonyPreviews(
      context,
      completedJob(context, [low, high, middle]),
      composition,
    );

    expect(result.previews).toHaveLength(3);
    expect(result.previews.map((preview) =>
      result.metadataByCompositionId[preview.id]?.candidateId
    )).toEqual(["high", "middle", "low"]);
    expect(result.previews[0]?.notes).toEqual(composition.notes);
    expect(result.metadataByCompositionId[result.previews[0]!.id]).toMatchObject({
      clientTheoryValidated: true,
      mock: true,
      trained: false,
      candidateCount: 3,
      batchSize: 1,
    });
  });

  it("accepts three preview-only Mock candidates for a 16-bar F# natural-minor three-track draft", () => {
    const composition = structuredClone(generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      seed: "mock-fsharp-natural-minor-16",
      bars: 16,
      key: "F#",
      mode: "naturalMinor",
    }));
    composition.voices = undefined;
    const original = structuredClone(composition);
    const context = buildHarmonyGenerateRequest({
      composition,
      selectedRange: { startBar: 0, endBar: 16 },
      requestId: "request-mock-fsharp-minor",
      modelId: "mock-harmonyforge-bimask-v1",
      candidateCount: 3,
    });
    const candidates = ["mock-a", "mock-b", "mock-c"].map((candidateId) =>
      sourceConditionedMockCandidate(context, candidateId)
    );
    const result = materializeHarmonyPreviews(
      context,
      completedJob(context, candidates),
      composition,
    );

    expect(result.previews).toHaveLength(3);
    expect(composition).toEqual(original);
    expect(candidates.every((candidate) =>
      !candidate.adoptable && candidate.requiresClientValidation
    )).toBe(true);
    for (const preview of result.previews) {
      const arrangement = analyzeArrangementQuality(preview);
      expect(validateComposition(preview).valid).toBe(true);
      expect(arrangement).toMatchObject({ trackCount: 3, errors: 0 });
      expect(result.metadataByCompositionId[preview.id]).toMatchObject({
        mock: true,
        trained: false,
        clientTheoryValidated: true,
      });
    }
  });

  it("rebases against newer edits explicitly and records that provenance", () => {
    const composition = sourceComposition();
    const context = buildHarmonyGenerateRequest({
      composition,
      selectedRange: { startBar: 0, endBar: 1 },
      requestId: "request-rebase",
      modelId: "mock-harmonyforge-bimask-v1",
    });
    const latest = structuredClone(composition);
    latest.settings.bpm = 132;
    const candidate = candidateFromContext(context, "rebased");
    const result = materializeHarmonyPreviews(
      context,
      completedJob(context, [candidate]),
      latest,
    );

    expect(result.rebasedAgainstNewerEdits).toBe(true);
    expect(result.previews[0]?.settings.bpm).toBe(132);
    expect(result.metadataByCompositionId[result.previews[0]!.id])
      .toMatchObject({ rebasedAgainstNewerEdits: true });
  });

  it("rejects a stale proposal when key/mode model context changed", () => {
    const composition = sourceComposition();
    const context = buildHarmonyGenerateRequest({
      composition,
      selectedRange: { startBar: 0, endBar: 1 },
      requestId: "request-stale-tonality",
      modelId: "mock-harmonyforge-bimask-v1",
    });
    const latest = structuredClone(composition);
    latest.settings.key = "D";
    latest.settings.mode = "dorian";
    const candidate = candidateFromContext(context, "stale-tonality");

    expect(materializeHarmonyPreviews(
      context,
      completedJob(context, [candidate]),
      latest,
    ).previews).toEqual([]);
  });

  it("rejects a candidate atomically when the all-track gate finds melody dissonance", () => {
    const composition = sourceComposition();
    composition.notes = [{
      id: "unsafe-melody",
      midi: 61,
      noteName: midiToNoteName(61),
      startTick: 0,
      durationTick: composition.ppq,
      velocity: 92,
      barIndex: 0,
      role: "scaleTone",
    }];
    const context = buildHarmonyGenerateRequest({
      composition,
      selectedRange: { startBar: 0, endBar: 1 },
      requestId: "request-all-track",
      modelId: "mock-harmonyforge-bimask-v1",
    });
    const candidate = candidateFromContext(context, "unsafe");
    const result = materializeHarmonyPreviews(
      context,
      completedJob(context, [candidate]),
      composition,
    );

    expect(result.previews).toEqual([]);
    expect(result.metadataByCompositionId).toEqual({});
  });

  it("rejects malformed or partial timelines before materialization", () => {
    const composition = sourceComposition();
    const context = buildHarmonyGenerateRequest({
      composition,
      selectedRange: { startBar: 0, endBar: 1 },
      requestId: "request-gap",
      modelId: "mock-harmonyforge-bimask-v1",
    });
    const candidate = candidateFromContext(context, "gap");
    candidate.events = candidate.events.slice(1);

    expect(materializeHarmonyPreviews(
      context,
      completedJob(context, [candidate]),
      composition,
    ).previews).toEqual([]);
  });
});
