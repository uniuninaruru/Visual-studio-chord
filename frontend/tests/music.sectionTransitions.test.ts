import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  MINIMAL_GENERATOR_SETTINGS,
  generateComposition,
  validateComposition,
} from "../src/music";
import {
  planTransition,
  transitionProfileFor,
  transitionsInto,
} from "../src/music/sectionTransitions";
import { pitchClassToSemitone } from "../src/music/scales";
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
      { style: "jazz", seed: "s", boundaryIndex: 4, tonicSemitone: tonic },
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
          { style, seed: "s", boundaryIndex: boundary, tonicSemitone: tonic },
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
          { style, seed: "z", boundaryIndex: boundary, tonicSemitone: tonic },
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
      { style: "jazz", seed: "q", boundaryIndex: 12, tonicSemitone: tonic },
    );
    const twice = planTransition(
      { root: "A" as PitchClassName, quality: "minor" },
      { root: C, quality: "major" },
      { style: "jazz", seed: "q", boundaryIndex: 12, tonicSemitone: tonic },
    );
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));

    // And it has to actually depend on both, or every seam in every piece
    // takes the same approach.
    const choices = new Set<string>();
    for (let boundary = 0; boundary < 20; boundary += 1) {
      choices.add(JSON.stringify(planTransition(
        { root: "A" as PitchClassName, quality: "minor" },
        { root: C, quality: "major" },
        { style: "jazz", seed: "q", boundaryIndex: boundary, tonicSemitone: tonic },
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