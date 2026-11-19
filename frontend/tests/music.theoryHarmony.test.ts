import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS } from "../src/music/generator";
import type { GeneratorSettings, JazzSettings } from "../src/types/music";
import { getProgressionTemplate } from "../src/music/progressions";
import { ticksPerBar } from "../src/music/time";
import { planTheoryHarmony } from "../src/music/theoryHarmony";

function input(
  jazz: Partial<JazzSettings> = {},
  settings: Partial<GeneratorSettings> = {},
) {
  const jazzSettings: JazzSettings = {
    version: 1,
    style: "swing",
    form: "aaba",
    chromaticism: 0.4,
    interaction: 0.5,
    ...jazz,
  };
  const generatorSettings: GeneratorSettings = {
    ...DEFAULT_GENERATOR_SETTINGS,
    style: "jazz",
    bars: 16,
    seed: "theory-harmony-test",
    ...settings,
  };
  return { settings: generatorSettings, jazz: jazzSettings, ppq: 480 };
}

function degrees(result: ReturnType<typeof planTheoryHarmony>): number[] {
  return result.chords.map((chord) => chord.degree);
}

function expectCompleteBarGrid(
  result: ReturnType<typeof planTheoryHarmony>,
  settings: GeneratorSettings,
  ppq = 480,
): void {
  const barTicks = ticksPerBar(settings.timeSignature, ppq);
  expect(result.chords).toHaveLength(settings.bars);
  result.chords.forEach((chord, index) => {
    expect(chord.startTick).toBe(index * barTicks);
    expect(chord.durationTick).toBe(barTicks);
    expect(chord.notes.length).toBeGreaterThanOrEqual(3);
    expect(chord.notes).toEqual([...chord.notes].sort((left, right) => left - right));
  });
  expect(result.sections[0]?.startBar).toBe(0);
  expect(result.sections.at(-1)?.endBar).toBe(settings.bars);
  expect(result.resolvedStyle).toBe("jazz");
}

describe("theory-first jazz harmony planner", () => {
  it("is deterministic and emits complete, ordered chord and section spans", () => {
    const options = input({ style: "swing", form: "aaba" });
    const first = planTheoryHarmony(options);
    const second = planTheoryHarmony(options);
    expect(first).toEqual(second);
    expectCompleteBarGrid(first, options.settings);
    expect(first.sections.map(({ kind }) => kind)).toEqual(["verse", "verse", "bridge", "finalChorus"]);
    expect(first.sections.map(({ startBar, endBar }) => [startBar, endBar])).toEqual([[0, 4], [4, 8], [8, 12], [12, 16]]);
  });

  it("chooses varied but functional paths across style policies instead of one shared loop", () => {
    const styles: JazzSettings["style"][] = ["swing", "ballad", "bebop", "modern", "neoSoul"];
    const paths = styles.map((style) => degrees(planTheoryHarmony(input({ style, form: "free" }))));
    expect(new Set(paths.map((path) => path.join("-"))).size).toBeGreaterThanOrEqual(4);
    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index] as number[];
      expect(path).toHaveLength(16);
      expect(path.some((degree, index) => degree !== path[index - 1])).toBe(true);
      expect(path.slice(-2)).toEqual(index <= 2 ? [5, 1] : [4, 1]);
    }

  });

  it("preserves the 12-bar blues skeleton and calls the final V a turnaround loop", () => {
    const options = input({ style: "swing", form: "blues" }, { bars: 12 });
    const result = planTheoryHarmony(options);
    expect(degrees(result)).toEqual([1, 1, 1, 1, 4, 4, 1, 1, 5, 4, 1, 5]);
    expect(result.chords.every((chord) => chord.quality === "dominant7")).toBe(true);
    expect(result.cadence).toBe("loop");
    expect(result.sections).toHaveLength(1);
    expectCompleteBarGrid(result, options.settings);
  });

  it("honors every explicit progression step while retaining truthful applied-dominant claims", () => {
    const template = getProgressionTemplate("secondary-dominant-145");
    expect(template).toBeDefined();
    const options = input({ style: "bebop", form: "aaba" }, {
      bars: 12,
      progressionId: "secondary-dominant-145",
    });
    const result = planTheoryHarmony(options);
    const expected = Array.from({ length: options.settings.bars }, (_, index) => template?.steps[index % (template?.steps.length ?? 1)]);
    expect(result.chords.map((chord) => chord.degree)).toEqual(expected.map((step) => step?.degree));
    expected.forEach((step, index) => {
      if (step?.quality !== undefined) expect(result.chords[index]?.quality).toBe(step.quality);
      if (step?.tensions !== undefined) expect(result.chords[index]?.tensions).toEqual(step.tensions);
    });
    for (const chord of result.chords) {
      if (chord.specialKind === "secondaryDominant") {
        const index = Number(chord.id.match(/-(\d+)-/)?.[1]);
        const next = result.chords[index + 1];
        expect(next?.degree).toBe(chord.targetDegree);
      }
    }
  });

  it("supports minor iiø–V7–i and reports an authentic cadence only when it lands", () => {
    const options = input({ style: "bebop", form: "free" }, {
      mode: "naturalMinor",
      bars: 12,
      progressionId: "ii-V-i-minor",
    });
    const result = planTheoryHarmony(options);
    expect(degrees(result).slice(0, 3)).toEqual([2, 5, 1]);
    expect(result.chords.slice(0, 3).map((chord) => chord.quality)).toEqual(["halfDiminished7", "dominant7", "minor7"]);
    expect(degrees(result).slice(-2)).toEqual([5, 1]);
    expect(result.cadence).toBe("authentic");
    expectCompleteBarGrid(result, options.settings);
  });

  it("voices an authored harmonic-minor tonic with its raised seventh", () => {
    const options = input({ style: "swing", form: "free" }, {
      mode: "harmonicMinor",
      bars: 4,
    });
    const result = planTheoryHarmony(options);
    expect(result.cadence).toBe("authentic");
    expect(result.chords.at(-1)?.degree).toBe(1);
    expect(result.chords.at(-1)?.quality).toBe("minorMajor7");
  });

  it("adapts event timing to 6/8 and uses the planned modal loop ending", () => {
    const options = input({ style: "modern", form: "modal" }, {
      bars: 8,
      timeSignature: "6/8",
      mode: "dorian",
    });
    const result = planTheoryHarmony(options);
    expect(ticksPerBar(options.settings.timeSignature, options.ppq)).toBe(1440);
    expectCompleteBarGrid(result, options.settings, options.ppq);
    expect(degrees(result).slice(-2)).toEqual([4, 5]);
    expect(result.cadence).toBe("loop");
  });

  it("reports the actual final cadence for generated endings", () => {
    const authentic = planTheoryHarmony(input({ style: "swing", form: "free" }, { bars: 4 }));
    expect(authentic.cadence).toBe("authentic");
    expect(degrees(authentic).slice(-2)).toEqual([5, 1]);

    const plagal = planTheoryHarmony(input({ style: "modern", form: "free" }, { bars: 4 }));
    expect(plagal.cadence).toBe("plagal");
    expect(degrees(plagal).slice(-2)).toEqual([4, 1]);
  });
});
