import { describe, expect, it } from "vitest";
import { shapeSpan, shapesFor, type VoicingShape } from "../src/music/voicingShapes";
import { lowIntervalViolation, spacingInversion } from "../src/music/voicingRegister";
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

  describe("voicing a triad in four parts", () => {
    it("doubles the root at the octave above", () => {
      // Nobody plays a triad with three fingers, and the drop family needs four
      // notes -- so without this, seven of nine shapes were unavailable on the
      // default path and the search alternated between close and open forever.
      expect(shape("major", "doubledRoot")).toEqual([0, 4, 7, 12]);
      expect(shape("minor", "doubledRoot")).toEqual([0, 3, 7, 12]);
    });

    it("doubles the fifth BELOW, not above", () => {
      // A fifth added on top leaves the widest gap at the top of the voicing,
      // which is the one arrangement the spacing rule calls wrong. Measured:
      // doubling upward scored nine semitones of inverted spacing on a plain
      // triad, downward scores none.
      expect(shape("major", "doubledFifth")).toEqual([-5, 0, 4, 7]);
      expect(spacingInversion(shape("major", "doubledFifth")!)).toBe(0);
      expect(spacingInversion([0, 4, 7, 19])).toBeGreaterThan(5);
    });

    it("opens the drop family to a triad", () => {
      for (const quality of ["major", "minor"] as const) {
        expect(shape(quality, "drop2Doubled"), quality).toBeDefined();
        expect(shape(quality, "drop3Doubled"), quality).toBeDefined();
        expect(shapeSpan(shape(quality, "drop3Doubled")!), quality)
          .toBeGreaterThan(shapeSpan(shape(quality, "close")!));
      }
    });

    it("adds no pitch class, so the chord is still that chord", () => {
      for (const quality of ["major", "minor"] as const) {
        const own = new Set(pitchClasses(intervalsForQuality(quality)));
        for (const name of ["doubledRoot", "doubledFifth", "drop2Doubled", "drop3Doubled"] as const) {
          for (const pitchClass of pitchClasses(shape(quality, name)!)) {
            expect(own.has(pitchClass), `${quality}/${name}`).toBe(true);
          }
        }
      }
    });

    it("is unavailable to a chord that already has four notes", () => {
      for (const quality of ["major7", "minor7", "dominant7"] as const) {
        expect(shape(quality, "doubledRoot"), quality).toBeUndefined();
        expect(shape(quality, "doubledFifth"), quality).toBeUndefined();
      }
    });
  });

  describe("two hands with a hole between them", () => {
    it("puts the foundation low and the chord two octaves above it", () => {
      // The empty middle is not a gap in the voicing, it is the voicing: it is
      // what keeps the low register clear and lets the right hand read as its
      // own line rather than as the top of one stack.
      expect(shape("major7", "twoHandFifth")).toEqual([0, 7, 28, 31, 35]);
      // The left hand takes the seventh where there is one, because root and
      // seventh state more than root and fifth do.
      expect(shape("major7", "twoHandSeventh")).toEqual([0, 11, 28, 31, 35]);
    });

    it("leaves the low register clear where a close voicing does not", () => {
      // The measurement that justifies the shape. Placed from C2, a close
      // seventh chord violates the low interval limits and a two-handed one
      // does not.
      const at = (name: VoicingShape) => shape("major7", name)!.map((interval) => interval + 36);
      expect(lowIntervalViolation(at("close"))).toBeGreaterThan(0);
      expect(lowIntervalViolation(at("twoHandFifth"))).toBe(0);
    });

    it("offers the ordinary width, not only the wide one", () => {
      // twoHandFifth lifts the right hand a rigid two octaves, so everything it
      // makes is thirty semitones or more; an octave lower lands at nineteen to
      // twenty-two. Measured across three styles before this shape existed, of
      // three thousand candidates offered per style the twenty-four to
      // twenty-nine semitone band held not one -- and two octaves is the median
      // width of 974 classical piano files, engraved and performed.
      //
      // C3-G3 under E4-G4-C5: the first shape a hand finds.
      expect(shape("major", "twoHandClose")).toEqual([0, 7, 16, 19, 24]);
      expect(shapeSpan(shape("major", "twoHandClose")!)).toBe(24);
    });

    it("inverts the right hand rather than transposing it", () => {
      // Where the width comes from. Moving the stack bodily up an octave gives
      // [0, 7, 12, 16, 19] -- nineteen wide, which the catalogue already had.
      // Starting the hand on the third and wrapping what is below it round the
      // octave is what puts the root on top and reaches two octaves.
      const voicing = shape("major", "twoHandClose")!;
      expect(voicing[voicing.length - 1]! % 12).toBe(0);
      expect(voicing.slice(2)).toEqual([16, 19, 24]);
    });

    it("keeps the hole that makes it two hands, for every quality that has it", () => {
      // Structural rather than checked: the right hand starts on the third an
      // octave up, so the gap above the left hand's fifth is seven semitones at
      // its narrowest whatever the chord. Asserted across the qualities rather
      // than on one, since that is the claim the code relies on instead of a
      // guard.
      for (const quality of QUALITIES) {
        const voicing = shape(quality, "twoHandClose");
        if (!voicing) continue;
        expect(voicing[2]! - voicing[1]!, quality).toBeGreaterThanOrEqual(7);
      }
    });

    it("is judged on each hand rather than across the hole", () => {
      // The rule that gaps shrink going up is a rule about what ONE hand does.
      // Applied across the hole it condemns the most ordinary shape there is --
      // measured, fourteen semitones of "inversion" against a left-hand root
      // and fifth under a close right-hand chord.
      expect(spacingInversion(shape("major7", "twoHandFifth")!)).toBeLessThanOrEqual(1);
      expect(spacingInversion(shape("minor7", "twoHandFifth")!)).toBe(0);
    });

    it("refuses to call a stack two-handed when there is no hole", () => {
      // Without the gap this is a wide stack wearing the name.
      const voicing = shape("major7", "twoHandFifth")!;
      const gap = (voicing[2] as number) - (voicing[1] as number);
      expect(gap).toBeGreaterThanOrEqual(9);
    });

    it("needs at least two notes in the right hand", () => {
      // A right hand holding one note is not a voicing.
      for (const quality of ["major7", "minor7", "major", "minor"] as const) {
        const voicing = shape(quality, "twoHandFifth");
        if (!voicing) continue;
        expect(voicing.filter((interval) => interval >= 24).length, quality)
          .toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe("folding an extended chord into playable width", () => {
    it("brings colour tones down where the pitch is free", () => {
      // reduceStack voices colour tones above the seventh so a thirteenth is
      // not heard as a sixth, which is right for reading the chord and wrong
      // for playing it: an extended chord arrived at the voicer eighteen
      // semitones wide and every shape then widened it further.
      const wide = [0, 4, 10, 14, 21];
      const compact = shapesFor({ quality: "dominant7", stack: wide })
        .find((entry) => entry.shape === "compact");
      expect(compact).toBeDefined();
      expect(shapeSpan(compact!.intervals)).toBeLessThan(shapeSpan(wide));
      // Same pitch classes, or it is a different chord.
      expect(new Set(pitchClasses(compact!.intervals)))
        .toEqual(new Set(pitchClasses(wide)));
    });

    it("accepts the seconds folding creates", () => {
      // A ninth cannot come down without landing a tone from the root or the
      // third -- arithmetic, not a tuning problem. Refusing the fold on those
      // grounds stops it happening at all: measured, declining crowded
      // landings took the fold from applying everywhere to nowhere, and width
      // went from 12.1 back to 19.8 with inverted spacing from 834 to 2005.
      const compact = shapesFor({ quality: "dominant7", stack: [0, 4, 10, 14, 21] })
        .find((entry) => entry.shape === "compact")!;
      const seconds = compact.intervals.filter((interval, index) =>
        index > 0 && interval - (compact.intervals[index - 1] as number) <= 2).length;
      expect(seconds).toBeGreaterThan(0);
    });

    it("is unavailable when there is nothing to fold", () => {
      // A plain triad is already as compact as it gets, and offering the same
      // pitches under a second name is not a choice.
      expect(shape("major", "compact")).toBeUndefined();
      expect(shape("major7", "compact")).toBeUndefined();
    });
  });

  it("gives every chord real choices", () => {
    for (const quality of ["major7", "minor7", "dominant7", "halfDiminished7"] as const) {
      expect(shapes(quality).length, quality).toBeGreaterThanOrEqual(9);
    }
    // A triad used to have three. Doubling and the two-handed shapes give it
    // as many as a seventh, which is what a player actually has available.
    for (const quality of ["major", "minor"] as const) {
      expect(shapes(quality).length, quality).toBeGreaterThanOrEqual(7);
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
