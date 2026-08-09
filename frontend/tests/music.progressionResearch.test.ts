import { describe, expect, it } from "vitest";
import {
  MINIMAL_GENERATOR_SETTINGS,
  analyzeProgression,
  createAdvancedChordEvent,
  createNeoRiemannianChordEvent,
  generateComposition,
  generateProgression,
  planAdvancedProgressionKinds,
  validateComposition,
} from "../src/music";
import {
  exportCompositionJson,
  importCompositionJson,
} from "../src/features/export/json";
import type {
  GeneratedComposition,
} from "../src/types/music";
import type { HarmonyCandidateKind } from "../src/music/styles";

const equalPreference: Readonly<Record<HarmonyCandidateKind, number>> = {
  triad: 1,
  seventh: 1,
  secondaryDominant: 1,
  borrowed: 1,
  tritoneSubstitution: 1,
  suspended: 1,
  addedTone: 1,
};

describe("research-grounded whole-progression planning", () => {
  it("is deterministic and places a requested applied-dominant family", () => {
    const candidates: readonly (readonly HarmonyCandidateKind[])[] = [
      ["triad", "seventh", "secondaryDominant"],
      ["triad", "seventh", "secondaryDominant"],
      ["triad", "seventh", "secondaryDominant"],
      ["triad", "seventh"],
    ];
    const options = {
      key: "C" as const,
      mode: "major" as const,
      degrees: [1, 4, 5, 1],
      candidates,
      preference: equalPreference,
      seed: "global-harmony-plan",
      requireSpecial: true,
      requireKind: "secondaryDominant" as const,
    };
    const first = planAdvancedProgressionKinds(options);
    expect(planAdvancedProgressionKinds(options)).toEqual(first);
    expect(first).toContain("secondaryDominant");
  });

  it("keeps applied dominants resolved and chromatic runs bounded across generated songs", () => {
    for (let seed = 0; seed < 32; seed += 1) {
      const progression = generateProgression({
        key: "C",
        mode: "major",
        bars: 16,
        timeSignature: "4/4",
        style: "jazz",
        seed: `research-progression-${seed}`,
        harmony: {
          complexity: "advanced",
          borrowedChordRate: 1,
          secondaryDominantRate: 1,
          explorationRate: 1,
        },
      });
      const analysis = analyzeProgression(
        progression.chords,
        progression.cadence,
        "major",
      );
      expect(analysis.unresolvedAppliedDominants, `seed ${seed}`).toEqual([]);
      expect(analysis.maximumChromaticRun, `seed ${seed}`).toBeLessThanOrEqual(2);
      expect(analysis.realizesCadence, `seed ${seed}`).toBe(true);
    }
  });

  it("reports P-related triads as two common tones and one semitone of motion", () => {
    const major = createAdvancedChordEvent({
      kind: "triad",
      key: "C",
      mode: "major",
      degree: 1,
      startTick: 0,
      durationTick: 1920,
      id: "major",
    });
    const parallelMinor = createAdvancedChordEvent({
      kind: "borrowed",
      key: "C",
      mode: "major",
      degree: 1,
      startTick: 1920,
      durationTick: 1920,
      id: "minor",
    });
    const analysis = analyzeProgression(
      [major, parallelMinor],
      "loop",
      "major",
    );
    expect(analysis.transitions[0]).toMatchObject({
      commonTones: 2,
      commonToneLoss: 1,
      voiceLeadingDistance: 1,
      rootMotion: 0,
    });
  });

  it("materializes an exact contextual L transform with auditable metadata", () => {
    const major = createAdvancedChordEvent({
      kind: "triad",
      key: "C",
      mode: "major",
      degree: 1,
      startTick: 0,
      durationTick: 1920,
      id: "major",
    });
    const transformed = createNeoRiemannianChordEvent({
      key: "C",
      mode: "major",
      previous: major,
      operation: "L",
      startTick: 1920,
      durationTick: 1920,
      id: "leading-tone-exchange",
    });
    expect(transformed).toMatchObject({
      root: "E",
      quality: "minor",
      source: "other",
      specialKind: "chromatic",
      transformation: {
        theory: "neoRiemannian",
        operation: "L",
        fromRoot: "C",
        fromQuality: "major",
      },
    });
  });

  it("uses P/L/R candidates inside functional generation without breaking cadence", () => {
    let transformedSongs = 0;
    for (let seed = 0; seed < 32; seed += 1) {
      const composition = generateComposition({
        ...MINIMAL_GENERATOR_SETTINGS,
        bars: 8,
        seed: `nrt-${seed}`,
        functionalHarmony: { enabled: true, exploration: 1 },
        harmony: { complexity: "advanced", explorationRate: 1 },
      });
      if (composition.chords.some((chord) => chord.transformation)) {
        transformedSongs += 1;
      }
      expect(validateComposition(composition).errors, `seed ${seed}`).toEqual([]);
    }
    expect(transformedSongs).toBeGreaterThan(0);
  });

  it("round-trips Neo-Riemannian derivation metadata through project JSON", () => {
    const composition = generateComposition({
      ...MINIMAL_GENERATOR_SETTINGS,
      bars: 8,
      seed: "nrt-1",
      functionalHarmony: { enabled: true, exploration: 1 },
      harmony: { complexity: "advanced", explorationRate: 1 },
    });
    expect(composition.chords.some((chord) => chord.transformation)).toBe(true);
    const restored = importCompositionJson(exportCompositionJson(composition));
    expect(restored.chords.map((chord) => chord.transformation)).toEqual(
      composition.chords.map((chord) => chord.transformation),
    );
  });

  it("does not compare different chord cardinalities in one distance space", () => {
    const triad = createAdvancedChordEvent({
      kind: "triad",
      key: "C",
      mode: "major",
      degree: 1,
      startTick: 0,
      durationTick: 1920,
      id: "triad",
    });
    const seventh = createAdvancedChordEvent({
      kind: "seventh",
      key: "C",
      mode: "major",
      degree: 4,
      startTick: 1920,
      durationTick: 1920,
      id: "seventh",
    });
    const analysis = analyzeProgression([triad, seventh], "loop", "major");
    expect(analysis.transitions[0]?.voiceLeadingDistance).toBeNull();
    expect(analysis.comparableTransitionCount).toBe(0);
  });

  it("rejects an applied dominant that is not followed by its declared target", () => {
    const composition = generateComposition({
      ...MINIMAL_GENERATOR_SETTINGS,
      bars: 8,
      seed: "unresolved-applied-dominant",
    });
    const index = composition.chords.findIndex(
      (_, chordIndex) =>
        chordIndex < composition.chords.length - 1
        && composition.chords[chordIndex + 1]?.degree !== 2,
    );
    expect(index).toBeGreaterThanOrEqual(0);
    const original = composition.chords[index]!;
    const unresolved = createAdvancedChordEvent({
      kind: "secondaryDominant",
      key: composition.settings.key,
      mode: composition.settings.mode,
      degree: original.degree,
      targetDegree: 2,
      startTick: original.startTick,
      durationTick: original.durationTick,
      id: original.id,
    });
    const broken: GeneratedComposition = {
      ...composition,
      chords: composition.chords.map((chord, chordIndex) =>
        chordIndex === index ? unresolved : chord,
      ),
    };
    expect(
      validateComposition(broken).errors.map((issue) => issue.code),
    ).toContain("chord.appliedDominantResolution");
  });
});
