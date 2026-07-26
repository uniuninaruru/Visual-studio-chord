import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  NON_CHORD_TONE_TYPES,
  applyNonChordTones,
  generateComposition,
  getMelodyScaleMidiNotes,
  summarizeOrnaments,
  validateComposition,
} from "../src/music";
import type { NonChordToneType, OrnamentPattern } from "../src/music";
import type {
  CanonicalPitchClass,
  ChordEvent,
  GeneratorSettings,
  NoteEvent,
} from "../src/types/music";

const BEAT = 480;
const BAR = 1920;
const RANGE = [55, 84] as const;
const C_MAJOR = getMelodyScaleMidiNotes("C", "major", RANGE[0], RANGE[1], "diatonic");

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...DEFAULT_GENERATOR_SETTINGS,
    ...patch,
    melody: { ...DEFAULT_GENERATOR_SETTINGS.melody, ...patch.melody },
  };
}

const REAL = generateComposition(settings({ bars: 4, seed: "template" }));
const CHORD_TEMPLATE = REAL.chords[0]!;
const NOTE_TEMPLATE = REAL.notes[0]!;

function chord(
  id: string,
  root: CanonicalPitchClass,
  notes: number[],
  startTick: number,
  durationTick: number,
): ChordEvent {
  return { ...CHORD_TEMPLATE, id, root, notes, startTick, durationTick };
}

function note(midi: number, startTick: number, durationTick = BEAT): NoteEvent {
  return {
    ...NOTE_TEMPLATE,
    id: `n-${startTick}-${midi}`,
    midi,
    startTick,
    durationTick,
    barIndex: Math.floor(startTick / BAR),
    role: "chordTone",
  };
}

/** Runs the pass over a hand-built site, restricted to one figure. */
function ornament(
  notes: NoteEvent[],
  chords: ChordEvent[],
  types: NonChordToneType[],
  seed = "t",
): { notes: NoteEvent[]; patterns: OrnamentPattern[] } {
  return applyNonChordTones(notes, {
    chords,
    scaleForBar: () => C_MAJOR,
    range: RANGE,
    settings: { enabled: true, rate: 1, types },
    seed,
  });
}

const C_TRIAD = [60, 64, 67];
const F_TRIAD = [65, 69, 72];

describe("switching the pass off", () => {
  const notes = [note(60, 0), note(64, BEAT)];
  const chords = [chord("c", "C", C_TRIAD, 0, BAR)];

  it("leaves the melody alone when disabled", () => {
    const result = applyNonChordTones(notes, {
      chords,
      scaleForBar: () => C_MAJOR,
      range: RANGE,
      settings: { enabled: false },
      seed: "t",
    });
    expect(result.notes).toEqual(notes);
    expect(result.patterns).toEqual([]);
  });

  it("leaves the melody alone at rate zero, or with no figures allowed", () => {
    for (const patch of [{ rate: 0 }, { types: [] }]) {
      const result = applyNonChordTones(notes, {
        chords,
        scaleForBar: () => C_MAJOR,
        range: RANGE,
        settings: { enabled: true, ...patch },
        seed: "t",
      });
      expect(result.notes, JSON.stringify(patch)).toEqual(notes);
      expect(result.patterns).toEqual([]);
    }
  });

  it("leaves a single note alone, since a figure needs somewhere to go", () => {
    expect(ornament([note(60, 0)], chords, ["passingTone"]).notes).toHaveLength(1);
  });
});

describe("the individual figures", () => {
  it("fills a third with a passing tone", () => {
    // C then E, both chord tones of C: D is the scale pitch between them.
    const result = ornament(
      [note(60, 0), note(64, BEAT)],
      [chord("c", "C", C_TRIAD, 0, BAR)],
      ["passingTone"],
    );
    expect(result.patterns).toHaveLength(1);
    const [figure] = result.patterns;
    expect(figure!.type).toBe("passingTone");
    expect(figure!.dissonance.midi).toBe(62); // D
    expect(figure!.dissonance.midi).toBeGreaterThan(figure!.preparation!.midi);
    expect(figure!.dissonance.midi).toBeLessThan(figure!.resolution.midi);
    expect(result.notes.map((n) => n.midi)).toEqual([60, 62, 64]);
  });

  it("decorates a repeated note with a neighbour", () => {
    const result = ornament(
      [note(60, 0), note(60, BEAT)],
      [chord("c", "C", C_TRIAD, 0, BAR)],
      ["neighborTone"],
    );
    expect(result.patterns).toHaveLength(1);
    const figure = result.patterns[0]!;
    // A neighbour steps away and the line returns to where it started.
    expect(Math.abs(figure.dissonance.midi - 60)).toBeLessThanOrEqual(2);
    expect(figure.dissonance.midi).not.toBe(60);
    expect(figure.resolution.midi).toBe(60);
    expect(C_TRIAD.map((m) => m % 12)).not.toContain(figure.dissonance.midi % 12);
  });

  it("holds a tone past its chord and resolves it down — a suspension", () => {
    // G belongs to C but not to F; stepping down lands on F, which does.
    const result = ornament(
      [note(67, 0), note(72, BAR)],
      [chord("c", "C", C_TRIAD, 0, BAR), chord("f", "F", F_TRIAD, BAR, BAR)],
      ["suspension"],
    );
    expect(result.patterns).toHaveLength(1);
    const figure = result.patterns[0]!;
    expect(figure.type).toBe("suspension");
    // Prepared by the note that was already sounding.
    expect(figure.preparation!.midi).toBe(67);
    // The dissonance is that same pitch, now over the new chord.
    expect(figure.dissonance.midi).toBe(67);
    expect(figure.dissonance.startTick).toBe(BAR);
    expect(F_TRIAD.map((m) => m % 12)).not.toContain(67 % 12);
    // And it resolves down by step onto a tone of the new chord.
    expect(figure.resolution.midi).toBe(65); // F
    expect(F_TRIAD.map((m) => m % 12)).toContain(figure.resolution.midi % 12);
  });

  it("resolves a retardation upward instead", () => {
    const result = ornament(
      [note(67, 0), note(72, BAR)],
      [chord("c", "C", C_TRIAD, 0, BAR), chord("f", "F", F_TRIAD, BAR, BAR)],
      ["retardation"],
    );
    expect(result.patterns).toHaveLength(1);
    const figure = result.patterns[0]!;
    expect(figure.dissonance.midi).toBe(67);
    expect(figure.resolution.midi).toBe(69); // A, a step up
    expect(figure.resolution.midi).toBeGreaterThan(figure.dissonance.midi);
  });

  it("brings the next chord's tone in early — an anticipation", () => {
    const result = ornament(
      [note(60, 0), note(65, BAR)],
      [chord("c", "C", C_TRIAD, 0, BAR), chord("f", "F", F_TRIAD, BAR, BAR)],
      ["anticipation"],
    );
    expect(result.patterns).toHaveLength(1);
    const figure = result.patterns[0]!;
    // The anticipated pitch is the one the next chord is about to state.
    expect(figure.dissonance.midi).toBe(65);
    expect(figure.dissonance.startTick).toBeLessThan(BAR);
    expect(figure.resolution.midi).toBe(65);
  });

  it("leans onto a dissonance and steps down — an appoggiatura", () => {
    const result = ornament(
      [note(60, 0), note(67, BEAT)],
      [chord("c", "C", C_TRIAD, 0, BAR)],
      ["appoggiatura"],
    );
    expect(result.patterns).toHaveLength(1);
    const figure = result.patterns[0]!;
    expect(figure.dissonance.midi).toBe(69); // A, a step above G
    expect(figure.resolution.midi).toBe(67); // resolving down onto the chord tone
    // The accent is the point, so the dissonance is not the shorter of the two.
    expect(figure.dissonance.durationTick).toBeGreaterThanOrEqual(
      figure.resolution.durationTick,
    );
    // It arrives on the beat the chord tone would have had.
    expect(figure.dissonance.startTick).toBe(BEAT);
  });

  it("steps away and leaps back — an escape tone", () => {
    const result = ornament(
      [note(60, 0), note(67, BEAT)],
      [chord("c", "C", C_TRIAD, 0, BAR)],
      ["escapeTone"],
    );
    expect(result.patterns).toHaveLength(1);
    const figure = result.patterns[0]!;
    // The leap goes up, so the step out of the chord tone goes down.
    expect(figure.dissonance.midi).toBeLessThan(60);
    expect(Math.abs(figure.dissonance.midi - 60)).toBeLessThanOrEqual(2);
    expect(figure.resolution.midi).toBe(67);
  });

  it("surrounds a target before landing on it — an enclosure", () => {
    const result = ornament(
      [note(60, 0, BAR), note(67, BAR)],
      [chord("c", "C", C_TRIAD, 0, BAR), chord("c2", "C", C_TRIAD, BAR, BAR)],
      ["enclosure"],
    );
    expect(result.patterns).toHaveLength(1);
    const midis = result.notes.map((n) => n.midi);
    // The two inserted notes sit either side of the target.
    expect(midis).toEqual([60, 69, 65, 67]);
  });

  it("needs a leap to justify an enclosure", () => {
    // A step into the target is an ordinary move; enclosing it would be noise.
    const result = ornament(
      [note(60, 0, BAR), note(62, BAR)],
      [chord("c", "C", C_TRIAD, 0, BAR), chord("c2", "C", C_TRIAD, BAR, BAR)],
      ["enclosure"],
    );
    expect(result.patterns).toEqual([]);
  });

  it("only writes the figures it is allowed to", () => {
    for (const type of NON_CHORD_TONE_TYPES) {
      const composition = generateComposition(
        settings({ bars: 16, seed: "only", nonChordTones: { enabled: true, rate: 1, types: [type] } }),
      );
      expect(validateComposition(composition).errors, type).toEqual([]);
    }
  });
});

describe("what the pass guarantees", () => {
  const pieces = Array.from({ length: 10 }, (_, index) => `g${index}`).flatMap((seed) =>
    ([8, 16] as const).map((bars) =>
      generateComposition(
        settings({
          bars,
          seed,
          harmony: { complexity: "sevenths" },
          nonChordTones: { enabled: true, rate: 1 },
        }),
      ),
    ),
  );

  it("produces valid compositions", () => {
    for (const composition of pieces) {
      expect(validateComposition(composition).errors, composition.seed).toEqual([]);
    }
  });

  it("never lets a note cross the bar it belongs to", () => {
    for (const composition of pieces) {
      for (const item of composition.notes) {
        const barStart = item.barIndex * composition.ticksPerBar;
        expect(item.startTick).toBeGreaterThanOrEqual(barStart);
        expect(item.startTick + item.durationTick).toBeLessThanOrEqual(
          barStart + composition.ticksPerBar,
        );
      }
    }
  });

  it("keeps notes in order and never overlaps them", () => {
    for (const composition of pieces) {
      for (let index = 1; index < composition.notes.length; index += 1) {
        const previous = composition.notes[index - 1]!;
        const current = composition.notes[index]!;
        expect(current.startTick).toBeGreaterThanOrEqual(
          previous.startTick + previous.durationTick,
        );
      }
    }
  });

  it("keeps every ornament inside the melody range and audible", () => {
    for (const composition of pieces) {
      for (const item of composition.notes) {
        expect(item.midi).toBeGreaterThanOrEqual(composition.settings.melody.minMidi);
        expect(item.midi).toBeLessThanOrEqual(composition.settings.melody.maxMidi);
        expect(item.durationTick).toBeGreaterThan(0);
        expect(Number.isInteger(item.durationTick)).toBe(true);
      }
    }
  });

  it("decorates without extending — the line occupies the same time", () => {
    for (const seed of ["d1", "d2", "d3"]) {
      const base = settings({ bars: 8, seed });
      const plain = generateComposition(base);
      const decorated = generateComposition({
        ...base,
        nonChordTones: { enabled: true, rate: 1 },
      });
      const sounding = (notes: readonly NoteEvent[]) =>
        notes.reduce((sum, item) => sum + item.durationTick, 0);
      expect(sounding(decorated.notes), seed).toBe(sounding(plain.notes));
      expect(decorated.notes.length).toBeGreaterThan(plain.notes.length);
    }
  });

  it("reaches for the ordinary figures more than the special ones", () => {
    // Picking uniformly among whatever fits would invert this: the figures with
    // the loosest preconditions would dominate precisely because they fit
    // everywhere, and a line would be mostly enclosures.
    const counts = Object.fromEntries(
      NON_CHORD_TONE_TYPES.map((type) => [type, 0]),
    ) as Record<NonChordToneType, number>;
    for (const seed of Array.from({ length: 16 }, (_, index) => `w${index}`)) {
      const composition = generateComposition(
        settings({ bars: 16, seed, harmony: { complexity: "sevenths" } }),
      );
      const result = applyNonChordTones(composition.notes, {
        chords: composition.chords,
        scaleForBar: () => C_MAJOR,
        range: [60, 84],
        settings: { enabled: true, rate: 1 },
        seed,
      });
      const summary = summarizeOrnaments(result.patterns);
      for (const type of NON_CHORD_TONE_TYPES) counts[type] += summary[type];
    }
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    expect(total).toBeGreaterThan(100);
    // Every figure is reachable, so none of them is dead code.
    for (const type of NON_CHORD_TONE_TYPES) {
      expect(counts[type], type).toBeGreaterThan(0);
    }
    expect(counts.passingTone).toBeGreaterThan(counts.enclosure);
    expect(counts.enclosure / total).toBeLessThan(0.25);
  });

  it("applies fewer figures at a lower rate", () => {
    const count = (rate: number) =>
      generateComposition(
        settings({ bars: 16, seed: "rate", nonChordTones: { enabled: true, rate } }),
      ).notes.length;
    expect(count(1)).toBeGreaterThan(count(0.5));
    expect(count(0.5)).toBeGreaterThan(count(0.1));
  });
});

describe("non-chord tones in generated compositions", () => {
  it("stays valid across modes, bar counts and time signatures", () => {
    for (const mode of ["major", "naturalMinor", "dorian", "harmonicMinor"] as const) {
      for (const timeSignature of ["4/4", "3/4", "6/8"] as const) {
        const composition = generateComposition(
          settings({
            bars: 8,
            mode,
            timeSignature,
            seed: `${mode}-${timeSignature}`,
            nonChordTones: { enabled: true, rate: 1 },
          }),
        );
        expect(
          validateComposition(composition).errors,
          `${mode}/${timeSignature}`,
        ).toEqual([]);
      }
    }
  });

  it("changes the melody it produces", () => {
    const base = settings({ bars: 8, seed: "changes" });
    expect(
      generateComposition({ ...base, nonChordTones: { enabled: true } }).notes.length,
    ).not.toBe(generateComposition(base).notes.length);
  });

  it("is deterministic", () => {
    const make = () =>
      generateComposition(
        settings({ bars: 8, seed: "fixed", nonChordTones: { enabled: true, rate: 1 } }),
      );
    expect(make()).toEqual(make());
  });

  it("distinguishes pieces that differ only by the setting or its rate", () => {
    const base = settings({ bars: 8, seed: "id" });
    const plain = generateComposition(base).id;
    const decorated = generateComposition({
      ...base,
      nonChordTones: { enabled: true, rate: 0.5 },
    }).id;
    const heavier = generateComposition({
      ...base,
      nonChordTones: { enabled: true, rate: 0.9 },
    }).id;
    expect(new Set([plain, decorated, heavier]).size).toBe(3);
  });

  it("composes with the rest of the engine", () => {
    const composition = generateComposition(
      settings({
        bars: 16,
        seed: "all",
        songForm: { form: "verseChorus", finalLift: 2 },
        harmonicRhythm: { changesPerBar: 2, cadentialAcceleration: true },
        phraseGrammar: { enabled: true },
        melodicSkeleton: { enabled: true },
        functionalHarmony: { enabled: true },
        voiceLeading: { enabled: true },
        nonChordTones: { enabled: true, rate: 1 },
      }),
    );
    expect(validateComposition(composition).errors).toEqual([]);
  });
});
