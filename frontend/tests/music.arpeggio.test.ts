import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition, validateComposition } from "../src/music";
import { arpeggiateChord, buildCompositionTracks } from "../src/music/compositionTracks";
import type { GeneratedComposition, GeneratorSettings, TimeSignature } from "../src/types/music";

/**
 * Breaking the chord track into a figure.
 *
 * Every chord sounded all of its notes at once for its full length. That is a
 * texture, not the texture, and using it for every chord of every piece is a
 * large part of why playback reads as a chord chart rather than a performance.
 */

function settings(patch: Partial<GeneratorSettings>): GeneratorSettings {
  return { ...DEFAULT_GENERATOR_SETTINGS, ...patch } as GeneratorSettings;
}

function track(piece: GeneratedComposition, role: "chords" | "bass") {
  return buildCompositionTracks(piece).find((entry) => entry.role === role)!;
}

const SIGNATURES: TimeSignature[] = ["4/4", "3/4", "6/8"];

describe("arpeggiated chord track", () => {
  it("spreads the chord instead of striking it as a block", () => {
    for (const timeSignature of SIGNATURES) {
      const base = { seed: "arp", bars: 4, timeSignature } as Partial<GeneratorSettings>;
      const block = track(generateComposition(settings(base)), "chords");
      const figure = track(
        generateComposition(settings({ ...base, arpeggio: { enabled: true } })),
        "chords",
      );

      // A block chord has one start per chord, however many notes it has.
      expect(new Set(block.notes.map((note) => note.startTick)).size)
        .toBeLessThan(block.notes.length);
      // Every note of a figure starts somewhere different.
      expect(new Set(figure.notes.map((note) => note.startTick)).size)
        .toBe(figure.notes.length);
      expect(figure.notes.length).toBeGreaterThan(block.notes.length);
    }
  });

  it("leaves the bass sustained underneath", () => {
    // A bass line that arpeggiates along with the right hand leaves the
    // harmony with no foundation at all.
    const base = { seed: "bass", bars: 4 } as Partial<GeneratorSettings>;
    const plain = track(generateComposition(settings(base)), "bass");
    const arpeggiated = track(
      generateComposition(settings({ ...base, arpeggio: { enabled: true } })),
      "bass",
    );
    expect(arpeggiated.notes.map((note) => note.midi)).toEqual(plain.notes.map((note) => note.midi));
    expect(arpeggiated.notes.map((note) => note.durationTick))
      .toEqual(plain.notes.map((note) => note.durationTick));
  });

  it("tiles the chord exactly, so the figure stays in time", () => {
    // Integer ticks and a chord length that is not a whole number of steps: if
    // the remainder were dropped the figure would drift a little further from
    // the beat with every chord.
    for (const timeSignature of SIGNATURES) {
      for (const rate of [2, 3, 4]) {
        const piece = generateComposition(settings({
          seed: "tile", bars: 8, timeSignature, arpeggio: { enabled: true, rate, gate: 1 },
        }));
        const notes = track(piece, "chords").notes;
        for (const chord of piece.chords) {
          const mine = notes
            .filter((note) => note.startTick >= chord.startTick
              && note.startTick < chord.startTick + chord.durationTick)
            .sort((left, right) => left.startTick - right.startTick);
          if (mine.length < 2) continue;
          // Contiguous, with no gap and no overlap, from the chord's start to
          // its end.
          expect(mine[0]!.startTick).toBe(chord.startTick);
          for (let index = 1; index < mine.length; index += 1) {
            expect(mine[index]!.startTick)
              .toBe(mine[index - 1]!.startTick + mine[index - 1]!.durationTick);
          }
          const last = mine[mine.length - 1]!;
          expect(last.startTick + last.durationTick)
            .toBe(chord.startTick + chord.durationTick);
        }
      }
    }
  });

  it("hands the leftover ticks to the earliest steps rather than dropping them", () => {
    // A duration that is not a whole number of steps. Discarding the remainder
    // would leave the figure short of the chord's end, and the gap would grow
    // with every chord in the piece.
    const notes = arpeggiateChord([60, 64, 67], 0, 1001, 240, { enabled: true, gate: 1 });
    expect(notes.length).toBeGreaterThan(1);

    const total = notes.reduce((sum, note) => sum + note.durationTick, 0);
    expect(total).toBe(1001);
    const last = notes[notes.length - 1]!;
    expect(last.startTick + last.durationTick).toBe(1001);
    // The extra tick goes to the front, so the figure never runs late.
    expect(notes[0]!.durationTick).toBeGreaterThanOrEqual(last.durationTick);
  });

  it("treats a gate outside the range as the end of the range", () => {
    // Above 1 the notes would overlap the step after them, and at or below 0
    // there would be nothing to hear.
    const full = arpeggiateChord([60, 64], 0, 1920, 480, { enabled: true, gate: 1 });
    expect(arpeggiateChord([60, 64], 0, 1920, 480, { enabled: true, gate: 2 })).toEqual(full);
    expect(arpeggiateChord([60, 64], 0, 1920, 480, { enabled: true, gate: 50 })).toEqual(full);

    const shortest = arpeggiateChord([60, 64], 0, 1920, 480, { enabled: true, gate: 0.05 });
    expect(arpeggiateChord([60, 64], 0, 1920, 480, { enabled: true, gate: 0 })).toEqual(shortest);
    expect(arpeggiateChord([60, 64], 0, 1920, 480, { enabled: true, gate: -3 })).toEqual(shortest);

    // And a non-finite gate must not leave every note with a length of NaN.
    for (const note of arpeggiateChord([60, 64], 0, 1920, 480, { enabled: true, gate: Number.NaN })) {
      expect(Number.isInteger(note.durationTick)).toBe(true);
      expect(note.durationTick).toBeGreaterThan(0);
    }
  });

  it("visits the voicing in the order the pattern names", () => {
    const voicing = [60, 64, 67, 71];
    const midis = (pattern: "up" | "down" | "upDown") =>
      arpeggiateChord(voicing, 0, 1920, 240, { enabled: true, pattern }).map((note) => note.midi);

    expect(midis("up")).toEqual([60, 64, 67, 71, 60, 64, 67, 71]);
    expect(midis("down")).toEqual([71, 67, 64, 60, 71, 67, 64, 60]);
    // Turns without striking either end twice, so four notes give a six-step
    // cycle rather than eight.
    expect(midis("upDown")).toEqual([60, 64, 67, 71, 67, 64, 60, 64]);
  });

  it("defaults to up", () => {
    const voicing = [60, 64, 67];
    expect(arpeggiateChord(voicing, 0, 1920, 480, { enabled: true }).map((note) => note.midi))
      .toEqual(arpeggiateChord(voicing, 0, 1920, 480, { enabled: true, pattern: "up" })
        .map((note) => note.midi));
  });

  it("shortens each note by the gate without moving where it starts", () => {
    const full = arpeggiateChord([60, 64], 0, 1920, 480, { enabled: true, gate: 1 });
    const detached = arpeggiateChord([60, 64], 0, 1920, 480, { enabled: true, gate: 0.5 });

    expect(detached.map((note) => note.startTick)).toEqual(full.map((note) => note.startTick));
    for (const [index, note] of detached.entries()) {
      expect(note.durationTick).toBeLessThan(full[index]!.durationTick);
      expect(note.durationTick).toBeGreaterThan(0);
    }
  });

  it("leaves a chord too short to hold two steps as a block", () => {
    // An arpeggio nobody can hear is just a quieter chord.
    const short = arpeggiateChord([60, 64, 67], 0, 300, 240, { enabled: true });
    expect(short).toHaveLength(3);
    expect(new Set(short.map((note) => note.startTick))).toEqual(new Set([0]));
    expect(short.every((note) => note.durationTick === 300)).toBe(true);
  });

  it("refuses a step shorter than a tick instead of producing silent notes", () => {
    for (const ticksPerStep of [0, 0.4, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const notes = arpeggiateChord([60, 64, 67], 0, 1920, ticksPerStep, { enabled: true });
      expect(notes).toHaveLength(3);
      expect(notes.every((note) => note.durationTick === 1920)).toBe(true);
    }
  });

  it("never writes a note of no length, at any rate", () => {
    for (const rate of [480, 481, 1000, 0.5, -1, 0, Number.NaN]) {
      const piece = generateComposition(settings({
        seed: "rate", bars: 4, arpeggio: { enabled: true, rate, gate: 0.05 },
      }));
      for (const note of track(piece, "chords").notes) {
        expect(note.durationTick).toBeGreaterThan(0);
        expect(Number.isInteger(note.durationTick)).toBe(true);
        expect(Number.isInteger(note.startTick)).toBe(true);
      }
    }
  });

  it("falls back to the default rate rather than to no figure", () => {
    // A rate of zero or NaN is a mistake in the caller, not a request for
    // block chords, and silently honouring it as one would hide the mistake.
    const normal = track(
      generateComposition(settings({ seed: "fb", bars: 4, arpeggio: { enabled: true } })),
      "chords",
    ).notes.length;
    for (const rate of [0, -1, Number.NaN]) {
      expect(track(
        generateComposition(settings({ seed: "fb", bars: 4, arpeggio: { enabled: true, rate } })),
        "chords",
      ).notes.length).toBe(normal);
    }
  });

  it("gives more notes at a faster rate", () => {
    const count = (rate: number) => track(
      generateComposition(settings({ seed: "n", bars: 4, arpeggio: { enabled: true, rate } })),
      "chords",
    ).notes.length;
    expect(count(2)).toBeLessThan(count(4));
    expect(count(4)).toBeLessThan(count(8));
  });

  it("reads the beat of the declared time signature", () => {
    // A 6/8 beat is a dotted quarter, so a fixed beat length would put the
    // figure on the wrong grid in compound time.
    const count = (timeSignature: TimeSignature) => track(
      generateComposition(settings({
        seed: "ts", bars: 4, timeSignature, arpeggio: { enabled: true },
      })),
      "chords",
    ).notes.length;
    expect(count("6/8")).not.toBe(count("3/4"));
  });

  it("leaves the block chords alone when it is not asked for", () => {
    for (const seed of ["a", "b", "c"]) {
      const absent = track(generateComposition(settings({ seed, bars: 8 })), "chords");
      const explicit = track(
        generateComposition(settings({ seed, bars: 8, arpeggio: { enabled: false } })),
        "chords",
      );
      expect(JSON.stringify(explicit.notes)).toBe(JSON.stringify(absent.notes));
    }
  });

  it("does not disturb the composition data", () => {
    const off = generateComposition(settings({ seed: "data", bars: 16 }));
    const on = generateComposition(settings({ seed: "data", bars: 16, arpeggio: { enabled: true } }));
    expect(JSON.stringify(on.chords)).toBe(JSON.stringify(off.chords));
    expect(JSON.stringify(on.notes)).toBe(JSON.stringify(off.notes));
    expect(validateComposition(on).valid).toBe(true);
  });

  it("gives every note its own id", () => {
    // Ids used to be built from the pitch, which is unique inside one block
    // chord but repeats the moment a pattern cycles.
    const piece = generateComposition(settings({
      seed: "ids", bars: 8, arpeggio: { enabled: true, rate: 4 },
    }));
    const ids = track(piece, "chords").notes.map((note) => note.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("changes the composition id only when it is set", () => {
    const off = generateComposition(settings({ seed: "id" }));
    const on = generateComposition(settings({ seed: "id", arpeggio: { enabled: true } }));
    const faster = generateComposition(
      settings({ seed: "id", arpeggio: { enabled: true, rate: 4 } }),
    );
    const down = generateComposition(
      settings({ seed: "id", arpeggio: { enabled: true, pattern: "down" } }),
    );

    expect(on.id).not.toBe(off.id);
    expect(faster.id).not.toBe(on.id);
    expect(down.id).not.toBe(on.id);
    expect(generateComposition(settings({ seed: "id" })).id).toBe(off.id);
  });

  it("is deterministic", () => {
    const make = () => track(generateComposition(settings({
      seed: "det", bars: 8, arpeggio: { enabled: true, rate: 4, pattern: "upDown" },
    })), "chords").notes;
    expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
  });
});
