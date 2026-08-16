import type { GeneratedComposition, NoteEvent } from "../types/music";
import { buildCompositionTracks } from "./compositionTracks";
import { findCounterpointIssues } from "./counterpoint";
import { analyzeMelodyQuality } from "./melodicQuality";

export type ArrangementIssueType =
  | "outOfPianoRange"
  | "handCrossing"
  | "lowRegisterCluster"
  | "unpreparedMelodyDissonance"
  | "counterpoint"
  | "canonClash";

export interface ArrangementQualityIssue {
  type: ArrangementIssueType;
  severity: "warning" | "error";
  trackId: string;
  tick: number;
  message: string;
}

export interface ArrangementQualityReport {
  trackCount: number;
  noteCount: number;
  issues: ArrangementQualityIssue[];
  errors: number;
  warnings: number;
}

const CONSONANT = new Set([0, 3, 4, 7, 8, 9]);

function soundingAt(notes: readonly NoteEvent[], tick: number): NoteEvent | undefined {
  return notes.find(
    (note) => tick >= note.startTick && tick < note.startTick + note.durationTick,
  );
}

/**
 * Checks the rendered arrangement, not isolated generators.
 *
 * This is the final "all faders up" gate: canonical chord data is split into
 * its left/right-hand tracks, optional voices are included, and failures name
 * the track and tick a diagnostics screen can point to.
 */
export function analyzeArrangementQuality(
  composition: GeneratedComposition,
): ArrangementQualityReport {
  const tracks = buildCompositionTracks(composition);
  const issues: ArrangementQualityIssue[] = [];

  for (const track of tracks) {
    for (const note of track.notes) {
      if (note.midi < 21 || note.midi > 108) {
        issues.push({
          type: "outOfPianoRange",
          severity: "error",
          trackId: track.id,
          tick: note.startTick,
          message: `${track.name}: ${note.noteName} is outside the 88-key piano range.`,
        });
      }
    }
  }

  const bass = tracks.find((track) => track.id === "track-bass");
  const chords = tracks.find((track) => track.id === "track-chords");
  /*
   * The hands may overlap; they may not swap.
   *
   * This compared every left-hand note against the lowest right-hand note and
   * called anything at or above it a crossing. With a one-note left hand the two
   * rules are indistinguishable, and while the left hand was one note that is
   * what this was: a test that the bass is the bass.
   *
   * They are not the same rule, and a left hand holding a shell shows the
   * difference. A tenth in the left hand sits above the bottom of the right
   * hand -- that is what reaching a tenth means -- and the corpus study behind
   * this app's own hand-span bound lets the two hands overlap in pitch without
   * restriction. Applying the old rule to a shell produced 73 crossing errors in
   * nine pieces, every one of them a left hand doing what a left hand does.
   *
   * What actually has to hold is two things: the lowest note of the texture is
   * the left hand's (the bass is the bass), and the left hand does not end up
   * over the top of the right (the hands have not swapped roles). Everything
   * between those is a hand position, not a fault.
   */
  if (bass && chords) {
    const byTick = new Map<number, { left: NoteEvent[]; right: NoteEvent[] }>();
    for (const note of bass.notes) {
      const entry = byTick.get(note.startTick) ?? { left: [], right: [] };
      entry.left.push(note);
      byTick.set(note.startTick, entry);
    }
    for (const note of chords.notes) {
      const entry = byTick.get(note.startTick);
      if (entry) entry.right.push(note);
    }
    for (const [tick, entry] of byTick) {
      if (entry.left.length === 0 || entry.right.length === 0) continue;
      const leftPitches = entry.left.map((note) => note.midi);
      const rightPitches = entry.right.map((note) => note.midi);
      const lowestLeft = Math.min(...leftPitches);
      const highestLeft = Math.max(...leftPitches);
      const lowestRight = Math.min(...rightPitches);

      if (lowestRight <= lowestLeft) {
        issues.push({
          type: "handCrossing",
          severity: "error",
          trackId: chords.id,
          tick,
          message: "Right-hand chord reaches below the left-hand bass.",
        });
      } else if (lowestRight < 52 && lowestRight - highestLeft < 7 && entry.left.length === 1) {
        // Only judged where the left hand is a single note. A shell already
        // fills this register on purpose, and the interval it fills it with was
        // chosen against the low interval limits.
        issues.push({
          type: "lowRegisterCluster",
          severity: "warning",
          trackId: chords.id,
          tick,
          message: "Low-register chord tones are tightly spaced and may sound muddy.",
        });
      }
    }
  }

  /*
   * Whether the hands have swapped is a property of the voicing, not of the
   * instant.
   *
   * Checked on the rendered tracks it fired 24 times in nine pieces, every one
   * of them a moment where the comping figure happened to be striking only the
   * lower part of the right hand -- so the highest note SOUNDING was the left
   * hand's, while the hand was still positioned underneath. The figure choosing
   * which voices land on which beat is a rhythm decision; it does not move
   * anybody's hand.
   */
  for (const chord of composition.chords) {
    const left = chord.leftHand;
    if (!left || left.length === 0) continue;
    const right = chord.notes.filter((note) => !left.includes(note));
    if (right.length === 0) continue;
    if (Math.max(...left) >= Math.max(...right)) {
      issues.push({
        type: "handCrossing",
        severity: "error",
        trackId: "track-chords",
        tick: chord.startTick,
        message: "Left hand sits over the top of the right-hand chord.",
      });
    }
  }

  const melody = analyzeMelodyQuality(
    composition.notes,
    composition.chords,
    composition.timeSignature,
    composition.ppq,
  );
  for (let index = 0; index < melody.unexplainedNonChordTones; index += 1) {
    issues.push({
      type: "unpreparedMelodyDissonance",
      severity: "error",
      trackId: "track-melody",
      tick: 0,
      message: "Melody contains a non-chord tone without a verified preparation and resolution.",
    });
  }

  for (const voice of composition.voices ?? []) {
    if (voice.role === "countermelody") {
      const below = composition.settings.arrangement?.counterpoint?.position !== "above";
      const counterpointIssues = findCounterpointIssues(
        below ? voice.notes : composition.notes,
        below ? composition.notes : voice.notes,
      );
      for (const issue of counterpointIssues) {
        issues.push({
          type: "counterpoint",
          severity: "error",
          trackId: `track-${voice.id}`,
          tick: voice.notes[issue.index]?.startTick ?? 0,
          message: `Counterpoint ${issue.type} at interval ${issue.interval}.`,
        });
      }
    }

    if (voice.role === "canon") {
      for (const note of voice.notes) {
        const lead = soundingAt(composition.notes, note.startTick);
        if (!lead) continue;
        const interval = Math.abs(note.midi - lead.midi) % 12;
        if (CONSONANT.has(interval)) continue;
        issues.push({
          type: "canonClash",
          severity: "error",
          trackId: `track-${voice.id}`,
          tick: note.startTick,
          message: `Canon clashes with the melody at interval class ${interval}.`,
        });
      }
    }
  }

  return {
    trackCount: tracks.length,
    noteCount: tracks.reduce((sum, track) => sum + track.notes.length, 0),
    issues,
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
  };
}
