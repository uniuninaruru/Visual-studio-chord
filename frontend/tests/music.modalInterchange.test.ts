import { describe, expect, it } from "vitest";
import {
  PARALLEL_SCALES,
  PARALLEL_SCALE_NAMES,
  borrowedRomanNumeral,
  borrowingsForDegree,
  findModalBorrowings,
  getDiatonicChordDefinition,
  getDiatonicSeventhChordDefinition,
} from "../src/music";
import type { Mode, PitchClassName, StylePresetId } from "../src/types/music";

const numerals = (
  key: PitchClassName,
  mode: Mode,
  options?: Parameters<typeof findModalBorrowings>[2],
) => findModalBorrowings(key, mode, options).map((chord) => chord.romanNumeral);

describe("the parallel scales", () => {
  it("are all seven-note scales spanning an octave", () => {
    for (const name of PARALLEL_SCALE_NAMES) {
      const scale = PARALLEL_SCALES[name];
      expect(scale, name).toHaveLength(7);
      expect(scale[0], name).toBe(0);
      expect(Math.max(...scale), name).toBeLessThan(12);
      expect([...scale].sort((a, b) => a - b), name).toEqual([...scale]);
    }
  });
});

describe("writing a borrowed numeral", () => {
  it("cases the numeral by quality and keeps the accidental", () => {
    expect(borrowedRomanNumeral(5, "minor")).toBe("iv");
    expect(borrowedRomanNumeral(8, "major")).toBe("bVI");
    expect(borrowedRomanNumeral(10, "major")).toBe("bVII");
    expect(borrowedRomanNumeral(1, "major")).toBe("bII");
    expect(borrowedRomanNumeral(3, "minor")).toBe("biii");
    expect(borrowedRomanNumeral(2, "halfDiminished7")).toBe("iiø7");
    expect(borrowedRomanNumeral(0, "dominant7")).toBe("I7");
    expect(borrowedRomanNumeral(11, "diminished7")).toBe("vii°7");
  });

  it("wraps an offset outside an octave", () => {
    expect(borrowedRomanNumeral(12, "major")).toBe("I");
    expect(borrowedRomanNumeral(-1, "major")).toBe("VII");
  });
});

describe("finding what a key can borrow", () => {
  it("reaches the borrowings a single parallel mode never could", () => {
    const found = numerals("C", "major");
    // These come from four different parallel scales; one declared parallel
    // supplies at most a couple of them.
    for (const numeral of ["iv", "bVI", "bVII", "bIII", "bII", "iiø7", "I7"]) {
      expect(found, numeral).toContain(numeral);
    }
  });

  it("draws on more than one scale to do it", () => {
    const sources = new Set(
      findModalBorrowings("C", "major")
        .filter((chord) => ["iv", "bVI", "bVII", "bII", "iiø7", "I7"].includes(chord.romanNumeral))
        .map((chord) => chord.sourceScale),
    );
    expect(sources.size).toBeGreaterThan(2);
  });

  it("never offers a chord the key already has", () => {
    for (const mode of ["major", "naturalMinor", "dorian", "mixolydian"] as const) {
      const native = new Set<string>();
      for (let degree = 1; degree <= 7; degree += 1) {
        for (const definition of [
          getDiatonicChordDefinition("C", mode, degree),
          // Sevenths too: Fmaj7 is diatonic to C major, and offering it as a
          // borrowing would put half the home key into the vocabulary.
          getDiatonicSeventhChordDefinition("C", mode, degree),
        ]) {
          native.add(`${definition.root}:${definition.quality}`);
        }
      }
      for (const chord of findModalBorrowings("C", mode)) {
        expect(native.has(`${chord.root}:${chord.quality}`), `${mode} ${chord.symbol}`).toBe(false);
      }
    }
  });

  it("never draws on the key's own scale", () => {
    for (const [mode, home] of [
      ["major", "ionian"],
      ["naturalMinor", "aeolian"],
      ["dorian", "dorian"],
      ["mixolydian", "mixolydian"],
    ] as const) {
      for (const chord of findModalBorrowings("C", mode)) {
        expect(chord.sourceScale, mode).not.toBe(home);
      }
    }
  });

  it("offers each root-and-quality once, however many scales have it", () => {
    const seen = findModalBorrowings("C", "major").map(
      (chord) => `${chord.root}:${chord.quality}`,
    );
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("follows the key it is asked about", () => {
    const inC = findModalBorrowings("C", "major").find((c) => c.romanNumeral === "iv")!;
    const inG = findModalBorrowings("G", "major").find((c) => c.romanNumeral === "iv")!;
    expect(inC.root).toBe("F");
    expect(inG.root).toBe("C");
    expect(inC.rootOffset).toBe(inG.rootOffset);
  });

  it("can be restricted to particular scales, or to triads", () => {
    const phrygianOnly = findModalBorrowings("C", "major", { scales: ["phrygian"] });
    expect(phrygianOnly.length).toBeGreaterThan(0);
    expect(new Set(phrygianOnly.map((c) => c.sourceScale))).toEqual(new Set(["phrygian"]));
    expect(phrygianOnly.map((c) => c.romanNumeral)).toContain("bII");

    const triads = findModalBorrowings("C", "major", { sevenths: false });
    expect(triads.every((chord) => !chord.seventh)).toBe(true);
    expect(triads.length).toBeLessThan(findModalBorrowings("C", "major").length);
  });

  it("drops everything below a weight floor", () => {
    const strong = findModalBorrowings("C", "major", { minimumWeight: 0.6 });
    expect(strong.length).toBeGreaterThan(0);
    expect(strong.every((chord) => chord.weight >= 0.6)).toBe(true);
    expect(findModalBorrowings("C", "major", { minimumWeight: 2 })).toEqual([]);
  });

  it("is deterministic and ordered by weight", () => {
    const found = findModalBorrowings("C", "major", { style: "pop" });
    for (let index = 1; index < found.length; index += 1) {
      expect(found[index - 1]!.weight).toBeGreaterThanOrEqual(found[index]!.weight);
    }
    expect(found).toEqual(findModalBorrowings("C", "major", { style: "pop" }));
  });
});

describe("weighting by style", () => {
  const topOf = (style: StylePresetId) => numerals("C", "major", { style })[0];

  it("puts each style's signature borrowing first", () => {
    // The minor subdominant is the pop and ballad borrowing; rock reaches for
    // the flat seventh; jazz for the half-diminished ii.
    expect(topOf("pop")).toBe("iv");
    expect(topOf("ballad")).toBe("iv");
    expect(topOf("rock")).toBe("bVII");
    expect(topOf("jazz")).toBe("iiø7");
  });

  it("ranks the same chord differently in different styles", () => {
    const weightOf = (style: StylePresetId, numeral: string) =>
      findModalBorrowings("C", "major", { style }).find(
        (chord) => chord.romanNumeral === numeral,
      )!.weight;
    expect(weightOf("rock", "bVII")).toBeGreaterThan(weightOf("jazz", "bVII"));
    expect(weightOf("jazz", "iiø7")).toBeGreaterThan(weightOf("rock", "iiø7"));
    expect(weightOf("jazz", "I7")).toBeGreaterThan(weightOf("pop", "I7"));
  });

  it("still offers the unnamed borrowings, at a base weight", () => {
    const all = findModalBorrowings("C", "major", { style: "pop" });
    const unnamed = all.filter((chord) => chord.weight < 0.4);
    expect(unnamed.length).toBeGreaterThan(0);
    expect(unnamed.every((chord) => chord.weight > 0)).toBe(true);
  });
});

describe("borrowings for a particular degree", () => {
  it("finds the minor subdominant for IV", () => {
    expect(borrowingsForDegree("C", "major", 4).map((c) => c.romanNumeral)).toContain("iv");
  });

  it("finds the flattened degree for VI, III, VII and II", () => {
    for (const [degree, numeral] of [[6, "bVI"], [3, "bIII"], [7, "bVII"], [2, "bII"]] as const) {
      expect(
        borrowingsForDegree("C", "major", degree).map((c) => c.romanNumeral),
        `degree ${degree}`,
      ).toContain(numeral);
    }
  });

  it("does not mistake III for a flattened IV", () => {
    // In a major key the note a semitone below IV is III, and a chord on III is
    // a chord on III. The lower root only counts when nothing else occupies it.
    const forFour = borrowingsForDegree("C", "major", 4);
    expect(forFour.map((c) => c.romanNumeral)).toEqual(["iv", "iv7", "IV7"]);
    for (const chord of forFour) expect(chord.root).toBe("F");
  });

  it("only returns chords that are borrowings at all", () => {
    const all = new Set(findModalBorrowings("C", "major").map((c) => c.symbol));
    for (let degree = 1; degree <= 7; degree += 1) {
      for (const chord of borrowingsForDegree("C", "major", degree)) {
        expect(all.has(chord.symbol), `${degree} ${chord.symbol}`).toBe(true);
      }
    }
  });
});
