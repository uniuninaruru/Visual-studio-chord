import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
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
    ...DEFAULT_GENERATOR_SETTINGS,
    ...patch,
    melody: { ...DEFAULT_GENERATOR_SETTINGS.melody, ...patch.melody },
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
    for (const bars of LONG_COUNTS) {
      const sections = planSections({
        key: "C", mode: "major", bars, seed: "f", form: "verseChorus",
      })!;
      expect(sections.map((section) => section.kind), `${bars}`).toEqual([
        "intro", "verse", "preChorus", "chorus",
        "verse", "preChorus", "chorus", "outro",
      ]);
      // Evenly divided, because each of these lengths is a multiple of eight.
      const lengths = sections.map((section) => section.endBar - section.startBar);
      expect(new Set(lengths).size, `${bars}`).toBe(1);
      expect(lengths[0]! * 8, `${bars}`).toBe(bars);
    }
  });

  it("leaves AABA as four sections, which is what AABA is", () => {
    for (const bars of BAR_COUNTS) {
      const sections = planSections({ key: "C", mode: "major", bars, seed: "a", form: "aaba" })!;
      expect(sections.map((section) => section.kind), `${bars}`).toEqual([
        "verse", "verse", "bridge", "verse",
      ]);
    }
  });

  it("does not change the shorter lengths it already had layouts for", () => {
    // 4, 8 and 16 have their own table entries, so the fallback never runs.
    expect(
      planSections({ key: "C", mode: "major", bars: 16, seed: "s", form: "verseChorus" })!
        .map((section) => `${section.kind}:${section.endBar - section.startBar}`),
    ).toEqual([
      "intro:2", "verse:2", "preChorus:2", "chorus:2",
      "verse:2", "preChorus:2", "chorus:2", "outro:2",
    ]);
    expect(
      planSections({ key: "C", mode: "major", bars: 8, seed: "s", form: "verseChorus" })!
        .map((section) => section.kind),
    ).toEqual(["verse", "preChorus", "chorus", "chorus"]);
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
