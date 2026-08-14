import { describe, expect, it } from "vitest";
import { PROGRESSION_TEMPLATES } from "../src/music/progressions";
import {
  DEVICE_LABELS,
  enumerateVariants,
  type ProgressionDevice,
} from "../src/music/progressionVariants";
import {
  degreeDigitsOf,
  degreeTokensOf,
  degreesFromRoman,
  romanOf,
  searchProgressions,
} from "../src/music/progressionSearch";
import type { Mode } from "../src/types/music";

/**
 * A thousand progressions, and finding one of them.
 *
 * The catalogue admits a progression only where several independent sources
 * give it the same name and degrees, which is why it holds thirty-six. The
 * derived set exists because that bar cannot be raised to a thousand without
 * abandoning it, and the honest alternative is applying documented devices to
 * documented progressions.
 *
 * So the tests here are mostly about provenance and about the devices doing
 * what they are named after -- a "tritone substitution" that does not
 * substitute for a dominant is a chromatic chord wearing a label, and that is
 * exactly the failure this whole approach could produce silently.
 */

const MODES: Mode[] = ["major", "naturalMinor", "harmonicMinor", "dorian", "mixolydian"];

describe("deriving progressions", () => {
  it("reaches a useful number without inventing a single one", () => {
    // Measured: 539 in major, 1464 across the five modes at two devices.
    const total = MODES.reduce((sum, mode) => sum + enumerateVariants(mode).length, 0);
    expect(total).toBeGreaterThan(1000);
    expect(enumerateVariants("major").length).toBeGreaterThan(400);
  });

  it("contains every catalogued progression unchanged", () => {
    // The derived set is a superset, not a replacement. A named progression
    // that came out altered would be the catalogue quietly losing entries.
    for (const mode of MODES) {
      const variants = enumerateVariants(mode);
      for (const template of PROGRESSION_TEMPLATES.filter((t) => t.modes.includes(mode))) {
        const found = variants.find((entry) => entry.id === template.id);
        expect(found, `${mode}/${template.id}`).toBeDefined();
        expect(found!.devices, template.id).toEqual([]);
        expect(JSON.stringify(found!.steps), template.id).toBe(JSON.stringify(template.steps));
      }
    }
  });

  it("gives every entry a unique id", () => {
    // Two rotations of one progression are reached by the same device chain,
    // so the chain alone does not identify a result -- and an id is what the
    // search results, the section plan and the project file all use to mean
    // one progression.
    for (const mode of MODES) {
      const ids = enumerateVariants(mode).map((entry) => entry.id);
      expect(new Set(ids).size, mode).toBe(ids.length);
    }
  });

  it("never produces the same progression twice under two names", () => {
    for (const mode of MODES) {
      const shapes = enumerateVariants(mode).map((entry) => JSON.stringify(entry.steps));
      expect(new Set(shapes).size, mode).toBe(shapes.length);
    }
  });

  it("says where every derived entry came from", () => {
    for (const variant of enumerateVariants("major")) {
      expect(PROGRESSION_TEMPLATES.some((t) => t.id === variant.baseId), variant.id).toBe(true);
      if (variant.devices.length > 0) {
        expect(variant.id.startsWith(variant.baseId), variant.id).toBe(true);
        for (const device of variant.devices) {
          expect(variant.label, variant.id).toContain(DEVICE_LABELS[device]);
        }
      }
    }
  });

  it("keeps a progression a progression", () => {
    for (const mode of MODES) {
      for (const variant of enumerateVariants(mode)) {
        expect(variant.steps.length, variant.id).toBeGreaterThanOrEqual(2);
        // The length cap bounds what the devices may build. The catalogue's
        // own twelve-bar blues is longer than it and is not dropped for that.
        const cap = variant.devices.length === 0 ? 12 : 8;
        expect(variant.steps.length, variant.id).toBeLessThanOrEqual(cap);
        for (const step of variant.steps) {
          expect(step.degree, variant.id).toBeGreaterThanOrEqual(1);
          expect(step.degree, variant.id).toBeLessThanOrEqual(7);
        }
      }
    }
  });

  it("is deterministic", () => {
    expect(JSON.stringify(enumerateVariants("major")))
      .toBe(JSON.stringify(enumerateVariants("major")));
  });

  it("grows monotonically with the device budget", () => {
    const one = enumerateVariants("major", { maxDevices: 1 });
    const two = enumerateVariants("major", { maxDevices: 2 });
    expect(two.length).toBeGreaterThan(one.length);
    // Everything reachable in one device is still reachable in two, with the
    // same id, so raising the budget never renames anything.
    for (const entry of one) {
      expect(two.find((other) => other.id === entry.id), entry.id).toBeDefined();
    }
  });
});

describe("the devices do what they are named after", () => {
  const majors = enumerateVariants("major");

  function withDevice(device: ProgressionDevice) {
    return majors.filter((entry) => entry.devices.includes(device));
  }

  it("substitutes a tritone only for a dominant that resolves to the tonic", () => {
    // The failure this approach could produce silently: a flat two in front of
    // iii is a chromatic chord, not a substitution, and calling it one would
    // put a name on something that has not earned it.
    const subs = withDevice("tritoneSub");
    expect(subs.length).toBeGreaterThan(0);
    for (const variant of subs) {
      const index = variant.steps.findIndex((step) =>
        step.role === "tritoneSubstitution");
      expect(index, variant.id).toBeGreaterThanOrEqual(0);
      const next = variant.steps[(index + 1) % variant.steps.length]!;
      expect(next.degree, `${variant.id} resolves to ${next.degree}`).toBe(1);
    }
  });

  it("points every secondary dominant at the chord that follows it", () => {
    for (const variant of withDevice("secondaryDominant")) {
      for (const [index, step] of variant.steps.entries()) {
        if (step.role !== "secondaryDominant") continue;
        // Wrapping counts. The catalogue's own 丸サ進行 ends on a I7 that is
        // V/IV of the IV the loop returns to, so the last step of a loop can
        // legitimately be a secondary dominant.
        const next = variant.steps[(index + 1) % variant.steps.length]!;
        expect(step.targetDegree, variant.id).toBe(next.degree);
        expect(step.degree, variant.id).toBe(((next.degree - 1 + 4) % 7) + 1);
      }
    }
  });

  it("turns a major subdominant minor and nothing else", () => {
    for (const variant of withDevice("subdominantMinor")) {
      const fourths = variant.steps.filter((step) =>
        step.degree === 4 && step.alteration === undefined);
      expect(fourths.length, variant.id).toBeGreaterThan(0);
      for (const step of fourths) {
        expect(step.quality, variant.id).toBe("minor");
        expect(step.role, variant.id).toBe("borrowed");
      }
    }
  });

  it("keeps the major fourth in front of the borrowed one when approaching", () => {
    for (const variant of withDevice("subdominantMinorApproach")) {
      // Some IV-iv pair, not the first minor fourth in the progression: a
      // rotation can put an already-borrowed iv at the head, and the device's
      // claim is that it added a pair, not that no other iv exists.
      const paired = variant.steps.some((step, index) => {
        if (index === 0) return false;
        if (step.degree !== 4 || step.quality !== "minor" || step.role !== "borrowed") return false;
        const before = variant.steps[index - 1]!;
        // Still the major subdominant, though the seventh device may have
        // coloured it: IVmaj7 to iv is the same approach as IV to iv.
        return before.degree === 4
          && (before.quality === undefined || before.quality === "major"
            || before.quality === "major7");
      });
      expect(paired, variant.id).toBe(true);
    }
  });

  it("fills a rising whole step with the passing diminished, never a falling one", () => {
    for (const variant of withDevice("passingDiminished")) {
      const index = variant.steps.findIndex((step) => step.role === "passingDiminished");
      expect(index, variant.id).toBeGreaterThan(0);
      const before = variant.steps[index - 1]!;
      const after = variant.steps[index + 1]!;
      expect(variant.steps[index]!.alteration, variant.id).toBe(1);
      expect(variant.steps[index]!.degree, variant.id).toBe(before.degree);
      expect(after.degree, variant.id).toBe(before.degree + 1);
    }
  });

  it("rotates without adding or losing a chord", () => {
    for (const variant of withDevice("rotation")) {
      const base = PROGRESSION_TEMPLATES.find((t) => t.id === variant.baseId)!;
      if (variant.devices.length !== 1) continue;
      expect(variant.steps.length, variant.id).toBe(base.steps.length);
      const rotated = [...variant.steps].map((s) => s.degree).sort();
      const original = [...base.steps].map((s) => s.degree).sort();
      expect(rotated, variant.id).toEqual(original);
    }
  });
});

describe("searching", () => {
  it("reads a degree sequence the way practice writes it", () => {
    const hits = searchProgressions({ mode: "major", query: "4536" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.variant.baseId).toBe("royal-road");
    expect(degreeDigitsOf(hits[0]!.variant)).toBe("4536");
  });

  it("reads the same progression written as roman numerals", () => {
    // The reason the parser is token-based: concatenated, "IV V" reads just as
    // well as I-V-V, and this query came out as 4741 before it was.
    expect(degreesFromRoman("IVmaj7 V7 iii7 vi")).toBe("4536");
    expect(degreesFromRoman("IV-V-iii-vi")).toBe("4536");
    expect(degreesFromRoman("王道進行")).toBeNull();
    const hits = searchProgressions({ mode: "major", query: "IVmaj7 V7 iii7 vi" });
    expect(hits[0]!.variant.baseId).toBe("royal-road");
  });

  it("finds a chromatic root typed as a degree", () => {
    // "4536" cannot express a flat two, and nobody types ♭II7 into a search box.
    const hits = searchProgressions({ mode: "major", query: "b2" });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(degreeTokensOf(hit.variant)).toContain("b2");
  });

  it("finds a progression by name and by device", () => {
    expect(searchProgressions({ mode: "major", query: "王道" }).length).toBeGreaterThan(10);
    const byDevice = searchProgressions({ mode: "major", query: "サブドミナントマイナー" });
    expect(byDevice.length).toBeGreaterThan(10);
  });

  it("puts the catalogued progression ahead of its own variants", () => {
    // An exact match on a named progression must never be buried under the
    // things derived from it.
    const hits = searchProgressions({ mode: "major", query: "4536" });
    expect(hits[0]!.variant.devices).toEqual([]);
  });

  it("does not match the disambiguating suffix of an id", () => {
    // Every derived id ends in "-2", "-3"; a two-character query was matching
    // those rather than anything a reader would call a match.
    for (const hit of searchProgressions({ mode: "major", query: "-2" })) {
      expect(hit.reasons, hit.variant.id).not.toContain("IDが一致");
    }
  });

  it("says why each result matched", () => {
    for (const hit of searchProgressions({ mode: "major", query: "4536", limit: 10 })) {
      expect(hit.reasons.length, hit.variant.id).toBeGreaterThan(0);
    }
  });

  it("filters by device, length and usage without a query", () => {
    const all = searchProgressions({ mode: "major" });
    expect(all.length).toBeGreaterThan(400);
    const short = searchProgressions({ mode: "major", maxSteps: 3 });
    expect(short.every((hit) => hit.variant.steps.length <= 3)).toBe(true);
    const chorus = searchProgressions({ mode: "major", usage: "chorus" });
    expect(chorus.every((hit) => (hit.variant.usage ?? "any") === "chorus")).toBe(true);
    const subs = searchProgressions({ mode: "major", devices: ["tritoneSub"] });
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.every((hit) => hit.variant.devices.includes("tritoneSub"))).toBe(true);
  });

  it("can be held to the catalogue alone", () => {
    const only = searchProgressions({ mode: "major", cataloguedOnly: true });
    expect(only.every((hit) => hit.variant.devices.length === 0)).toBe(true);
    expect(only.length).toBe(
      PROGRESSION_TEMPLATES.filter((t) => t.modes.includes("major")).length);
  });

  it("respects the limit and keeps the order stable", () => {
    const full = searchProgressions({ mode: "major", query: "王道" });
    const limited = searchProgressions({ mode: "major", query: "王道", limit: 5 });
    expect(limited).toHaveLength(5);
    expect(limited.map((h) => h.variant.id)).toEqual(full.slice(0, 5).map((h) => h.variant.id));
  });

  it("finds nothing rather than everything for a query that means nothing", () => {
    expect(searchProgressions({ mode: "major", query: "ZZZZZ" })).toEqual([]);
  });

  it("writes roman numerals a reader would recognise", () => {
    const royal = enumerateVariants("major").find((entry) => entry.id === "royal-road")!;
    expect(romanOf(royal, "major")).toBe("IVmaj7 V7 iii7 vi");
  });
});
