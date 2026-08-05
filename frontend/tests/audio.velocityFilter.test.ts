import { describe, expect, it } from "vitest";
import { VELOCITY_OCTAVES, velocityBaseFrequency } from "../src/audio/velocityFilterSynth";

/**
 * Velocity to cutoff.
 *
 * The instruments were bare oscillators, so a harder-struck note came out
 * louder and never brighter. Tone would not have fixed that on its own either:
 * MonoSynth triggers its filter envelope without passing velocity through, so
 * adding a filter alone changes the tone of every note equally.
 *
 * Measured, with dynamics at the default depth: 0.24 octaves of spread inside
 * the chord and bass tracks, and 0.51 octaves across the whole piece, the
 * melody at 92 against the inner chord voices at 66. Modest, and real.
 */

describe("velocity to filter cutoff", () => {
  it("starts a full-velocity note at exactly the configured cutoff", () => {
    // The preset numbers have to mean something, or they cannot be tuned.
    expect(velocityBaseFrequency(620, 1)).toBeCloseTo(620, 6);
    expect(velocityBaseFrequency(240, 1)).toBeCloseTo(240, 6);
  });

  it("opens the stated number of octaves across the velocity range", () => {
    // Stated in octaves because that is the unit brightness is heard in; a
    // plain gain factor would be a number with no musical reading.
    const loud = velocityBaseFrequency(620, 1);
    const silent = velocityBaseFrequency(620, 0);
    expect(Math.log2(loud / silent)).toBeCloseTo(VELOCITY_OCTAVES, 6);
  });

  it("rises with velocity, always", () => {
    let previous = 0;
    for (let velocity = 0; velocity <= 1.0001; velocity += 0.05) {
      const value = velocityBaseFrequency(620, velocity);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it("produces an audible spread at the velocities the generator actually writes", () => {
    // The measurement the feature rests on. Chord notes sit at 66-78 with
    // dynamics on, the melody at 92. If the spread here were negligible this
    // would be cost without benefit.
    const at = (velocity: number) => velocityBaseFrequency(620, velocity / 127);
    const withinChords = Math.log2(at(78) / at(66));
    const acrossPiece = Math.log2(at(92) / at(66));

    expect(withinChords).toBeGreaterThan(0.2);
    expect(acrossPiece).toBeGreaterThan(0.45);
  });

  it("clamps a velocity outside 0..1 rather than inverting the filter", () => {
    // Above 1 the exponent would push the cutoff above the configured value,
    // and below 0 it would run down towards DC and silence the voice.
    expect(velocityBaseFrequency(620, 2)).toBe(velocityBaseFrequency(620, 1));
    expect(velocityBaseFrequency(620, 50)).toBe(velocityBaseFrequency(620, 1));
    expect(velocityBaseFrequency(620, -1)).toBe(velocityBaseFrequency(620, 0));
    expect(velocityBaseFrequency(620, -50)).toBe(velocityBaseFrequency(620, 0));
  });

  it("treats a non-finite velocity as full rather than as a broken filter", () => {
    // NaN would pass through Math.min/Math.max and reach Math.pow, leaving the
    // voice with a cutoff of NaN, which is a voice that makes no sound at all.
    for (const velocity of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const value = velocityBaseFrequency(620, velocity);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });

  it("never returns zero or a negative frequency", () => {
    // A filter at or below 0 Hz is not a dark note, it is a dead voice.
    for (const velocity of [0, 0.001, 0.08, 0.5, 1]) {
      expect(velocityBaseFrequency(240, velocity)).toBeGreaterThan(0);
    }
  });

  it("scales with the preset instead of collapsing to one curve", () => {
    // Each instrument sits in its own register; a mapping that ignored the
    // configured value would give the bass and the lead the same cutoff.
    const ratio = velocityBaseFrequency(1250, 0.6) / velocityBaseFrequency(240, 0.6);
    expect(ratio).toBeCloseTo(1250 / 240, 6);
  });
});
