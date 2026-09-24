import type {
  ChordEvent,
  ChordQuality,
  NoteEvent,
  Tension,
  TimeSignature,
} from "../types/music";
import { ticksPerBar, ticksPerBeat } from "./time";

export type TheoryProfile = "strictSpecies" | "tonal" | "jazz";
export type TheorySeverity = "error" | "warning" | "info";

/** A monophonic line. Parts are bass-to-treble by default when two are given. */
export interface TheoryPart {
  id: string;
  notes: readonly NoteEvent[];
  /** Optional inclusive MIDI range; this app defaults to its 88-key piano span. */
  range?: readonly [lowMidi: number, highMidi: number];
  /** Override the default bass-to-treble part order for crossing checks. */
  register?: "lower" | "upper";
}

export interface EvaluateTheoryOptions {
  chords: readonly ChordEvent[];
  parts: readonly TheoryPart[];
  timeSignature: TimeSignature;
  ppq: number;
  profile: TheoryProfile;
}

export interface TheoryDiagnostic {
  ruleId: string;
  tick: number;
  voiceIds: string[];
  severity: TheorySeverity;
  message: string;
}

interface TimedChord {
  chord: ChordEvent;
  start: number;
  end: number;
}

interface TimedNote {
  part: TheoryPart;
  note: NoteEvent;
  start: number;
  end: number;
}

const QUALITY_INTERVALS: Readonly<Record<ChordQuality, readonly number[]>> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  halfDiminished7: [0, 3, 6, 10],
  diminished7: [0, 3, 6, 9],
  minorMajor7: [0, 3, 7, 11],
  augmentedMajor7: [0, 4, 8, 11],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 2, 4, 7],
  minorAdd9: [0, 2, 3, 7],
};

const TENSION_INTERVALS: Readonly<Record<Tension, number>> = {
  "6": 9,
  "9": 2,
  b9: 1,
  "#9": 3,
  "11": 5,
  "#11": 6,
  "13": 9,
  b13: 8,
};

const modulo12 = (pitch: number): number => ((pitch % 12) + 12) % 12;

function chordPitchClasses(chord: ChordEvent): ReadonlySet<number> {
  const root = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"].indexOf(chord.root);
  const pitches = new Set<number>();
  if (root < 0) return pitches;
  for (const interval of QUALITY_INTERVALS[chord.quality]) {
    pitches.add(modulo12(root + interval));
  }
  for (const tension of chord.tensions ?? []) {
    pitches.add(modulo12(root + TENSION_INTERVALS[tension]));
  }
  return pitches;
}

function isChordTone(midi: number, chord: ChordEvent | undefined): boolean {
  return chord !== undefined && chordPitchClasses(chord).has(modulo12(midi));
}

function chordAt(chords: readonly TimedChord[], tick: number): TimedChord | undefined {
  // Chord timelines are half-open: a change at tick T belongs to the new chord.
  return chords.find(({ start, end }) => tick >= start && tick < end);
}

function activeNotesAt(notes: readonly TimedNote[], tick: number): TimedNote[] {
  return notes.filter(({ start, end }) => tick >= start && tick < end);
}

function strongOffsets(signature: TimeSignature, ppq: number): readonly number[] {
  if (signature === "3/4") return [0];
  // The two dotted-quarter pulses in 6/8 and beats one/three in 4/4.
  return [0, signature === "6/8" ? ticksPerBeat(signature, ppq) : 2 * ppq];
}

function isStrongBeat(tick: number, signature: TimeSignature, ppq: number): boolean {
  const duration = ticksPerBar(signature, ppq);
  const withinBar = ((tick % duration) + duration) % duration;
  return strongOffsets(signature, ppq).includes(withinBar);
}

function intervalClass(left: number, right: number): number {
  return modulo12(Math.abs(left - right));
}

const CONSONANT_INTERVAL_CLASSES = new Set([0, 3, 4, 7, 8, 9]);

function isConsonantCounterpointInterval(left: number, right: number): boolean {
  return CONSONANT_INTERVAL_CLASSES.has(intervalClass(left, right));
}

type Ornament = "passing" | "neighbor" | null;

function classifyWeakOrnament(note: TimedNote, notes: readonly TimedNote[]): Ornament {
  const previous = notes
    .filter((candidate) => candidate.part.id === note.part.id && candidate.end === note.start)
    .sort((a, b) => a.start - b.start)
    .at(-1);
  const next = notes
    .filter((candidate) => candidate.part.id === note.part.id && candidate.start === note.end)
    .sort((a, b) => a.end - b.end)[0];
  if (!previous || !next) return null;

  const incoming = note.note.midi - previous.note.midi;
  const outgoing = next.note.midi - note.note.midi;
  if (Math.abs(incoming) > 2 || Math.abs(outgoing) > 2 || incoming === 0 || outgoing === 0) return null;
  if (Math.sign(incoming) === Math.sign(outgoing)) return "passing";
  if (next.note.midi === previous.note.midi) return "neighbor";
  return null;
}

function isPreparedSuspension(
  held: TimedNote,
  tick: number,
  partNotes: readonly TimedNote[],
  chords: readonly TimedChord[],
): boolean {
  if (!(held.start < tick && held.end > tick)) return false;
  const previousTimedChord = chordAt(chords, tick - 1);
  const currentTimedChord = chordAt(chords, tick);
  const previousChord = previousTimedChord?.chord;
  const currentChord = currentTimedChord?.chord;
  if (!previousChord || !currentChord || previousTimedChord === currentTimedChord) return false;
  if (!isChordTone(held.note.midi, previousChord)) return false;

  const resolution = partNotes.find(
    (candidate) => candidate.part.id === held.part.id && candidate.start === held.end,
  );
  if (!resolution) return false;
  const downwardStep = held.note.midi - resolution.note.midi;
  return downwardStep > 0 && downwardStep <= 2 && isChordTone(resolution.note.midi, chordAt(chords, resolution.start)?.chord);
}

function severityFor(profile: TheoryProfile, ruleId: string): TheorySeverity {
  if (profile === "strictSpecies") return "error";
  if (profile === "jazz" && ruleId === "CP-PARALLEL") return "info";
  return "warning";
}

function isParallelPerfect(previous: readonly number[], current: readonly number[]): boolean {
  if (previous.length !== 2 || current.length !== 2) return false;
  const [oldLower, oldUpper] = previous;
  const [newLower, newUpper] = current;
  if (oldLower === undefined || oldUpper === undefined || newLower === undefined || newUpper === undefined) return false;
  const lowMotion = newLower - oldLower;
  const highMotion = newUpper - oldUpper;
  const oldInterval = intervalClass(oldLower, oldUpper);
  const newInterval = intervalClass(newLower, newUpper);
  const perfect = (interval: number) => interval === 0 || interval === 7;
  return lowMotion !== 0 && highMotion !== 0 && Math.sign(lowMotion) === Math.sign(highMotion) &&
    perfect(oldInterval) && oldInterval === newInterval;
}

function orderedPair(
  active: readonly TimedNote[],
  parts: readonly TheoryPart[],
): readonly [TimedNote, TimedNote] | undefined {
  if (active.length < 2 || parts.length < 2) return undefined;
  const first = parts[0];
  const second = parts[1];
  if (!first || !second) return undefined;
  const firstNote = active.find((entry) => entry.part.id === first.id);
  const secondNote = active.find((entry) => entry.part.id === second.id);
  if (!firstNote || !secondNote) return undefined;
  const firstIsLower = first.register && second.register
    ? first.register === "lower"
    : first.register
      ? first.register === "lower"
      : second.register
        ? second.register === "upper"
        : true;
  return firstIsLower ? [firstNote, secondNote] : [secondNote, firstNote];
}

/**
 * Evaluate one or two monophonic integer-tick lines against a chord timeline.
 *
 * The sweep contains every note onset/release, every chord boundary, and each
 * profile-relevant strong beat. Notes are sampled as half-open intervals, so a
 * held note remains active when the chord changes beneath it. Chord membership
 * is computed from root + actual quality + declared tensions (including sus
 * tones and sixths), not from the current voicing's incomplete note list.
 */
export function evaluateTheory(options: EvaluateTheoryOptions): TheoryDiagnostic[] {
  const { chords, parts, timeSignature, ppq, profile } = options;
  if (!Number.isInteger(ppq) || ppq <= 0) throw new RangeError("ppq must be a positive integer.");
  if (parts.length === 0 || parts.length > 2) throw new RangeError("Theory evaluation requires one or two parts.");

  const timedChords = [...chords]
    .filter((chord) => Number.isInteger(chord.startTick) && Number.isInteger(chord.durationTick) && chord.durationTick > 0)
    .map((chord) => ({ chord, start: chord.startTick, end: chord.startTick + chord.durationTick }))
    .sort((a, b) => a.start - b.start);
  const timedNotes = parts.flatMap((part) => part.notes
    .filter((note) => Number.isInteger(note.startTick) && Number.isInteger(note.durationTick) && note.durationTick > 0)
    .map((note) => ({ part, note, start: note.startTick, end: note.startTick + note.durationTick })))
    .sort((a, b) => a.start - b.start || a.part.id.localeCompare(b.part.id));

  const diagnostics: TheoryDiagnostic[] = [];
  const seen = new Set<string>();
  const add = (ruleId: string, tick: number, voiceIds: string[], message: string, severity?: TheorySeverity) => {
    const orderedIds = [...new Set(voiceIds)].sort();
    const key = `${ruleId}:${tick}:${orderedIds.join(",")}`;
    if (seen.has(key)) return;
    seen.add(key);
    diagnostics.push({ ruleId, tick, voiceIds: orderedIds, severity: severity ?? severityFor(profile, ruleId), message });
  };

  for (const timed of timedNotes) {
    const [defaultLow, defaultHigh] = timed.part.range ?? [21, 108];
    if (timed.note.midi < defaultLow || timed.note.midi > defaultHigh) {
      add("VL-INDEPENDENCE", timed.start, [timed.part.id], `MIDI ${timed.note.midi} is outside this voice's ${defaultLow}–${defaultHigh} range.`, "error");
    }
  }

  const maxTick = Math.max(0, ...timedChords.map(({ end }) => end), ...timedNotes.map(({ end }) => end));
  const boundaries = new Set<number>([0, maxTick]);
  for (const { start, end } of timedChords) { boundaries.add(start); boundaries.add(end); }
  for (const { start, end } of timedNotes) { boundaries.add(start); boundaries.add(end); }
  const chordChangeTicks = new Set(timedChords.map(({ start }) => start));
  const bar = ticksPerBar(timeSignature, ppq);
  const offsets = strongOffsets(timeSignature, ppq);
  for (let base = 0; base <= maxTick; base += bar) {
    for (const offset of offsets) {
      const tick = base + offset;
      if (tick <= maxTick) boundaries.add(tick);
    }
  }
  const orderedTicks = [...boundaries].sort((a, b) => a - b);

  for (const tick of orderedTicks) {
    const active = activeNotesAt(timedNotes, tick);
    const pair = orderedPair(active, parts);
    const strongBeat = isStrongBeat(tick, timeSignature, ppq);
    const chordChange = chordChangeTicks.has(tick);

    if (pair) {
      if (pair[0].note.midi > pair[1].note.midi) {
        add("VL-INDEPENDENCE", tick, [pair[0].part.id, pair[1].part.id], "The lower and upper voices cross at this tick.");
      }

      const previousActive = activeNotesAt(timedNotes, tick - 1);
      const previousOrdered = orderedPair(previousActive, parts);
      const bothBeginNow = pair[0].start === tick && pair[1].start === tick;
      if (bothBeginNow && previousOrdered && isParallelPerfect(
        [previousOrdered[0].note.midi, previousOrdered[1].note.midi],
        [pair[0].note.midi, pair[1].note.midi],
      )) {
        const interval = intervalClass(pair[0].note.midi, pair[1].note.midi);
        add("CP-PARALLEL", tick, [pair[0].part.id, pair[1].part.id], interval === 0
          ? "Both voices move in the same direction into a perfect octave or unison."
          : "Both voices move in the same direction into a perfect fifth.");
      }

      if ((strongBeat || chordChange) && profile === "strictSpecies") {
        const sustainedSuspension = pair.some((entry) => isPreparedSuspension(entry, tick, timedNotes, timedChords));
        if (!sustainedSuspension && !isConsonantCounterpointInterval(pair[0].note.midi, pair[1].note.midi)) {
          add("CP-1", tick, [pair[0].part.id, pair[1].part.id], "The sounding vertical interval is dissonant at a structural point in strict counterpoint.");
        }
      }
    }

    const structuralTick = strongBeat || chordChange;
    const weakOnsetTick = active.some((sounding) => sounding.start === tick && !structuralTick);
    if (!structuralTick && !weakOnsetTick) continue;
    const activeChord = chordAt(timedChords, tick)?.chord;
    if (!activeChord) continue;

    for (const sounding of active) {
      const heldAcrossChange = chordChange && sounding.start < tick;
      const weakOnset = sounding.start === tick && !structuralTick;
      if (!structuralTick && !heldAcrossChange && !weakOnset) continue;
      if (isChordTone(sounding.note.midi, activeChord)) continue;
      if (isPreparedSuspension(sounding, tick, timedNotes, timedChords)) continue;

      if (heldAcrossChange) {
        add("CP-4", tick, [sounding.part.id], "A held dissonance crosses a chord change but is not prepared and resolved downward by step.");
        continue;
      }

      const ornament = weakOnset ? classifyWeakOrnament(sounding, timedNotes) : null;
      if (ornament === "passing") continue;
      if (ornament === "neighbor") {
        if (profile === "strictSpecies") {
          add("CP-3", tick, [sounding.part.id], "A stepwise neighbor is recognizable, but needs third-species context rather than a strict second-species pass.");
        }
        continue;
      }

      const ruleId = weakOnset ? "CP-2" : profile === "jazz" ? "J-MELODY" : "CP-1";
      add(ruleId, tick, [sounding.part.id], `MIDI ${sounding.note.midi} is not a tone of ${activeChord.symbol} on a structural beat or chord change.`);
    }
  }

  return diagnostics.sort((a, b) => a.tick - b.tick || a.ruleId.localeCompare(b.ruleId) || a.voiceIds.join(",").localeCompare(b.voiceIds.join(",")));
}
