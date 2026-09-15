import type { GeneratedComposition, NoteEvent } from "../types/music";
import type { CompositionTrack } from "./compositionTracks";
import type { ConcreteStylePresetId } from "./styles";
import { midiToNoteName } from "./scales";
import { sectionForBar } from "./sections";
import { applyGroove } from "./groove";

const BASS_ONSETS: Readonly<Record<ConcreteStylePresetId, readonly number[]>> = {
  pop: [0, 0.5, 0.75], "j-pop": [0, 0.5, 0.875], rock: [0, 0.25, 0.5, 0.75],
  jazz: [0, 0.25, 0.5, 0.75], "lo-fi": [0, 0.625], edm: [0, 0.375, 0.5, 0.875],
  ballad: [0, 0.5], "game-music": [0, 0.5, 0.75],
};

/**
 * Groove a polyphonic performance voice by voice. Applying the monophonic
 * groove function to a chord would shorten simultaneous notes to one tick.
 */
export function groovePolyphonicNotes(notes: readonly NoteEvent[], composition: GeneratedComposition): NoteEvent[] {
  if (!composition.settings.groove?.enabled) return [...notes];
  const byPitch = new Map<number, NoteEvent[]>();
  for (const note of notes) {
    const group = byPitch.get(note.midi) ?? [];
    group.push(note);
    byPitch.set(note.midi, group);
  }
  return [...byPitch.values()].flatMap((voice) => applyGroove(
    [...voice].sort((a, b) => a.startTick - b.startTick),
    { timeSignature: composition.timeSignature, settings: composition.settings.groove!, ppq: composition.ppq },
  )).sort((a, b) => a.startTick - b.startTick || a.midi - b.midi || a.id.localeCompare(b.id));
}

function bassLine(composition: GeneratedComposition, source: readonly NoteEvent[]): NoteEvent[] {
  const notes: NoteEvent[] = [];
  const barTicks = composition.ticksPerBar;
  for (const [chordIndex, chord] of composition.chords.entries()) {
    const originals = source.filter((note) => note.startTick === chord.startTick);
    if (originals.length === 0) continue;
    const bottom = originals.reduce((a, b) => a.midi < b.midi ? a : b);
    const kind = sectionForBar(composition.sections, Math.floor(chord.startTick / barTicks))?.kind;
    const quiet = kind === "intro" || kind === "outro" || kind === "quietChorus";
    const shape = quiet ? [0] : BASS_ONSETS[composition.resolvedStyle];
    const end = chord.startTick + chord.durationTick;
    const onsets = new Set<number>([chord.startTick]);
    for (let bar = Math.floor(chord.startTick / barTicks); bar * barTicks < end; bar += 1) {
      for (const offset of shape) {
        const tick = bar * barTicks + Math.round(offset * barTicks);
        if (tick >= chord.startTick && tick < end && (tick === chord.startTick || end - tick >= composition.ppq / 4)) onsets.add(tick);
      }
    }
    const ticks = [...onsets].sort((a, b) => a - b);
    for (const [index, tick] of ticks.entries()) {
      let midi = bottom.midi;
      if (index > 0 && composition.resolvedStyle === "jazz") {
        // A chord-tone bass, never an unlabelled chromatic approach to an unknown target.
        const pcs = [...new Set(chord.notes.map((pitch) => pitch % 12))];
        const wanted = pcs[index % pcs.length]!;
        const candidates = Array.from({ length: 25 }, (_, n) => bottom.midi - 12 + n)
          .filter((pitch) => pitch >= 24 && pitch <= 55 && pitch % 12 === wanted);
        if (candidates.length > 0) midi = candidates.reduce((a, b) => Math.abs(a - bottom.midi) < Math.abs(b - bottom.midi) ? a : b);
      } else if (index % 2 === 1 && (composition.resolvedStyle === "edm" || composition.resolvedStyle === "game-music") && bottom.midi + 12 <= 55) {
        midi += 12;
      }
      const next = ticks[index + 1] ?? end;
      const gate = quiet || composition.resolvedStyle === "ballad" ? 0.96 : composition.resolvedStyle === "edm" ? 0.68 : 0.84;
      notes.push({
        ...bottom, id: `${chord.id}-bass-phrase-${index}`, midi, noteName: midiToNoteName(midi),
        startTick: tick, durationTick: Math.max(1, Math.round((next - tick) * gate)),
        barIndex: Math.floor(tick / barTicks),
        velocity: Math.max(1, Math.round(bottom.velocity * (index === 0 ? 1 : index % 2 === 0 ? 0.92 : 0.8))),
      });
    }
    // Retain an explicit left-hand assignment even under a driving bass figure.
    // Quiet textures can also retain any shell already present in the project.
    if (composition.settings.bassRegister?.shell || quiet || composition.resolvedStyle === "ballad" || composition.resolvedStyle === "lo-fi") {
      for (const note of originals) {
        if (note === bottom) continue;
        notes.push({ ...note, id: `${note.id}-phrase-shell-${chordIndex}`, velocity: Math.max(1, Math.round(note.velocity * 0.7)) });
      }
    }
  }
  return notes.sort((a, b) => a.startTick - b.startTick || a.midi - b.midi);
}

/** The accompaniment leaves room for the lead and changes texture by section. */
export function arrangePhraseTracks(tracks: readonly CompositionTrack[], composition: GeneratedComposition): CompositionTrack[] {
  if (!composition.settings.melody.phraseDesign) return [...tracks];
  return tracks.map((track) => {
    // Countermelody and canon inherit their timing from the performed lead.
    if (track.role === "melody" || track.role === "countermelody" || track.role === "canon") return track;
    let notes = track.role === "bass" ? bassLine(composition, track.notes) : [...track.notes];
    if (track.role === "chords") {
      notes = notes.map((note) => {
        const section = sectionForBar(composition.sections, note.barIndex);
        const lead = composition.notes.find((melody) => melody.startTick < note.startTick + composition.ppq / 4
          && melody.startTick + melody.durationTick > note.startTick);
        // Interior voices sit behind the melody. Retain voicings and harmony;
        // the answer is dynamics and articulation, not extra competing notes.
        const crowded = lead && note.midi >= lead.midi - 5;
        const sparse = section?.kind === "verse" || section?.kind === "quietChorus" || section?.kind === "intro";
        return {
          ...note,
          velocity: composition.settings.dynamics?.enabled
            ? Math.max(1, Math.round(note.velocity * (crowded ? 0.82 : sparse ? 0.88 : 1)))
            : note.velocity,
          durationTick: Math.max(1, Math.round(note.durationTick * (composition.resolvedStyle === "edm" ? 0.72 : 0.96))),
        };
      });
    }
    notes = groovePolyphonicNotes(notes, composition);
    return { ...track, notes };
  });
}
