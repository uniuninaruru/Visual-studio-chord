import { Midi } from "@tonejs/midi";
import type { GeneratedComposition } from "../../types/music";

export interface MidiExportOptions {
  name?: string;
  includeChords?: boolean;
  includeMelody?: boolean;
  chordVelocity?: number;
}

function clampVelocity(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function midiVelocity(value: number): number {
  return clampVelocity(value / 127);
}

function parseTimeSignature(signature: GeneratedComposition["timeSignature"]): [number, number] {
  const parts = signature.split("/");
  return [Number(parts[0] ?? 4), Number(parts[1] ?? 4)];
}

/** Exports tick-accurate chord and melody tracks as a Standard MIDI File. */
export function exportCompositionMidi(
  composition: GeneratedComposition,
  options: MidiExportOptions = {},
): Uint8Array {
  const midi = new Midi();
  const name = options.name?.trim() || "Visual studio chord";
  const includeChords = options.includeChords ?? true;
  const includeMelody = options.includeMelody ?? true;
  const chordVelocity = clampVelocity(options.chordVelocity ?? 0.62);
  const tickRatio = midi.header.ppq / composition.ppq;

  midi.header.name = name;
  midi.header.setTempo(composition.settings.bpm);
  midi.header.timeSignatures.push({
    ticks: 0,
    timeSignature: parseTimeSignature(composition.timeSignature),
    measures: 0,
  });

  if (includeChords) {
    const chordTrack = midi.addTrack();
    chordTrack.name = "Chords";
    chordTrack.channel = 0;
    for (const chord of composition.chords) {
      for (const note of chord.notes) {
        chordTrack.addNote({
          midi: note,
          ticks: Math.round(chord.startTick * tickRatio),
          durationTicks: Math.max(1, Math.round(chord.durationTick * tickRatio)),
          velocity: chordVelocity,
        });
      }
    }
  }

  if (includeMelody) {
    const melodyTrack = midi.addTrack();
    melodyTrack.name = "Melody";
    melodyTrack.channel = 1;
    for (const note of composition.notes) {
      melodyTrack.addNote({
        midi: note.midi,
        ticks: Math.round(note.startTick * tickRatio),
        durationTicks: Math.max(1, Math.round(note.durationTick * tickRatio)),
        velocity: midiVelocity(note.velocity),
      });
    }
  }

  return midi.toArray();
}

export function midiBlob(composition: GeneratedComposition, options?: MidiExportOptions): Blob {
  const bytes = exportCompositionMidi(composition, options);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: "audio/midi" });
}
