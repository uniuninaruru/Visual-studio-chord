export const PPQ = 480 as const;

export type CanonicalPitchClass =
  | "C"
  | "C#"
  | "D"
  | "D#"
  | "E"
  | "F"
  | "F#"
  | "G"
  | "G#"
  | "A"
  | "A#"
  | "B";

/** Common single-accidental spellings accepted by the Phase 1 generator. */
export type PitchClassName =
  | CanonicalPitchClass
  | "Db"
  | "Eb"
  | "Gb"
  | "Ab"
  | "Bb"
  | "B#"
  | "Cb"
  | "E#"
  | "Fb";

export type Mode = "major" | "naturalMinor";
export type TimeSignature = "4/4" | "3/4" | "6/8";
export type BarCount = 4 | 8 | 16;

export type StylePresetId =
  | "pop"
  | "j-pop"
  | "rock"
  | "jazz"
  | "lo-fi"
  | "edm"
  | "ballad"
  | "game-music"
  | "random";

export type CadenceType =
  | "authentic"
  | "plagal"
  | "half"
  | "deceptive"
  | "loop";

export type HarmonyFunction =
  | "tonic"
  | "predominant"
  | "dominant"
  | "other";

export type ChordQuality =
  | "major"
  | "minor"
  | "diminished"
  | "augmented"
  | "dominant7"
  | "major7"
  | "minor7";

export type ChordSource =
  | "diatonic"
  | "secondaryDominant"
  | "borrowed"
  | "substitute"
  | "other";

export type NoteRole =
  | "chordTone"
  | "scaleTone"
  | "passing"
  | "neighbor"
  | "approach";

export interface MelodySettings {
  minMidi: number;
  maxMidi: number;
  /** 0..1. Controls rhythmic subdivision count. */
  density: number;
  /** 1..127. */
  velocity: number;
  /** 0..1. Base preference for chord tones. Strong beats add emphasis. */
  chordToneRate: number;
  /** 0..1. Probability that a generated rhythmic slot is silent. */
  restRate: number;
  /** 0..1. Preference for notes on weak subdivisions. */
  syncopation: number;
  /** 0..1. Probability weight for intervals larger than a third. */
  leapProbability: number;
}

export interface GeneratorSettings {
  key: PitchClassName;
  mode: Mode;
  bpm: number;
  timeSignature: TimeSignature;
  bars: BarCount;
  style: StylePresetId;
  seed: string | number;
  melody: MelodySettings;
}

export interface BarEvent {
  index: number;
  startTick: number;
  durationTick: number;
}

export interface NoteEvent {
  id: string;
  midi: number;
  noteName: string;
  startTick: number;
  durationTick: number;
  velocity: number;
  barIndex: number;
  role: NoteRole;
}

export interface ChordEvent {
  id: string;
  symbol: string;
  romanNumeral: string;
  function: HarmonyFunction;
  degree: number;
  quality: ChordQuality;
  root: CanonicalPitchClass;
  startTick: number;
  durationTick: number;
  notes: number[];
  inversion: number;
  source: ChordSource;
}

export interface GeneratedComposition {
  id: string;
  version: 1;
  seed: string;
  settings: GeneratorSettings;
  ppq: number;
  ticksPerBar: number;
  totalTicks: number;
  timeSignature: TimeSignature;
  resolvedStyle: Exclude<StylePresetId, "random">;
  cadence: CadenceType;
  bars: BarEvent[];
  chords: ChordEvent[];
  notes: NoteEvent[];
  /** Sorted, unique zero-based bar indices. */
  lockedBars: number[];
}

/** Zero-based, end-exclusive bar interval: [startBar, endBar). */
export interface BarRange {
  startBar: number;
  endBar: number;
}

export type RegenerationTarget =
  | "all"
  | "chords"
  | "melody"
  | "pitch"
  | "rhythm"
  | "voicing";

export interface RegenerationOptions {
  target?: RegenerationTarget;
  /** Mixed into the seed. Defaults to 1, so regeneration makes a variation. */
  seedOffset?: number;
  /** Defaults to true. */
  respectLocks?: boolean;
}

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  barIndex?: number;
  eventId?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

