import type {
  CompositionVoice,
  GeneratedComposition,
  GeneratorSettings,
  JazzSettings,
  NoteEvent,
} from "../types/music";
import { buildArrangementVoices } from "./arrangement";
import { buildCompositionTracks } from "./compositionTracks";
import { createBars, ticksPerBar } from "./time";
import { deriveSeed, hashSeed, seedToString } from "./random";
import { planTheoryHarmony } from "./theoryHarmony";
import { composeTheoryVoices } from "./theoryVoices";
import { evaluateTheory, type TheoryDiagnostic, type TheoryPart } from "./theoryRules";

export const THEORY_ENGINE_PPQ = 480;

function copySettings(settings: GeneratorSettings, jazz: JazzSettings): GeneratorSettings {
  return {
    ...settings,
    melody: { ...settings.melody },
    ...(settings.arrangement
      ? {
          arrangement: {
            ...settings.arrangement,
            ...(settings.arrangement.counterpoint
              ? { counterpoint: { ...settings.arrangement.counterpoint } }
              : {}),
            ...(settings.arrangement.canon ? { canon: { ...settings.arrangement.canon } } : {}),
            ...(settings.arrangement.polyrhythm ? { polyrhythm: { ...settings.arrangement.polyrhythm } } : {}),
          },
        }
      : {}),
    jazz: { ...jazz },
  };
}

function sortNotes(notes: NoteEvent[]): NoteEvent[] {
  return notes.sort((left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id));
}

function theoryCounterVoice(notes: readonly NoteEvent[]): CompositionVoice | undefined {
  if (notes.length === 0) return undefined;
  return {
    id: "voice-countermelody",
    name: "Countermelody",
    role: "countermelody",
    instrument: "softLead",
    color: "var(--track-countermelody)",
    fill: "var(--track-countermelody-fill)",
    midiChannel: 2,
    notes: sortNotes(notes.map((note) => ({ ...note }))),
  };
}

/** Compose only non-counterpoint arrangement layers; v2's second line is joint with the lead. */
export function buildTheoryArrangementVoices(
  settings: GeneratorSettings,
  options: Omit<Parameters<typeof buildArrangementVoices>[0], "settings">,
): CompositionVoice[] {
  if (!settings.arrangement) return [];
  const arrangement = {
    ...settings.arrangement,
    counterpoint: settings.arrangement.counterpoint
      ? { ...settings.arrangement.counterpoint, enabled: false }
      : undefined,
  };
  return buildArrangementVoices({ ...options, settings: { ...settings, arrangement } });
}

function theoryParts(composition: GeneratedComposition): TheoryPart[] {
  const counter = composition.voices?.find((voice) => voice.role === "countermelody");
  const position = composition.settings.arrangement?.counterpoint?.position ?? "below";
  const lead: TheoryPart = {
    id: "lead",
    notes: composition.notes,
    range: [21, 108],
    ...(counter ? { register: position === "above" ? "lower" : "upper" } : {}),
  };
  return counter
    ? [lead, {
        id: counter.id,
        notes: counter.notes,
        range: [21, 108],
        register: position === "above" ? "upper" : "lower",
      }]
    : [lead];
}

/**
 * Return theory warnings and errors for the current saved timeline, including
 * user-edited chords and notes. Jazz gets the jazz profile; strict-species
 * prohibitions are never silently imposed on the application engine. The
 * evaluator currently supports two monophonic lines, so this checks lead vs
 * bass and lead vs the joint counterline separately. The polyphonic chord
 * voicing is not yet expanded into independently audited voices; diagnostics
 * must not be read as a full contrapuntal audit of every sounding note.
 */
export function diagnoseTheoryComposition(composition: GeneratedComposition): TheoryDiagnostic[] {
  const options = {
    chords: composition.chords,
    timeSignature: composition.timeSignature,
    ppq: composition.ppq,
    profile: "jazz",
  } as const;
  const diagnostics = evaluateTheory({ ...options, parts: theoryParts(composition) });
  const bass = buildCompositionTracks(composition).find((track) => track.role === "bass");
  if (bass && bass.notes.length > 0) {
    diagnostics.push(...evaluateTheory({
      ...options,
      parts: [
        { id: bass.id, notes: bass.notes, range: [21, 108], register: "lower" },
        { id: "lead", notes: composition.notes, range: [21, 108], register: "upper" },
      ],
    }));
  }
  const unique = new Map<string, TheoryDiagnostic>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.ruleId}:${diagnostic.tick}:${[...diagnostic.voiceIds].sort().join(",")}`;
    if (!unique.has(key)) unique.set(key, diagnostic);
  }
  return [...unique.values()].sort((left, right) =>
    left.tick - right.tick
    || left.ruleId.localeCompare(right.ruleId)
    || left.voiceIds.join(",").localeCompare(right.voiceIds.join(",")),
  );
}

function assertHardTheoryValidity(composition: GeneratedComposition): void {
  const errors = diagnoseTheoryComposition(composition).filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    const rules = [...new Set(errors.map((diagnostic) => diagnostic.ruleId))].join(", ");
    throw new RangeError(`Theory-led jazz generation produced invalid voice data (${rules}). No composition was accepted.`);
  }
}

/** Builds a complete v2 jazz project on the shared playback/export contract. */
export function generateTheoryComposition(
  settings: GeneratorSettings,
  jazz: JazzSettings,
): GeneratedComposition {
  if (jazz.version !== 2) throw new RangeError("Theory composition requires jazz engine version 2.");
  if (!Number.isInteger(settings.bars) || settings.bars < 1) throw new RangeError("Theory composition requires at least one bar.");
  const playableLow = Math.max(21, settings.melody.minMidi);
  const playableHigh = Math.min(108, settings.melody.maxMidi);
  if (playableLow > playableHigh) {
    throw new RangeError("The selected melody range does not intersect the supported 88-key piano range (MIDI 21–108). No composition was created.");
  }
  const copiedSettings = copySettings(settings, jazz);
  const harmony = planTheoryHarmony({ settings: copiedSettings, jazz, ppq: THEORY_ENGINE_PPQ });
  const composed = composeTheoryVoices({
    settings: copiedSettings,
    jazz,
    chords: harmony.chords,
    sections: harmony.sections,
    ppq: THEORY_ENGINE_PPQ,
  });
  if (composed.melody.length === 0) {
    throw new RangeError("Theory-led jazz generation could not produce a lead line for this harmony and meter.");
  }
  if (copiedSettings.arrangement?.counterpoint?.enabled && !composed.countermelody?.length) {
    throw new RangeError("Theory-led jazz generation could not produce the requested complete counterline. Disable counterpoint or adjust its position and the melody range.");
  }

  const barTicks = ticksPerBar(copiedSettings.timeSignature, THEORY_ENGINE_PPQ);
  const totalTicks = barTicks * copiedSettings.bars;
  const voices = buildTheoryArrangementVoices(copiedSettings, {
    melody: composed.melody,
    chords: harmony.chords,
    sections: harmony.sections,
    totalTicks,
    ticksPerBar: barTicks,
    ppq: THEORY_ENGINE_PPQ,
  });
  const counter = theoryCounterVoice(composed.countermelody ?? []);
  if (counter) voices.unshift(counter);
  const idSeed = deriveSeed(
    copiedSettings.seed,
    "jazz-composition-v2-theory",
    jazz.style,
    jazz.form,
    jazz.chromaticism,
    jazz.interaction,
  );
  const composition: GeneratedComposition = {
    id: `composition-${hashSeed(idSeed).toString(36)}`,
    version: 1,
    seed: seedToString(copiedSettings.seed),
    settings: copiedSettings,
    ppq: THEORY_ENGINE_PPQ,
    ticksPerBar: barTicks,
    totalTicks,
    timeSignature: copiedSettings.timeSignature,
    resolvedStyle: harmony.resolvedStyle,
    cadence: harmony.cadence,
    bars: createBars(copiedSettings.bars, copiedSettings.timeSignature, THEORY_ENGINE_PPQ),
    chords: harmony.chords,
    notes: sortNotes(composed.melody),
    ...(voices.length > 0 ? { voices } : {}),
    lockedBars: [],
    sections: harmony.sections,
  };
  assertHardTheoryValidity(composition);
  return composition;
}
