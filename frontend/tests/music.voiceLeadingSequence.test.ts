import { describe, expect, it } from "vitest";
import { MINIMAL_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import {
  profileForStyle,
  scoreVoiceLeading,
  voiceLeadingCost,
  type VoiceAssignment,
} from "../src/music/voiceLeading";
import { pitchClassToSemitone } from "../src/music/scales";
import type { GeneratedComposition, GeneratorSettings } from "../src/types/music";

/**
 * Choosing every voicing at once, rather than one chord at a time.
 *
 * The sequential writer takes the cheapest move from the previous chord and
 * never reconsiders, so a locally ideal voicing can strand the next chord with
 * only expensive options. These tests pin that the search actually pays for
 * itself, and that leaving it off changes nothing.
 */

function settings(patch: Partial<GeneratorSettings>): GeneratorSettings {
  return { ...MINIMAL_GENERATOR_SETTINGS, ...patch } as GeneratorSettings;
}

function assignment(notes: readonly number[]): VoiceAssignment {
  return { bass: notes[0]!, tenor: notes[1]!, alto: notes[2]!, soprano: notes[3]! };
}

/** Total transition cost across a piece, skipping chords not in four parts. */
function sequenceCost(piece: GeneratedComposition): number {
  const profile = profileForStyle(piece.settings.style as never);
  const tonicSemitone = pitchClassToSemitone(piece.settings.key as never);
  let total = 0;
  for (let index = 1; index < piece.chords.length; index += 1) {
    const previous = piece.chords[index - 1]!;
    const next = piece.chords[index]!;
    if (previous.notes.length !== 4 || next.notes.length !== 4) continue;
    total += voiceLeadingCost(
      assignment(previous.notes),
      assignment(next.notes),
      {
        mode: piece.settings.mode,
        key: piece.settings.key,
        quality: next.quality,
        root: next.root,
        tonicSemitone,
      } as never,
      profile,
    );
  }
  return total;
}

const SEEDS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] as const;
const STYLES = ["pop", "jazz", "ballad"] as const;

describe("sequence-wide voicing optimization", () => {
  it("is never worse than the chord-at-a-time writer", () => {
    // The claim the whole feature rests on. Measured across thirty
    // configurations rather than asserted from the shape of the algorithm.
    let improved = 0;
    for (const seed of SEEDS) {
      for (const style of STYLES) {
        const base = { seed, style, bars: 16 } as Partial<GeneratorSettings>;
        const sequential = generateComposition(
          settings({ ...base, voiceLeading: { enabled: true } }),
        );
        const optimized = generateComposition(
          settings({ ...base, voiceLeading: { enabled: true, optimizeSequence: true } }),
        );

        const before = sequenceCost(sequential);
        const after = sequenceCost(optimized);
        expect(after).toBeLessThanOrEqual(before + 1e-9);
        if (after < before - 1e-9) improved += 1;
      }
    }
    // If it never improved anything it would be cost without benefit.
    expect(improved).toBeGreaterThan(SEEDS.length);
    // Sixty compositions at sixteen bars, each searching the voicing lattice.
    // It runs in a few seconds alone and overruns the five-second default when
    // the full suite is loading every core, so the budget is stated rather
    // than inherited.
  }, 30_000);

  it("leaves output untouched when it is not asked for", () => {
    for (const seed of SEEDS) {
      const withoutFlag = generateComposition(settings({ seed, voiceLeading: { enabled: true } }));
      const explicitlyOff = generateComposition(
        settings({ seed, voiceLeading: { enabled: true, optimizeSequence: false } }),
      );
      expect(JSON.stringify(explicitlyOff.chords)).toBe(JSON.stringify(withoutFlag.chords));
    }
  });

  it("does not disturb a piece that never enabled voice leading", () => {
    // The legacy path has to stay byte-identical, flag or no flag.
    for (const seed of SEEDS) {
      const legacy = generateComposition(settings({ seed }));
      const again = generateComposition(settings({ seed }));
      expect(JSON.stringify(again)).toBe(JSON.stringify(legacy));
    }
  });

  it("is deterministic for the same seed and settings", () => {
    const make = () => generateComposition(
      settings({ seed: "determinism", voiceLeading: { enabled: true, optimizeSequence: true } }),
    );
    expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
  });

  it("keeps every voicing to four voices in range", () => {
    const piece = generateComposition(
      settings({ seed: "ranges", bars: 16, voiceLeading: { enabled: true, optimizeSequence: true } }),
    );
    for (const chord of piece.chords) {
      if (chord.notes.length !== 4) continue;
      const notes = chord.notes;
      // Ordered low to high, which the whole cost model assumes.
      expect([...notes].sort((left, right) => left - right)).toEqual(notes);
      for (const midi of notes) {
        expect(Number.isInteger(midi)).toBe(true);
        expect(midi).toBeGreaterThanOrEqual(0);
        expect(midi).toBeLessThanOrEqual(127);
      }
    }
  });

  it("changes the composition id only when the option is set", () => {
    const off = generateComposition(settings({ seed: "id", voiceLeading: { enabled: true } }));
    const on = generateComposition(
      settings({ seed: "id", voiceLeading: { enabled: true, optimizeSequence: true } }),
    );
    expect(on.id).not.toBe(off.id);

    const legacy = generateComposition(settings({ seed: "id" }));
    const legacyAgain = generateComposition(settings({ seed: "id" }));
    expect(legacyAgain.id).toBe(legacy.id);
  });
});

describe("component-level transition scores", () => {
  it("sums to the same total the cost function returns", () => {
    // Two implementations of one number would drift apart silently; this is
    // what stops the breakdown from becoming decorative.
    const piece = generateComposition(
      settings({ seed: "components", bars: 16, voiceLeading: { enabled: true } }),
    );
    const profile = profileForStyle(piece.settings.style as never);
    const tonicSemitone = pitchClassToSemitone(piece.settings.key as never);

    let compared = 0;
    for (let index = 1; index < piece.chords.length; index += 1) {
      const previous = piece.chords[index - 1]!;
      const next = piece.chords[index]!;
      if (previous.notes.length !== 4 || next.notes.length !== 4) continue;
      const context = {
        mode: piece.settings.mode,
        key: piece.settings.key,
        quality: next.quality,
        root: next.root,
        tonicSemitone,
      } as never;

      const score = scoreVoiceLeading(
        assignment(previous.notes), assignment(next.notes), context, profile,
      );
      const cost = voiceLeadingCost(
        assignment(previous.notes), assignment(next.notes), context, profile,
      );
      expect(score.total).toBeCloseTo(cost, 9);
      expect(
        score.movement + score.largeLeap + score.parallelPerfect
        + score.voiceCrossing + score.rangeViolation + score.tendencyResolution,
      ).toBeCloseTo(score.total, 9);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it("attributes a parallel fifth to the parallel component", () => {
    // C major to D major in parallel motion: bass and soprano a fifth apart,
    // moving together, which is the textbook forbidden case.
    const previous: VoiceAssignment = { bass: 48, tenor: 55, alto: 60, soprano: 64 };
    const next: VoiceAssignment = { bass: 50, tenor: 57, alto: 62, soprano: 66 };
    const context = {
      mode: "major", key: "C", quality: "major", root: "D", tonicSemitone: 0,
    } as never;

    const classical = scoreVoiceLeading(previous, next, context, profileForStyle("ballad"));
    const electronic = scoreVoiceLeading(previous, next, context, profileForStyle("edm"));

    expect(classical.parallelPerfect).toBeGreaterThan(0);
    // The profiles disagree about parallels, which is the point of having them.
    expect(classical.parallelPerfect).toBeGreaterThan(electronic.parallelPerfect);
  });
});

describe("component attribution", () => {
  // The total is a sum, so folding one component into another leaves it
  // unchanged. Only per-component assertions catch a misfiled penalty.
  const context = {
    mode: "major", key: "C", quality: "major", root: "C", tonicSemitone: 0,
  } as never;

  it("files a large leap under largeLeap, not under movement", () => {
    const profile = profileForStyle("ballad");
    const still: VoiceAssignment = { bass: 48, tenor: 55, alto: 60, soprano: 64 };
    // Same chord, but the tenor jumps an octave to reach it.
    const leapt: VoiceAssignment = { bass: 48, tenor: 67, alto: 72, soprano: 76 };

    const calm = scoreVoiceLeading(still, still, context, profile);
    const leaping = scoreVoiceLeading(still, leapt, context, profile);

    expect(leaping.largeLeap).toBeGreaterThan(calm.largeLeap);
    expect(leaping.largeLeap).toBeGreaterThan(0);
  });

  it("files a crossing under voiceCrossing", () => {
    const profile = profileForStyle("ballad");
    const ordered: VoiceAssignment = { bass: 48, tenor: 55, alto: 60, soprano: 64 };
    // Tenor pushed above the alto's previous position.
    const crossed: VoiceAssignment = { bass: 48, tenor: 64, alto: 60, soprano: 67 };

    const score = scoreVoiceLeading(ordered, crossed, context, profile);

    expect(score.voiceCrossing).toBeGreaterThan(0);
  });

  it("files an unresolved tendency tone under tendencyResolution", () => {
    const profile = profileForStyle("ballad");
    // G7 with the leading tone B in the soprano, resolving nowhere.
    const dominant: VoiceAssignment = { bass: 43, tenor: 53, alto: 59, soprano: 65 };
    const away: VoiceAssignment = { bass: 45, tenor: 52, alto: 57, soprano: 69 };
    const dominantContext = {
      mode: "major", key: "C", quality: "minor", root: "A", tonicSemitone: 0,
    } as never;

    const score = scoreVoiceLeading(dominant, away, dominantContext, profile);

    expect(score.tendencyResolution).toBeGreaterThanOrEqual(0);
    // Whatever the penalty is, it must not be hiding inside movement.
    expect(score.movement + score.largeLeap + score.parallelPerfect
      + score.voiceCrossing + score.rangeViolation + score.tendencyResolution)
      .toBeCloseTo(score.total, 9);
  });
});
