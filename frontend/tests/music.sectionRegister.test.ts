import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition, validateComposition } from "../src/music";
import { buildCompositionTracks } from "../src/music/compositionTracks";
import { lowIntervalViolation, melodyConflict } from "../src/music/voicingRegister";
import {
  REGISTER_ANCHOR,
  SECTION_REGISTER,
  registerTargetFor,
  scoreVoicingCandidate,
  voicingProfileFor,
} from "../src/music/voicingSelection";
import type { GeneratorSettings, SectionKind } from "../src/types/music";

/**
 * The accompaniment moving register with the section it is in.
 *
 * The same claim `dynamics` already makes about loudness. Measured before this
 * existed, across every style and every section of every piece, the lowest note
 * of the accompaniment had a median of MIDI 43 -- one register for all of it --
 * and the chorus sat 2.4 semitones BELOW the verse that set it up.
 *
 * This is arranging practice rather than a rule of harmony, so it is written as
 * a pull that the melody and the low interval limits outrank, and the tests
 * below are as much about what it must not do as about what it does.
 */

const SEEDS = ["a", "b", "c", "d", "e", "f", "g", "h"];
const STYLES = ["pop", "j-pop", "jazz", "ballad", "rock", "lo-fi", "edm", "game-music"] as const;

function piece(patch: Partial<GeneratorSettings>) {
  return generateComposition({
    ...DEFAULT_GENERATOR_SETTINGS, bars: 32, ...patch,
  } as GeneratorSettings);
}

/** Mean midpoint of the accompaniment, per section kind. */
function centresByKind(sectionRegister: boolean, style = "pop"): Map<SectionKind, number> {
  const collected = new Map<SectionKind, number[]>();
  for (const seed of SEEDS) {
    const composed = piece({
      seed, style: style as GeneratorSettings["style"],
      melodyVoicing: { enabled: true, sectionRegister },
    });
    const barTicks = composed.ppq * 4;
    for (const chord of composed.chords) {
      const bar = Math.floor(chord.startTick / barTicks);
      const section = composed.sections?.find((entry) => bar >= entry.startBar && bar < entry.endBar);
      if (!section) continue;
      const list = collected.get(section.kind) ?? [];
      list.push((Math.min(...chord.notes) + Math.max(...chord.notes)) / 2);
      collected.set(section.kind, list);
    }
  }
  return new Map([...collected].map(([kind, values]) => [
    kind, values.reduce((sum, value) => sum + value, 0) / values.length,
  ]));
}

/** Chords whose voicing reaches the melody, and chords below a low interval limit. */
function audit(sectionRegister: boolean, style: string, seeds: readonly string[] = SEEDS) {
  let covered = 0;
  let chords = 0;
  let violations = 0;
  for (const seed of seeds) {
    const composed = piece({
      seed, style: style as GeneratorSettings["style"],
      melodyVoicing: { enabled: true, sectionRegister },
    });
    const melody = buildCompositionTracks(composed).find((track) => track.midiChannel === 2)!.notes;
    for (const chord of composed.chords) {
      chords += 1;
      const end = chord.startTick + chord.durationTick;
      const over = melody
        .filter((note) => note.startTick < end && note.startTick + note.durationTick > chord.startTick)
        .map((note) => note.midi);
      if (melodyConflict(chord.notes, over).covering > 0) covered += 1;
      if (lowIntervalViolation(chord.notes) > 0) violations += 1;
    }
  }
  return { coveredShare: covered / chords, violations };
}

describe("the register a section asks for", () => {
  it("puts the chorus above the verse that set it up", () => {
    // The whole point. Measured: the gap goes from -2.37 semitones to +1.16,
    // a swing of three and a half.
    const off = centresByKind(false);
    const on = centresByKind(true);
    const gapOff = off.get("chorus")! - off.get("verse")!;
    const gapOn = on.get("chorus")! - on.get("verse")!;
    expect(gapOff).toBeLessThan(0);
    expect(gapOn).toBeGreaterThan(0);
    expect(gapOn - gapOff).toBeGreaterThan(2);
  });

  it("raises the chorus rather than merely lowering the verse", () => {
    // Dropping the verse would produce the same gap and a quieter piece. The
    // arrival has to be an arrival.
    const off = centresByKind(false);
    const on = centresByKind(true);
    expect(on.get("chorus")!).toBeGreaterThan(off.get("chorus")!);
  });

  it("keeps the bridge below the verse, because a bridge contrasts", () => {
    // A bridge that arrived higher than the chorus would spend the arrival it
    // exists to set up, which is why its offset is negative like the intro's.
    expect(SECTION_REGISTER.bridge).toBeLessThan(SECTION_REGISTER.verse!);
    expect(SECTION_REGISTER.chorus).toBeGreaterThan(SECTION_REGISTER.preChorus!);
    expect(SECTION_REGISTER.preChorus).toBeGreaterThan(SECTION_REGISTER.verse!);
  });

  it("never lets a section's wish break a low interval limit", () => {
    // The register is arranging practice; the limits are acoustics. Measured
    // across all eight styles at eight seeds: zero violations either way. Two
    // seeds here, because a claim of zero needs breadth across styles rather
    // than depth within one, and eight of each times thirty-two bars runs past
    // the default timeout under parallel load.
    for (const style of STYLES) {
      expect(audit(true, style, ["a", "b"]).violations, style).toBe(0);
    }
  });

  it("costs some melody cover, and states how much", () => {
    // Not free, and not hidden. Raising the accompaniment moves it toward the
    // melody because the melody is above it -- arithmetic rather than a tuning
    // failure, and a sweep of the offsets found no setting that bought the arc
    // for nothing. Measured in pop: 10.2% of chords reach the melody before,
    // 13.3% after. The bound here is what the trade may not exceed.
    const before = audit(false, "pop");
    const after = audit(true, "pop");
    expect(after.coveredShare).toBeGreaterThan(before.coveredShare);
    expect(after.coveredShare).toBeLessThan(0.2);
  });

  it("asks for a register the voicer can actually reach", () => {
    // Middle C looks like the obvious anchor and is the wrong one: this app's
    // accompaniment sits at 52 once the melody, the bass and the limits have
    // had their say. A target of 60 is a constant added to every candidate,
    // which decides nothing -- measured, it moved the chorus-verse gap from
    // -2.4 to -1.4 and left every whole-piece figure identical.
    expect(REGISTER_ANCHOR).toBeLessThan(60);
    const centres = centresByKind(true);
    for (const [kind, centre] of centres) {
      expect(Math.abs(centre - registerTargetFor(kind)!), kind).toBeLessThan(8);
    }
  });

  it("does nothing at all when no section asks", () => {
    // Every caller before sections had an opinion passed no target, and those
    // callers must be unaffected.
    const profile = voicingProfileFor("pop");
    // Midpoint 60, so a target of 60 would cost nothing for the uninteresting
    // reason that it is already there.
    const notes = [48, 55, 64, 67, 72];
    const without = scoreVoicingCandidate(notes, "close", { style: "pop" }, profile, new Set());
    expect(without.register).toBe(0);
    const away = scoreVoicingCandidate(
      notes, "close", { style: "pop", registerTarget: 52 }, profile, new Set(),
    );
    expect(away.register).toBeGreaterThan(0);
    // And it charges by distance, not by presence.
    const further = scoreVoicingCandidate(
      notes, "close", { style: "pop", registerTarget: 44 }, profile, new Set(),
    );
    expect(further.register).toBeGreaterThan(away.register);
  });

  it("leaves the piece byte-identical when it is not asked for", () => {
    const bare = piece({ seed: "id", melodyVoicing: { enabled: true } });
    const off = piece({ seed: "id", melodyVoicing: { enabled: true, sectionRegister: false } });
    expect(JSON.stringify(off.chords)).toBe(JSON.stringify(bare.chords));
    expect(off.id).toBe(bare.id);
  });

  it("changes the composition id only when it is asked for", () => {
    const bare = piece({ seed: "id", melodyVoicing: { enabled: true } });
    const on = piece({ seed: "id", melodyVoicing: { enabled: true, sectionRegister: true } });
    expect(on.id).not.toBe(bare.id);
  });

  it("keeps every piece valid", () => {
    for (const style of STYLES) {
      for (const seed of ["a", "b"]) {
        const composed = piece({
          seed, style: style as GeneratorSettings["style"],
          melodyVoicing: { enabled: true, sectionRegister: true },
        });
        expect(validateComposition(composed).errors, `${style}/${seed}`).toEqual([]);
      }
    }
  });

  it("is deterministic", () => {
    const make = () => JSON.stringify(piece({
      seed: "det", melodyVoicing: { enabled: true, sectionRegister: true },
    }).chords);
    expect(make()).toBe(make());
  });
});
