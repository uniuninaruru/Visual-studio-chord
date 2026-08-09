import { clusterCount, lowIntervalViolation, spacingInversion, span } from "./voicingRegister";

/**
 * What a recording actually does, measured rather than assumed.
 *
 * Every number in VOICING_PROFILES is one I chose. Some were checked by ear and
 * three were checked by measurement and found wrong. That is the whole problem
 * this file exists to answer: the profiles describe how chords should be held,
 * and nothing in the repository holds an example of chords being held well.
 *
 * The distinction that makes this worth doing rather than another guess: none
 * of it needs a chord label, a key, or the harmoniser. A span is a subtraction.
 * A cluster is a gap of two semitones or less. The estimator that recovers
 * degrees from MIDI is only 65% right in major and 60% in minor, so anything
 * learned through it inherits that error -- and none of it is in this path.
 * What is measured here is what the file plainly contains.
 *
 * Weighted by sounding time, not by count. A chord held for a bar and a chord
 * passed through in a sixteenth are not equal evidence of how a player voices,
 * and the key finder in this app already made the same choice for the same
 * reason.
 */

/** A set of pitches sounding together, and for how long that exact set held. */
export interface ChordSlice {
  /** Ascending, deduplicated across octaves-as-written -- so a doubled pitch counts once. */
  notes: number[];
  startTick: number;
  durationTick: number;
}

export interface SliceOptions {
  /**
   * Fewest simultaneous pitches to count as a chord.
   *
   * Two notes state an interval, not a voicing, and a melody with one held
   * accompaniment note would otherwise flood the sample with dyads.
   */
  minVoices?: number;
  /**
   * Shortest slice worth counting, in ticks.
   *
   * Every passing note in the melody momentarily forms a new vertical set with
   * whatever is under it. Those sets are artefacts of the line moving, not
   * voicings anyone chose, and at a 480-tick quarter a sixteenth is 120.
   */
  minDurationTick?: number;
  /** Ignored entirely; drum pitches are numbers, not notes. */
  percussionChannel?: number;
}

interface TimedNote {
  midi: number;
  startTick: number;
  durationTick: number;
  channel?: number;
}

const DEFAULT_MIN_VOICES = 3;
const DEFAULT_MIN_DURATION = 120;

/**
 * Every distinct vertical set the notes form, in order.
 *
 * Swept at onsets and releases rather than on a grid: a grid either misses
 * voicings shorter than its step or invents boundaries the music does not have,
 * and the boundaries where the sounding set changes are exactly the note
 * events themselves.
 *
 * Consecutive slices holding the same pitches are merged, so a chord under a
 * moving melody is one slice of the length it is actually held rather than one
 * slice per melody note.
 */
export function chordSlices(
  notes: readonly TimedNote[],
  options: SliceOptions = {},
): ChordSlice[] {
  const minVoices = options.minVoices ?? DEFAULT_MIN_VOICES;
  const minDuration = options.minDurationTick ?? DEFAULT_MIN_DURATION;
  const percussion = options.percussionChannel ?? 9;

  const playing = notes.filter(
    (note) => note.channel !== percussion && note.durationTick > 0,
  );
  if (playing.length === 0) return [];

  const boundaries = new Set<number>();
  for (const note of playing) {
    boundaries.add(note.startTick);
    boundaries.add(note.startTick + note.durationTick);
  }
  const times = [...boundaries].sort((left, right) => left - right);

  const slices: ChordSlice[] = [];
  for (let index = 0; index + 1 < times.length; index += 1) {
    const from = times[index] as number;
    const to = times[index + 1] as number;
    const sounding = playing
      .filter((note) => note.startTick <= from && note.startTick + note.durationTick > from)
      .map((note) => note.midi);
    if (sounding.length === 0) continue;
    const pitches = [...new Set(sounding)].sort((left, right) => left - right);

    const previous = slices[slices.length - 1];
    if (
      previous
      && previous.startTick + previous.durationTick === from
      && previous.notes.length === pitches.length
      && previous.notes.every((pitch, position) => pitch === pitches[position])
    ) {
      previous.durationTick += to - from;
      continue;
    }
    slices.push({ notes: pitches, startTick: from, durationTick: to - from });
  }

  return slices.filter(
    (slice) => slice.notes.length >= minVoices && slice.durationTick >= minDuration,
  );
}

/** A distribution reported at the points that say something, not as a mean alone. */
export interface Distribution {
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  mean: number;
}

export interface VoicingStatistics {
  /** How many slices the figures rest on. Small samples say so rather than pretending. */
  sliceCount: number;
  /** Total sounding time behind the figures, in ticks. */
  weight: number;
  span: Distribution;
  voiceCount: Distribution;
  lowestNote: Distribution;
  highestNote: Distribution;
  /** The interval between the bottom two voices, where spacing is decided. */
  bottomInterval: Distribution;
  /** Share of sounding time whose voicing holds at least one second. */
  clusterShare: number;
  /** Share of sounding time whose gaps widen going up somewhere. */
  inversionShare: number;
  /** Share of sounding time below a low interval limit. */
  lowIntervalShare: number;
  /** Share of sounding time with a gap of an octave or more inside -- two hands. */
  twoHandShare: number;
}

/** Nearest-rank on the time-weighted distribution; no interpolation, so it is exact. */
function weightedQuantile(
  entries: ReadonlyArray<{ value: number; weight: number }>,
  quantile: number,
): number {
  if (entries.length === 0) return 0;
  const sorted = [...entries].sort((left, right) => left.value - right.value);
  const total = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return sorted[0]?.value ?? 0;
  const target = total * quantile;
  let seen = 0;
  for (const entry of sorted) {
    seen += entry.weight;
    if (seen >= target) return entry.value;
  }
  return sorted[sorted.length - 1]?.value ?? 0;
}

function distributionOf(entries: ReadonlyArray<{ value: number; weight: number }>): Distribution {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const mean = total > 0
    ? entries.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / total
    : 0;
  return {
    p10: weightedQuantile(entries, 0.1),
    p25: weightedQuantile(entries, 0.25),
    median: weightedQuantile(entries, 0.5),
    p75: weightedQuantile(entries, 0.75),
    p90: weightedQuantile(entries, 0.9),
    mean,
  };
}

const EMPTY_DISTRIBUTION: Distribution = {
  p10: 0, p25: 0, median: 0, p75: 0, p90: 0, mean: 0,
};

/** Measures how a body of voicings is held. Pure geometry -- no key, no labels. */
export function measureVoicing(slices: readonly ChordSlice[]): VoicingStatistics {
  if (slices.length === 0) {
    return {
      sliceCount: 0, weight: 0,
      span: EMPTY_DISTRIBUTION, voiceCount: EMPTY_DISTRIBUTION,
      lowestNote: EMPTY_DISTRIBUTION, highestNote: EMPTY_DISTRIBUTION,
      bottomInterval: EMPTY_DISTRIBUTION,
      clusterShare: 0, inversionShare: 0, lowIntervalShare: 0, twoHandShare: 0,
    };
  }

  const weight = slices.reduce((sum, slice) => sum + slice.durationTick, 0);
  const by = (pick: (slice: ChordSlice) => number) =>
    slices.map((slice) => ({ value: pick(slice), weight: slice.durationTick }));

  const shareWhere = (predicate: (slice: ChordSlice) => boolean) =>
    slices.reduce((sum, slice) => sum + (predicate(slice) ? slice.durationTick : 0), 0) / weight;

  return {
    sliceCount: slices.length,
    weight,
    span: distributionOf(by((slice) => span(slice.notes))),
    voiceCount: distributionOf(by((slice) => slice.notes.length)),
    lowestNote: distributionOf(by((slice) => slice.notes[0] as number)),
    highestNote: distributionOf(by((slice) => slice.notes[slice.notes.length - 1] as number)),
    bottomInterval: distributionOf(
      by((slice) => (slice.notes[1] as number) - (slice.notes[0] as number)),
    ),
    clusterShare: shareWhere((slice) => clusterCount(slice.notes) > 0),
    inversionShare: shareWhere((slice) => spacingInversion(slice.notes) > 0),
    lowIntervalShare: shareWhere((slice) => lowIntervalViolation(slice.notes) > 0),
    twoHandShare: shareWhere((slice) => {
      for (let index = 1; index < slice.notes.length; index += 1) {
        if ((slice.notes[index] as number) - (slice.notes[index - 1] as number) >= 12) return true;
      }
      return false;
    }),
  };
}

/**
 * The span range a profile should carry, read off a reference.
 *
 * minSpan and maxSpan are the only profile fields a recording states directly:
 * they are a range of widths, and a recording is a sample of widths. Every other
 * field is a weight in a cost function, which nothing outside this app has an
 * opinion about -- those have to be fitted against a rate, not read off.
 *
 * The tenth and ninetieth percentiles rather than the extremes, because one
 * cluster chord and one three-octave arpeggiated stab should not set the range
 * every other chord is judged against.
 */
export function spanRangeFrom(statistics: VoicingStatistics): { minSpan: number; maxSpan: number } {
  return {
    minSpan: Math.round(statistics.span.p10),
    maxSpan: Math.round(statistics.span.p90),
  };
}

export interface MetricComparison {
  metric: string;
  reference: number;
  measured: number;
  /** measured − reference. Positive means this app does more of it. */
  difference: number;
}

/**
 * Where this app's voicings differ from a reference, metric by metric.
 *
 * Deliberately not a single score. A number that said "82% as good" would hide
 * which of the eight things is wrong, and the only useful output of a
 * measurement is the thing to change next.
 */
export function compareVoicing(
  reference: VoicingStatistics,
  measured: VoicingStatistics,
): MetricComparison[] {
  const entries: Array<[string, number, number]> = [
    ["span.median", reference.span.median, measured.span.median],
    ["span.p10", reference.span.p10, measured.span.p10],
    ["span.p90", reference.span.p90, measured.span.p90],
    ["voiceCount.mean", reference.voiceCount.mean, measured.voiceCount.mean],
    ["lowestNote.median", reference.lowestNote.median, measured.lowestNote.median],
    ["highestNote.median", reference.highestNote.median, measured.highestNote.median],
    ["bottomInterval.median", reference.bottomInterval.median, measured.bottomInterval.median],
    ["clusterShare", reference.clusterShare, measured.clusterShare],
    ["inversionShare", reference.inversionShare, measured.inversionShare],
    ["lowIntervalShare", reference.lowIntervalShare, measured.lowIntervalShare],
    ["twoHandShare", reference.twoHandShare, measured.twoHandShare],
  ];
  return entries.map(([metric, referenceValue, measuredValue]) => ({
    metric,
    reference: referenceValue,
    measured: measuredValue,
    difference: measuredValue - referenceValue,
  }));
}
