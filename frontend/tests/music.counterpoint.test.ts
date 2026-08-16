import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  findCounterpointIssues,
  generateCanon,
  generateComposition,
  generateCountermelody,
  getMelodyScaleMidiNotes,
  motionBetween,
} from "../src/music";
import type { NoteEvent } from "../src/types/music";

const RANGE = [48, 72] as const;
const SCALE = getMelodyScaleMidiNotes("C", "major", 40, 84, "diatonic");

const piece = (seed: string, bars: 4 | 8 | 16 = 8) =>
  generateComposition({ ...DEFAULT_GENERATOR_SETTINGS, bars, seed });

function counter(
  seed: string,
  patch: Parameters<typeof generateCountermelody>[0]["settings"] = { enabled: true },
) {
  const composition = piece(seed);
  return {
    composition,
    notes: generateCountermelody({
      melody: composition.notes,
      chords: composition.chords,
      scaleForBar: () => SCALE,
      range: RANGE,
      settings: patch,
      seed,
    }),
  };
}

describe("reading motion between two voices", () => {
  it("names each kind", () => {
    expect(motionBetween(60, 67, 62, 69)).toBe("parallel");
    expect(motionBetween(60, 67, 62, 71)).toBe("similar");
    expect(motionBetween(60, 67, 58, 69)).toBe("contrary");
    expect(motionBetween(60, 67, 60, 69)).toBe("oblique");
    expect(motionBetween(60, 67, 62, 67)).toBe("oblique");
  });
});

describe("writing a countermelody", () => {
  it("produces nothing when off or given nothing", () => {
    expect(counter("x", { enabled: false }).notes).toEqual([]);
    expect(
      generateCountermelody({
        melody: [], chords: [], scaleForBar: () => SCALE, range: RANGE,
        settings: { enabled: true }, seed: "x",
      }),
    ).toEqual([]);
  });

  it("writes one note per melody note, sharing its rhythm", () => {
    const { composition, notes } = counter("c1");
    expect(notes).toHaveLength(composition.notes.length);
    for (const [index, note] of notes.entries()) {
      const melody = composition.notes[index]!;
      expect(note.startTick).toBe(melody.startTick);
      expect(note.durationTick).toBe(melody.durationTick);
      expect(note.barIndex).toBe(melody.barIndex);
    }
  });

  it("stays in its range and on its own side of the melody", () => {
    for (const seed of ["c1", "c2", "c3", "c4"]) {
      const { composition, notes } = counter(seed);
      for (const [index, note] of notes.entries()) {
        expect(note.midi, seed).toBeGreaterThanOrEqual(RANGE[0]);
        expect(note.midi, seed).toBeLessThanOrEqual(RANGE[1]);
        expect(note.midi, `${seed}/${index}`).toBeLessThan(composition.notes[index]!.midi);
      }
    }
    // And above, when asked. The range has to reach past the melody for that to
    // be possible at every note, which is what the wide scale here is for.
    const composition = piece("above");
    const wide = getMelodyScaleMidiNotes("C", "major", 40, 108, "diatonic");
    const above = generateCountermelody({
      melody: composition.notes, chords: composition.chords,
      scaleForBar: () => wide, range: [60, 108],
      settings: { enabled: true, position: "above" }, seed: "above",
    });
    expect(above).toHaveLength(composition.notes.length);
    for (const [index, note] of above.entries()) {
      expect(note.midi).toBeGreaterThan(composition.notes[index]!.midi);
    }
  });

  it("uses rests rather than crossing or adding dissonance when the range is impossible", () => {
    const composition = piece("narrow");
    const notes = generateCountermelody({
      melody: composition.notes, chords: composition.chords,
      scaleForBar: () => SCALE, range: [60, 64],
      settings: { enabled: true, position: "above" }, seed: "narrow",
    });
    expect(notes.length).toBeLessThan(composition.notes.length);
    for (const note of notes) {
      expect(note.midi).toBeGreaterThanOrEqual(60);
      expect(note.midi).toBeLessThanOrEqual(64);
    }
  });

  it("never writes a parallel fifth, a parallel octave or a crossing", () => {
    // The prohibition counterpoint has always had: two voices moving in parallel
    // into a perfect interval fuse into one thickened line.
    let checked = 0;
    for (const seed of ["c1", "c2", "c3", "c4", "c5", "c6"]) {
      const { composition, notes } = counter(seed);
      const issues = findCounterpointIssues(notes, composition.notes);
      checked += notes.length;
      for (const issue of issues) {
        expect(
          ["parallelFifth", "parallelOctave", "voiceCrossing"],
          `${seed}: ${issue.type} at ${issue.index}`,
        ).not.toContain(issue.type);
      }
    }
    // A floor on the sample, not a claim about the music. The melody carries
    // note values from the metre now rather than two lengths per bar, so the
    // same six pieces hold roughly half as many notes -- 190 where there were
    // over 300 -- and every one of them is still checked.
    expect(checked).toBeGreaterThan(150);
  });

  it("keeps first-species vertical intervals consonant throughout", () => {
    let dissonances = 0;
    let total = 0;
    for (const seed of ["c1", "c2", "c3", "c4", "c5", "c6"]) {
      const { composition, notes } = counter(seed);
      dissonances += findCounterpointIssues(notes, composition.notes)
        .filter((issue) => issue.type === "dissonance").length;
      total += notes.length;
    }
    // See above: fewer, longer notes, same coverage.
    expect(total).toBeGreaterThan(150);
    expect(dissonances).toBe(0);
  });

  it("moves against the melody more as independence rises", () => {
    const contraryRate = (independence: number) => {
      const { composition, notes } = counter("ind", { enabled: true, independence });
      let contrary = 0;
      let moves = 0;
      for (let index = 1; index < notes.length; index += 1) {
        const own = notes[index]!.midi - notes[index - 1]!.midi;
        const melody = composition.notes[index]!.midi - composition.notes[index - 1]!.midi;
        if (own === 0 || melody === 0) continue;
        moves += 1;
        if (Math.sign(own) !== Math.sign(melody)) contrary += 1;
      }
      return contrary / moves;
    };
    expect(contraryRate(1)).toBeGreaterThan(contraryRate(0));
    expect(contraryRate(0.5)).toBeGreaterThan(contraryRate(0));
  });

  it("produces notes the rest of the app would accept", () => {
    for (const seed of ["c1", "c2", "c3"]) {
      const { composition, notes } = counter(seed);
      for (const note of notes) {
        const barStart = note.barIndex * composition.ticksPerBar;
        expect(note.startTick).toBeGreaterThanOrEqual(barStart);
        expect(note.startTick + note.durationTick).toBeLessThanOrEqual(
          barStart + composition.ticksPerBar,
        );
        expect(note.velocity).toBeGreaterThanOrEqual(1);
        expect(note.velocity).toBeLessThanOrEqual(127);
        expect(note.noteName).toBeTruthy();
        expect(Number.isInteger(note.midi)).toBe(true);
      }
      expect(new Set(notes.map((n) => n.id)).size).toBe(notes.length);
    }
  });

  it("is deterministic, and follows the seed", () => {
    expect(counter("same").notes).toEqual(counter("same").notes);
    expect(counter("one").notes.map((n) => n.midi)).not.toEqual(
      counter("two").notes.map((n) => n.midi),
    );
  });
});

describe("finding faults between two lines", () => {
  const note = (midi: number, index: number): NoteEvent => ({
    ...piece("t", 4).notes[0]!,
    id: `n${index}`,
    midi,
    startTick: index * 480,
    durationTick: 480,
    barIndex: 0,
  });

  it("catches a parallel fifth and a parallel octave", () => {
    const lower = [note(60, 0), note(62, 1)];
    expect(findCounterpointIssues(lower, [note(67, 0), note(69, 1)])
      .some((issue) => issue.type === "parallelFifth")).toBe(true);
    expect(findCounterpointIssues(lower, [note(72, 0), note(74, 1)])
      .some((issue) => issue.type === "parallelOctave")).toBe(true);
  });

  it("allows a fifth reached by contrary motion", () => {
    // The interval is not the fault; moving into it in parallel is.
    const issues = findCounterpointIssues(
      [note(60, 0), note(55, 1)],
      [note(64, 0), note(62, 1)],
    );
    expect(issues.some((issue) => issue.type === "parallelFifth")).toBe(false);
  });

  it("catches a crossing and a dissonance", () => {
    expect(findCounterpointIssues([note(72, 0)], [note(60, 0)])[0]!.type).toBe("voiceCrossing");
    expect(findCounterpointIssues([note(60, 0)], [note(62, 0)])[0]!.type).toBe("dissonance");
    expect(findCounterpointIssues([note(60, 0)], [note(64, 0)])).toEqual([]);
  });
});

describe("writing a canon", () => {
  const canon = (settings: Parameters<typeof generateCanon>[0]["settings"], seed = "cn") => {
    const composition = piece(seed);
    return {
      composition,
      notes: generateCanon({
        melody: composition.notes,
        settings,
        timeSignature: "4/4",
        bars: 8,
        range: [48, 84],
      }),
    };
  };

  it("produces nothing when off", () => {
    expect(canon({ enabled: false, delayBeats: 4 }).notes).toEqual([]);
  });

  it("enters late, by exactly the delay asked for", () => {
    const { composition, notes } = canon({ enabled: true, delayBeats: 4 });
    expect(notes[0]!.startTick).toBe(composition.notes[0]!.startTick + 1920);
    for (const [index, note] of notes.entries()) {
      expect(note.startTick).toBe(composition.notes[index]!.startTick + 1920);
    }
  });

  it("transposes by the interval asked for", () => {
    const { composition, notes } = canon({ enabled: true, delayBeats: 0, interval: 7 });
    for (const [index, note] of notes.entries()) {
      // Allowing for the octave shift that keeps it in range.
      const offset = note.midi - composition.notes[index]!.midi - 7;
      expect(((offset % 12) + 12) % 12).toBe(0);
    }
  });

  it("turns every interval upside down when inverted", () => {
    const { composition, notes } = canon({ enabled: true, delayBeats: 0, inverted: true });
    for (let index = 1; index < notes.length; index += 1) {
      const own = notes[index]!.midi - notes[index - 1]!.midi;
      const melody = composition.notes[index]!.midi - composition.notes[index - 1]!.midi;
      expect(own + melody, `step ${index}`).toBe(0);
    }
  });

  it("stops at the end of the piece rather than running on", () => {
    const { composition, notes } = canon({ enabled: true, delayBeats: 4 });
    expect(notes.length).toBeLessThan(composition.notes.length);
    for (const note of notes) {
      expect(note.startTick + note.durationTick).toBeLessThanOrEqual(8 * 1920);
    }
  });

  it("keeps every note inside its own bar and range", () => {
    for (const delayBeats of [1, 2, 3, 4, 7]) {
      for (const interval of [-12, -5, 0, 7, 12]) {
        const { notes } = canon({ enabled: true, delayBeats, interval });
        for (const note of notes) {
          const barStart = note.barIndex * 1920;
          expect(note.startTick, `${delayBeats}/${interval}`).toBeGreaterThanOrEqual(barStart);
          expect(note.startTick + note.durationTick).toBeLessThanOrEqual(barStart + 1920);
          expect(note.durationTick).toBeGreaterThan(0);
          expect(note.midi).toBeGreaterThanOrEqual(48);
          expect(note.midi).toBeLessThanOrEqual(84);
        }
      }
    }
  });

  it("is deterministic and needs no seed, because nothing is chosen", () => {
    const settings = { enabled: true, delayBeats: 2, interval: 5 } as const;
    expect(canon(settings).notes).toEqual(canon(settings).notes);
  });
});
