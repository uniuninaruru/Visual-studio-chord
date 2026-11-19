import { describe, expect, it } from "vitest";
import { MINIMAL_GENERATOR_SETTINGS } from "../src/music/generator";
import {
  composeTheoryVoices,
  hasParallelPerfectMotion,
  isStepwisePassingMotion,
} from "../src/music/theoryVoices";
import { pitchClassToSemitone } from "../src/music/scales";
import { ticksPerBar } from "../src/music/time";
import type {
  CanonicalPitchClass,
  ChordEvent,
  GeneratorSettings,
  JazzSettings,
  NoteEvent,
  TimeSignature,
} from "../src/types/music";

const JAZZ: JazzSettings = {
  version: 1,
  style: "bebop",
  form: "aaba",
  chromaticism: 0.48,
  interaction: 0.62,
};

function chord(
  id: string,
  root: CanonicalPitchClass,
  startTick: number,
  durationTick: number,
  quality: ChordEvent["quality"],
  notes: number[],
  fn: ChordEvent["function"],
  tensions?: ChordEvent["tensions"],
): ChordEvent {
  return {
    id,
    symbol: `${root}${quality}`,
    romanNumeral: fn === "tonic" ? "I" : fn === "dominant" ? "V7" : "ii7",
    function: fn,
    degree: fn === "tonic" ? 1 : fn === "dominant" ? 5 : 2,
    quality,
    root,
    startTick,
    durationTick,
    notes,
    inversion: 0,
    source: "diatonic",
    ...(tensions ? { tensions } : {}),
  };
}

function progression(timeSignature: TimeSignature): ChordEvent[] {
  const bar = ticksPerBar(timeSignature, 480);
  return [
    chord("I-1", "C", 0, bar, "major7", [48, 52, 55, 59], "tonic"),
    chord("ii-1", "D", bar, bar, "minor7", [50, 53, 57, 60], "predominant"),
    chord("V-1", "G", bar * 2, bar, "dominant7", [43, 47, 50, 53], "dominant", ["9"]),
    chord("I-2", "C", bar * 3, bar, "major7", [48, 52, 55, 59], "tonic"),
  ];
}

function settings(
  timeSignature: TimeSignature = "4/4",
  mode: GeneratorSettings["mode"] = "major",
  counterpoint = false,
  range: readonly [number, number] = [55, 88],
): GeneratorSettings {
  return {
    ...MINIMAL_GENERATOR_SETTINGS,
    bars: 4,
    timeSignature,
    mode,
    seed: "theory-voice-test",
    melody: {
      ...MINIMAL_GENERATOR_SETTINGS.melody,
      minMidi: range[0],
      maxMidi: range[1],
      density: 0.65,
      velocity: 90,
    },
    ...(counterpoint
      ? { arrangement: { counterpoint: { enabled: true, position: "below" as const, independence: 0.8 } } }
      : {}),
  };
}

function run(
  options: {
    meter?: TimeSignature;
    mode?: GeneratorSettings["mode"];
    counterpoint?: boolean;
    range?: readonly [number, number];
    seed?: string;
    density?: number;
    restRate?: number;
    jazz?: Partial<JazzSettings>;
  } = {},
) {
  const meter = options.meter ?? "4/4";
  const baseSettings = settings(meter, options.mode, options.counterpoint, options.range);
  const generatorSettings = {
    ...baseSettings,
    melody: {
      ...baseSettings.melody,
      density: options.density ?? baseSettings.melody.density,
      restRate: options.restRate ?? baseSettings.melody.restRate,
    },
  };
  return composeTheoryVoices({
    settings: generatorSettings,
    jazz: { ...JAZZ, ...options.jazz },
    chords: progression(meter),
    ppq: 480,
    seed: options.seed,
  });
}

function isChordPitch(note: NoteEvent, chordEvent: ChordEvent): boolean {
  const root = pitchClassToSemitone(chordEvent.root);
  const explicit = new Set(chordEvent.notes.map((midi) => midi % 12));
  const extension = (chordEvent.tensions ?? []).map((tension) => {
    const interval: Record<NonNullable<ChordEvent["tensions"]>[number], number> = {
      "6": 9, "9": 2, b9: 1, "#9": 3, "11": 5, "#11": 6, "13": 9, b13: 8,
    };
    return (root + interval[tension]) % 12;
  });
  return explicit.has(note.midi % 12) || extension.includes(note.midi % 12);
}

describe("harmony-and-counterpoint voice composer", () => {
  it("does not mistake a fifth-to-octave similar-motion arrival for parallel perfect motion", () => {
    expect(hasParallelPerfectMotion(67, 60, 74, 62)).toBe(false); // P5 -> P8, similar motion
    expect(hasParallelPerfectMotion(67, 60, 72, 65)).toBe(true); // P5 -> P5, similar motion
    expect(hasParallelPerfectMotion(67, 60, 72, 62)).toBe(false); // P5 -> sixth
  });

  it("does not promote an out-of-symbol voicing pitch to a chord member", () => {
    const chords = progression("4/4");
    chords[0] = { ...chords[0]!, notes: [48, 52, 55, 59, 62] }; // D is not in Cmaj7.
    const constrained = settings("4/4", "major", false, [62, 62]);
    const result = composeTheoryVoices({ settings: constrained, jazz: JAZZ, chords, ppq: 480, seed: "symbol-membership" });
    expect(result.melody[0]?.startTick).toBe(0);
    expect(result.melody[0]?.role).toBe("scaleTone");
  });

  it("keeps structural scale-tone labels diatonic even when jazz chromaticism is high", () => {
    const result = run({ seed: "structural-chromatic", jazz: { chromaticism: 1 } });
    const cMajor = new Set([0, 2, 4, 5, 7, 9, 11]);
    for (const note of result.melody.filter((event) => event.role === "scaleTone")) {
      expect(cMajor.has(note.midi % 12), `chromatic scaleTone at ${note.startTick}`).toBe(true);
    }
  });

  it("requires two stepwise sides before naming a note a passing tone", () => {
    expect(isStepwisePassingMotion(60, 62, 64)).toBe(true);
    expect(isStepwisePassingMotion(64, 62, 60)).toBe(true);
    expect(isStepwisePassingMotion(60, 65, 72)).toBe(false); // A mid-octave note is not a single passing tone.
  });

  it("is deterministic for the same seed and varies within the selected jazz profile", () => {
    expect(run({ seed: "fixed" })).toEqual(run({ seed: "fixed" }));
    const first = run({ seed: "seed-a" });
    const second = run({ seed: "seed-b" });
    expect(first.melody).not.toEqual(second.melody);
  });

  it.each([
    ["4/4", "major"],
    ["3/4", "naturalMinor"],
    ["6/8", "dorian"],
  ] as const)("uses integer ticks and playable pitches in %s %s", (meter, mode) => {
    const result = run({ meter, mode });
    expect(result.melody.length).toBeGreaterThan(0);
    for (const note of result.melody) {
      expect(Number.isInteger(note.startTick)).toBe(true);
      expect(Number.isInteger(note.durationTick)).toBe(true);
      expect(note.durationTick).toBeGreaterThan(0);
      expect(note.midi).toBeGreaterThanOrEqual(21);
      expect(note.midi).toBeLessThanOrEqual(108);
    }
  });

  it("targets chord members, including an explicitly supplied ninth, on the downbeats", () => {
    const meter = "4/4" as const;
    const chords = progression(meter);
    const result = run({ meter });
    const downbeats = new Set(chords.map((event) => event.startTick));
    for (const tick of downbeats) {
      const note = result.melody.find((event) => event.startTick === tick);
      const activeChord = chords.find((event) => event.startTick === tick)!;
      expect(note, `melody attack at ${tick}`).toBeDefined();
      expect(isChordPitch(note!, activeChord), `${activeChord.symbol} at ${tick}`).toBe(true);
    }
  });

  it("treats a declared ninth as a chord member on its new chord onset", () => {
    const bar = ticksPerBar("4/4", 480);
    const chords = progression("4/4");
    const dominant = chords[2]!;
    const firstHalf = { ...dominant, durationTick: 480, tensions: [] as const };
    const secondHalf = {
      ...dominant,
      id: "G9",
      startTick: dominant.startTick + 480,
      durationTick: bar - 480,
      tensions: ["9"] as const,
    };
    chords.splice(2, 1, firstHalf, secondHalf);
    const narrow = settings("4/4", "major", false, [57, 57]);
    const result = composeTheoryVoices({ settings: narrow, jazz: JAZZ, chords, ppq: 480, seed: "ninth-accent" });
    const ninth = result.melody.find((note) => note.startTick === secondHalf.startTick);
    expect(ninth).toBeDefined();
    expect(ninth!.midi % 12).toBe(9); // A is G's declared ninth.
    expect(ninth!.role).toBe("chordTone");
  });

  it("chooses the counterline jointly, keeps it on its side, and avoids feasible parallel perfect motion", () => {
    for (const seed of ["joint-a", "joint-b", "joint-c", "joint-d", "joint-e"]) {
      const result = run({ counterpoint: true, seed });
      expect(result.countermelody, seed).toBeDefined();
      const melody = result.melody;
      const counter = result.countermelody!;
      const structuralTicks = new Set([
        ...melody.filter((note) => note.startTick % 480 === 0).map((note) => note.startTick),
        ...progression("4/4").map((event) => event.startTick),
      ]);
      const paired = [...structuralTicks].sort((left, right) => left - right).flatMap((tick) => {
        const upper = melody.find((note) => note.startTick === tick);
        const lower = counter.find((note) => note.startTick === tick);
        return upper && lower ? [{ upper, lower }] : [];
      });
      expect(paired.length, seed).toBeGreaterThan(3);
      for (const { upper, lower } of paired) expect(lower.midi, seed).toBeLessThan(upper.midi);
      for (let index = 1; index < paired.length; index += 1) {
        const previous = paired[index - 1]!;
        const current = paired[index]!;
        const previousInterval = Math.abs(previous.upper.midi - previous.lower.midi) % 12;
        const currentInterval = Math.abs(current.upper.midi - current.lower.midi) % 12;
        const sameDirection = Math.sign(current.upper.midi - previous.upper.midi)
          === Math.sign(current.lower.midi - previous.lower.midi);
        const bothMove = current.upper.midi !== previous.upper.midi && current.lower.midi !== previous.lower.midi;
        const parallelPerfect = [0, 7].includes(previousInterval)
          && [0, 7].includes(currentInterval)
          && sameDirection
          && bothMove;
        expect(parallelPerfect, `${seed}: parallel perfect interval at ${current.upper.startTick}`).toBe(false);
      }
    }
  });

  it("adds weak dissonances only as a valid passing, neighbor, or approach figure", () => {
    const melody = run({ seed: "ornament-grammar" }).melody;
    for (let index = 1; index < melody.length - 1; index += 1) {
      const note = melody[index]!;
      if (!["passing", "neighbor", "approach"].includes(note.role)) continue;
      const previous = melody[index - 1]!;
      const next = melody[index + 1]!;
      expect(note.startTick % 480).not.toBe(0);
      if (note.role === "passing") {
        expect((previous.midi < note.midi && note.midi < next.midi)
          || (previous.midi > note.midi && note.midi > next.midi)).toBe(true);
      }
      if (note.role === "neighbor") expect(previous.midi).toBe(next.midi);
      if (note.role === "approach") expect(Math.abs(next.midi - note.midi)).toBe(1);
    }
  });

  it("omits the optional counterline when the configured side has no playable room", () => {
    const result = run({ counterpoint: true, range: [21, 24] });
    expect(result.melody.length).toBeGreaterThan(0);
    expect(result.countermelody).toBeUndefined();
  });

  it("leaves the counterline absent when disabled", () => {
    expect(run().countermelody).toBeUndefined();
  });

  it("reattacks on barlines when one chord is held across several bars", () => {
    const barTicks = ticksPerBar("4/4", 480);
    const heldSettings: GeneratorSettings = { ...settings(), bars: 4 };
    const heldChord = chord("held-Cmaj7", "C", 0, barTicks * 4, "major7", [48, 52, 55, 59], "tonic");
    const melody = composeTheoryVoices({ settings: heldSettings, jazz: JAZZ, chords: [heldChord], ppq: 480 }).melody;
    for (let bar = 0; bar < 4; bar += 1) {
      expect(melody.some((note) => note.startTick === bar * barTicks), `bar ${bar} downbeat`).toBe(true);
    }
    for (const note of melody) {
      expect(note.startTick + note.durationTick).toBeLessThanOrEqual((note.barIndex + 1) * barTicks);
    }
  });

  it("makes density, rest rate, and jazz style audibly affect attacks and held note lengths", () => {
    const sparseOptions = {
      seed: "phrase-rhythm",
      density: 0.24,
      restRate: 0.9,
      jazz: { style: "ballad" as const },
    };
    const sparse = run(sparseOptions);
    expect(sparse).toEqual(run(sparseOptions));
    const dense = run({
      seed: "phrase-rhythm",
      density: 0.94,
      restRate: 0.04,
      jazz: { style: "bebop" },
    });
    expect(dense.melody.length).toBeGreaterThan(sparse.melody.length);
    const medianDuration = (notes: readonly NoteEvent[]) => {
      const durations = notes.map((note) => note.durationTick).sort((left, right) => left - right);
      return durations[Math.floor(durations.length / 2)] ?? 0;
    };
    expect(medianDuration(sparse.melody)).toBeGreaterThan(medianDuration(dense.melody));
    const sparseOrdered = [...sparse.melody].sort((left, right) => left.startTick - right.startTick);
    expect(sparseOrdered.some((note, index) => {
      const next = sparseOrdered[index + 1];
      return next !== undefined && note.startTick + note.durationTick < next.startTick;
    })).toBe(true); // Rest rate creates audible release gaps, not only fewer attacks.

    const totalTicks = ticksPerBar("4/4", 480) * 4;
    const barTicks = ticksPerBar("4/4", 480);
    const chordChanges = progression("4/4").slice(1).map((event) => event.startTick);
    const boundaries = chordChanges;
    for (const anchor of [0, ...chordChanges, barTicks * 3 + 480 * 3]) {
      expect(sparse.melody.some((note) => note.startTick === anchor), `mandatory anchor at ${anchor}`).toBe(true);
    }
    for (const notes of [sparse.melody, dense.melody]) {
      const ordered = [...notes].sort((left, right) => left.startTick - right.startTick);
      for (const [index, note] of ordered.entries()) {
        const end = note.startTick + note.durationTick;
        expect(Number.isInteger(note.startTick)).toBe(true);
        expect(Number.isInteger(note.durationTick)).toBe(true);
        expect(end).toBeLessThanOrEqual(totalTicks);
        if (ordered[index + 1]) expect(end).toBeLessThanOrEqual(ordered[index + 1]!.startTick);
        for (const boundary of boundaries) {
          expect(end <= boundary || note.startTick >= boundary).toBe(true);
        }
      }
    }
  });
});
