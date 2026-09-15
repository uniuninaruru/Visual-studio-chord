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
  const chordVelocity = options.chordVelocity === undefined
    ? undefined
    : clampVelocity(options.chordVelocity);
  const tickRatio = midi.header.ppq / composition.ppq;
  const tracks = buildCompositionTracks(composition);

  midi.header.name = name;
  midi.header.setTempo(composition.settings.bpm);
  midi.header.timeSignatures.push({
    ticks: 0,
    timeSignature: parseTimeSignature(composition.timeSignature),
    measures: 0,
  });

  // Playback and export consume the same performance: groove, articulation,
  // voicing and section dynamics must survive the trip to a DAW.
  for (const source of tracks) {
    const accompaniment = source.role === "bass" || source.role === "chords";
    if (accompaniment ? !includeChords : source.role === "melody" ? !includeMelody : !includeAdditionalVoices) continue;
    const track = midi.addTrack();
    track.name = source.name;
    track.channel = source.midiChannel;
    for (const note of source.notes) {
      track.addNote({
        midi: note.midi,
        ticks: Math.round(note.startTick * tickRatio),
        durationTicks: Math.max(1, Math.round(note.durationTick * tickRatio)),
        velocity: accompaniment && chordVelocity !== undefined ? chordVelocity : midiVelocity(note.velocity),
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
