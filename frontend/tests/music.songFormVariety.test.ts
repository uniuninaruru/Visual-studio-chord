import { describe, expect, it } from "vitest";
import { MINIMAL_GENERATOR_SETTINGS, generateComposition, validateComposition } from "../src/music";
import { PROGRESSION_TEMPLATES } from "../src/music/progressions";
import type { GeneratedComposition, GeneratorSettings, Mode, SongFormId } from "../src/types/music";

/**
 * Letting a thin section tier draw from the next one.
 *
 * Measured before this existed: exactly one progression in the whole catalogue
 * carries usage "bridge", so across forty major-key AABA pieces the bridge was
 * the same four chords forty times out of forty. A tier holding one template is
 * not a choice, it is a constant.
 *
 * The fix is reach, not new data. The catalogue admits a progression only when
 * several independent practitioner sources describe it with the same name and
 * the same degrees, and nothing here relaxes that -- the sections simply stop
 * being cut off from templates that already passed it.
 */

const SEEDS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
const STYLES = ["pop", "j-pop", "jazz", "ballad"] as const;

function settings(patch: Partial<GeneratorSettings>): GeneratorSettings {
  return { ...MINIMAL_GENERATOR_SETTINGS, bars: 32, ...patch } as GeneratorSettings;
}

function degreesOf(piece: GeneratedComposition, kind: string): string[] {
  return (piece.sections ?? [])
    .filter((section) => section.kind === kind)
    .map((section) => piece.chords
      .filter((chord) => {
        const bar = Math.floor(chord.startTick / piece.ticksPerBar);
        return bar >= section.startBar && bar < section.endBar;
      })
      .map((chord) => chord.degree)
      .join(","));
}

function variantsOf(kind: string, options: {
  mode: Mode; form: SongFormId; varied: boolean;
}): Set<string> {
  const seen = new Set<string>();
  for (const style of STYLES) {
    for (const seed of SEEDS) {
      const piece = generateComposition(settings({
        style, seed, mode: options.mode, songForm: { form: options.form },
        ...(options.varied ? { songFormVariety: { variedThinSections: true } } : {}),
      }));
      for (const degrees of degreesOf(piece, kind)) seen.add(degrees);
    }
  }
  return seen;
}

describe("thin section tiers", () => {
  it("has only one bridge template to offer in the first place", () => {
    // The measurement the whole change rests on, taken from the data rather
    // than from the output.
    const bridges = PROGRESSION_TEMPLATES.filter((template) => template.usage === "bridge");
    expect(bridges).toHaveLength(1);
    // And none of them is usable in a minor key, which is why the flag cannot
    // help there.
    expect(bridges.every((template) => template.modes.includes("major"))).toBe(true);
    expect(bridges.some((template) => template.modes.includes("naturalMinor"))).toBe(false);
  });

  it("gives every major-key bridge the same four chords when it is off", () => {
    expect(variantsOf("bridge", { mode: "major", form: "aaba", varied: false }).size).toBe(1);
  });

  it("varies the major-key bridge when it is on", () => {
    // Measured: one variant across forty bridges, up to eight.
    expect(variantsOf("bridge", { mode: "major", form: "aaba", varied: true }).size)
      .toBeGreaterThan(5);
  });

  it("widens the other sections that are thin too", () => {
    // Not a bridge feature. Any tier holding one template is a constant, and a
    // minor key has exactly one verse template to offer.
    const plain = variantsOf("verse", { mode: "naturalMinor", form: "throughComposed", varied: false });
    const varied = variantsOf("verse", { mode: "naturalMinor", form: "throughComposed", varied: true });
    expect(plain.size).toBe(1);
    expect(varied.size).toBeGreaterThan(plain.size);
  });

  it("cannot help a minor key, and does not pretend to", () => {
    // The bridge tier is empty in minor, so the section already falls through
    // to the next tier on its own. What limits it there is that the catalogue
    // holds five minor templates in total, which is a data problem this change
    // does not touch and must not appear to fix.
    const plain = variantsOf("bridge", { mode: "naturalMinor", form: "aaba", varied: false });
    const varied = variantsOf("bridge", { mode: "naturalMinor", form: "aaba", varied: true });
    expect(varied.size).toBe(plain.size);
  });

  it("leaves a tier that already has a real choice alone", () => {
    // Where the section's own usage can offer more than one template, it is
    // still used by itself: widening is for tiers that cannot choose, not a
    // licence to ignore what a section is for.
    const plain = variantsOf("chorus", { mode: "major", form: "verseChorus", varied: false });
    expect(plain.size).toBeGreaterThan(1);
  });

  it("leaves the piece byte-identical when it is not asked for", () => {
    for (const form of ["aaba", "throughComposed", "verseChorus"] as const) {
      for (const style of STYLES) {
        for (const seed of SEEDS) {
          const absent = generateComposition(settings({ style, seed, songForm: { form } }));
          const explicit = generateComposition(settings({
            style, seed, songForm: { form },
            songFormVariety: { variedThinSections: false },
          }));
          expect(explicit.id, `${form}/${style}/${seed}`).toBe(absent.id);
          expect(JSON.stringify(explicit.chords), `${form}/${style}/${seed}`)
            .toBe(JSON.stringify(absent.chords));
        }
      }
    }
  });

  it("does nothing to a piece with no song form", () => {
    for (const seed of SEEDS) {
      const plain = generateComposition(settings({ seed }));
      const varied = generateComposition(
        settings({ seed, songFormVariety: { variedThinSections: true } }),
      );
      expect(JSON.stringify(varied.chords), seed).toBe(JSON.stringify(plain.chords));
    }
  });

  it("still passes the composition's own validation", () => {
    for (const form of ["aaba", "throughComposed"] as const) {
      for (const style of STYLES) {
        for (const seed of SEEDS) {
          const piece = generateComposition(settings({
            style, seed, songForm: { form },
            songFormVariety: { variedThinSections: true },
          }));
          expect(validateComposition(piece).errors.map((issue) => issue.code),
            `${form}/${style}/${seed}`).toEqual([]);
        }
      }
    }
  });

  it("changes the composition id only when it is set", () => {
    const base = { seed: "id", songForm: { form: "aaba" as SongFormId } };
    const off = generateComposition(settings(base));
    const on = generateComposition(
      settings({ ...base, songFormVariety: { variedThinSections: true } }),
    );
    expect(on.id).not.toBe(off.id);
    expect(generateComposition(settings(base)).id).toBe(off.id);
  });

  it("is deterministic", () => {
    const make = () => generateComposition(settings({
      seed: "det", songForm: { form: "aaba" },
      songFormVariety: { variedThinSections: true },
    }));
    expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
  });

  it("still restates a repeated section rather than inventing a new one", () => {
    // The point of a repeating form. Widening the pool must not turn the second
    // A of an AABA into a different progression.
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const piece = generateComposition(settings({
          style, seed, songForm: { form: "aaba" },
          songFormVariety: { variedThinSections: true },
        }));
        const verses = degreesOf(piece, "verse");
        expect(new Set(verses).size, `${style}/${seed}`).toBe(1);
      }
    }
  });
});
