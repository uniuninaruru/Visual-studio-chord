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
export type BarCount = 4 | 8 | 16 | 24 | 32 | 48;

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

export interface NeoRiemannianTransformation {
  theory: "neoRiemannian";
  operation: "P" | "L" | "R";
  fromRoot: CanonicalPitchClass;
  fromQuality: "major" | "minor";
}

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
  /**
   * 落ちサビ: the chorus stripped back, and 大サビ: the chorus at full height.
   *
   * Both sing the sabi -- same progression, same material -- so they are not
   * new music but new settings of it. What separates them from `chorus`, and
   * from each other, is register, dynamics and energy, which is exactly what
   * the per-kind tables carry.
   */
  | "quietChorus"
  | "finalChorus"
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

/**
 * Where the bass/left-hand track sounds.
 *
 * Chords are voiced in close position, so their lowest note lands around
 * MIDI 50-53 (D3-F3) — measured across every style preset. That is a tenor, not
 * a bass: there is no energy below roughly 147 Hz anywhere in the piece, while a
 * pop bass line lives around MIDI 28-48. Worse, the lowest note of an inverted
 * chord is often the fifth or the third, so the "bass" is whichever tone the
 * voicer happened to put at the bottom.
 *
 * Enabling this drops that note by whole octaves until it reaches a real bass
 * register. Octaves are used rather than a fixed pitch so the inversion the
 * voicing expresses is preserved: only the register changes, never which note
 * is in the bass.
 *
 * Absent leaves the lowest sounding pitch exactly where the voicer put it.
 */
/**
 * Approach chords at section boundaries.
 *
 * Measured before this existed, on a thirty-two bar verse-chorus piece: every
 * boundary was a butt joint -- V followed straight by IVmaj7, verse landing on
 * I from vi with nothing in between. Absent leaves the seams exactly as plain
 * as they were.
 */
export interface SongFormVarietySettings {
  /**
   * Lets a section whose own tier holds a single template draw from the next
   * tier too.
   *
   * Measured: exactly one progression in the catalogue is marked for a bridge,
   * so every major-key bridge in every piece was the same four chords -- forty
   * out of forty. Absent keeps that single answer, since widening the pool
   * changes which template every existing piece picks.
   */
  variedThinSections: boolean;
}

export interface SectionTransitionSettings {
  enabled: boolean;
}

/**
 * Lets the voicer see the melody, and choose a shape rather than be told one.
 *
 * The app writes the chords first and the melody second, so at the moment the
 * voicer runs there is no melody to voice against. Measured before this
 * existed, in the jazz style: forty-five of eighty chord spans had the melody
 * at or below the chord's top note, and every voicing in every style spanned
 * 8.0 semitones on average with a third at the bottom.
 *
 * Absent leaves the blind first-pass voicing exactly as it was.
 */
export interface MelodyAwareVoicingSettings {
  enabled: boolean;
  /**
   * Whether the accompaniment moves register with the section it is in.
   *
   * A chorus is played higher than the verse that set it up, and that is most
   * of what "arrival" is at the keyboard -- the same claim `dynamics` already
   * makes about loudness, applied to where the hands sit. Measured without it:
   * across every style and every section of every piece, the lowest note of the
   * accompaniment had a median of MIDI 43. One number, for all of it.
   *
   * Absent leaves the register wherever the voicing cost puts it.
   */
  sectionRegister?: boolean;
}

/**
 * Breaks the chord track into a running figure instead of a block.
 *
 * Every chord sounded all of its notes at once for the chord's full length,
 * which is the one texture a keyboard player almost never uses for a whole
 * piece. Absent leaves the block chords exactly as they were.
 */
/**
 * How the right hand plays the chord, rhythmically.
 *
 * Before this, the chord track had two possible rhythms in the whole app: one
 * block chord held for the chord's length, or an arpeggio at a fixed rate.
 * Measured across eight styles at sixteen bars, every chord in every style was
 * struck once on its own downbeat and held -- 240 chords, 240 onsets, one
 * rhythm. A keyboard player uses neither for a whole piece.
 *
 * Absent leaves the block chords exactly as they were.
 */
export interface ChordRhythmSettings {
  enabled: boolean;
  /**
   * A named figure from the catalogue. Absent lets the style choose, which is
   * the point -- naming the pattern is the same mistake as naming the voicing.
   */
  pattern?: string;
  /**
   * Whether the strikes accumulate under a pedal rather than observing their
   * own rests. Off by default, because a comping figure's rests are the figure.
   */
  sustain?: boolean;
}

export interface ArpeggioSettings {
  enabled: boolean;
  /**
   * Steps per beat. 2 is eighth notes, the default; 4 is sixteenths. A step
   * shorter than one tick is refused rather than rounded to nothing.
   */
  rate?: number;
  /** Defaults to "up". */
  pattern?: "up" | "down" | "upDown";
  /**
   * 0..1. How much of its step each note holds. Defaults to 0.9, which leaves
   * a little separation; 1 is fully legato.
   */
  gate?: number;
  /**
   * Whether each note holds on until the chord ends, as under a pedal.
   *
   * Without this an arpeggio is a single line: measured across eight seeds of
   * the shipped defaults, the chord track had 1024 onsets and not one of them
   * sounded with another. Every voicing the engine chose -- the drop, the
   * spread, the two-handed shapes, the spacing, the low interval limits --
   * describes how a chord sounds when its notes sound together, and none of
   * them ever did. The arpeggio was deciding the texture and then discarding
   * the harmony it was an arpeggio of.
   *
   * Held notes accumulate instead, so the figure is heard as motion across a
   * chord rather than as a bare line. Defaults to off, so a composition that
   * already sounds a certain way keeps sounding that way.
   */
  sustain?: boolean;
}

/**
 * Colour tones on the ordinary generation path.
 *
 * Measured across all eight styles at sixteen bars, every chord the default
 * path produced was a plain triad, and harmony.complexity "advanced" never
 * exceeded four notes. Absent leaves that vocabulary exactly as it was.
 */
export interface TensionSettings {
  enabled: boolean;
  /** 0..1. Share of eligible chords that take a colour tone. Defaults to 0.5. */
  rate?: number;
  /** Highest colour tone to reach for. Defaults to "13". */
  ceiling?: "9" | "11" | "13";
}

/**
 * How hard the chord and bass tracks are struck.
 *
 * Their velocity is otherwise a single literal, identical on every note of
 * every bar, which is the flat mechanical delivery a real player never
 * produces. Absent leaves that literal exactly as it was.
 */
export interface DynamicsSettings {
  enabled: boolean;
  /**
   * 0..1. How far the weakest position falls below the strongest. Defaults to
   * 0.35, which spreads the chord track over roughly 56-78.
   */
  depth?: number;
}

export interface BassRegisterSettings {
  enabled: boolean;
  /**
   * Give the left hand a shell rather than a single note.
   *
   * Off, the left hand is the voicing's lowest pitch and nothing else, which is
   * what a split-by-lowest can produce and what this app did: measured across
   * eight styles, zero polyphonic left-hand onsets out of 102 each. On, a
   * partner is added above it -- a fifth, seventh, octave or tenth, whichever
   * is the widest the register allows -- from the chord's own tones.
   */
  shell?: boolean;
  /**
   * Highest MIDI note the bass may sound. Defaults to 48 (C3), the top of a
   * comfortable electric-bass register.
   */
  ceiling?: number;
  /** Lowest MIDI note to drop to. Defaults to 28 (E1), a five-string bass low E. */
  floor?: number;
}

/**
 * Four-part voice leading. Off keeps the note-set voicer.
 */
export interface VoiceLeadingSettings {
  enabled: boolean;
  /** Overrides the profile the style would otherwise pick. */
  profile?: "classical" | "jazz" | "pop" | "electronic";
  /**
   * Chooses every voicing at once instead of one chord at a time.
   *
   * The chord-at-a-time writer takes the cheapest move from the previous chord
   * and never revisits it, so a voicing that is locally best can leave the next
   * chord with only bad options. Searching the whole sequence trades a slightly
   * worse single transition for a cheaper progression.
   *
   * Absent keeps the sequential writer, and therefore the existing output.
   */
  optimizeSequence?: boolean;
}

/**
 * Functional-harmony planning. Off keeps the template-driven progressions.
 */
export interface FunctionalHarmonySettings {
  enabled: boolean;
  /** 0..1. Higher wanders through more colourful functions. */
  exploration?: number;
}

/** Phrase grammar. Off keeps the original fixed-length phrasing. */
export interface PhraseGrammarSettings {
  enabled: boolean;
}

/**
 * Melodic skeleton. Off keeps the purely note-by-note melody.
 *
 * Has no effect without a phrase plan: the structural points are defined
 * relative to a phrase's shape, so there is nothing to plan them against.
 */
export interface MelodicSkeletonSettings {
  enabled: boolean;
}

/**
 * Which non-chord-tone figures a melody may be decorated with.
 *
 * Mirrors NonChordToneType in music/nonChordTones.ts, declared here for the
 * same reason as MelodyScaleName: the settings types do not import the engine.
 */
export type NonChordToneName =
  | "passingTone"
  | "neighborTone"
  | "appoggiatura"
  | "anticipation"
  | "suspension"
  | "retardation"
  | "escapeTone"
  | "enclosure";

/**
 * Non-chord-tone figures. Off leaves the melody exactly as generated.
 *
 * `rate` is how often an eligible site is ornamented, and `types` restricts
 * which figures are used — a pop line usually wants passing and neighbour tones
 * without the suspensions a chorale would take for granted.
 */
export interface NonChordToneSettings {
  enabled: boolean;
  /** 0..1. Defaults to 0.5. */
  rate?: number;
  types?: readonly NonChordToneName[];
}

/**
 * Pivot-chord modulation. Off leaves every key change direct, as it was.
 *
 * Only does anything when the piece actually changes key — a song form with a
 * final lift, or sections in different keys.
 */
export interface PivotModulationSettings {
  enabled: boolean;
}

/**
 * Euclidean rhythm. Off keeps the slot-partition rhythm generator.
 *
 * Spreads `onsets` hits as evenly as possible across `steps` grid positions;
 * `rotation` changes which onset lands on the downbeat.
 */
export interface EuclideanRhythmSettings {
  enabled: boolean;
  onsets: number;
  steps: number;
  rotation?: number;
}

/**
 * Groove template. Off leaves every note exactly on the grid.
 *
 * Mirrors GrooveTemplateId in music/groove.ts, declared here for the same
 * reason as MelodyScaleName: the settings types do not import the engine.
 */
export type GrooveTemplateName =
  | "straight"
  | "swing8"
  | "swing16"
  | "shuffle"
  | "bossa"
  | "laidBack"
  | "pushed"
  | "backbeat";

export interface GrooveSettings {
  enabled: boolean;
  template: GrooveTemplateName;
  /** 0..1. How much of the template to apply. Defaults to 1. */
  amount?: number;
}

/**
 * Additional musical lines. The original `notes` array remains the editable
 * lead melody so older projects and editor actions stay compatible.
 */
export interface ArrangementSettings {
  /** A rule-aware line above or below the lead melody. */
  counterpoint?: {
    enabled: boolean;
    position?: "above" | "below";
    /** 0..1. Higher values prefer contrary and oblique motion. */
    independence?: number;
  };
  /** A delayed imitation of the lead melody. */
  canon?: {
    enabled: boolean;
    delayBeats: number;
    interval?: number;
    inverted?: boolean;
  };
  /** A pitched pulse layer divided independently from the meter. */
  polyrhythm?: {
    enabled: boolean;
    pulses: number;
    spanBars?: number;
  };
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
  dynamics?: DynamicsSettings;
  tensions?: TensionSettings;
  arpeggio?: ArpeggioSettings;
  chordRhythm?: ChordRhythmSettings;
  melodyVoicing?: MelodyAwareVoicingSettings;
  sectionTransitions?: SectionTransitionSettings;
  songFormVariety?: SongFormVarietySettings;
  /**
   * Phrase grammar. Omitted means the fixed four-bar phrasing every
   * composition used before it existed.
   */
  phraseGrammar?: PhraseGrammarSettings;
  /**
   * Plans the progression as a path through harmonic functions instead of
   * expanding a degree template. Omitted keeps the template behaviour.
   */
  functionalHarmony?: FunctionalHarmonySettings;
  /**
   * Voices chords as four independent parts, applying part-writing rules
   * weighted by style. Omitted keeps the original note-set voicer.
   */
  voiceLeading?: VoiceLeadingSettings;
  bassRegister?: BassRegisterSettings;
  /**
   * Plans each phrase's structural notes — start, climax, cadence — before the
   * line is written. Requires a phrase plan; omitted keeps the purely
   * note-by-note melody every composition had before it existed.
   */
  melodicSkeleton?: MelodicSkeletonSettings;
  /**
   * Non-chord-tone figures written over the finished line. Omitted leaves the
   * melody exactly as every composition had it before they existed.
   */
  nonChordTones?: NonChordToneSettings;
  /**
   * Prepares each key change with a chord diatonic to both keys. Omitted keeps
   * the direct key changes every composition had before it existed.
   */
  pivotModulation?: PivotModulationSettings;
  /**
   * Places the melody's onsets on a Euclidean pattern. Omitted keeps the
   * slot-partition rhythm every composition had before it existed.
   */
  euclideanRhythm?: EuclideanRhythmSettings;
  /**
   * Plays the melody with a groove instead of exactly on the grid. Omitted
   * keeps the metronomic placement every composition had before it existed.
   */
  groove?: GrooveSettings;
  /**
   * Optional multi-voice arrangement. Omitted keeps the legacy one-melody
   * output and therefore preserves old seeds byte-for-byte.
   */
  arrangement?: ArrangementSettings;
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

export type CompositionVoiceRole = "countermelody" | "canon" | "pulse";
export type CompositionVoiceInstrument = "softLead" | "pluck" | "bass";

/**
 * One additional voice layered over the editable lead melody.
 *
 * Voice notes use the same integer-tick contract as the lead. Muting is saved
 * with the project, while MIDI export intentionally keeps every voice as its
 * own track so no musical data is lost.
 */
export interface CompositionVoice {
  id: string;
  name: string;
  role: CompositionVoiceRole;
  instrument: CompositionVoiceInstrument;
  /**
   * The track's colour, as a CSS custom property reference rather than a hex
   * literal.
   *
   * It is applied as an inline style, so no stylesheet rule can reach it and a
   * literal here would have been the one colour in the app that cannot follow
   * the theme. Four of the six literals this replaced were also already under
   * 3:1 against white, so this was a light-mode defect before it was a
   * dark-mode one.
   */
  color: string;
  /**
   * The same colour as a fill behind a note.
   *
   * Its own token rather than the colour with an alpha suffix appended:
   * `${color}99` only works on a hex literal, and the same 60% over a dark
   * canvas is not the same colour as over a white one. Tuned per theme rather
   * than derived.
   *
   * Optional because a project saved before it existed has voices carrying only
   * a colour, and a stored piece must keep opening.
   */
  fill?: string;
  midiChannel: number;
  muted?: boolean;
  notes: NoteEvent[];
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
  /**
   * Which of `notes` the left hand plays.
   *
   * Absent means the old rule: lowest note left, the rest right. Present, it is
   * the voicer's own decision rather than a split applied afterwards, and the
   * tracks, the MIDI export and the piano roll read it instead of each
   * re-deriving one.
   *
   * Pitches rather than a count, because there is no count that says it: a left
   * hand reaching a tenth sits above some of the right hand's notes, so the two
   * hands are not separable by a line drawn through the sorted voicing.
   */
  leftHand?: number[];
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
  /** Auditable derivation for a contextual Neo-Riemannian transformation. */
  transformation?: NeoRiemannianTransformation;
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
  /** Additional lines. Absent in legacy and single-voice projects. */
  voices?: CompositionVoice[];
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
