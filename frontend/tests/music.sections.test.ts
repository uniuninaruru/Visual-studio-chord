import { describe, expect, it } from "vitest";
import {
  MINIMAL_GENERATOR_SETTINGS,
  generateComposition,
  getMelodyScaleMidiNotes,
  pitchClassToSemitone,
  planSections,
  regenerateRange,
  sectionForBar,
  sectionsTileBars,
  validateComposition,
} from "../src/music";
import { exportCompositionJson, importCompositionJson } from "../src/features/export/json";
import type {
  BarCount,
  GeneratorSettings,
  SongFormId,
  SongFormSettings,
} from "../src/types/music";

const FORMS = ["verseChorus", "aaba", "throughComposed"] satisfies SongFormId[];
const BAR_COUNTS = [4, 8, 16] satisfies BarCount[];

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...MINIMAL_GENERATOR_SETTINGS,
    ...patch,
    melody: { ...MINIMAL_GENERATOR_SETTINGS.melody, ...patch.melody },
  };
}

function withForm(form: SongFormSettings, patch: Partial<GeneratorSettings> = {}) {
  return generateComposition(settings({ ...patch, songForm: form }));
}

function chordsOf(
  composition: ReturnType<typeof generateComposition>,
  startBar: number,
  endBar: number,
) {
  const ticks = composition.ticksPerBar;
  return composition.chords.filter(
    (chord) => chord.startTick >= startBar * ticks && chord.startTick < endBar * ticks,
  );
}

describe("section planning", () => {
  it("returns no sections when no form is requested", () => {
    expect(planSections({ key: "C", mode: "major", bars: 8, seed: "s", form: "none" }))
      .toBeUndefined();
  });

  it.each(FORMS)("tiles every bar count exactly for %s", (form) => {
    for (const bars of BAR_COUNTS) {
      const sections = planSections({ key: "C", mode: "major", bars, seed: "s", form })!;
      expect(sections.length).toBeGreaterThan(1);
      expect(sectionsTileBars(sections, bars)).toBe(true);
      // every section holds at least one bar
      expect(sections.every((s) => s.endBar > s.startBar)).toBe(true);
      expect(sections.at(-1)!.endBar).toBe(bars);
    }
  });

  it("rejects plans that leave a gap, overlap, or fall short", () => {
    const base = planSections({ key: "C", mode: "major", bars: 8, seed: "s", form: "aaba" })!;
    expect(sectionsTileBars(base, 8)).toBe(true);
    expect(sectionsTileBars(base, 16)).toBe(false);
    const gapped = base.map((s, i) => (i === 1 ? { ...s, startBar: s.startBar + 1 } : s));
    expect(sectionsTileBars(gapped, 8)).toBe(false);
    expect(sectionsTileBars([], 8)).toBe(false);
  });

  it("resolves the section covering each bar", () => {
    const sections = planSections({ key: "C", mode: "major", bars: 8, seed: "s", form: "aaba" })!;
    for (let bar = 0; bar < 8; bar += 1) {
      const section = sectionForBar(sections, bar)!;
      expect(bar).toBeGreaterThanOrEqual(section.startBar);
      expect(bar).toBeLessThan(section.endBar);
    }
    expect(sectionForBar(sections, 8)).toBeUndefined();
    expect(sectionForBar(undefined, 0)).toBeUndefined();
  });

  it("is deterministic for a given seed and form", () => {
    const plan = () =>
      planSections({ key: "C", mode: "major", bars: 16, seed: "fixed", form: "verseChorus" });
    expect(plan()).toEqual(plan());
  });
});

describe("repeating versus through-composed form", () => {
  it("restates a repeated section rather than inventing new material", () => {
    const sections = planSections({ key: "C", mode: "major", bars: 8, seed: "s", form: "aaba" })!;
    const verses = sections.filter((s) => s.kind === "verse");
    // AABA has three A sections; they are the same music.
    expect(verses.length).toBe(3);
    expect(new Set(verses.map((s) => s.progressionId)).size).toBe(1);
  });

  it("gives sections of different kinds different progressions", () => {
    const sections = planSections({
      key: "C", mode: "major", bars: 16, seed: "s", form: "verseChorus",
    })!;
    const byKind = new Map<string, Set<string>>();
    for (const s of sections) {
      const set = byKind.get(s.kind) ?? new Set<string>();
      set.add(s.progressionId ?? "");
      byKind.set(s.kind, set);
    }
    // each kind is internally consistent...
    for (const ids of byKind.values()) expect(ids.size).toBe(1);
    // ...and a pre-chorus does not simply restate the verse
    const kinds = [...byKind.entries()].map(([kind, ids]) => [kind, [...ids][0]] as const);
    expect(new Set(kinds.map(([, id]) => id)).size).toBe(kinds.length);
  });

  it("never reuses a progression in a through-composed piece", () => {
    const sections = planSections({
      key: "C", mode: "major", bars: 16, seed: "s", form: "throughComposed",
    })!;
    const ids = sections.map((s) => s.progressionId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("modulation", () => {
  it("does not modulate unless a lift is requested", () => {
    const composition = withForm({ form: "verseChorus" });
    expect(composition.sections!.every((s) => s.transpose === 0)).toBe(true);
    expect(new Set(composition.sections!.map((s) => s.key)).size).toBe(1);
  });

  it("lifts only the final section, by the requested semitones", () => {
    for (const lift of [1, 2, 3]) {
      const composition = withForm({ form: "verseChorus", finalLift: lift }, { key: "C" });
      const sections = composition.sections!;
      expect(sections.slice(0, -1).every((s) => s.transpose === 0)).toBe(true);
      const last = sections.at(-1)!;
      expect(last.transpose).toBe(lift);
      expect(pitchClassToSemitone(last.key)).toBe(
        (pitchClassToSemitone("C") + lift) % 12,
      );
    }
  });

  it("actually transposes the chords of the lifted section", () => {
    const composition = withForm({ form: "aaba", finalLift: 2 }, { key: "C", bars: 8 });
    const sections = composition.sections!;
    const first = sections[0]!;
    const last = sections.at(-1)!;
    // AABA restates its A material, so the final A is the first A a tone higher.
    expect(last.progressionId).toBe(first.progressionId);
    const firstRoots = chordsOf(composition, first.startBar, first.endBar)
      .map((c) => pitchClassToSemitone(c.root));
    const lastRoots = chordsOf(composition, last.startBar, last.endBar)
      .map((c) => pitchClassToSemitone(c.root));
    expect(lastRoots).toEqual(firstRoots.map((s) => (s + 2) % 12));
  });

  it("keeps a modulated section valid, which a global-key check would not", () => {
    const composition = withForm({ form: "verseChorus", finalLift: 2 }, { key: "C" });
    const validation = validateComposition(composition);
    expect(validation.errors).toEqual([]);
  });
});

describe("polytonality and pentatonic melody", () => {
  it("runs the melody in a different mode than the harmony when asked", () => {
    const composition = withForm({ form: "verseChorus", polytonal: true }, { mode: "major" });
    for (const section of composition.sections!) {
      expect(section.mode).toBe("major");
      expect(section.melodyMode).toBe("naturalMinor");
      expect(section.melodyMode).not.toBe(section.mode);
    }
  });

  it("leaves melodyMode unset when polytonality is off", () => {
    const composition = withForm({ form: "verseChorus" });
    expect(composition.sections!.every((s) => s.melodyMode === undefined)).toBe(true);
  });

  it("confines melody notes to the pentatonic it was given", () => {
    const composition = withForm(
      { form: "verseChorus", melodyScale: "yonaNuki" },
      { key: "C", mode: "major", bars: 8 },
    );
    const allowed = new Set(
      getMelodyScaleMidiNotes(
        "C",
        "major",
        composition.settings.melody.minMidi,
        composition.settings.melody.maxMidi,
        "yonaNuki",
      ).map((midi) => midi % 12),
    );
    // 4th and 7th are the degrees yona-nuki removes.
    expect(allowed.has((pitchClassToSemitone("C") + 5) % 12)).toBe(false);
    expect(allowed.has((pitchClassToSemitone("C") + 11) % 12)).toBe(false);
    for (const note of composition.notes) {
      expect(allowed.has(note.midi % 12)).toBe(true);
    }
  });

  it("records melodyScale on every section when requested", () => {
    const composition = withForm({ form: "aaba", melodyScale: "niroNuki" }, { mode: "naturalMinor" });
    expect(composition.sections!.every((s) => s.melodyScale === "niroNuki")).toBe(true);
  });
});

describe("sectioned compositions as a whole", () => {
  it.each(FORMS)("produces a valid composition for %s at every bar count", (form) => {
    for (const bars of BAR_COUNTS) {
      const composition = withForm(
        { form, finalLift: 2, polytonal: true, melodyScale: "yonaNuki" },
        { bars, seed: `${form}-${bars}` },
      );
      const validation = validateComposition(composition);
      expect(
        validation.errors,
        `${form}/${bars}: ${validation.errors.map((e) => e.code).join(", ")}`,
      ).toEqual([]);
      expect(sectionsTileBars(composition.sections!, bars)).toBe(true);
    }
  });

  it("keeps the chord timeline flat, contiguous and gap-free across sections", () => {
    const composition = withForm({ form: "throughComposed", finalLift: 2 }, { bars: 16 });
    let cursor = 0;
    for (const chord of [...composition.chords].sort((a, b) => a.startTick - b.startTick)) {
      expect(chord.startTick).toBe(cursor);
      cursor = chord.startTick + chord.durationTick;
    }
    expect(cursor).toBe(composition.totalTicks);
  });

  it("gives every chord a unique id across section boundaries", () => {
    const composition = withForm({ form: "verseChorus", finalLift: 2 }, { bars: 16 });
    const ids = composition.chords.map((chord) => chord.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic", () => {
    const make = () =>
      withForm({ form: "verseChorus", finalLift: 2, polytonal: true }, { seed: "fixed" });
    expect(make()).toEqual(make());
  });

  it("distinguishes two pieces that differ only by form", () => {
    const a = withForm({ form: "verseChorus" }, { seed: "same" });
    const b = withForm({ form: "aaba" }, { seed: "same" });
    expect(a.id).not.toBe(b.id);
  });

  it("distinguishes two pieces that differ only by the final lift", () => {
    const a = withForm({ form: "verseChorus", finalLift: 0 }, { seed: "same" });
    const b = withForm({ form: "verseChorus", finalLift: 2 }, { seed: "same" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("partial regeneration of a sectioned piece", () => {
  it.each(["chords", "all", "melody"] as const)(
    "regenerates a modulated section in that section's key (%s)",
    (target) => {
      const composition = withForm({ form: "aaba", finalLift: 2 }, { key: "C", bars: 8, seed: "rg" });
      const last = composition.sections!.at(-1)!;
      expect(last.key).not.toBe("C");

      const regenerated = regenerateRange(
        composition,
        composition.settings,
        { startBar: last.startBar, endBar: last.endBar },
        { target },
      );
      expect(validateComposition(regenerated).errors).toEqual([]);
      // Every chord of the modulated span belongs to that section's key, not
      // the key the piece opened in.
      const tonic = pitchClassToSemitone(last.key);
      const scale = new Set([0, 2, 4, 5, 7, 9, 11].map((s) => (tonic + s) % 12));
      for (const chord of chordsOf(regenerated, last.startBar, last.endBar)) {
        if (chord.source === "diatonic") {
          expect(scale.has(pitchClassToSemitone(chord.root))).toBe(true);
        }
      }
    },
  );

  it("keeps the section plan intact through regeneration", () => {
    const composition = withForm({ form: "verseChorus", finalLift: 2 }, { bars: 8, seed: "keep" });
    const regenerated = regenerateRange(
      composition,
      composition.settings,
      { startBar: 0, endBar: 2 },
      { target: "chords" },
    );
    expect(regenerated.sections).toEqual(composition.sections);
  });
});

describe("backward compatibility", () => {
  it("omits sections entirely when no form is requested", () => {
    const composition = generateComposition(settings({ seed: "plain" }));
    expect(composition.sections).toBeUndefined();
    expect(exportCompositionJson(composition)).not.toContain('"sections"');
  });

  it("produces byte-identical output with and without an explicit none form", () => {
    const plain = generateComposition(settings({ seed: "same" }));
    const explicit = generateComposition(settings({ seed: "same", songForm: { form: "none" } }));
    expect(explicit.chords).toEqual(plain.chords);
    expect(explicit.notes).toEqual(plain.notes);
    expect(explicit.id).toBe(plain.id);
  });

  it("round-trips a sectioned composition through JSON", () => {
    for (const form of FORMS) {
      const composition = withForm(
        { form, finalLift: 2, polytonal: true, melodyScale: "yonaNuki" },
        { bars: 8, seed: `rt-${form}` },
      );
      const restored = importCompositionJson(exportCompositionJson(composition));
      expect(restored.sections).toEqual(composition.sections);
      expect(restored.chords).toEqual(composition.chords);
    }
  });

  it("rejects a section grid that does not tile the bars", () => {
    const composition = withForm({ form: "aaba" }, { bars: 8, seed: "tamper" });
    const document = JSON.parse(exportCompositionJson(composition));
    document.composition.sections[1].startBar += 1;
    expect(() => importCompositionJson(JSON.stringify(document))).toThrow();
  });

  it("rejects a section carrying an unsupported mode", () => {
    const composition = withForm({ form: "aaba" }, { bars: 8, seed: "tamper2" });
    const document = JSON.parse(exportCompositionJson(composition));
    document.composition.sections[0].mode = "lydian";
    expect(() => importCompositionJson(JSON.stringify(document))).toThrow();
  });
});
