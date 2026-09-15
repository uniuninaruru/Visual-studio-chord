import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  MINIMAL_GENERATOR_SETTINGS,
  audibleProgressionIdentity,
  chromaCountVector,
  computeChordTonalTension,
  dissonanceFromTiv,
  generateComposition,
  getProgressionTemplate,
  getDissonance,
  keyDistanceForChroma,
  minimumNonBijectiveVoiceLeading,
  minimumVoiceLeading,
  normalFft,
  pearsonCorrelation,
  rankTonalCandidates,
  rankTonalCurves,
  regenerateRange,
  setBarLocked,
  targetSimilarity,
  tonalFunctionDistanceForChroma,
  tonalVectorNorm,
  validateComposition,
  validateGeneratorSettings,
  weightedTonalIntervalVector,
  aggregateTonalTensionBars,
} from "../src/music";
import {
  exportCompositionJson,
  importCompositionJson,
  isGeneratedComposition,
  isGeneratorSettings,
} from "../src/features/export/json";
import { explainComposition } from "../src/music/explanation";
import type { ChordEvent } from "../src/types/music";

function chord(notes: number[], startTick = 0, durationTick = 480): ChordEvent {
  return {
    id: `test-${startTick}`,
    symbol: "C",
    romanNumeral: "I",
    function: "tonic",
    degree: 1,
    quality: "major",
    root: "C",
    startTick,
    durationTick,
    notes,
    inversion: 0,
    source: "diatonic",
  };
}

describe("symbolic Tonal Interval Space primitives", () => {
  it("keeps the single-note and chromatic dissonance endpoints", () => {
    const single = normalFft(chromaCountVector([60]));
    const chromatic = normalFft(chromaCountVector(Array.from({ length: 12 }, (_, pc) => pc)));
    expect(tonalVectorNorm(single)).toBeCloseTo(Math.sqrt(1080), 8);
    expect(getDissonance(single)).toBeCloseTo(0, 8);
    expect(dissonanceFromTiv(chromatic)).toBeCloseTo(1, 8);
  });

  it("matches the shared C-major triad complex TIS fixture", () => {
    const vector = weightedTonalIntervalVector(chromaCountVector([60, 64, 67]));
    const expected: ReadonlyArray<readonly [number, number]> = [
      [-0.244016936, -0.244016936],
      [3.666666667, 0],
      [11.333333333, 5.666666667],
      [0, -9.237604307],
      [8.651494224, 8.651494224],
      [2.333333333, 0],
    ];
    expected.forEach(([real, imag], index) => {
      expect(vector[index]!.real).toBeCloseTo(real, 8);
      expect(vector[index]!.imag).toBeCloseTo(imag, 8);
    });
    expect(tonalVectorNorm(vector)).toBeCloseTo(20.3615709345, 10);
    expect(dissonanceFromTiv(vector)).toBeCloseTo(0.3804171274, 10);
    expect(keyDistanceForChroma(chromaCountVector([60, 64, 67]), "C", "major"))
      .toBeCloseTo(0.94283913, 8);
  });

  it("is transposition-invariant in TIS norms and distances", () => {
    const first = weightedTonalIntervalVector(chromaCountVector([60, 64, 67]));
    const second = weightedTonalIntervalVector(chromaCountVector([62, 66, 69]));
    const firstUp = weightedTonalIntervalVector(chromaCountVector([61, 65, 68]));
    const secondUp = weightedTonalIntervalVector(chromaCountVector([63, 67, 70]));
    expect(tonalVectorNorm(firstUp)).toBeCloseTo(tonalVectorNorm(first), 8);
    expect(dissonanceFromTiv(secondUp)).toBeCloseTo(dissonanceFromTiv(second), 8);
    const left = Math.sqrt(first.reduce((sum, bin, index) => {
      const other = second[index]!;
      return sum + (bin.real - other.real) ** 2 + (bin.imag - other.imag) ** 2;
    }, 0));
    const right = Math.sqrt(firstUp.reduce((sum, bin, index) => {
      const other = secondUp[index]!;
      return sum + (bin.real - other.real) ** 2 + (bin.imag - other.imag) ** 2;
    }, 0));
    expect(right).toBeCloseTo(left, 8);
  });

  it("treats a tonic triad as closer to its active key than a remote sonority", () => {
    const tonic = tonalFunctionDistanceForChroma(chromaCountVector([60, 64, 67]), "C", "major");
    const remote = tonalFunctionDistanceForChroma(chromaCountVector([61, 66, 70]), "C", "major");
    expect(tonic).toBeLessThan(remote);
  });

  it("returns a finite, decomposed dominant-to-tonic profile", () => {
    const dominant = chord([55, 59, 62, 65]);
    const tonic = chord([60, 64, 67], 480);
    const profile = computeChordTonalTension(tonic, dominant, "C", "major");
    expect(profile.chordDistance).toBeGreaterThanOrEqual(0);
    expect(profile.keyDistance).toBeGreaterThanOrEqual(0);
    expect(profile.tonalFunctionDistance).toBeGreaterThanOrEqual(0);
    expect(profile.dissonance).toBeGreaterThanOrEqual(0);
    expect(profile.voiceLeading).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(profile.total)).toBe(true);
    expect(minimumVoiceLeading([0, 4, 7], [0, 4, 7]).cost).toBe(0);
    expect(minimumVoiceLeading([0, 1, 2], [1, 2, 3])).toEqual({
      cost: 3,
      pairs: [[0, 3], [1, 1], [2, 2]],
    });
    expect(minimumNonBijectiveVoiceLeading([0, 3, 7, 9], [3, 5, 10])).toEqual({
      cost: 5,
      pairs: [[0, 10], [3, 3], [7, 5], [9, 10]],
    });
    expect(minimumNonBijectiveVoiceLeading([0, 4, 7], [7, 11, 2, 5]).cost).toBe(4);
  });

  it("weights bar values by integer tick overlap", () => {
    const first = chord([60, 64, 67], 0, 240);
    const second = chord([61, 66, 70], 240, 720);
    const curve = aggregateTonalTensionBars({
      chords: [first, second],
      key: "C",
      mode: "major",
      ticksPerBar: 480,
      bars: 2,
    });
    const firstValue = computeChordTonalTension(first, undefined, "C", "major").total;
    const secondValue = computeChordTonalTension(second, first, "C", "major").total;
    expect(curve[0]).toBeCloseTo((firstValue * 240 + secondValue * 240) / 480, 8);
    expect(curve[1]).toBeCloseTo(secondValue, 8);
  });
});

describe("TIS contour matching", () => {
  it("uses Pearson shape matching for a rising contour", () => {
    expect(pearsonCorrelation([0, 1, 2, 3], [2, 4, 6, 8])).toBeCloseTo(1, 8);
    expect(targetSimilarity([0, 1, 2, 3], [2, 4, 6, 8])).toBeCloseTo(1, 8);
    const ranked = rankTonalCurves([[0, 1, 2, 3], [3, 2, 1, 0]], [1, 2, 3, 4]);
    expect(ranked.selectedIndex).toBe(0);
  });

  it("uses a finite deterministic shape/flatness fallback", () => {
    const target = [0.4, 0.4, 0.4, 0.4];
    const curves = [[3, 3, 3, 3], [1, 2, 3, 4]] as const;
    expect(targetSimilarity(curves[0], target)).toBe(1);
    expect(targetSimilarity(curves[0], target)).toBe(targetSimilarity(curves[0], target));
    expect(rankTonalCurves(curves, target).selectedIndex).toBe(0);
    expect(rankTonalCurves([[], [1, Number.NaN]], target).selectedIndex).toBe(0);
    expect(targetSimilarity([4, 4, 4, 4], target)).toBe(1);
    expect(targetSimilarity([0, 1, 2, 3], target)).toBeGreaterThan(targetSimilarity([0, 4, 8, 12], target));
    expect(targetSimilarity([4, 4, 4, 4], [0, 1, 2, 3])).toBe(-1);
  });

  it("keeps candidate zero on ties and never ranks below it", () => {
    const candidates = [
      { chords: [chord([60, 64, 67])] },
      { chords: [chord([61, 66, 70])] },
    ];
    const ranked = rankTonalCandidates(candidates, {
      key: "C",
      mode: "major",
      ticksPerBar: 480,
      bars: 1,
      target: [0.5],
    });
    expect(ranked.selectedIndex).toBe(0);
    expect(ranked.scores[ranked.selectedIndex]!).toBeGreaterThanOrEqual(ranked.scores[0]!);
  });

  it("keeps sounding timing, doubling, and voicing differences distinct", () => {
    const baseline = chord([60, 64, 67], 0, 480);
    const doubled = chord([60, 64, 67, 72], 0, 480);
    const shifted = chord([60, 64, 67], 480, 480);
    expect(audibleProgressionIdentity([baseline])).not.toBe(audibleProgressionIdentity([doubled]));
    expect(audibleProgressionIdentity([baseline])).not.toBe(audibleProgressionIdentity([shifted]));
  });
});

describe("section integration", () => {
  it("is deterministic and preserves the exact functional candidate when disabled", () => {
    const base = {
      ...MINIMAL_GENERATOR_SETTINGS,
      bars: 8 as const,
      songForm: { form: "throughComposed" as const },
      functionalHarmony: { enabled: true },
    };
    const legacy = generateComposition(base);
    const off = generateComposition({ ...base, tonalTension: { enabled: false } });
    const on = generateComposition({ ...base, tonalTension: { enabled: true } });
    expect(generateComposition({ ...base, tonalTension: { enabled: true } })).toEqual(on);
    expect(validateComposition(on).errors).toEqual([]);
    expect(off.chords).toEqual(legacy.chords);
    expect(off.notes).toEqual(legacy.notes);
    // The reranker may select another valid stream, but it is never allowed to
    // affect the off path or the composition's tick contract.
    expect(off.ticksPerBar).toBe(on.ticksPerBar);
    expect(off.totalTicks).toBe(on.totalTicks);
  });

  it("keeps explicit named progressions unchanged regardless of the toggle", () => {
    const base = {
      ...DEFAULT_GENERATOR_SETTINGS,
      bars: 16 as const,
      seed: "named-template",
      songForm: { form: "verseChorus" as const },
      progressionId: "fifties",
    };
    const off = generateComposition({ ...base, tonalTension: { enabled: false } });
    const on = generateComposition({ ...base, tonalTension: { enabled: true } });
    const fifties = getProgressionTemplate("fifties")!;
    expect(on.chords.map((entry) => entry.symbol)).toEqual(off.chords.map((entry) => entry.symbol));
    expect(audibleProgressionIdentity(on.chords)).toBe(audibleProgressionIdentity(off.chords));
    expect(on.sections?.every((section) => section.progressionId === "fifties")).toBe(true);
    for (const section of on.sections ?? []) {
      const sectionDegrees = on.chords
        .filter((entry) => entry.startTick >= section.startBar * on.ticksPerBar
          && entry.startTick < section.endBar * on.ticksPerBar)
        .map((entry) => entry.degree);
      expect(sectionDegrees).toEqual(
        Array.from({ length: sectionDegrees.length }, (_, index) =>
          fifties.steps[index % fifties.steps.length]!.degree),
      );
    }

    // With no song form, the top-level ID is the actual named-template path;
    // this also proves that the reranker cannot be reached from that path.
    const flatBase = {
      ...DEFAULT_GENERATOR_SETTINGS,
      bars: 8 as const,
      seed: "named-flat",
      songForm: { form: "none" as const },
      progressionId: "fifties",
    };
    const flatOff = generateComposition({ ...flatBase, tonalTension: { enabled: false } });
    const flatOn = generateComposition({ ...flatBase, tonalTension: { enabled: true } });
    expect(audibleProgressionIdentity(flatOn.chords)).toBe(audibleProgressionIdentity(flatOff.chords));
    expect(flatOn.chords.map((entry) => entry.degree)).toEqual(
      Array.from({ length: flatOn.chords.length }, (_, index) =>
        fifties.steps[index % fifties.steps.length]!.degree),
    );
  });

  it("reports TIS provenance only for automatic functional sections", () => {
    const automatic = generateComposition({
      ...MINIMAL_GENERATOR_SETTINGS,
      bars: 8,
      songForm: { form: "throughComposed" },
      functionalHarmony: { enabled: true },
      tonalTension: { enabled: true },
    });
    const disabled = generateComposition({
      ...MINIMAL_GENERATOR_SETTINGS,
      bars: 8,
      songForm: { form: "throughComposed" },
      functionalHarmony: { enabled: true },
      tonalTension: { enabled: false },
    });
    const named = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      bars: 16,
      songForm: { form: "verseChorus" },
      progressionId: "fifties",
      tonalTension: { enabled: true },
    });
    expect(automatic.sections?.some((section) => section.tonalTensionApplied)).toBe(true);
    expect(explainComposition(automatic).text).toContain("Tonal Interval Space");
    expect(explainComposition(disabled).text).not.toContain("Tonal Interval Space");
    expect(explainComposition(named).text).not.toContain("Tonal Interval Space");
    const catalogWinner = {
      ...automatic,
      sections: automatic.sections?.map((section) => ({
        ...section,
        progressionId: "fifties",
        tonalTensionApplied: true as const,
      })),
    };
    const catalogText = explainComposition(catalogWinner).text;
    expect(catalogText).toContain("進行は");
    expect(catalogText).toContain("Tonal Interval Space");
  });

  it("changes at least one ordinary automatic section while staying deterministic and valid", () => {
    const identities = ["tis-0", "tis-1", "tis-2", "tis-3"].map((seed) => {
      const base = {
        ...MINIMAL_GENERATOR_SETTINGS,
        bars: 16 as const,
        seed,
        songForm: { form: "verseChorus" as const },
        functionalHarmony: { enabled: true },
      };
      const off = generateComposition({ ...base, tonalTension: { enabled: false } });
      const on = generateComposition({ ...base, tonalTension: { enabled: true } });
      expect(generateComposition({ ...base, tonalTension: { enabled: true } })).toEqual(on);
      expect(validateComposition(on).errors).toEqual([]);
      expect(on.sections?.some((section) => section.tonalTensionApplied)).toBe(true);
      return audibleProgressionIdentity(off.chords) !== audibleProgressionIdentity(on.chords);
    });
    expect(identities.some(Boolean)).toBe(true);
  });

  it("reuses the selected stream for repeated planner groups", () => {
    const composition = generateComposition({
      ...MINIMAL_GENERATOR_SETTINGS,
      bars: 8,
      songForm: { form: "aaba" },
      functionalHarmony: { enabled: true },
      tonalTension: { enabled: true },
    });
    const verseSections = (composition.sections ?? []).filter((section) => section.kind === "verse");
    expect(verseSections.length).toBe(3);
    const sequences = verseSections.map((section) => composition.chords
      .filter((entry) => entry.startTick >= section.startBar * composition.ticksPerBar
        && entry.startTick < section.endBar * composition.ticksPerBar)
      .map((entry) => `${entry.degree}:${entry.quality}`));
    expect(sequences[1]).toEqual(sequences[0]);
    expect(sequences[2]).toEqual(sequences[0]);
  });

  it("removes stale provenance only from sections touched by partial regeneration", () => {
    const composition = generateComposition({
      ...MINIMAL_GENERATOR_SETTINGS,
      bars: 8,
      songForm: { form: "throughComposed" },
      functionalHarmony: { enabled: true },
      tonalTension: { enabled: true },
    });
    const markedIndex = composition.sections?.findIndex((section) => section.tonalTensionApplied) ?? -1;
    expect(markedIndex).toBeGreaterThanOrEqual(0);
    const marked = composition.sections?.[markedIndex];
    expect(marked).toBeDefined();
    if (!marked) return;
    const regenerated = regenerateRange(
      composition,
      composition.settings,
      { startBar: marked.startBar, endBar: marked.endBar },
      { target: "chords" },
    );
    expect(regenerated.sections?.[markedIndex]?.tonalTensionApplied).toBeUndefined();
    const untouchedMarker = regenerated.sections?.some((section, index) =>
      index !== markedIndex && section.tonalTensionApplied === true);
    expect(untouchedMarker).toBe(true);
  });

  it("keeps a locked section marker when a different section is replaced", () => {
    const composition = generateComposition({
      ...MINIMAL_GENERATOR_SETTINGS,
      bars: 8,
      songForm: { form: "throughComposed" },
      functionalHarmony: { enabled: true },
      tonalTension: { enabled: true },
      seed: "locked-marker",
    });
    const markedSections = (composition.sections ?? []).filter(
      (section) => section.tonalTensionApplied === true,
    );
    expect(markedSections.length).toBeGreaterThanOrEqual(2);
    const lockedSection = markedSections[0]!;
    const replacedSection = markedSections.find((section) => section.id !== lockedSection.id)!;
    const lockedBars = Array.from(
      { length: lockedSection.endBar - lockedSection.startBar },
      (_, offset) => lockedSection.startBar + offset,
    );
    const before = lockedBars.reduce(
      (current, barIndex) => setBarLocked(current, barIndex, true),
      composition,
    );
    const regenerated = regenerateRange(
      before,
      before.settings,
      { startBar: lockedSection.startBar, endBar: replacedSection.endBar },
      { target: "chords", strength: "moderate" },
    );
    expect(regenerated.sections?.find((section) => section.id === lockedSection.id)
      ?.tonalTensionApplied).toBe(true);
    expect(regenerated.sections?.find((section) => section.id === replacedSection.id)
      ?.tonalTensionApplied).toBeUndefined();
  });

  it("clears every marker when melody-only regeneration turns TIS off", () => {
    const composition = generateComposition({
      ...MINIMAL_GENERATOR_SETTINGS,
      bars: 8,
      songForm: { form: "throughComposed" },
      functionalHarmony: { enabled: true },
      tonalTension: { enabled: true },
      seed: "melody-marker-off",
    });
    expect(composition.sections?.some((section) => section.tonalTensionApplied)).toBe(true);
    const regenerated = regenerateRange(
      composition,
      { ...composition.settings, tonalTension: { enabled: false } },
      { startBar: 0, endBar: 1 },
      { target: "melody" },
    );
    expect(regenerated.sections?.some((section) => section.tonalTensionApplied)).toBe(false);
    expect(validateComposition(regenerated).valid).toBe(true);
  });

  it("rejects malformed persisted tonal tension settings", () => {
    const malformed = {
      ...MINIMAL_GENERATOR_SETTINGS,
      tonalTension: { enabled: "yes" },
    } as unknown as Parameters<typeof validateGeneratorSettings>[0];
    expect(validateGeneratorSettings(malformed).valid).toBe(false);
    expect(isGeneratorSettings(malformed)).toBe(false);
  });

  it("rejects TIS provenance with incompatible persisted settings", () => {
    const valid = generateComposition({
      ...MINIMAL_GENERATOR_SETTINGS,
      bars: 8,
      songForm: { form: "throughComposed" },
      functionalHarmony: { enabled: true },
      tonalTension: { enabled: true },
    });
    const marked = valid.sections?.map((section) => ({ ...section, tonalTensionApplied: true as const }));
    const disabled = {
      ...valid,
      settings: { ...valid.settings, tonalTension: { enabled: false } },
      sections: marked,
    };
    expect(validateComposition(disabled).errors.some((issue) => issue.code === "sections.tonalTensionApplied"))
      .toBe(true);
    expect(isGeneratedComposition(disabled)).toBe(false);

    const explicit = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      bars: 16,
      songForm: { form: "verseChorus" },
      progressionId: "fifties",
      tonalTension: { enabled: true },
    });
    const falselyMarkedExplicit = {
      ...explicit,
      sections: explicit.sections?.map((section) => ({
        ...section,
        tonalTensionApplied: true as const,
      })),
    };
    expect(validateComposition(falselyMarkedExplicit).errors.some((issue) =>
      issue.code === "sections.tonalTensionApplied")).toBe(true);
    expect(isGeneratedComposition(falselyMarkedExplicit)).toBe(false);
    expect(() => importCompositionJson(exportCompositionJson(falselyMarkedExplicit))).toThrow();
  });

  it("validates generated output across supported modes and main bar counts", () => {
    for (const mode of ["major", "naturalMinor", "harmonicMinor", "dorian", "mixolydian"] as const) {
      for (const bars of [4, 8, 16] as const) {
        const composition = generateComposition({
          ...MINIMAL_GENERATOR_SETTINGS,
          mode,
          bars,
          songForm: { form: "throughComposed" },
          functionalHarmony: { enabled: true },
          tonalTension: { enabled: true },
        });
        expect(validateComposition(composition).errors).toEqual([]);
      }
    }
  });

  it("keeps the compatibility setting absent from minimal defaults", () => {
    expect(MINIMAL_GENERATOR_SETTINGS.tonalTension).toBeUndefined();
    expect(DEFAULT_GENERATOR_SETTINGS.tonalTension).toEqual({ enabled: true });
  });
});
