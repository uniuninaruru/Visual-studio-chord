import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import {
  candidatesFor,
  findKey,
  transitionCostsFor,
  harmonizeMelody,
  segmentCost,
  segmentMelody,
  type HarmonizerNote,
} from "../src/music/melodyHarmonizer";
import type { GeneratorSettings, Mode, PitchClassName } from "../src/types/music";

/**
 * Chords from a melody -- the reverse of everything else in this app.
 *
 * The honest test is not whether it recovers the exact chords a melody was
 * written against. Choosing vi where the original had I is a reharmonisation,
 * not a mistake. What matters is whether the melody sits on what comes out.
 *
 * Measured across five styles and ten seeds at sixteen bars: the melody lands
 * on a chord tone 89% of the time in major and 88% in minor, against 92% for
 * the accompaniment the melody was actually composed over.
 */

const SEEDS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
const STYLES = ["pop", "j-pop", "jazz", "ballad", "rock"] as const;

function melodyOf(piece: { notes: ReadonlyArray<{ midi: number; startTick: number; durationTick: number }> }): HarmonizerNote[] {
  return piece.notes.map((note) => ({
    midi: note.midi, startTick: note.startTick, durationTick: note.durationTick,
  }));
}

function piece(patch: Partial<GeneratorSettings>) {
  return generateComposition({
    ...DEFAULT_GENERATOR_SETTINGS, bars: 16, key: "C", ...patch,
  } as GeneratorSettings);
}

describe("finding the key", () => {
  it("names the key of a generated melody most of the time", () => {
    // Measured: 47 of 50 across five keys and ten seeds.
    let correct = 0;
    let total = 0;
    for (const key of ["C", "G", "F", "D", "A"] as const) {
      for (const seed of SEEDS) {
        const composed = piece({ key, seed });
        total += 1;
        if (findKey(melodyOf(composed))?.key === key) correct += 1;
      }
    }
    expect(correct / total).toBeGreaterThan(0.85);
  });

  it("weights a held note above a passing one", () => {
    // A histogram that counted notes rather than time would be swayed by
    // ornament: here D sounds four times briefly and C once for a whole bar.
    const notes: HarmonizerNote[] = [
      { midi: 60, startTick: 0, durationTick: 1920 },
      { midi: 62, startTick: 1920, durationTick: 60 },
      { midi: 62, startTick: 1980, durationTick: 60 },
      { midi: 62, startTick: 2040, durationTick: 60 },
      { midi: 62, startTick: 2100, durationTick: 60 },
      { midi: 67, startTick: 2160, durationTick: 960 },
      { midi: 64, startTick: 3120, durationTick: 720 },
    ];
    expect(findKey(notes)?.key).toBe("C");
  });

  it("says nothing rather than guessing when there is nothing to go on", () => {
    expect(findKey([])).toBeNull();
    expect(findKey([{ midi: 60, startTick: 0, durationTick: 0 }])).toBeNull();
  });

  it("reports no correlation for a melody on one pitch", () => {
    // A single pitch has no variance to correlate against. Returning a
    // confident key would be a lie the caller cannot see through.
    const flat = findKey([{ midi: 60, startTick: 0, durationTick: 480 }]);
    expect(flat).not.toBeNull();
    expect(Math.abs(flat!.correlation)).toBeLessThan(0.9);
  });

  it("is deterministic, including its tie-breaking", () => {
    const notes = melodyOf(piece({ seed: "k" }));
    expect(JSON.stringify(findKey(notes))).toBe(JSON.stringify(findKey(notes)));
    // A chromatic melody correlates equally badly with everything; it still has
    // to name one key rather than a different one each call.
    const chromatic: HarmonizerNote[] = Array.from({ length: 12 }, (_, index) => ({
      midi: 60 + index, startTick: index * 240, durationTick: 240,
    }));
    expect(findKey(chromatic)?.key).toBe(findKey(chromatic)?.key);
  });
});

describe("segmenting", () => {
  const options = { bars: 2, timeSignature: "4/4" as const, ppq: 480 };

  it("gives a bar its own chord when nothing asks the harmony to move", () => {
    // Both halves sound the same pitches, so there is nothing to move for.
    const steady: HarmonizerNote[] = [
      { midi: 60, startTick: 0, durationTick: 960 },
      { midi: 60, startTick: 960, durationTick: 960 },
    ];
    expect(segmentMelody(steady, { ...options, bars: 1 })).toEqual([
      { startTick: 0, durationTick: 1920 },
    ]);
  });

  it("splits a bar whose second half brings new pitches", () => {
    const moving: HarmonizerNote[] = [
      { midi: 60, startTick: 0, durationTick: 960 },
      { midi: 65, startTick: 960, durationTick: 960 },
    ];
    expect(segmentMelody(moving, { ...options, bars: 1 })).toEqual([
      { startTick: 0, durationTick: 960 },
      { startTick: 960, durationTick: 960 },
    ]);
  });

  it("holds one chord per bar when told to", () => {
    const moving: HarmonizerNote[] = [
      { midi: 60, startTick: 0, durationTick: 960 },
      { midi: 65, startTick: 960, durationTick: 960 },
    ];
    expect(segmentMelody(moving, { ...options, bars: 1, maxChordsPerBar: 1 })).toEqual([
      { startTick: 0, durationTick: 1920 },
    ]);
  });

  it("tiles the whole span exactly", () => {
    for (const timeSignature of ["4/4", "3/4", "6/8"] as const) {
      const notes = melodyOf(piece({ seed: "seg", timeSignature }));
      const segments = segmentMelody(notes, { bars: 16, timeSignature, ppq: 480 });
      let tick = 0;
      for (const segment of segments) {
        expect(segment.startTick, timeSignature).toBe(tick);
        expect(segment.durationTick, timeSignature).toBeGreaterThan(0);
        tick = segment.startTick + segment.durationTick;
      }
      expect(tick, timeSignature).toBe(16 * (timeSignature === "4/4" ? 1920 : 1440));
    }
  });

  it("covers a bar with no melody in it at all", () => {
    expect(segmentMelody([], { ...options, bars: 4 })).toHaveLength(4);
  });
});

describe("scoring a chord against the notes over it", () => {
  const options = { timeSignature: "4/4" as const, ppq: 480 };
  const segment = { startTick: 0, durationTick: 1920 };
  const cMajor = { degree: 1, intervals: [0, 4, 7], seventh: false, label: "I" };

  it("costs nothing when every note is a chord tone", () => {
    const notes: HarmonizerNote[] = [
      { midi: 60, startTick: 0, durationTick: 960 },
      { midi: 64, startTick: 960, durationTick: 960 },
    ];
    expect(segmentCost(cMajor, 0, notes, segment, options)).toBe(0);
  });

  it("charges a long note on a strong beat far more than a short one off it", () => {
    // The asymmetry that makes the result musical rather than merely
    // consistent: a passing sixteenth is nearly free, a held downbeat is not.
    const heldDownbeat: HarmonizerNote[] = [{ midi: 62, startTick: 0, durationTick: 1920 }];
    const passing: HarmonizerNote[] = [{ midi: 62, startTick: 240, durationTick: 120 }];
    expect(segmentCost(cMajor, 0, heldDownbeat, segment, options))
      .toBeGreaterThan(segmentCost(cMajor, 0, passing, segment, options) * 10);
  });

  it("charges the same note more on a strong beat than on a weak one", () => {
    // Isolated from duration: identical notes, identical lengths, different
    // metric positions. A cost that read only duration would score these alike
    // and the harmoniser would reharmonise for the sake of an offbeat.
    const onDownbeat: HarmonizerNote[] = [{ midi: 62, startTick: 0, durationTick: 240 }];
    const onOffbeat: HarmonizerNote[] = [{ midi: 62, startTick: 240, durationTick: 240 }];
    expect(segmentCost(cMajor, 0, onDownbeat, segment, options))
      .toBeGreaterThan(segmentCost(cMajor, 0, onOffbeat, segment, options));

    // And the half-bar outranks a plain offbeat, which is the shape of the
    // metric hierarchy rather than just "first note loudest".
    const onHalfBar: HarmonizerNote[] = [{ midi: 62, startTick: 960, durationTick: 240 }];
    expect(segmentCost(cMajor, 0, onHalfBar, segment, options))
      .toBeGreaterThan(segmentCost(cMajor, 0, onOffbeat, segment, options));
  });

  it("treats a semitone neighbour more gently than a whole tone", () => {
    // Appoggiaturas and chromatic passing tones behave this way, and charging
    // them equally would drive the harmoniser to reharmonise every ornament.
    const semitone: HarmonizerNote[] = [{ midi: 63, startTick: 0, durationTick: 480 }];
    const tone: HarmonizerNote[] = [{ midi: 62, startTick: 0, durationTick: 480 }];
    expect(segmentCost(cMajor, 0, semitone, segment, options))
      .toBeLessThan(segmentCost(cMajor, 0, tone, segment, options));
  });

  it("charges something for a segment with nothing sounding in it", () => {
    // Otherwise every silent bar is free and takes whatever chord the
    // transition prior happens to like.
    expect(segmentCost(cMajor, 0, [], segment, options)).toBeGreaterThan(0);
  });
});

describe("the candidate set", () => {
  it("offers all seven degrees", () => {
    for (const mode of ["major", "naturalMinor"] as const) {
      const degrees = new Set(candidatesFor(mode, false).map((entry) => entry.degree));
      expect(degrees, mode).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]));
    }
  });

  it("offers a minor key the major dominant it actually cadences on", () => {
    // A minor key does not cadence on its own diatonic v; the seventh degree is
    // raised to make a leading tone. Without this the harmoniser can never
    // propose the chord a minor piece is most likely to end on, and measured,
    // it scored 43% against melodies whose cadences it could not match.
    const fifths = candidatesFor("naturalMinor", true).filter((entry) => entry.degree === 5);
    // Both the triad and the seventh, because a piece that cadences with a
    // plain V is not obliged to sound the seventh, and offering only the
    // seventh would put one there in every cadence.
    expect(fifths.some((entry) => entry.intervals.length === 3 && entry.intervals[1] === 4)).toBe(true);
    expect(fifths.some((entry) => entry.intervals.length === 4 && entry.intervals[1] === 4)).toBe(true);
    // The natural-minor v is still offered: a minor piece uses both.
    expect(fifths.some((entry) => entry.intervals[1] === 3)).toBe(true);

    // The raised seventh degree comes with it, since the same leading tone
    // makes the diminished chord on VII.
    const sevenths = candidatesFor("naturalMinor", false).filter((entry) => entry.degree === 7);
    expect(sevenths.some((entry) => entry.intervals[2] === 6)).toBe(true);
  });

  it("withholds sevenths when they are not wanted", () => {
    expect(candidatesFor("major", false).every((entry) => entry.intervals.length === 3)).toBe(true);
    expect(candidatesFor("major", true).some((entry) => entry.intervals.length === 4)).toBe(true);
    expect(candidatesFor("naturalMinor", false).every((entry) => entry.intervals.length === 3))
      .toBe(true);
  });
});

describe("the transition prior", () => {
  it("derives the major table from the catalogue rather than inventing it", () => {
    // 129 degree-to-degree moves across 28 documented progressions, each of
    // which was admitted to the catalogue only because several independent
    // sources describe it with the same name and the same degrees. A prior
    // written by hand is a guess about how music moves; this is a count of how
    // the progressions people actually named do move.
    const major = transitionCostsFor("major");
    expect(major).toHaveLength(7);
    for (const row of major) expect(row).toHaveLength(7);

    // What the catalogue plainly teaches has to come out cheaper than what it
    // does not: ii goes to V ten times out of thirteen moves from ii.
    const fromTwo = major[1]!;
    expect(fromTwo[4]!).toBeLessThan(fromTwo[2]!);
    expect(fromTwo[4]!).toBeLessThan(fromTwo[6]!);
    // V resolves to I more than anywhere else.
    const fromFive = major[4]!;
    expect(fromFive[0]!).toBeLessThan(fromFive[1]!);
    expect(fromFive[0]!).toBeLessThan(fromFive[6]!);
  });

  it("never makes a move impossible, only expensive", () => {
    // A zero count would otherwise become an infinite cost, and the harmoniser
    // would refuse a chord change on the grounds that no named progression
    // happens to contain it.
    for (const mode of ["major", "naturalMinor"] as const) {
      for (const row of transitionCostsFor(mode)) {
        for (const value of row) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThan(0);
        }
      }
    }
  });

  it("counts the move from a progression's last chord back to its first", () => {
    // A named progression is a loop, and the move that closes it is one of the
    // moves it teaches. The 小室進行 is vi-IV-V-I, so it teaches I back to vi
    // just as much as it teaches vi to IV -- dropping the wrap would throw away
    // one move in four across the whole catalogue.
    const major = transitionCostsFor("major");
    // I to vi is taught almost entirely by wrapping loops that end on I.
    expect(major[0]![5]!).toBeLessThan(major[0]![6]!);
    expect(major[0]![5]!).toBeLessThan(major[1]![2]!);
  });

  it("keeps the gap between a common move and an unseen one bounded", () => {
    // Smoothing is not a formality. Without it a move the catalogue never
    // happens to contain costs orders of magnitude more than one it contains
    // often, and after rescaling that single figure flattens every real
    // distinction the counts were supposed to make.
    for (const mode of ["major", "naturalMinor"] as const) {
      const flat = transitionCostsFor(mode).flat();
      // Measured at 6.7 with add-one smoothing, and above 20 without it.
      expect(Math.max(...flat) / Math.min(...flat)).toBeLessThan(9);
    }
  });

  it("gives a minor key its own table", () => {
    // The catalogue holds five minor templates and eighteen moves, which is not
    // a distribution, so this one is written and says so. What it has to state
    // is what the shared table got wrong: measured, the harmoniser chose degree
    // seven zero times against the 125 the source used, and degree six eight
    // times against 161, because a table built around the major key's rare
    // diminished vii was punishing the flat seventh and the sixth a minor key
    // leans on hardest.
    const minor = transitionCostsFor("naturalMinor");
    expect(JSON.stringify(minor)).not.toBe(JSON.stringify(transitionCostsFor("major")));

    // VII to i is the Aeolian cadence and must be among the cheapest arrivals
    // at the tonic.
    const toTonic = minor.map((row) => row[0]!);
    expect(Math.min(...toTonic)).toBe(Math.min(toTonic[6]!, toTonic[4]!));
    // VI to VII is the minor turnaround.
    expect(minor[5]![6]!).toBeLessThan(minor[5]![1]!);
  });

  it("scales both tables alike, so one weight means one thing", () => {
    // The balance between "does this chord fit the notes" and "does this chord
    // follow the last one" is set by their relative size. A negative log runs
    // over a far wider range than a hand-chosen figure: measured, the unscaled
    // prior overwhelmed the fit and melody notes landing on a chord tone fell
    // from 89% to 80%, with the tonic chosen 64 times where the source used it
    // 191. The shape of the counts was wanted; the loudness was not.
    const mean = (table: ReadonlyArray<readonly number[]>) => {
      const flat = table.flat();
      return flat.reduce((sum, value) => sum + value, 0) / flat.length;
    };
    expect(mean(transitionCostsFor("major")))
      .toBeCloseTo(mean(transitionCostsFor("naturalMinor")), 6);
  });
});

describe("harmonizing a whole melody", () => {
  function melodySitsOnChords(mode: Mode) {
    let onChord = 0;
    let total = 0;
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const composed = piece({ style, seed, mode });
        const notes = melodyOf(composed);
        const result = harmonizeMelody(notes, {
          bars: 16, timeSignature: composed.timeSignature, ppq: composed.ppq,
          key: "C" as PitchClassName, mode, maxChordsPerBar: 1,
        });
        expect(result, `${style}/${seed}`).not.toBeNull();
        for (const chord of result!.chords) {
          const tones = new Set(chord.pitchClasses);
          for (const note of notes) {
            if (note.startTick < chord.startTick) continue;
            if (note.startTick >= chord.startTick + chord.durationTick) continue;
            total += 1;
            if (tones.has(((note.midi % 12) + 12) % 12)) onChord += 1;
          }
        }
      }
    }
    return onChord / total;
  }

  it("recovers a minor key's own degrees, not a major key's", () => {
    // The failure this fixes. Measured with one shared prior: 42% of degrees
    // matched in minor against 65% in major, because the harmoniser would not
    // choose the flat seventh or the sixth at all -- degree seven zero times
    // against the 125 the source used, degree six eight times against 161.
    const used = new Map<number, number>();
    let matched = 0;
    let total = 0;
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const composed = piece({ style, seed, mode: "naturalMinor" });
        const result = harmonizeMelody(melodyOf(composed), {
          bars: 16, timeSignature: composed.timeSignature, ppq: composed.ppq,
          key: "C" as PitchClassName, mode: "naturalMinor", maxChordsPerBar: 1,
        })!;
        for (const chord of result.chords) {
          used.set(chord.degree, (used.get(chord.degree) ?? 0) + 1);
          const original = composed.chords.find((entry) => entry.startTick === chord.startTick);
          if (!original) continue;
          total += 1;
          if (original.degree === chord.degree) matched += 1;
        }
      }
    }
    // Measured: 42% to 60%.
    expect(matched / total).toBeGreaterThan(0.55);
    // And it reaches for the degrees a minor key actually uses.
    expect(used.get(7) ?? 0).toBeGreaterThan(50);
    expect(used.get(6) ?? 0).toBeGreaterThan(50);
  });

  it("puts the melody on a chord tone about as often as the original did", () => {
    // The measurement that matters. Recovering the exact original chord is not
    // the goal -- vi under a melody written over I is a reharmonisation.
    // Measured: 89% in major, 88% in minor, against 92% for the accompaniment
    // the melody was actually composed over.
    expect(melodySitsOnChords("major")).toBeGreaterThan(0.85);
    expect(melodySitsOnChords("naturalMinor")).toBeGreaterThan(0.85);
  });

  it("shares most of its pitch classes with the original harmony", () => {
    let overlap = 0;
    let count = 0;
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const composed = piece({ style, seed });
        const result = harmonizeMelody(melodyOf(composed), {
          bars: 16, timeSignature: composed.timeSignature, ppq: composed.ppq,
          key: "C" as PitchClassName, mode: "major", maxChordsPerBar: 1,
        })!;
        for (const chord of result.chords) {
          const original = composed.chords.find((entry) => entry.startTick === chord.startTick);
          if (!original) continue;
          const mine = new Set(chord.pitchClasses);
          const theirs = new Set(original.notes.map((note) => ((note % 12) + 12) % 12));
          const shared = [...mine].filter((pitchClass) => theirs.has(pitchClass)).length;
          overlap += shared / Math.max(mine.size, theirs.size);
          count += 1;
        }
      }
    }
    // Measured: 86%.
    expect(overlap / count).toBeGreaterThan(0.8);
  });

  it("covers the melody with chords and leaves no gap", () => {
    for (const style of STYLES) {
      const composed = piece({ style, seed: "cover" });
      const result = harmonizeMelody(melodyOf(composed), {
        bars: 16, timeSignature: composed.timeSignature, ppq: composed.ppq,
      })!;
      let tick = 0;
      for (const chord of result.chords) {
        expect(chord.startTick, style).toBe(tick);
        expect(chord.durationTick, style).toBeGreaterThan(0);
        tick = chord.startTick + chord.durationTick;
      }
      expect(tick, style).toBe(composed.totalTicks);
    }
  });

  it("chooses the sequence rather than each chord alone", () => {
    // A greedy pass takes the locally best chord and strands the next segment.
    // Turning the functional prior off should therefore change the result, or
    // the prior is decorative.
    const composed = piece({ seed: "seq", style: "jazz" });
    const notes = melodyOf(composed);
    const common = {
      bars: 16, timeSignature: composed.timeSignature, ppq: composed.ppq,
      key: "C" as PitchClassName, mode: "major" as Mode,
    };
    const withPrior = harmonizeMelody(notes, { ...common, transitionWeight: 1 })!;
    const withoutPrior = harmonizeMelody(notes, { ...common, transitionWeight: 0 })!;
    expect(withPrior.chords.map((chord) => chord.label).join(" "))
      .not.toBe(withoutPrior.chords.map((chord) => chord.label).join(" "));
    // And ignoring the notes entirely must be worse at fitting them.
    expect(withoutPrior.meanFit).toBeLessThanOrEqual(withPrior.meanFit + 1e-9);
  });

  it("finds the key itself when it is not told one", () => {
    const composed = piece({ seed: "auto", key: "G" });
    const result = harmonizeMelody(melodyOf(composed), {
      bars: 16, timeSignature: composed.timeSignature, ppq: composed.ppq,
    });
    expect(result?.key).toBe("G");
  });

  it("returns nothing for a melody with no notes", () => {
    expect(harmonizeMelody([], { bars: 8, timeSignature: "4/4", ppq: 480 })).toBeNull();
  });

  it("is deterministic", () => {
    const notes = melodyOf(piece({ seed: "det" }));
    const options = { bars: 16, timeSignature: "4/4" as const, ppq: 480 };
    expect(JSON.stringify(harmonizeMelody(notes, options)))
      .toBe(JSON.stringify(harmonizeMelody(notes, options)));
  });
});
