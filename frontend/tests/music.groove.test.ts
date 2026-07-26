import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  GROOVE_TEMPLATES,
  GROOVE_TEMPLATE_IDS,
  applyGroove,
  generateComposition,
  grooveForStyle,
  summarizeGroove,
  validateComposition,
} from "../src/music";
import type { GeneratorSettings, NoteEvent } from "../src/types/music";

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...DEFAULT_GENERATOR_SETTINGS,
    ...patch,
    melody: { ...DEFAULT_GENERATOR_SETTINGS.melody, ...patch.melody },
  };
}

const TEMPLATE_NOTE = generateComposition(settings({ bars: 4, seed: "t" })).notes[0]!;

/** Four straight eighths in bar zero. */
function eighths(): NoteEvent[] {
  return Array.from({ length: 8 }, (_, index) => ({
    ...TEMPLATE_NOTE,
    id: `n${index}`,
    startTick: index * 240,
    durationTick: 240,
    barIndex: 0,
    velocity: 90,
  }));
}

const groove = (notes: NoteEvent[], template: (typeof GROOVE_TEMPLATE_IDS)[number], amount?: number) =>
  applyGroove(notes, {
    timeSignature: "4/4",
    settings: { enabled: true, template, ...(amount === undefined ? {} : { amount }) },
  });

describe("the templates", () => {
  it("define a timing and an accent for every step", () => {
    for (const id of GROOVE_TEMPLATE_IDS) {
      const template = GROOVE_TEMPLATES[id];
      expect(template.timing, id).toHaveLength(template.resolution);
      expect(template.accent, id).toHaveLength(template.resolution);
      expect(template.id, id).toBe(id);
      for (const value of template.accent) expect(value, id).toBeGreaterThan(0);
    }
  });

  it("leaves the straight template doing nothing", () => {
    const template = GROOVE_TEMPLATES.straight;
    expect(new Set(template.timing)).toEqual(new Set([0]));
    expect(new Set(template.accent)).toEqual(new Set([1]));
  });

  it("swings only the off-beats", () => {
    const template = GROOVE_TEMPLATES.swing8;
    for (const [index, value] of template.timing.entries()) {
      if (index % 2 === 0) expect(value, `step ${index}`).toBe(0);
      else expect(value, `step ${index}`).toBeGreaterThan(0);
    }
  });

  it("puts the backbeat accent on two and four", () => {
    const template = GROOVE_TEMPLATES.backbeat;
    // A sixteenth grid: steps 0, 4, 8 and 12 are the beats.
    expect(template.accent[4]).toBeGreaterThan(template.accent[0] as number);
    expect(template.accent[12]).toBeGreaterThan(template.accent[8] as number);
    expect(new Set(template.timing)).toEqual(new Set([0]));
  });

  it("finds the groove a style reaches for", () => {
    expect(grooveForStyle("jazz")).toBe("swing8");
    expect(grooveForStyle("rock")).toBe("shuffle");
    expect(grooveForStyle("random")).toBeNull();
  });
});

describe("applying a groove", () => {
  it("does nothing when off, at zero amount, or with no notes", () => {
    const notes = eighths();
    expect(applyGroove(notes, {
      timeSignature: "4/4", settings: { enabled: false, template: "swing8" },
    })).toEqual(notes);
    expect(groove(notes, "swing8", 0)).toEqual(notes);
    expect(groove([], "swing8")).toEqual([]);
    expect(groove(notes, "straight")).toEqual(notes);
  });

  it("delays a swung off-beat by a sixth of a beat", () => {
    // A triplet swing puts the off-beat two thirds of the way through the beat.
    // A beat is 480 ticks, so the delay is 80.
    const played = groove(eighths(), "swing8");
    expect(played[0]!.startTick).toBe(0);
    expect(played[1]!.startTick).toBe(240 + 80);
    expect(played[2]!.startTick).toBe(480);
    expect(played[3]!.startTick).toBe(720 + 80);
  });

  it("scales the whole effect by the amount", () => {
    const half = groove(eighths(), "swing8", 0.5);
    expect(half[1]!.startTick).toBe(240 + 40);
    const quarter = groove(eighths(), "swing8", 0.25);
    expect(quarter[1]!.startTick).toBe(240 + 20);
  });

  it("changes velocity without changing timing, for an accent-only groove", () => {
    const played = groove(eighths(), "backbeat");
    expect(played.map((n) => n.startTick)).toEqual(eighths().map((n) => n.startTick));
    const velocities = played.map((n) => n.velocity);
    expect(new Set(velocities).size).toBeGreaterThan(1);
    for (const velocity of velocities) {
      expect(velocity).toBeGreaterThanOrEqual(1);
      expect(velocity).toBeLessThanOrEqual(127);
    }
  });

  it("keeps velocity inside the legal range even at extremes", () => {
    const loud = eighths().map((note) => ({ ...note, velocity: 127 }));
    const quiet = eighths().map((note) => ({ ...note, velocity: 1 }));
    for (const template of GROOVE_TEMPLATE_IDS) {
      for (const note of [...groove(loud, template), ...groove(quiet, template)]) {
        expect(note.velocity, template).toBeGreaterThanOrEqual(1);
        expect(note.velocity, template).toBeLessThanOrEqual(127);
        expect(Number.isInteger(note.velocity)).toBe(true);
      }
    }
  });

  it("never moves a note out of its own bar", () => {
    // The last note of a bar is where a late groove would push past the line.
    const late = [
      { ...TEMPLATE_NOTE, id: "a", startTick: 1680, durationTick: 240, barIndex: 0 },
    ];
    for (const template of GROOVE_TEMPLATE_IDS) {
      for (const note of groove(late, template)) {
        expect(note.startTick, template).toBeGreaterThanOrEqual(0);
        expect(note.startTick + note.durationTick, template).toBeLessThanOrEqual(1920);
        expect(note.durationTick, template).toBeGreaterThan(0);
      }
    }
  });

  it("never lets one note overlap the next", () => {
    for (const template of GROOVE_TEMPLATE_IDS) {
      const played = groove(eighths(), template);
      for (let index = 1; index < played.length; index += 1) {
        const previous = played[index - 1]!;
        expect(played[index]!.startTick, template).toBeGreaterThanOrEqual(
          previous.startTick + previous.durationTick,
        );
      }
    }
  });

  it("keeps every duration a positive integer", () => {
    for (const template of GROOVE_TEMPLATE_IDS) {
      for (const note of groove(eighths(), template)) {
        expect(Number.isInteger(note.durationTick), template).toBe(true);
        expect(note.durationTick, template).toBeGreaterThan(0);
        expect(Number.isInteger(note.startTick), template).toBe(true);
      }
    }
  });

  it("reports what it did", () => {
    const before = eighths();
    const after = groove(before, "swing8");
    const summary = summarizeGroove(before, after)!;
    expect(summary.movedNotes).toBe(4);
    expect(summary.largestShift).toBe(80);
    expect(summary.averageShift).toBe(40);
    expect(summarizeGroove(before, before)!.movedNotes).toBe(0);
    expect(summarizeGroove([], [])).toBeNull();
  });
});

describe("groove in generated compositions", () => {
  const grooved = (patch: Partial<GeneratorSettings> = {}) =>
    settings({ bars: 8, seed: "gv", groove: { enabled: true, template: "swing8" }, ...patch });

  it("stays valid for every template, mode and time signature", () => {
    for (const template of GROOVE_TEMPLATE_IDS) {
      for (const timeSignature of ["4/4", "3/4", "6/8"] as const) {
        const composition = generateComposition(
          grooved({ timeSignature, seed: `${template}-${timeSignature}`, groove: { enabled: true, template } }),
        );
        expect(
          validateComposition(composition).errors,
          `${template}/${timeSignature}`,
        ).toEqual([]);
      }
    }
  });

  it("changes the performance without changing the notes", () => {
    const plain = generateComposition(grooved({ groove: undefined }));
    const played = generateComposition(grooved());
    // The same pitches in the same order — only when and how hard they sound.
    expect(played.notes.map((n) => n.midi)).toEqual(plain.notes.map((n) => n.midi));
    expect(played.notes.map((n) => n.startTick)).not.toEqual(plain.notes.map((n) => n.startTick));
  });

  it("is deterministic and distinguishes its settings", () => {
    expect(generateComposition(grooved())).toEqual(generateComposition(grooved()));
    const ids = [
      generateComposition(grooved({ groove: undefined })).id,
      generateComposition(grooved()).id,
      generateComposition(grooved({ groove: { enabled: true, template: "shuffle" } })).id,
      generateComposition(grooved({ groove: { enabled: true, template: "swing8", amount: 0.5 } })).id,
    ];
    expect(new Set(ids).size).toBe(4);
  });

  it("composes with a Euclidean pattern and the rest of the engine", () => {
    const composition = generateComposition(
      grooved({
        bars: 16,
        seed: "all",
        euclideanRhythm: { enabled: true, onsets: 5, steps: 16 },
        phraseGrammar: { enabled: true },
        melodicSkeleton: { enabled: true },
        nonChordTones: { enabled: true, rate: 1 },
      }),
    );
    expect(validateComposition(composition).errors).toEqual([]);
  });
});
