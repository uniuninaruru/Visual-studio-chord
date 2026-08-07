import { describe, expect, it } from "vitest";
import {
  MINIMAL_GENERATOR_SETTINGS,
  VOICE_LEADING_PROFILES,
  VOICE_RANGES,
  assignmentToNotes,
  findVoiceLeadingIssues,
  generateComposition,
  profileForStyle,
  revoiceInFourParts,
  validateComposition,
  voiceChordInFourParts,
  voiceLeadingCost,
} from "../src/music";
import type { HarmonyContext, VoiceAssignment } from "../src/music";
import type { GeneratorSettings, StylePresetId } from "../src/types/music";

const CONTEXT: HarmonyContext = {
  mode: "major",
  key: "C",
  quality: "major",
  root: "C",
  tonicSemitone: 0,
};

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...MINIMAL_GENERATOR_SETTINGS,
    ...patch,
    melody: { ...MINIMAL_GENERATOR_SETTINGS.melody, ...patch.melody },
  };
}

/** C3 G3 C4 E4 — a plain root-position C. */
const C_MAJOR: VoiceAssignment = { bass: 48, tenor: 55, alto: 60, soprano: 64 };

function types(previous: VoiceAssignment, next: VoiceAssignment, context = CONTEXT) {
  return findVoiceLeadingIssues(previous, next, context).map((issue) => issue.type);
}

describe("detecting part-writing faults", () => {
  it("finds parallel fifths and octaves when voices move together", () => {
    // Everything shifts up a tone, so every interval is preserved.
    const parallel: VoiceAssignment = { bass: 50, tenor: 57, alto: 62, soprano: 66 };
    const found = types(C_MAJOR, parallel);
    expect(found).toContain("parallelFifth");
    expect(found).toContain("parallelOctave");
  });

  it("does not flag a preserved fifth reached by contrary motion", () => {
    // bass and tenor still sound a fifth apart, but they arrived by moving in
    // opposite directions, so the voices stayed independent.
    const contrary: VoiceAssignment = { bass: 43, tenor: 62, alto: 67, soprano: 71 };
    const lowerMoved = contrary.bass - C_MAJOR.bass;
    const upperMoved = contrary.tenor - C_MAJOR.tenor;
    expect(Math.sign(lowerMoved)).not.toBe(Math.sign(upperMoved));
    expect(types(C_MAJOR, contrary)).not.toContain("parallelFifth");
  });

  it("flags a preserved fifth only when both voices move the same way", () => {
    // Same interval before and after, both voices down a minor third.
    const similar: VoiceAssignment = { bass: 45, tenor: 52, alto: 60, soprano: 64 };
    expect(types(C_MAJOR, similar)).toContain("parallelFifth");
  });

  it("names the two voices that ran in parallel", () => {
    const parallel: VoiceAssignment = { bass: 50, tenor: 57, alto: 62, soprano: 66 };
    const fifth = findVoiceLeadingIssues(C_MAJOR, parallel, CONTEXT)
      .find((issue) => issue.type === "parallelFifth")!;
    expect(fifth.voices).toHaveLength(2);
  });

  it("finds a voice crossing above its neighbour", () => {
    const crossed: VoiceAssignment = { bass: 48, tenor: 70, alto: 60, soprano: 64 };
    expect(types(C_MAJOR, crossed)).toContain("voiceCrossing");
  });

  it("finds an unresolved leading tone in an outer voice", () => {
    const onLeadingTone: VoiceAssignment = { ...C_MAJOR, soprano: 71 };
    const awayFromTonic: VoiceAssignment = { ...C_MAJOR, soprano: 67 };
    expect(types(onLeadingTone, awayFromTonic)).toContain("unresolvedLeadingTone");

    const toTonic: VoiceAssignment = { ...C_MAJOR, soprano: 72 };
    expect(types(onLeadingTone, toTonic)).not.toContain("unresolvedLeadingTone");
  });

  it("finds a chordal seventh that rises instead of falling", () => {
    const context: HarmonyContext = { ...CONTEXT, quality: "dominant7", root: "G" };
    // F is the seventh of G7.
    const onSeventh: VoiceAssignment = { bass: 43, tenor: 59, alto: 62, soprano: 65 };
    const rising: VoiceAssignment = { bass: 43, tenor: 59, alto: 62, soprano: 67 };
    expect(types(onSeventh, rising, context)).toContain("unresolvedSeventh");

    const falling: VoiceAssignment = { bass: 43, tenor: 59, alto: 62, soprano: 64 };
    expect(types(onSeventh, falling, context)).not.toContain("unresolvedSeventh");
  });

  it("finds an oversized leap in an inner voice", () => {
    const leaping: VoiceAssignment = { ...C_MAJOR, alto: 74 };
    expect(types(C_MAJOR, leaping)).toContain("largeLeap");
  });

  it("reports nothing for a chord repeated unchanged", () => {
    expect(findVoiceLeadingIssues(C_MAJOR, C_MAJOR, CONTEXT)).toEqual([]);
  });
});

describe("style profiles", () => {
  it("forbids parallels in the classical profile and permits them in electronic", () => {
    expect(VOICE_LEADING_PROFILES.classical!.parallelFifthPenalty).toBeGreaterThan(5);
    expect(VOICE_LEADING_PROFILES.electronic!.parallelFifthPenalty).toBe(0);
  });

  it("weights the top line most in pop and tendency tones most in classical", () => {
    const { pop, classical, jazz } = VOICE_LEADING_PROFILES;
    expect(pop!.largeLeapPenalty).toBeGreaterThan(classical!.largeLeapPenalty);
    expect(classical!.tendencyToneWeight).toBeGreaterThan(jazz!.tendencyToneWeight);
  });

  it("maps each style to a profile", () => {
    const styles = [
      "pop", "j-pop", "rock", "jazz", "lo-fi", "edm", "ballad", "game-music",
    ] satisfies StylePresetId[];
    for (const style of styles) {
      expect(profileForStyle(style)).toBeDefined();
    }
    expect(profileForStyle("edm")).toBe(VOICE_LEADING_PROFILES.electronic);
    expect(profileForStyle("jazz")).toBe(VOICE_LEADING_PROFILES.jazz);
  });

  it("charges the same fault differently depending on the profile", () => {
    const parallel: VoiceAssignment = { bass: 50, tenor: 57, alto: 62, soprano: 66 };
    const strict = voiceLeadingCost(C_MAJOR, parallel, CONTEXT, VOICE_LEADING_PROFILES.classical!);
    const loose = voiceLeadingCost(C_MAJOR, parallel, CONTEXT, VOICE_LEADING_PROFILES.electronic!);
    expect(strict).toBeGreaterThan(loose);
  });

  it("rewards holding a common tone", () => {
    const held: VoiceAssignment = { bass: 48, tenor: 55, alto: 60, soprano: 64 };
    const moved: VoiceAssignment = { bass: 48, tenor: 55, alto: 60, soprano: 65 };
    const profile = VOICE_LEADING_PROFILES.classical!;
    expect(voiceLeadingCost(C_MAJOR, held, CONTEXT, profile))
      .toBeLessThan(voiceLeadingCost(C_MAJOR, moved, CONTEXT, profile));
  });
});

describe("choosing a four-part voicing", () => {
  it("keeps every voice inside its range and in order", () => {
    const assignment = voiceChordInFourParts({
      root: "C",
      quality: "major",
      profile: VOICE_LEADING_PROFILES.classical!,
      context: CONTEXT,
    })!;
    expect(assignment.bass).toBeLessThan(assignment.tenor);
    expect(assignment.tenor).toBeLessThan(assignment.alto);
    expect(assignment.alto).toBeLessThan(assignment.soprano);
    for (const [voice, [low, high]] of Object.entries(VOICE_RANGES)) {
      const midi = assignment[voice as keyof VoiceAssignment];
      expect(midi).toBeGreaterThanOrEqual(low);
      expect(midi).toBeLessThanOrEqual(high);
    }
  });

  it("sounds every chord tone", () => {
    const assignment = voiceChordInFourParts({
      root: "C",
      quality: "major",
      profile: VOICE_LEADING_PROFILES.classical!,
      context: CONTEXT,
    })!;
    const classes = new Set(assignmentToNotes(assignment).map((midi) => midi % 12));
    // C E G
    expect(classes).toEqual(new Set([0, 4, 7]));
  });

  it("puts a slash bass in the bass", () => {
    const assignment = voiceChordInFourParts({
      root: "C",
      quality: "major",
      bass: "E",
      profile: VOICE_LEADING_PROFILES.classical!,
      context: CONTEXT,
    })!;
    expect(assignment.bass % 12).toBe(4);
  });

  it("is deterministic", () => {
    const make = () => voiceChordInFourParts({
      root: "F",
      quality: "major7",
      previous: C_MAJOR,
      profile: VOICE_LEADING_PROFILES.jazz!,
      context: { ...CONTEXT, root: "F", quality: "major7" },
    });
    expect(make()).toEqual(make());
  });
});

describe("re-voicing a whole progression", () => {
  it("gives every chord four notes and keeps them ordered", () => {
    const composition = generateComposition(
      settings({ bars: 8, seed: "vl", voiceLeading: { enabled: true } }),
    );
    for (const chord of composition.chords) {
      expect(chord.notes).toHaveLength(4);
      const sorted = [...chord.notes].sort((a, b) => a - b);
      expect(chord.notes).toEqual(sorted);
    }
  });

  it("avoids parallels under a strict profile and allows them under a loose one", () => {
    const countParallels = (style: StylePresetId) => {
      const composition = generateComposition(
        settings({ bars: 8, style, seed: "vl", voiceLeading: { enabled: true } }),
      );
      let count = 0;
      for (let index = 1; index < composition.chords.length; index += 1) {
        const [a, b] = [composition.chords[index - 1]!, composition.chords[index]!];
        if (a.notes.length < 4 || b.notes.length < 4) continue;
        const toAssignment = (notes: number[]): VoiceAssignment => ({
          bass: notes[0]!, tenor: notes[1]!, alto: notes[2]!, soprano: notes[3]!,
        });
        count += findVoiceLeadingIssues(
          toAssignment(a.notes),
          toAssignment(b.notes),
          { ...CONTEXT, quality: b.quality, root: b.root },
        ).filter((i) => i.type === "parallelFifth" || i.type === "parallelOctave").length;
      }
      return count;
    };
    // game-music uses the classical profile, edm the electronic one.
    expect(countParallels("game-music")).toBe(0);
    expect(countParallels("edm")).toBeGreaterThan(0);
  });

  it("honours an explicit profile override", () => {
    const auto = generateComposition(
      settings({ bars: 8, style: "edm", seed: "vl", voiceLeading: { enabled: true } }),
    );
    const strict = generateComposition(
      settings({
        bars: 8, style: "edm", seed: "vl",
        voiceLeading: { enabled: true, profile: "classical" },
      }),
    );
    expect(strict.chords.map((c) => c.notes)).not.toEqual(auto.chords.map((c) => c.notes));
  });

  it("keeps the original voicing for a chord it cannot express in four parts", () => {
    // A wide tension stack has more than four pitch classes.
    const chords = [{
      root: "C", quality: "major7" as const, notes: [48, 55, 59, 62, 64], inversion: 0,
    }];
    const [revoiced] = revoiceInFourParts(chords, {
      key: "C", mode: "major", style: "jazz",
    });
    expect(revoiced!.notes.length).toBeGreaterThan(0);
  });

  it("stays valid and composes with the other features", () => {
    const composition = generateComposition(
      settings({
        bars: 8,
        seed: "all",
        voiceLeading: { enabled: true },
        functionalHarmony: { enabled: true },
        harmonicRhythm: { cadentialAcceleration: true },
        phraseGrammar: { enabled: true },
      }),
    );
    expect(validateComposition(composition).errors).toEqual([]);
  });

  it("is deterministic and leaves output untouched when disabled", () => {
    const make = () =>
      generateComposition(settings({ bars: 8, seed: "fixed", voiceLeading: { enabled: true } }));
    expect(make()).toEqual(make());

    const plain = generateComposition(settings({ bars: 8, seed: "off" }));
    const disabled = generateComposition(
      settings({ bars: 8, seed: "off", voiceLeading: { enabled: false } }),
    );
    expect(disabled.chords).toEqual(plain.chords);
  });
});
