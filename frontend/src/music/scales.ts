import type {
  CanonicalPitchClass,
  Mode,
  PitchClassName,
} from "../types/music";

export const PITCH_CLASSES: readonly CanonicalPitchClass[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

const PITCH_CLASS_ALIASES: Readonly<Record<PitchClassName, CanonicalPitchClass>> = {
  C: "C",
  "C#": "C#",
  D: "D",
  "D#": "D#",
  E: "E",
  F: "F",
  "F#": "F#",
  G: "G",
  "G#": "G#",
  A: "A",
  "A#": "A#",
  B: "B",
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
  "B#": "C",
  Cb: "B",
  "E#": "F",
  Fb: "E",
};

export const SCALE_INTERVALS: Readonly<Record<Mode, readonly number[]>> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
};

export function normalizePitchClass(name: PitchClassName): CanonicalPitchClass {
  const normalized = PITCH_CLASS_ALIASES[name];
  if (!normalized) throw new RangeError(`Unsupported pitch class: ${String(name)}`);
  return normalized;
}

export function pitchClassToSemitone(name: PitchClassName): number {
  return PITCH_CLASSES.indexOf(normalizePitchClass(name));
}

export function semitoneToPitchClass(semitone: number): CanonicalPitchClass {
  if (!Number.isFinite(semitone)) throw new RangeError("Semitone must be finite.");
  const normalized = ((Math.round(semitone) % 12) + 12) % 12;
  return PITCH_CLASSES[normalized] as CanonicalPitchClass;
}

export function getScaleSemitones(key: PitchClassName, mode: Mode): number[] {
  const root = pitchClassToSemitone(key);
  return SCALE_INTERVALS[mode].map((interval) => (root + interval) % 12);
}

export function getScalePitchClasses(
  key: PitchClassName,
  mode: Mode,
): CanonicalPitchClass[] {
  return getScaleSemitones(key, mode).map(semitoneToPitchClass);
}

export function getScaleMidiNotes(
  key: PitchClassName,
  mode: Mode,
  minMidi: number,
  maxMidi: number,
): number[] {
  const scale = new Set(getScaleSemitones(key, mode));
  const min = Math.ceil(minMidi);
  const max = Math.floor(maxMidi);
  const notes: number[] = [];
  for (let midi = min; midi <= max; midi += 1) {
    if (midi >= 0 && midi <= 127 && scale.has(midi % 12)) notes.push(midi);
  }
  return notes;
}

export function midiToNoteName(midi: number): string {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
    throw new RangeError("MIDI note must be an integer from 0 to 127.");
  }
  const octave = Math.floor(midi / 12) - 1;
  return `${semitoneToPitchClass(midi)}${octave}`;
}

export function transposePitchClass(
  pitchClass: PitchClassName,
  semitones: number,
): CanonicalPitchClass {
  return semitoneToPitchClass(pitchClassToSemitone(pitchClass) + semitones);
}

export function scaleDegreeForPitchClass(
  pitchClass: PitchClassName,
  key: PitchClassName,
  mode: Mode,
): number | null {
  const semitone = pitchClassToSemitone(pitchClass);
  const index = getScaleSemitones(key, mode).indexOf(semitone);
  return index < 0 ? null : index + 1;
}
