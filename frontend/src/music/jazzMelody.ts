import type {
  ChordEvent,
  GeneratorSettings,
  NoteEvent,
  NoteRole,
  SectionEvent,
} from "../types/music";
import { intervalsForQuality } from "./chords";
import { applyGroove } from "./groove";
import { createSeededRandom, deriveSeed, hashSeed } from "./random";
import { getScaleMidiNotes, midiToNoteName, pitchClassToSemitone } from "./scales";
import { ticksPerBar } from "./time";
import { jazzProfileFor, jazzSettingsOf, type JazzSettings } from "./jazzProfiles";

export interface JazzMelodyOptions {
  settings: GeneratorSettings;
  jazz: JazzSettings;
  chords: readonly ChordEvent[];
  sections?: readonly SectionEvent[];
  ppq: number;
  seed?: string | number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function activeChord(chords: readonly ChordEvent[], tick: number): ChordEvent | undefined {
  return chords.find(
    (chord) => tick >= chord.startTick && tick < chord.startTick + chord.durationTick,
  );
}

function nextChord(chords: readonly ChordEvent[], chord: ChordEvent): ChordEvent | undefined {
  return chords.find((candidate) => candidate.startTick > chord.startTick);
}

function nearestPitch(
  pitchClass: number,
  around: number,
  minMidi: number,
  maxMidi: number,
): number {
  const normalized = ((pitchClass % 12) + 12) % 12;
  const candidates: number[] = [];
  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    if (midi % 12 === normalized) candidates.push(midi);
  }
  if (candidates.length === 0) return Math.min(maxMidi, Math.max(minMidi, Math.round(around)));
  return candidates.reduce((best, candidate) => {
    const distance = Math.abs(candidate - around);
    const bestDistance = Math.abs(best - around);
    return distance < bestDistance || (distance === bestDistance && candidate > best)
      ? candidate
      : best;
  }, candidates[0] as number);
}

function guideTone(chord: ChordEvent, preferSeventh: boolean): number {
  const intervals = intervalsForQuality(chord.quality);
  const third = intervals.find((interval) => interval === 3 || interval === 4) ?? intervals[0] ?? 0;
  const seventh = intervals.find((interval) => interval === 10 || interval === 11);
  return pitchClassToSemitone(chord.root) + (preferSeventh && seventh !== undefined ? seventh : third);
}

function plannedTargetMidi(
  chord: ChordEvent,
  targetBar: number,
  range: readonly [number, number],
): number {
  const preferSeventh = targetBar % 2 === 1;
  const centre = (range[0] + range[1]) / 2 + ((targetBar % 4) - 1.5) * 2;
  return nearestPitch(guideTone(chord, preferSeventh), centre, range[0], range[1]);
}

function semitoneAround(
  targetMidi: number,
  preferredDirection: -1 | 1,
  range: readonly [number, number],
): { midi: number; direction: -1 | 1 } | undefined {
  const preferred = targetMidi + preferredDirection;
  if (preferred >= range[0] && preferred <= range[1]) {
    return { midi: preferred, direction: preferredDirection };
  }
  const opposite: -1 | 1 = preferredDirection === 1 ? -1 : 1;
  const fallback = targetMidi + opposite;
  if (fallback >= range[0] && fallback <= range[1]) {
    return { midi: fallback, direction: opposite };
  }
  return undefined;
}

function scaleForBar(
  settings: GeneratorSettings,
  section: SectionEvent | undefined,
): number[] {
  return getScaleMidiNotes(
    section?.key ?? settings.key,
    section?.melodyMode ?? section?.mode ?? settings.mode,
    settings.melody.minMidi,
    settings.melody.maxMidi,
  );
}

function onsetPattern(style: JazzSettings["style"]): readonly number[] {
  switch (style) {
    case "ballad":
      return [0, 960];
    case "bebop":
      return [0, 240, 480, 720, 960, 1200, 1440, 1680];
    case "modern":
      return [0, 480, 960, 1440];
    case "neoSoul":
      return [0, 360, 720, 1200, 1560];
    case "swing":
    default:
      return [0, 240, 480, 720, 960, 1200, 1440, 1680];
  }
}

function gateFor(style: JazzSettings["style"], slot: number): number {
  if (style === "ballad") return slot === 0 ? 0.88 : 0.76;
  if (style === "modern") return slot % 2 === 0 ? 0.72 : 0.48;
  if (style === "neoSoul") return slot === 0 ? 0.6 : 0.38;
  return style === "bebop" ? 0.48 : 0.58;
}

function roleFor(approach: boolean, enclosure: boolean, chordTone: boolean): NoteRole {
  if (enclosure) return "neighbor";
  if (approach) return "approach";
  return chordTone ? "chordTone" : "scaleTone";
}

/**
 * Writes the lead against guide-tone targets.  The final attack before a chord
 * boundary aims at the next chord's third/seventh; the preceding attacks are
 * semitone approaches or enclosures, while the rest are scale/motif material.
 * This is intentionally deterministic and does not use a corpus model.
 */
export function generateJazzMelody(options: JazzMelodyOptions): NoteEvent[] {
  const { settings, jazz, chords } = options;
  const barTicks = ticksPerBar(settings.timeSignature, options.ppq);
  const pattern = onsetPattern(jazz.style);
  const profile = jazzProfileFor(jazz);
  const random = createSeededRandom(options.seed ?? settings.seed);
  const range: readonly [number, number] = [settings.melody.minMidi, settings.melody.maxMidi];
  const notes: NoteEvent[] = [];
  const motif = [0, 2, 4, 2, 1, 0, -1, 0];
  const chromaticism = clamp01(jazz.chromaticism);
  const interaction = clamp01(jazz.interaction);

  for (let barIndex = 0; barIndex < settings.bars; barIndex += 1) {
    const barStart = barIndex * barTicks;
    const section = options.sections?.find(
      (candidate) => barIndex >= candidate.startBar && barIndex < candidate.endBar,
    );
    const scale = scaleForBar(settings, section);
    const barNotes: NoteEvent[] = [];
    const density = clamp01(settings.melody.density * profile.melodyDensity * 1.45);
    const restRate = clamp01(
      settings.melody.restRate * (jazz.style === "ballad" ? 1.35 : 0.72)
        + interaction * (jazz.style === "modern" ? 0.18 : 0.08),
    );
    let previousMidi = nearestPitch(
      guideTone(activeChord(chords, barStart) ?? chords[0] as ChordEvent, false),
      (range[0] + range[1]) / 2,
      range[0],
      range[1],
    );
    const resolutionRoll = hashSeed(deriveSeed(options.seed ?? settings.seed, "resolution", barIndex)) % 1000 / 1000;
    const chromaticResolution = resolutionRoll < chromaticism;

    for (let slotIndex = 0; slotIndex < pattern.length; slotIndex += 1) {
      const localStart = pattern[slotIndex] as number;
      if (localStart >= barTicks) continue;
      const chord = activeChord(chords, barStart + localStart);
      if (!chord) continue;
      const isFirst = slotIndex === 0;
      const isLast = slotIndex === pattern.length - 1 || (pattern[slotIndex + 1] as number) >= barTicks;
      const following = nextChord(chords, chord);
      const boundaryTarget = following !== undefined && following.startTick <= barStart + barTicks;
      const resolving = isLast && boundaryTarget;
      const targetChord = (resolving || (slotIndex === pattern.length - 2 && boundaryTarget)) && following
        ? following
        : chord;
      // Guarantee both members of an enclosure when the seeded chromatic
      // decision is on.  The second member below resolves to the exact guide
      // tone chosen from the target chord.
      const enclosureRequested = slotIndex === pattern.length - 2
        && boundaryTarget
        && chromaticResolution;
      const guaranteed = isFirst || isLast || enclosureRequested || (jazz.style === "ballad" && slotIndex === 1);
      // Density gates inner attacks; the phrase boundary always has a target.
      if (!guaranteed && (random.next() > density || random.next() < restRate)) continue;

      // The target's own bar determines whether its third or seventh is the
      // guide tone.  Using the source bar here would make an approach resolve
      // to a different colour than the target attack at the next boundary.
      const targetBar = Math.floor(targetChord.startTick / barTicks);
      const preferSeventh = targetBar % 2 === 1;
      const targetPc = guideTone(targetChord, preferSeventh);
      const targetMidi = plannedTargetMidi(targetChord, targetBar, range);
      const motifDegree = motif[(barIndex % 4) * 2 + (slotIndex % 2)] as number;
      let midi = isFirst || resolving
        ? targetMidi
        : nearestPitch(targetPc, previousMidi + motifDegree, range[0], range[1]);
      let approach = false;
      let enclosure = false;
      let isolatedNeighbor = false;
      if (enclosureRequested) {
        const direction: -1 | 1 = (barIndex + slotIndex) % 2 === 0 ? 1 : -1;
        const candidate = semitoneAround(targetMidi, direction, range);
        if (candidate) {
          midi = candidate.midi;
          enclosure = true;
        }
      } else if (resolving && slotIndex > 0 && chromaticResolution) {
        const precedingSlot = Math.max(0, slotIndex - 1);
        const enclosureDirection: -1 | 1 = (barIndex + precedingSlot) % 2 === 0 ? 1 : -1;
        const candidate = semitoneAround(targetMidi, enclosureDirection === 1 ? -1 : 1, range);
        if (candidate) {
          midi = candidate.midi;
          approach = true;
        }
      } else if (!isFirst && (barIndex + slotIndex) % 5 === 0 && random.next() < chromaticism) {
        // A single neighbour is not called an enclosure: without its paired
        // companion and following target it is only surface colour.
        const direction: -1 | 1 = slotIndex % 2 === 0 ? 1 : -1;
        const targetAnchor = nearestPitch(targetPc, previousMidi, range[0], range[1]);
        const candidate = semitoneAround(targetAnchor, direction, range);
        if (candidate) {
          midi = candidate.midi;
          isolatedNeighbor = true;
        }
      } else if (!isFirst && scale.length > 0) {
        // Apply the motif as a scale-step displacement from the nearest scale
        // pitch, rather than using raw MIDI modulo as an array index.  This
        // keeps repeated cells recognisable while preventing octave-sized,
        // register-dependent leaps.
        const nearestScaleIndex = scale.reduce((best, pitch, index) =>
          Math.abs((pitch as number) - previousMidi) < Math.abs((scale[best] as number) - previousMidi)
            ? index
            : best, 0);
        const scaleIndex = Math.min(
          scale.length - 1,
          Math.max(0, nearestScaleIndex + motifDegree),
        );
        midi = scale[scaleIndex] as number;
      }
      midi = Math.min(range[1], Math.max(range[0], Math.round(midi)));
      const nextLocal = pattern[slotIndex + 1] ?? barTicks;
      const available = Math.max(1, Math.min(barTicks - localStart, nextLocal - localStart));
      const durationTick = Math.max(1, Math.min(available - 1, Math.round(available * gateFor(jazz.style, slotIndex))));
      const velocityBase = settings.melody.velocity;
      const accent = isFirst ? 1.08 : isLast ? 1.02 : profile.articulation === "bebop" ? 0.86 : 0.94;
      const velocity = Math.min(127, Math.max(1, Math.round(velocityBase * accent)));
      const startTick = barStart + localStart;
      const role = roleFor(approach, enclosure || isolatedNeighbor, chord.notes.some((note) => note % 12 === midi % 12));
      barNotes.push({
        id: `jazz-melody-${barIndex}-${slotIndex}-${hashSeed(deriveSeed(options.seed ?? settings.seed, "melody", barIndex, slotIndex)).toString(36)}`,
        midi,
        noteName: midiToNoteName(midi),
        startTick,
        durationTick,
        velocity,
        barIndex,
        role,
      });
      previousMidi = midi;
    }

    // A high rest setting must still leave a phrase anchor in each bar.  This
    // also gives the comping responder a concrete line to listen around.
    if (barNotes.length === 0) {
      const chord = activeChord(chords, barStart) ?? chords[0];
      if (chord) {
        const midi = nearestPitch(guideTone(chord, barIndex % 2 === 1), previousMidi, range[0], range[1]);
        barNotes.push({
          id: `jazz-melody-${barIndex}-anchor-${hashSeed(deriveSeed(options.seed ?? settings.seed, "anchor", barIndex)).toString(36)}`,
          midi,
          noteName: midiToNoteName(midi),
          startTick: barStart,
          durationTick: Math.max(1, Math.round(barTicks * (jazz.style === "ballad" ? 0.8 : 0.42))),
          velocity: Math.min(127, Math.max(1, Math.round(settings.melody.velocity * 1.04))),
          barIndex,
          role: "chordTone",
        });
      }
    }
    notes.push(...barNotes);
  }
  if (jazz.style !== "swing") return notes;
  // The lead owns its own swing performance pass.  Bass remains straight and
  // comping receives its separate upper-voice pass in jazzArrangement, so no
  // track sees the same timing transform twice.
  const swingAmount = Math.min(0.84, Math.max(0.46, 0.58 + (settings.bpm - 144) / -260));
  return applyGroove(notes, {
    timeSignature: settings.timeSignature,
    ppq: options.ppq,
    settings: { enabled: true, template: "swing8", amount: swingAmount },
  });
}

/** Compatibility helper for callers that only have an optional field. */
export function jazzMelodySettings(settings: GeneratorSettings): JazzSettings | undefined {
  return jazzSettingsOf(settings);
}
