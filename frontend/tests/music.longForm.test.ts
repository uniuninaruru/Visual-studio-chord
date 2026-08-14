import { describe, expect, it } from "vitest";
import {
  MINIMAL_GENERATOR_SETTINGS,
  generateComposition,
  planSections,
  sectionsTileBars,
  validateComposition,
} from "../src/music";
import { exportCompositionJson, exportCompositionMidi, importCompositionJson } from "../src/features/export";
import type { BarCount, GeneratorSettings, SongFormId } from "../src/types/music";

const BAR_COUNTS = [4, 8, 16, 24, 32, 48] as const satisfies readonly BarCount[];
const LONG_COUNTS = [24, 32, 48] as const satisfies readonly BarCount[];
const FORMS = ["verseChorus", "aaba", "throughComposed"] as const satisfies readonly SongFormId[];

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...MINIMAL_GENERATOR_SETTINGS,
    ...patch,
    melody: { ...MINIMAL_GENERATOR_SETTINGS.melody, ...patch.melody },
  };
}

describe("generating longer pieces", () => {
  it("produces a valid composition at every bar count", () => {
    for (const bars of BAR_COUNTS) {
      for (const mode of ["major", "naturalMinor", "dorian"] as const) {
        const composition = generateComposition(settings({ bars, mode, seed: `${bars}-${mode}` }));
        expect(validateComposition(composition).errors, `${bars}/${mode}`).toEqual([]);
        expect(composition.chords.length, `${bars}`).toBe(bars);
        expect(composition.bars.length, `${bars}`).toBe(bars);
        expect(composition.totalTicks, `${bars}`).toBe(bars * composition.ticksPerBar);
      }
    }
  });

  it("stays valid at every bar count in every time signature", () => {
    for (const bars of LONG_COUNTS) {
      for (const timeSignature of ["4/4", "3/4", "6/8"] as const) {
        const composition = generateComposition(
          settings({ bars, timeSignature, seed: `${bars}-${timeSignature}` }),
        );
        expect(
          validateComposition(composition).errors,
          `${bars}/${timeSignature}`,
        ).toEqual([]);
      }
    }
  });

  it("keeps notes inside the piece and inside their own bar", () => {
    for (const bars of LONG_COUNTS) {
      const composition = generateComposition(settings({ bars, seed: `n${bars}` }));
      for (const note of composition.notes) {
        const barStart = note.barIndex * composition.ticksPerBar;
        expect(note.barIndex, `${bars}`).toBeLessThan(bars);
        expect(note.startTick).toBeGreaterThanOrEqual(barStart);
        expect(note.startTick + note.durationTick).toBeLessThanOrEqual(
          barStart + composition.ticksPerBar,
        );
      }
      const last = composition.chords[composition.chords.length - 1]!;
      expect(last.startTick + last.durationTick).toBe(composition.totalTicks);
    }
  });

  it("is deterministic, and each length is its own piece", () => {
    const make = (bars: BarCount) => generateComposition(settings({ bars, seed: "same" }));
    expect(make(48)).toEqual(make(48));
    const ids = BAR_COUNTS.map((bars) => make(bars).id);
    expect(new Set(ids).size).toBe(BAR_COUNTS.length);
  });
});

describe("song form at the longer lengths", () => {
  it("tiles the bar grid exactly, whatever the length", () => {
    for (const bars of BAR_COUNTS) {
      for (const form of FORMS) {
        const sections = planSections({
          key: "C", mode: "major", bars, seed: `${bars}-${form}`, form,
        })!;
        expect(sections, `${bars}/${form}`).toBeDefined();
        expect(sectionsTileBars(sections, bars), `${bars}/${form}`).toBe(true);
        for (const section of sections) {
          // A section squeezed to zero bars would be a section that is not there.
          expect(section.endBar - section.startBar, `${bars}/${form}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("gives a long verse-chorus piece the full layout, not four blocks", () => {
    // Falling back to the eight-bar layout gave a forty-eight bar song four
    // twelve-bar sections with no intro or outro, and a twelve-bar pre-chorus
    // is not a pre-chorus.
    //
    // Thirty-two and forty-eight, not twenty-four: eight sections of a
    // twenty-four bar piece are three bars each, and a three-bar section is
    // below the four bars a period needs. That length now takes the four-section
    // layout instead, which the case below states on its own.
    for (const bars of [32, 48] as const) {
      const sections = planSections({
        key: "C", mode: "major", bars, seed: "f", form: "verseChorus",
      })!;
      expect(sections.map((section) => section.kind), `${bars}`).toEqual([
        "intro", "verse", "preChorus", "chorus",
        "verse", "preChorus", "chorus", "outro",
      ]);
      // Weighted by role, not divided evenly. An even split gave every
      // section the same length, so a chorus arrived and left in the same
      // breath as the intro before it -- measured, a sixteen-bar piece was
      // eight two-bar sections, which is a slideshow rather than a structure.
      const lengths = sections.map((section) => section.endBar - section.startBar);
      expect(lengths.reduce((sum, length) => sum + length, 0), `${bars}`).toBe(bars);
      expect(lengths.every((length) => length >= 4), `${bars}`).toBe(true);

      const of = (kind: string) => sections
        .filter((section) => section.kind === kind)
        .map((section) => section.endBar - section.startBar);
      // A chorus is never shorter than the intro that opens the piece, and is
      // longer wherever the piece has bars left after the four-bar floor. At
      // thirty-two bars it has none: eight sections of four bars is the whole
      // budget, and the floor outranks the weighting by design.
      expect(Math.min(...of("chorus")), `${bars}`)
        .toBeGreaterThanOrEqual(Math.max(...of("intro")));
      expect(Math.min(...of("verse")), `${bars}`)
        .toBeGreaterThanOrEqual(Math.max(...of("preChorus")));
      if (bars > 4 * sections.length) {
        expect(Math.min(...of("chorus")), `${bars}`).toBeGreaterThan(Math.max(...of("intro")));
      }
      // And two choruses are the same length as each other, or the second is
      // not a repeat of the first.
      expect(new Set(of("chorus")).size, `${bars}`).toBe(1);
      expect(new Set(of("verse")).size, `${bars}`).toBe(1);
    }
  });

  it("drops to fewer sections rather than write a three-bar pre-chorus", () => {
    // The trade the length rule makes, stated where it is paid. Twenty-four
    // bars can hold eight sections only by making each of them three bars, so
    // it holds four instead and every one of them clears the floor.
    const sections = planSections({
      key: "C", mode: "major", bars: 24, seed: "f", form: "verseChorus",
    })!;
    expect(sections.map((section) => section.kind)).toEqual([
      "verse", "preChorus", "chorus", "chorus",
    ]);
    expect(sections.map((section) => section.endBar - section.startBar)).toEqual([7, 5, 6, 6]);
  });

  it("leaves AABA as four sections, which is what AABA is", () => {
    for (const bars of BAR_COUNTS) {
      const sections = planSections({ key: "C", mode: "major", bars, seed: "a", form: "aaba" })!;
      expect(sections.map((section) => section.kind), `${bars}`).toEqual([
        "verse", "verse", "bridge", "verse",
      ]);
    }
  });

  it("weights the shorter lengths it already had layouts for", () => {
    // 4, 8 and 16 have their own table entries, so the fallback never runs --
    // but the bars inside them are still shared out by role rather than split
    // evenly.
    //
    // Sixteen bars used to take the eight-section entry and produce intro:1
    // verse:3 preChorus:1 chorus:3 verse:3 preChorus:1 chorus:3 outro:1. A
    // one-bar pre-chorus is not a pre-chorus, and three of the eight were one
    // bar: that is a division of the bar count, not a form. It takes the
    // four-section entry now, where every section is a four-bar period.
    expect(
      planSections({ key: "C", mode: "major", bars: 16, seed: "s", form: "verseChorus" })!
        .map((section) => `${section.kind}:${section.endBar - section.startBar}`),
    ).toEqual(["verse:4", "preChorus:4", "chorus:4", "chorus:4"]);
    // Eight bars is two periods, so it is two sections: a verse and a chorus.
    // Four sections of two bars each is what it gave before, and a two-bar
    // verse is a phrase fragment rather than a verse.
    expect(
      planSections({ key: "C", mode: "major", bars: 8, seed: "s", form: "verseChorus" })!
        .map((section) => `${section.kind}:${section.endBar - section.startBar}`),
    ).toEqual(["verse:4", "chorus:4"]);
  });

  it("stays valid with a form, a lift and the theory settings on", () => {
    // Ornaments and a groove together already produce a one-tick overlap at
    // every length including 8 and 16, so that pair is left out here rather
    // than folded into a bar-count test that would then be testing two things.
    for (const bars of LONG_COUNTS) {
      const composition = generateComposition(
        settings({
          bars,
          seed: `all-${bars}`,
          songForm: { form: "verseChorus", finalLift: 2 },
          harmonicRhythm: { changesPerBar: 2 },
          phraseGrammar: { enabled: true },
          melodicSkeleton: { enabled: true },
          voiceLeading: { enabled: true },
          nonChordTones: { enabled: true, rate: 1 },
        }),
      );
      expect(validateComposition(composition).errors, `${bars}`).toEqual([]);
    }
  });

  it("is no more fragile at the longer lengths than at the ones that shipped", () => {
    // The bar count must not be what breaks a setting combination. Whatever the
    // engine does at 8 and 16 bars, it must do at 24, 32 and 48.
    const combination = {
      songForm: { form: "verseChorus" as const },
      harmonicRhythm: { changesPerBar: 2 },
      phraseGrammar: { enabled: true },
      melodicSkeleton: { enabled: true },
      voiceLeading: { enabled: true },
      groove: { enabled: true, template: "swing8" as const },
    };
    const invalidRate = (bars: BarCount) => {
      let invalid = 0;
      for (const seed of Array.from({ length: 8 }, (_, index) => `f${index}`)) {
        const composition = generateComposition(settings({ bars, seed, ...combination }));
        if (validateComposition(composition).errors.length > 0) invalid += 1;
      }
      return invalid;
    };
    const shipped = Math.max(invalidRate(8), invalidRate(16));
    for (const bars of LONG_COUNTS) {
      expect(invalidRate(bars), `${bars}`).toBeLessThanOrEqual(shipped);
    }
  });
});

describe("saving and exporting a longer piece", () => {
  it("round-trips through the project file", () => {
    for (const bars of LONG_COUNTS) {
      const composition = generateComposition(settings({ bars, seed: `j${bars}` }));
      const restored = importCompositionJson(exportCompositionJson(composition));
      expect(restored, `${bars}`).toEqual(composition);
    }
  });

  it("rejects a bar count that is not offered", () => {
    const composition = generateComposition(settings({ bars: 48, seed: "r" }));
    const document = JSON.parse(exportCompositionJson(composition));
    document.composition.settings.bars = 40;
    expect(() => importCompositionJson(JSON.stringify(document))).toThrow();
  });

  it("exports every bar to MIDI", () => {
    for (const bars of LONG_COUNTS) {
      const composition = generateComposition(settings({ bars, seed: `m${bars}` }));
      const bytes = exportCompositionMidi(composition);
      expect(bytes.length, `${bars}`).toBeGreaterThan(0);
    }
    // A longer piece is a longer file; nothing is being silently truncated.
    const short = exportCompositionMidi(generateComposition(settings({ bars: 16, seed: "m" })));
    const long = exportCompositionMidi(generateComposition(settings({ bars: 48, seed: "m" })));
    expect(long.length).toBeGreaterThan(short.length);
  });
});
