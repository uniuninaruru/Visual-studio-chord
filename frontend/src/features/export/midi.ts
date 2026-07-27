import { Midi } from "@tonejs/midi";
import { buildCompositionTracks } from "../../music/compositionTracks";
import type { GeneratedComposition } from "../../types/music";

export interface MidiExportOptions {
  name?: string;
  includeChords?: boolean;
  includeMelody?: boolean;
  includeAdditionalVoices?: boolean;
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
  const includeAdditionalVoices = options.includeAdditionalVoices ?? true;
  const chordVelocity = clampVelocity(options.chordVelocity ?? 0.62);
  const tickRatio = midi.header.ppq / composition.ppq;
  const tracks = buildCompositionTracks(composition);

  midi.header.name = name;
  midi.header.setTempo(composition.settings.bpm);
  midi.header.timeSignatures.push({
    ticks: 0,
    timeSignature: parseTimeSignature(composition.timeSignature),
    measures: 0,
  });

  if (includeChords) {
    for (const source of tracks.slice(0, 2)) {
      const chordTrack = midi.addTrack();
      chordTrack.name = source.name;
      chordTrack.channel = source.midiChannel;
      for (const note of source.notes) {
        chordTrack.addNote({
          midi: note.midi,
          ticks: Math.round(note.startTick * tickRatio),
          durationTicks: Math.max(1, Math.round(note.durationTick * tickRatio)),
          velocity: chordVelocity,
        });
      }
    }
  }

  if (includeMelody) {
    const melodyTrack = midi.addTrack();
    melodyTrack.name = "Melody";
    melodyTrack.channel = 2;
    for (const note of composition.notes) {
      melodyTrack.addNote({
        midi: note.midi,
        ticks: Math.round(note.startTick * tickRatio),
        durationTicks: Math.max(1, Math.round(note.durationTick * tickRatio)),
        velocity: midiVelocity(note.velocity),
      });
    }
  }

  if (includeAdditionalVoices) {
    for (const voice of tracks.slice(3)) {
      const track = midi.addTrack();
      track.name = voice.name;
      track.channel = voice.midiChannel;
      for (const note of voice.notes) {
        track.addNote({
          midi: note.midi,
          ticks: Math.round(note.startTick * tickRatio),
          durationTicks: Math.max(1, Math.round(note.durationTick * tickRatio)),
          velocity: midiVelocity(note.velocity),
        });
      }
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
