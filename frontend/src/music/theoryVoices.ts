import type {
  ChordEvent,
  GeneratorSettings,
  JazzSettings,
  NoteEvent,
  NoteRole,
  SectionEvent,
  Tension,
} from "../types/music";
import { deriveSeed, hashSeed, type Seed } from "./random";
import { getScaleSemitones, midiToNoteName, pitchClassToSemitone } from "./scales";
import { ticksPerBar } from "./time";

/**
 * The theory-first voice writer. It plans one harmonic/metric skeleton for the
 * lead and, when requested, searches for a second line against it at the same
 * structural positions. Short weak-beat figures are added only after that
 * skeleton is settled, and only when their approach grammar can be named.
 */

const MIDI_LOW = 21;
const MIDI_HIGH = 108;
const BEAM_WIDTH = 40;
const MAX_PAIRS_PER_SLOT = 260;
const STYLE_ATTACK_ACTIVITY: Readonly<Record<JazzSettings["style"], number>> = {
  swing: 0.62,
  ballad: 0.28,
  bebop: 0.94,
  modern: 0.48,
  neoSoul: 0.62,
};
const STYLE_REST_GAP: Readonly<Record<JazzSettings["style"], number>> = {
  swing: 0.72,
  ballad: 0.58,
  bebop: 0.95,
  modern: 0.82,
  neoSoul: 0.86,
};

const QUALITY_INTERVALS: Readonly<Record<ChordEvent["quality"], readonly number[]>> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  halfDiminished7: [0, 3, 6, 10],
  diminished7: [0, 3, 6, 9],
  minorMajor7: [0, 3, 7, 11],
  augmentedMajor7: [0, 4, 8, 11],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 2, 4, 7],
  minorAdd9: [0, 2, 3, 7],
};

const TENSION_INTERVALS: Readonly<Record<Tension, number>> = {
  "6": 9,
  "9": 2,
  b9: 1,
  "#9": 3,
  "11": 5,
  "#11": 6,
  "13": 9,
  b13: 8,
};

interface StructuralSlot {
  tick: number;
  endTick: number;
  barIndex: number;
  chord: ChordEvent;
  accent: number;
  primaryAccent: boolean;
  mandatoryAttack: boolean;
  cadenceAnchor: boolean;
  key: GeneratorSettings["key"];
  mode: GeneratorSettings["mode"];
}

interface VoicePair {
  lead: number;
  counter?: number;
  score: number;
}

interface SearchState extends VoicePair {
  previous?: SearchState;
}

interface SearchInput {
  settings: GeneratorSettings;
  jazz: JazzSettings;
  chords: readonly ChordEvent[];
  sections?: readonly SectionEvent[];
  ppq: number;
  seed: Seed;
  barTicks: number;
  beatTicks: number;
  endTick: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));
}

function pc(value: number): number {
  return ((value % 12) + 12) % 12;
}

function chordAt(chords: readonly ChordEvent[], tick: number): ChordEvent | undefined {
  return chords.find((chord) => tick >= chord.startTick && tick < chord.startTick + chord.durationTick);
}

function sectionAt(sections: readonly SectionEvent[] | undefined, barIndex: number): SectionEvent | undefined {
  return sections?.find((section) => barIndex >= section.startBar && barIndex < section.endBar);
}

function chordToneClasses(chord: ChordEvent): Set<number> {
  const root = pitchClassToSemitone(chord.root);
  const tones = new Set<number>();
  for (const interval of QUALITY_INTERVALS[chord.quality]) tones.add(pc(root + interval));
  for (const tension of chord.tensions ?? []) tones.add(pc(root + TENSION_INTERVALS[tension]));
  return tones;
}

function extensionClasses(chord: ChordEvent): Set<number> {
  const root = pitchClassToSemitone(chord.root);
  const tones = new Set<number>();
  for (const tension of chord.tensions ?? []) tones.add(pc(root + TENSION_INTERVALS[tension]));
  return tones;
}

function buildSlots(input: SearchInput): StructuralSlot[] {
  const { settings, chords, sections, ppq, barTicks, beatTicks, endTick } = input;
  const ticks = new Set<number>();
  for (let tick = 0; tick < endTick; tick += beatTicks) ticks.add(tick);
  for (const chord of chords) {
    if (chord.startTick >= 0 && chord.startTick < endTick) ticks.add(chord.startTick);
  }

  const ordered = [...ticks].sort((left, right) => left - right);
  return ordered.flatMap((tick, index) => {
    const chord = chordAt(chords, tick);
    if (!chord) return [];
    const barIndex = Math.floor(tick / barTicks);
    const tickWithinBar = tick % barTicks;
    const section = sectionAt(sections, barIndex);
    const key = section?.key ?? settings.key;
    const mode = section?.melodyMode ?? section?.mode ?? settings.mode;
    const isDownbeat = tickWithinBar === 0;
    const isStrongInterior = settings.timeSignature === "4/4"
      ? tickWithinBar === ppq * 2
      : settings.timeSignature === "6/8"
        ? tickWithinBar === beatTicks
        : false;
    const chordOnset = tick === chord.startTick;
    const accent = chordOnset ? 1 : isDownbeat ? 1 : isStrongInterior ? 0.78 : 0.48;
    const nextTick = ordered[index + 1] ?? endTick;
    return [{
      tick,
      endTick: Math.min(endTick, nextTick),
      barIndex,
      chord,
      accent,
      primaryAccent: chordOnset || isDownbeat,
      mandatoryAttack: false,
      cadenceAnchor: false,
      key,
      mode,
    }];
  }).filter((slot) => slot.endTick > slot.tick);
}

function selectAttackedSlots(input: SearchInput, slots: readonly StructuralSlot[]): StructuralSlot[] {
  const density = clamp(input.settings.melody.density, 0, 1);
  const restRate = clamp(input.settings.melody.restRate, 0, 1);
  const attackChance = density * STYLE_ATTACK_ACTIVITY[input.jazz.style] * (1 - restRate);
  const selected = slots.flatMap((slot, index) => {
    const tickWithinBar = slot.tick % input.barTicks;
    const isDownbeat = tickWithinBar === 0;
    const phraseStart = tickWithinBar === 0 && slot.barIndex % 4 === 0;
    const phraseCadence = (slot.barIndex + 1) % 4 === 0
      && tickWithinBar === input.barTicks - input.beatTicks;
    const cadenceEnd = index === slots.length - 1;
    const chordChange = slot.tick === slot.chord.startTick;
    const cadenceAnchor = phraseCadence || cadenceEnd;
    const mandatoryAttack = isDownbeat || phraseStart || phraseCadence || cadenceEnd || chordChange;
    const selected = mandatoryAttack
      || stableJitter(input.seed, "structural-attack", slot.tick) < attackChance;
    return selected ? [{ ...slot, mandatoryAttack, cadenceAnchor }] : [];
  });

  return selected.map((slot, index) => ({
    ...slot,
    // Unattacked structural positions become longer holds. Required chord and
    // barline anchors remain, so a held pitch never crosses a bar without a
    // fresh attack or carries into a different chord.
    endTick: selected[index + 1]?.tick ?? input.endTick,
  }));
}

function allowedPitchClasses(slot: StructuralSlot): Set<number> {
  const scale = new Set(getScaleSemitones(slot.key, slot.mode));
  const tones = chordToneClasses(slot.chord);
  // Structural attacks use written harmony and the active mode. Chromatic and
  // blues inflections are admitted only by the weak-beat grammar below, where
  // their approach and resolution can be checked.
  return new Set([...scale, ...tones]);
}

function pitchesInRange(classes: ReadonlySet<number>, low: number, high: number): number[] {
  const start = Math.max(MIDI_LOW, Math.ceil(low));
  const finish = Math.min(MIDI_HIGH, Math.floor(high));
  const pitches: number[] = [];
  for (let midi = start; midi <= finish; midi += 1) {
    if (classes.has(pc(midi))) pitches.push(midi);
  }
  return pitches;
}

function stableJitter(seed: Seed, ...parts: (string | number)[]): number {
  return hashSeed(deriveSeed(seed, ...parts)) / 0xffffffff;
}

/** Parallel perfect intervals keep the same interval class while both parts move in similar motion. */
export function hasParallelPerfectMotion(
  previousLead: number,
  previousCounter: number,
  lead: number,
  counter: number,
): boolean {
  const leadDelta = lead - previousLead;
  const counterDelta = counter - previousCounter;
  if (leadDelta === 0 || counterDelta === 0 || Math.sign(leadDelta) !== Math.sign(counterDelta)) return false;
  const previousInterval = pc(Math.abs(previousLead - previousCounter));
  const currentInterval = pc(Math.abs(lead - counter));
  return previousInterval === currentInterval && [0, 7].includes(previousInterval);
}

/** A passing event must fill a melodic gap by step on both sides. */
export function isStepwisePassingMotion(previous: number, note: number, next: number): boolean {
  const movesInOneDirection = (previous < note && note < next) || (previous > note && note > next);
  return movesInOneDirection && Math.abs(note - previous) <= 2 && Math.abs(next - note) <= 2;
}

function pitchLocalScore(input: SearchInput, slot: StructuralSlot, midi: number, isLead: boolean): number {
  const chordTones = chordToneClasses(slot.chord);
  const extensions = extensionClasses(slot.chord);
  const scale = new Set(getScaleSemitones(slot.key, slot.mode));
  const pitchClass = pc(midi);
  const isChordTone = chordTones.has(pitchClass);
  const isExtension = extensions.has(pitchClass);
  let score = 0;

  if (isChordTone) score += isExtension ? 4.1 : 4.8;
  else if (scale.has(pitchClass)) score += 0.85;
  else if (input.jazz.form === "blues") score += 0.45;
  else score -= 1.1 + (1 - clamp(input.jazz.chromaticism, 0, 1)) * 1.2;

  if (slot.primaryAccent) score += isChordTone ? 2.2 : -4.2;
  else score += slot.accent * (isChordTone ? 0.95 : -0.18);

  const root = pitchClassToSemitone(slot.chord.root);
  const relative = pc(pitchClass - root);
  // Thirds and sevenths carry the identity of a chord; actual extensions get
  // their own accent without being mistaken for generic scale colour.
  if ([3, 4, 10, 11].includes(relative)) score += slot.accent * 0.95;
  if (isLead) {
    const [rawLow, rawHigh] = [input.settings.melody.minMidi, input.settings.melody.maxMidi];
    const low = clamp(rawLow, MIDI_LOW, MIDI_HIGH);
    const high = clamp(rawHigh, low, MIDI_HIGH);
    const progress = input.endTick > 0 ? slot.tick / input.endTick : 0;
    const arch = Math.sin(Math.PI * clamp(progress / 0.78, 0, 1));
    const target = low + (high - low) * (0.32 + 0.42 * arch);
    score -= Math.abs(midi - target) * 0.035;
  } else {
    // The inner voice has room below and above the lead rather than shadowing
    // its register; the pair search still enforces its declared side.
    score -= Math.abs(midi - 60) * 0.012;
  }

  const finalChord = slot.endTick >= input.endTick;
  if (finalChord && slot.tick >= input.endTick - input.barTicks) {
    if (chordTones.has(pitchClass)) score += 0.75;
    if (slot.chord.function === "tonic" && pitchClass === pitchClassToSemitone(slot.key)) score += 1.6;
  }
  score += stableJitter(input.seed, "theory-voice", slot.tick, isLead ? "lead" : "counter", midi) * 0.28;
  return score;
}

function candidatePitches(input: SearchInput, slot: StructuralSlot): number[] {
  const [configuredLow, configuredHigh] = [input.settings.melody.minMidi, input.settings.melody.maxMidi];
  const low = clamp(configuredLow, MIDI_LOW, MIDI_HIGH);
  const high = clamp(configuredHigh, low, MIDI_HIGH);
  const pitches = pitchesInRange(allowedPitchClasses(slot), low, high);
  if (!slot.primaryAccent) return pitches;
  const chordTones = chordToneClasses(slot.chord);
  const accented = pitches.filter((midi) => chordTones.has(pc(midi)));
  return accented.length > 0 ? accented : pitches;
}

function counterPitchCandidates(
  slot: StructuralSlot,
  lead: number,
  position: "above" | "below",
): number[] {
  const lower = position === "below" ? Math.max(MIDI_LOW, lead - 30) : lead + 3;
  const upper = position === "below" ? lead - 3 : Math.min(MIDI_HIGH, lead + 30);
  const pitches = pitchesInRange(allowedPitchClasses(slot), lower, upper);
  const tones = chordToneClasses(slot.chord);
  if (!slot.primaryAccent) return pitches;
  const accented = pitches.filter((midi) => tones.has(pc(midi)));
  return accented.length > 0 ? accented : pitches;
}

function verticalScore(input: SearchInput, slot: StructuralSlot, lead: number, counter: number): number {
  const interval = Math.abs(lead - counter);
  const intervalClass = pc(interval);
  const tones = chordToneClasses(slot.chord);
  const leadMember = tones.has(pc(lead));
  const counterMember = tones.has(pc(counter));
  let score = 0;
  if ([3, 4, 8, 9].includes(intervalClass)) score += 1.25;
  else if (intervalClass === 7 || intervalClass === 0) score += intervalClass === 0 ? -1.4 : 0.2;
  else if ([1, 2, 5, 6, 10, 11].includes(intervalClass)) {
    // Extensions and blues colours are real vocabulary here, but exposed
    // strong-beat seconds/sevenths are less stable than thirds and sixths.
    score -= slot.primaryAccent ? 2.1 : 0.25;
  }
  if (leadMember && counterMember) score += 1.25;
  if (slot.primaryAccent && (!leadMember || !counterMember)) score -= 1.2;
  const independence = clamp(input.settings.arrangement?.counterpoint?.independence ?? 0.55, 0, 1);
  score += stableJitter(input.seed, "vertical", slot.tick, lead, counter) * (0.2 + 0.2 * independence);
  return score;
}

function isGuideTone(chord: ChordEvent, midi: number): { third: boolean; seventh: boolean } {
  const interval = pc(midi - pitchClassToSemitone(chord.root));
  const third = interval === 3 || interval === 4;
  const seventh = interval === 9 || interval === 10 || interval === 11;
  return { third, seventh };
}

function transitionScore(
  input: SearchInput,
  previous: SearchState,
  current: VoicePair,
  slot: StructuralSlot,
  previousSlot: StructuralSlot,
): number {
  const lineMotion = (from: number, to: number): number => {
    const distance = Math.abs(to - from);
    if (distance === 0) return -0.45;
    if (distance <= 2) return 2.25;
    if (distance <= 4) return 1.65;
    if (distance <= 7) return 0.65;
    if (distance <= 12) return -1.05;
    return -3.4;
  };
  let score = lineMotion(previous.lead, current.lead);
  if (previous.counter !== undefined && current.counter !== undefined) {
    score += lineMotion(previous.counter, current.counter);
    const leadDelta = current.lead - previous.lead;
    const counterDelta = current.counter - previous.counter;
    const independence = clamp(input.settings.arrangement?.counterpoint?.independence ?? 0.55, 0, 1);
    const interaction = clamp(input.jazz.interaction, 0, 1);
    if (leadDelta * counterDelta < 0) score += 1.5 + independence * 1.5 + interaction * 0.55;
    else if (leadDelta === 0 || counterDelta === 0) score += 0.45 + independence + interaction * 0.3;
    else score -= independence * 0.75 + interaction * 0.2;

    const parallelPerfect = hasParallelPerfectMotion(
      previous.lead,
      previous.counter,
      current.lead,
      current.counter,
    );
    if (parallelPerfect) score -= 14;
  }

  if (previousSlot.chord.id !== slot.chord.id) {
    const resolveGuide = (fromMidi: number, toMidi: number): number => {
      const guide = isGuideTone(previousSlot.chord, fromMidi);
      const delta = toMidi - fromMidi;
      if (!chordToneClasses(slot.chord).has(pc(toMidi))) return 0;
      if (guide.third && delta >= 1 && delta <= 2) return 2.3;
      if (guide.seventh && delta <= -1 && delta >= -2) return 2.7;
      return 0;
    };
    score += resolveGuide(previous.lead, current.lead);
    if (previous.counter !== undefined && current.counter !== undefined) {
      score += resolveGuide(previous.counter, current.counter);
    }
  }
  return score;
}

function makePairs(input: SearchInput, slot: StructuralSlot, includeCounter: boolean): VoicePair[] {
  const leadPitches = candidatePitches(input, slot);
  if (!includeCounter) {
    return leadPitches.map((lead) => ({
      lead,
      score: pitchLocalScore(input, slot, lead, true),
    }));
  }

  const counterSettings = input.settings.arrangement?.counterpoint;
  const position = counterSettings?.position ?? "below";
  const pairs: VoicePair[] = [];
  for (const lead of leadPitches) {
    for (const counter of counterPitchCandidates(slot, lead, position)) {
      pairs.push({
        lead,
        counter,
        score: pitchLocalScore(input, slot, lead, true)
          + pitchLocalScore(input, slot, counter, false)
          + verticalScore(input, slot, lead, counter),
      });
    }
  }
  pairs.sort((left, right) => right.score - left.score || left.lead - right.lead || (left.counter ?? 0) - (right.counter ?? 0));
  return pairs.slice(0, MAX_PAIRS_PER_SLOT);
}

function search(input: SearchInput, slots: readonly StructuralSlot[], includeCounter: boolean): SearchState[] | null {
  if (slots.length === 0) return [];
  let beam: SearchState[] = [];
  let previousSlot: StructuralSlot | undefined;
  for (const slot of slots) {
    const pairs = makePairs(input, slot, includeCounter);
    if (pairs.length === 0) return null;
    const next: SearchState[] = [];
    if (!previousSlot) {
      for (const pair of pairs) next.push({ ...pair });
    } else {
      for (const state of beam) {
        const withoutParallelPerfect = pairs.filter((pair) => pair.counter === undefined
          || state.counter === undefined
          || !hasParallelPerfectMotion(state.lead, state.counter, pair.lead, pair.counter));
        // Avoid a parallel perfect whenever this state has any alternative;
        // a tightly clipped register can still force one, so it is not a
        // universal hard rejection.
        const transitions = withoutParallelPerfect.length > 0 ? withoutParallelPerfect : pairs;
        for (const pair of transitions) {
          next.push({
            ...pair,
            score: state.score + pair.score + transitionScore(input, state, pair, slot, previousSlot),
            previous: state,
          });
        }
      }
    }
    next.sort((left, right) => right.score - left.score
      || left.lead - right.lead
      || (left.counter ?? 0) - (right.counter ?? 0));
    beam = next.slice(0, BEAM_WIDTH);
    if (beam.length === 0) return null;
    previousSlot = slot;
  }
  return beam;
}

function toNotes(
  path: readonly SearchState[],
  slots: readonly StructuralSlot[],
  voice: "lead" | "counter",
  input: SearchInput,
): NoteEvent[] {
  const notes: NoteEvent[] = [];
  path.forEach((state, index) => {
    const midi = voice === "lead" ? state.lead : state.counter;
    const slot = slots[index];
    if (midi === undefined || !slot) return;
    const isChordTone = chordToneClasses(slot.chord).has(pc(midi));
    const role: NoteRole = isChordTone ? "chordTone" : "scaleTone";
    const id = hashSeed(deriveSeed(input.seed, "theory-note", voice, slot.tick, midi)).toString(36);
    const span = slot.endTick - slot.tick;
    const restRate = clamp(input.settings.melody.restRate, 0, 1);
    const restAfterAttack = !slot.cadenceAnchor
      && restRate > 0
      && span > 1
      && stableJitter(input.seed, "release-gap", voice, slot.tick) < restRate;
    const gapTicks = restAfterAttack
      ? Math.min(
        span - 1,
        Math.max(1, Math.round(
          (input.ppq / 2)
          * (0.35 + restRate * 0.65)
          * STYLE_REST_GAP[input.jazz.style],
        )),
      )
      : 0;
    notes.push({
      id: `${voice}-${slot.barIndex}-${slot.tick}-${id}`,
      midi,
      noteName: midiToNoteName(midi),
      startTick: slot.tick,
      durationTick: span - gapTicks,
      velocity: Math.max(1, Math.round(input.settings.melody.velocity * (voice === "counter" ? 0.82 : 1))),
      barIndex: slot.barIndex,
      role,
    });
  });
  return notes;
}

function bestPath(finalBeam: readonly SearchState[] | null): SearchState[] {
  const path: SearchState[] = [];
  let state = finalBeam?.[0];
  while (state) {
    path.push(state);
    state = state.previous;
  }
  return path.reverse();
}

function canOrnament(input: SearchInput, previous: NoteEvent, next: NoteEvent): boolean {
  if (next.startTick <= previous.startTick) return false;
  const subdivision = input.ppq / 2;
  if (!Number.isInteger(subdivision)) return false;
  if (previous.barIndex !== next.barIndex) return false;
  const gap = next.startTick - previous.startTick;
  if (gap < subdivision * 2) return false;
  const changesChord = chordAt(input.chords, previous.startTick)?.id
    !== chordAt(input.chords, next.startTick)?.id;
  // A chromatic approach may lead into a within-bar chord change, but only in
  // the immediately preceding beat; the ornament itself must finish at or
  // before the target onset and may never carry over the barline.
  return gap <= input.beatTicks * (changesChord ? 1 : 2);
}

function ornamentCandidate(
  input: SearchInput,
  previous: NoteEvent,
  next: NoteEvent,
  slot: StructuralSlot,
): { midi: number; role: "passing" | "neighbor" | "approach" } | null {
  const scale = new Set(getScaleSemitones(slot.key, slot.mode));
  const chromaticism = clamp(input.jazz.chromaticism, 0, 1);
  const interval = next.midi - previous.midi;
  const candidates: Array<{ midi: number; role: "passing" | "neighbor" | "approach"; score: number }> = [];

  if (Math.abs(interval) >= 3) {
    const bluesRoot = pitchClassToSemitone(slot.chord.root);
    const bluesColors = new Set([
      pc(bluesRoot + 3),
      pc(bluesRoot + 6),
      pc(bluesRoot + 10),
    ]);
    for (let midi = Math.min(previous.midi, next.midi) + 1; midi < Math.max(previous.midi, next.midi); midi += 1) {
      if (pc(midi) === pc(previous.midi) || pc(midi) === pc(next.midi)) continue;
      const diatonic = scale.has(pc(midi));
      const bluesInflection = input.jazz.form === "blues" && bluesColors.has(pc(midi));
      const chromaticPassing = chromaticism > 0.35;
      if ((diatonic || bluesInflection || chromaticPassing)
        && isStepwisePassingMotion(previous.midi, midi, next.midi)) {
        candidates.push({
          midi,
          role: "passing",
          score: diatonic ? 1.5 : 1.05 + chromaticism * 0.3,
        });
      }
    }
  }

  if (interval === 0) {
    for (const direction of [-1, 1]) {
      const midi = previous.midi + direction * 2;
      if (scale.has(pc(midi)) && midi >= MIDI_LOW && midi <= MIDI_HIGH) {
        candidates.push({ midi, role: "neighbor", score: 1.25 - Math.abs(midi - (previous.midi + interval / 2)) * 0.04 });
      }
    }
  }

  // Chromatic approaches are restricted to a semitone resolution into a new
  // chord event; the chromaticism control changes their frequency, not their
  // syntax.
  if (chromaticism > 0.25 && chordAt(input.chords, next.startTick)?.id !== slot.chord.id) {
    for (const midi of [next.midi - 1, next.midi + 1]) {
      if (midi >= MIDI_LOW && midi <= MIDI_HIGH && !scale.has(pc(midi))) {
        candidates.push({ midi, role: "approach", score: chromaticism + 0.6 });
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((left, right) => right.score - left.score
    || Math.abs(left.midi - (previous.midi + next.midi) / 2) - Math.abs(right.midi - (previous.midi + next.midi) / 2)
    || left.midi - right.midi);
  return candidates[0] ?? null;
}

function decorateWeakBeats(input: SearchInput, notes: NoteEvent[], slots: readonly StructuralSlot[], voice: "lead" | "counter"): NoteEvent[] {
  if (notes.length < 2) return notes;
  const result: NoteEvent[] = [];
  for (let index = 0; index < notes.length; index += 1) {
    const current = notes[index];
    if (!current) continue;
    const next = notes[index + 1];
    if (!next || !canOrnament(input, current, next)) {
      result.push(current);
      continue;
    }
    const slot = slots[index];
    if (!slot) {
      result.push(current);
      continue;
    }
    const restRate = clamp(input.settings.melody.restRate, 0, 1);
    const ornaments = clamp(
      (input.settings.melody.density * 0.25
        + STYLE_ATTACK_ACTIVITY[input.jazz.style] * 0.25
        + input.jazz.chromaticism * 0.18) * (1 - restRate),
      0.03,
      0.72,
    );
    const take = stableJitter(input.seed, "weak-beat", voice, current.startTick) < ornaments;
    const candidate = take ? ornamentCandidate(input, current, next, slot) : null;
    if (!candidate) {
      result.push(current);
      continue;
    }
    const startTick = current.startTick + input.ppq / 2;
    if (!Number.isInteger(startTick) || startTick >= next.startTick) {
      result.push(current);
      continue;
    }
    const chord = chordAt(input.chords, startTick);
    const role: NoteRole = chordToneClasses(chord ?? slot.chord).has(pc(candidate.midi))
      ? "chordTone"
      : candidate.role;
    const id = hashSeed(deriveSeed(input.seed, "theory-ornament", voice, startTick, candidate.midi)).toString(36);
    result.push({
      ...current,
      durationTick: Math.min(current.durationTick, startTick - current.startTick),
    });
    result.push({
      id: `${voice}-ornament-${current.barIndex}-${startTick}-${id}`,
      midi: candidate.midi,
      noteName: midiToNoteName(candidate.midi),
      startTick,
      durationTick: Math.min(input.ppq / 2, next.startTick - startTick),
      velocity: Math.max(1, Math.round(current.velocity * 0.82)),
      barIndex: Math.floor(startTick / input.barTicks),
      role,
    });
  }
  return result;
}

export interface ComposeTheoryVoicesOptions {
  settings: GeneratorSettings;
  jazz: JazzSettings;
  chords: readonly ChordEvent[];
  sections?: readonly SectionEvent[];
  ppq: number;
  seed?: string | number;
}

/** Jointly writes a melody and optional countermelody from harmony and meter. */
export function composeTheoryVoices({
  settings,
  jazz,
  chords,
  sections,
  ppq,
  seed = settings.seed,
}: ComposeTheoryVoicesOptions): { melody: NoteEvent[]; countermelody?: NoteEvent[] } {
  if (!Number.isInteger(ppq) || ppq <= 0) throw new RangeError("ppq must be a positive integer.");
  if (chords.length === 0 || settings.bars < 1) return { melody: [] };
  const barTicks = ticksPerBar(settings.timeSignature, ppq);
  const beatTicks = settings.timeSignature === "6/8" ? (ppq * 3) / 2 : ppq;
  if (!Number.isInteger(beatTicks)) throw new RangeError("ppq must yield integer beat ticks.");
  const chordEnd = Math.max(...chords.map((chord) => chord.startTick + chord.durationTick));
  const endTick = Math.min(barTicks * settings.bars, chordEnd);
  const input: SearchInput = {
    settings,
    jazz,
    chords,
    sections,
    ppq,
    seed,
    barTicks,
    beatTicks,
    endTick,
  };
  const allSlots = buildSlots(input);
  const slots = selectAttackedSlots(input, allSlots);
  if (slots.length === 0) return { melody: [] };

  const wantsCounter = settings.arrangement?.counterpoint?.enabled === true;
  const jointPath = wantsCounter ? search(input, slots, true) : null;
  // If the chosen side/register leaves even one structural position with no
  // legal second pitch, keep a truthful lead-only result instead of returning
  // a partial line and calling it counterpoint.
  const path = bestPath(jointPath ?? search(input, slots, false));
  const orderedPath = path;
  const lead = toNotes(orderedPath, slots, "lead", input);
  const melody = decorateWeakBeats(input, lead, slots, "lead");
  if (!wantsCounter || !jointPath || path.length !== slots.length) return { melody };
  const counter = toNotes(orderedPath, slots, "counter", input);
  if (counter.length !== slots.length) return { melody };
  return { melody, countermelody: decorateWeakBeats(input, counter, slots, "counter") };
}
