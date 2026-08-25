import { describe, expect, it } from "vitest";
import {
  HARMONY_STATISTICS_SNAPSHOT,
  MINIMAL_GENERATOR_SETTINGS,
  createLocalCorpusProvider,
  generateComposition,
  analyzeHarmonyStatistics,
  suggestNextChords,
} from "../src/music";
import type { GeneratorSettings } from "../src/types/music";
import type { SectionEvent } from "../src/types/music";

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...MINIMAL_GENERATOR_SETTINGS,
    ...patch,
    melody: { ...MINIMAL_GENERATOR_SETTINGS.melody, ...patch.melody },
  };
}

describe("offline statistical harmony advisor", () => {
  it("ships the fixed, source-addressed browser artifact", () => {
    expect(HARMONY_STATISTICS_SNAPSHOT.provenance.pop909SongCount).toBe(909);
    expect(HARMONY_STATISTICS_SNAPSHOT.provenance.sequenceCount).toBe(1131);
    expect(HARMONY_STATISTICS_SNAPSHOT.provenance.tokenCount).toBe(93904);
    expect(HARMONY_STATISTICS_SNAPSHOT.provenance.fullSourceSha256).toBe(
      "dfa28603b2aa0247abe5265a6975ae8267042a91e72e8c1ddd2221e2624209ae",
    );
    expect(Object.keys(HARMONY_STATISTICS_SNAPSHOT.orders)).toEqual(["1", "2", "3"]);
  });

  it("matches the backend's data-weighted interpolation fixture", () => {
    const provider = createLocalCorpusProvider();
    const first = provider.probability(["0:major", "9:minor"]);
    const second = provider.probability(["0:major", "9:minor", "5:major"]);
    const third = provider.probability(["9:minor", "5:major", "7:major"]);
    expect(first.probability).toBeCloseTo(0.125134, 5);
    expect(first.rawConditionalProbability).toBeCloseTo(1368 / 10866, 8);
    expect(first.rawConditionalProbability).not.toBe(first.probability);
    expect(first.exactGramCount).toBe(1368);
    expect(first.contextCount).toBe(10866);
    expect(second.probability).toBeCloseTo(0.303921, 5);
    expect(second.exactGramCount).toBe(421);
    expect(second.contextCount).toBe(1365);
    expect(third.probability).toBeCloseTo(0.54973, 5);
    expect(third.exactGramCount).toBe(624);
    expect(third.contextCount).toBe(1093);
  });

  it("rejects malformed snapshots and never returns non-finite values", () => {
    expect(() => createLocalCorpusProvider({})).toThrow();
    const provider = createLocalCorpusProvider();
    const empty = provider.probability([]);
    expect(empty.probability).toBe(1);
    expect(empty.rawConditionalProbability).toBe(0);
    expect(Number.isFinite(empty.surprisalBits)).toBe(true);
    expect(() => provider.probability(["not-a-token"])).toThrow(/malformed/);
    expect(() => provider.probability(["12:major"])).toThrow(/malformed/);
    expect(() => provider.probability(["0:not-a-quality"])).toThrow(/malformed/);
    const validButUnseenQuality = provider.probability(["0:add9"]);
    expect(validButUnseenQuality.probability).toBeGreaterThan(0);
    expect(validButUnseenQuality.unigramCount).toBe(0);
    const tampered = JSON.parse(JSON.stringify(HARMONY_STATISTICS_SNAPSHOT)) as {
      orders: Record<string, Record<string, number>>;
    };
    tampered.orders["1"]!["0:major"] = (tampered.orders["1"]!["0:major"] ?? 0) + 1;
    expect(() => createLocalCorpusProvider(tampered)).toThrow(/total|invalid/);
    const extraOrder = JSON.parse(JSON.stringify(HARMONY_STATISTICS_SNAPSHOT)) as typeof HARMONY_STATISTICS_SNAPSHOT & {
      orders: Record<string, Record<string, number>>;
    };
    extraOrder.orders["4"] = { "0:major": 1 };
    expect(() => createLocalCorpusProvider(extraOrder)).toThrow(/orders/);
  });

  it("aggregates only observed transitions, matching I–vi–IV–V", () => {
    const composition = generateComposition(settings({
      bars: 4,
      progressionId: "fifties",
      seed: "statistics-transition-fixture",
    }));
    const result = analyzeHarmonyStatistics(composition);
    expect(result.transitionCount).toBe(3);
    expect(result.geometricMeanConditionalProbability).toBeCloseTo(0.275483, 5);
    expect(result.meanSurprisalBits).toBeGreaterThan(0);
  });

  it("keeps profile ordering deterministic and materializes mode-safe templates", () => {
    const composition = generateComposition(settings({ bars: 8, seed: "statistics-order" }));
    for (const profile of ["familiar", "balanced", "adventurous"] as const) {
      const first = suggestNextChords(composition, { profile });
      const second = suggestNextChords(composition, { profile });
      expect(first.map((entry) => entry.step)).toEqual(second.map((entry) => entry.step));
      expect(first.every((entry) => Number.isFinite(entry.probability))).toBe(true);
      expect(first.every((entry) => entry.chord.notes.length > 0)).toBe(true);
      expect(first.every((entry) => entry.unigramCount > 0)).toBe(true);
      expect(first.every((entry) => entry.step.tensions === undefined
        && entry.step.bassDegree === undefined
        && entry.step.role === undefined
        && entry.step.targetDegree === undefined)).toBe(true);
      if (profile === "adventurous") expect(first.every((entry) => entry.exactGramCount > 0)).toBe(true);
    }
  });

  it("scores a selected chord at its exact event and filters the no-op", () => {
    const composition = generateComposition(settings({ bars: 8, seed: "statistics-target" }));
    const target = composition.chords[1]!;
    const suggestions = suggestNextChords(composition, { targetChord: target });
    expect(suggestions.every((entry) => entry.chord.startTick === target.startTick)).toBe(true);
    expect(suggestions.every((entry) => entry.chord.durationTick === target.durationTick)).toBe(true);
    expect(suggestions.every((entry) => entry.chord.root !== target.root || entry.chord.quality !== target.quality)).toBe(true);
  });

  it("analyses empty/one-chord-like material without NaN and exposes metrics", () => {
    const composition = generateComposition(settings({ bars: 4, seed: "statistics-metrics" }));
    const result = analyzeHarmonyStatistics(composition, { startBar: 0, endBar: 1 });
    expect(Number.isFinite(result.geometricMeanConditionalProbability)).toBe(true);
    expect(Number.isFinite(result.meanSurprisalBits)).toBe(true);
    expect(result.complexChordFormula).toContain("extensions");
    expect(result.source).toContain("POP909");
  });

  it("resets statistical context at a key/mode boundary", () => {
    const composition = generateComposition(settings({
      bars: 4,
      progressionId: "fifties",
      seed: "statistics-modulation-boundary",
    }));
    const sections: SectionEvent[] = [
      {
        id: "section-c",
        kind: "verse",
        startBar: 0,
        endBar: 2,
        key: "C",
        mode: "major",
        transpose: 0,
      },
      {
        id: "section-d",
        kind: "chorus",
        startBar: 2,
        endBar: 4,
        key: "D",
        mode: "major",
        transpose: 2,
      },
    ];
    const modulated = { ...composition, sections };
    const insights = analyzeHarmonyStatistics(modulated);
    expect(insights.transitionCount).toBe(2);
    expect(insights.transitions.every((transition) => transition.fromIndex !== 1)).toBe(true);
    const target = modulated.chords[2]!;
    const suggestions = suggestNextChords(modulated, { targetChord: target });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((suggestion) => suggestion.orderUsed === 1)).toBe(true);
    expect(suggestions.every((suggestion) => suggestion.reasons.some((reason) =>
      reason.includes("コーパス総token") && !reason.includes("文脈")))).toBe(true);
  });

  it("clips cross-boundary melody tension and counts only in-scope onsets", () => {
    const composition = generateComposition(settings({ bars: 4, seed: "statistics-scope-metrics" }));
    const bar = composition.ticksPerBar;
    const chords = composition.chords.map((chord, index) => index < 2
      ? {
        ...chord,
        notes: index === 0 ? [60, 64, 67] : [62, 65, 69],
        leftHand: index === 0 ? [36] : [50],
      }
      : chord);
    const crossingNote = {
      ...composition.notes[0]!,
      midi: 60,
      startTick: bar - 240,
      durationTick: 480,
    };
    const edited = { ...composition, chords, notes: [crossingNote] };
    const whole = analyzeHarmonyStatistics(edited);
    expect(whole.durationWeightedMelodyNonChordTension).toBeCloseTo(0.5, 8);
    expect(analyzeHarmonyStatistics(edited, { startBar: 0, endBar: 2 }).actualBassStepwiseMotionRate).toBe(0);
    const selected = analyzeHarmonyStatistics(edited, { startBar: 1, endBar: 2 });
    expect(selected.durationWeightedMelodyNonChordTension).toBeCloseTo(1, 8);
    expect(selected.syncopationRate).toBe(0);
  });

  it("uses the rendered bass track rather than raw chord minima", () => {
    const composition = generateComposition(settings({ bars: 4, seed: "statistics-rendered-bass" }));
    const bar = composition.ticksPerBar;
    const chords = composition.chords.map((chord, index) => index < 2
      ? {
        ...chord,
        startTick: index * bar,
        durationTick: bar,
        notes: index === 0 ? [60, 64, 67] : [62, 65, 69],
        leftHand: index === 0 ? [36] : [50],
      }
      : chord);
    const result = analyzeHarmonyStatistics({ ...composition, chords }, { startBar: 0, endBar: 2 });
    expect(result.actualBassStepwiseMotionRate).toBe(0);
  });

  it("includes a chord that starts before the analysis scope but sustains into it", () => {
    const composition = generateComposition(settings({ bars: 4, seed: "statistics-overlap-scope" }));
    const first = composition.chords[0]!;
    const held = {
      ...composition,
      chords: composition.chords.map((chord, index) => index === 0
        ? {
          ...chord,
          startTick: 0,
          durationTick: composition.ticksPerBar + Math.floor(composition.ticksPerBar / 2),
        }
        : index === 1
          ? {
            ...chord,
            startTick: composition.ticksPerBar + Math.floor(composition.ticksPerBar / 2),
            durationTick: Math.floor(composition.ticksPerBar / 2),
          }
          : chord),
    };
    const result = analyzeHarmonyStatistics(held, { startBar: 1, endBar: 2 });
    expect(result.chordCount).toBe(2);
    expect(result.transitionCount).toBe(1);
    expect(first.startTick).toBeLessThan(composition.ticksPerBar);
    expect(result.transitions[0]?.fromIndex).toBe(0);
  });
});
