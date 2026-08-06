import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition, validateComposition } from "../src/music";
import {
  lowIntervalViolation,
  melodyConflict,
  spacingInversion,
  span,
} from "../src/music/voicingRegister";
import {
  selectVoicing,
  voicingCandidates,
  voicingProfileFor,
} from "../src/music/voicingSelection";
import type { ChordQuality, GeneratedComposition, GeneratorSettings, PitchClassName } from "../src/types/music";

/**
 * Voicing that can see the melody, and chooses its own shape.
 *
 * The app writes the chords first and the melody second, so when the voicer
 * runs there is no melody to voice against. Measured before this existed,
 * across eight styles at sixteen bars and five seeds: 198 of 640 chord spans
 * had the melody at or below the chord's top note -- the harmony sitting on
 * top of the tune -- with 45 of 80 in the jazz style alone. Every voicing in
 * every style spanned 8.0 semitones on average with a third at the bottom.
 */

function settings(patch: Partial<GeneratorSettings>): GeneratorSettings {
  return { ...DEFAULT_GENERATOR_SETTINGS, bars: 16, ...patch } as GeneratorSettings;
}

const STYLES = ["pop", "j-pop", "rock", "jazz", "lo-fi", "edm", "ballad", "game-music"] as const;
const SEEDS = ["a", "b", "c", "d", "e"];

/** Chords whose top note is at or above the melody sounding over them. */
function covered(piece: GeneratedComposition): number {
  let total = 0;
  for (const chord of piece.chords) {
    const end = chord.startTick + chord.durationTick;
    const melody = piece.notes
      .filter((note) => note.startTick < end && note.startTick + note.durationTick > chord.startTick)
      .map((note) => note.midi);
    if (melody.length === 0) continue;
    if (melodyConflict(chord.notes, melody).covering > 0) total += 1;
  }
  return total;
}

function minorNinths(piece: GeneratedComposition): number {
  let total = 0;
  for (const chord of piece.chords) {
    const end = chord.startTick + chord.durationTick;
    const melody = piece.notes
      .filter((note) => note.startTick < end && note.startTick + note.durationTick > chord.startTick)
      .map((note) => note.midi);
    total += melodyConflict(chord.notes, melody).minorNinth;
  }
  return total;
}

function across(patch: Partial<GeneratorSettings>, measure: (piece: GeneratedComposition) => number) {
  let total = 0;
  for (const style of STYLES) {
    for (const seed of SEEDS) {
      total += measure(generateComposition(settings({ ...patch, style, seed })));
    }
  }
  return total;
}

describe("melody-aware voicing", () => {
  it("stops the harmony sitting on top of the melody", () => {
    // The claim the whole feature rests on, measured rather than asserted.
    const before = across({}, covered);
    const after = across({ melodyVoicing: { enabled: true } }, covered);

    expect(before).toBeGreaterThan(150);
    // Measured: 198 down to 5.
    expect(after).toBeLessThan(before / 10);
  });

  it("removes most of the minor-ninth clashes as well", () => {
    // A chord tone a minor ninth below a melody note is the specific harsh
    // clash -- thirteen semitones, and the octave displacement is what makes it
    // harsh rather than merely dissonant.
    const before = across({}, minorNinths);
    const after = across({ melodyVoicing: { enabled: true } }, minorNinths);
    expect(before).toBeGreaterThan(40);
    expect(after).toBeLessThan(before / 2);
  });

  it("never writes an interval below its low interval limit", () => {
    // An acoustic floor, not a preference: below it two tones fuse into
    // roughness instead of harmony. Weighted above every style preference so a
    // voicing that violates it loses to one that does not.
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const piece = generateComposition(
          settings({ style, seed, melodyVoicing: { enabled: true } }),
        );
        for (const chord of piece.chords) {
          expect(lowIntervalViolation([...chord.notes].sort((a, b) => a - b)), `${style}/${seed}`)
            .toBe(0);
        }
      }
    }
  });

  it("opens the register up where the style asks for it", () => {
    // Measured before: every style averaged 8.0 semitones, a fourth to a sixth
    // wide, with a third at the bottom.
    const meanSpan = (style: GeneratorSettings["style"], on: boolean) => {
      let total = 0;
      let count = 0;
      for (const seed of SEEDS) {
        const piece = generateComposition(settings({
          style, seed, ...(on ? { melodyVoicing: { enabled: true } } : {}),
        }));
        for (const chord of piece.chords) {
          total += span([...chord.notes].sort((a, b) => a - b));
          count += 1;
        }
      }
      return total / count;
    };

    // Jazz and lo-fi ask for the widest voicings and get them: 8.0 to over 14.
    for (const style of ["jazz", "lo-fi", "ballad"] as const) {
      expect(meanSpan(style, false), style).toBeLessThan(9);
      expect(meanSpan(style, true), style).toBeGreaterThan(11);
    }
    // Rock and game-music ask for plain, narrow voicings, and a change that
    // widened those too would be a change that ignored the style.
    for (const style of ["rock", "game-music"] as const) {
      expect(meanSpan(style, true), style).toBeLessThan(11);
    }
  });

  it("still passes the composition's own validation", () => {
    // Rootless and quartal shapes omit chord tones and reach for extensions;
    // validateComposition holds a plain chord to exactly its own pitch-class
    // set and rejects anything foreign.
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        for (const tensions of [undefined, { enabled: true, rate: 1 }]) {
          const piece = generateComposition(settings({
            style, seed, tensions, melodyVoicing: { enabled: true },
          }));
          const outcome = validateComposition(piece);
          expect(outcome.errors.map((issue) => issue.code), `${style}/${seed}`).toEqual([]);
        }
      }
    }
  });

  it("keeps every colour tone the first pass put there", () => {
    // The defect this caught: without the tension stack the second pass voices
    // the plain triad, the chord still declares its ninth, and the note simply
    // stops sounding while validation stays happy.
    for (const style of ["jazz", "pop", "ballad"] as const) {
      for (const seed of SEEDS) {
        const base = { style, seed, tensions: { enabled: true, rate: 1 } } as Partial<GeneratorSettings>;
        const plain = generateComposition(settings(base));
        const revoiced = generateComposition(settings({ ...base, melodyVoicing: { enabled: true } }));

        for (const [index, chord] of revoiced.chords.entries()) {
          const original = plain.chords[index]!;
          expect(chord.tensions ?? [], `${style}/${seed}`).toEqual(original.tensions ?? []);
          if ((chord.tensions?.length ?? 0) === 0) continue;
          // Same pitch classes sounding, whatever octave they moved to.
          const sounding = new Set(chord.notes.map((note) => ((note % 12) + 12) % 12));
          const wanted = new Set(original.notes.map((note) => ((note % 12) + 12) % 12));
          for (const pitchClass of wanted) {
            expect(sounding.has(pitchClass), `${style}/${seed} lost pc ${pitchClass}`).toBe(true);
          }
        }
      }
    }
  });

  it("moves octaves and never pitch classes", () => {
    // The property that makes a second pass safe at all. Everything the melody
    // generator scored against is stated in pitch classes, so it survives.
    for (const style of STYLES) {
      const base = { style, seed: "pc" } as Partial<GeneratorSettings>;
      const plain = generateComposition(settings(base));
      const revoiced = generateComposition(settings({ ...base, melodyVoicing: { enabled: true } }));
      expect(revoiced.chords).toHaveLength(plain.chords.length);
      for (const [index, chord] of revoiced.chords.entries()) {
        const original = plain.chords[index]!;
        expect(chord.symbol, style).toBe(original.symbol);
        expect(chord.root, style).toBe(original.root);
        expect(chord.quality, style).toBe(original.quality);
        expect(new Set(chord.notes.map((note) => ((note % 12) + 12) % 12)), style)
          .toEqual(new Set(original.notes.map((note) => ((note % 12) + 12) % 12)));
      }
    }
  });

  it("leaves the melody itself untouched", () => {
    // Re-voicing is a harmony decision. A pass that also moved the tune would
    // be rewriting the piece, not voicing it.
    for (const style of STYLES) {
      const base = { style, seed: "mel" } as Partial<GeneratorSettings>;
      const plain = generateComposition(settings(base));
      const revoiced = generateComposition(settings({ ...base, melodyVoicing: { enabled: true } }));
      expect(JSON.stringify(revoiced.notes), style).toBe(JSON.stringify(plain.notes));
    }
  });

  it("leaves the piece byte-identical when it is not asked for", () => {
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const absent = generateComposition(settings({ style, seed }));
        const explicit = generateComposition(
          settings({ style, seed, melodyVoicing: { enabled: false } }),
        );
        // Everything the listener hears, plus the id, which is what tells a
        // saved project it is the same piece. The settings object itself
        // differs by the echoed flag, and that is the point of the flag.
        expect(explicit.id, `${style}/${seed}`).toBe(absent.id);
        expect(JSON.stringify(explicit.chords), `${style}/${seed}`).toBe(JSON.stringify(absent.chords));
        expect(JSON.stringify(explicit.notes), `${style}/${seed}`).toBe(JSON.stringify(absent.notes));
        expect(JSON.stringify(explicit.voices), `${style}/${seed}`).toBe(JSON.stringify(absent.voices));
      }
    }
  });

  it("changes the composition id only when it is set", () => {
    const off = generateComposition(settings({ seed: "id" }));
    const on = generateComposition(settings({ seed: "id", melodyVoicing: { enabled: true } }));
    expect(on.id).not.toBe(off.id);
    expect(generateComposition(settings({ seed: "id" })).id).toBe(off.id);
  });

  it("is deterministic", () => {
    const make = () => generateComposition(
      settings({ seed: "det", style: "jazz", melodyVoicing: { enabled: true } }),
    );
    expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
  });
});

describe("choosing the shape rather than being told one", () => {
  const C = "C" as PitchClassName;

  it("ducks under a low melody and rises under a high one", () => {
    // The same chord, the same style, two melodies. Nothing names a shape.
    const low = selectVoicing(C, "major7" as ChordQuality, undefined, { style: "jazz", melody: [60] });
    const high = selectVoicing(C, "major7" as ChordQuality, undefined, { style: "jazz", melody: [84] });

    expect(low).not.toBeNull();
    expect(high).not.toBeNull();
    expect(Math.max(...low!.notes)).toBeLessThan(60);
    expect(Math.max(...high!.notes)).toBeLessThan(84);
    expect(Math.max(...high!.notes)).toBeGreaterThan(Math.max(...low!.notes));
  });

  it("offers a seventh chord more shapes than a triad", () => {
    const profile = voicingProfileFor("jazz");
    const triad = voicingCandidates(C, "major" as ChordQuality, undefined, profile);
    const seventh = voicingCandidates(C, "major7" as ChordQuality, undefined, profile);
    expect(new Set(seventh.map((entry) => entry.shape)).size)
      .toBeGreaterThan(new Set(triad.map((entry) => entry.shape)).size);
  });

  it("never offers a shape the style has excluded", () => {
    // A rootless voicing in a game-music cue is wrong in a way a rootless
    // voicing in a jazz tune is not.
    //
    // Checked on chords that DECLARE the extensions those shapes need. On a
    // plain seventh the rootless and quartal forms are already unavailable for
    // an unrelated reason -- they sound a ninth the chord never declared -- so
    // a plain chord proves nothing about the style exclusion.
    const ninth = ["9"] as const;
    const stack = [0, 4, 10, 14];
    let sawExcludable = false;
    for (const style of STYLES) {
      const profile = voicingProfileFor(style);
      const offered = voicingCandidates(C, "dominant7" as ChordQuality, ninth, profile, stack);
      for (const entry of offered) {
        expect(profile.excluded, `${style}/${entry.shape}`).not.toContain(entry.shape);
      }
      // And the exclusion has to actually be doing something somewhere, or the
      // assertion above is vacuous.
      const unfiltered = voicingCandidates(
        C, "dominant7" as ChordQuality, ninth,
        { ...profile, excluded: [] }, stack,
      );
      if (profile.excluded.length > 0 && unfiltered.length > offered.length) sawExcludable = true;
    }
    expect(sawExcludable).toBe(true);
  });

  it("never offers a voicing that sounds a tone the chord has not declared", () => {
    // A rootless A form of a plain major seventh sounds a ninth, which makes it
    // a different chord than the symbol printed on the lane.
    for (const style of STYLES) {
      const profile = voicingProfileFor(style);
      for (const quality of ["major", "major7", "minor7", "dominant7", "sus4"] as const) {
        const own = new Set([0, 4, 7, 11, 3, 10, 5, 2].filter(() => true));
        void own;
        for (const entry of voicingCandidates(C, quality as ChordQuality, undefined, profile)) {
          const declared = new Set(
            (quality === "major" ? [0, 4, 7]
              : quality === "major7" ? [0, 4, 7, 11]
              : quality === "minor7" ? [0, 3, 7, 10]
              : quality === "dominant7" ? [0, 4, 7, 10]
              : [0, 5, 7]),
          );
          for (const note of entry.notes) {
            expect(declared.has(((note % 12) + 12) % 12), `${style}/${quality}/${entry.shape}`)
              .toBe(true);
          }
        }
      }
    }
  });

  it("keeps every candidate inside a playable register", () => {
    for (const style of STYLES) {
      const profile = voicingProfileFor(style);
      for (const quality of ["major", "major7", "minor7", "dominant7"] as const) {
        for (const entry of voicingCandidates(C, quality as ChordQuality, undefined, profile)) {
          expect(Math.min(...entry.notes), style).toBeGreaterThanOrEqual(36);
          expect(Math.max(...entry.notes), style).toBeLessThanOrEqual(88);
        }
      }
    }
  });

  it("returns the same voicing for the same inputs", () => {
    const once = selectVoicing(C, "minor7" as ChordQuality, undefined, { style: "jazz", melody: [72] });
    const twice = selectVoicing(C, "minor7" as ChordQuality, undefined, { style: "jazz", melody: [72] });
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });
});

describe("the register model", () => {
  it("reports a low third as a violation and a low fifth as clear", () => {
    // Critical bandwidth widens as frequency falls, so a major third that is
    // clear at middle C is mud two octaves down, while a fifth stays clear
    // much lower. This is why an open voicing may sit where a close one may not.
    expect(lowIntervalViolation([36, 40])).toBeGreaterThan(0);
    expect(lowIntervalViolation([36, 43])).toBe(0);
    expect(lowIntervalViolation([60, 64])).toBe(0);
  });

  it("stops constraining above an octave", () => {
    // The reason a spread voicing can reach low ground a close one cannot.
    // Deliberately below the octave limit of MIDI 28: a tenth down here is
    // clear, while treating it as if the octave rule still applied would
    // report a violation and push every wide voicing back up the keyboard.
    expect(lowIntervalViolation([26, 40])).toBe(0);
    expect(lowIntervalViolation([30, 44])).toBe(0);
    // The octave itself is still constrained, which is what makes the cutoff
    // a boundary rather than an absence of any rule.
    expect(lowIntervalViolation([26, 38])).toBeGreaterThan(0);
  });

  it("reports gaps that widen going up", () => {
    // Wide at the bottom, close at the top, is the spacing of every idiomatic
    // keyboard voicing. The other way round reads as thin and unresolved.
    expect(spacingInversion([48, 55, 59])).toBe(0);
    expect(spacingInversion([48, 52, 59])).toBeGreaterThan(0);
  });

  it("counts a chord tone thirteen semitones under a melody note", () => {
    expect(melodyConflict([60], [73]).minorNinth).toBe(1);
    // Fourteen is a major ninth and is not the clash.
    expect(melodyConflict([60], [74]).minorNinth).toBe(0);
    // One is a semitone, dissonant but not the same fault.
    expect(melodyConflict([60], [61]).minorNinth).toBe(0);
  });

  it("permits the flat ninth a dominant chord is entitled to", () => {
    expect(melodyConflict([60], [73], new Set([0])).minorNinth).toBe(0);
    expect(melodyConflict([60], [73], new Set([5])).minorNinth).toBe(1);
  });

  it("reports covering only when the chord reaches the melody", () => {
    expect(melodyConflict([60, 64, 67], [72]).covering).toBe(0);
    expect(melodyConflict([60, 64, 67], [67]).covering).toBeGreaterThan(0);
    expect(melodyConflict([60, 64, 67], [64]).covering).toBeGreaterThan(0);
  });

  it("says nothing when there is no melody to conflict with", () => {
    expect(melodyConflict([60, 64, 67], undefined)).toEqual({ covering: 0, minorNinth: 0 });
    expect(melodyConflict([60, 64, 67], [])).toEqual({ covering: 0, minorNinth: 0 });
  });
});
