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

export type Mode =
  | "major"
  | "naturalMinor"
  | "harmonicMinor"
  | "dorian"
  | "mixolydian";
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
  | "minor7"
  | "halfDiminished7"
  | "diminished7"
  | "minorMajor7"
  | "augmentedMajor7"
  | "sus2"
  | "sus4"
  | "add9"
  | "minorAdd9";

export type ChordSource =
  | "diatonic"
  | "secondaryDominant"
  | "borrowed"
  | "substitute"
  | "other";

export type ChordSpecialKind =
  | "secondaryDominant"
  | "borrowed"
  | "tritoneSubstitution"
  | "suspended"
  | "addedTone"
  | "passingDiminished"
  | "chromatic";

/**
 * Colour tones stacked above a base triad/seventh. Kept separate from
 * ChordQuality so a chord can carry a seventh *and* a ninth at once, which the
 * closed ChordQuality enum cannot express (e.g. maj9 = major7 + 9).
 */
export type Tension =
  | "6"
  | "9"
  | "b9"
  | "#9"
  | "11"
  | "#11"
  | "13"
  | "b13";

/** Chromatic displacement of a scale degree, e.g. bII, #IV. */
export type DegreeAlteration = -1 | 1;

/**
 * One chord slot of a named progression. Only `degree` is required; everything
 * else overrides the diatonic default, which is what lets a template pin a
 * specific quality (the III7 of the Marunouchi progression) or a bass note that
 * is not a chord tone (the bII of a Blackadder chord).
 */
export interface ProgressionStep {
  degree: number;
  alteration?: DegreeAlteration;
  quality?: ChordQuality;
  tensions?: readonly Tension[];
  /** Slash-chord bass. May be a non-chord tone. */
  bassDegree?: number;
  bassAlteration?: DegreeAlteration;
  role?: ChordSpecialKind;
  /** Scale degree a secondary dominant or tritone substitute resolves to. */
  targetDegree?: number;
}

/** Where a progression is idiomatically used inside a song. */
export type ProgressionUsage =
  | "verse"
  | "preChorus"
  | "chorus"
  | "bridge"
  | "any";

export interface ProgressionTemplate {
  /** Stable identifier; selection hashes this, never the array index. */
  id: string;
  label: string;
  /** Japanese practitioner shorthand, e.g. "4536". */
  numeric?: string;
  steps: readonly ProgressionStep[];
  usage?: ProgressionUsage;
  modes: readonly Mode[];
}

/** Sections of the Japanese song template: A-melo, B-melo/pre-sabi, sabi… */
export type SectionKind =
  | "intro"
  | "verse"
  | "preChorus"
  | "chorus"
  | "bridge"
  | "outro";

export type SongFormId =
  | "none"
  | "verseChorus"
  | "aaba"
  | "throughComposed";

/**
 * Which scale a melody draws on, independent of the harmony underneath it.
 *
 * Mirrors MelodyScale in music/scales.ts; declared here so the settings and
 * composition types do not have to import from the engine.
 */
export type MelodyScaleName = "diatonic" | "yonaNuki" | "niroNuki";

/**
 * One span of the song with its own key, mode and progression.
 *
 * Sections describe spans of the flat chord/note arrays rather than containing
 * them, so playback, MIDI export and the piano roll keep seeing one continuous
 * piece. A section whose `transpose` is non-zero is a modulation.
 */
export interface SectionEvent {
  id: string;
  kind: SectionKind;
  startBar: number;
  /** Exclusive. */
  endBar: number;
  key: CanonicalPitchClass;
  mode: Mode;
  /** Semitones above the composition key. Non-zero means this section modulates. */
  transpose: number;
  /** Set when the melody runs in a different mode than the harmony (polytonality). */
  melodyMode?: Mode;
  /** Set when the melody is restricted to a pentatonic. */
  melodyScale?: MelodyScaleName;
  /** Named progression this section was built from. */
  progressionId?: string;
}

/**
 * How often the chord changes. Absent means one chord per bar.
 */
export interface HarmonicRhythmSettings {
  /** Chords per bar. */
  changesPerBar?: number;
  /** Bars each chord is held for. */
  barsPerChord?: number;
  /** Doubles the rate over the final two bars, tightening into the cadence. */
  cadentialAcceleration?: boolean;
}

export interface SongFormSettings {
  form: SongFormId;
  /**
   * Semitones the final section lifts by — the "truck driver" key change.
   * 0 disables it.
   */
  finalLift?: number;
  /** Runs the melody in the parallel mode of each section's harmony. */
  polytonal?: boolean;
  /** Restricts melodies to a pentatonic. */
  melodyScale?: MelodyScaleName;
}

export type HarmonyComplexity = "triads" | "sevenths" | "advanced";

export interface HarmonySettings {
  /** Triads only, diatonic sevenths, or style-aware chromatic harmony. */
  complexity: HarmonyComplexity;
  /** 0..1. Multiplier for style-specific borrowed-chord probability. */
  borrowedChordRate?: number;
  /** 0..1. Multiplier for style-specific secondary-dominant probability. */
  secondaryDominantRate?: number;
  /** 0..1. Overall multiplier for chromatic and color-chord exploration. */
  explorationRate?: number;
  /** 0..1. Preference for minimizing movement from the previous chord. */
  voiceLeadingStrength?: number;
}

export type MotifTransformation =
  | "repetition"
  | "transposition"
  | "rhythmicVariation"
  | "inversion"
  | "sequence"
  | "fragmentation"
  | "augmentation";

export interface MotifSettings {
  enabled: boolean;
  lengthBars: 1 | 2;
  /** 0..1. Probability that each later phrase uses a motif transformation. */
  transformationRate: number;
}

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
  /** Optional so Phase 1 JSON and callers remain compatible. */
  harmony?: HarmonySettings;
  /** Optional so Phase 1 JSON and callers remain compatible. */
  motif?: MotifSettings;
  /**
   * Explicit named progression (e.g. "royal-road"). When omitted the style
   * preset picks one deterministically from the seed.
   */
  progressionId?: string;
  /**
   * Song form. When omitted (or "none") the piece is generated as one
   * continuous span, exactly as before sections existed.
   */
  songForm?: SongFormSettings;
  /**
   * Chord change rate. Omitted means one chord per bar, which is how every
   * composition behaved before harmonic rhythm existed.
   */
  harmonicRhythm?: HarmonicRhythmSettings;
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
  /** Colour tones above the base quality (9th/11th/13th/6th and alterations). */
  tensions?: readonly Tension[];
  /**
   * Slash-chord bass. Present only when the sounding bass is not the chord
   * root; it may be a tone outside the chord (Vaug/bII, FM7/G).
   */
  bass?: CanonicalPitchClass;
  /** Phase 2 analysis metadata for non-diatonic or color chords. */
  specialKind?: ChordSpecialKind;
  /** Scale degree that a dominant/substitute resolves to. */
  targetDegree?: number;
  /** Parallel mode used to justify a borrowed chord. */
  borrowedFromMode?: Mode;
  /** Human-readable theory explanation generated with the chord. */
  explanation?: string;
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
  /**
   * Song sections, when a form was requested. Absent for one-span pieces.
   * Sections tile [0, settings.bars) exactly, in order, without gaps.
   */
  sections?: SectionEvent[];
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

export type RegenerationStrength = "subtle" | "moderate" | "strong";

export interface RegenerationOptions {
  target?: RegenerationTarget;
  /** Mixed into the seed. Defaults to 1, so regeneration makes a variation. */
  seedOffset?: number;
  /** Defaults to true. */
  respectLocks?: boolean;
  /** Controls how far the variation moves from the source. Defaults to moderate. */
  strength?: RegenerationStrength;
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
