import { describe, expect, it } from "vitest";
import { assignHands, intervalFitsRegister, MAX_HAND_SPAN } from "../src/music/hands";
import { LOW_INTERVAL_LIMITS, lowIntervalViolation } from "../src/music/voicingRegister";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition, validateComposition } from "../src/music";
import { buildCompositionTracks } from "../src/music/compositionTracks";
import type { GeneratorSettings } from "../src/types/music";

/**
 * The left hand as a structure rather than a leftover.
 *
 * The app split one voicing by pitch -- lowest note to the bass track, the rest
 * to the chords -- and a split by lowest note can only give the left hand one
 * pitch. Measured across eight styles and four seeds: 0 polyphonic left-hand
 * onsets out of 102 each, without a single exception, in a band eleven
 * semitones wide.
 */

const STYLES = ["pop", "j-pop", "jazz", "ballad", "rock", "lo-fi", "edm", "game-music"] as const;
const SEEDS = ["a", "b", "c", "d"];

function piece(patch: Partial<GeneratorSettings>) {
  return generateComposition({
    ...DEFAULT_GENERATOR_SETTINGS, bars: 16, ...patch,
  } as GeneratorSettings);
}

function everyChord(shell: boolean) {
  return STYLES.flatMap((style) => SEEDS.flatMap((seed) =>
    piece({ seed, style, bassRegister: { enabled: true, shell } }).chords));
}

describe("choosing what the left hand holds", () => {
  it("adds nothing when the shell is off", () => {
    // The whole feature behind one flag, so a piece made without it is the same
    // piece to the semitone.
    const off = piece({ seed: "same", bassRegister: { enabled: true } });
    const explicit = piece({ seed: "same", bassRegister: { enabled: true, shell: false } });
    // The music, not the whole document: the settings the composition echoes
    // back do differ, because one of them carries `shell: false` and the other
    // carries nothing.
    expect(JSON.stringify(explicit.chords)).toBe(JSON.stringify(off.chords));
    expect(JSON.stringify(explicit.notes)).toBe(JSON.stringify(off.notes));
    expect(off.chords.every((chord) => chord.leftHand === undefined)).toBe(true);
  }, 30_000);

  it("gives the left hand a second note where the register allows one", () => {
    // Measured: 432 of 825 chords across eight styles. Not all of them, because
    // a partner has to be a chord tone, has to clear the limits, and has to
    // stay under the top of the right hand.
    const withShell = everyChord(true);
    const paired = withShell.filter((chord) => (chord.leftHand?.length ?? 1) > 1);
    expect(paired.length / withShell.length).toBeGreaterThan(0.4);
  }, 120_000);

  it("reads the interval off the bass, so the lower it sits the wider it must be", () => {
    // The rule is not a style preference: LOW_INTERVAL_LIMITS says how low each
    // interval may be placed before its tones fuse, and the shell is chosen
    // against it. A bass at D2 (38) can carry a seventh, whose limit is D2, and
    // cannot carry a third, whose limit is A2.
    expect(intervalFitsRegister(38, 10), "seventh at D2").toBe(true);
    expect(intervalFitsRegister(38, 3), "minor third at D2").toBe(false);
    expect(intervalFitsRegister(45, 3), "minor third at A2").toBe(true);
    // Nothing above an octave is in the table, and that absence is the rule:
    // past an octave the limit stops binding, which is why a tenth is what a
    // left hand reaches for down there.
    expect(LOW_INTERVAL_LIMITS[15], "minor tenth").toBeUndefined();
    expect(intervalFitsRegister(28, 15), "minor tenth at E1").toBe(true);
  });

  it("never puts a shell under an interval the table forbids", () => {
    for (const chord of everyChord(true)) {
      const sorted = [...chord.notes].sort((left, right) => left - right);
      expect(lowIntervalViolation(sorted), `${chord.symbol} [${sorted.join(" ")}]`).toBe(0);
    }
  }, 120_000);

  it("never makes a semitone or a minor ninth against the right hand", () => {
    // The partner is added after the voicer has finished, so the voicer never
    // costed it: a shell can collide with a right-hand tension that was chosen
    // without knowing the shell would exist. Measured before this check, ten
    // minor ninths appeared in 825 chords.
    for (const chord of everyChord(true)) {
      const left = chord.leftHand ?? [];
      if (left.length < 2) continue;
      const right = chord.notes.filter((note) => !left.includes(note));
      for (const partner of left.slice(1)) {
        for (const note of right) {
          const gap = Math.abs(note - partner);
          expect(gap, `${chord.symbol}: ${partner} vs ${note}`).not.toBe(1);
          expect(gap, `${chord.symbol}: ${partner} vs ${note}`).not.toBe(13);
        }
      }
    }
  }, 120_000);

  it("sounds only tones the chord already has", () => {
    // The partner is drawn from the voicing's own pitch classes, so the chord
    // still spells what its symbol says and validation has nothing new to
    // forgive.
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const composed = piece({ seed, style, bassRegister: { enabled: true, shell: true } });
        expect(validateComposition(composed).errors.map((issue) => issue.code), `${style}/${seed}`)
          .toEqual([]);
      }
    }
  }, 120_000);

  it("keeps the left hand within one hand's reach", () => {
    for (const chord of everyChord(true)) {
      const left = chord.leftHand ?? [];
      if (left.length < 2) continue;
      expect(Math.max(...left) - Math.min(...left), chord.symbol)
        .toBeLessThanOrEqual(MAX_HAND_SPAN);
    }
  }, 120_000);

  it("lets the left hand pass through the right hand's register, but not over it", () => {
    // The corpus study this bound comes from lets the hands overlap without
    // restriction, and a left hand reaching a tenth does exactly that. What it
    // must not do is end up on top of the chord, which is a different texture.
    let overlapping = 0;
    for (const chord of everyChord(true)) {
      const left = chord.leftHand ?? [];
      if (left.length < 2) continue;
      const right = chord.notes.filter((note) => !left.includes(note));
      if (right.length === 0) continue;
      expect(Math.max(...left), chord.symbol).toBeLessThan(Math.max(...right));
      if (Math.max(...left) > Math.min(...right)) overlapping += 1;
    }
    expect(overlapping, "some shells reach into the right hand").toBeGreaterThan(0);
  }, 120_000);

  it("puts both notes in the bass track and neither in the chord track", () => {
    // The tracks read the decision instead of re-deriving it. Re-deriving was
    // the bug: the split point does not exist, because the partner sits above
    // some of the right hand.
    const composed = piece({ seed: "tracks", style: "jazz", bassRegister: { enabled: true, shell: true } });
    const tracks = buildCompositionTracks(composed);
    const bass = tracks.find((track) => track.role === "bass")!;
    const chords = tracks.find((track) => track.role === "chords")!;
    const shelled = composed.chords.find((chord) => (chord.leftHand?.length ?? 1) > 1)!;
    expect(shelled, "no shell in this piece to check").toBeDefined();
    for (const pitch of shelled.leftHand!) {
      expect(bass.notes.some((note) =>
        note.startTick === shelled.startTick && note.midi === pitch), `${pitch} in the bass`).toBe(true);
      expect(chords.notes.some((note) =>
        note.startTick === shelled.startTick && note.midi === pitch), `${pitch} not in the chords`).toBe(false);
    }
  }, 30_000);

  it("does not drop the shell an octave by applying the bass register twice", () => {
    // The register has already been applied where the hands were decided.
    // Applying it again in the track builder would move a partner below its own
    // limit and undo the interval that made it playable there.
    const composed = piece({ seed: "twice", style: "pop", bassRegister: { enabled: true, shell: true } });
    const bass = buildCompositionTracks(composed).find((track) => track.role === "bass")!;
    for (const chord of composed.chords) {
      const left = chord.leftHand ?? [];
      if (left.length < 2) continue;
      const sounded = bass.notes
        .filter((note) => note.startTick === chord.startTick)
        .map((note) => note.midi)
        .sort((a, b) => a - b);
      expect(sounded).toEqual([...left].sort((a, b) => a - b));
    }
  }, 30_000);

  it("widens the texture, which is the point", () => {
    // Measured: the whole voicing goes from 13.3 semitones to 16.3, and the
    // left hand from silent-above-its-lowest-note to sounding a second pitch on
    // half the chords.
    const mean = (values: readonly number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const span = (chords: ReturnType<typeof everyChord>) =>
      mean(chords.map((chord) => Math.max(...chord.notes) - Math.min(...chord.notes)));
    expect(span(everyChord(true))).toBeGreaterThan(span(everyChord(false)) + 2);
  }, 240_000);
});

describe("assignHands on its own", () => {
  it("returns the old split when the shell is off", () => {
    expect(assignHands([43, 48, 52, 55], { shell: false, bass: 31 }))
      .toEqual({ left: [31], right: [48, 52, 55] });
  });

  it("takes the tenth when the chord has one", () => {
    // C major over a C2 bass: 36 + 16 is E3, the major tenth, and E is in the
    // chord. Every adjacent interval in [36 52 55 64 67] clears its limit.
    expect(assignHands([36, 55, 64, 67], { shell: true, bass: 36 }).left)
      .toEqual([36, 52]);
  });

  it("takes the seventh when the tenth is not a chord tone", () => {
    // Dm7 over a D2 bass. The major tenth (54, F#) is not in the chord; the
    // minor tenth (53, F) is, but it is already sounding in the right hand, and
    // doubling it at the unison adds nothing. The seventh lands on C3.
    expect(assignHands([38, 53, 57, 60], { shell: true, bass: 38 }).left)
      .toEqual([38, 48]);
  });

  it("takes the fifth before the octave", () => {
    // C and G only: no third to make a tenth of, no seventh. The fifth is a
    // real left hand; the octave is the plainest of these and goes last.
    expect(assignHands([36, 55, 67], { shell: true, bass: 36 }).left)
      .toEqual([36, 43]);
  });

  it("refuses a partner that would put a narrow interval too low", () => {
    // 38 + 12 is D3, which would sit a major second under the C3 already
    // sounding, and a major second's limit is E3. The table forbids it, so this
    // chord gets no shell at all rather than a muddy one.
    expect(assignHands([38, 48, 55, 60], { shell: true, bass: 38 }).left)
      .toEqual([38]);
  });

  it("gives up rather than force a partner in", () => {
    // A two-note chord with nothing above the bass but the note itself.
    expect(assignHands([60], { shell: true, bass: 48 }).left).toEqual([48]);
  });
});
