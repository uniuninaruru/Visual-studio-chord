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
  if (bass && chords) {
    for (const bassNote of bass.notes) {
      const right = chords.notes
        .filter((note) => note.startTick === bassNote.startTick)
        .sort((left, rightNote) => left.midi - rightNote.midi);
      const lowestRight = right[0];
      if (!lowestRight) continue;
      const gap = lowestRight.midi - bassNote.midi;
      if (gap <= 0) {
        issues.push({
          type: "handCrossing",
          severity: "error",
          trackId: chords.id,
          tick: bassNote.startTick,
          message: "Right-hand chord crossed below the left-hand bass.",
        });
      } else if (lowestRight.midi < 52 && gap < 7) {
        issues.push({
          type: "lowRegisterCluster",
          severity: "warning",
          trackId: chords.id,
          tick: bassNote.startTick,
          message: "Low-register chord tones are tightly spaced and may sound muddy.",
        });
      }
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
