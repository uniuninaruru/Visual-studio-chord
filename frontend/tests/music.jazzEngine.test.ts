import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATOR_SETTINGS,
  buildCompositionTracks,
  generateComposition,
  regenerateRange,
  validateComposition,
} from "../src/music";
import type { GeneratorSettings, JazzSettings } from "../src/types/music";

const styles: JazzSettings["style"][] = ["swing", "ballad", "bebop", "modern", "neoSoul"];

function jazzSettings(overrides: Partial<JazzSettings> = {}): GeneratorSettings {
  return {
    ...DEFAULT_GENERATOR_SETTINGS,
    style: "jazz",
    bars: 16,
    seed: "jazz-engine-test",
    jazz: {
      version: 1,
      style: "swing",
      form: "aaba",
      chromaticism: 0.35,
      interaction: 0.6,
      ...overrides,
    },
  };
}

function heldAppliedComposition(): ReturnType<typeof generateComposition> {
  const base = generateComposition({
    ...jazzSettings({ form: "free" }),
    bars: 8,
    progressionId: "marunouchi",
  });
  const applied = base.chords[1] as typeof base.chords[number];
  const resolved = base.chords[2] as typeof base.chords[number];
  const tail = base.chords[7] as typeof base.chords[number];
  // The named progression's final I7/IV is deliberately replaced with a
  // plain IV so the loop closes without another unresolved applied claim.
  const safeTail = {
    ...(base.chords[0] as typeof base.chords[number]),
    id: tail.id,
    startTick: tail.startTick,
    durationTick: tail.durationTick,
  };
  const held = {
    ...applied,
    startTick: 0,
    durationTick: base.ticksPerBar * 2,
  };
  return {
    ...base,
    chords: [held, resolved, ...base.chords.slice(3, 7), safeTail],
    lockedBars: [1],
  };
}

describe("dedicated jazz engine", () => {
  it("materialises five profiles with deterministic, valid composition data", () => {
    for (const style of styles) {
      const settings = jazzSettings({ style });
      const first = generateComposition(settings);
      const second = generateComposition(settings);
      expect(first).toEqual(second);
      const validation = validateComposition(first);
      expect(validation.valid, `${style}: ${validation.errors.map((issue) => issue.message).join(" | ")}`).toBe(true);
      expect(first.chords).toHaveLength(16);
      expect(first.notes.length).toBeGreaterThan(0);
      expect(buildCompositionTracks(first)).toHaveLength(3);
    }
  });

  it("uses a true 12-bar blues and honors an explicit named progression", () => {
    const exact = generateComposition({ ...jazzSettings({ form: "blues" }), bars: 12 });
    expect(exact.chords).toHaveLength(12);
    expect(exact.chords.map((chord) => chord.degree)).toEqual([1, 1, 1, 1, 4, 4, 1, 1, 5, 4, 1, 5]);
    const named = generateComposition({
      ...jazzSettings({ form: "blues" }),
      bars: 12,
      progressionId: "ii-V-I",
    });
    expect(named.chords[0]?.quality).toBe("minor7");
    expect(named.chords[1]?.quality).toBe("dominant7");
    expect(named.chords[2]?.quality).toBe("major7");
  });

  it("keeps minor ii-V-i and a truthful cadence", () => {
    const composition = generateComposition({
      ...jazzSettings({ style: "bebop" }),
      mode: "naturalMinor",
      bars: 16,
    });
    expect(composition.chords[0]?.quality).toBe("halfDiminished7");
    expect(composition.chords.some((chord) => chord.quality === "minor7" && chord.degree === 1)).toBe(true);
    const last = composition.chords.at(-1);
    const previous = composition.chords.at(-2);
    const actualVToI = last?.degree === 1
      && previous !== undefined
      && ((["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const).indexOf(last.root)
        - (["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const).indexOf(previous.root) + 12) % 12 === 7;
    expect(composition.cadence).toBe(actualVToI ? "authentic" : "loop");
    const validation = validateComposition(composition);
    expect(validation.valid, validation.errors.map((issue) => issue.message).join(" | ")).toBe(true);
  });

  it("regenerates only unlocked selected bars and leaves voicing identity intact", () => {
    const settings = jazzSettings({ style: "swing" });
    const source = generateComposition(settings);
    const locked = { ...source, lockedBars: [2] };
    const regenerated = regenerateRange(locked, locked.settings, { startBar: 1, endBar: 4 }, { target: "voicing", seedOffset: 5 });
    expect(regenerated.chords[2]).toBe(source.chords[2]);
    expect(regenerated.chords[0]).toBe(source.chords[0]);
    expect(regenerated.chords[1]?.id).toBe(source.chords[1]?.id);
    expect(regenerated.chords[1]?.root).toBe(source.chords[1]?.root);
    expect(regenerated.chords[1]?.quality).toBe(source.chords[1]?.quality);
    expect(regenerated.chords[1]?.startTick).toBe(source.chords[1]?.startTick);
    expect(regenerated.chords[1]?.durationTick).toBe(source.chords[1]?.durationTick);
  });

  it("splits a hand-edited crossbar chord before replacing an unlocked bar", () => {
    const source = generateComposition(jazzSettings({ style: "ballad", form: "modal" }));
    const first = source.chords[0] as typeof source.chords[number];
    const second = source.chords[1] as typeof source.chords[number];
    const edited = {
      ...source,
      chords: [
        { ...first, durationTick: first.durationTick + second.durationTick },
        ...source.chords.slice(2),
      ],
      lockedBars: [1],
    };
    expect(validateComposition(edited).valid).toBe(true);
    const regenerated = regenerateRange(edited, edited.settings, { startBar: 0, endBar: 1 }, { target: "chords", seedOffset: 9 });
    const validation = validateComposition(regenerated);
    expect(validation.valid, validation.errors.map((issue) => issue.message).join(" | ")).toBe(true);
    expect(regenerated.chords.some((chord) => Math.floor(chord.startTick / regenerated.ticksPerBar) === 1)).toBe(true);
    expect(regenerated.chords.find((chord) => Math.floor(chord.startTick / regenerated.ticksPerBar) === 1)?.startTick)
      .toBe(regenerated.ticksPerBar);
  });

  it("reproduces a held applied-dominant lock before revoicing", () => {
    const source = heldAppliedComposition();
    const beforeValidation = validateComposition(source);
    expect(beforeValidation.valid, beforeValidation.errors.map((issue) => issue.code + ":" + issue.message).join(" | ")).toBe(true);
    const regenerated = regenerateRange(source, source.settings, { startBar: 0, endBar: 1 }, {
      target: "voicing",
      seedOffset: 7,
    });
    const validation = validateComposition(regenerated);
    expect(validation.valid, validation.errors.map((issue) => issue.message).join(" | ")).toBe(true);
    expect(regenerated.chords.find((chord) => chord.startTick === 0)?.source).toBe("other");
    expect(regenerated.chords.find((chord) => chord.startTick === source.ticksPerBar)?.source)
      .toBe("secondaryDominant");
    expect(regenerated.chords.find((chord) => chord.startTick === source.ticksPerBar)?.targetDegree)
      .toBe(6);
    const allRegenerated = regenerateRange(source, source.settings, { startBar: 0, endBar: 1 }, {
      target: "all",
      seedOffset: 7,
    });
    const allValidation = validateComposition(allRegenerated);
    expect(allValidation.valid, allValidation.errors.map((issue) => issue.code + ":" + issue.message).join(" | ")).toBe(true);
    const lockedContinuation = allRegenerated.chords.find((chord) => chord.startTick === source.ticksPerBar);
    expect(lockedContinuation?.source).toBe("secondaryDominant");
    expect(lockedContinuation?.targetDegree).toBe(6);
    expect(lockedContinuation?.notes).toEqual(source.chords[0]?.notes);
    expect(allRegenerated.chords.find((chord) => chord.startTick === source.ticksPerBar * 2)).toBe(source.chords[1]);
    expect(allRegenerated.notes.filter((note) => note.barIndex === 1))
      .toEqual(source.notes.filter((note) => note.barIndex === 1));
  });

  it("makes chromatic approach probability observable and resolves to the planned MIDI target", () => {
    const chromatic = generateComposition(jazzSettings({ style: "bebop", chromaticism: 1 }));
    const straight = generateComposition(jazzSettings({ style: "bebop", chromaticism: 0 }));
    const approaches = chromatic.notes.filter((note) => note.role === "approach");
    expect(approaches.length).toBeGreaterThan(0);
    expect(straight.notes.filter((note) => note.role === "approach")).toHaveLength(0);
    for (const approach of approaches) {
      const next = chromatic.notes.find((note) => note.startTick > approach.startTick);
      expect(next).toBeDefined();
      expect(Math.abs((next as typeof approach).midi - approach.midi)).toBe(1);
    }
  });

  it("writes a real two-sided enclosure into the next guide-tone target", () => {
    const composition = generateComposition(jazzSettings({ style: "bebop", chromaticism: 1 }));
    const notes = [...composition.notes].sort((left, right) => left.startTick - right.startTick);
    const enclosure = notes.find((note, index) => {
      const approach = notes[index + 1];
      const target = notes[index + 2];
      if (note.role !== "neighbor" || approach?.role !== "approach" || target === undefined) return false;
      return Math.abs(note.midi - target.midi) === 1
        && Math.abs(approach.midi - target.midi) === 1
        && (note.midi - target.midi) * (approach.midi - target.midi) === -1;
    });
    expect(enclosure).toBeDefined();
  });

  it("uses the shared time grid in 6/8", () => {
    const composition = generateComposition({ ...jazzSettings({ form: "modal" }), timeSignature: "6/8" });
    expect(composition.ticksPerBar).toBe(1440);
    expect(composition.totalTicks).toBe(1440 * 16);
    const validation = validateComposition(composition);
    expect(validation.valid, validation.errors.map((issue) => issue.message).join(" | ")).toBe(true);
  });

  it("keeps the supported jazz matrix valid across modes, keys, forms, and meters", () => {
    const failures: string[] = [];
    const modes: GeneratorSettings["mode"][] = ["major", "naturalMinor", "dorian"];
    const keys: GeneratorSettings["key"][] = ["C", "F#", "Bb"];
    const forms: JazzSettings["form"][] = ["aaba", "blues", "modal", "free"];
    const meters: GeneratorSettings["timeSignature"][] = ["4/4", "3/4", "6/8"];
    for (const style of styles) {
      for (const mode of modes) {
        for (const key of keys) {
          for (const form of forms) {
            for (const timeSignature of meters) {
              const bars = form === "blues" ? 12 : 16;
              const composition = generateComposition({
                ...jazzSettings({ style, form }),
                mode,
                key,
                bars,
                timeSignature,
                seed: `matrix-${style}-${mode}-${key}-${form}-${timeSignature}`,
              });
              const validation = validateComposition(composition);
              if (!validation.valid) {
                failures.push(`${style}/${mode}/${key}/${form}/${timeSignature}: ${validation.errors.map((issue) => issue.code).join(",")}`);
              }
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("keeps compressed AABA lengths valid around section boundaries", () => {
    const failures: string[] = [];
    const modes: GeneratorSettings["mode"][] = ["major", "naturalMinor", "dorian"];
    const barsList = [4, 8, 12, 16, 24, 32, 48] as const;
    for (const style of styles) {
      for (const mode of modes) {
        for (const bars of barsList) {
          for (const form of ["aaba", "modal", "free"] as const) {
            const composition = generateComposition({
              ...jazzSettings({ style, form, chromaticism: 1 }),
              mode,
              bars,
              seed: `boundary-${style}-${mode}-${bars}-${form}`,
            });
            const validation = validateComposition(composition);
            if (!validation.valid) {
              failures.push(`${style}/${mode}/${bars}/${form}: ${validation.errors.map((issue) => issue.code).join(",")}`);
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
