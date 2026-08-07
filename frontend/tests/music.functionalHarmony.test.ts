import { describe, expect, it } from "vitest";
import {
  MINIMAL_GENERATOR_SETTINGS,
  assignChordsToPath,
  generateComposition,
  nextFunctionsFor,
  planFunctionalPath,
  tensionOf,
  transitionCost,
  validateComposition,
} from "../src/music";
import type { FunctionalHarmonyState } from "../src/music";
import type { CadenceType, GeneratorSettings } from "../src/types/music";

const CADENCES = ["authentic", "plagal", "half", "deceptive", "loop"] satisfies CadenceType[];

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...MINIMAL_GENERATOR_SETTINGS,
    ...patch,
    melody: { ...MINIMAL_GENERATOR_SETTINGS.melody, ...patch.melody },
  };
}

function path(length: number, cadence: CadenceType = "authentic", seed = "f") {
  return planFunctionalPath({ length, cadence, seed });
}

describe("the function transition model", () => {
  it("makes a dominant resolve more cheaply than it retreats", () => {
    const resolve = transitionCost("dominant", "resolution")!;
    const retreat = transitionCost("dominant", "predominant")!;
    expect(resolve).toBeLessThan(retreat);
  });

  it("makes a preparation reach its dominant more cheaply than anything else", () => {
    const toDominant = transitionCost("dominantPreparation", "dominant")!;
    for (const other of nextFunctionsFor("dominantPreparation")) {
      if (other === "dominant") continue;
      expect(toDominant).toBeLessThan(transitionCost("dominantPreparation", other)!);
    }
  });

  it("orders tension the way functional harmony does", () => {
    expect(tensionOf("tonic")).toBeLessThan(tensionOf("predominant"));
    expect(tensionOf("predominant")).toBeLessThan(tensionOf("dominantPreparation"));
    expect(tensionOf("dominantPreparation")).toBeLessThan(tensionOf("dominant"));
    // Resolution releases what the dominant built.
    expect(tensionOf("resolution")).toBeLessThan(tensionOf("dominant"));
  });

  it("reports reachable successors cheapest first", () => {
    const next = nextFunctionsFor("dominant");
    expect(next[0]).toBe("resolution");
  });
});

describe("path planning", () => {
  it.each(CADENCES)("ends on the states %s requires", (cadence) => {
    const planned = path(8, cadence);
    const expectedTail: Record<CadenceType, FunctionalHarmonyState[]> = {
      authentic: ["dominant", "resolution"],
      deceptive: ["dominant", "resolution"],
      half: ["predominant", "dominant"],
      plagal: ["predominant", "resolution"],
      loop: ["tonicProlongation", "tonic"],
    };
    expect(planned.slice(-2)).toEqual(expectedTail[cadence]);
  });

  it("produces exactly the requested number of states", () => {
    for (const length of [1, 2, 3, 4, 6, 8, 12, 16, 32]) {
      expect(path(length)).toHaveLength(length);
    }
  });

  it("only uses transitions the model allows", () => {
    for (const cadence of CADENCES) {
      const planned = path(16, cadence);
      for (let index = 1; index < planned.length; index += 1) {
        const from = planned[index - 1]!;
        const to = planned[index]!;
        expect(
          transitionCost(from, to),
          `${from} → ${to} is not a legal move`,
        ).not.toBeNull();
      }
    }
  });

  it("starts on the tonic unless told otherwise", () => {
    expect(path(8)[0]).toBe("tonic");
    expect(
      planFunctionalPath({ length: 8, cadence: "authentic", seed: "f", startState: "modal" })[0],
    ).toBe("modal");
  });

  it("raises tension across the span rather than idling", () => {
    const planned = path(8);
    const firstHalf = planned.slice(0, 4).reduce((sum, s) => sum + tensionOf(s), 0) / 4;
    const secondHalf = planned.slice(4).reduce((sum, s) => sum + tensionOf(s), 0) / 4;
    expect(secondHalf).toBeGreaterThan(firstHalf);
  });

  it("handles spans shorter than the cadence itself", () => {
    expect(path(1, "authentic")).toEqual(["resolution"]);
    expect(path(2, "authentic")).toEqual(["dominant", "resolution"]);
  });

  it("is deterministic, and exploration changes the route", () => {
    expect(path(16)).toEqual(path(16));
    const plain = planFunctionalPath({ length: 16, cadence: "authentic", seed: "x" });
    const wandering = planFunctionalPath({
      length: 16, cadence: "authentic", seed: "x", exploration: 1,
    });
    expect(wandering).toHaveLength(plain.length);
    expect(wandering).not.toEqual(plain);
  });
});

describe("assigning chords to a path", () => {
  it("gives every function a degree in range", () => {
    const assigned = assignChordsToPath(path(8), "major", "s");
    expect(assigned).toHaveLength(8);
    for (const candidate of assigned) {
      expect(candidate.step.degree).toBeGreaterThanOrEqual(1);
      expect(candidate.step.degree).toBeLessThanOrEqual(7);
    }
  });

  it("puts the tonic under a resolution and the dominant under a dominant", () => {
    const planned: FunctionalHarmonyState[] = ["tonic", "predominant", "dominant", "resolution"];
    const assigned = assignChordsToPath(planned, "major", "s");
    expect(assigned[2]!.step.degree).toBe(5);
    expect(assigned[3]!.step.degree).toBe(1);
    // Predominants are the subdominant family.
    expect([2, 4, 6]).toContain(assigned[1]!.step.degree);
  });

  it("makes a major dominant a seventh, so it carries a leading tone", () => {
    const assigned = assignChordsToPath(["tonic", "dominant", "resolution"], "major", "s");
    expect(assigned[1]!.step.quality).toBe("dominant7");
  });

  it("avoids restating the same chord through a prolongation", () => {
    const assigned = assignChordsToPath(
      ["tonic", "tonicProlongation", "tonicProlongation"],
      "major",
      "s",
    );
    const degrees = assigned.map((candidate) => candidate.step.degree);
    expect(new Set(degrees).size).toBeGreaterThan(1);
  });

  it("reports the cost and tension of each step", () => {
    const assigned = assignChordsToPath(path(8), "major", "s");
    expect(assigned[0]!.transitionCost).toBe(0);
    for (const candidate of assigned.slice(1)) {
      expect(candidate.transitionCost).toBeGreaterThan(0);
      expect(candidate.tensionLevel).toBe(tensionOf(candidate.function));
      expect(candidate.expectedNextFunctions.length).toBeGreaterThan(0);
    }
  });
});

describe("functional harmony in generated compositions", () => {
  it("produces a valid composition at every bar count and mode", () => {
    for (const bars of [4, 8, 16] as const) {
      for (const mode of ["major", "naturalMinor", "dorian", "mixolydian"] as const) {
        const composition = generateComposition(
          settings({ bars, mode, seed: `f-${bars}-${mode}`, functionalHarmony: { enabled: true } }),
        );
        expect(
          validateComposition(composition).errors,
          `${mode}/${bars}`,
        ).toEqual([]);
        expect(composition.chords).toHaveLength(bars);
      }
    }
  });

  it("changes the progression it produces", () => {
    const plain = generateComposition(settings({ bars: 8, seed: "fh" }));
    const functional = generateComposition(
      settings({ bars: 8, seed: "fh", functionalHarmony: { enabled: true } }),
    );
    expect(functional.chords.map((c) => c.symbol)).not.toEqual(
      plain.chords.map((c) => c.symbol),
    );
  });

  it("composes with harmonic rhythm and the phrase grammar", () => {
    const composition = generateComposition(
      settings({
        bars: 8,
        seed: "all",
        functionalHarmony: { enabled: true },
        harmonicRhythm: { changesPerBar: 2, cadentialAcceleration: true },
        phraseGrammar: { enabled: true },
      }),
    );
    expect(validateComposition(composition).errors).toEqual([]);
    // 6 whole bars of two chords, then two accelerated bars of four.
    expect(composition.chords).toHaveLength(6 * 2 + 2 * 4);
  });

  it("is deterministic", () => {
    const make = () =>
      generateComposition(settings({ bars: 8, seed: "fixed", functionalHarmony: { enabled: true } }));
    expect(make()).toEqual(make());
  });

  it("distinguishes pieces that differ only by the setting", () => {
    const plain = generateComposition(settings({ seed: "same" }));
    const functional = generateComposition(
      settings({ seed: "same", functionalHarmony: { enabled: true } }),
    );
    expect(functional.id).not.toBe(plain.id);
  });
});
