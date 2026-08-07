import { describe, expect, it } from "vitest";
import { MINIMAL_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import { bassRegisterPitch, buildCompositionTracks } from "../src/music/compositionTracks";
import type { GeneratedComposition, GeneratorSettings } from "../src/types/music";

/**
 * Close-position voicings put their lowest note around D3-F3, so the "bass"
 * track sings in the tenor range and the mix holds no energy under about 147 Hz.
 * These pin that enabling the setting actually reaches a bass register, that it
 * moves only the octave, and that leaving it off changes nothing.
 */

function settings(patch: Partial<GeneratorSettings>): GeneratorSettings {
  return { ...MINIMAL_GENERATOR_SETTINGS, ...patch } as GeneratorSettings;
}

function bassNotes(piece: GeneratedComposition): number[] {
  const track = buildCompositionTracks(piece).find((entry) => entry.role === "bass");
  return (track?.notes ?? []).map((note) => note.midi);
}

const STYLES = ["pop", "jazz", "ballad", "edm"] as const;

describe("bass register", () => {
  it("reaches a real bass register in every style", () => {
    for (const style of STYLES) {
      const base = { seed: "bass", style, bars: 8 } as Partial<GeneratorSettings>;
      const before = bassNotes(generateComposition(settings(base)));
      const after = bassNotes(
        generateComposition(settings({ ...base, bassRegister: { enabled: true } })),
      );

      // Measured before this existed: the lowest note anywhere was MIDI 50-53.
      expect(Math.min(...before)).toBeGreaterThan(48);
      expect(Math.min(...after)).toBeLessThanOrEqual(48);
      expect(Math.max(...after)).toBeLessThanOrEqual(48);
    }
  });

  it("moves the octave and nothing else, so the inversion survives", () => {
    // Which note is in the bass is a musical decision the voicer already made.
    // Only where it sounds may change.
    const base = { seed: "inv", bars: 16 } as Partial<GeneratorSettings>;
    const before = bassNotes(generateComposition(settings(base)));
    const after = bassNotes(
      generateComposition(settings({ ...base, bassRegister: { enabled: true } })),
    );

    expect(after).toHaveLength(before.length);
    for (const [index, pitch] of after.entries()) {
      const original = before[index]!;
      expect(pitch % 12).toBe(original % 12);
      expect((original - pitch) % 12).toBe(0);
      expect(pitch).toBeLessThanOrEqual(original);
    }
  });

  it("leaves the track untouched when it is not asked for", () => {
    for (const seed of ["a", "b", "c"]) {
      const off = generateComposition(settings({ seed }));
      const explicit = generateComposition(
        settings({ seed, bassRegister: { enabled: false } }),
      );
      expect(bassNotes(explicit)).toEqual(bassNotes(off));
    }
  });

  it("never crosses the floor, even from an already low pitch", () => {
    // A pitch that cannot reach the ceiling without going under the floor stays
    // where the last whole octave left it, rather than dropping out of range.
    expect(bassRegisterPitch(30, { enabled: true })).toBe(30);
    expect(bassRegisterPitch(52, { enabled: true, ceiling: 48, floor: 45 })).toBe(52);
    expect(bassRegisterPitch(60, { enabled: true, ceiling: 48, floor: 28 })).toBe(48);
  });

  it("is a no-op when disabled or absent", () => {
    expect(bassRegisterPitch(60, undefined)).toBe(60);
    expect(bassRegisterPitch(60, { enabled: false })).toBe(60);
  });

  it("respects an explicit ceiling", () => {
    expect(bassRegisterPitch(60, { enabled: true, ceiling: 36 })).toBe(36);
    expect(bassRegisterPitch(60, { enabled: true, ceiling: 60 })).toBe(60);
  });

  it("changes the composition id only when it is set", () => {
    const off = generateComposition(settings({ seed: "id" }));
    const on = generateComposition(
      settings({ seed: "id", bassRegister: { enabled: true } }),
    );
    expect(on.id).not.toBe(off.id);
    expect(generateComposition(settings({ seed: "id" })).id).toBe(off.id);
  });

  it("does not disturb the generated chords themselves", () => {
    // This is a rendering decision. The composition data must be identical, or
    // the same seed would stop producing the same piece.
    const off = generateComposition(settings({ seed: "data", bars: 16 }));
    const on = generateComposition(
      settings({ seed: "data", bars: 16, bassRegister: { enabled: true } }),
    );
    expect(JSON.stringify(on.chords)).toBe(JSON.stringify(off.chords));
    expect(JSON.stringify(on.notes)).toBe(JSON.stringify(off.notes));
  });
});
