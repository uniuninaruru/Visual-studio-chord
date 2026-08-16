import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  analyzeTensionCurve,
  energyAtBar,
  generateComposition,
  planSectionEnergy,
  planSections,
  summarizeTension,
} from "../src/music";
import type { ChordEvent, GeneratorSettings } from "../src/types/music";

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...DEFAULT_GENERATOR_SETTINGS,
    ...patch,
    melody: { ...DEFAULT_GENERATOR_SETTINGS.melody, ...patch.melody },
  };
}

function curveOf(composition: ReturnType<typeof generateComposition>) {
  return analyzeTensionCurve({
    chords: composition.chords,
    notes: composition.notes,
    ticksPerBar: composition.ticksPerBar,
    bars: composition.settings.bars,
    melodyRange: [
      composition.settings.melody.minMidi,
      composition.settings.melody.maxMidi,
    ],
  });
}

describe("tension analysis", () => {
  it("returns one point per bar, in order", () => {
    const composition = generateComposition(settings({ bars: 8, seed: "t" }));
    const curve = curveOf(composition);
    expect(curve).toHaveLength(8);
    curve.forEach((point, index) => {
      expect(point.barIndex).toBe(index);
      expect(point.tick).toBe(index * composition.ticksPerBar);
    });
  });

  it("keeps every dimension inside 0..1", () => {
    const composition = generateComposition(
      settings({ bars: 16, seed: "t", harmony: { complexity: "advanced" } }),
    );
    for (const point of curveOf(composition)) {
      for (const value of [
        point.harmonicTension,
        point.melodicTension,
        point.rhythmicTension,
        point.totalTension,
      ]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("rates a dominant bar more tense than a tonic bar", () => {
    const base = generateComposition(settings({ bars: 4, seed: "t" }));
    const ticksPerBar = base.ticksPerBar;
    const chordAt = (barIndex: number, degree: number) => ({
      ...base.chords[0]!,
      id: `c${barIndex}`,
      degree,
      startTick: barIndex * ticksPerBar,
      durationTick: ticksPerBar,
    });
    const curve = analyzeTensionCurve({
      chords: [chordAt(0, 1), chordAt(1, 5)],
      notes: [],
      ticksPerBar,
      bars: 2,
      melodyRange: [60, 84],
    });
    expect(curve[1]!.harmonicTension).toBeGreaterThan(curve[0]!.harmonicTension);
  });

  it("rates a non-diatonic chord above the same degree taken plainly", () => {
    const base = generateComposition(settings({ bars: 4, seed: "t" }));
    const plain: ChordEvent = { ...base.chords[0]!, degree: 4, source: "diatonic" };
    const borrowed: ChordEvent = { ...plain, source: "borrowed" };
    const of = (chord: ChordEvent) =>
      analyzeTensionCurve({
        chords: [{ ...chord, startTick: 0, durationTick: base.ticksPerBar }],
        notes: [],
        ticksPerBar: base.ticksPerBar,
        bars: 1,
        melodyRange: [60, 84],
      })[0]!.harmonicTension;
    expect(of(borrowed)).toBeGreaterThan(of(plain));
  });

  it("rates a higher melody as more tense than a lower one", () => {
    const base = generateComposition(settings({ bars: 4, seed: "t" }));
    const noteAt = (midi: number) => ({
      ...base.notes[0]!,
      id: `n${midi}`,
      midi,
      barIndex: 0,
      startTick: 0,
    });
    const of = (midi: number) =>
      analyzeTensionCurve({
        chords: [],
        notes: [noteAt(midi)],
        ticksPerBar: base.ticksPerBar,
        bars: 1,
        melodyRange: [60, 84],
      })[0]!.melodicTension;
    expect(of(82)).toBeGreaterThan(of(61));
  });

  it("reports zero for a bar with nothing in it", () => {
    const curve = analyzeTensionCurve({
      chords: [], notes: [], ticksPerBar: 1920, bars: 1, melodyRange: [60, 84],
    });
    expect(curve[0]!.totalTension).toBe(0);
  });
});

describe("summarising a curve", () => {
  it("finds the most tense bar", () => {
    const composition = generateComposition(settings({ bars: 16, seed: "t" }));
    const curve = curveOf(composition);
    const summary = summarizeTension(curve)!;
    const maximum = Math.max(...curve.map((point) => point.totalTension));
    expect(summary.peakTension).toBe(maximum);
    expect(curve[summary.peakBar]!.totalTension).toBe(maximum);
  });

  it("reports the average and the direction of the build", () => {
    const rising = [0.1, 0.2, 0.6, 0.8].map((totalTension, barIndex) => ({
      tick: barIndex * 1920,
      barIndex,
      harmonicTension: totalTension,
      melodicTension: totalTension,
      rhythmicTension: totalTension,
      totalTension,
    }));
    const summary = summarizeTension(rising)!;
    expect(summary.averageTension).toBeCloseTo(0.425, 5);
    expect(summary.buildDirection).toBeGreaterThan(0);
    expect(summarizeTension([...rising].reverse())!.buildDirection).toBeLessThan(0);
  });

  it("returns nothing for an empty curve", () => {
    expect(summarizeTension([])).toBeNull();
  });
});

describe("section energy planning", () => {
  it("plans one entry per section, in order", () => {
    const sections = planSections({
      key: "C", mode: "major", bars: 16, seed: "e", form: "verseChorus",
    })!;
    const plans = planSectionEnergy(sections);
    expect(plans).toHaveLength(sections.length);
    plans.forEach((plan, index) => {
      expect(plan.sectionId).toBe(sections[index]!.id);
      expect(plan.kind).toBe(sections[index]!.kind);
    });
  });

  it("puts the chorus above the verse and the intro below it", () => {
    // Thirty-two bars rather than sixteen, because sixteen no longer has an
    // intro to be below anything: eight sections of a sixteen-bar piece are two
    // bars each, so that length takes the four-section layout, which starts on
    // the verse.
    const sections = planSections({
      key: "C", mode: "major", bars: 32, seed: "e", form: "verseChorus",
    })!;
    const plans = planSectionEnergy(sections);
    const peakOf = (kind: string) =>
      plans.find((plan) => plan.kind === kind)!.peakEnergy;
    expect(peakOf("chorus")).toBeGreaterThan(peakOf("verse"));
    expect(peakOf("verse")).toBeGreaterThan(peakOf("intro"));
    // The pre-chorus hands over high, without resolving.
    expect(peakOf("preChorus")).toBeGreaterThan(peakOf("verse"));
  });

  it("lifts a returning section above its first appearance", () => {
    const sections = planSections({
      key: "C", mode: "major", bars: 16, seed: "e", form: "verseChorus",
    })!;
    const plans = planSectionEnergy(sections);
    const choruses = plans.filter((plan) => plan.kind === "chorus");
    expect(choruses.length).toBeGreaterThan(1);
    expect(choruses[1]!.peakEnergy).toBeGreaterThan(choruses[0]!.peakEnergy);
  });

  it("keeps every planned value inside 0..1", () => {
    for (const form of ["verseChorus", "aaba", "throughComposed"] as const) {
      const sections = planSections({
        key: "C", mode: "major", bars: 16, seed: "e", form,
      })!;
      for (const plan of planSectionEnergy(sections)) {
        for (const value of [plan.startEnergy, plan.peakEnergy, plan.endEnergy]) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("interpolates across a section, peaking in the middle", () => {
    // A hand-built four-bar section, so the curve has room to rise and fall.
    // Real sections are often two bars, where the midpoint is already past the
    // peak and the shape is not observable.
    const sections = [{
      id: "s", kind: "chorus" as const, startBar: 0, endBar: 4,
      key: "C" as const, mode: "major" as const, transpose: 0,
    }];
    const plans = planSectionEnergy(sections);
    const at = (bar: number) => energyAtBar(sections, plans, bar)!;
    expect(at(0)).toBeCloseTo(plans[0]!.startEnergy, 5);
    expect(at(3)).toBeCloseTo(plans[0]!.endEnergy, 5);
    // Rises from the start toward the peak before settling.
    expect(at(1)).toBeGreaterThan(at(0));
    expect(at(1)).toBeGreaterThan(at(3));
  });

  it("holds a one-bar section at its starting energy", () => {
    const sections = [{
      id: "s", kind: "verse" as const, startBar: 0, endBar: 1,
      key: "C" as const, mode: "major" as const, transpose: 0,
    }];
    const plans = planSectionEnergy(sections);
    expect(energyAtBar(sections, plans, 0)).toBeCloseTo(plans[0]!.startEnergy, 5);
  });

  it("reports nothing for a bar outside every section", () => {
    const sections = planSections({
      key: "C", mode: "major", bars: 8, seed: "e", form: "aaba",
    })!;
    expect(energyAtBar(sections, planSectionEnergy(sections), 99)).toBeNull();
  });
});
