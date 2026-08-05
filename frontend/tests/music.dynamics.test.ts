import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import { buildCompositionTracks, dynamicVelocity } from "../src/music/compositionTracks";
import type { GeneratedComposition, GeneratorSettings } from "../src/types/music";

/**
 * Chord and bass velocity was the literal 78, on every note of every chord in
 * every style, and nothing anywhere could change it. Measured before this
 * existed, across pop, jazz, ballad and edm at sixteen bars: exactly one
 * distinct velocity per track. That is the flat delivery, in one number.
 */

function settings(patch: Partial<GeneratorSettings>): GeneratorSettings {
  return { ...DEFAULT_GENERATOR_SETTINGS, ...patch } as GeneratorSettings;
}

function chordVelocities(piece: GeneratedComposition): number[] {
  return buildCompositionTracks(piece)
    .filter((track) => track.role === "chords" || track.role === "bass")
    .flatMap((track) => track.notes.map((note) => note.velocity));
}

const STYLES = ["pop", "jazz", "ballad", "edm"] as const;

describe("chord and bass dynamics", () => {
  it("varies on the default one-chord-per-bar path", () => {
    // The case that decides whether this is worth having. With one chord per
    // bar every chord starts on a downbeat, so metric position alone would
    // leave the default path exactly as flat as it was.
    for (const style of STYLES) {
      const base = { seed: "dyn", style, bars: 8 } as Partial<GeneratorSettings>;
      const flat = new Set(chordVelocities(generateComposition(settings(base))));
      const shaped = new Set(
        chordVelocities(generateComposition(settings({ ...base, dynamics: { enabled: true } }))),
      );

      expect(flat.size).toBe(1);
      expect(shaped.size).toBeGreaterThan(1);
      // Measured: 66-78 at the default depth, about 1.5 dB. Below roughly one
      // decibel the difference stops being audible and this would be cost
      // without benefit.
      expect(Math.max(...shaped) - Math.min(...shaped)).toBeGreaterThanOrEqual(10);
    }
  });

  it("plays the outer voices above the inner ones", () => {
    // The frame of the chord is the bass and the top line; the voices between
    // them fill. Weighting all of them equally is what a button press sounds
    // like.
    const strong = dynamicVelocity(0, "4/4", "bass", { enabled: true });
    const top = dynamicVelocity(0, "4/4", "top", { enabled: true });
    const inner = dynamicVelocity(0, "4/4", "inner", { enabled: true });

    expect(inner).toBeLessThan(top);
    expect(inner).toBeLessThan(strong);
    expect(top).toBeLessThanOrEqual(strong);
    expect(strong - inner).toBeGreaterThanOrEqual(10);
  });

  it("plays a downbeat above an offbeat when the bar is subdivided", () => {
    const downbeat = dynamicVelocity(0, "4/4", "bass", { enabled: true });
    const halfBar = dynamicVelocity(960, "4/4", "bass", { enabled: true });
    const beat = dynamicVelocity(480, "4/4", "bass", { enabled: true });
    const offbeat = dynamicVelocity(240, "4/4", "bass", { enabled: true });

    expect(halfBar).toBeLessThan(downbeat);
    expect(beat).toBeLessThan(halfBar);
    expect(offbeat).toBeLessThan(beat);
  });

  it("reads the bar of the declared time signature", () => {
    // Tick 960 is the half-bar of a 4/4 bar and a plain beat of a 3/4 one, so
    // a fixed bar length would weight it wrongly in three.
    expect(dynamicVelocity(960, "4/4", "bass", { enabled: true }))
      .not.toBe(dynamicVelocity(960, "3/4", "bass", { enabled: true }));
  });

  it("leaves the flat literal alone when it is not asked for", () => {
    for (const style of STYLES) {
      const base = { seed: "off", style, bars: 8 } as Partial<GeneratorSettings>;
      const absent = chordVelocities(generateComposition(settings(base)));
      const explicit = chordVelocities(
        generateComposition(settings({ ...base, dynamics: { enabled: false } })),
      );
      expect(explicit).toEqual(absent);
      expect(new Set(absent)).toEqual(new Set([78]));
    }
  });

  it("treats depth 0 as off", () => {
    // The knob has to reach all the way back to the previous behaviour, or it
    // cannot be turned down.
    const off = chordVelocities(generateComposition(settings({ seed: "z", bars: 8 })));
    const zero = chordVelocities(
      generateComposition(settings({ seed: "z", bars: 8, dynamics: { enabled: true, depth: 0 } })),
    );
    expect(zero).toEqual(off);
  });

  it("widens the spread as depth rises", () => {
    const spread = (depth: number) => {
      const values = chordVelocities(
        generateComposition(settings({
          seed: "d", bars: 8, harmonicRhythm: { changesPerBar: 2 },
          dynamics: { enabled: true, depth },
        })),
      );
      return Math.max(...values) - Math.min(...values);
    };
    expect(spread(0.15)).toBeLessThan(spread(0.35));
    expect(spread(0.35)).toBeLessThan(spread(0.6));
    expect(spread(0.6)).toBeLessThan(spread(1));
  });

  it("treats a depth beyond the range as the end of the range", () => {
    // Otherwise "louder than maximum" quietly means "inverted": at depth 2 the
    // weak positions overshoot past silence and come back up the other side.
    const full = dynamicVelocity(240, "4/4", "inner", { enabled: true, depth: 1 });
    expect(dynamicVelocity(240, "4/4", "inner", { enabled: true, depth: 2 })).toBe(full);
    expect(dynamicVelocity(240, "4/4", "inner", { enabled: true, depth: 100 })).toBe(full);

    const none = dynamicVelocity(240, "4/4", "inner", { enabled: true, depth: 0 });
    expect(dynamicVelocity(240, "4/4", "inner", { enabled: true, depth: -1 })).toBe(none);
    expect(dynamicVelocity(240, "4/4", "inner", { enabled: true, depth: -100 })).toBe(none);
  });

  it("never returns a velocity of zero, whatever it is given", () => {
    // Velocity 0 is note-off in MIDI: the note would vanish from playback and
    // from the exported file rather than being quiet.
    for (const base of [1, 2, 8]) {
      const value = dynamicVelocity(240, "4/4", "inner", { enabled: true, depth: 1 }, base);
      expect(value).toBeGreaterThanOrEqual(1);
    }
  });

  it("brings out the top of the chord above the voices inside it", () => {
    // Every upper voice weighted alike would still be quieter than the bass
    // and would still pass a test that only compares outer against inner.
    const piece = generateComposition(settings({
      seed: "top", bars: 8, dynamics: { enabled: true },
    }));
    const chordTrack = buildCompositionTracks(piece).find((track) => track.role === "chords");
    expect(chordTrack).toBeDefined();

    const byChord = new Map<number, { midi: number; velocity: number }[]>();
    for (const note of chordTrack?.notes ?? []) {
      const group = byChord.get(note.startTick) ?? [];
      group.push({ midi: note.midi, velocity: note.velocity });
      byChord.set(note.startTick, group);
    }

    let compared = 0;
    for (const group of byChord.values()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((left, right) => left.midi - right.midi);
      const top = sorted[sorted.length - 1]!;
      for (const note of sorted.slice(0, -1)) {
        expect(top.velocity).toBeGreaterThan(note.velocity);
      }
      compared += 1;
    }
    // A fixture with no three-note chord would prove nothing.
    expect(compared).toBeGreaterThan(0);
  });

  it("clamps a depth outside the range instead of producing a silent note", () => {
    // Velocity 0 is note-off in MIDI, so a note that reached it would vanish
    // from playback and from the exported file.
    for (const depth of [-5, 2, 100, Number.NaN]) {
      const value = dynamicVelocity(240, "4/4", "inner", { enabled: true, depth });
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(127);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("keeps every generated velocity a legal MIDI value", () => {
    for (const depth of [0, 0.5, 1]) {
      const piece = generateComposition(settings({
        seed: "legal", bars: 16, harmonicRhythm: { changesPerBar: 4 },
        dynamics: { enabled: true, depth },
      }));
      for (const velocity of chordVelocities(piece)) {
        expect(Number.isInteger(velocity)).toBe(true);
        expect(velocity).toBeGreaterThanOrEqual(1);
        expect(velocity).toBeLessThanOrEqual(127);
      }
    }
  });

  it("does not disturb the composition data itself", () => {
    // A rendering decision. The same seed has to keep producing the same piece.
    const off = generateComposition(settings({ seed: "data", bars: 16 }));
    const on = generateComposition(
      settings({ seed: "data", bars: 16, dynamics: { enabled: true } }),
    );
    expect(JSON.stringify(on.chords)).toBe(JSON.stringify(off.chords));
    expect(JSON.stringify(on.notes)).toBe(JSON.stringify(off.notes));
  });

  it("changes the composition id only when it is set", () => {
    const off = generateComposition(settings({ seed: "id" }));
    const on = generateComposition(settings({ seed: "id", dynamics: { enabled: true } }));
    const deeper = generateComposition(
      settings({ seed: "id", dynamics: { enabled: true, depth: 0.6 } }),
    );

    expect(on.id).not.toBe(off.id);
    // Depth changes what is rendered, so it has to change the id too.
    expect(deeper.id).not.toBe(on.id);
    expect(generateComposition(settings({ seed: "id" })).id).toBe(off.id);
  });

  it("is deterministic", () => {
    const make = () => generateComposition(
      settings({ seed: "det", bars: 8, dynamics: { enabled: true, depth: 0.5 } }),
    );
    expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
    expect(chordVelocities(make())).toEqual(chordVelocities(make()));
  });
});
