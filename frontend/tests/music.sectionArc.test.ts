import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import { buildCompositionTracks } from "../src/music/compositionTracks";
import type { GeneratedComposition, GeneratorSettings, SectionKind } from "../src/types/music";

/**
 * A piece that goes somewhere.
 *
 * Dynamics worked at two scales -- where a note sits in its bar, and where a
 * voice sits in its chord -- and both are inside a single chord. Neither makes
 * a piece develop, and measured, nothing did: across eight styles the loudest
 * quarter of a sixteen-bar piece averaged 0.8 velocity above the quietest, and
 * a chorus was struck no harder than the intro before it. The sections existed
 * and changed nothing an ear could find.
 */

const STYLES = ["pop", "j-pop", "jazz", "ballad", "rock", "edm", "lo-fi", "game-music"] as const;
const SEEDS = ["a", "b", "c", "d", "e"];

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return { ...DEFAULT_GENERATOR_SETTINGS, bars: 16, ...patch } as GeneratorSettings;
}

/** Mean velocity of everything sounding inside the sections of one kind. */
function loudnessOf(piece: GeneratedComposition, kind: SectionKind): number {
  const tracks = buildCompositionTracks(piece);
  const notes = (piece.sections ?? [])
    .filter((section) => section.kind === kind)
    .flatMap((section) => tracks.flatMap((track) => track.notes.filter((note) => {
      const bar = Math.floor(note.startTick / piece.ticksPerBar);
      return bar >= section.startBar && bar < section.endBar;
    })));
  if (notes.length === 0) return 0;
  return notes.reduce((sum, note) => sum + note.velocity, 0) / notes.length;
}

describe("the shape of a piece", () => {
  it("plays a chorus harder than the verse that set it up", () => {
    // Most of what "arrival" is, and no amount of voicing supplies it.
    // Measured: the gap was 0.8 velocity and is now about 15.
    let gap = 0;
    let counted = 0;
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const piece = generateComposition(settings({ style, seed }));
        const chorus = loudnessOf(piece, "chorus");
        const verse = loudnessOf(piece, "verse");
        if (chorus === 0 || verse === 0) continue;
        expect(chorus, `${style}/${seed}`).toBeGreaterThan(verse);
        gap += chorus - verse;
        counted += 1;
      }
    }
    expect(counted).toBeGreaterThan(20);
    expect(gap / counted).toBeGreaterThan(8);
  });

  it("opens quietly and closes quietly", () => {
    for (const style of STYLES) {
      const piece = generateComposition(settings({ style, seed: "arc" }));
      const intro = loudnessOf(piece, "intro");
      const outro = loudnessOf(piece, "outro");
      const chorus = loudnessOf(piece, "chorus");
      if (intro > 0) expect(intro, style).toBeLessThan(chorus);
      if (outro > 0) expect(outro, style).toBeLessThan(chorus);
    }
  });

  it("builds through the pre-chorus rather than jumping", () => {
    // The point of a pre-chorus is that it is on the way somewhere.
    for (const style of STYLES) {
      const piece = generateComposition(settings({ style, seed: "build" }));
      const verse = loudnessOf(piece, "verse");
      const pre = loudnessOf(piece, "preChorus");
      const chorus = loudnessOf(piece, "chorus");
      if (verse === 0 || pre === 0 || chorus === 0) continue;
      expect(pre, style).toBeGreaterThan(verse);
      expect(pre, style).toBeLessThan(chorus);
    }
  });

  it("moves the loudest quarter of the piece well clear of the quietest", () => {
    let spread = 0;
    let counted = 0;
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const piece = generateComposition(settings({ style, seed }));
        const tracks = buildCompositionTracks(piece);
        const quarter = (from: number, to: number) => {
          const notes = tracks.flatMap((track) => track.notes.filter((note) => {
            const bar = Math.floor(note.startTick / piece.ticksPerBar);
            return bar >= from && bar < to;
          }));
          return notes.length === 0
            ? 0
            : notes.reduce((sum, note) => sum + note.velocity, 0) / notes.length;
        };
        const quarters = [quarter(0, 4), quarter(4, 8), quarter(8, 12), quarter(12, 16)]
          .filter((value) => value > 0);
        spread += Math.max(...quarters) - Math.min(...quarters);
        counted += 1;
      }
    }
    // Measured: 0.8 before, about 16 after.
    expect(spread / counted).toBeGreaterThan(8);
  });

  it("does nothing to a piece with no sections", () => {
    // Without a form there is nothing to shape, and inventing a shape would be
    // inventing structure the piece does not have.
    for (const seed of SEEDS) {
      const plain = generateComposition(settings({ seed, songForm: { form: "none" } }));
      expect(plain.sections).toBeUndefined();
      const velocities = new Set(
        buildCompositionTracks(plain).flatMap((track) => track.notes.map((note) => note.velocity)),
      );
      // Still shaped inside the bar and inside the chord, just not across the
      // piece: the other two scales of dynamics are untouched.
      expect(velocities.size).toBeGreaterThan(1);
    }
  });

  it("does nothing when dynamics are switched off", () => {
    const arc = generateComposition(settings({ seed: "off" }));
    const flat = generateComposition(settings({ seed: "off", dynamics: { enabled: false } }));
    expect(loudnessOf(arc, "chorus") - loudnessOf(arc, "verse")).toBeGreaterThan(8);
    // Not exactly equal: groove varies the melody's own velocities in the
    // composition data, so two sections differ a little whatever the arc does.
    // What must be gone is the arc, not every difference.
    expect(Math.abs(loudnessOf(flat, "chorus") - loudnessOf(flat, "verse"))).toBeLessThan(2);
  });

  it("leaves the composition's own velocities alone", () => {
    // A rendering decision, like the register and the figure. The same seed
    // still describes the same piece; only the performance of it changes.
    //
    // Compared against the same piece with the arc off rather than against a
    // fixed number, because groove writes its own accents into the melody and
    // those belong to the composition.
    const arc = generateComposition(settings({ seed: "data" }));
    const flat = generateComposition(settings({ seed: "data", dynamics: { enabled: false } }));
    expect(JSON.stringify(arc.notes.map((note) => note.velocity)))
      .toBe(JSON.stringify(flat.notes.map((note) => note.velocity)));
    expect(JSON.stringify(arc.chords)).toBe(JSON.stringify(flat.chords));
  });

  it("never writes a velocity outside the legal range", () => {
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const piece = generateComposition(settings({ style, seed, bars: 32 }));
        for (const track of buildCompositionTracks(piece)) {
          for (const note of track.notes) {
            expect(Number.isInteger(note.velocity), `${style}/${seed}`).toBe(true);
            expect(note.velocity, `${style}/${seed}`).toBeGreaterThanOrEqual(1);
            expect(note.velocity, `${style}/${seed}`).toBeLessThanOrEqual(127);
          }
        }
      }
    }
  });
});

describe("how long each section is", () => {
  it("gives a chorus more room than an intro", () => {
    // An even split gave every section the same length, so a chorus arrived and
    // left in the same breath as the intro. Measured: a sixteen-bar piece was
    // eight two-bar sections.
    for (const bars of [16, 24, 32, 48] as const) {
      const piece = generateComposition(settings({ bars, seed: "len" }));
      const of = (kind: SectionKind) => (piece.sections ?? [])
        .filter((section) => section.kind === kind)
        .map((section) => section.endBar - section.startBar);
      expect(Math.min(...of("chorus")), `${bars}`).toBeGreaterThan(Math.max(...of("intro")));
      expect(Math.min(...of("verse")), `${bars}`).toBeGreaterThan(Math.max(...of("preChorus")));
    }
  });

  it("gives two sections of the same kind the same length", () => {
    // A verse of three bars followed by one of two is not a repeat: the same
    // progression restated over a different number of bars is different music.
    for (const form of ["verseChorus", "aaba", "throughComposed"] as const) {
      for (const bars of [4, 8, 16, 24, 32, 48] as const) {
        const piece = generateComposition(settings({ bars, seed: "eq", songForm: { form } }));
        const lengths = new Map<SectionKind, Set<number>>();
        for (const section of piece.sections ?? []) {
          const set = lengths.get(section.kind) ?? new Set<number>();
          set.add(section.endBar - section.startBar);
          lengths.set(section.kind, set);
        }
        for (const [kind, set] of lengths) {
          // through-composed is the exception it names: it never restates, so
          // its repeats of a kind are not repeats of material.
          if (form === "throughComposed") continue;
          expect(set.size, `${form}/${bars}/${kind}`).toBe(1);
        }
      }
    }
  });

  it("still fills exactly the bars it was asked for", () => {
    for (const form of ["verseChorus", "aaba", "throughComposed"] as const) {
      for (const bars of [4, 8, 16, 24, 32, 48] as const) {
        const piece = generateComposition(settings({ bars, seed: "fill", songForm: { form } }));
        const sections = piece.sections ?? [];
        expect(sections.length, `${form}/${bars}`).toBeGreaterThan(0);
        let cursor = 0;
        for (const section of sections) {
          expect(section.startBar, `${form}/${bars}`).toBe(cursor);
          expect(section.endBar - section.startBar, `${form}/${bars}`).toBeGreaterThan(0);
          cursor = section.endBar;
        }
        expect(cursor, `${form}/${bars}`).toBe(bars);
      }
    }
  });
});
