import {
  PPQ,
  type ChordEvent,
  type NoteEvent,
  type NoteRole,
  type TimeSignature,
} from "../types/music";
import { midiToNoteName } from "./scales";
import { metricStrength, ticksPerBar } from "./time";

export interface MelodyQualityReport {
  noteCount: number;
  rangeSemitones: number;
  strongBeatNonChordTones: number;
  unexplainedNonChordTones: number;
  leapsLargerThanOctave: number;
  unrecoveredLeaps: number;
}

function normalizePitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function chordAtTick(
  chords: readonly ChordEvent[],
  tick: number,
): ChordEvent | undefined {
  return chords.find(
    (chord) => tick >= chord.startTick && tick < chord.startTick + chord.durationTick,
  );
}

export function isChordToneAtTick(
  midi: number,
  tick: number,
  chords: readonly ChordEvent[],
): boolean {
  const chord = chordAtTick(chords, tick);
  if (!chord) return false;
  const pitchClass = normalizePitchClass(midi);
  return chord.notes.some((note) => normalizePitchClass(note) === pitchClass);
}

function dissonanceRole(
  notes: readonly NoteEvent[],
  index: number,
  chords: readonly ChordEvent[],
  timeSignature: TimeSignature,
  ppq: number,
): Extract<NoteRole, "passing" | "neighbor"> | null {
  const current = notes[index];
  const previous = notes[index - 1];
  const next = notes[index + 1];
  if (!current || !previous || !next) return null;

  const localTick = current.startTick % ticksPerBar(timeSignature, ppq);
  // Ordinary passing and neighbour tones belong on a metrically weaker part of
  // the bar. Accented dissonances require their own explicit preparation rules
  // and are generated only by the non-chord-tone module.
  if (metricStrength(localTick, timeSignature, ppq) >= 0.68) return null;
  if (!isChordToneAtTick(previous.midi, previous.startTick, chords)) return null;
  if (!isChordToneAtTick(next.midi, next.startTick, chords)) return null;

  const into = current.midi - previous.midi;
  const out = next.midi - current.midi;
  if (Math.abs(into) > 2 || Math.abs(out) > 2 || into === 0 || out === 0) return null;
  if (Math.sign(into) === Math.sign(out)) return "passing";
  if (previous.midi === next.midi) return "neighbor";
  return null;
}

function chordToneCandidates(
  chord: ChordEvent,
  range: readonly [number, number],
  allowedPitches?: readonly number[],
): number[] {
  const [low, high] = range;
  const pitchClasses = new Set(chord.notes.map(normalizePitchClass));
  const allowed = allowedPitches ? new Set(allowedPitches) : null;
  const result: number[] = [];
  for (let midi = Math.ceil(low); midi <= Math.floor(high); midi += 1) {
    if (
      pitchClasses.has(normalizePitchClass(midi))
      && (!allowed || allowed.has(midi))
    ) {
      result.push(midi);
    }
  }
  return result;
}

function replacementScore(
  midi: number,
  original: NoteEvent,
  previous: NoteEvent | undefined,
  next: NoteEvent | undefined,
): number {
  let score = Math.abs(midi - original.midi) * 2;
  if (previous) {
    const distance = Math.abs(midi - previous.midi);
    score += distance * 0.45;
    if (distance > 12) score += 100 + (distance - 12) * 10;
  }
  if (next) score += Math.abs(next.midi - midi) * 0.25;
  return score;
}

function writeChordTone(note: NoteEvent, midi: number): void {
  note.midi = midi;
  note.noteName = midiToNoteName(midi);
  note.role = "chordTone";
}

/**
 * Removes accidental dissonance from the structural melody.
 *
 * A scale membership check is not enough: a scale tone can still clash with
 * the current chord. A non-chord tone survives only when it is a weak-beat,
 * stepwise passing or neighbour figure with consonant anchors. Everything else
 * is moved to the nearest sounding chord tone before optional, explicitly
 * prepared ornaments are added.
 */
export function repairUnpreparedMelodyDissonance(
  notes: readonly NoteEvent[],
  chords: readonly ChordEvent[],
  range: readonly [number, number],
  timeSignature: TimeSignature,
  ppq: number = PPQ,
  scaleForBar?: (barIndex: number) => readonly number[],
): NoteEvent[] {
  const repaired = notes
    .map((note) => ({ ...note }))
    .sort((left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id));

  const repairDissonances = (): void => {
    for (let index = 0; index < repaired.length; index += 1) {
      const note = repaired[index] as NoteEvent;
      if (isChordToneAtTick(note.midi, note.startTick, chords)) {
        note.role = "chordTone";
        continue;
      }

      const role = dissonanceRole(repaired, index, chords, timeSignature, ppq);
      if (role) {
        note.role = role;
        continue;
      }

      const chord = chordAtTick(chords, note.startTick);
      if (!chord) continue;
      const candidates = chordToneCandidates(chord, range, scaleForBar?.(note.barIndex));
      if (candidates.length === 0) continue;
      const previous = repaired[index - 1];
      const next = repaired[index + 1];
      const midi = candidates.reduce((best, candidate) =>
        replacementScore(candidate, note, previous, next)
          < replacementScore(best, note, previous, next)
          ? candidate
          : best,
      );
      writeChordTone(note, midi);
    }
  };

  const repairLeaps = (): void => {
    // A wider register is useful only when its leaps remain singable. Preserve a
    // fifth-or-larger leap when the next harmony offers a chord tone a step back
    // in the opposite direction. If it does not, tame the leap itself instead of
    // allowing the line to continue running away in the same direction.
    for (let index = 1; index < repaired.length - 1; index += 1) {
      const previous = repaired[index - 1] as NoteEvent;
      const current = repaired[index] as NoteEvent;
      const next = repaired[index + 1] as NoteEvent;
      const leap = current.midi - previous.midi;
      if (Math.abs(leap) < 7) continue;
      const recovery = next.midi - current.midi;
      if (
        recovery !== 0
        && Math.sign(recovery) !== Math.sign(leap)
        && Math.abs(recovery) <= 4
      ) {
        continue;
      }

      const nextChord = chordAtTick(chords, next.startTick);
      const nextCandidates = nextChord
        ? chordToneCandidates(nextChord, range, scaleForBar?.(next.barIndex))
        : [];
      const recoveryCandidates = nextCandidates.filter((midi) => {
        const delta = midi - current.midi;
        return (
          delta !== 0
          && Math.sign(delta) !== Math.sign(leap)
          && Math.abs(delta) <= 4
        );
      });
      if (Math.abs(leap) <= 12 && recoveryCandidates.length > 0) {
        const after = repaired[index + 2];
        const midi = recoveryCandidates.reduce((best, candidate) =>
          replacementScore(candidate, next, current, after)
            < replacementScore(best, next, current, after)
            ? candidate
            : best,
        );
        writeChordTone(next, midi);
        continue;
      }

      const currentChord = chordAtTick(chords, current.startTick);
      const currentCandidates = currentChord
        ? chordToneCandidates(currentChord, range, scaleForBar?.(current.barIndex))
        : [];
      const maximumTamedLeap = Math.abs(leap) > 12 ? 12 : 6;
      const tameCandidates = currentCandidates.filter(
        (midi) => Math.abs(midi - previous.midi) <= maximumTamedLeap,
      );
      if (tameCandidates.length > 0) {
        const midi = tameCandidates.reduce((best, candidate) =>
          replacementScore(candidate, current, previous, next)
            < replacementScore(best, current, previous, next)
            ? candidate
            : best,
        );
        writeChordTone(current, midi);
      }
    }

    const final = repaired.at(-1);
    const beforeFinal = repaired.at(-2);
    if (final && beforeFinal && Math.abs(final.midi - beforeFinal.midi) > 12) {
      const finalChord = chordAtTick(chords, final.startTick);
      const finalCandidates = finalChord
        ? chordToneCandidates(finalChord, range, scaleForBar?.(final.barIndex))
        : [];
      const tameFinal = finalCandidates.filter(
        (midi) => Math.abs(midi - beforeFinal.midi) <= 12,
      );
      if (tameFinal.length > 0) {
        const midi = tameFinal.reduce((best, candidate) =>
          replacementScore(candidate, final, beforeFinal, undefined)
            < replacementScore(best, final, beforeFinal, undefined)
            ? candidate
            : best,
        );
        writeChordTone(final, midi);
      }
    }
  };

  // The two constraints interact: repairing a leap can change a passing-tone
  // anchor, while replacing a dissonance can expose a new leap. A small bounded
  // relaxation converges for the short monophonic lines used here and remains
  // deterministic.
  for (let pass = 0; pass < 3; pass += 1) {
    repairDissonances();
    repairLeaps();
  }
  repairDissonances();
  // Last-resort octave placement preserves pitch class, harmony and scale.
  // This is preferable to changing the chosen chord member merely because two
  // independently repaired neighbours landed in distant octaves.
  for (let index = 1; index < repaired.length; index += 1) {
    const previous = repaired[index - 1] as NoteEvent;
    const note = repaired[index] as NoteEvent;
    while (note.midi - previous.midi > 12 && note.midi - 12 >= range[0]) {
      note.midi -= 12;
    }
    while (previous.midi - note.midi > 12 && note.midi + 12 <= range[1]) {
      note.midi += 12;
    }
    note.noteName = midiToNoteName(note.midi);
  }
  return repaired;
}

export function analyzeMelodyQuality(
  notes: readonly NoteEvent[],
  chords: readonly ChordEvent[],
  timeSignature: TimeSignature,
  ppq: number = PPQ,
): MelodyQualityReport {
  const ordered = [...notes].sort(
    (left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id),
  );
  let strongBeatNonChordTones = 0;
  let unexplainedNonChordTones = 0;
  let leapsLargerThanOctave = 0;
  let unrecoveredLeaps = 0;

  for (const [index, note] of ordered.entries()) {
    if (!isChordToneAtTick(note.midi, note.startTick, chords)) {
      const localTick = note.startTick % ticksPerBar(timeSignature, ppq);
      if (metricStrength(localTick, timeSignature, ppq) >= 0.68) {
        strongBeatNonChordTones += 1;
      }
      if (!dissonanceRole(ordered, index, chords, timeSignature, ppq)) {
        unexplainedNonChordTones += 1;
      }
    }

    const previous = ordered[index - 1];
    if (!previous) continue;
    const leap = note.midi - previous.midi;
    if (Math.abs(leap) > 12) leapsLargerThanOctave += 1;
    if (Math.abs(leap) < 7) continue;
    const next = ordered[index + 1];
    if (!next) continue;
    const recovery = next.midi - note.midi;
    if (
      recovery === 0
      || Math.sign(recovery) === Math.sign(leap)
      || Math.abs(recovery) > 4
    ) {
      unrecoveredLeaps += 1;
    }
  }

  const midis = ordered.map((note) => note.midi);
  return {
    noteCount: ordered.length,
    rangeSemitones: midis.length > 0 ? Math.max(...midis) - Math.min(...midis) : 0,
    strongBeatNonChordTones,
    unexplainedNonChordTones,
    leapsLargerThanOctave,
    unrecoveredLeaps,
  };
}
