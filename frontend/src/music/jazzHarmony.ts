import type {
  CanonicalPitchClass,
  ChordEvent,
  ChordQuality,
  GeneratorSettings,
  Mode,
  ProgressionStep,
  SectionEvent,
} from "../types/music";
import { createStepChordEvent } from "./chords";
import { getProgressionTemplate } from "./progressions";
import { deriveSeed, hashSeed } from "./random";
import { normalizePitchClass, pitchClassToSemitone, semitoneToPitchClass } from "./scales";
import { ticksPerBar } from "./time";
import {
  type JazzSettings,
  type JazzStyleId,
} from "./jazzProfiles";

export interface JazzHarmonyResult {
  chords: ChordEvent[];
  sections: SectionEvent[];
  cadence: "authentic" | "plagal" | "half" | "deceptive" | "loop";
  resolvedStyle: "jazz";
}

interface JazzHarmonyOptions {
  settings: GeneratorSettings;
  jazz: JazzSettings;
  ppq: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function step(degree: number, extra: Omit<ProgressionStep, "degree"> = {}): ProgressionStep {
  return { degree, ...extra };
}

function minorMode(mode: Mode): boolean {
  return mode === "naturalMinor" || mode === "harmonicMinor";
}

function tonicQuality(mode: Mode): ChordQuality {
  if (mode === "major") return "major7";
  if (mode === "mixolydian") return "dominant7";
  return "minor7";
}

function iiQuality(mode: Mode): ChordQuality {
  return minorMode(mode) ? "halfDiminished7" : "minor7";
}

/**
 * The progression is intentionally expressed as target-bearing steps first,
 * then materialised into chords.  A tritone substitute is therefore always
 * followed by the tonic it resolves to, rather than being a decorative label
 * appended after a generic degree sequence was made.
 */
function internalStep(
  style: JazzStyleId,
  position: number,
  chromaticism: number,
  seed: string | number,
  mode: Mode,
): ProgressionStep {
  const chromatic = clamp01(chromaticism);
  const phase = position % 4;
  if (style === "swing") {
    if (phase === 0) return step(2, { quality: iiQuality(mode) });
    if (phase === 1 && hashSeed(deriveSeed(seed, "swing-tritone", position)) % 100 < chromatic * 100) {
      return step(2, {
        alteration: -1,
        quality: "dominant7",
        role: "tritoneSubstitution",
        targetDegree: 1,
      });
    }
    if (phase === 1) return step(5, { quality: "dominant7", tensions: ["13"] });
    if (phase === 2) return step(1, { quality: tonicQuality(mode), tensions: ["9"] });
    return step(6, { quality: "minor7" });
  }
  if (style === "ballad") {
    if (phase === 0) return step(1, { quality: tonicQuality(mode), tensions: ["9"] });
    if (phase === 1) return step(6, { quality: "minor7", tensions: ["9"] });
    if (phase === 2) return step(2, { quality: iiQuality(mode), tensions: ["11"] });
    return step(5, { quality: "dominant7", tensions: ["13"] });
  }
  if (style === "bebop") {
    if (phase === 0) return step(2, { quality: iiQuality(mode) });
    if (phase === 1) return step(5, { quality: "dominant7", tensions: ["b9"] });
    if (phase === 2) return step(1, { quality: tonicQuality(mode), tensions: ["6"] });
    // VI7 is V/ii; the following bar starts ii, so this is a real target.
    return mode === "major" || minorMode(mode)
      ? step(6, {
        ...(minorMode(mode) ? { alteration: 1 as const } : {}),
        quality: "dominant7",
        role: "secondaryDominant",
        targetDegree: 2,
      })
      : step(6, { quality: "dominant7", role: "chromatic" });
  }
  if (style === "modern") {
    if (phase === 0) return step(1, { quality: tonicQuality(mode), tensions: ["9", "#11"] });
    if (phase === 1) {
      return step(7, {
        alteration: -1,
        quality: "dominant7",
        role: "chromatic",
        tensions: ["13"],
      });
    }
    if (phase === 2) return step(4, { quality: "major7", tensions: ["#11"] });
    return step(1, { quality: tonicQuality(mode), tensions: ["9"] });
  }
  // Neo-soul uses the same functional skeleton but keeps colour in the voicing
  // and leaves space for a delayed resolution in the accompaniment.
  if (phase === 0) return step(1, { quality: tonicQuality(mode), tensions: ["9", "13"] });
  if (phase === 1) return step(3, { quality: "minor7", tensions: ["9"] });
  if (phase === 2) return step(4, { quality: "major7", tensions: ["9", "#11"] });
  return step(2, { quality: "minor7", tensions: ["9", "11"] });
}

function contrastingBStep(style: JazzStyleId, position: number, mode: Mode): ProgressionStep {
  const phase = position % 4;
  if (style === "swing" || style === "bebop") {
    if (phase === 0) {
      return mode === "major"
        ? step(3, { quality: "dominant7", role: "secondaryDominant", targetDegree: 6 })
        : step(3, { quality: "dominant7", role: "chromatic" });
    }
    if (phase === 1) return step(6, {
      ...(minorMode(mode) ? { alteration: 1 as const } : {}),
      quality: "dominant7",
      role: mode === "major" ? "secondaryDominant" : "chromatic",
      ...(mode === "major" ? { targetDegree: 2 } : {}),
    });
    if (phase === 2) return step(2, { quality: iiQuality(mode) });
    return step(5, { quality: "dominant7" });
  }
  if (style === "ballad") {
    if (phase === 0) return step(4, { quality: mode === "major" ? "major7" : "minor7" });
    if (phase === 1) return step(4, { quality: "minor7", role: "chromatic" });
    if (phase === 2) return step(1, { quality: tonicQuality(mode) });
    return step(5, { quality: "dominant7", tensions: ["b9"] });
  }
  if (style === "modern") {
    if (phase === 0) return step(2, { quality: iiQuality(mode) });
    if (phase === 1) return step(5, { quality: "dominant7", tensions: ["#9"] });
    if (phase === 2) return step(1, { quality: tonicQuality(mode) });
    return step(4, { quality: mode === "major" ? "major7" : "minor7" });
  }
  if (phase === 0) return step(6, { quality: mode === "major" ? "minor7" : "major7" });
  if (phase === 1) return step(2, { quality: iiQuality(mode) });
  if (phase === 2) return step(5, { quality: "dominant7", tensions: ["13"] });
  return step(1, { quality: tonicQuality(mode), tensions: ["9"] });
}

function bluesStep(position: number): ProgressionStep {
  // A basic jazz blues keeps the dominant seventh colour even on I and IV.
  if (position < 4) return step(1, { quality: "dominant7" });
  if (position < 6) return step(4, { quality: "dominant7" });
  if (position < 8) return step(1, { quality: "dominant7" });
  if (position === 8 || position === 11) return step(5, { quality: "dominant7" });
  if (position === 9) return step(4, { quality: "dominant7" });
  return step(1, { quality: "dominant7" });
}

function sectionPlan(
  form: JazzSettings["form"],
  bars: number,
  key: CanonicalPitchClass,
  mode: Mode,
  progressionId: string | undefined,
): SectionEvent[] {
  if (bars <= 0) return [];
  const kinds: SectionEvent["kind"][] = [];
  const starts: number[] = [];
  if (form === "aaba") {
    const unit = Math.max(1, Math.floor(bars / 4));
    for (let index = 0; index < 4; index += 1) {
      starts.push(Math.min(bars, index * unit));
      kinds.push(index === 2 ? "bridge" : index === 3 ? "finalChorus" : "verse");
    }
  } else if (form === "blues") {
    for (let start = 0; start < bars; start += 12) {
      starts.push(start);
      kinds.push(start === 0 ? "verse" : "chorus");
    }
  } else if (form === "modal") {
    starts.push(0);
    kinds.push("verse");
    if (bars > 8) {
      starts.push(Math.floor(bars / 2));
      kinds.push("bridge");
    }
  } else {
    starts.push(0);
    kinds.push("verse");
  }
  return starts
    .map((startBar, index) => ({
      id: `jazz-section-${index}`,
      kind: kinds[index] as SectionEvent["kind"],
      startBar,
      endBar: starts[index + 1] ?? bars,
      key,
      mode,
      transpose: 0,
      ...(progressionId ? { progressionId } : {}),
    }))
    .filter((section) => section.endBar > section.startBar);
}

function safeCreateChord(
  settings: GeneratorSettings,
  chordStep: ProgressionStep,
  startTick: number,
  durationTick: number,
  id: string,
  previousNotes: readonly number[] | undefined,
): ChordEvent {
  return createStepChordEvent({
    key: settings.key,
    mode: settings.mode,
    step: chordStep,
    startTick,
    durationTick,
    id,
    previousNotes,
    voiceLeadingStrength: 0.8,
  });
}

export function generateJazzHarmony(options: JazzHarmonyOptions): JazzHarmonyResult {
  const bars = options.settings.bars;
  const barTicks = ticksPerBar(options.settings.timeSignature, options.ppq);
  const totalTicks = barTicks * bars;
  const key = normalizePitchClass(options.settings.key);
  const template = options.settings.progressionId
    ? getProgressionTemplate(options.settings.progressionId)
    : undefined;
  const explicitSteps = template?.steps;
  const chords: ChordEvent[] = [];
  let previousNotes: readonly number[] | undefined;
  let bar = 0;
  while (bar < bars) {
    // Keep one event per bar even for held modal/free palettes.  It makes
    // range edits and bar locks exact while the repeated symbol still denotes
    // the same held harmony; the jazz renderer controls re-articulation.
    const patternIndex = options.jazz.form === "modal"
      ? Math.floor(bar / 2)
      : bar;
    const source = explicitSteps?.length
      ? explicitSteps[patternIndex % explicitSteps.length] as ProgressionStep
      : options.jazz.form === "blues"
        ? bluesStep(bar % 12)
        : (() => {
          const aabaUnit = Math.max(1, Math.floor(bars / 4));
          const aabaSection = options.jazz.form === "aaba"
            ? Math.min(3, Math.floor(bar / aabaUnit))
            : 0;
          const withinSection = options.jazz.form === "aaba" ? bar % aabaUnit : patternIndex;
          if (options.jazz.form === "aaba" && aabaSection === 2) {
            return contrastingBStep(options.jazz.style, withinSection, options.settings.mode);
          }
          if (
            options.jazz.form === "aaba"
            && aabaSection !== 2
            && withinSection === aabaUnit - 1
          ) {
            return step(1, {
              quality: tonicQuality(options.settings.mode),
              tensions: ["9"],
            });
          }
          return internalStep(
            options.jazz.style,
            withinSection,
            options.jazz.chromaticism,
            options.settings.seed,
            options.settings.mode,
          );
        })();
    const aabaUnit = Math.max(1, Math.floor(bars / 4));
    const bTerminal = options.jazz.form === "aaba"
      && Math.min(3, Math.floor(bar / aabaUnit)) === 2
      && bar % aabaUnit === aabaUnit - 1;
    const modalPalette = options.jazz.form === "modal" && explicitSteps === undefined;
    const materialSource = (modalPalette || (bTerminal && explicitSteps === undefined)) && source.role !== undefined
      ? { ...source, role: undefined, targetDegree: undefined }
      : source;
    const startTick = bar * barTicks;
    const durationTick = Math.min(barTicks, totalTicks - startTick);
    const chord = safeCreateChord(
      options.settings,
      materialSource,
      startTick,
      durationTick,
      `jazz-chord-${bar}-${hashSeed(deriveSeed(options.settings.seed, "harmony", bar, patternIndex)).toString(36)}`,
      previousNotes,
    );
    chords.push(chord);
    previousNotes = chord.notes;
    bar += 1;
  }
  const sections = sectionPlan(
    options.jazz.form,
    bars,
    key,
    options.settings.mode,
    options.settings.progressionId,
  );
  const last = chords.at(-1);
  const previous = chords.at(-2);
  const terminalVToI = last?.degree === 1
    && previous !== undefined
    && ((pitchClassToSemitone(last.root) - pitchClassToSemitone(previous.root) + 12) % 12 === 7);
  const cadence = terminalVToI ? "authentic" : "loop";
  return { chords, sections, cadence, resolvedStyle: "jazz" };
}

/** Exposed for tests and the track builder; keeps pitch-class arithmetic local. */
export function pitchClassOf(midi: number): CanonicalPitchClass {
  return semitoneToPitchClass(((midi % 12) + 12) % 12);
}

export function rootMidiForChord(chord: ChordEvent): number {
  // A hand-edited slash bass is a real sounding target and must survive the
  // jazz renderer; only fall back to the harmonic root when absent.
  const root = pitchClassToSemitone(chord.bass ?? chord.root);
  let midi = 36 + root;
  while (midi < 36) midi += 12;
  while (midi > 55) midi -= 12;
  return midi;
}
