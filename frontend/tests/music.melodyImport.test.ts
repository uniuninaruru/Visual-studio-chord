import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition, validateComposition } from "../src/music";
import { exportCompositionMidi } from "../src/features/export/midi";
import { MelodyImportError, harmoniseInto, importMelodyFile } from "../src/music/melodyImport";
import type { GeneratorSettings } from "../src/types/music";

/**
 * A melody file in, a composition out.
 *
 * The parts existed separately -- a MIDI reader, a key finder, a harmoniser --
 * and nothing joined them to something the editor can open. These pin the join,
 * including the things it has to decide for itself: how long the piece is, what
 * key it is in, and what it refuses.
 */

const SEEDS = ["a", "b", "c", "d", "e"];

function source(patch: Partial<GeneratorSettings> = {}) {
  return generateComposition({
    ...DEFAULT_GENERATOR_SETTINGS, bars: 16, seed: "src", key: "C", ...patch,
  } as GeneratorSettings);
}

function melodyOf(piece: { notes: ReadonlyArray<{ midi: number; startTick: number; durationTick: number }> }) {
  return piece.notes.map((note) => ({
    midi: note.midi, startTick: note.startTick, durationTick: note.durationTick,
  }));
}

/** A File-like the importer accepts, without needing a DOM File. */
function fileOf(name: string, bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return { name, size: bytes.byteLength, arrayBuffer: async () => buffer };
}

describe("harmonising an imported melody", () => {
  it("produces a composition the app will accept", () => {
    // The whole point: not a harmonisation object, a piece the editor can open.
    for (const mode of ["major", "naturalMinor"] as const) {
      for (const seed of SEEDS) {
        const result = harmoniseInto(melodyOf(source({ seed, mode })), DEFAULT_GENERATOR_SETTINGS, {});
        const outcome = validateComposition(result.composition);
        expect(outcome.errors.map((issue) => issue.code), `${mode}/${seed}`).toEqual([]);
      }
    }
  });

  it("keeps every note of the melody, at the tick it was played", () => {
    // A harmoniser that quietly moved the tune would be rewriting it.
    const melody = melodyOf(source());
    const result = harmoniseInto(melody, DEFAULT_GENERATOR_SETTINGS, {});
    expect(result.composition.notes).toHaveLength(melody.length);
    for (const [index, note] of result.composition.notes.entries()) {
      expect(note.midi).toBe(melody[index]!.midi);
      expect(note.startTick).toBe(melody[index]!.startTick);
      expect(note.durationTick).toBe(melody[index]!.durationTick);
    }
  });

  it("puts the melody on a chord tone", () => {
    let onChord = 0;
    let total = 0;
    for (const mode of ["major", "naturalMinor"] as const) {
      for (const seed of SEEDS) {
        const result = harmoniseInto(melodyOf(source({ seed, mode })), DEFAULT_GENERATOR_SETTINGS, {});
        for (const chord of result.composition.chords) {
          const tones = new Set(chord.notes.map((note) => ((note % 12) + 12) % 12));
          for (const note of result.composition.notes) {
            if (note.startTick < chord.startTick) continue;
            if (note.startTick >= chord.startTick + chord.durationTick) continue;
            total += 1;
            if (tones.has(((note.midi % 12) + 12) % 12)) onChord += 1;
          }
        }
      }
    }
    // Measured: 77-91% per piece. The sounding voicing omits tones the harmonic
    // analysis contains, so this sits below the harmoniser's own figure.
    expect(onChord / total).toBeGreaterThan(0.75);
  });

  it("covers the melody with chords from the first tick to the last", () => {
    for (const seed of SEEDS) {
      const result = harmoniseInto(melodyOf(source({ seed })), DEFAULT_GENERATOR_SETTINGS, {});
      let tick = 0;
      for (const chord of result.composition.chords) {
        expect(chord.startTick, seed).toBe(tick);
        tick = chord.startTick + chord.durationTick;
      }
      expect(tick, seed).toBe(result.composition.totalTicks);
    }
  });

  it("rounds the length up to a bar count the editor accepts", () => {
    // Refusing an odd length would reject most real files and truncating one
    // would silently drop the end of the tune, so the last bars are left empty
    // -- visible, and editable.
    const allowed = [4, 8, 16, 24, 32, 48];
    for (const bars of [4, 8, 16, 32] as const) {
      const result = harmoniseInto(melodyOf(source({ bars })), DEFAULT_GENERATOR_SETTINGS, {});
      expect(allowed, String(bars)).toContain(result.bars);
      expect(result.bars, String(bars)).toBeGreaterThanOrEqual(bars);
    }

    // A melody one tick into its ninth bar takes sixteen, not nine.
    const overhang = [{ midi: 60, startTick: 0, durationTick: 1920 * 8 + 1 }];
    expect(harmoniseInto(overhang, DEFAULT_GENERATOR_SETTINGS, {}).bars).toBe(16);
  });

  it("takes the key from the melody unless it is told one", () => {
    const melody = melodyOf(source({ key: "G" }));
    expect(harmoniseInto(melody, DEFAULT_GENERATOR_SETTINGS, {}).key).toBe("G");
    // An explicit key overrides what the pitches suggest.
    const forced = harmoniseInto(melody, DEFAULT_GENERATOR_SETTINGS, { key: "F", mode: "major" });
    expect(forced.key).toBe("F");
    expect(forced.composition.settings.key).toBe("F");
  });

  it("imposes no song form on someone else's melody", () => {
    // The file's shape is what it is. A verse-chorus plan laid over it would be
    // inventing structure the melody does not have.
    // Checked against settings that DO carry a form, or the assertion passes
    // for the unrelated reason that the defaults have none.
    const withForm = {
      ...DEFAULT_GENERATOR_SETTINGS,
      songForm: { form: "verseChorus" as const },
    } as GeneratorSettings;
    expect(generateComposition(withForm).sections?.length).toBeGreaterThan(0);

    const result = harmoniseInto(melodyOf(source()), withForm, {});
    expect(result.composition.sections).toBeUndefined();
    expect(result.composition.settings.songForm).toBeUndefined();
  });

  it("marks the piece as imported rather than as a seeded one", () => {
    // Nothing here was generated from a seed, and an id that claimed otherwise
    // would promise the piece could be regenerated.
    const result = harmoniseInto(melodyOf(source()), DEFAULT_GENERATOR_SETTINGS, {});
    expect(result.composition.id.startsWith("imported-")).toBe(true);
  });

  it("refuses an empty melody instead of returning an empty piece", () => {
    expect(() => harmoniseInto([], DEFAULT_GENERATOR_SETTINGS, {})).toThrow(MelodyImportError);
  });

  it("is deterministic", () => {
    const melody = melodyOf(source());
    const once = harmoniseInto(melody, DEFAULT_GENERATOR_SETTINGS, {});
    const twice = harmoniseInto(melody, DEFAULT_GENERATOR_SETTINGS, {});
    expect(JSON.stringify(once.composition)).toBe(JSON.stringify(twice.composition));
  });
});

describe("reading the file", () => {
  it("round-trips a piece the app exported", async () => {
    // The end of the chain: export a composition, hand the file back, and get a
    // playable piece built from its own melody.
    for (const seed of SEEDS) {
      const composed = source({ seed });
      const file = fileOf("tune.mid", exportCompositionMidi(composed));
      const result = await importMelodyFile(file, DEFAULT_GENERATOR_SETTINGS);

      expect(result.noteCount, seed).toBeGreaterThan(0);
      expect(validateComposition(result.composition).errors, seed).toEqual([]);
      expect(result.composition.chords.length, seed).toBeGreaterThan(0);
    }
  });

  it("refuses a file that is not a MIDI file, by name and by content", async () => {
    await expect(importMelodyFile(fileOf("notes.txt", new Uint8Array([1, 2])), DEFAULT_GENERATOR_SETTINGS))
      .rejects.toThrow(/\.mid/);
    await expect(importMelodyFile(fileOf("broken.mid", new Uint8Array([1, 2, 3, 4])), DEFAULT_GENERATOR_SETTINGS))
      .rejects.toThrow(MelodyImportError);
  });

  it("passes the parser's own refusal through rather than flattening it", async () => {
    // "format 2 holds independent sequences" tells the user what to do;
    // "import failed" does not.
    const header = [
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 2, 0, 1, 0x01, 0xe0,
      0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 4, 0x00, 0xff, 0x2f, 0x00,
    ];
    await expect(importMelodyFile(fileOf("seq.mid", new Uint8Array(header)), DEFAULT_GENERATOR_SETTINGS))
      .rejects.toThrow(/independent sequences/);
  });

  it("refuses a file too large to be a melody", async () => {
    const huge = { name: "big.mid", size: 9_000_000, arrayBuffer: async () => new ArrayBuffer(0) };
    await expect(importMelodyFile(huge, DEFAULT_GENERATOR_SETTINGS)).rejects.toThrow(/too large/);
  });

  it("says so when the file holds no melody at all", async () => {
    // Percussion only: channel 10 pitches are drum numbers, not notes.
    const track = [0x00, 0x99, 36, 100, 0x60, 0x89, 36, 0, 0x00, 0xff, 0x2f, 0x00];
    const bytes = [
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
      0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length, ...track,
    ];
    await expect(importMelodyFile(fileOf("drums.mid", new Uint8Array(bytes)), DEFAULT_GENERATOR_SETTINGS))
      .rejects.toThrow(/no melody/i);
  });
});
