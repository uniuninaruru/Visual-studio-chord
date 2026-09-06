import type { ChordEvent, NoteEvent, SectionKind } from "../types/music";
import type { MelodyGeneratorOptions } from "./melodyGenerator";
import { createSeededRandom, deriveSeed, hashSeed } from "./random";
import { getMelodyScaleMidiNotes, midiToNoteName, pitchClassToSemitone } from "./scales";
import { sectionForBar } from "./sections";
import { STYLE_PRESETS } from "./styles";
import { euclideanRhythmBar } from "./euclideanRhythm";
import { metricStrength, ticksPerBar } from "./time";
import { phraseForBar } from "./phrases";
import { skeletonRegisterAt } from "./melodicSkeleton";

/** A small rhythmic vocabulary, composed here rather than copied from songs. */
const CELLS = {
  sparse: [[4, 4], [6, 2], [8], [2, 6]],
  medium: [[2, 2, 4], [3, 1, 4], [4, 2, 2], [3, 3, 2], [2, 4, 2]],
  dense: [[1, 1, 2, 4], [2, 1, 1, 2, 2], [3, 1, 2, 2], [2, 2, 1, 1, 2]],
} as const;

const COMPOUND_CELLS = {
  sparse: [[6], [3, 3]],
  medium: [[2, 2, 2], [3, 1, 2], [2, 4], [4, 2]],
  dense: [[1, 1, 2, 2], [2, 1, 1, 2], [1, 2, 1, 2]],
} as const;

const TRIPLE_CELLS = {
  sparse: [[4, 8], [8, 4], [6, 6]],
  medium: [[4, 2, 2, 4], [3, 1, 4, 4], [2, 2, 4, 4], [4, 4, 2, 2]],
  dense: [[2, 2, 2, 2, 4], [3, 1, 2, 2, 2, 2], [1, 1, 2, 4, 2, 2]],
} as const;

interface Gesture {
  /** Position in a bar, 0..1. */
  onset: number;
  length: number;
  degree: number;
  accent: number;
}

interface PlannedNote {
  startTick: number;
  durationTick: number;
  barIndex: number;
  targetMidi: number;
  accent: number;
  closes: boolean;
  tonicClose: boolean;
  candidates: readonly number[];
  chord: ChordEvent;
}

interface Path {
  score: number;
  pitches: number[];
  last: number | null;
  delta: number;
  repeated: number;
  previousNonChord: boolean;
}

const REGISTER: Readonly<Record<SectionKind, number>> = {
  intro: 0.4, verse: 0.44, preChorus: 0.55, chorus: 0.64,
  bridge: 0.43, quietChorus: 0.57, finalChorus: 0.76, outro: 0.38,
};

function family(kind: SectionKind | undefined): string {
  if (kind === "finalChorus" || kind === "quietChorus") return "chorus";
  return kind ?? "theme";
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * One two-bar idea per section family. Its rhythm and contour survive repeated
 * choruses; changing the key changes the notes that realise it, not its identity.
 * The second half answers the first. Silence is planned at the gesture's tail.
 */
function makeTheme(options: MelodyGeneratorOptions, name: string): Gesture[][] {
  const random = createSeededRandom(deriveSeed(options.seed ?? options.settings.seed, "phrase-theme-v1", options.resolvedStyle, name));
  const melody = options.settings.melody;
  const style = STYLE_PRESETS[options.resolvedStyle];
  const density = clamp(melody.density * style.densityMultiplier, 0, 1);
  const level = density < 0.4 ? "sparse" : density > 0.62 ? "dense" : "medium";
  const meter = options.settings.timeSignature;
  const cells: readonly (readonly number[])[] = (meter === "3/4" ? TRIPLE_CELLS : meter === "6/8" ? COMPOUND_CELLS : CELLS)[level];
  const syncopation = clamp(melody.syncopation + style.syncopationBias, 0, 1);
  const firstCell = random.pick(cells);
  const secondCell = meter === "3/4" ? [] : random.pick(cells);
  // A seed determines a contour, not a fresh independent pitch for every hit.
  const contour = [0];
  let degree = 0;
  for (let index = 1; index < 12; index += 1) {
    const delta = random.weightedPick([-2, -1, 0, 1, 2], [1, 3, 3, 3, 1]);
    degree = clamp(degree + delta, -3, 4);
    contour.push(degree);
  }
  // Keep a flat draw from producing an entire hook on one note.
  if (new Set(contour).size < 3) contour[3] = 2;
  return [0, 1].map((bar) => {
    const lengths = [...firstCell, ...secondCell];
    const units = lengths.reduce((sum, length) => sum + length, 0);
    const result: Gesture[] = [];
    let position = 0;
    for (const [index, length] of lengths.entries()) {
      const tail = index === lengths.length - 1;
      const rests = index > 0 && random.chance(clamp(melody.restRate * style.restMultiplier * (tail ? 1 : 0.35) + (tail ? 0.22 : 0), 0, 0.9));
      if (!rests) {
        // The pickup is part of the motif and recurs with it. It is not timing jitter.
        const pickup = index === 0 && random.chance(syncopation) ? Math.min(1, length / 2) : 0;
        result.push({
          onset: (position + pickup) / units,
          length: (length - pickup) / units,
          degree: contour[index % contour.length]! + (bar === 1 && tail ? -1 : 0),
          accent: index === 0 ? 1 : tail ? 0.86 : index % 2 === 0 ? 0.92 : 0.78,
        });
      }
      position += length;
    }
    return result;
  });
}

function scaleAt(options: MelodyGeneratorOptions, bar: number): number[] {
  const section = sectionForBar(options.sections, bar);
  const key = section?.key ?? options.settings.key;
  const mode = section?.melodyMode ?? section?.mode ?? options.settings.mode;
  const { minMidi, maxMidi } = options.settings.melody;
  const notes = getMelodyScaleMidiNotes(key, mode, minMidi, maxMidi, section?.melodyScale ?? "diatonic");
  return notes.length > 0 ? notes : getMelodyScaleMidiNotes(key, mode, minMidi, maxMidi, "diatonic");
}

function nearestIndex(pitches: readonly number[], target: number): number {
  let best = 0;
  for (let index = 1; index < pitches.length; index += 1) {
    if (Math.abs(pitches[index]! - target) < Math.abs(pitches[best]! - target)) best = index;
  }
  return best;
}

function planBar(
  options: MelodyGeneratorOptions,
  bar: number,
  theme: Gesture[][],
): PlannedNote[] {
  const ppq = options.ppq ?? 480;
  const barTicks = ticksPerBar(options.settings.timeSignature, ppq);
  const section = sectionForBar(options.sections, bar);
  const localBar = bar - (section?.startBar ?? 0);
  const sectionEnd = section?.endBar ?? options.settings.bars;
  const phrase = phraseForBar(options.phrases, bar);
  const closes = bar === sectionEnd - 1 || (phrase
    ? phrase.cadenceStrength >= 0.5 && bar === phrase.endBar - 1
    : (localBar + 1) % (options.phraseLengthBars ?? 4) === 0);
  const isFinal = bar === options.settings.bars - 1;
  const hookStrength = options.settings.melody.hookStrength ?? 0.75;
  const random = createSeededRandom(deriveSeed(options.seed ?? options.settings.seed, "phrase-variation", family(section?.kind), localBar));
  const themeLength = options.settings.motif?.enabled ? options.settings.motif.lengthBars : 2;
  let gesture = theme[localBar % themeLength]!.map((item) => ({ ...item }));
  // State, restate, answer, close: the opening half is retained during development.
  const transformationRate = options.settings.motif?.enabled ? options.settings.motif.transformationRate : 1 - hookStrength;
  if (localBar % 4 === 2 && random.chance(transformationRate)) {
    gesture = gesture.map((item, index) => index < 2 ? item : { ...item, degree: item.degree + 1 });
  }
  if (phrase?.function === "fragmentation") {
    const fragment = gesture.filter((item) => item.onset < 0.5);
    gesture = [...fragment, ...fragment.map((item) => ({ ...item, onset: item.onset + 0.5, degree: item.degree + 1 }))];
  } else if (phrase?.function === "sequence") {
    gesture = gesture.map((item) => ({ ...item, degree: item.degree + 1 }));
  }
  if (closes && gesture.length > 1) {
    const landing = gesture.findIndex((item) => item.onset >= 0.5);
    const index = landing < 0 ? gesture.length - 1 : landing;
    gesture = gesture.slice(0, index + 1);
    gesture[index] = { ...gesture[index]!, length: 1 - gesture[index]!.onset, degree: -1, accent: 0.9 };
  }
  if (options.settings.euclideanRhythm?.enabled) {
    gesture = euclideanRhythmBar({
      timeSignature: options.settings.timeSignature,
      settings: options.settings.euclideanRhythm,
      barIndex: bar,
      ppq,
    }).filter((slot) => !slot.isRest).map((slot, index) => ({
      ...theme[localBar % 2]![index % theme[localBar % 2]!.length]!,
      onset: (slot.startTick - bar * barTicks) / barTicks,
      length: slot.durationTick / barTicks,
    }));
  }

  const scale = scaleAt(options, bar);
  if (scale.length === 0) throw new RangeError("Melody range contains no scale tone.");
  const kind = section?.kind;
  const progress = section ? localBar / Math.max(1, section.endBar - section.startBar - 1) : 0;
  const height = kind === "preChorus" ? 0.43 + progress * 0.2 : kind ? REGISTER[kind] : 0.55;
  const { minMidi, maxMidi } = options.settings.melody;
  // Cap the working register while retaining the configured hard bounds.
  const centre = minMidi + (maxMidi - minMidi) * height;
  const anchor = nearestIndex(scale, centre);
  const barStart = bar * barTicks;
  const grid = Math.max(1, Math.round(ppq / 4));
  const planned: PlannedNote[] = [];
  for (const [index, item] of gesture.entries()) {
    const startTick = barStart + clamp(Math.round(item.onset * barTicks / grid) * grid, 0, barTicks - 1);
    const next = gesture[index + 1];
    const nextStart = next ? barStart + Math.round(next.onset * barTicks / grid) * grid : barStart + barTicks;
    const available = Math.min(nextStart, barStart + barTicks) - startTick;
    if (available < 1) continue;
    const isLanding = closes && index === gesture.length - 1;
    const chord = options.chords.find((entry) => startTick >= entry.startTick && startTick < entry.startTick + entry.durationTick);
    if (!chord) throw new Error(`No chord covers phrase tick ${startTick}.`);
    const breath = isLanding && !isFinal ? Math.min(Math.round(ppq / 4), Math.floor(available / 4)) : 0;
    const gate = isLanding ? 1 : options.resolvedStyle === "edm" ? 0.78 : 0.9;
    const durationTick = Math.max(1, Math.min(available - breath, Math.round(item.length * barTicks * gate)));
    const structuralTarget = skeletonRegisterAt(options.skeleton, startTick);
    const structuralPull = structuralTarget === null ? 0 : clamp(structuralTarget - centre, -5, 5) * (1 - hookStrength) * 1.2;
    planned.push({
      startTick, durationTick, barIndex: bar,
      targetMidi: scale[clamp(anchor + item.degree, 0, scale.length - 1)]! + structuralPull,
      accent: item.accent,
      closes: isLanding,
      tonicClose: isLanding && isFinal && (options.cadence === "authentic" || options.cadence === "plagal"),
      candidates: scale,
      chord,
    });
  }
  return planned;
}

/**
 * Search several whole-line alternatives instead of drawing each note in
 * isolation. Harmony, motif contour, preparation/resolution and leap recovery
 * contribute to the same path score. Scores are heuristics, not listener ratings.
 */
function realisePhrase(options: MelodyGeneratorOptions, plan: readonly PlannedNote[], previous: number | null): NoteEvent[] {
  const ppq = options.ppq ?? 480;
  const barTicks = ticksPerBar(options.settings.timeSignature, ppq);
  const hookStrength = options.settings.melody.hookStrength ?? 0.75;
  let paths: Path[] = [{ score: 0, pitches: [], last: previous, delta: 0, repeated: 0, previousNonChord: false }];
  for (const [index, slot] of plan.entries()) {
    const metric = metricStrength(slot.startTick % barTicks, options.settings.timeSignature, ppq);
    const chordPcs = new Set(slot.chord.notes.map((pitch) => pitch % 12));
    const chordCandidates = slot.candidates.filter((pitch) => chordPcs.has(pitch % 12));
    const forceChord = metric >= 0.68 || slot.closes;
    const candidates = forceChord && chordCandidates.length > 0 ? chordCandidates : slot.candidates;
    const expanded: Path[] = [];
    const section = sectionForBar(options.sections, slot.barIndex);
    const tonic = pitchClassToSemitone(section?.key ?? options.settings.key);
    const previousSlot = plan[index - 1];
    for (const path of paths) {
      for (const pitch of candidates) {
        const delta = path.last === null ? 0 : pitch - path.last;
        if (path.last !== null && Math.abs(delta) > 12 && candidates.some((p) => Math.abs(p - path.last!) <= 12)) continue;
        const chordTone = chordPcs.has(pitch % 12);
        let cost = Math.abs(pitch - slot.targetMidi) * (0.35 + hookStrength * 0.85);
        if (!chordTone) cost += 1.5 + metric * 2 + options.settings.melody.chordToneRate;
        const distance = Math.abs(delta);
        const leapCost = 0.65 - options.settings.melody.leapProbability * 0.45;
        cost += distance <= 2 ? distance * 0.12 : distance <= 5 ? 0.6 + distance * 0.18 : 1.8 + distance * leapCost;
        if (path.previousNonChord && (!chordTone || distance > 2 || distance === 0)) cost += 8;
        if (!chordTone && path.last !== null && (distance > 2 || distance === 0)) cost += 6;
        if (Math.abs(path.delta) >= 7 && (Math.sign(delta) === Math.sign(path.delta) || distance > 4 || distance === 0)) cost += 8;
        const repeats = delta === 0 ? path.repeated + 1 : 0;
        if (repeats > 2) cost += (repeats - 2) * 3;
        if (previousSlot && path.last !== null) {
          const intended = slot.targetMidi - previousSlot.targetMidi;
          cost += Math.abs(delta - intended) * hookStrength * 0.4;
        }
        if (slot.tonicClose && pitch % 12 !== tonic) cost += 4;
        // Stable tie-breaking: no random process changes when a neighbour is edited.
        cost += (hashSeed(deriveSeed(options.seed ?? options.settings.seed, "phrase-pitch", family(section?.kind), index, pitch)) % 100) / 1000;
        expanded.push({ score: path.score + cost, pitches: [...path.pitches, pitch], last: pitch, delta, repeated: repeats, previousNonChord: !chordTone });
      }
    }
    expanded.sort((a, b) => a.score - b.score);
    // Retain different recent motions, so the beam is not twelve copies of one ending.
    const endings = new Set<string>();
    paths = expanded.filter((path) => {
      const key = `${path.last}:${path.delta}:${path.repeated}`;
      if (endings.has(key)) return false;
      endings.add(key);
      return true;
    }).slice(0, 12);
  }
  const best = paths[0];
  if (!best) throw new Error("No playable phrase fits the melody range.");
  return plan.map((slot, index) => {
    const midi = best.pitches[index]!;
    const chordTone = slot.chord.notes.some((pitch) => pitch % 12 === midi % 12);
    const before = best.pitches[index - 1];
    const role = chordTone ? "chordTone" : before !== undefined && Math.abs(midi - before) <= 2 ? "passing" : "scaleTone";
    return {
      id: `note-${slot.barIndex}-phrase-${index}-${hashSeed(deriveSeed(options.seed ?? options.settings.seed, slot.startTick, midi)).toString(36)}`,
      midi, noteName: midiToNoteName(midi), startTick: slot.startTick,
      durationTick: slot.durationTick, barIndex: slot.barIndex,
      velocity: clamp(Math.round(options.settings.melody.velocity * slot.accent), 1, 127),
      role,
    };
  });
}

export function composePhraseMelody(options: MelodyGeneratorOptions): NoteEvent[] {
  const themes = new Map<string, Gesture[][]>();
  const result: NoteEvent[] = [];
  let plan: PlannedNote[] = [];
  for (let bar = 0; bar < options.settings.bars; bar += 1) {
    const section = sectionForBar(options.sections, bar);
    const name = options.settings.songForm?.form === "throughComposed" && section
      ? `${section.kind}-${section.startBar}` : family(section?.kind);
    let theme = themes.get(name);
    if (!theme) { theme = makeTheme(options, name); themes.set(name, theme); }
    plan.push(...planBar(options, bar, theme));
    const localBar = bar - (section?.startBar ?? 0);
    if ((localBar + 1) % 4 === 0 || bar === (section?.endBar ?? options.settings.bars) - 1) {
      // A repeated section starts from its own idea, not from the previous section's
      // random last pitch. Motion inside the phrase remains jointly optimised.
      const phrase = realisePhrase(options, plan, null);
      result.push(...phrase);
      plan = [];
    }
  }
  return result;
}
