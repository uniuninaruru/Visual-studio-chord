import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  generateComposition,
  validateComposition,
} from "../src/music";
import { chooseTensions } from "../src/music/tensions";
import type { GeneratedComposition, GeneratorSettings } from "../src/types/music";

/**
 * Colour tones on the ordinary generation path.
 *
 * The voicing machinery already existed -- reduceStack drops the fifth to make
 * room and keeps colour tones above the seventh -- but only a named
 * progression could ask for one. Measured across all eight styles at sixteen
 * bars, every chord the default path produced was a plain triad, and even
 * harmony.complexity "advanced" never exceeded four notes. Nothing in the app
 * could sound a ninth.
 */

function settings(patch: Partial<GeneratorSettings>): GeneratorSettings {
  return { ...DEFAULT_GENERATOR_SETTINGS, ...patch } as GeneratorSettings;
}

function sevenths(patch: Partial<GeneratorSettings>): GeneratorSettings {
  return settings({
    ...patch,
    harmony: { ...DEFAULT_GENERATOR_SETTINGS.harmony, complexity: "sevenths" },
  });
}

function coloured(piece: GeneratedComposition) {
  return piece.chords.filter((chord) => (chord.tensions?.length ?? 0) > 0);
}

const STYLES = ["pop", "j-pop", "rock", "jazz", "lo-fi", "edm", "ballad", "game-music"] as const;
const COMPLEXITIES = ["triads", "sevenths", "advanced"] as const;

describe("colour tones on the default path", () => {
  it("sounds them at all, in every style", () => {
    for (const style of STYLES) {
      const base = { seed: "col", style, bars: 16 } as Partial<GeneratorSettings>;
      const plain = generateComposition(settings(base));
      const colourful = generateComposition(
        settings({ ...base, tensions: { enabled: true } }),
      );

      // Measured before this existed: three notes, every chord, every style.
      expect(new Set(plain.chords.map((chord) => chord.notes.length))).toEqual(new Set([3]));
      expect(coloured(plain)).toHaveLength(0);
      expect(coloured(colourful).length).toBeGreaterThan(0);
      expect(Math.max(...colourful.chords.map((chord) => chord.notes.length)))
        .toBeGreaterThan(3);
    }
  });

  it("reaches five notes once the chords are sevenths", () => {
    // A ninth over a triad is a four-note shape. A real ninth chord needs the
    // seventh underneath it, which is the thing that could not be built.
    const piece = generateComposition(sevenths({
      seed: "five", bars: 16, style: "jazz", tensions: { enabled: true, rate: 1 },
    }));
    expect(Math.max(...piece.chords.map((chord) => chord.notes.length))).toBeGreaterThanOrEqual(5);
  });

  it("never puts a colour tone where it would clash with the chord itself", () => {
    // An eleventh on a sus4 is the note the suspension already is; a ninth on
    // an add9 is the note the chord is named for; a diminished seventh is a
    // closed symmetrical shape. Choosing from the degree's diatonic quality
    // instead of the chord's produced exactly these.
    for (const style of STYLES) {
      for (const complexity of COMPLEXITIES) {
        for (const seed of ["a", "b", "c"]) {
          const piece = generateComposition(settings({
            seed, style, bars: 16,
            harmony: { ...DEFAULT_GENERATOR_SETTINGS.harmony, complexity },
            tensions: { enabled: true, rate: 1 },
          }));
          for (const chord of piece.chords) {
            const tensions = chord.tensions ?? [];
            if (tensions.length === 0) continue;
            expect(chord.quality).not.toBe("sus2");
            expect(chord.quality).not.toBe("sus4");
            expect(chord.quality).not.toBe("diminished7");
            if (chord.quality === "add9" || chord.quality === "minorAdd9") {
              expect(tensions).not.toContain("9");
            }
          }
        }
      }
    }
  });

  it("never sounds a natural eleventh over a major third", () => {
    // The avoid note. It sits a semitone above the third and clashes with it;
    // resolveAvoidNotes raises it, and this pins that the raise survives.
    const majorThirded = new Set(["major", "major7", "dominant7", "augmented", "augmentedMajor7"]);
    for (const style of STYLES) {
      const piece = generateComposition(settings({
        seed: "avoid", style, bars: 16,
        harmony: { ...DEFAULT_GENERATOR_SETTINGS.harmony, complexity: "advanced" },
        tensions: { enabled: true, rate: 1 },
      }));
      for (const chord of piece.chords) {
        if (!majorThirded.has(chord.quality)) continue;
        expect(chord.tensions ?? []).not.toContain("11");
      }
    }
  });

  it("colours the chromatic chords too, not only the diatonic ones", () => {
    // Secondary dominants and borrowed chords are built on a different path
    // from the plain degrees, so a colour tone reaching one says nothing about
    // the other.
    let chromatic = 0;
    for (const style of STYLES) {
      for (const seed of ["a", "b", "c"]) {
        const piece = generateComposition(settings({
          seed, style, bars: 16,
          harmony: { ...DEFAULT_GENERATOR_SETTINGS.harmony, complexity: "advanced" },
          tensions: { enabled: true, rate: 1 },
        }));
        chromatic += piece.chords.filter(
          (chord) => (chord.tensions?.length ?? 0) > 0
            && chord.source !== "diatonic"
            && chord.source !== "other",
        ).length;
      }
    }
    expect(chromatic).toBeGreaterThan(0);
  });

  it("still passes the composition's own validation", () => {
    // The trap: validateComposition widens the permitted pitch classes from
    // the chord's declared tensions, so a voicing that sounds a colour tone
    // without naming it is rejected as containing a foreign tone. It also
    // requires a chord declared diatonic to carry the scale's exact symbol.
    for (const style of STYLES) {
      for (const complexity of COMPLEXITIES) {
        const piece = generateComposition(settings({
          seed: "valid", style, bars: 16,
          harmony: { ...DEFAULT_GENERATOR_SETTINGS.harmony, complexity },
          tensions: { enabled: true, rate: 1 },
        }));
        const outcome = validateComposition(piece);
        expect(outcome.errors.map((issue) => issue.code)).toEqual([]);
        expect(outcome.valid).toBe(true);
      }
    }
  });

  it("declares every colour tone it sounds", () => {
    const piece = generateComposition(sevenths({
      seed: "declare", bars: 16, tensions: { enabled: true, rate: 1 },
    }));
    for (const chord of coloured(piece)) {
      // The symbol has to say so too, or the chord lane shows a triad.
      expect(chord.symbol).toContain("(");
      for (const tension of chord.tensions ?? []) {
        expect(chord.symbol).toContain(tension);
      }
      // And it can no longer claim to be the scale's plain diatonic chord.
      expect(chord.source).not.toBe("diatonic");
    }
  });

  it("leaves the piece untouched when it is not asked for", () => {
    for (const style of STYLES) {
      const base = { seed: "off", style, bars: 16 } as Partial<GeneratorSettings>;
      const absent = generateComposition(settings(base));
      const explicit = generateComposition(settings({ ...base, tensions: { enabled: false } }));
      const zero = generateComposition(
        settings({ ...base, tensions: { enabled: true, rate: 0 } }),
      );
      expect(JSON.stringify(explicit.chords)).toBe(JSON.stringify(absent.chords));
      expect(JSON.stringify(zero.chords)).toBe(JSON.stringify(absent.chords));
    }
  });

  it("colours more chords as the rate rises", () => {
    const share = (rate: number) => {
      const piece = generateComposition(settings({
        seed: "rate", bars: 32, tensions: { enabled: true, rate },
      }));
      return coloured(piece).length;
    };
    expect(share(0)).toBe(0);
    expect(share(0.25)).toBeLessThan(share(0.75));
    expect(share(0.75)).toBeLessThanOrEqual(share(1));
    expect(share(1)).toBeGreaterThan(0);
  });

  it("respects the ceiling", () => {
    const reached = (ceiling: "9" | "11" | "13") => {
      const piece = generateComposition(sevenths({
        seed: "ceil", bars: 32, style: "jazz",
        tensions: { enabled: true, rate: 1, ceiling },
      }));
      return new Set(piece.chords.flatMap((chord) => chord.tensions ?? []));
    };

    expect([...reached("9")]).toEqual(["9"]);
    const upToEleven = reached("11");
    expect(upToEleven.has("13")).toBe(false);
    expect(reached("13").has("13")).toBe(true);
  });

  it("changes the composition id only when it is set", () => {
    const off = generateComposition(settings({ seed: "id" }));
    const on = generateComposition(settings({ seed: "id", tensions: { enabled: true } }));
    const faster = generateComposition(
      settings({ seed: "id", tensions: { enabled: true, rate: 1 } }),
    );
    const lower = generateComposition(
      settings({ seed: "id", tensions: { enabled: true, ceiling: "9" } }),
    );

    expect(on.id).not.toBe(off.id);
    expect(faster.id).not.toBe(on.id);
    expect(lower.id).not.toBe(on.id);
    expect(generateComposition(settings({ seed: "id" })).id).toBe(off.id);
  });

  it("is deterministic", () => {
    const make = () => generateComposition(sevenths({
      seed: "det", bars: 16, tensions: { enabled: true, rate: 0.6 },
    }));
    expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
  });
});

describe("which colour tones a quality accepts", () => {
  const on = { enabled: true, rate: 1 } as const;

  it("gives nothing to a quality that already carries one", () => {
    for (const quality of ["sus2", "sus4", "add9", "minorAdd9", "diminished7", "diminished"] as const) {
      expect(chooseTensions(quality, on, "seed", 0)).toEqual([]);
    }
  });

  it("never offers an eleventh to a quality with a major third", () => {
    for (const quality of ["major", "major7", "dominant7", "augmented"] as const) {
      for (let slot = 0; slot < 40; slot += 1) {
        expect(chooseTensions(quality, on, "seed", slot)).not.toContain("11");
      }
    }
  });

  it("offers an eleventh to a minor chord, where it does not clash", () => {
    const seen = new Set<string>();
    for (let slot = 0; slot < 40; slot += 1) {
      for (const tension of chooseTensions("minor7", on, "seed", slot)) seen.add(tension);
    }
    expect(seen.has("11")).toBe(true);
  });

  it("stacks at most two, and does stack two", () => {
    // Three colour tones over a four-note seventh leaves a shape reduceStack
    // has to thin until the chord stops being recognisable. One is not the
    // answer either: a piece that never doubles up is a piece with one colour.
    let stacked = 0;
    for (const quality of ["major7", "minor7", "dominant7"] as const) {
      for (let slot = 0; slot < 60; slot += 1) {
        const chosen = chooseTensions(quality, on, "seed", slot);
        expect(chosen.length).toBeLessThanOrEqual(2);
        if (chosen.length === 2) stacked += 1;
      }
    }
    expect(stacked).toBeGreaterThan(0);
  });

  it("returns them low to high, so the voicing stacks as it reads", () => {
    const order = ["9", "#9", "11", "#11", "13"];
    for (const quality of ["major7", "minor7", "dominant7"] as const) {
      for (let slot = 0; slot < 60; slot += 1) {
        const chosen = chooseTensions(quality, on, "seed", slot);
        if (chosen.length < 2) continue;
        expect(order.indexOf(chosen[0]!)).toBeLessThan(order.indexOf(chosen[1]!));
      }
    }
  });

  it("never repeats a tone", () => {
    for (const quality of ["major7", "minor7", "dominant7"] as const) {
      for (let slot = 0; slot < 60; slot += 1) {
        const chosen = chooseTensions(quality, on, "seed", slot);
        expect(new Set(chosen).size).toBe(chosen.length);
      }
    }
  });

  it("says nothing at all when it is off", () => {
    expect(chooseTensions("major7", undefined, "seed", 0)).toEqual([]);
    expect(chooseTensions("major7", { enabled: false }, "seed", 0)).toEqual([]);
    expect(chooseTensions("major7", { enabled: true, rate: 0 }, "seed", 0)).toEqual([]);
  });

  it("treats a rate outside the range as the end of the range", () => {
    const always = (rate: number) => {
      let count = 0;
      for (let slot = 0; slot < 50; slot += 1) {
        if (chooseTensions("major7", { enabled: true, rate }, "seed", slot).length > 0) count += 1;
      }
      return count;
    };
    expect(always(5)).toBe(always(1));
    expect(always(-5)).toBe(always(0));
    // A non-finite rate must not silently mean "never" or "always".
    expect(always(Number.NaN)).toBe(always(0.5));
  });

  it("depends on the slot, so a piece is not one chord repeated", () => {
    const shapes = new Set<string>();
    for (let slot = 0; slot < 40; slot += 1) {
      shapes.add(JSON.stringify(chooseTensions("major7", { enabled: true, rate: 0.5 }, "s", slot)));
    }
    expect(shapes.size).toBeGreaterThan(2);
  });

  it("depends on the seed, so two pieces differ", () => {
    // At rate 1 every slot takes a tone, so only *which* tone is left to vary.
    // At a lower rate the roll alone would differ and a pick that ignored the
    // seed would go unnoticed.
    const forSeed = (seed: string, rate: number) => {
      const shapes: string[] = [];
      for (let slot = 0; slot < 20; slot += 1) {
        shapes.push(JSON.stringify(chooseTensions("major7", { enabled: true, rate }, seed, slot)));
      }
      return shapes.join("|");
    };
    expect(forSeed("one", 1)).not.toBe(forSeed("two", 1));

    // Isolating the pick itself. Whether a chord takes a tone at all varies by
    // seed, and so does whether it takes a second, so either alone would hide
    // a pick that ignored the seed. Only the single-tone results say which
    // tone was actually chosen.
    const single = new Set<string>();
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]) {
      const chosen = chooseTensions("major7", { enabled: true, rate: 1 }, seed, 0);
      if (chosen.length === 1) single.add(chosen[0]!);
    }
    expect(single.size).toBeGreaterThan(1);

    expect(forSeed("one", 0.5)).not.toBe(forSeed("two", 0.5));
    expect(forSeed("one", 1)).toBe(forSeed("one", 1));
  });
});
