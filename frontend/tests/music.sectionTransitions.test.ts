import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  MINIMAL_GENERATOR_SETTINGS,
  generateComposition,
  validateComposition,
} from "../src/music";
import {
  planTransition,
  rankTransitionCandidates,
  transitionProfileFor,
  transitionsInto,
} from "../src/music/sectionTransitions";
import { pitchClassToSemitone } from "../src/music/scales";
import type {
  ConditionalHarmonyEvidence,
  HarmonyStatisticsProvider,
} from "../src/music/statisticalHarmony";
import type { ChordQuality, GeneratedComposition, GeneratorSettings, PitchClassName } from "../src/types/music";

/**
 * Approach chords at section boundaries.
 *
 * Measured before this existed, on a thirty-two bar verse-chorus piece: every
 * boundary was a butt joint. The chorus arrived straight from V onto IVmaj7,
 * the verse landed on I from vi, and nothing prepared any of it. The section
 * plan knew where the seams were and the chord writer never saw them.
 */

function settings(patch: Partial<GeneratorSettings>): GeneratorSettings {
  return {
    ...MINIMAL_GENERATOR_SETTINGS, bars: 32, songForm: { form: "verseChorus" }, ...patch,
  } as GeneratorSettings;
}

const STYLES = ["pop", "j-pop", "rock", "jazz", "lo-fi", "edm", "ballad", "game-music"] as const;
const SEEDS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

const MOCK_PROVENANCE: HarmonyStatisticsProvider["provenance"] = {
  sourceKind: "test-fixture",
  modelId: "test-model",
  modelVersion: "1",
  schemaVersion: 1,
  sourceModelOrders: [1, 2, 3],
  browserOrders: [1, 2, 3],
  pop909Commit: "fixture",
  pop909Repository: "fixture",
  pop909SongCount: 1,
  sequenceCount: 1,
  tokenCount: 1,
  fullSourceSha256: "0".repeat(64),
  rawSongDataBundled: false,
};

function evidence(
  tokens: readonly string[],
  probability: number,
  patch: Partial<ConditionalHarmonyEvidence> = {},
): ConditionalHarmonyEvidence {
  const orderUsed = Math.min(3, tokens.length);
  return {
    rawConditionalProbability: probability,
    probability,
    unigramCount: 10,
    exactGramCount: 2,
    contextCount: 10,
    orderUsed,
    surprisalBits: -Math.log2(probability),
    tokens: [...tokens].slice(-3),
    supported: true,
    ...patch,
  };
}

function mockProvider(
  response: (tokens: readonly string[]) => ConditionalHarmonyEvidence,
): HarmonyStatisticsProvider {
  return { id: "test-provider", provenance: MOCK_PROVENANCE, probability: response };
}

function relativeToken(
  chord: { root: PitchClassName; quality: ChordQuality },
  tonicSemitone: number,
): string {
  const relative = ((pitchClassToSemitone(chord.root) - tonicSemitone) % 12 + 12) % 12;
  return `${relative}:${chord.quality}`;
}

function approaches(piece: GeneratedComposition) {
  return piece.chords.filter((chord) => chord.id.endsWith("-approach"));
}

function countFor(style: GeneratorSettings["style"]) {
  let total = 0;
  for (const seed of SEEDS) {
    total += approaches(generateComposition(
      settings({ style, seed, sectionTransitions: { enabled: true } }),
    )).length;
  }
  return total;
}

describe("section transitions", () => {
  it("prepares boundaries that used to be butt joints", () => {
    for (const style of STYLES) {
      for (const seed of ["a", "b", "c"]) {
        const plain = generateComposition(settings({ style, seed }));
        expect(approaches(plain), `${style}/${seed}`).toHaveLength(0);
      }
    }
    // Every style must actually produce some, or the profile is switched off
    // in all but name.
    for (const style of STYLES) {
      expect(countFor(style), style).toBeGreaterThan(0);
    }
  });

  it("keeps the chords tiling the timeline exactly", () => {
    // The approach chord takes the second half of the chord before it rather
    // than being inserted. Inserting would push every later chord along and
    // break the tiling the whole app depends on.
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const piece = generateComposition(
          settings({ style, seed, sectionTransitions: { enabled: true } }),
        );
        let tick = 0;
        for (const chord of piece.chords) {
          expect(chord.startTick, `${style}/${seed}`).toBe(tick);
          expect(chord.durationTick, `${style}/${seed}`).toBeGreaterThan(0);
          tick = chord.startTick + chord.durationTick;
        }
        expect(tick, `${style}/${seed}`).toBe(piece.totalTicks);
      }
    }
  });

  it("does not change how many bars the piece has", () => {
    for (const style of STYLES) {
      const plain = generateComposition(settings({ style, seed: "bars" }));
      const prepared = generateComposition(
        settings({ style, seed: "bars", sectionTransitions: { enabled: true } }),
      );
      expect(prepared.totalTicks, style).toBe(plain.totalTicks);
      expect(prepared.bars.length, style).toBe(plain.bars.length);
      expect(JSON.stringify(prepared.sections), style).toBe(JSON.stringify(plain.sections));
    }
  });

  it("lands the approach immediately before the section it approaches", () => {
    for (const style of STYLES) {
      for (const seed of ["a", "b", "c"]) {
        const piece = generateComposition(
          settings({ style, seed, sectionTransitions: { enabled: true } }),
        );
        const boundaries = new Set(
          (piece.sections ?? []).map((section) => section.startBar * piece.ticksPerBar),
        );
        for (const chord of approaches(piece)) {
          const endsAt = chord.startTick + chord.durationTick;
          expect(boundaries.has(endsAt), `${style}/${seed} @${endsAt}`).toBe(true);
        }
      }
    }
  });

  it("still passes the composition's own validation", () => {
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const piece = generateComposition(
          settings({ style, seed, sectionTransitions: { enabled: true } }),
        );
        expect(validateComposition(piece).errors.map((issue) => issue.code), `${style}/${seed}`)
          .toEqual([]);
      }
    }
  });

  it("uses each style's own techniques and not another's", () => {
    // A tritone substitute into the chorus of a game-music cue is wrong in the
    // same way a plain subdominant into a jazz bridge is limp.
    const used = (style: GeneratorSettings["style"]) => {
      const seen = new Set<string>();
      for (const seed of SEEDS) {
        for (const chord of approaches(generateComposition(
          settings({ style, seed, sectionTransitions: { enabled: true } }),
        ))) {
          seen.add((chord.explanation ?? "").split(";")[0] ?? "");
        }
      }
      return [...seen].join(" | ");
    };

    expect(used("jazz")).toContain("Tritone substitute");
    // Rock and EDM weight the tritone substitute at zero, and a weight of zero
    // has to mean never rather than rarely.
    expect(used("rock")).not.toContain("Tritone substitute");
    expect(used("edm")).not.toContain("Tritone substitute");
    expect(used("rock")).not.toContain("Diminished approach");
  });

  it("prepares more seams in the styles that ask for more", () => {
    // Measured: jazz 62 of 70 boundaries, rock and edm 30.
    expect(countFor("jazz")).toBeGreaterThan(countFor("pop"));
    expect(countFor("pop")).toBeGreaterThan(countFor("rock"));
    // And never all of them: an approach chord at every seam stops being one.
    for (const style of STYLES) {
      expect(countFor(style), style).toBeLessThan(70);
    }
  });

  it("leaves the piece byte-identical when it is not asked for", () => {
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const absent = generateComposition(settings({ style, seed }));
        const explicit = generateComposition(
          settings({ style, seed, sectionTransitions: { enabled: false } }),
        );
        expect(explicit.id, `${style}/${seed}`).toBe(absent.id);
        expect(JSON.stringify(explicit.chords), `${style}/${seed}`)
          .toBe(JSON.stringify(absent.chords));
        expect(JSON.stringify(explicit.notes), `${style}/${seed}`)
          .toBe(JSON.stringify(absent.notes));
      }
    }
  });

  it("leaves a chord too short to halve alone", () => {
    // With four chords to the bar each is a quarter of a bar, and halving one
    // gives two chords of an eighth each. That is a stumble at the seam, not a
    // turnaround, so those boundaries stay plain.
    for (const style of ["jazz", "j-pop"] as const) {
      for (const seed of SEEDS) {
        const piece = generateComposition(settings({
          style, seed,
          harmonicRhythm: { changesPerBar: 4 },
          sectionTransitions: { enabled: true },
        }));
        expect(approaches(piece), `${style}/${seed}`).toHaveLength(0);
        // And the piece is otherwise untouched, rather than half-processed.
        const plain = generateComposition(settings({
          style, seed, harmonicRhythm: { changesPerBar: 4 },
        }));
        expect(JSON.stringify(piece.chords), `${style}/${seed}`)
          .toBe(JSON.stringify(plain.chords));
      }
    }
    // Two to the bar still leaves half a bar each, which is a real approach.
    let atTwo = 0;
    for (const seed of SEEDS) {
      atTwo += approaches(generateComposition(settings({
        style: "jazz", seed,
        harmonicRhythm: { changesPerBar: 2 },
        sectionTransitions: { enabled: true },
      }))).length;
    }
    expect(atTwo).toBeGreaterThan(0);
  });

  it("does nothing to a piece with no sections at all", () => {
    // Without a song form there are no seams, and a setting that invented some
    // would be inventing structure the piece does not have.
    for (const seed of SEEDS) {
      const plain = generateComposition({
        ...MINIMAL_GENERATOR_SETTINGS, bars: 32, seed,
      } as GeneratorSettings);
      const prepared = generateComposition({
        ...MINIMAL_GENERATOR_SETTINGS, bars: 32, seed, sectionTransitions: { enabled: true },
      } as GeneratorSettings);
      expect(JSON.stringify(prepared.chords), seed).toBe(JSON.stringify(plain.chords));
    }
  });

  it("changes the composition id only when it is set", () => {
    const off = generateComposition(settings({ seed: "id" }));
    const on = generateComposition(settings({ seed: "id", sectionTransitions: { enabled: true } }));
    expect(on.id).not.toBe(off.id);
    expect(generateComposition(settings({ seed: "id" })).id).toBe(off.id);
  });

  it("is deterministic", () => {
    const make = () => generateComposition(
      settings({ seed: "det", style: "jazz", sectionTransitions: { enabled: true } }),
    );
    expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
  });
});

describe("hybrid transition ranking", () => {
  const outgoing = { root: "A" as PitchClassName, quality: "minor" as ChordQuality };
  const incoming = { root: "C" as PitchClassName, quality: "major" as ChordQuality };
  const tonicSemitone = pitchClassToSemitone("C");
  const baseOptions = {
    style: "jazz" as const,
    mode: "major" as const,
    tonicSemitone,
  };

  it("scores the two target-key-relative corpus predictions exactly", () => {
    const calls: string[][] = [];
    const targetTonic = pitchClassToSemitone("D");
    const targetIncoming = { root: "G" as PitchClassName, quality: "major" as ChordQuality };
    const provider = mockProvider((tokens) => {
      calls.push([...tokens]);
      return tokens.length === 2
        ? evidence(tokens, 0.25, { orderUsed: 2, exactGramCount: 4 })
        : evidence(tokens, 0.0625, { orderUsed: 3, exactGramCount: 3 });
    });
    const ranking = rankTransitionCandidates(outgoing, targetIncoming, {
      ...baseOptions,
      tonicSemitone: targetTonic,
      provider,
    });

    expect(ranking.corpusAvailable).toBe(true);
    expect(calls).toHaveLength(ranking.candidates.length * 2);
    expect(calls[0]).toEqual(["7:minor", "0:dominant7"]);
    for (const [index, score] of ranking.candidates.entries()) {
      expect(score.corpus).toEqual({ supportedTransitions: 2, meanSurprisalBits: 3 });
      const first = calls[index * 2]!;
      const second = calls[index * 2 + 1]!;
      const expectedPrefix = [
        relativeToken(outgoing, targetTonic),
        relativeToken(score.candidate, targetTonic),
      ];
      expect(first).toEqual(expectedPrefix);
      expect(second).toEqual([...expectedPrefix, "5:major"]);
      expect(first).toHaveLength(2);
      expect(second).toHaveLength(3);
      expect(score.voiceLeadingCost).toEqual(expect.any(Number));
      expect(Number.isFinite(score.voiceLeadingCost)).toBe(true);
    }
  });

  it("never revives a Pareto-dominated candidate for any seed", () => {
    const equalCorpus = mockProvider((tokens) => evidence(tokens, 0.5));
    const baseline = rankTransitionCandidates(outgoing, incoming, {
      ...baseOptions,
      provider: equalCorpus,
    });
    const maximumPrior = Math.max(...baseline.candidates.map((score) => score.styleWeight));
    const comparable = baseline.candidates.filter((score) => score.styleWeight === maximumPrior);
    expect(comparable).toHaveLength(2);
    const ordered = [...comparable].sort(
      (left, right) => left.voiceLeadingCost - right.voiceLeadingCost,
    );
    const dominator = ordered[0]!;
    const dominated = ordered[1]!;
    const dominatorToken = relativeToken(dominator.candidate, tonicSemitone);
    const dominatedToken = relativeToken(dominated.candidate, tonicSemitone);
    const provider = mockProvider((tokens) => {
      const candidateToken = tokens[1];
      if (candidateToken === dominatorToken) {
        return evidence(tokens, 0.8, { exactGramCount: 8 });
      }
      if (candidateToken === dominatedToken) {
        return evidence(tokens, 0.01, {
          exactGramCount: 0,
          orderUsed: 1,
          supported: false,
        });
      }
      return evidence(tokens, 0.2);
    });
    const ranking = rankTransitionCandidates(outgoing, incoming, { ...baseOptions, provider });

    expect(dominator.voiceLeadingCost).toBeLessThanOrEqual(dominated.voiceLeadingCost);
    expect(ranking.frontier.map((score) => score.candidate.technique))
      .not.toContain(dominated.candidate.technique);
    let selected = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const planned = planTransition(outgoing, incoming, {
        ...baseOptions,
        provider,
        seed: `dominated-${seed}`,
        boundaryIndex: seed,
      });
      if (!planned) continue;
      selected += 1;
      expect(planned.technique).not.toBe(dominated.candidate.technique);
    }
    expect(selected).toBeGreaterThan(0);
  });

  it("is reproducible within the frontier and remains diverse across seeds", () => {
    const provider = mockProvider((tokens) => {
      const techniqueToken = tokens[1];
      if (techniqueToken === "7:dominant7") {
        return evidence(tokens, 0.05, { exactGramCount: 8 });
      }
      if (techniqueToken === "1:dominant7") {
        return tokens.length === 2
          ? evidence(tokens, 0.9, { exactGramCount: 1, orderUsed: 2 })
          : evidence(tokens, 0.9, {
              exactGramCount: 0,
              orderUsed: 1,
              supported: false,
            });
      }
      return evidence(tokens, 0.001, {
        exactGramCount: 0,
        orderUsed: 1,
        supported: false,
      });
    });
    const ranking = rankTransitionCandidates(outgoing, incoming, { ...baseOptions, provider });
    const frontier = new Set(ranking.frontier.map((score) => score.candidate.technique));
    expect(frontier.has("secondaryDominant")).toBe(true);
    expect(frontier.has("tritoneSub")).toBe(true);

    const choices = new Set<string>();
    for (let index = 0; index < 80; index += 1) {
      const options = {
        ...baseOptions,
        provider,
        seed: `frontier-${index}`,
        boundaryIndex: index,
      };
      const first = planTransition(outgoing, incoming, options);
      const second = planTransition(outgoing, incoming, options);
      expect(second).toEqual(first);
      if (!first) continue;
      expect(frontier.has(first.technique)).toBe(true);
      choices.add(first.technique);
    }
    expect(choices.has("secondaryDominant")).toBe(true);
    expect(choices.has("tritoneSub")).toBe(true);
  });

  it("falls back for provider failures and invalid evidence as one candidate set", () => {
    const invalidProviders: Array<[string, HarmonyStatisticsProvider]> = [
      ["throw", mockProvider(() => { throw new Error("fixture failure"); })],
      ["NaN", mockProvider((tokens) => evidence(tokens, 0.5, {
        probability: Number.NaN,
        surprisalBits: Number.NaN,
      }))],
      ["zero probability", mockProvider((tokens) => evidence(tokens, 0.5, {
        probability: 0,
      }))],
      ["probability above one", mockProvider((tokens) => evidence(tokens, 0.5, {
        probability: 1.1,
      }))],
      ["fractional count", mockProvider((tokens) => evidence(tokens, 0.5, {
        exactGramCount: 1.5,
      }))],
      ["invalid order", mockProvider((tokens) => evidence(tokens, 0.5, {
        orderUsed: 4,
      }))],
    ];

    for (const [label, provider] of invalidProviders) {
      const ranking = rankTransitionCandidates(outgoing, incoming, {
        ...baseOptions,
        provider,
      });
      expect(ranking.corpusAvailable, label).toBe(false);
      expect(ranking.candidates.length, label).toBeGreaterThan(0);
      expect(ranking.candidates.every((score) => score.corpus === null), label).toBe(true);

      let planned = null;
      for (let boundaryIndex = 0; boundaryIndex < 20 && !planned; boundaryIndex += 1) {
        planned = planTransition(outgoing, incoming, {
          ...baseOptions,
          provider,
          seed: `fallback-${label}`,
          boundaryIndex,
        });
      }
      expect(planned, label).not.toBeNull();
      expect(planned?.explanation, label).toContain("theory-only ranking");
      expect(planned?.explanation, label).toMatch(/Auto rank: \d+ candidates, \d+ on the Pareto frontier/);
      expect(planned?.explanation, label).toMatch(/four-part cost -?\d+\.\d{2}/);
    }
  });

  it("discards earlier valid evidence when a later candidate is invalid", () => {
    let call = 0;
    const partiallyInvalid = mockProvider((tokens) => {
      call += 1;
      return call < 4
        ? evidence(tokens, 0.5)
        : evidence(tokens, 0.5, { contextCount: -1 });
    });
    const ranking = rankTransitionCandidates(outgoing, incoming, {
      ...baseOptions,
      provider: partiallyInvalid,
    });
    expect(call).toBe(4);
    expect(ranking.corpusAvailable).toBe(false);
    expect(ranking.candidates.every((score) => score.corpus === null)).toBe(true);
  });

  it("publishes the chosen hybrid evidence in the existing explanation", () => {
    const provider = mockProvider((tokens) => evidence(tokens, 0.25));
    let planned = null;
    for (let boundaryIndex = 0; boundaryIndex < 20 && !planned; boundaryIndex += 1) {
      planned = planTransition(outgoing, incoming, {
        ...baseOptions,
        provider,
        seed: "audit-explanation",
        boundaryIndex,
      });
    }
    expect(planned).not.toBeNull();
    expect(planned?.explanation).toContain("hybrid corpus support 2/2");
    expect(planned?.explanation).toContain("mean surprisal 2.00 bits");
    expect(planned?.explanation).toMatch(/four-part cost -?\d+\.\d{2}/);
  });
});

describe("the approach techniques themselves", () => {
  const C = "C" as PitchClassName;
  const tonic = pitchClassToSemitone(C);

  function into(root: PitchClassName, quality: ChordQuality) {
    return transitionsInto(root, quality, tonic);
  }

  it("puts the secondary dominant a fifth above the target", () => {
    // G7 into C. The one approach available into anything.
    const dominant = into(C, "major").find((entry) => entry.technique === "secondaryDominant")!;
    expect(dominant.root).toBe("G");
    expect(dominant.quality).toBe("dominant7");
  });

  it("puts the tritone substitute a semitone above the target", () => {
    // Db7 into C: it shares its third and seventh with G7, so it pulls just as
    // hard while the bass steps down a semitone instead of a fifth.
    const sub = into(C, "major").find((entry) => entry.technique === "tritoneSub")!;
    expect(sub.root).toBe("C#");
    expect(sub.quality).toBe("dominant7");
    // Sharing the tritone is the whole reason it substitutes, so check it.
    const dominantTritone = new Set([(7 + 4) % 12, (7 + 10) % 12]);
    const subTritone = new Set([(1 + 4) % 12, (1 + 10) % 12]);
    expect(subTritone).toEqual(dominantTritone);
  });

  it("puts the backdoor a tone below, and only into a major target", () => {
    // Bb7 into C. Into a minor chord the approach's flat seventh collides with
    // the target's own third, which is why it is withheld there.
    const major = into(C, "major").find((entry) => entry.technique === "backdoor");
    expect(major?.root).toBe("A#");
    expect(into(C, "minor").find((entry) => entry.technique === "backdoor")).toBeUndefined();
    expect(into(C, "minor7").find((entry) => entry.technique === "backdoor")).toBeUndefined();
  });

  it("puts the diminished approach a semitone below", () => {
    const diminished = into(C, "major").find((entry) => entry.technique === "diminishedApproach")!;
    expect(diminished.root).toBe("B");
    expect(diminished.quality).toBe("diminished7");
  });

  it("follows the target's own quality for the subdominant preparation", () => {
    // Into a minor target it has to be the minor subdominant, or the approach
    // states a mode the section is about to contradict.
    expect(into(C, "major").find((entry) => entry.technique === "subdominantPrep")?.quality)
      .toBe("major7");
    expect(into(C, "minor7").find((entry) => entry.technique === "subdominantPrep")?.quality)
      .toBe("minor7");
  });

  it("names every approach relative to the piece's key", () => {
    // The chord lane shows these, so a label computed against the target
    // instead of the key would read as a different chord than it is.
    for (const entry of into("G" as PitchClassName, "major")) {
      expect(entry.label, entry.technique).toBeTruthy();
      expect(entry.explanation, entry.technique).toContain("G");
    }
  });

  it("declines a seam that is already prepared", () => {
    // G7 into C is the preparation. Replacing it would remove one to add one.
    const already = planTransition(
      { root: "G" as PitchClassName, quality: "dominant7" },
      { root: C, quality: "major" },
      { style: "jazz", seed: "s", boundaryIndex: 4, tonicSemitone: tonic, mode: "major" },
    );
    expect(already).toBeNull();
  });

  it("never returns an approach on the chord it would replace", () => {
    // An approach identical to the outgoing chord changes nothing.
    for (const style of STYLES) {
      for (let boundary = 0; boundary < 24; boundary += 1) {
        const chosen = planTransition(
          { root: "F" as PitchClassName, quality: "major" },
          { root: C, quality: "major" },
          { style, seed: "s", boundaryIndex: boundary, tonicSemitone: tonic, mode: "major" },
        );
        if (chosen) expect(chosen.root, `${style}/${boundary}`).not.toBe("F");
      }
    }
  });

  it("never offers a technique a style weights at zero", () => {
    for (const style of STYLES) {
      const profile = transitionProfileFor(style);
      for (let boundary = 0; boundary < 60; boundary += 1) {
        const chosen = planTransition(
          { root: "A" as PitchClassName, quality: "minor" },
          { root: C, quality: "major7" },
          { style, seed: "z", boundaryIndex: boundary, tonicSemitone: tonic, mode: "major" },
        );
        if (!chosen) continue;
        expect(profile.weights[chosen.technique] ?? 0, `${style}/${chosen.technique}`)
          .toBeGreaterThan(0);
      }
    }
  });

  it("is deterministic in the seed and the boundary", () => {
    const once = planTransition(
      { root: "A" as PitchClassName, quality: "minor" },
      { root: C, quality: "major" },
      { style: "jazz", seed: "q", boundaryIndex: 12, tonicSemitone: tonic, mode: "major" },
    );
    const twice = planTransition(
      { root: "A" as PitchClassName, quality: "minor" },
      { root: C, quality: "major" },
      { style: "jazz", seed: "q", boundaryIndex: 12, tonicSemitone: tonic, mode: "major" },
    );
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));

    // And it has to actually depend on both, or every seam in every piece
    // takes the same approach.
    const choices = new Set<string>();
    for (let boundary = 0; boundary < 20; boundary += 1) {
      choices.add(JSON.stringify(planTransition(
        { root: "A" as PitchClassName, quality: "minor" },
        { root: C, quality: "major" },
        { style: "jazz", seed: "q", boundaryIndex: boundary, tonicSemitone: tonic, mode: "major" },
      )));
    }
    expect(choices.size).toBeGreaterThan(2);
  });

  it("gives an approach chord its own function, not the one it points at", () => {
    // The event is spread from the chord it precedes, so degree and function
    // came across with everything else. Measured before this: 132 of 132
    // chromatic approach chords carried the function of their target -- a ♭II7
    // leading into the tonic was labelled tonic, which is the one thing it is
    // not.
    for (const target of ["C", "A", "F#"] as PitchClassName[]) {
      for (const quality of ["major", "minor", "major7", "minor7"] as ChordQuality[]) {
        for (const transition of transitionsInto(target, quality, 0)) {
          const expected = transition.technique === "subdominantPrep"
            ? "predominant"
            : transition.technique === "chromaticApproach"
              ? "other"
              : "dominant";
          expect(transition.harmonyFunction, `${transition.technique} into ${target}`)
            .toBe(expected);
        }
      }
    }
  });

  it("never writes a numeral carrying two accidentals", () => {
    // "#bIIdim7" -- a sharp prefixed onto a table that had already flattened
    // the pitch class. It names nothing, and it reached the chord lane.
    for (const target of ["C", "D", "E", "F", "G", "A", "B"] as PitchClassName[]) {
      for (const quality of ["major", "minor", "dominant7"] as ChordQuality[]) {
        for (const transition of transitionsInto(target, quality, 0)) {
          expect(transition.label, `${transition.technique} into ${target}`)
            .not.toMatch(/[#♯][b♭]|[b♭][#♯]/);
        }
      }
    }
  });

  it("puts the approach on its own degree, or on none", () => {
    // Zero is this app's convention for a root it cannot place in the scale,
    // and most of these approaches are chromatic by construction. Inheriting
    // the target's degree gave them a number in range that meant something
    // else.
    const composed = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS, bars: 32, seed: "deg", style: "jazz",
    } as GeneratorSettings);
    const approaches = composed.chords.filter((chord) => chord.id.endsWith("-approach"));
    expect(approaches.length).toBeGreaterThan(0);
    for (const chord of approaches) {
      if (!/^[♭♯b#]/.test(chord.romanNumeral)) continue;
      expect(chord.degree, `${chord.romanNumeral} kept a degree`).toBe(0);
    }
  });

  it("does not label an approach with the function of the chord after it", () => {
    // The end-to-end form, so a future path that rebuilds these events cannot
    // quietly reintroduce the inheritance. Matched back to the technique that
    // produced it rather than asserted against the target -- an approach and
    // its target can share a function by coincidence, and only the technique
    // says what the approach is.
    let checked = 0;
    for (const seed of ["a", "b", "c", "d"]) {
      const composed = generateComposition({
        ...DEFAULT_GENERATOR_SETTINGS, bars: 32, seed, style: "jazz",
      } as GeneratorSettings);
      const tonicSemitone = pitchClassToSemitone(composed.settings.key);
      for (const [index, chord] of composed.chords.entries()) {
        if (!chord.id.endsWith("-approach")) continue;
        const target = composed.chords[index + 1];
        if (!target) continue;
        const technique = transitionsInto(target.root, target.quality, tonicSemitone)
          .find((entry) => entry.root === chord.root && entry.quality === chord.quality);
        if (!technique) continue;
        checked += 1;
        expect(chord.function, `${chord.romanNumeral} (${technique.technique}) -> ${target.romanNumeral}`)
          .toBe(technique.harmonyFunction);
        if (/^[♭♯b#]/.test(chord.romanNumeral)) {
          expect(chord.degree, `${chord.romanNumeral} kept a degree`).toBe(0);
        }
      }
    }
    expect(checked, "no approach chords were reached").toBeGreaterThan(10);
  });
});
