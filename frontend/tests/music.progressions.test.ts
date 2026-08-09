import { describe, expect, it } from "vitest";
import {
  MINIMAL_GENERATOR_SETTINGS,
  PROGRESSION_TEMPLATES,
  generateComposition,
  generateProgression,
  getProgressionTemplate,
  intervalForTension,
  pitchClassToSemitone,
  progressionTemplatesForMode,
  resolveAvoidNotes,
  validateComposition,
} from "../src/music";
import type { GeneratorSettings, Mode } from "../src/types/music";

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...MINIMAL_GENERATOR_SETTINGS,
    ...patch,
    melody: { ...MINIMAL_GENERATOR_SETTINGS.melody, ...patch.melody },
  };
}

function progression(id: string, patch: Record<string, unknown> = {}) {
  return generateProgression({
    key: "C",
    mode: "major",
    bars: 8,
    timeSignature: "4/4",
    style: "pop",
    seed: "progression-test",
    progressionId: id,
    ...patch,
  } as Parameters<typeof generateProgression>[0]);
}

/** Pitch classes actually sounding, as semitone numbers. */
function pitchClasses(notes: readonly number[]): Set<number> {
  return new Set(notes.map((note) => ((note % 12) + 12) % 12));
}

describe("named progression catalogue", () => {
  it("exposes unique, mode-tagged template ids", () => {
    const ids = PROGRESSION_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of PROGRESSION_TEMPLATES) {
      expect(template.steps.length).toBeGreaterThan(0);
      expect(template.modes.length).toBeGreaterThan(0);
      for (const step of template.steps) {
        expect(step.degree).toBeGreaterThanOrEqual(1);
        expect(step.degree).toBeLessThanOrEqual(7);
      }
    }
  });

  it("only offers a template for modes it declares", () => {
    for (const mode of ["major", "naturalMinor", "dorian"] satisfies Mode[]) {
      for (const template of progressionTemplatesForMode(mode)) {
        expect(template.modes).toContain(mode);
      }
    }
  });

  it("rejects an unknown id and a mode the template does not support", () => {
    expect(() => progression("does-not-exist")).toThrow(/Unknown progression/);
    // royal road is major-only
    expect(() => progression("royal-road", { mode: "naturalMinor" })).toThrow(
      /does not support mode/,
    );
  });
});

describe("royal road progression (王道進行 4536)", () => {
  it("produces FM7 - G7 - Em7 - Am in C major", () => {
    const result = progression("royal-road", { bars: 4 });
    expect(result.degrees).toEqual([4, 5, 3, 6]);
    expect(result.chords.map((chord) => chord.symbol)).toEqual([
      "Fmaj7",
      "G7",
      "Em7",
      "Am",
    ]);
  });

  it("lands on vi, which the engine labels as a loop rather than a resolution", () => {
    const result = progression("royal-road", { bars: 4 });
    expect(result.degrees.at(-1)).toBe(6);
    expect(result.cadence).toBe("loop");
  });
});

describe("pinned qualities the legacy degree pipeline could not express", () => {
  it("marunouchi III7 is a dominant seventh acting as V7/vi", () => {
    const result = progression("marunouchi", { bars: 4 });
    const third = result.chords[1]!;
    expect(third.symbol).toBe("E7");
    expect(third.quality).toBe("dominant7");
    expect(third.specialKind).toBe("secondaryDominant");
    expect(third.targetDegree).toBe(6);
    // E7 = E G# B D
    expect(pitchClasses(third.notes)).toEqual(new Set([4, 8, 11, 2]));
  });

  it("cliché keeps one root while only the quality moves", () => {
    const result = progression("cliche-descending", { bars: 4 });
    expect(result.chords.every((chord) => chord.root === "C")).toBe(true);
    expect(result.chords.map((chord) => chord.quality)).toEqual([
      "major",
      "major7",
      "dominant7",
      "major",
    ]);
    // the last step is C6, carried as a tension rather than a new quality
    expect(result.chords[3]!.tensions).toEqual(["6"]);
  });
});

describe("chromatic roots (bVII, bII) beyond the 1-7 degree pipeline", () => {
  it("backdoor progression builds a real Bb7 in C major", () => {
    const result = progression("backdoor", { bars: 3 });
    const bVII = result.chords[1]!;
    expect(bVII.root).toBe("A#"); // Bb spelled as A#
    expect(bVII.quality).toBe("dominant7");
    expect(bVII.romanNumeral.startsWith("♭")).toBe(true);
  });

  it("an altered root does not inherit the unaltered degree's quality", () => {
    // bVII is a major triad. Degree 7 in C major is diminished, so defaulting
    // to the scale quality would wrongly produce Bbdim here.
    const result = progression("mixolydian-bVII", { bars: 4 });
    const bVII = result.chords[2]!;
    expect(bVII.root).toBe("A#");
    expect(bVII.quality).toBe("major");
    expect(bVII.symbol).toBe("A#");
  });

  it("tritone substitution builds Db7 resolving to the tonic", () => {
    const result = progression("tritone-sub", { bars: 3 });
    const sub = result.chords[1]!;
    expect(sub.root).toBe("C#"); // Db
    expect(sub.quality).toBe("dominant7");
    expect(sub.specialKind).toBe("tritoneSubstitution");
    expect(sub.targetDegree).toBe(1);
  });
});

describe("slash chords with a non-chord bass", () => {
  it("blackadder chord voices Gaug over a Db bass", () => {
    const result = progression("blackadder", { bars: 2 });
    const chord = result.chords[0]!;
    expect(chord.quality).toBe("augmented");
    expect(chord.bass).toBe("C#"); // Db
    expect(chord.symbol).toContain("/C#");
    // Gaug = G B D#; the bass Db is NOT one of them, which is the whole point.
    const classes = pitchClasses(chord.notes);
    expect(classes.has(pitchClassToSemitone("G"))).toBe(true);
    expect(classes.has(pitchClassToSemitone("B"))).toBe(true);
    expect(classes.has(pitchClassToSemitone("D#"))).toBe(true);
    expect(classes.has(pitchClassToSemitone("C#"))).toBe(true);
    // and the bass really is the lowest sounding note
    expect(Math.min(...chord.notes) % 12).toBe(pitchClassToSemitone("C#"));
  });

  it("gospel train keeps the chord while walking the bass down", () => {
    const result = progression("gospel-train", { bars: 8 });
    const basses = result.chords.map((chord) =>
      chord.bass ? pitchClassToSemitone(chord.bass) : null,
    );
    // steps 2, 4 and 6 carry an explicit descending bass
    expect(basses[1]).toBe(pitchClassToSemitone("B"));
    expect(basses[3]).toBe(pitchClassToSemitone("G"));
    expect(basses[5]).toBe(pitchClassToSemitone("E"));
    for (const chord of result.chords) {
      if (chord.bass) {
        expect(Math.min(...chord.notes) % 12).toBe(pitchClassToSemitone(chord.bass));
      }
    }
  });
});

describe("tensions (9th/11th/13th) the closed ChordQuality could not stack", () => {
  it("stacks a seventh and a ninth together as maj9", () => {
    const result = progression("gospel-1625-ninths", { bars: 4 });
    const tonic = result.chords[0]!;
    expect(tonic.quality).toBe("major7");
    expect(tonic.tensions).toEqual(["9"]);
    // Cmaj9 must contain both B (maj7) and D (9th)
    const classes = pitchClasses(tonic.notes);
    expect(classes.has(pitchClassToSemitone("B"))).toBe(true);
    expect(classes.has(pitchClassToSemitone("D"))).toBe(true);
  });

  it("voices colour tones above the seventh", () => {
    const result = progression("gospel-1625-ninths", { bars: 4 });
    const tonic = result.chords[0]!;
    const seventh = tonic.notes.find((n) => n % 12 === pitchClassToSemitone("B"))!;
    const ninth = tonic.notes.find((n) => n % 12 === pitchClassToSemitone("D"))!;
    expect(ninth).toBeGreaterThan(seventh);
  });

  it("carries altered dominants (b9, #9, 13)", () => {
    const result = progression("neo-soul-upgrade", { bars: 4 });
    expect(result.chords[1]!.tensions).toEqual(["#9"]);
    expect(result.chords[3]!.tensions).toEqual(["13", "b9"]);
  });
});

describe("avoid-note handling", () => {
  it("raises a natural 11th to #11 over a major third", () => {
    expect(resolveAvoidNotes("major7", ["11"])).toEqual(["#11"]);
    expect(resolveAvoidNotes("dominant7", ["11"])).toEqual(["#11"]);
  });

  it("leaves the natural 11th alone on minor chords", () => {
    expect(resolveAvoidNotes("minor7", ["11"])).toEqual(["11"]);
  });

  it("never sounds a minor ninth between the third and the eleventh", () => {
    const result = progression("neo-soul-upgrade", { bars: 4 });
    for (const chord of result.chords) {
      const classes = [...pitchClasses(chord.notes)];
      const root = pitchClassToSemitone(chord.root);
      const hasMajorThird = classes.includes((root + 4) % 12);
      const hasNatural11 = classes.includes((root + 5) % 12);
      expect(hasMajorThird && hasNatural11).toBe(false);
    }
  });

  it("maps each tension to its interval above the root", () => {
    expect(intervalForTension("9")).toBe(14);
    expect(intervalForTension("#11")).toBe(18);
    expect(intervalForTension("13")).toBe(21);
  });
});

describe("named progressions in full compositions", () => {
  it("is deterministic for a fixed progression and seed", () => {
    const input = settings({ progressionId: "royal-road", seed: "fixed" });
    expect(generateComposition(input)).toEqual(generateComposition(input));
  });

  it("produces a valid composition for every template in its declared modes", () => {
    for (const template of PROGRESSION_TEMPLATES) {
      for (const mode of template.modes) {
        const composition = generateComposition(
          settings({
            key: "C",
            mode,
            bars: 8,
            progressionId: template.id,
            seed: `all-${template.id}-${mode}`,
          }),
        );
        const validation = validateComposition(composition);
        expect(
          validation.errors,
          `${template.id} in ${mode}: ${validation.errors.map((e) => e.code).join(", ")}`,
        ).toEqual([]);
      }
    }
  });

  it("changes the harmony when the progression changes", () => {
    const royal = generateComposition(settings({ progressionId: "royal-road", seed: "s" }));
    const komuro = generateComposition(settings({ progressionId: "komuro", seed: "s" }));
    expect(komuro.chords.map((c) => c.symbol)).not.toEqual(
      royal.chords.map((c) => c.symbol),
    );
  });

  it("keeps every template resolvable by id", () => {
    for (const template of PROGRESSION_TEMPLATES) {
      expect(getProgressionTemplate(template.id)).toBe(template);
    }
  });
});
