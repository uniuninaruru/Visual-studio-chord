import { describe, expect, it } from "vitest";
import {
  getMelodyScaleMidiNotes,
  getMelodyScaleSemitones,
  getScaleSemitones,
  isMelodyScale,
  pitchClassToSemitone,
} from "../src/music";

/** Semitone offsets above the tonic, so a scale reads the same in any key. */
function degrees(key: string, semitones: readonly number[]): number[] {
  const tonic = pitchClassToSemitone(key as never);
  return semitones.map((s) => ((s - tonic) % 12 + 12) % 12).sort((a, b) => a - b);
}

describe("melody scales", () => {
  it("recognises only the supported scale names", () => {
    expect(isMelodyScale("diatonic")).toBe(true);
    expect(isMelodyScale("yonaNuki")).toBe(true);
    expect(isMelodyScale("niroNuki")).toBe(true);
    expect(isMelodyScale("pentatonic")).toBe(false);
    expect(isMelodyScale(undefined)).toBe(false);
  });

  it("leaves the diatonic scale untouched", () => {
    expect(getMelodyScaleSemitones("C", "major", "diatonic")).toEqual(
      getScaleSemitones("C", "major"),
    );
  });

  it("yona-nuki drops the 4th and 7th of a major scale", () => {
    // C D E G A — the major pentatonic.
    expect(degrees("C", getMelodyScaleSemitones("C", "major", "yonaNuki"))).toEqual([
      0, 2, 4, 7, 9,
    ]);
  });

  it("niro-nuki drops the 2nd and 6th of a minor scale", () => {
    // A C D E G — the minor pentatonic.
    expect(
      degrees("A", getMelodyScaleSemitones("A", "naturalMinor", "niroNuki")),
    ).toEqual([0, 3, 5, 7, 10]);
  });

  it("stays anchored to its parent mode rather than a fixed pitch set", () => {
    // Dorian has a natural 6th, so dropping degrees 2 and 6 keeps its b3 and b7
    // while still removing the tones niro-nuki removes.
    const dorian = getMelodyScaleSemitones("D", "dorian", "niroNuki");
    expect(dorian).toHaveLength(5);
    expect(degrees("D", dorian)).toEqual([0, 3, 5, 7, 10]);
  });

  it("yields five pitch classes per octave for either pentatonic", () => {
    for (const scale of ["yonaNuki", "niroNuki"] as const) {
      expect(new Set(getMelodyScaleSemitones("F#", "major", scale)).size).toBe(5);
    }
  });

  it("emits only scale pitches inside the requested MIDI range", () => {
    const notes = getMelodyScaleMidiNotes("C", "major", 60, 72, "yonaNuki");
    // C4 D4 E4 G4 A4 C5
    expect(notes).toEqual([60, 62, 64, 67, 69, 72]);
    expect(notes.every((n) => n >= 60 && n <= 72)).toBe(true);
  });

  it("matches the diatonic helper when no pentatonic is requested", () => {
    expect(getMelodyScaleMidiNotes("Eb", "naturalMinor", 55, 80)).toEqual(
      getMelodyScaleMidiNotes("Eb", "naturalMinor", 55, 80, "diatonic"),
    );
  });

  it("returns fewer notes than the parent scale over the same range", () => {
    const diatonic = getMelodyScaleMidiNotes("C", "major", 48, 84, "diatonic");
    const penta = getMelodyScaleMidiNotes("C", "major", 48, 84, "yonaNuki");
    expect(penta.length).toBeLessThan(diatonic.length);
    // and every pentatonic note is still a note of the parent scale
    expect(penta.every((n) => diatonic.includes(n))).toBe(true);
  });
});
