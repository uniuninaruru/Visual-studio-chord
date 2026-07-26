import type {
  ChordEvent,
  CompositionVoice,
  GeneratorSettings,
  NoteEvent,
  SectionEvent,
} from "../types/music";
import { generateCanon, generateCountermelody } from "./counterpoint";
import { polyrhythmSlots } from "./polyrhythm";
import { deriveSeed, hashSeed } from "./random";
import { getMelodyScaleMidiNotes, midiToNoteName } from "./scales";

interface ArrangementOptions {
  settings: GeneratorSettings;
  melody: readonly NoteEvent[];
  chords: readonly ChordEvent[];
  sections?: readonly SectionEvent[];
  totalTicks: number;
  ticksPerBar: number;
  ppq: number;
}

function sectionForBar(
  sections: readonly SectionEvent[] | undefined,
  barIndex: number,
): SectionEvent | undefined {
  return sections?.find(
    (section) => barIndex >= section.startBar && barIndex < section.endBar,
  );
}

function pulsePitch(chord: ChordEvent | undefined): number {
  let midi = chord?.notes[0] ?? 48;
  while (midi > 55) midi -= 12;
  while (midi < 36) midi += 12;
  return midi;
}

function buildPulseNotes(options: ArrangementOptions): NoteEvent[] {
  const settings = options.settings.arrangement?.polyrhythm;
  if (!settings?.enabled) return [];
  const spanBars = Math.max(1, Math.trunc(settings.spanBars ?? 1));
  const notes: NoteEvent[] = [];

  for (let startBar = 0; startBar < options.settings.bars; startBar += spanBars) {
    const slots = polyrhythmSlots({
      timeSignature: options.settings.timeSignature,
      startBar,
      ppq: options.ppq,
      settings: {
        enabled: true,
        pulses: settings.pulses,
        spanBars: Math.min(spanBars, options.settings.bars - startBar),
      },
    });
    for (const [index, slot] of slots.entries()) {
      if (slot.startTick >= options.totalTicks) continue;
      const barIndex = Math.floor(slot.startTick / options.ticksPerBar);
      const barEnd = Math.min(options.totalTicks, (barIndex + 1) * options.ticksPerBar);
      const durationTick = Math.min(
        Math.max(1, Math.round(options.ppq / 4)),
        slot.durationTick,
        barEnd - slot.startTick,
      );
      if (durationTick <= 0) continue;
      const chord = options.chords.find(
        (candidate) =>
          slot.startTick >= candidate.startTick
          && slot.startTick < candidate.startTick + candidate.durationTick,
      );
      const midi = pulsePitch(chord);
      const idHash = hashSeed(
        deriveSeed(options.settings.seed, "pulse", startBar, index, slot.startTick),
      ).toString(36);
      notes.push({
        id: `pulse-${barIndex}-${slot.startTick}-${idHash}`,
        midi,
        noteName: midiToNoteName(midi),
        startTick: slot.startTick,
        durationTick,
        velocity: 78,
        barIndex,
        role: "chordTone",
      });
    }
  }
  return notes;
}

/**
 * Builds optional additional lines without changing the legacy lead melody.
 * The returned order and MIDI channels are stable so playback and exported
 * files stay reproducible across operating systems.
 */
export function buildArrangementVoices(
  options: ArrangementOptions,
): CompositionVoice[] {
  const arrangement = options.settings.arrangement;
  if (!arrangement) return [];
  const voices: CompositionVoice[] = [];
  const scaleForBar = (barIndex: number): readonly number[] => {
    const section = sectionForBar(options.sections, barIndex);
    const key = section?.key ?? options.settings.key;
    const mode = section?.melodyMode ?? section?.mode ?? options.settings.mode;
    const scale = section?.melodyScale ?? options.settings.songForm?.melodyScale ?? "diatonic";
    return getMelodyScaleMidiNotes(key, mode, 24, 108, scale);
  };

  if (arrangement.counterpoint?.enabled) {
    const above = arrangement.counterpoint.position === "above";
    const range: readonly [number, number] = above
      ? [
          Math.min(108, options.settings.melody.maxMidi + 3),
          Math.min(108, options.settings.melody.maxMidi + 24),
        ]
      : [
          Math.max(24, options.settings.melody.minMidi - 24),
          Math.max(24, options.settings.melody.minMidi - 3),
        ];
    const notes = generateCountermelody({
      melody: options.melody,
      chords: options.chords,
      scaleForBar,
      range,
      settings: arrangement.counterpoint,
      seed: deriveSeed(options.settings.seed, "arrangement-counterpoint"),
    });
    if (notes.length > 0) {
      voices.push({
        id: "voice-countermelody",
        name: "Countermelody",
        role: "countermelody",
        instrument: "softLead",
        color: "#58c7d9",
        midiChannel: 2,
        notes,
      });
    }
  }

  if (arrangement.canon?.enabled) {
    const notes = generateCanon({
      melody: options.melody,
      settings: arrangement.canon,
      timeSignature: options.settings.timeSignature,
      bars: options.settings.bars,
      range: [36, 96],
      ppq: options.ppq,
    });
    if (notes.length > 0) {
      voices.push({
        id: "voice-canon",
        name: "Canon",
        role: "canon",
        instrument: "pluck",
        color: "#c58cff",
        midiChannel: 3,
        notes,
      });
    }
  }

  const pulseNotes = buildPulseNotes(options);
  if (pulseNotes.length > 0) {
    voices.push({
      id: "voice-polyrhythm",
      name: "Pulse layer",
      role: "pulse",
      instrument: "bass",
      color: "#f4aa62",
      midiChannel: 4,
      notes: pulseNotes,
    });
  }
  return voices;
}
