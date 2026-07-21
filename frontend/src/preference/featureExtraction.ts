import type {
  ChordEvent,
  ChordQuality,
  ChordSource,
  ChordSpecialKind,
  GeneratedComposition,
  HarmonyFunction,
  NoteEvent,
} from "../types/music";
import {
  PREFERENCE_FEATURE_VERSION,
  type FeatureVector,
  type PreferenceCategory,
  type PreferenceFeatureSet,
} from "./types";

const PITCH_CLASS: Readonly<Record<ChordEvent["root"], number>> = {
  C: 0,
  "C#": 1,
  D: 2,
  "D#": 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
  A: 9,
  "A#": 10,
  B: 11,
};

const CHORD_QUALITIES: readonly ChordQuality[] = [
  "major",
  "minor",
  "diminished",
  "augmented",
  "dominant7",
  "major7",
  "minor7",
  "halfDiminished7",
  "diminished7",
  "minorMajor7",
  "augmentedMajor7",
  "sus2",
  "sus4",
  "add9",
  "minorAdd9",
];

const HARMONY_FUNCTIONS: readonly HarmonyFunction[] = [
  "tonic",
  "predominant",
  "dominant",
  "other",
];

const CHORD_SOURCES: readonly ChordSource[] = [
  "diatonic",
  "secondaryDominant",
  "borrowed",
  "substitute",
  "other",
];

const SPECIAL_CHORD_KINDS: readonly ChordSpecialKind[] = [
  "secondaryDominant",
  "borrowed",
  "tritoneSubstitution",
  "suspended",
  "addedTone",
];

const TENSION: Readonly<Record<ChordQuality, number>> = {
  major: 0.1,
  minor: 0.16,
  diminished: 0.9,
  augmented: 1,
  dominant7: 0.78,
  major7: 0.44,
  minor7: 0.4,
  halfDiminished7: 0.84,
  diminished7: 0.94,
  minorMajor7: 0.8,
  augmentedMajor7: 0.96,
  sus2: 0.3,
  sus4: 0.38,
  add9: 0.28,
  minorAdd9: 0.34,
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function finite(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fraction<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  if (items.length === 0) return 0;
  return items.filter(predicate).length / items.length;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedChords(composition: GeneratedComposition): ChordEvent[] {
  return [...composition.chords].sort(
    (left, right) => left.startTick - right.startTick || compareText(left.id, right.id),
  );
}

function sortedNotes(composition: GeneratedComposition): NoteEvent[] {
  return [...composition.notes].sort(
    (left, right) => left.startTick - right.startTick || compareText(left.id, right.id),
  );
}

function addNGrams(
  output: FeatureVector,
  prefix: string,
  values: readonly string[],
  size: number,
): void {
  const windowCount = values.length - size + 1;
  if (windowCount <= 0) return;
  const counts = new Map<string, number>();
  for (let index = 0; index < windowCount; index += 1) {
    const gram = values.slice(index, index + size).join(">");
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  for (const [gram, count] of [...counts].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  )) {
    output[`${prefix}.${gram}`] = finite(count / windowCount);
  }
}

function pitchClasses(notes: readonly number[]): Set<number> {
  return new Set(notes.map((note) => ((note % 12) + 12) % 12));
}

function commonToneRatio(left: ChordEvent, right: ChordEvent): number {
  const leftSet = pitchClasses(left.notes);
  const rightSet = pitchClasses(right.notes);
  const denominator = Math.max(1, Math.min(leftSet.size, rightSet.size));
  let shared = 0;
  for (const pitchClass of leftSet) if (rightSet.has(pitchClass)) shared += 1;
  return shared / denominator;
}

function adjacentPairs<T>(items: readonly T[]): Array<readonly [T, T]> {
  const result: Array<readonly [T, T]> = [];
  for (let index = 1; index < items.length; index += 1) {
    result.push([items[index - 1] as T, items[index] as T]);
  }
  return result;
}

export function extractHarmonyFeatures(composition: GeneratedComposition): FeatureVector {
  const chords = sortedChords(composition);
  const features: FeatureVector = {};
  const romans = chords.map((chord) => chord.romanNumeral || "unknown");
  addNGrams(features, "roman.1", romans, 1);
  addNGrams(features, "roman.2", romans, 2);
  addNGrams(features, "roman.3", romans, 3);

  for (const harmonyFunction of HARMONY_FUNCTIONS) {
    features[`function.${harmonyFunction}`] = fraction(
      chords,
      (chord) => chord.function === harmonyFunction,
    );
  }
  features[`cadence.${composition.cadence}`] = 1;
  for (const quality of CHORD_QUALITIES) {
    features[`quality.${quality}`] = fraction(chords, (chord) => chord.quality === quality);
  }
  features["quality.tension"] = mean(chords.map((chord) => TENSION[chord.quality]));
  features["quality.seventhRate"] = fraction(chords, (chord) =>
    chord.quality.endsWith("7")
  );

  for (const source of CHORD_SOURCES) {
    features[`source.${source}`] = fraction(chords, (chord) => chord.source === source);
  }
  features["source.nonDiatonicRate"] = fraction(chords, (chord) => chord.source !== "diatonic");
  features["source.specialRate"] = fraction(
    chords,
    (chord) => chord.source !== "diatonic" && chord.source !== "other",
  );
  for (const specialKind of SPECIAL_CHORD_KINDS) {
    features[`special.${specialKind}`] = fraction(
      chords,
      (chord) => chord.specialKind === specialKind,
    );
  }

  const pairs = adjacentPairs(chords);
  const rootDistances = pairs.map(([left, right]) => {
    const difference = Math.abs(PITCH_CLASS[right.root] - PITCH_CLASS[left.root]);
    return Math.min(difference, 12 - difference);
  });
  features["rootMotion.mean"] = clamp01(mean(rootDistances) / 6);
  features["rootMotion.stepRate"] = fraction(rootDistances, (distance) => distance <= 2);
  features["rootMotion.fifthRate"] = fraction(
    pairs,
    ([left, right]) => {
      const directed = (PITCH_CLASS[right.root] - PITCH_CLASS[left.root] + 12) % 12;
      return directed === 5 || directed === 7;
    },
  );
  features["rootMotion.commonToneRate"] = mean(
    pairs.map(([left, right]) => commonToneRatio(left, right)),
  );
  return features;
}

function chordAt(chords: readonly ChordEvent[], tick: number): ChordEvent | undefined {
  return chords.find(
    (chord) => tick >= chord.startTick && tick < chord.startTick + chord.durationTick,
  );
}

export function extractMelodyFeatures(composition: GeneratedComposition): FeatureVector {
  const notes = sortedNotes(composition);
  const chords = sortedChords(composition);
  const intervals = adjacentPairs(notes).map(([left, right]) => right.midi - left.midi);
  const absoluteIntervals = intervals.map(Math.abs);
  const chordToneRate = fraction(notes, (note) => {
    const chord = chordAt(chords, note.startTick);
    return chord !== undefined && chord.notes.some((midi) => midi % 12 === note.midi % 12);
  });
  const directionChanges = adjacentPairs(intervals.filter((interval) => interval !== 0));
  const pitches = notes.map((note) => note.midi);
  const pitchRange = pitches.length === 0 ? 0 : Math.max(...pitches) - Math.min(...pitches);
  const bars = Math.max(1, composition.bars.length);

  const features: FeatureVector = {
    chordToneRate,
    leapRate: fraction(absoluteIntervals, (interval) => interval >= 5),
    largeLeapRate: fraction(absoluteIntervals, (interval) => interval >= 8),
    stepRate: fraction(absoluteIntervals, (interval) => interval > 0 && interval <= 2),
    repeatedNoteRate: fraction(absoluteIntervals, (interval) => interval === 0),
    meanInterval: clamp01(mean(absoluteIntervals) / 12),
    directionChangeRate: fraction(
      directionChanges,
      ([left, right]) => Math.sign(left) !== Math.sign(right),
    ),
    pitchRange: clamp01(pitchRange / 36),
    meanRegister: clamp01(mean(pitches) / 127),
    density: clamp01(notes.length / bars / 8),
  };
  for (const role of ["chordTone", "scaleTone", "passing", "neighbor", "approach"] as const) {
    features[`role.${role}`] = fraction(notes, (note) => note.role === role);
  }
  return features;
}

export function extractRhythmFeatures(composition: GeneratedComposition): FeatureVector {
  const notes = sortedNotes(composition);
  const bars = Math.max(1, composition.bars.length);
  const durations = notes.map((note) => note.durationTick);
  const averageDuration = mean(durations);
  const durationDeviation = mean(durations.map((duration) => Math.abs(duration - averageDuration)));
  const ppq = Math.max(1, composition.ppq);
  const occupiedTicks = notes.reduce((sum, note) => sum + Math.max(0, note.durationTick), 0);
  const noteDensity = notes.length / bars;
  return {
    onsetDensity: clamp01(noteDensity / 8),
    occupancy: clamp01(occupiedTicks / Math.max(1, composition.totalTicks)),
    restRate: clamp01(1 - occupiedTicks / Math.max(1, composition.totalTicks)),
    meanDuration: clamp01(averageDuration / Math.max(1, composition.ticksPerBar)),
    durationVariation: clamp01(durationDeviation / Math.max(ppq, averageDuration, 1)),
    offbeatRate: fraction(notes, (note) => note.startTick % ppq !== 0),
    syncopationRate: fraction(notes, (note) => note.startTick % (ppq / 2) !== 0),
  };
}

function nearestVoiceDistance(note: number, previous: readonly number[]): number {
  if (previous.length === 0) return 0;
  return Math.min(...previous.map((candidate) => Math.abs(note - candidate)));
}

export function extractVoicingFeatures(composition: GeneratedComposition): FeatureVector {
  const chords = sortedChords(composition);
  const pairs = adjacentPairs(chords);
  const spans = chords.map((chord) => {
    if (chord.notes.length < 2) return 0;
    return Math.max(...chord.notes) - Math.min(...chord.notes);
  });
  const movements = pairs.map(([left, right]) =>
    mean(right.notes.map((note) => nearestVoiceDistance(note, left.notes)))
  );
  return {
    inversionRate: fraction(chords, (chord) => chord.inversion !== 0),
    meanInversion: clamp01(mean(chords.map((chord) => chord.inversion)) / 3),
    meanSpan: clamp01(mean(spans) / 24),
    wideVoicingRate: fraction(spans, (span) => span >= 17),
    meanBassRegister: clamp01(
      mean(chords.map((chord) => Math.min(...chord.notes))) / 127,
    ),
    meanChordSize: clamp01(mean(chords.map((chord) => chord.notes.length)) / 5),
    voiceLeadingMotion: clamp01(mean(movements) / 12),
    commonToneRate: mean(pairs.map(([left, right]) => commonToneRatio(left, right))),
  };
}

export function combinePreferenceFeatures(
  categories: Pick<PreferenceFeatureSet, "harmony" | "melody" | "rhythm" | "voicing">,
): FeatureVector {
  const combined: FeatureVector = {};
  for (const category of ["harmony", "melody", "rhythm", "voicing"] as const) {
    for (const [feature, value] of Object.entries(categories[category]).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    )) {
      combined[`${category}.${feature}`] = finite(value);
    }
  }
  return combined;
}

export function extractPreferenceFeatures(
  composition: GeneratedComposition,
): PreferenceFeatureSet {
  const categories = {
    harmony: extractHarmonyFeatures(composition),
    melody: extractMelodyFeatures(composition),
    rhythm: extractRhythmFeatures(composition),
    voicing: extractVoicingFeatures(composition),
  };
  return {
    version: PREFERENCE_FEATURE_VERSION,
    compositionId: composition.id,
    ...categories,
    combined: combinePreferenceFeatures(categories),
  };
}

export function featuresForCategory(
  features: PreferenceFeatureSet,
  category: PreferenceCategory,
): FeatureVector {
  return features[category];
}
