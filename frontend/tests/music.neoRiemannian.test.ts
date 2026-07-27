import { describe, expect, it } from "vitest";
import {
  fixedCardinalityVoiceLeadingDistance,
  neoRiemannianMoveDistance,
  transformTriad,
  transformTriadPath,
  triadPitchClasses,
} from "../src/music";

describe("Neo-Riemannian transformations", () => {
  it("implements the canonical P, L, and R moves from C major", () => {
    const cMajor = { root: "C", quality: "major" } as const;
    expect(transformTriad(cMajor, "P")).toEqual({ root: "C", quality: "minor" });
    expect(transformTriad(cMajor, "L")).toEqual({ root: "E", quality: "minor" });
    expect(transformTriad(cMajor, "R")).toEqual({ root: "A", quality: "minor" });
  });

  it("makes every operation an involution", () => {
    const starts = [
      { root: "C", quality: "major" },
      { root: "F#", quality: "minor" },
    ] as const;
    for (const start of starts) {
      for (const operation of ["P", "L", "R"] as const) {
        expect(transformTriad(transformTriad(start, operation), operation)).toEqual(start);
      }
    }
  });

  it("retains two common tones and moves only one pitch parsimoniously", () => {
    const start = { root: "C", quality: "major" } as const;
    expect(neoRiemannianMoveDistance(start, "P")).toBe(1);
    expect(neoRiemannianMoveDistance(start, "L")).toBe(1);
    expect(neoRiemannianMoveDistance(start, "R")).toBe(2);
    for (const operation of ["P", "L", "R"] as const) {
      const before = new Set(triadPitchClasses(start));
      const after = triadPitchClasses(transformTriad(start, operation));
      expect(after.filter((pitch) => before.has(pitch))).toHaveLength(2);
    }
  });

  it("builds deterministic compound transformations", () => {
    expect(transformTriadPath(
      { root: "C", quality: "major" },
      ["L", "P", "R", "L"],
    )).toEqual(transformTriadPath(
      { root: "C", quality: "major" },
      ["L", "P", "R", "L"],
    ));
  });

  it("refuses to fake a distance across different cardinalities", () => {
    expect(() => fixedCardinalityVoiceLeadingDistance([0, 4, 7], [0, 4, 7, 10]))
      .toThrow(/equal non-zero cardinality/i);
  });
});
