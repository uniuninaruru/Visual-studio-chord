import {
  PPQ,
  type BarRange,
  type ChordEvent,
  type GeneratedComposition,
  type GeneratorSettings,
  type HarmonySettings,
  type MotifSettings,
  type NoteEvent,
  type RegenerationOptions,
  type CadenceType,
  type SectionEvent,
} from "../types/music";
import { createStepChordEvent, voiceChord } from "./chords";
import { buildArrangementVoices } from "./arrangement";
import {
  planMelodicSkeleton,
  type MelodicSkeletonNote,
} from "./melodicSkeleton";
import { generateMelody } from "./melodyGenerator";
import { applyPivotModulations } from "./modulation";
import { generateProgression } from "./progressionGenerator";
import { appliedDominantResolves } from "./progressionAnalysis";
import { planPhrases, type PhrasePlanEntry } from "./phrases";
import { planSections } from "./sections";
import { revoiceInFourParts } from "./voiceLeading";
import { revoiceForMelody } from "./voicingSelection";
import { applySectionTransitions } from "./sectionTransitions";
import type { ConcreteStylePresetId } from "./styles";
import { deriveSeed, hashSeed, seedToString } from "./random";
import { getScalePitchClasses, midiToNoteName, pitchClassToSemitone } from "./scales";
import { createBars, tickToBarIndex, ticksPerBar, ticksPerBeat } from "./time";
import { assertValidGeneratorSettings } from "./validation";

export const DEFAULT_HARMONY_SETTINGS: Readonly<Required<HarmonySettings>> = Object.freeze({
  complexity: "triads",
  borrowedChordRate: 1,
  secondaryDominantRate: 1,
  explorationRate: 1,
  voiceLeadingStrength: 1,
});

export const DEFAULT_MOTIF_SETTINGS: Readonly<MotifSettings> = Object.freeze({
  enabled: false,
  lengthBars: 1,
  transformationRate: 0.65,
});

/**
 * The engine with nothing switched on.
 *
 * Not what the app ships -- see DEFAULT_GENERATOR_SETTINGS below for that --
 * but the baseline every opt-in setting is defined against: with none of them
 * present, generation is exactly what it was before any of them existed.
 *
 * Kept as its own constant because "the settings we ship" and "the settings
 * that turn nothing on" are different ideas, and the tests were using one name
 * for both. That conflation is what made shipping better defaults look like
 * eighty-eight regressions.
 */
export const MINIMAL_GENERATOR_SETTINGS: Readonly<GeneratorSettings> = Object.freeze({
  key: "C",
  mode: "major",
  bpm: 120,
  timeSignature: "4/4",
  bars: 8,
  style: "pop",
  seed: "phase-1",
  melody: Object.freeze({
    minMidi: 55,
    maxMidi: 88,
    density: 0.52,
    velocity: 92,
    chordToneRate: 0.68,
    restRate: 0.14,
    syncopation: 0.18,
    leapProbability: 0.12,
  }),
  harmony: DEFAULT_HARMONY_SETTINGS,
  motif: DEFAULT_MOTIF_SETTINGS,
});

/**
 * What the app ships.
 *
 * Everything here was built, tested, measured -- and shipped switched off.
 * Measured before this changed, over eight styles and five seeds at sixteen
 * bars: pressing generate produced six distinct chord symbols, all plain
 * triads, two velocity values, and a chord track crammed into nine semitones.
 * None of the voicing, colour, dynamics or structure work was reachable
 * without finding and ticking each box, and a feature nobody switches on is
 * indistinguishable from one that was never written.
 *
 * Measured after: thirty distinct symbols, chords spanning 13.5 semitones
 * rather than 7.9, nine velocity values, and the harmony covering the melody
 * in 14% of spans rather than 31%.
 *
 * The figures are values rather than maxima. A colour tone on every chord is
 * exhausting and measured worse on every voicing figure; a third of them is
 * where the vocabulary opens without the texture thickening.
 */
export const DEFAULT_GENERATOR_SETTINGS: Readonly<GeneratorSettings> = Object.freeze({
  ...MINIMAL_GENERATOR_SETTINGS,
  harmony: Object.freeze({ ...DEFAULT_HARMONY_SETTINGS, complexity: "sevenths" as const }),
  tensions: Object.freeze({ enabled: true, rate: 0.35 }),
  voiceLeading: Object.freeze({ enabled: true, optimizeSequence: true }),
  melodyVoicing: Object.freeze({ enabled: true }),
  bassRegister: Object.freeze({ enabled: true }),
  dynamics: Object.freeze({ enabled: true }),
  harmonicRhythm: Object.freeze({ cadentialAcceleration: true }),
  functionalHarmony: Object.freeze({ enabled: true }),
  phraseGrammar: Object.freeze({ enabled: true }),
  melodicSkeleton: Object.freeze({ enabled: true }),
  groove: Object.freeze({ enabled: true, template: "laidBack" as const, amount: 0.5 }),
  songForm: Object.freeze({ form: "verseChorus" as const }),
  sectionTransitions: Object.freeze({ enabled: true }),
  songFormVariety: Object.freeze({ variedThinSections: true }),
  arpeggio: Object.freeze({ enabled: true }),
});

function copySettings(settings: GeneratorSettings): GeneratorSettings {
  return {
    ...settings,
    melody: { ...settings.melody },
    harmony: settings.harmony ? { ...settings.harmony } : undefined,
    motif: settings.motif ? { ...settings.motif } : undefined,
    songForm: settings.songForm ? { ...settings.songForm } : undefined,
    harmonicRhythm: settings.harmonicRhythm
      ? { ...settings.harmonicRhythm }
      : undefined,
    phraseGrammar: settings.phraseGrammar ? { ...settings.phraseGrammar } : undefined,
    functionalHarmony: settings.functionalHarmony
      ? { ...settings.functionalHarmony }
      : undefined,
    voiceLeading: settings.voiceLeading ? { ...settings.voiceLeading } : undefined,
    bassRegister: settings.bassRegister ? { ...settings.bassRegister } : undefined,
    dynamics: settings.dynamics ? { ...settings.dynamics } : undefined,
    tensions: settings.tensions ? { ...settings.tensions } : undefined,
    arpeggio: settings.arpeggio ? { ...settings.arpeggio } : undefined,
    melodyVoicing: settings.melodyVoicing ? { ...settings.melodyVoicing } : undefined,
    sectionTransitions: settings.sectionTransitions ? { ...settings.sectionTransitions } : undefined,
    songFormVariety: settings.songFormVariety ? { ...settings.songFormVariety } : undefined,
    melodicSkeleton: settings.melodicSkeleton
      ? { ...settings.melodicSkeleton }
      : undefined,
    pivotModulation: settings.pivotModulation
      ? { ...settings.pivotModulation }
      : undefined,
    euclideanRhythm: settings.euclideanRhythm
      ? { ...settings.euclideanRhythm }
      : undefined,
    groove: settings.groove ? { ...settings.groove } : undefined,
    arrangement: settings.arrangement
      ? {
          counterpoint: settings.arrangement.counterpoint
            ? { ...settings.arrangement.counterpoint }
            : undefined,
          canon: settings.arrangement.canon
            ? { ...settings.arrangement.canon }
            : undefined,
          polyrhythm: settings.arrangement.polyrhythm
            ? { ...settings.arrangement.polyrhythm }
            : undefined,
        }
      : undefined,
    nonChordTones: settings.nonChordTones
      ? {
          ...settings.nonChordTones,
          types: settings.nonChordTones.types
            ? [...settings.nonChordTones.types]
            : undefined,
        }
      : undefined,
  };
}

function compositionFingerprint(settings: GeneratorSettings): string {
  const harmonyRates = [
    settings.harmony?.borrowedChordRate ?? DEFAULT_HARMONY_SETTINGS.borrowedChordRate,
    settings.harmony?.secondaryDominantRate ?? DEFAULT_HARMONY_SETTINGS.secondaryDominantRate,
    settings.harmony?.explorationRate ?? DEFAULT_HARMONY_SETTINGS.explorationRate,
    settings.harmony?.voiceLeadingStrength ?? DEFAULT_HARMONY_SETTINGS.voiceLeadingStrength,
  ];
  // Keep legacy/default composition IDs byte-for-byte stable. Non-default
  // controls still participate in the fingerprint and therefore create a
  // distinct project identity even if a particular seed happens to pick the
  // same musical material.
  const harmonyRateFingerprint = harmonyRates.every((value) => value === 1)
    ? []
    : ["harmony-controls", ...harmonyRates];
  return [
    settings.key,
    settings.mode,
    settings.bpm,
    settings.timeSignature,
    settings.bars,
    settings.style,
    seedToString(settings.seed),
    settings.melody.minMidi,
    settings.melody.maxMidi,
    settings.melody.density,
    settings.melody.velocity,
    settings.melody.chordToneRate,
    settings.melody.restRate,
    settings.melody.syncopation,
    settings.melody.leapProbability,
    settings.harmony?.complexity ?? DEFAULT_HARMONY_SETTINGS.complexity,
    ...harmonyRateFingerprint,
    settings.motif?.enabled ?? DEFAULT_MOTIF_SETTINGS.enabled,
    settings.motif?.lengthBars ?? DEFAULT_MOTIF_SETTINGS.lengthBars,
    settings.motif?.transformationRate ?? DEFAULT_MOTIF_SETTINGS.transformationRate,
    // Appended only when a form is requested, so ids of form-less pieces are
    // unchanged while two pieces that differ only by form stay distinct.
    ...(settings.songForm && settings.songForm.form !== "none"
      ? [
          "song-form",
          settings.songForm.form,
          settings.songForm.finalLift ?? 0,
          settings.songForm.polytonal ?? false,
          settings.songForm.melodyScale ?? "diatonic",
        ]
      : []),
    ...(settings.progressionId ? ["progression", settings.progressionId] : []),
    // Appended only when set, so ids of one-chord-per-bar pieces are unchanged.
    ...(settings.harmonicRhythm
      ? [
          "harmonic-rhythm",
          settings.harmonicRhythm.changesPerBar ?? 1,
          settings.harmonicRhythm.barsPerChord ?? 1,
          settings.harmonicRhythm.cadentialAcceleration ?? false,
        ]
      : []),
    ...(settings.phraseGrammar?.enabled ? ["phrase-grammar"] : []),
    ...(settings.dynamics?.enabled
      ? ["dynamics", settings.dynamics.depth ?? "default"]
      : []),
    ...(settings.melodyVoicing?.enabled ? ["melody-voicing"] : []),
    ...(settings.sectionTransitions?.enabled ? ["section-transitions"] : []),
    ...(settings.songFormVariety?.variedThinSections ? ["varied-thin-sections"] : []),
    ...(settings.arpeggio?.enabled
      ? [
        "arpeggio",
        settings.arpeggio.rate ?? "default",
        settings.arpeggio.pattern ?? "default",
        settings.arpeggio.gate ?? "default",
      ]
      : []),
    ...(settings.tensions?.enabled
      ? [
        "tensions",
        settings.tensions.rate ?? "default",
        settings.tensions.ceiling ?? "default",
      ]
      : []),
    ...(settings.bassRegister?.enabled
      ? [
        "bass-register",
        settings.bassRegister.ceiling ?? "default",
        settings.bassRegister.floor ?? "default",
      ]
      : []),
    ...(settings.voiceLeading?.enabled
      ? [
        "voice-leading",
        settings.voiceLeading.profile ?? "auto",
        ...(settings.voiceLeading.optimizeSequence ? ["sequence"] : []),
      ]
      : []),
    ...(settings.functionalHarmony?.enabled
      ? ["functional-harmony", settings.functionalHarmony.exploration ?? 0]
      : []),
    ...(settings.melodicSkeleton?.enabled ? ["melodic-skeleton"] : []),
    ...(settings.pivotModulation?.enabled ? ["pivot-modulation"] : []),
    ...(settings.groove?.enabled
      ? ["groove", settings.groove.template, settings.groove.amount ?? 1]
      : []),
    ...(settings.euclideanRhythm?.enabled
      ? [
          "euclidean",
          settings.euclideanRhythm.onsets,
          settings.euclideanRhythm.steps,
          settings.euclideanRhythm.rotation ?? 0,
        ]
      : []),
    ...(settings.nonChordTones?.enabled
      ? [
          "non-chord-tones",
          settings.nonChordTones.rate ?? 0.5,
          [...(settings.nonChordTones.types ?? [])].sort().join(",") || "all",
        ]
      : []),
    ...(settings.arrangement?.counterpoint?.enabled
      ? [
          "counterpoint",
          settings.arrangement.counterpoint.position ?? "below",
          settings.arrangement.counterpoint.independence ?? 0.5,
        ]
      : []),
    ...(settings.arrangement?.canon?.enabled
      ? [
          "canon",
          settings.arrangement.canon.delayBeats,
          settings.arrangement.canon.interval ?? 0,
          settings.arrangement.canon.inverted ?? false,
        ]
      : []),
    ...(settings.arrangement?.polyrhythm?.enabled
      ? [
          "polyrhythm",
          settings.arrangement.polyrhythm.pulses,
          settings.arrangement.polyrhythm.spanBars ?? 1,
        ]
      : []),
  ].join("|");
}

/**
 * The plans that give a melody its shape: where the phrases are, and which
 * notes they are built around.
 *
 * Shared by generation and regeneration so a regenerated melody is shaped by
 * the same plan as the one it replaces, rather than reverting to a plain
 * note-by-note line.
 */
function planMelodyShape(
  settings: GeneratorSettings,
  chords: readonly ChordEvent[],
  sections: readonly SectionEvent[] | undefined,
  cadence: CadenceType,
  ppq: number,
): {
  phrases: PhrasePlanEntry[] | undefined;
  skeleton: MelodicSkeletonNote[] | undefined;
} {
  const phrases = settings.phraseGrammar?.enabled
    ? planPhrases({ bars: settings.bars, seed: settings.seed, sections })
    : undefined;
  // The skeleton's points are defined relative to a phrase's shape, so without
  // a phrase plan there is nothing to plan them against.
  const skeleton =
    settings.melodicSkeleton?.enabled && phrases
      ? planMelodicSkeleton({
          phrases,
          chords,
          ticksPerBar: ticksPerBar(settings.timeSignature, ppq),
          ticksPerBeat: ticksPerBeat(settings.timeSignature, ppq),
          range: [settings.melody.minMidi, settings.melody.maxMidi],
          key: settings.key,
          cadence,
          seed: settings.seed,
        })
      : undefined;
  return { phrases, skeleton };
}

/**
 * Generates each section's chords in its own key and concatenates them into the
 * flat, tick-contiguous chord array the rest of the app expects.
 */
function closeStrandedAppliedDominants(
  source: readonly ChordEvent[],
  settings: GeneratorSettings,
  sections: readonly SectionEvent[],
  durationTick: number,
): ChordEvent[] {
  const chords = [...source];
  let changed = true;
  for (let pass = 0; pass < chords.length && changed; pass += 1) {
    changed = false;
    // Work backwards: replacing a target can invalidate the applied dominant
    // immediately before it, which this same pass will then see.
    for (let chordIndex = chords.length - 1; chordIndex >= 0; chordIndex -= 1) {
      const chord = chords[chordIndex] as ChordEvent;
      if (
        chord.specialKind !== "secondaryDominant"
        && chord.specialKind !== "tritoneSubstitution"
      ) {
        continue;
      }
      const barIndex = Math.floor(chord.startTick / durationTick);
      const section = sections.find(
        (candidate) => barIndex >= candidate.startBar && barIndex < candidate.endBar,
      );
      const targetDegree = chord.targetDegree;
      if (!section || targetDegree === undefined) continue;
      const expectedRoot = getScalePitchClasses(
        section.key,
        section.mode,
      )[targetDegree - 1];
      const next = chords[chordIndex + 1] ?? chords[0];
      if (appliedDominantResolves(chord, next, expectedRoot)) continue;

      chords[chordIndex] = createStepChordEvent({
        key: section.key,
        mode: section.mode,
        step: { degree: targetDegree },
        startTick: chord.startTick,
        durationTick: chord.durationTick,
        id: chord.id,
        previousNotes: chords[chordIndex - 1]?.notes,
        voiceLeadingStrength:
          settings.harmony?.voiceLeadingStrength
          ?? DEFAULT_HARMONY_SETTINGS.voiceLeadingStrength,
      });
      changed = true;
    }
  }
  return chords;
}

function generateSectionedChords(
  settings: GeneratorSettings,
  sections: readonly SectionEvent[],
  durationTick: number,
): { chords: ChordEvent[]; degrees: number[]; cadence: CadenceType; resolvedStyle: ConcreteStylePresetId } {
  const chords: ChordEvent[] = [];
  let cadence: CadenceType = "loop";
  let resolvedStyle: ConcreteStylePresetId | null = null;

  for (const [index, section] of sections.entries()) {
    const barCount = section.endBar - section.startBar;
    const result = generateProgression({
      ...settings,
      key: section.key,
      mode: section.mode,
      barCount,
      progressionId: section.progressionId,
      // Each section draws from its own seed stream so one section's content
      // cannot shift when a neighbour changes length.
      seed: deriveSeed(settings.seed, "section", index, section.kind),
      ppq: PPQ,
    });
    resolvedStyle ??= result.resolvedStyle;
    // The piece's cadence is the one it actually ends on.
    cadence = result.cadence;
    const tickOffset = section.startBar * durationTick;
    for (const [barIndex, chord] of result.chords.entries()) {
      chords.push({
        ...chord,
        id: `${section.id}-chord-${barIndex}-${chord.id.split("-").pop() ?? barIndex}`,
        startTick: chord.startTick + tickOffset,
      });
    }
  }

  // Named templates and section lengths are planned independently. When a
  // section truncates immediately after V/x or subV/x, the next section may
  // start in another key and cannot serve as that applied chord's resolution.
  // Close such a boundary on the declared target before concatenation becomes
  // the saved song timeline.
  const closedChords = closeStrandedAppliedDominants(
    chords,
    settings,
    sections,
    durationTick,
  );
  return {
    chords: closedChords,
    degrees: closedChords.map((chord) => chord.degree),
    cadence,
    resolvedStyle: resolvedStyle ?? "pop",
  };
}

export function generateComposition(settings: GeneratorSettings): GeneratedComposition {
  assertValidGeneratorSettings(settings);
  const copiedSettings = copySettings(settings);
  const barTicks = ticksPerBar(copiedSettings.timeSignature, PPQ);
  const sections = planSections({
    key: copiedSettings.key,
    mode: copiedSettings.mode,
    bars: copiedSettings.bars,
    seed: copiedSettings.seed,
    form: copiedSettings.songForm?.form ?? "none",
    finalLift: copiedSettings.songForm?.finalLift,
    polytonal: copiedSettings.songForm?.polytonal,
    melodyScale: copiedSettings.songForm?.melodyScale,
    variedThinSections: copiedSettings.songFormVariety?.variedThinSections,
  });

  // Without a song form this is the original single-span path, so existing
  // seeds keep producing byte-identical output.
  const progression = sections
    ? generateSectionedChords(copiedSettings, sections, barTicks)
    : generateProgression({ ...copiedSettings, ppq: PPQ });
  // Before voicing, so the pivot is voiced with the rest rather than being an
  // island the four-part writer never saw.
  if (copiedSettings.pivotModulation?.enabled && sections) {
    progression.chords = applyPivotModulations({
      chords: progression.chords,
      sections,
      ticksPerBar: barTicks,
      seed: copiedSettings.seed,
      voiceLeadingStrength:
        copiedSettings.harmony?.voiceLeadingStrength ??
        DEFAULT_HARMONY_SETTINGS.voiceLeadingStrength,
    }).chords;
    // A pivot may replace the target immediately following V/x or subV/x.
    // Re-run the hard resolution invariant after the seam is rewritten.
    progression.chords = closeStrandedAppliedDominants(
      progression.chords,
      copiedSettings,
      sections,
      barTicks,
    );
  }
  // Before voicing and before the melody, so the approach chord is voiced with
  // the rest of the progression and the melody is written over it rather than
  // around it.
  if (copiedSettings.sectionTransitions?.enabled && sections) {
    progression.chords = applySectionTransitions(
      progression.chords,
      sections.map((section) => ({ startBar: section.startBar })),
      {
        style: copiedSettings.style,
        seed: copiedSettings.seed,
        mode: copiedSettings.mode,
        tonicSemitone: pitchClassToSemitone(copiedSettings.key),
        ticksPerBar: ticksPerBar(copiedSettings.timeSignature, PPQ),
      },
    );
  }

  // Re-voiced before the melody is written, since the melody scores its
  // candidates against the sounding chord tones.
  if (copiedSettings.voiceLeading?.enabled) {
    progression.chords = revoiceInFourParts(progression.chords, {
      key: copiedSettings.key,
      mode: copiedSettings.mode,
      style: copiedSettings.style,
      profileName: copiedSettings.voiceLeading.profile,
      optimizeSequence: copiedSettings.voiceLeading.optimizeSequence,
    });
  }

  const { phrases, skeleton } = planMelodyShape(
    copiedSettings,
    progression.chords,
    sections,
    progression.cadence,
    PPQ,
  );
  const notes = generateMelody({
    settings: copiedSettings,
    chords: progression.chords,
    resolvedStyle: progression.resolvedStyle,
    cadence: progression.cadence,
    sections,
    phrases,
    skeleton,
    ppq: PPQ,
  });
  // Voiced a second time, now that there is a melody to voice against. Safe
  // because re-voicing moves octaves and never pitch classes, so every
  // relationship the melody was written against still holds.
  if (copiedSettings.melodyVoicing?.enabled) {
    progression.chords = revoiceForMelody(progression.chords, notes, {
      style: copiedSettings.style,
    });
  }

  const durationTick = ticksPerBar(copiedSettings.timeSignature, PPQ);
  const fingerprint = compositionFingerprint(copiedSettings);
  const totalTicks = durationTick * copiedSettings.bars;
  const voices = buildArrangementVoices({
    settings: copiedSettings,
    melody: notes,
    chords: progression.chords,
    sections,
    totalTicks,
    ticksPerBar: durationTick,
    ppq: PPQ,
  });
  return {
    id: `composition-${hashSeed(fingerprint).toString(36)}`,
    version: 1,
    seed: seedToString(copiedSettings.seed),
    settings: copiedSettings,
    ppq: PPQ,
    ticksPerBar: durationTick,
    totalTicks,
    timeSignature: copiedSettings.timeSignature,
    resolvedStyle: progression.resolvedStyle,
    cadence: progression.cadence,
    bars: createBars(copiedSettings.bars, copiedSettings.timeSignature, PPQ),
    chords: progression.chords,
    notes,
    ...(voices.length > 0 ? { voices } : {}),
    lockedBars: [],
    ...(sections ? { sections } : {}),
  };
}

function validateRange(composition: GeneratedComposition, range: BarRange): void {
  if (
    !Number.isInteger(range.startBar) ||
    !Number.isInteger(range.endBar) ||
    range.startBar < 0 ||
    range.endBar > composition.settings.bars ||
    range.startBar >= range.endBar
  ) {
    throw new RangeError(
      `Bar range must satisfy 0 <= startBar < endBar <= ${composition.settings.bars}.`,
    );
  }
}

function eventBar(chord: ChordEvent, durationTick: number): number {
  return tickToBarIndex(chord.startTick, durationTick);
}

function sortEvents<T extends { startTick: number; id: string }>(events: T[]): T[] {
  return events.sort((left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id));
}

function replaceChordBars(
  current: readonly ChordEvent[],
  candidate: readonly ChordEvent[],
  durationTick: number,
  shouldReplace: (barIndex: number) => boolean,
): ChordEvent[] {
  return sortEvents([
    ...current.filter((event) => !shouldReplace(eventBar(event, durationTick))),
    ...candidate.filter((event) => shouldReplace(eventBar(event, durationTick))),
  ]);
}

function replaceNoteBars(
  current: readonly NoteEvent[],
  candidate: readonly NoteEvent[],
  shouldReplace: (barIndex: number) => boolean,
): NoteEvent[] {
  return sortEvents([
    ...current.filter((event) => !shouldReplace(event.barIndex)),
    ...candidate.filter((event) => shouldReplace(event.barIndex)),
  ]);
}

function groupNotesByBar(notes: readonly NoteEvent[]): Map<number, NoteEvent[]> {
  const result = new Map<number, NoteEvent[]>();
  for (const note of notes) {
    const barNotes = result.get(note.barIndex) ?? [];
    barNotes.push(note);
    result.set(note.barIndex, barNotes);
  }
  for (const barNotes of result.values()) sortEvents(barNotes);
  return result;
}

function replacePitches(
  current: readonly NoteEvent[],
  candidate: readonly NoteEvent[],
  shouldReplace: (barIndex: number) => boolean,
): NoteEvent[] {
  const candidateBars = groupNotesByBar(candidate);
  const barPositions = new Map<number, number>();
  return sortEvents(
    current.map((note) => {
      if (!shouldReplace(note.barIndex)) return note;
      const choices = candidateBars.get(note.barIndex);
      if (!choices || choices.length === 0) return note;
      const position = barPositions.get(note.barIndex) ?? 0;
      barPositions.set(note.barIndex, position + 1);
      const source = choices[position % choices.length] as NoteEvent;
      return {
        ...note,
        midi: source.midi,
        noteName: source.noteName,
        role: source.role,
      };
    }),
  );
}

function replaceRhythm(
  current: readonly NoteEvent[],
  candidate: readonly NoteEvent[],
  shouldReplace: (barIndex: number) => boolean,
): NoteEvent[] {
  const currentBars = groupNotesByBar(current);
  const barPositions = new Map<number, number>();
  const mappedCandidate = candidate.map((note) => {
    const pitches = currentBars.get(note.barIndex);
    if (!pitches || pitches.length === 0) return note;
    const position = barPositions.get(note.barIndex) ?? 0;
    barPositions.set(note.barIndex, position + 1);
    const pitch = pitches[position % pitches.length] as NoteEvent;
    return {
      ...note,
      midi: pitch.midi,
      noteName: midiToNoteName(pitch.midi),
      role: pitch.role,
      velocity: pitch.velocity,
    };
  });
  return replaceNoteBars(current, mappedCandidate, shouldReplace);
}

function revoiceBars(
  chords: readonly ChordEvent[],
  shouldReplace: (barIndex: number) => boolean,
  durationTick: number,
  seedOffset: number,
  voiceLeadingStrength: number,
): ChordEvent[] {
  let previousNotes: readonly number[] | undefined;
  return chords.map((chord) => {
    const barIndex = eventBar(chord, durationTick);
    if (!shouldReplace(barIndex)) {
      previousNotes = chord.notes;
      return chord;
    }
    const inversionCount = chord.notes.length;
    const requestedInversion =
      ((chord.inversion + Math.abs(Math.trunc(seedOffset || 1))) % inversionCount + inversionCount) %
      inversionCount;
    const voicing = voiceChord(
      chord.root,
      chord.quality,
      previousNotes,
      requestedInversion,
      voiceLeadingStrength,
    );
    previousNotes = voicing.notes;
    return { ...chord, notes: voicing.notes, inversion: voicing.inversion };
  });
}

/**
 * Regenerates only [startBar, endBar). Events outside that interval and events
 * in locked bars retain their original object identity.
 */
export function regenerateRange(
  composition: GeneratedComposition,
  settings: GeneratorSettings,
  range: BarRange,
  options: RegenerationOptions = {},
): GeneratedComposition {
  validateRange(composition, range);
  assertValidGeneratorSettings(settings);
  if (
    settings.bars !== composition.settings.bars ||
    settings.timeSignature !== composition.timeSignature
  ) {
    throw new Error("Partial regeneration cannot change bar count or time signature.");
  }

  const target = options.target ?? "all";
  const seedOffset = options.seedOffset ?? 1;
  const strength = options.strength ?? "moderate";
  if (!["all", "chords", "melody", "pitch", "rhythm", "voicing"].includes(target)) {
    throw new RangeError("Unsupported regeneration target.");
  }
  if (!Number.isFinite(seedOffset)) {
    throw new RangeError("seedOffset must be finite.");
  }
  if (!["subtle", "moderate", "strong"].includes(strength)) {
    throw new RangeError("Unsupported regeneration strength.");
  }
  const respectLocks = options.respectLocks ?? true;
  const locked = new Set(respectLocks ? composition.lockedBars : []);
  const shouldReplace = (barIndex: number): boolean =>
    barIndex >= range.startBar && barIndex < range.endBar && !locked.has(barIndex);
  const hasReplaceableBar = Array.from(
    { length: composition.settings.bars },
    (_, barIndex) => barIndex,
  ).some(shouldReplace);
  if (!hasReplaceableBar) return composition;
  const replaceableBars = Array.from(
    { length: composition.settings.bars },
    (_, barIndex) => barIndex,
  ).filter(shouldReplace);
  const subtleAnchor = replaceableBars[
    hashSeed(deriveSeed(settings.seed, "subtle-anchor", seedOffset)) % replaceableBars.length
  ] as number;
  const shouldReplaceForStrength = (barIndex: number): boolean =>
    shouldReplace(barIndex) &&
    (strength !== "subtle" ||
      barIndex === subtleAnchor ||
      hashSeed(deriveSeed(settings.seed, "subtle-bar", seedOffset, barIndex)) % 3 === 0);
  const variationSeed = deriveSeed(settings.seed, "regenerate", strength, seedOffset);
  const variationSettings: GeneratorSettings = {
    ...copySettings(settings),
    seed: variationSeed,
  };

  let chords = composition.chords;
  let cadence = composition.cadence;
  let resolvedStyle = composition.resolvedStyle;

  if (target === "all" || target === "chords") {
    // A sectioned piece must be regenerated section by section, or the new
    // chords arrive in the composition's opening key and land inside a section
    // that has modulated away from it.
    const progression = composition.sections
      ? generateSectionedChords(
          variationSettings,
          composition.sections,
          composition.ticksPerBar,
        )
      : generateProgression({ ...variationSettings, ppq: composition.ppq });
    chords = replaceChordBars(
      composition.chords,
      progression.chords,
      composition.ticksPerBar,
      shouldReplaceForStrength,
    );
    const finalBar = composition.settings.bars - 1;
    if (shouldReplaceForStrength(finalBar - 1) && shouldReplaceForStrength(finalBar)) {
      cadence = progression.cadence;
    }
    const everyBarReplaced = Array.from(
      { length: composition.settings.bars },
      (_, barIndex) => barIndex,
    ).every(shouldReplaceForStrength);
    if (everyBarReplaced) {
      resolvedStyle = progression.resolvedStyle;
    }
  } else if (target === "voicing") {
    chords = revoiceBars(
      composition.chords,
      shouldReplaceForStrength,
      composition.ticksPerBar,
      seedOffset,
      settings.harmony?.voiceLeadingStrength ?? DEFAULT_HARMONY_SETTINGS.voiceLeadingStrength,
    );
  }

  let notes = composition.notes;
  if (target === "all" || target === "melody" || target === "pitch" || target === "rhythm") {
    const candidateNotes = generateMelody({
      settings: variationSettings,
      chords,
      resolvedStyle,
      cadence,
      sections: composition.sections,
      ...planMelodyShape(
        variationSettings,
        chords,
        composition.sections,
        cadence,
        composition.ppq,
      ),
      seed: variationSeed,
      ppq: composition.ppq,
      strength,
    });
    if (target === "pitch" || (target === "all" && strength === "subtle")) {
      notes = replacePitches(composition.notes, candidateNotes, shouldReplaceForStrength);
    } else if (target === "rhythm") {
      notes = replaceRhythm(composition.notes, candidateNotes, shouldReplaceForStrength);
    } else {
      notes = replaceNoteBars(composition.notes, candidateNotes, shouldReplaceForStrength);
    }
  }

  const idSeed = deriveSeed(
    composition.id,
    variationSeed,
    range.startBar,
    range.endBar,
    target,
    strength,
  );
  const voices = buildArrangementVoices({
    settings: variationSettings,
    melody: notes,
    chords,
    sections: composition.sections,
    totalTicks: composition.totalTicks,
    ticksPerBar: composition.ticksPerBar,
    ppq: composition.ppq,
  });
  return {
    ...composition,
    id: `composition-${hashSeed(idSeed).toString(36)}`,
    seed: variationSeed,
    settings: variationSettings,
    cadence,
    resolvedStyle,
    chords,
    notes,
    ...(voices.length > 0 ? { voices } : { voices: undefined }),
    lockedBars: [...composition.lockedBars],
  };
}

export function setBarLocked(
  composition: GeneratedComposition,
  barIndex: number,
  locked: boolean,
): GeneratedComposition {
  if (!Number.isInteger(barIndex) || barIndex < 0 || barIndex >= composition.settings.bars) {
    throw new RangeError("Locked bar index is outside the composition.");
  }
  const locks = new Set(composition.lockedBars);
  if (locked) locks.add(barIndex);
  else locks.delete(barIndex);
  return { ...composition, lockedBars: [...locks].sort((left, right) => left - right) };
}
