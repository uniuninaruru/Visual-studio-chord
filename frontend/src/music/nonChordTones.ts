import type {
  ChordEvent,
  NonChordToneName,
  NoteEvent,
  NoteRole,
} from "../types/music";
import { createSeededRandom, deriveSeed, hashSeed, type Seed } from "./random";
import { midiToNoteName } from "./scales";

/**
 * Non-chord tones, generated as patterns.
 *
 * The melody already produced notes outside the chord — the weighting simply
 * allowed them — and labelled them after the fact by looking at the interval
 * behind them. That gets the name right often enough, but it is backwards: a
 * suspension is not a pitch that happens to be dissonant, it is a chord tone
 * held past its chord and resolved down by step. The dissonance only means
 * anything as the middle of three events.
 *
 * So this generates the whole figure at once. Each pattern is detected at a site
 * where its preconditions genuinely hold, and applied as a unit: what prepares
 * the dissonance, the dissonance, and what resolves it.
 */

/**
 * Alias of the settings-level name rather than a second declaration, so the two
 * lists cannot drift apart.
 */
export type NonChordToneType = NonChordToneName;

export const NON_CHORD_TONE_TYPES: readonly NonChordToneType[] = [
  "passingTone",
  "neighborTone",
  "appoggiatura",
  "anticipation",
  "suspension",
  "retardation",
  "escapeTone",
  "enclosure",
];

export interface OrnamentPattern {
  type: NonChordToneType;
  /** The note the figure departs from. Absent when the figure opens on it. */
  preparation: NoteEvent | null;
  /** The non-chord tone itself. */
  dissonance: NoteEvent;
  /** Where the dissonance goes. This is what makes the figure legible. */
  resolution: NoteEvent;
}

export interface NonChordToneSettings {
  /** Off leaves the melody exactly as generated. */
  enabled: boolean;
  /** 0..1. How often an eligible site is ornamented. Defaults to 0.5. */
  rate?: number;
  /** Restricts the figures used. Omitted allows all of them. */
  types?: readonly NonChordToneType[];
}

/**
 * How readily each figure is used when several fit the same site.
 *
 * Passing and neighbour tones are the ordinary currency of a tonal line;
 * enclosure is a deliberate, comparatively rare gesture. Picking uniformly
 * among whatever fits inverts that — the figures with the loosest conditions
 * come out on top precisely because they fit everywhere.
 */
const FIGURE_WEIGHT: Readonly<Record<NonChordToneType, number>> = {
  passingTone: 5,
  neighborTone: 4,
  suspension: 3,
  appoggiatura: 2,
  anticipation: 2,
  retardation: 1.5,
  escapeTone: 1.5,
  enclosure: 1,
};

/** How each figure maps onto the note roles the rest of the app already knows. */
const ROLE_FOR_TYPE: Readonly<Record<NonChordToneType, NoteRole>> = {
  passingTone: "passing",
  neighborTone: "neighbor",
  appoggiatura: "approach",
  anticipation: "approach",
  suspension: "approach",
  retardation: "approach",
  escapeTone: "approach",
  enclosure: "approach",
};

function chordAt(chords: readonly ChordEvent[], tick: number): ChordEvent | undefined {
  return chords.find(
    (chord) => tick >= chord.startTick && tick < chord.startTick + chord.durationTick,
  );
}

function isChordTone(midi: number, chord: ChordEvent | undefined): boolean {
  if (!chord) return false;
  return chord.notes.some((note) => ((note % 12) + 12) % 12 === ((midi % 12) + 12) % 12);
}

/** The next pitch of the scale above or below `midi`, or null past its edge. */
function scaleStep(
  midi: number,
  direction: 1 | -1,
  scale: readonly number[],
): number | null {
  if (direction === 1) {
    for (const candidate of scale) if (candidate > midi) return candidate;
    return null;
  }
  for (let index = scale.length - 1; index >= 0; index -= 1) {
    const candidate = scale[index] as number;
    if (candidate < midi) return candidate;
  }
  return null;
}

/** The scale pitch strictly between two notes a third apart, if there is one. */
function scaleBetween(
  low: number,
  high: number,
  scale: readonly number[],
): number | null {
  const inner = scale.filter((pitch) => pitch > low && pitch < high);
  return inner.length === 1 ? (inner[0] as number) : (inner[0] ?? null);
}

export interface NonChordToneOptions {
  chords: readonly ChordEvent[];
  /**
   * The scale available in a bar, as sorted MIDI pitches.
   *
   * A callback rather than one array because a section can carry its own key,
   * mode or pentatonic, and an ornament has to be drawn from the scale the bar
   * it lands in is actually running.
   */
  scaleForBar: (barIndex: number) => readonly number[];
  /** Melody range, inclusive. Ornaments outside it are not written. */
  range: readonly [number, number];
  settings?: NonChordToneSettings;
  seed: Seed;
}

interface Candidate {
  type: NonChordToneType;
  /** Notes replacing the pair the figure was detected on. */
  replacement: NoteEvent[];
  /** How many notes of the source the figure consumes: 1 or 2. */
  consumed: number;
  pattern: OrnamentPattern;
}

function makeNote(
  source: NoteEvent,
  midi: number,
  startTick: number,
  durationTick: number,
  role: NoteRole,
  seed: Seed,
  label: string,
): NoteEvent {
  const idHash = hashSeed(
    deriveSeed(seed, "ncts", label, startTick, durationTick, midi),
  ).toString(36);
  return {
    ...source,
    id: `note-${source.barIndex}-${startTick}-${idHash}`,
    midi,
    noteName: midiToNoteName(midi),
    startTick,
    durationTick,
    role,
  };
}

/**
 * Finds the figure that fits at a pair of adjacent notes, if any.
 *
 * Order matters: the earlier a figure appears here the more specific its
 * preconditions are, so the specific ones are not swallowed by the general.
 * A suspension and a passing tone can both be legal at a chord change, but the
 * suspension is the stronger reading and is checked first.
 */
function candidateAt(
  first: NoteEvent,
  second: NoteEvent,
  options: NonChordToneOptions,
  allowed: ReadonlySet<NonChordToneType>,
): Candidate[] {
  const { chords, range, seed } = options;
  const [low, high] = range;
  const scale = options.scaleForBar(first.barIndex);
  const secondScale = options.scaleForBar(second.barIndex);
  const firstChord = chordAt(chords, first.startTick);
  const secondChord = chordAt(chords, second.startTick);
  const inRange = (midi: number) => midi >= low && midi <= high;
  const gap = second.midi - first.midi;
  const direction: 1 | -1 = gap >= 0 ? 1 : -1;
  const found: Candidate[] = [];

  const splitFirst = (): [number, number] | null => {
    if (first.durationTick < 2) return null;
    const head = Math.floor(first.durationTick / 2);
    return head > 0 && first.durationTick - head > 0
      ? [head, first.durationTick - head]
      : null;
  };

  // A figure written into the first note's span: the note is shortened and the
  // ornament takes the remainder, so nothing crosses a bar line.
  const afterFirst = (
    type: NonChordToneType,
    midi: number,
  ): Candidate | null => {
    const split = splitFirst();
    if (!split || !inRange(midi)) return null;
    const [head, tail] = split;
    const prepared = { ...first, durationTick: head };
    const ornament = makeNote(
      first,
      midi,
      first.startTick + head,
      tail,
      ROLE_FOR_TYPE[type],
      seed,
      type,
    );
    return {
      type,
      replacement: [prepared, ornament],
      consumed: 1,
      pattern: { type, preparation: prepared, dissonance: ornament, resolution: second },
    };
  };

  // Suspension and retardation: a chord tone held past its chord, resolving by
  // step. Checked before anything else at a chord change — it is the reading
  // that explains the dissonance rather than merely permitting it.
  if (
    secondChord &&
    firstChord &&
    secondChord.id !== firstChord.id &&
    second.durationTick >= 2 &&
    isChordTone(first.midi, firstChord) &&
    !isChordTone(first.midi, secondChord) &&
    inRange(first.midi)
  ) {
    for (const [type, step] of [
      ["suspension", -1],
      ["retardation", 1],
    ] as const) {
      if (!allowed.has(type)) continue;
      const resolutionMidi = scaleStep(first.midi, step, secondScale);
      if (
        resolutionMidi === null ||
        !inRange(resolutionMidi) ||
        !isChordTone(resolutionMidi, secondChord)
      ) {
        continue;
      }
      const head = Math.floor(second.durationTick / 2);
      const tail = second.durationTick - head;
      if (head <= 0 || tail <= 0) continue;
      const held = makeNote(
        second,
        first.midi,
        second.startTick,
        head,
        ROLE_FOR_TYPE[type],
        seed,
        type,
      );
      const resolved = makeNote(
        second,
        resolutionMidi,
        second.startTick + head,
        tail,
        "chordTone",
        seed,
        `${type}-res`,
      );
      found.push({
        type,
        replacement: [first, held, resolved],
        consumed: 2,
        pattern: { type, preparation: first, dissonance: held, resolution: resolved },
      });
    }
  }

  // Anticipation: the next chord's tone arrives before the chord does.
  if (
    allowed.has("anticipation") &&
    firstChord &&
    secondChord &&
    secondChord.id !== firstChord.id &&
    isChordTone(second.midi, secondChord) &&
    !isChordTone(second.midi, firstChord)
  ) {
    const candidate = afterFirst("anticipation", second.midi);
    if (candidate) found.push(candidate);
  }

  // Passing tone: two chord tones a third apart, with the scale filling the gap.
  if (
    allowed.has("passingTone") &&
    (Math.abs(gap) === 3 || Math.abs(gap) === 4) &&
    isChordTone(first.midi, firstChord) &&
    isChordTone(second.midi, secondChord)
  ) {
    const between = scaleBetween(
      Math.min(first.midi, second.midi),
      Math.max(first.midi, second.midi),
      scale,
    );
    if (between !== null && !isChordTone(between, firstChord)) {
      const candidate = afterFirst("passingTone", between);
      if (candidate) found.push(candidate);
    }
  }

  // Neighbour tone: a repeated chord tone, decorated by stepping away and back.
  if (allowed.has("neighborTone") && gap === 0 && isChordTone(first.midi, firstChord)) {
    const random = createSeededRandom(deriveSeed(seed, "neighbor", first.startTick));
    const preferred: 1 | -1 = random.next() < 0.5 ? 1 : -1;
    for (const step of [preferred, -preferred as 1 | -1]) {
      const midi = scaleStep(first.midi, step, scale);
      if (midi === null || isChordTone(midi, firstChord)) continue;
      const candidate = afterFirst("neighborTone", midi);
      if (candidate) {
        found.push(candidate);
        break;
      }
    }
  }

  // Escape tone: step away from a chord tone, then leap back the other way. The
  // leap is already there in the source; the step out is what is added.
  if (
    allowed.has("escapeTone") &&
    Math.abs(gap) >= 3 &&
    isChordTone(first.midi, firstChord)
  ) {
    const midi = scaleStep(first.midi, -direction as 1 | -1, scale);
    if (midi !== null && !isChordTone(midi, firstChord)) {
      const candidate = afterFirst("escapeTone", midi);
      if (candidate) found.push(candidate);
    }
  }

  // Appoggiatura: leap into a dissonance on the beat, then step down onto the
  // chord tone. The accent is the point, so the dissonance takes the longer half.
  if (
    allowed.has("appoggiatura") &&
    Math.abs(gap) >= 3 &&
    second.durationTick >= 2 &&
    isChordTone(second.midi, secondChord)
  ) {
    const midi = scaleStep(second.midi, 1, secondScale);
    if (midi !== null && inRange(midi) && !isChordTone(midi, secondChord)) {
      const head = Math.ceil(second.durationTick / 2);
      const tail = second.durationTick - head;
      if (head > 0 && tail > 0) {
        const leaned = makeNote(
          second,
          midi,
          second.startTick,
          head,
          ROLE_FOR_TYPE.appoggiatura,
          seed,
          "appoggiatura",
        );
        const resolved = { ...second, startTick: second.startTick + head, durationTick: tail };
        found.push({
          type: "appoggiatura",
          replacement: [first, leaned, resolved],
          consumed: 2,
          pattern: {
            type: "appoggiatura",
            preparation: first,
            dissonance: leaned,
            resolution: resolved,
          },
        });
      }
    }
  }

  // Enclosure: reach the target from above and below before landing on it.
  // It only means anything as a deliberate approach to a note being aimed at,
  // so it needs a leap into the target. Without that condition it fits at
  // almost every site and drowns out the ordinary figures.
  if (
    allowed.has("enclosure") &&
    Math.abs(gap) >= 3 &&
    first.durationTick >= 3 &&
    isChordTone(second.midi, secondChord)
  ) {
    const above = scaleStep(second.midi, 1, secondScale);
    const below = scaleStep(second.midi, -1, secondScale);
    if (above !== null && below !== null && inRange(above) && inRange(below)) {
      const unit = Math.floor(first.durationTick / 3);
      const head = first.durationTick - unit * 2;
      if (unit > 0 && head > 0) {
        const prepared = { ...first, durationTick: head };
        const upper = makeNote(
          first,
          above,
          first.startTick + head,
          unit,
          ROLE_FOR_TYPE.enclosure,
          seed,
          "enclosure-above",
        );
        const lower = makeNote(
          first,
          below,
          first.startTick + head + unit,
          unit,
          ROLE_FOR_TYPE.enclosure,
          seed,
          "enclosure-below",
        );
        found.push({
          type: "enclosure",
          replacement: [prepared, upper, lower],
          consumed: 1,
          pattern: {
            type: "enclosure",
            preparation: prepared,
            dissonance: upper,
            resolution: second,
          },
        });
      }
    }
  }

  return found;
}

export interface NonChordToneResult {
  notes: NoteEvent[];
  patterns: OrnamentPattern[];
}

/**
 * Ornaments a finished melody with non-chord-tone figures.
 *
 * A site is never ornamented twice: once a figure claims a note the scan moves
 * past everything it consumed, so figures cannot be nested into each other and
 * the resolution of one is never rewritten as the preparation of the next.
 */
export function applyNonChordTones(
  notes: readonly NoteEvent[],
  options: NonChordToneOptions,
): NonChordToneResult {
  const settings = options.settings;
  if (!settings?.enabled || notes.length < 2) {
    return { notes: [...notes], patterns: [] };
  }
  const rate = Math.min(1, Math.max(0, settings.rate ?? 0.5));
  const allowed = new Set<NonChordToneType>(settings.types ?? NON_CHORD_TONE_TYPES);
  if (allowed.size === 0 || rate === 0) {
    return { notes: [...notes], patterns: [] };
  }

  const out: NoteEvent[] = [];
  const patterns: OrnamentPattern[] = [];
  let index = 0;
  while (index < notes.length) {
    const first = notes[index] as NoteEvent;
    const second = notes[index + 1];
    if (!second) {
      out.push(first);
      index += 1;
      continue;
    }

    const random = createSeededRandom(deriveSeed(options.seed, "ncts-site", index));
    // Drawn before the candidates are examined, so whether a site is ornamented
    // does not depend on how many figures happen to fit there. Otherwise a site
    // with more options would be ornamented more often than the rate says.
    const ornamenting = random.next() < rate;
    const candidates = ornamenting ? candidateAt(first, second, options, allowed) : [];
    if (candidates.length === 0) {
      out.push(first);
      index += 1;
      continue;
    }

    const chosen = random.weightedPick(
      candidates,
      candidates.map((candidate) => FIGURE_WEIGHT[candidate.type]),
    );
    out.push(...chosen.replacement);
    patterns.push(chosen.pattern);
    index += chosen.consumed;
  }

  return { notes: out, patterns };
}

/** Counts the figures a melody was given, by type. */
export function summarizeOrnaments(
  patterns: readonly OrnamentPattern[],
): Record<NonChordToneType, number> {
  const counts = Object.fromEntries(
    NON_CHORD_TONE_TYPES.map((type) => [type, 0]),
  ) as Record<NonChordToneType, number>;
  for (const pattern of patterns) counts[pattern.type] += 1;
  return counts;
}
