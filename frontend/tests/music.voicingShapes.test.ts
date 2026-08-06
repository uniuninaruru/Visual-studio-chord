import { describe, expect, it } from "vitest";
import { shapeSpan, shapesFor, type VoicingShape } from "../src/music/voicingShapes";
import { intervalsForQuality } from "../src/music/chords";
import type { ChordQuality } from "../src/types/music";

/**
 * The voicing shape catalogue.
 *
 * Measured before this existed, across eight styles at sixteen bars: every
 * chord in the app was close position, the only intervals between adjacent
 * voices were 3, 4 and 5 semitones, and eighty chords produced five distinct
 * shapes -- exactly the number of triad inversions available, so the search had
 * hit its own ceiling.
 *
 * These pin the constructions themselves. Whether a shape is CHOSEN is a
 * separate question decided by cost, and tested elsewhere.
 */

const QUALITIES: ChordQuality[] = [
  "major", "minor", "diminished", "augmented",
  "dominant7", "major7", "minor7", "halfDiminished7", "diminished7",
  "minorMajor7", "augmentedMajor7", "sus2", "sus4", "add9", "minorAdd9",
];

function shapes(quality: ChordQuality) {
  return shapesFor({ quality, stack: [...intervalsForQuality(quality)] });
}

function shape(quality: ChordQuality, name: VoicingShape) {
  return shapes(quality).find((entry) => entry.shape === name)?.intervals;
}

function pitchClasses(intervals: readonly number[]) {
  return intervals.map((interval) => ((interval % 12) + 12) % 12);
}

describe("voicing shapes", () => {
  it("offers close position for every quality", () => {
    for (const quality of QUALITIES) {
      expect(shape(quality, "close"), quality).toEqual([...intervalsForQuality(quality)]);
    }
  });

  it("returns shapes ordered low to high, with no repeated pitch", () => {
    for (const quality of QUALITIES) {
      for (const entry of shapes(quality)) {
        const label = `${quality}/${entry.shape}`;
        expect([...entry.intervals].sort((a, b) => a - b), label).toEqual(entry.intervals);
        expect(new Set(entry.intervals).size, label).toBe(entry.intervals.length);
        expect(entry.intervals.length, label).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("never invents a tone the chord does not contain", () => {
    // A voicing is a rearrangement, not a reharmonisation. The one exception is
    // the shapes that deliberately add colour, which are checked separately.
    const rearrangements: VoicingShape[] = ["close", "drop2", "drop3", "drop24", "spread"];
    for (const quality of QUALITIES) {
      const own = new Set(pitchClasses(intervalsForQuality(quality)));
      for (const entry of shapes(quality)) {
        if (!rearrangements.includes(entry.shape)) continue;
        for (const pitchClass of pitchClasses(entry.intervals)) {
          expect(own.has(pitchClass), `${quality}/${entry.shape} pc ${pitchClass}`).toBe(true);
        }
      }
    }
  });

  it("keeps every chord tone present in a rearrangement", () => {
    const rearrangements: VoicingShape[] = ["close", "drop2", "drop3", "drop24", "spread"];
    for (const quality of QUALITIES) {
      const own = pitchClasses(intervalsForQuality(quality));
      for (const entry of shapes(quality)) {
        if (!rearrangements.includes(entry.shape)) continue;
        const sounding = new Set(pitchClasses(entry.intervals));
        for (const pitchClass of own) {
          expect(sounding.has(pitchClass), `${quality}/${entry.shape} lost pc ${pitchClass}`).toBe(true);
        }
      }
    }
  });

  describe("the drop family", () => {
    it("drops the named voice by exactly an octave", () => {
      // C major seventh, close: C E G B. Drop-2 takes the second voice from the
      // top -- the G -- down an octave, which is the definition.
      expect(shape("major7", "drop2")).toEqual([-5, 0, 4, 11]);
      // Drop-3 takes the third from the top, the E.
      expect(shape("major7", "drop3")).toEqual([-8, 0, 7, 11]);
      // Drop-2+4 takes the second and the fourth: the G and the C.
      expect(shape("major7", "drop24")).toEqual([-12, -5, 4, 11]);
    });

    it("opens the voicing wider than close position", () => {
      // The whole reason to drop a voice. A drop that did not widen would be a
      // reordering with no audible consequence.
      for (const quality of ["major7", "minor7", "dominant7", "halfDiminished7"] as const) {
        const close = shapeSpan(shape(quality, "close")!);
        for (const name of ["drop2", "drop3", "drop24"] as const) {
          expect(shapeSpan(shape(quality, name)!), `${quality}/${name}`).toBeGreaterThan(close);
        }
      }
    });

    it("refuses a drop that would collide two voices onto one pitch", () => {
      // shapesFor takes the stack from its caller, and once colour tones are
      // stacked the caller's stack is not always a plain close position. A
      // stack whose second voice from the top sits an octave above another
      // voice would, on being dropped, land on top of it -- which is the chord
      // with a note missing, not a voicing of it.
      const collides = shapesFor({ quality: "major7", stack: [0, 4, 12, 16] });
      expect(collides.find((entry) => entry.shape === "drop2")).toBeUndefined();
      // The shapes that do not move that voice are still offered.
      expect(collides.find((entry) => entry.shape === "close")).toBeDefined();
    });

    it("is unavailable on a three-note chord", () => {
      // There is no second-from-top to drop on a triad in any useful sense; the
      // result would just be another inversion.
      for (const quality of ["major", "minor", "diminished", "augmented", "sus2", "sus4"] as const) {
        expect(shape(quality, "drop2"), quality).toBeUndefined();
        expect(shape(quality, "drop3"), quality).toBeUndefined();
      }
    });
  });

  describe("spread", () => {
    it("takes alternate voices up an octave", () => {
      // C major close C E G becomes C G E -- open position.
      expect(shape("major", "spread")).toEqual([0, 7, 16]);
      expect(shape("minor", "spread")).toEqual([0, 7, 15]);
    });

    it("is wider than close for every quality that has it", () => {
      for (const quality of QUALITIES) {
        const open = shape(quality, "spread");
        if (!open) continue;
        expect(shapeSpan(open), quality).toBeGreaterThan(shapeSpan(shape(quality, "close")!));
      }
    });
  });

  describe("shell", () => {
    it("states the root, the third and the seventh, and nothing else", () => {
      expect(shape("major7", "shell")).toEqual([0, 4, 11]);
      expect(shape("minor7", "shell")).toEqual([0, 3, 10]);
      expect(shape("dominant7", "shell")).toEqual([0, 4, 10]);
    });

    it("is unavailable without a seventh", () => {
      // Root and third alone is not a shell voicing, it is an incomplete triad.
      for (const quality of ["major", "minor", "sus4", "add9"] as const) {
        expect(shape(quality, "shell"), quality).toBeUndefined();
      }
    });
  });

  describe("rootless voicings", () => {
    it("omit the root", () => {
      for (const quality of ["major7", "minor7", "dominant7", "halfDiminished7"] as const) {
        for (const name of ["rootlessA", "rootlessB"] as const) {
          const intervals = shape(quality, name);
          expect(intervals, `${quality}/${name}`).toBeDefined();
          expect(pitchClasses(intervals!), `${quality}/${name}`).not.toContain(0);
        }
      }
    });

    it("keep the third and the seventh, which is what states the quality", () => {
      for (const quality of ["major7", "minor7", "dominant7", "halfDiminished7"] as const) {
        const own = intervalsForQuality(quality);
        const third = own.find((interval) => interval === 3 || interval === 4)!;
        const seventh = own.find((interval) => interval === 10 || interval === 11)!;
        for (const name of ["rootlessA", "rootlessB"] as const) {
          const sounding = new Set(pitchClasses(shape(quality, name)!));
          expect(sounding.has(third), `${quality}/${name} third`).toBe(true);
          expect(sounding.has(seventh), `${quality}/${name} seventh`).toBe(true);
        }
      }
    });

    it("replace the fifth with the thirteenth on a dominant", () => {
      // Over a dominant the fifth states nothing the root has not; the
      // thirteenth does. This is what separates the form from a plain seventh.
      const a = pitchClasses(shape("dominant7", "rootlessA")!);
      expect(a).toContain(9);
      expect(a).not.toContain(7);
    });

    it("are unavailable on a triad", () => {
      for (const quality of ["major", "minor", "sus4", "diminished"] as const) {
        expect(shape(quality, "rootlessA"), quality).toBeUndefined();
        expect(shape(quality, "rootlessB"), quality).toBeUndefined();
      }
    });
  });

  describe("quartal", () => {
    it("is built mostly of perfect fourths", () => {
      for (const quality of QUALITIES) {
        const intervals = shape(quality, "quartal");
        if (!intervals) continue;
        const steps = intervals.slice(1).map((note, index) => note - (intervals[index] as number));
        const fourths = steps.filter((step) => step === 5).length;
        // A stack with no fourth in it is a close voicing that took a longer
        // route to the same place.
        expect(fourths, quality).toBeGreaterThan(0);
        expect(fourths / steps.length, quality).toBeGreaterThanOrEqual(0.5);
      }
    });

    it("stays inside the chord's own scale", () => {
      // The bug this replaced: four literal fourths from the third of a
      // dominant seventh reaches the major seventh, a note the chord does not
      // contain. C7 must never sound a B.
      const seventhOf: Partial<Record<ChordQuality, number>> = {
        dominant7: 10, major7: 11, minor7: 10, halfDiminished7: 10,
      };
      for (const [quality, seventh] of Object.entries(seventhOf) as Array<[ChordQuality, number]>) {
        const sounding = new Set(pitchClasses(shape(quality, "quartal")!));
        const wrong = seventh === 10 ? 11 : 10;
        expect(sounding.has(wrong), `${quality} sounded the wrong seventh`).toBe(false);
      }
    });

    it("states what the chord is", () => {
      // G-C-F over a C bass is a fine sound but does not say the chord is
      // minor. A quartal stack that drops the defining tone is a colour with
      // no identity.
      for (const quality of QUALITIES) {
        const intervals = shape(quality, "quartal");
        if (!intervals) continue;
        const own = intervalsForQuality(quality);
        const defining = own.find((interval) => interval === 3 || interval === 4)
          ?? own.find((interval) => interval === 2 || interval === 5);
        if (defining === undefined) continue;
        expect(pitchClasses(intervals), quality).toContain(defining % 12);
      }
    });

    it("never doubles a pitch class", () => {
      // An octave doubling inside a quartal stack defeats the point of it.
      for (const quality of QUALITIES) {
        const intervals = shape(quality, "quartal");
        if (!intervals) continue;
        const classes = pitchClasses(intervals);
        expect(new Set(classes).size, quality).toBe(classes.length);
      }
    });

    it("is unavailable on a symmetrical chord", () => {
      // Diminished and augmented shapes divide the octave evenly; a fourth
      // stack over one lands outside it immediately.
      for (const quality of ["diminished", "augmented", "diminished7"] as const) {
        expect(shape(quality, "quartal"), quality).toBeUndefined();
      }
    });
  });

  it("gives a seventh chord far more to choose from than a triad", () => {
    // The point of the catalogue: the search needs candidates. A triad has
    // genuinely fewer real options, and claiming otherwise would put voicings
    // in the set that no player would use.
    for (const quality of ["major7", "minor7", "dominant7", "halfDiminished7"] as const) {
      expect(shapes(quality).length, quality).toBeGreaterThanOrEqual(9);
    }
    for (const quality of ["major", "minor"] as const) {
      expect(shapes(quality).length, quality).toBeGreaterThanOrEqual(3);
    }
  });

  it("never returns the same pitch set under two names", () => {
    for (const quality of QUALITIES) {
      const seen = shapes(quality).map((entry) => entry.intervals.join(","));
      expect(new Set(seen).size, quality).toBe(seen.length);
    }
  });

  it("is deterministic", () => {
    for (const quality of QUALITIES) {
      expect(JSON.stringify(shapes(quality))).toBe(JSON.stringify(shapes(quality)));
    }
  });
});
