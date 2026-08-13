import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  MINIMAL_GENERATOR_SETTINGS,
  generateComposition,
  validateComposition,
} from "../src/music";
import { buildCompositionTracks } from "../src/music/compositionTracks";
import {
  CHORD_RHYTHMS,
  STYLE_RHYTHMS,
  applyChordRhythm,
  chordRhythmById,
  rhythmFor,
  rhythmsForMeter,
  voicesFor,
} from "../src/music/chordRhythms";
import type { GeneratorSettings, TimeSignature } from "../src/types/music";

/**
 * When the chord is struck, as opposed to which notes it holds.
 *
 * Measured before this existed: with the arpeggio off, every chord in every
 * style was struck once on its own downbeat and held. One rhythm, for
 * everything. The catalogue's job is to make that a choice rather than the only
 * answer, and most of what is tested here is that a figure survives contact
 * with a real chord -- a chord shorter than the bar, longer than the bar, or
 * holding fewer notes than the pattern wants to split.
 */

const BEAT = 480;
const OPTIONS = { ticksPerBeat: BEAT, beatsPerBar: 4 };
const TRIAD = [60, 64, 67];
const SEEDS = ["a", "b", "c", "d"];

function rhythm(id: string) {
  const found = chordRhythmById(id);
  expect(found, id).toBeDefined();
  return found!;
}

describe("the catalogue", () => {
  it("gives every figure a unique id, a label and a meter", () => {
    const ids = CHORD_RHYTHMS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of CHORD_RHYTHMS) {
      expect(entry.label, entry.id).not.toBe("");
      expect(entry.meters.length, entry.id).toBeGreaterThan(0);
      expect(entry.bar.length, entry.id).toBeGreaterThan(0);
    }
  });

  it("keeps every strike inside the bar it is written for", () => {
    // A strike at or past the bar line belongs to the next bar, and tiling
    // would sound it twice.
    for (const entry of CHORD_RHYTHMS) {
      const beats = entry.meters.includes("3/4") && entry.meters.length === 1 ? 3 : 4;
      for (const strike of entry.bar) {
        expect(strike.at, `${entry.id}@${strike.at}`).toBeGreaterThanOrEqual(0);
        expect(strike.at, `${entry.id}@${strike.at}`).toBeLessThan(beats);
        expect(strike.hold, `${entry.id}@${strike.at}`).toBeGreaterThan(0);
      }
    }
  });

  it("orders each figure's strikes in time", () => {
    // Reading a pattern out of order is the kind of thing that survives review
    // and then sounds wrong in a way nobody can point at.
    for (const entry of CHORD_RHYTHMS) {
      const onsets = entry.bar.map((strike) => strike.at);
      expect([...onsets].sort((l, r) => l - r), entry.id).toEqual(onsets);
    }
  });

  it("never adapts a figure to a meter it was not written for", () => {
    // A waltz in 4/4 is not a waltz, and a 3+3+2 bossa cell in 3/4 is nothing.
    expect(rhythm("waltz").meters).toEqual(["3/4"]);
    expect(rhythmsForMeter("3/4").map((entry) => entry.id)).not.toContain("bossa");
    expect(rhythmsForMeter("4/4").map((entry) => entry.id)).not.toContain("waltz");
  });

  it("offers a block chord in every meter, so there is always an answer", () => {
    for (const meter of ["4/4", "3/4", "6/8"] as TimeSignature[]) {
      expect(rhythmsForMeter(meter).map((entry) => entry.id), meter).toContain("block");
    }
  });
});

describe("choosing a figure", () => {
  it("uses the one that was named", () => {
    expect(rhythmFor("pop", "4/4", "charleston").id).toBe("charleston");
  });

  it("falls back to the style rather than to the named one in the wrong meter", () => {
    // Asking for a bossa in 3/4 is asking for something that does not exist;
    // silently playing it anyway would be worse than not playing it.
    expect(rhythmFor("pop", "3/4", "bossa").meters).toContain("3/4");
    expect(rhythmFor("pop", "3/4", "bossa").id).not.toBe("bossa");
  });

  it("gives each style its own first choice", () => {
    const chosen = new Map<string, string>();
    for (const style of Object.keys(STYLE_RHYTHMS)) {
      chosen.set(style, rhythmFor(style, "4/4").id);
    }
    // Not all different -- some idioms genuinely share a figure -- but not all
    // the same either, which is the state this replaced.
    expect(new Set(chosen.values()).size).toBeGreaterThan(3);
    expect(chosen.get("jazz")).toBe("charleston");
    expect(chosen.get("edm")).toBe("offbeat");
  });

  it("always returns something, even for a style it has never heard of", () => {
    expect(rhythmFor("klezmer", "6/8").id).toBe("block");
  });
});

describe("splitting the hand", () => {
  it("takes the whole chord, one note, or a half", () => {
    expect(voicesFor(TRIAD, "all")).toEqual([60, 64, 67]);
    expect(voicesFor(TRIAD, "top")).toEqual([67]);
    expect(voicesFor(TRIAD, "bottom")).toEqual([60]);
    expect(voicesFor([60, 64, 67, 72], "upper")).toEqual([67, 72]);
    expect(voicesFor([60, 64, 67, 72], "lower")).toEqual([60, 64]);
  });

  it("sorts before splitting, so an unsorted voicing is not divided at random", () => {
    expect(voicesFor([67, 60, 64], "bottom")).toEqual([60]);
    expect(voicesFor([67, 60, 64], "top")).toEqual([67]);
  });

  it("never returns nothing for a chord that has notes", () => {
    // A strike that sounds no notes is a silent bug: the figure looks right in
    // the data and the bar is empty.
    for (const which of ["all", "upper", "lower", "top", "bottom"] as const) {
      for (const chord of [[60], [60, 64], TRIAD, [60, 64, 67, 72, 76]]) {
        expect(voicesFor(chord, which).length, `${which}/${chord.length}`).toBeGreaterThan(0);
      }
    }
  });

  it("has nothing to sound for an empty chord", () => {
    expect(voicesFor([], "all")).toEqual([]);
  });
});

describe("playing a chord as a figure", () => {
  it("puts the strikes where the figure says", () => {
    const notes = applyChordRhythm(TRIAD, 0, BEAT * 4, rhythm("charleston"), OPTIONS);
    expect([...new Set(notes.map((note) => note.startTick))]).toEqual([0, BEAT * 1.5]);
  });

  it("holds each strike for its own length, not the chord's", () => {
    // The rests are the figure. A comping pattern whose notes all run to the
    // end of the bar is a block chord with extra onsets.
    const notes = applyChordRhythm(TRIAD, 0, BEAT * 4, rhythm("offbeat"), OPTIONS);
    for (const note of notes) {
      expect(note.durationTick).toBeLessThan(BEAT);
    }
  });

  it("holds to the end when asked to sustain", () => {
    const notes = applyChordRhythm(TRIAD, 0, BEAT * 4, rhythm("offbeat"), {
      ...OPTIONS, sustain: true,
    });
    for (const note of notes) {
      expect(note.startTick + note.durationTick).toBe(BEAT * 4);
    }
  });

  it("repeats the figure over a chord that lasts more than a bar", () => {
    const notes = applyChordRhythm(TRIAD, 0, BEAT * 8, rhythm("charleston"), OPTIONS);
    expect([...new Set(notes.map((note) => note.startTick))])
      .toEqual([0, BEAT * 1.5, BEAT * 4, BEAT * 5.5]);
  });

  it("takes the head of the figure for a chord shorter than a bar", () => {
    // Half a bar gets half the figure rather than the whole one compressed:
    // a charleston squeezed into two beats is not a charleston.
    const notes = applyChordRhythm(TRIAD, 0, BEAT * 2, rhythm("charleston"), OPTIONS);
    expect([...new Set(notes.map((note) => note.startTick))]).toEqual([0, BEAT * 1.5]);
    for (const note of notes) {
      expect(note.startTick + note.durationTick).toBeLessThanOrEqual(BEAT * 2);
    }
  });

  it("never sounds a note outside the chord it belongs to", () => {
    for (const entry of rhythmsForMeter("4/4")) {
      for (const duration of [BEAT, BEAT * 2, BEAT * 3, BEAT * 4, BEAT * 7]) {
        const notes = applyChordRhythm(TRIAD, BEAT * 5, duration, entry, OPTIONS);
        for (const note of notes) {
          expect(note.startTick, entry.id).toBeGreaterThanOrEqual(BEAT * 5);
          expect(note.startTick + note.durationTick, entry.id)
            .toBeLessThanOrEqual(BEAT * 5 + duration);
        }
      }
    }
  });

  it("returns the strikes in time order", () => {
    for (const entry of rhythmsForMeter("4/4")) {
      const notes = applyChordRhythm([60, 64, 67, 72], 0, BEAT * 4, entry, OPTIONS);
      const onsets = notes.map((note) => note.startTick);
      expect([...onsets].sort((l, r) => l - r), entry.id).toEqual(onsets);
    }
  });

  it("says nothing for an empty chord or a zero-length one", () => {
    expect(applyChordRhythm([], 0, BEAT * 4, rhythm("pulse"), OPTIONS)).toEqual([]);
    expect(applyChordRhythm(TRIAD, 0, 0, rhythm("pulse"), OPTIONS)).toEqual([]);
    expect(applyChordRhythm(TRIAD, 0, BEAT, rhythm("pulse"), { ...OPTIONS, ticksPerBeat: 0 }))
      .toEqual([]);
  });

  it("carries the figure's own accents", () => {
    // The syncopated note of a charleston is the one a player leans on; a
    // figure struck evenly is the machine this replaced.
    const notes = applyChordRhythm(TRIAD, 0, BEAT * 4, rhythm("charleston"), OPTIONS);
    const accents = [...new Set(notes.map((note) => note.accent))];
    expect(accents.length).toBeGreaterThan(1);
    const late = notes.filter((note) => note.startTick === BEAT * 1.5);
    expect(late[0]!.accent).toBeGreaterThan(1);
  });

  it("is deterministic", () => {
    const make = () => JSON.stringify(
      applyChordRhythm([60, 64, 67, 72], 0, BEAT * 6, rhythm("gallop"), OPTIONS));
    expect(make()).toBe(make());
  });
});

describe("in a generated piece", () => {
  function piece(patch: Partial<GeneratorSettings>) {
    return generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS, bars: 16, ...patch,
    } as GeneratorSettings);
  }

  function chordTrack(composed: ReturnType<typeof piece>) {
    return buildCompositionTracks(composed).find((track) => track.midiChannel === 1)!.notes;
  }

  it("gives different styles different rhythms", () => {
    // The state this replaced: every style struck the chord once per chord.
    const shapes = new Set<string>();
    for (const style of ["pop", "rock", "jazz", "edm", "ballad"] as const) {
      const composed = piece({ seed: "r", style, chordRhythm: { enabled: true } });
      const barTicks = composed.ticksPerBar;
      shapes.add([...new Set(chordTrack(composed).map((note) => note.startTick % barTicks))]
        .sort((l, r) => l - r).join(","));
    }
    expect(shapes.size).toBeGreaterThan(2);
  });

  it("strikes the chord more than once per chord where the figure says so", () => {
    const composed = piece({ seed: "r", style: "rock", chordRhythm: { enabled: true } });
    const onsets = new Set(chordTrack(composed).map((note) => note.startTick)).size;
    expect(onsets).toBeGreaterThan(composed.chords.length);
  });

  it("honours a named pattern over the style's own choice", () => {
    const named = piece({ seed: "r", style: "pop", chordRhythm: { enabled: true, pattern: "offbeat" } });
    const barTicks = named.ticksPerBar;
    // The skank leaves the downbeat empty, which is the whole figure.
    const onDownbeat = chordTrack(named).filter((note) => note.startTick % barTicks === 0);
    expect(onDownbeat).toHaveLength(0);
  });

  it("leaves the piece byte-identical when it is not asked for", () => {
    // Against the minimal settings, not the shipped ones: the defaults now ask
    // for a figure, so comparing them to "explicitly off" is comparing two
    // different requests rather than testing that absence changes nothing.
    const minimal = (patch: Partial<GeneratorSettings>) => buildCompositionTracks(
      generateComposition({
        ...MINIMAL_GENERATOR_SETTINGS, bars: 16, seed: "id", ...patch,
      } as GeneratorSettings),
    ).find((track) => track.midiChannel === 1)!.notes;
    expect(JSON.stringify(minimal({ chordRhythm: undefined })))
      .toBe(JSON.stringify(minimal({})));
    // And the arpeggio is untouched by a setting that is not present.
    expect(JSON.stringify(minimal({ arpeggio: { enabled: true }, chordRhythm: undefined })))
      .toBe(JSON.stringify(minimal({ arpeggio: { enabled: true } })));
  });

  it("plays the figure instead of the arpeggio where both are asked for", () => {
    // Two answers to one question -- when is this chord struck -- so only one
    // of them plays, and the figure is the more specific request.
    const both = piece({
      seed: "both", style: "edm",
      arpeggio: { enabled: true }, chordRhythm: { enabled: true, pattern: "offbeat" },
    });
    const barTicks = both.ticksPerBar;
    expect(chordTrack(both).filter((note) => note.startTick % barTicks === 0)).toHaveLength(0);
  });

  it("changes the composition id only when it is asked for", () => {
    const off = piece({ seed: "id", chordRhythm: undefined });
    const on = piece({ seed: "id", chordRhythm: { enabled: true } });
    const named = piece({ seed: "id", chordRhythm: { enabled: true, pattern: "bossa" } });
    expect(on.id).not.toBe(off.id);
    expect(named.id).not.toBe(on.id);
  });

  it("keeps every piece valid across styles and meters", () => {
    for (const style of ["pop", "jazz", "ballad", "edm"] as const) {
      for (const timeSignature of ["4/4", "3/4"] as const) {
        const composed = piece({
          seed: "v", style, timeSignature, chordRhythm: { enabled: true },
        });
        expect(validateComposition(composed).errors, `${style}/${timeSignature}`).toEqual([]);
      }
    }
  });

  it("never writes a note outside its chord", () => {
    for (const seed of SEEDS) {
      const composed = piece({ seed, style: "jazz", chordRhythm: { enabled: true } });
      const byId = new Map(composed.chords.map((chord) => [chord.id, chord]));
      for (const note of chordTrack(composed)) {
        const chord = byId.get(note.id.split("-right-")[0]!);
        if (!chord) continue;
        expect(note.startTick).toBeGreaterThanOrEqual(chord.startTick);
        expect(note.startTick + note.durationTick)
          .toBeLessThanOrEqual(chord.startTick + chord.durationTick);
      }
    }
  });

  it("keeps every velocity legal", () => {
    // The figures carry accents above 1, and dynamics already scales velocity.
    for (const style of ["pop", "rock", "jazz", "edm", "ballad", "game-music"] as const) {
      const composed = piece({ seed: "vel", style, chordRhythm: { enabled: true } });
      for (const note of chordTrack(composed)) {
        expect(note.velocity, style).toBeGreaterThanOrEqual(1);
        expect(note.velocity, style).toBeLessThanOrEqual(127);
      }
    }
  });

  it("is deterministic", () => {
    const make = () => JSON.stringify(chordTrack(
      piece({ seed: "det", style: "jazz", chordRhythm: { enabled: true } })));
    expect(make()).toBe(make());
  });
});
