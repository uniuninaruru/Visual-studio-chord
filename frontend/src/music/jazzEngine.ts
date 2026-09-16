import type {
  BarRange,
  ChordEvent,
  CompositionVoice,
  GeneratedComposition,
  GeneratorSettings,
  NoteEvent,
  RegenerationOptions,
} from "../types/music";
import { buildArrangementVoices } from "./arrangement";
import { voiceExtendedChord } from "./chords";
import { createBars, ticksPerBar } from "./time";
import { deriveSeed, hashSeed, seedToString } from "./random";
import { generateJazzHarmony } from "./jazzHarmony";
import { generateJazzMelody } from "./jazzMelody";
import { cloneJazzSettings, jazzSettingsOf, type JazzSettings } from "./jazzProfiles";

function copyJazzGeneratorSettings(settings: GeneratorSettings, jazz: JazzSettings): GeneratorSettings {
  return {
    ...settings,
    melody: { ...settings.melody },
    jazz: cloneJazzSettings(jazz),
  } as GeneratorSettings;
}

export function jazzSettingsForGenerator(settings: GeneratorSettings): JazzSettings | undefined {
  return jazzSettingsOf(settings);
}

/** Generates one complete jazz composition without entering the legacy pipeline. */
export function generateJazzComposition(
  settings: GeneratorSettings,
  jazz: JazzSettings = jazzSettingsOf(settings) as JazzSettings,
): GeneratedComposition {
  if (!jazz) throw new RangeError("Jazz settings are required for jazz generation.");
  const copiedSettings = copyJazzGeneratorSettings(settings, jazz);
  const harmony = generateJazzHarmony({ settings: copiedSettings, jazz, ppq: 480 });
  const notes = generateJazzMelody({
    settings: copiedSettings,
    jazz,
    chords: harmony.chords,
    sections: harmony.sections,
    ppq: 480,
  });
  const barTicks = ticksPerBar(copiedSettings.timeSignature, 480);
  const totalTicks = barTicks * copiedSettings.bars;
  const voices = buildArrangementVoices({
    settings: copiedSettings,
    melody: notes,
    chords: harmony.chords,
    sections: harmony.sections,
    totalTicks,
    ticksPerBar: barTicks,
    ppq: 480,
  });
  const idSeed = deriveSeed(
    copiedSettings.seed,
    "jazz-composition-v1",
    jazz.style,
    jazz.form,
    jazz.chromaticism,
    jazz.interaction,
  );
  return {
    id: `composition-${hashSeed(idSeed).toString(36)}`,
    version: 1,
    seed: seedToString(copiedSettings.seed),
    settings: copiedSettings,
    ppq: 480,
    ticksPerBar: barTicks,
    totalTicks,
    timeSignature: copiedSettings.timeSignature,
    resolvedStyle: harmony.resolvedStyle,
    cadence: harmony.cadence,
    bars: createBars(copiedSettings.bars, copiedSettings.timeSignature, 480),
    chords: harmony.chords,
    notes,
    ...(voices.length > 0 ? { voices } : {}),
    lockedBars: [],
    sections: harmony.sections,
  };
}

function sortEvents<T extends { startTick: number; id: string }>(events: T[]): T[] {
  return events.sort((left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id));
}

function clearDependentHarmonyClaim(chord: ChordEvent): ChordEvent {
  const next = { ...chord };
  if (
    next.source === "secondaryDominant"
    || next.specialKind === "secondaryDominant"
    || next.specialKind === "tritoneSubstitution"
  ) {
    next.source = "other";
    delete next.specialKind;
    delete next.targetDegree;
    delete next.explanation;
  }
  return next;
}

function splitChordSegments(
  current: readonly ChordEvent[],
  ticksPerBar: number,
  shouldReplace: (bar: number) => boolean,
): ChordEvent[] {
  const segments: ChordEvent[] = [];
  for (const chord of current) {
    const firstBar = Math.floor(chord.startTick / ticksPerBar);
    const lastBar = Math.floor((chord.startTick + chord.durationTick - 1) / ticksPerBar);
    const crossesReplacement = Array.from(
      { length: Math.max(0, lastBar - firstBar + 1) },
      (_, offset) => firstBar + offset,
    ).some(shouldReplace);
    if (!crossesReplacement) {
      segments.push(chord);
      continue;
    }
    for (let bar = firstBar; bar <= lastBar; bar += 1) {
      const segmentStart = Math.max(chord.startTick, bar * ticksPerBar);
      const segmentEnd = Math.min(chord.startTick + chord.durationTick, (bar + 1) * ticksPerBar);
      if (segmentEnd <= segmentStart) continue;
      const segment = {
        ...chord,
        id: segmentStart === chord.startTick && segmentEnd === chord.startTick + chord.durationTick
          ? chord.id
          : `${chord.id}-segment-${bar}`,
        startTick: segmentStart,
        durationTick: segmentEnd - segmentStart,
      };
      // A dependent harmony claim is about the transition to the following
      // chord, not about every bar occupied by a held chord.  Keep it on the
      // final fragment, where the original resolution still follows, and
      // clear it from intermediate continuation fragments whose next event is
      // the same held harmony.
      segments.push(bar < lastBar ? clearDependentHarmonyClaim(segment) : segment);
    }
  }
  return segments;
}

function replaceChordBars(
  current: readonly ChordEvent[],
  candidate: readonly ChordEvent[],
  ticksPerBar: number,
  shouldReplace: (bar: number) => boolean,
): ChordEvent[] {
  return sortEvents([
    ...splitChordSegments(current, ticksPerBar, shouldReplace)
      .filter((chord) => !shouldReplace(Math.floor(chord.startTick / ticksPerBar))),
    ...candidate.filter((chord) => shouldReplace(Math.floor(chord.startTick / ticksPerBar))),
  ]);
}

function revoiceJazzBars(
  current: readonly ChordEvent[],
  ticksPerBar: number,
  shouldReplace: (bar: number) => boolean,
): ChordEvent[] {
  let previousNotes: readonly number[] | undefined;
  const segments = splitChordSegments(current, ticksPerBar, shouldReplace);
  return segments.map((chord) => {
    const bar = Math.floor(chord.startTick / ticksPerBar);
    if (!shouldReplace(bar)) {
      previousNotes = chord.notes;
      return chord;
    }
    const voicing = voiceExtendedChord({
      root: chord.root,
      quality: chord.quality,
      tensions: chord.tensions,
      bass: chord.bass,
      previousNotes,
      voiceLeadingStrength: 0.82,
    });
    previousNotes = voicing.notes;
    // Existing hand assignments describe the old pitches and must not survive
    // a voicing-only regeneration.  The renderer will split this new set.
    const withoutHands = { ...chord };
    delete withoutHands.leftHand;
    return { ...withoutHands, notes: voicing.notes, inversion: voicing.inversion };
  });
}

function notesByBar(notes: readonly NoteEvent[]): Map<number, NoteEvent[]> {
  const result = new Map<number, NoteEvent[]>();
  for (const note of notes) result.set(note.barIndex, [...(result.get(note.barIndex) ?? []), note]);
  return result;
}

function replaceNoteBars(
  current: readonly NoteEvent[],
  candidate: readonly NoteEvent[],
  shouldReplace: (bar: number) => boolean,
): NoteEvent[] {
  return sortEvents([
    ...current.filter((note) => !shouldReplace(note.barIndex)),
    ...candidate.filter((note) => shouldReplace(note.barIndex)),
  ]);
}

function replaceNotePitches(
  current: readonly NoteEvent[],
  candidate: readonly NoteEvent[],
  shouldReplace: (bar: number) => boolean,
): NoteEvent[] {
  const candidateBars = notesByBar(candidate);
  const positions = new Map<number, number>();
  return sortEvents(current.map((note) => {
    if (!shouldReplace(note.barIndex)) return note;
    const choices = candidateBars.get(note.barIndex);
    if (!choices || choices.length === 0) return note;
    const position = positions.get(note.barIndex) ?? 0;
    positions.set(note.barIndex, position + 1);
    const source = choices[position % choices.length] as NoteEvent;
    return { ...note, midi: source.midi, noteName: source.noteName, role: source.role };
  }));
}

function replaceNoteRhythm(
  current: readonly NoteEvent[],
  candidate: readonly NoteEvent[],
  shouldReplace: (bar: number) => boolean,
): NoteEvent[] {
  const currentBars = notesByBar(current);
  const positions = new Map<number, number>();
  const remapped = candidate.map((note) => {
    if (!shouldReplace(note.barIndex)) return note;
    const sourceBar = currentBars.get(note.barIndex);
    if (!sourceBar || sourceBar.length === 0) return note;
    const position = positions.get(note.barIndex) ?? 0;
    positions.set(note.barIndex, position + 1);
    const source = sourceBar[position % sourceBar.length] as NoteEvent;
    return { ...note, midi: source.midi, noteName: source.noteName, role: source.role, velocity: source.velocity };
  });
  return replaceNoteBars(current, remapped, shouldReplace);
}

function mergeJazzVoices(
  current: readonly CompositionVoice[] | undefined,
  candidate: readonly CompositionVoice[],
  shouldReplace: (bar: number) => boolean,
): CompositionVoice[] {
  if (!current || current.length === 0) return candidate.map((voice) => ({ ...voice, notes: voice.notes.map((note) => ({ ...note })) }));
  const candidateById = new Map(candidate.map((voice) => [voice.id, voice]));
  return current.map((voice) => {
    const next = candidateById.get(voice.id);
    if (!next) return { ...voice, notes: voice.notes.map((note) => ({ ...note })) };
    return {
      ...voice,
      notes: replaceNoteBars(voice.notes, next.notes, shouldReplace),
    };
  });
}

/**
 * Range regeneration for jazz keeps the same target semantics as the legacy
 * API, but both candidate harmony and candidate melody come from this engine.
 * Locked bars and events outside the selected interval retain their objects.
 */
export function regenerateJazzRange(
  composition: GeneratedComposition,
  settings: GeneratorSettings,
  range: BarRange,
  options: RegenerationOptions = {},
): GeneratedComposition {
  const jazz = jazzSettingsOf(settings);
  if (!jazz) return composition;
  const target = options.target ?? "all";
  const strength = options.strength ?? "moderate";
  const seedOffset = options.seedOffset ?? 1;
  const respectLocks = options.respectLocks ?? true;
  const locked = new Set(respectLocks ? composition.lockedBars : []);
  const shouldReplace = (bar: number): boolean =>
    bar >= range.startBar && bar < range.endBar && !locked.has(bar)
    && (strength !== "subtle" || hashSeed(deriveSeed(settings.seed, "subtle", seedOffset, bar)) % 3 === 0 || bar === range.startBar);
  const variationSeed = deriveSeed(settings.seed, "jazz-regenerate", target, strength, seedOffset);
  const variationSettings = copyJazzGeneratorSettings({ ...settings, seed: variationSeed }, jazz);
  const candidate = generateJazzComposition(variationSettings, jazz);
  let chords = composition.chords;
  if (target === "all" || target === "chords") {
    chords = replaceChordBars(composition.chords, candidate.chords, composition.ticksPerBar, shouldReplace);
  } else if (target === "voicing") {
    chords = revoiceJazzBars(composition.chords, composition.ticksPerBar, shouldReplace);
  }
  let notes = composition.notes;
  if (target === "all" || target === "melody" || target === "pitch" || target === "rhythm") {
    // Every melody rewrite must hear the final retained harmony.  In an
    // all-regeneration pass, candidate melody is written only after locked
    // and hand-edited chord spans have been merged into that final timeline.
    const melodyCandidate = generateJazzMelody({
      settings: variationSettings,
      jazz,
      // All targets use the final retained chord timeline, including locked
      // and hand-edited spans.  A fresh full-candidate harmony would make a
      // selected lead resolve against chords the user never accepted.
      chords,
      sections: composition.sections,
      ppq: composition.ppq,
      seed: variationSeed,
    });
    if (target === "pitch") notes = replaceNotePitches(composition.notes, melodyCandidate, shouldReplace);
    else if (target === "rhythm") notes = replaceNoteRhythm(composition.notes, melodyCandidate, shouldReplace);
    else notes = replaceNoteBars(composition.notes, melodyCandidate, shouldReplace);
  }
  const candidateVoices = buildArrangementVoices({
    settings: variationSettings,
    melody: notes,
    chords,
    sections: composition.sections,
    totalTicks: composition.totalTicks,
    ticksPerBar: composition.ticksPerBar,
    ppq: composition.ppq,
  });
  const id = deriveSeed(composition.id, variationSeed, range.startBar, range.endBar, target, strength);
  const voices = mergeJazzVoices(composition.voices, candidateVoices, shouldReplace);
  return {
    ...composition,
    id: `composition-${hashSeed(id).toString(36)}`,
    seed: variationSeed,
    settings: variationSettings,
    chords,
    notes,
    ...(voices.length > 0 ? { voices } : { voices: undefined }),
    lockedBars: [...composition.lockedBars],
  };
}
