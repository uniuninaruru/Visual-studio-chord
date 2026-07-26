import type {
  CanonicalPitchClass,
  ChordEvent,
  ChordQuality,
  Mode,
  NoteEvent,
  PitchClassName,
  StylePresetId,
} from "../types/music";
import {
  formatChordSymbol,
  getDiatonicChordDefinition,
  getDiatonicSeventhChordDefinition,
  intervalsForQuality,
} from "./chords";
import { chromaticMediantsOf } from "./chromaticHarmony";
import { findModalBorrowings } from "./modalInterchange";
import { pitchClassToSemitone, semitoneToPitchClass } from "./scales";

/**
 * Reharmonization.
 *
 * Given a melody the engine could write chords under it, but only forwards: the
 * progression was decided and the line was fitted to it. Going the other way —
 * here is a melody, what else could sit under it — is a different question, and
 * the one an arranger actually asks.
 *
 * It is a search, not a rule. Every technique here is a way of generating
 * candidates, and what separates a good substitution from a bad one is whether
 * the melody still fits, whether the chord still leads where the next one is,
 * and whether it belongs in the style. So candidates are generated broadly and
 * then scored on those three things, and the caller is handed a ranked list
 * rather than a single answer — because there isn't one.
 */

export type ReharmonizationType =
  | "diatonicSubstitution"
  | "secondaryDominant"
  | "tritoneSubstitution"
  | "modalInterchange"
  | "diminishedPassing"
  | "backdoorDominant"
  | "pedalPoint"
  | "slashChord"
  | "chromaticMediant";

export const REHARMONIZATION_TYPES: readonly ReharmonizationType[] = [
  "diatonicSubstitution",
  "secondaryDominant",
  "tritoneSubstitution",
  "modalInterchange",
  "diminishedPassing",
  "backdoorDominant",
  "pedalPoint",
  "slashChord",
  "chromaticMediant",
];

export interface ReharmonizationCandidate {
  type: ReharmonizationType;
  root: CanonicalPitchClass;
  quality: ChordQuality;
  symbol: string;
  /** Set when the sounding bass is not the chord root. */
  bass?: CanonicalPitchClass;
  /** Melody pitch classes over this span that the chord contains. */
  supportedMelodyNotes: number[];
  /** Melody pitch classes it does not. */
  unsupportedMelodyNotes: number[];
  /** Semitones from this chord's root to the next chord's root. */
  rootMotion: number | null;
  /** 0..1. How much of the melody the chord actually holds up. */
  melodyFit: number;
  /** 0..1. How well it leads to what comes next. */
  functionalFit: number;
  /** 0..1. How idiomatic the technique is in the style. */
  styleFit: number;
  /** 0..1. The three above, combined. */
  score: number;
  explanation: string;
}

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

function pitchClassesOf(rootSemitone: number, quality: ChordQuality): number[] {
  return intervalsForQuality(quality).map((interval) => mod12(rootSemitone + interval));
}

/**
 * How strongly a root motion pulls toward the next chord.
 *
 * Down a fifth is the strongest progression in tonal music, which is why it is
 * the one every dominant makes. Stepwise motion is next; a third is weaker but
 * smooth because two notes are usually held; a tritone and standing still pull
 * least.
 */
const ROOT_MOTION_SCORE: Readonly<Record<number, number>> = {
  0: 0.3,
  1: 0.7,
  2: 0.75,
  3: 0.6,
  4: 0.6,
  5: 1,
  6: 0.4,
  7: 0.55,
  8: 0.6,
  9: 0.6,
  10: 0.75,
  11: 0.7,
};

/** How idiomatic each technique is, by style. */
const STYLE_FIT: Readonly<
  Record<ReharmonizationType, Partial<Record<StylePresetId, number>> & { default: number }>
> = {
  diatonicSubstitution: { default: 0.8, pop: 0.9, "j-pop": 0.9, ballad: 0.85 },
  secondaryDominant: { default: 0.7, jazz: 0.9, "j-pop": 0.85, ballad: 0.8, edm: 0.4 },
  tritoneSubstitution: { default: 0.4, jazz: 0.95, "lo-fi": 0.7, pop: 0.2 },
  modalInterchange: { default: 0.6, rock: 0.8, "game-music": 0.8, ballad: 0.75 },
  diminishedPassing: { default: 0.5, jazz: 0.85, ballad: 0.7, "j-pop": 0.7, edm: 0.2 },
  backdoorDominant: { default: 0.35, jazz: 0.85, "lo-fi": 0.6, pop: 0.2 },
  pedalPoint: { default: 0.5, edm: 0.85, "game-music": 0.7, "lo-fi": 0.7 },
  slashChord: { default: 0.6, "j-pop": 0.85, pop: 0.8, ballad: 0.8 },
  chromaticMediant: { default: 0.35, "game-music": 0.9, rock: 0.6, pop: 0.15 },
};

function styleFitFor(type: ReharmonizationType, style: StylePresetId | undefined): number {
  const entry = STYLE_FIT[type];
  if (style && style in entry) return (entry as Record<string, number>)[style] as number;
  return entry.default;
}

export interface ReharmonizeOptions {
  /** The chord being replaced. */
  original: Pick<ChordEvent, "root" | "quality" | "degree">;
  /** Melody pitch classes sounding over the chord's span. */
  melodyPitchClasses: readonly number[];
  /** The chord after it, which the candidate has to lead to. */
  next?: Pick<ChordEvent, "root" | "quality">;
  key: PitchClassName;
  mode: Mode;
  style?: StylePresetId;
  /** Restricts the techniques used. Omitted allows all of them. */
  types?: readonly ReharmonizationType[];
  /** How many to return. Defaults to 5. */
  limit?: number;
  /**
   * Candidates supporting less than this much of the melody are dropped.
   * Defaults to 0.5 — a chord that clashes with half the line is not an option.
   */
  minimumMelodyFit?: number;
}

interface RawCandidate {
  type: ReharmonizationType;
  rootSemitone: number;
  quality: ChordQuality;
  bassSemitone?: number;
  explanation: string;
}

/** Every diatonic chord sharing at least two notes with the original. */
function diatonicSubstitutions(
  key: PitchClassName,
  mode: Mode,
  originalRoot: number,
  originalQuality: ChordQuality,
): RawCandidate[] {
  const original = new Set(pitchClassesOf(originalRoot, originalQuality));
  const found: RawCandidate[] = [];
  for (let degree = 1; degree <= 7; degree += 1) {
    for (const definition of [
      getDiatonicChordDefinition(key, mode, degree),
      getDiatonicSeventhChordDefinition(key, mode, degree),
    ]) {
      const rootSemitone = pitchClassToSemitone(definition.root);
      if (rootSemitone === originalRoot && definition.quality === originalQuality) continue;
      const shared = pitchClassesOf(rootSemitone, definition.quality).filter((pitchClass) =>
        original.has(pitchClass),
      ).length;
      // Fewer than two notes in common is a different chord, not a substitute
      // for this one.
      if (shared < 2) continue;
      found.push({
        type: "diatonicSubstitution",
        rootSemitone,
        quality: definition.quality,
        explanation: `Diatonic substitute sharing ${shared} notes with the original.`,
      });
    }
  }
  return found;
}

function generateCandidates(options: ReharmonizeOptions): RawCandidate[] {
  const tonic = pitchClassToSemitone(options.key);
  const originalRoot = pitchClassToSemitone(options.original.root);
  const nextRoot = options.next ? pitchClassToSemitone(options.next.root) : null;
  const allowed = new Set(options.types ?? REHARMONIZATION_TYPES);
  const raw: RawCandidate[] = [];

  if (allowed.has("diatonicSubstitution")) {
    raw.push(
      ...diatonicSubstitutions(options.key, options.mode, originalRoot, options.original.quality),
    );
  }

  // A secondary dominant is the V7 of whatever comes next, so it needs a next.
  if (allowed.has("secondaryDominant") && nextRoot !== null) {
    raw.push({
      type: "secondaryDominant",
      rootSemitone: mod12(nextRoot + 7),
      quality: "dominant7",
      explanation: `Secondary dominant: V7 of ${options.next!.root}.`,
    });
  }

  // The tritone substitute shares its third and seventh with the dominant it
  // replaces, which is exactly why it can stand in for it.
  if (allowed.has("tritoneSubstitution")) {
    if (options.original.quality === "dominant7") {
      raw.push({
        type: "tritoneSubstitution",
        rootSemitone: mod12(originalRoot + 6),
        quality: "dominant7",
        explanation: "Tritone substitute: same third and seventh, root a tritone away.",
      });
    }
    if (nextRoot !== null) {
      raw.push({
        type: "tritoneSubstitution",
        rootSemitone: mod12(nextRoot + 1),
        quality: "dominant7",
        explanation: `Tritone substitute of V7/${options.next!.root}, resolving down a semitone.`,
      });
    }
  }

  if (allowed.has("modalInterchange")) {
    for (const borrowing of findModalBorrowings(options.key, options.mode, {
      style: options.style,
      minimumWeight: 0.4,
    })) {
      raw.push({
        type: "modalInterchange",
        rootSemitone: pitchClassToSemitone(borrowing.root),
        quality: borrowing.quality,
        explanation: `Borrowed ${borrowing.romanNumeral} from parallel ${borrowing.sourceScale}.`,
      });
    }
  }

  // A diminished seventh a semitone below the next root leads into it by step in
  // every voice, which is what makes it a passing chord rather than a stop.
  if (allowed.has("diminishedPassing") && nextRoot !== null) {
    raw.push({
      type: "diminishedPassing",
      rootSemitone: mod12(nextRoot - 1),
      quality: "diminished7",
      explanation: `Passing diminished, resolving up a semitone into ${options.next!.root}.`,
    });
  }

  // The backdoor: a dominant on the flat seventh, resolving up a whole tone to
  // the tonic instead of down a fifth.
  if (allowed.has("backdoorDominant")) {
    raw.push({
      type: "backdoorDominant",
      rootSemitone: mod12(tonic + 10),
      quality: "dominant7",
      explanation: "Backdoor dominant: bVII7 rising a whole tone to the tonic.",
    });
  }

  // A pedal holds the bass while the harmony above it moves.
  if (allowed.has("pedalPoint") && nextRoot !== null) {
    raw.push({
      type: "pedalPoint",
      rootSemitone: nextRoot,
      quality: options.next!.quality,
      bassSemitone: originalRoot,
      explanation: `Pedal: the next chord over the bass already sounding.`,
    });
  }

  // Putting the third or fifth in the bass keeps the chord and smooths the line
  // underneath it.
  if (allowed.has("slashChord")) {
    for (const interval of intervalsForQuality(options.original.quality).slice(1, 3)) {
      raw.push({
        type: "slashChord",
        rootSemitone: originalRoot,
        quality: options.original.quality,
        bassSemitone: mod12(originalRoot + interval),
        explanation: "Inversion: the same chord with a smoother bass.",
      });
    }
  }

  if (allowed.has("chromaticMediant")) {
    for (const mediant of chromaticMediantsOf(options.original.root, options.original.quality, {
      key: options.key,
      mode: options.mode,
      style: options.style,
      doublyChromatic: false,
    })) {
      raw.push({
        type: "chromaticMediant",
        rootSemitone: pitchClassToSemitone(mediant.root),
        quality: mediant.quality,
        explanation: `Chromatic mediant a ${mediant.rootDistance}-semitone third away, one note held.`,
      });
    }
  }

  return raw;
}

/**
 * What else could sit under this melody, best first.
 *
 * A candidate is scored on three things and none of them alone decides it: how
 * much of the melody the chord actually holds up, how strongly it leads to what
 * follows, and whether the technique belongs in the style. A tritone substitute
 * is the right answer in jazz and the wrong one in four-chord pop, and nothing
 * about the notes says so.
 */
export function reharmonizeChord(
  options: ReharmonizeOptions,
): ReharmonizationCandidate[] {
  const melody = [...new Set(options.melodyPitchClasses.map(mod12))];
  const nextRoot = options.next ? pitchClassToSemitone(options.next.root) : null;
  const minimumMelodyFit = options.minimumMelodyFit ?? 0.5;
  const originalRoot = pitchClassToSemitone(options.original.root);

  const seen = new Set<string>();
  const scored: ReharmonizationCandidate[] = [];
  for (const raw of generateCandidates(options)) {
    const identity = `${raw.rootSemitone}:${raw.quality}:${raw.bassSemitone ?? ""}`;
    // The same chord can be reached by more than one technique. The first to
    // find it keeps it, and the list is generated in the order the techniques
    // are declared, so the reading is stable.
    if (seen.has(identity)) continue;
    // Proposing the chord that is already there is not a reharmonization.
    if (
      raw.rootSemitone === originalRoot &&
      raw.quality === options.original.quality &&
      raw.bassSemitone === undefined
    ) {
      continue;
    }
    seen.add(identity);

    const tones = new Set(pitchClassesOf(raw.rootSemitone, raw.quality));
    const supported = melody.filter((pitchClass) => tones.has(pitchClass));
    const unsupported = melody.filter((pitchClass) => !tones.has(pitchClass));
    const melodyFit = melody.length === 0 ? 1 : supported.length / melody.length;
    if (melodyFit < minimumMelodyFit) continue;

    const rootMotion = nextRoot === null ? null : mod12(nextRoot - raw.rootSemitone);
    let functionalFit = rootMotion === null ? 0.5 : ROOT_MOTION_SCORE[rootMotion] ?? 0.5;
    // A dominant resolving is the strongest move there is, and root motion alone
    // cannot see it: a fourth up is only a V-I when the chord is a dominant, and
    // a semitone down is only strong when it is one too — that descent is the
    // whole point of a tritone substitute, and scoring it as an ordinary
    // stepwise move buried the substitutes the technique exists to produce.
    if (raw.quality === "dominant7" && (rootMotion === 5 || rootMotion === 11)) {
      functionalFit = 1;
    }

    const styleFit = styleFitFor(raw.type, options.style);
    const root = semitoneToPitchClass(raw.rootSemitone);
    const bass = raw.bassSemitone === undefined
      ? undefined
      : semitoneToPitchClass(raw.bassSemitone);

    scored.push({
      type: raw.type,
      root,
      quality: raw.quality,
      symbol: bass && bass !== root
        ? `${formatChordSymbol(root, raw.quality)}/${bass}`
        : formatChordSymbol(root, raw.quality),
      ...(bass && bass !== root ? { bass } : {}),
      supportedMelodyNotes: supported,
      unsupportedMelodyNotes: unsupported,
      rootMotion,
      melodyFit,
      functionalFit,
      styleFit,
      // The melody comes first: a substitution that fights the line is not a
      // substitution, however idiomatic the technique.
      score: melodyFit * 0.45 + functionalFit * 0.3 + styleFit * 0.25,
      explanation: raw.explanation,
    });
  }

  return scored
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.symbol.localeCompare(right.symbol);
    })
    .slice(0, options.limit ?? 5);
}

/** The melody pitch classes sounding while a chord is held. */
export function melodyPitchClassesOver(
  notes: readonly NoteEvent[],
  chord: Pick<ChordEvent, "startTick" | "durationTick">,
): number[] {
  const end = chord.startTick + chord.durationTick;
  return [
    ...new Set(
      notes
        .filter((note) => note.startTick < end && note.startTick + note.durationTick > chord.startTick)
        .map((note) => mod12(note.midi)),
    ),
  ];
}

export interface ReharmonizeProgressionOptions
  extends Omit<ReharmonizeOptions, "original" | "melodyPitchClasses" | "next"> {
  chords: readonly ChordEvent[];
  notes: readonly NoteEvent[];
}

/**
 * Reharmonization options for every chord of a piece.
 *
 * Returned in step with the input, so index N holds the candidates for chord N.
 * The chords are read but never rewritten: which alternative to take is a
 * decision for whoever is arranging, and offering three is the point.
 */
export function reharmonizeProgression(
  options: ReharmonizeProgressionOptions,
): ReharmonizationCandidate[][] {
  const { chords, notes, ...rest } = options;
  return chords.map((chord, index) =>
    reharmonizeChord({
      ...rest,
      original: chord,
      melodyPitchClasses: melodyPitchClassesOver(notes, chord),
      next: chords[index + 1],
    }),
  );
}
