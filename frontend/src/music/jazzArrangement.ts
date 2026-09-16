import type { GeneratedComposition, NoteEvent } from "../types/music";
import type { CompositionTrack } from "./compositionTracks";
import { intervalsForQuality } from "./chords";
import { applyGroove } from "./groove";
import { midiToNoteName, pitchClassToSemitone } from "./scales";
import { ticksPerBeat } from "./time";
import { jazzProfileFor, jazzSettingsOf, type JazzSettings } from "./jazzProfiles";
import { rootMidiForChord } from "./jazzHarmony";

const KEYBOARD_MIN_MIDI = 21;
const KEYBOARD_MAX_MIDI = 108;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function activeChord(
  composition: GeneratedComposition,
  tick: number,
): GeneratedComposition["chords"][number] | undefined {
  // Edits can leave the array in insertion order and a split chord can overlap
  // its predecessor for one tick.  The most recently started event is the
  // audible one at an attack; never let array order choose the harmony.
  return [...composition.chords]
    .filter((chord) => tick >= chord.startTick && tick < chord.startTick + chord.durationTick)
    .sort((left, right) => right.startTick - left.startTick || right.id.localeCompare(left.id))[0];
}

function nextChord(
  composition: GeneratedComposition,
  chord: GeneratedComposition["chords"][number],
): GeneratedComposition["chords"][number] | undefined {
  return [...composition.chords]
    .filter((candidate) => candidate.startTick > chord.startTick)
    .sort((left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id))[0];
}

function isWithinKeyboard(midi: number): boolean {
  return Number.isFinite(midi) && midi >= KEYBOARD_MIN_MIDI && midi <= KEYBOARD_MAX_MIDI;
}

function clampNoteToBoundary(
  note: NoteEvent,
  boundaryTick: number,
  totalTicks: number,
): NoteEvent | undefined {
  const startTick = Math.min(
    Math.max(0, Math.round(note.startTick)),
    Math.max(0, totalTicks - 1),
    Math.max(0, boundaryTick - 1),
  );
  const endTick = Math.min(
    totalTicks,
    boundaryTick,
    startTick + Math.max(1, Math.round(note.durationTick)),
  );
  if (endTick <= startTick) return undefined;
  return { ...note, startTick, durationTick: endTick - startTick };
}

function normalizeBass(midi: number): number {
  let value = Math.round(midi);
  while (value < 28) value += 12;
  while (value > 55) value -= 12;
  return Math.min(55, Math.max(28, value));
}

function nearestBassPitch(pitchClass: number, around: number): number {
  const normalized = ((pitchClass % 12) + 12) % 12;
  let best = normalizeBass(around);
  let distance = Number.POSITIVE_INFINITY;
  for (let midi = 28; midi <= 55; midi += 1) {
    if (midi % 12 !== normalized) continue;
    const candidateDistance = Math.abs(midi - around);
    if (candidateDistance < distance) {
      best = midi;
      distance = candidateDistance;
    }
  }
  return best;
}

function bassOffsets(
  style: JazzSettings["style"],
  beatTicks: number,
  timeSignature: GeneratedComposition["timeSignature"],
): number[] {
  if (timeSignature === "6/8") {
    switch (style) {
      case "ballad":
      case "modern":
        return [0, beatTicks];
      case "neoSoul":
        return [0, Math.round(beatTicks * 0.5), beatTicks];
      case "bebop":
      case "swing":
      default:
        return [0, Math.round(beatTicks * 0.5), beatTicks, Math.round(beatTicks * 1.5)];
    }
  }
  switch (style) {
    case "ballad":
      return [0, beatTicks * 2];
    case "modern":
      return [0, beatTicks * 2];
    case "neoSoul":
      return [0, Math.round(beatTicks * 1.5), beatTicks * 3];
    case "bebop":
    case "swing":
    default:
      return [0, beatTicks, beatTicks * 2, beatTicks * 3];
  }
}

function compingOffsets(
  style: JazzSettings["style"],
  beatTicks: number,
  timeSignature: GeneratedComposition["timeSignature"],
): number[] {
  if (timeSignature === "6/8") {
    switch (style) {
      case "ballad":
        return [0];
      case "bebop":
        return [Math.round(beatTicks * 0.5), Math.round(beatTicks * 1.5)];
      case "modern":
        return [0, beatTicks];
      case "neoSoul":
        return [0, Math.round(beatTicks * 0.5), beatTicks];
      case "swing":
      default:
        return [0, Math.round(beatTicks * 0.5), beatTicks];
    }
  }
  switch (style) {
    case "ballad":
      return [0];
    case "bebop":
      return [Math.round(beatTicks * 0.5), Math.round(beatTicks * 2.5), Math.round(beatTicks * 3.5)];
    case "modern":
      return [0, beatTicks * 2];
    case "neoSoul":
      return [0, Math.round(beatTicks * 1.5), Math.round(beatTicks * 3.25)];
    case "swing":
    default:
      return [0, Math.round(beatTicks * 1.5), beatTicks * 3];
  }
}

function roleGroove(
  style: JazzSettings["style"],
  role: "bass" | "chords" | "melody",
): "straight" | "swing8" | "laidBack" {
  // The walking foundation stays on the beat while the upper voices carry
  // swing.  This is a role distinction, not a second groove pass.
  if (style === "swing") return role === "bass" ? "straight" : "swing8";
  if (style === "ballad") return role === "bass" ? "straight" : "laidBack";
  // Neo-soul pocket and bebop articulation are encoded by their onsets/gates;
  // applying a generic delay would smear the authored syncopation.
  return "straight";
}

function makeNote(
  id: string,
  midi: number,
  startTick: number,
  durationTick: number,
  velocity: number,
  barIndex: number,
  role: NoteEvent["role"],
): NoteEvent {
  return {
    id,
    midi,
    noteName: midiToNoteName(midi),
    startTick,
    durationTick: Math.max(1, durationTick),
    velocity: Math.min(127, Math.max(1, Math.round(velocity))),
    barIndex,
    role,
  };
}

function sortNotes(notes: NoteEvent[]): NoteEvent[] {
  return notes.sort((left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id));
}

/**
 * Comping density is an authored rhythmic policy, not a per-generation draw.
 * Keeping it independent of `composition.seed` means regenerating a locked
 * melody range cannot silently reshuffle the accompaniment underneath it.
 */
function compingSlotIsActive(density: number, barIndex: number, attackIndex: number): boolean {
  const period = 8;
  const activeSlots = Math.max(1, Math.round(clamp01(density) * period));
  return ((barIndex * 3 + attackIndex * 5) % period) < activeSlots;
}

/**
 * Builds the three base tracks from the composition payload itself.  In
 * particular, this never calls the harmony generator: edited chord notes and
 * edited lead onsets are the source of truth for playback and export.
 */
export function buildJazzCompositionTracks(
  composition: GeneratedComposition,
): CompositionTrack[] {
  const jazz = jazzSettingsOf(composition.settings);
  if (!jazz) return [];
  const profile = jazzProfileFor(jazz);
  const barTicks = composition.ticksPerBar;
  const beatTicks = ticksPerBeat(composition.timeSignature, composition.ppq);
  const interaction = clamp01(jazz.interaction);
  const bassNotes: NoteEvent[] = [];
  const chordNotes: NoteEvent[] = [];

  for (let barIndex = 0; barIndex < composition.settings.bars; barIndex += 1) {
    const barStart = barIndex * barTicks;
    const barEnd = barStart + barTicks;
    const chord = activeChord(composition, barStart);
    if (!chord) continue;
    // A hand edit may split a bar between two or more chords.  Re-articulate at
    // every internal boundary so every attack resolves against the chord that
    // actually sounds at that tick, rather than borrowing the bar's first one.
    const chordBoundaries = composition.chords
      .filter((candidate) => candidate.startTick > barStart && candidate.startTick < barEnd)
      .map((candidate) => candidate.startTick);
    const bassStarts = [...new Set([
      ...bassOffsets(jazz.style, beatTicks, composition.timeSignature),
      ...chordBoundaries.map((tick) => tick - barStart),
    ])]
      .filter((offset) => offset < barTicks)
      .sort((left, right) => left - right)
      .map((offset) => barStart + offset);
    let previousBass = rootMidiForChord(chord);
    for (let index = 0; index < bassStarts.length; index += 1) {
      const startTick = bassStarts[index] as number;
      const chordAtAttack = activeChord(composition, startTick);
      if (!chordAtAttack) continue;
      const following = nextChord(composition, chordAtAttack);
      let midi: number;
      let bassRole: NoteEvent["role"] = "chordTone";
      const nextStart = bassStarts[index + 1] ?? barEnd;
      const boundaryTick = chordAtAttack.startTick + chordAtAttack.durationTick;
      const isBeforeActualBoundary = following !== undefined
        && following.startTick === boundaryTick
        && following.startTick === nextStart
        && startTick > chordAtAttack.startTick
        && startTick < boundaryTick;
      if (isBeforeActualBoundary) {
        // The final attack is an intentional approach into the next root.  The
        // next chord's downbeat then lands on the target rather than cycling the
        // current chord's pitch classes as the legacy bass did.
        const targetMidi = rootMidiForChord(following);
        const direction = (barIndex + index) % 2 === 0 ? -1 : 1;
        // Resolve the approach around the exact target register, not around a
        // pitch class whose octave would be chosen by the previous note.
        midi = normalizeBass(targetMidi + direction);
        bassRole = "approach";
      } else if (startTick === chordAtAttack.startTick || index === 0) {
        midi = rootMidiForChord(chordAtAttack);
      } else {
        const qualityIntervals = intervalsForQuality(chordAtAttack.quality);
        const interval = qualityIntervals[(index + barIndex) % qualityIntervals.length] ?? 0;
        midi = nearestBassPitch(pitchClassToSemitone(chordAtAttack.root) + interval, previousBass);
      }
      midi = normalizeBass(midi);
      const chordEnd = Math.min(chordAtAttack.startTick + chordAtAttack.durationTick, barEnd);
      const available = Math.min(nextStart, chordEnd) - startTick;
      if (available <= 0) continue;
      bassNotes.push(makeNote(
        `jazz-bass-${barIndex}-${index}`,
        midi,
        startTick,
        Math.max(1, Math.min(available - 1, Math.round(available * (jazz.style === "ballad" ? 0.9 : 0.76)))),
        70 + (index === 0 ? 10 : 0),
        barIndex,
        bassRole,
      ));
      previousBass = midi;
    }

    const leadInBar = composition.notes.filter(
      (note) => note.startTick >= barStart && note.startTick < barEnd,
    );
    const regularAttacks = compingOffsets(jazz.style, beatTicks, composition.timeSignature)
      .filter((offset) => offset < barTicks)
      .map((offset) => barStart + offset);
    const attacks = [...new Set([...regularAttacks, ...chordBoundaries])].sort((a, b) => a - b);
    for (let attackIndex = 0; attackIndex < attacks.length; attackIndex += 1) {
      const startTick = attacks[attackIndex] as number;
      const chordAtAttack = activeChord(composition, startTick);
      if (!chordAtAttack) continue;
      const sourcePitches = [...chordAtAttack.notes]
        .filter(isWithinKeyboard)
        .sort((left, right) => left - right);
      const explicitLeft = new Set(chordAtAttack.leftHand ?? []);
      const upper = sourcePitches.filter((pitch) => !explicitLeft.has(pitch));
      const playable = (upper.length > 0 ? upper : sourcePitches).slice(-4);
      if (playable.length === 0) continue;
      const nearbyLead = leadInBar.some(
        (note) => Math.abs(note.startTick - startTick) <= Math.round(beatTicks * 0.26),
      );
      const hasSpace = !nearbyLead;
      // High interaction means the pianist listens: a lead attack wins the
      // slot, while a gap gets a brighter/stronger response.
      if (nearbyLead && interaction > 0.72 && jazz.style !== "bebop") continue;
      if (!compingSlotIsActive(profile.compingDensity, barIndex, attackIndex)) continue;
      const nextStart = attacks[attackIndex + 1] ?? barEnd;
      const gate = jazz.style === "ballad" ? 0.9 : jazz.style === "modern" ? 0.6 : 0.42;
      const chordEnd = Math.min(chordAtAttack.startTick + chordAtAttack.durationTick, barEnd);
      const available = Math.min(nextStart, chordEnd) - startTick;
      if (available <= 0) continue;
      const durationTick = Math.max(1, Math.min(available - 1, Math.round(available * gate)));
      const velocity = 58 + (hasSpace ? 14 : 2) + (jazz.style === "bebop" ? 5 : 0);
      for (let pitchIndex = 0; pitchIndex < playable.length; pitchIndex += 1) {
        const pitch = playable[pitchIndex] as number;
        chordNotes.push(makeNote(
          `jazz-comp-${barIndex}-${attackIndex}-${pitchIndex}`,
          pitch,
          startTick,
          durationTick,
          velocity - pitchIndex * 4,
          barIndex,
          pitchIndex === playable.length - 1 ? "chordTone" : "scaleTone",
        ));
      }
    }
  }

  const swingAmount = Math.min(0.84, Math.max(0.46, 0.58 + (144 - composition.settings.bpm) / 260));
  const applyRoleGroove = (notes: NoteEvent[], role: "bass" | "chords"): NoteEvent[] => {
    const source = sortNotes(notes);
    const grooved = applyGroove(source, {
      timeSignature: composition.timeSignature,
      ppq: composition.ppq,
      settings: {
        enabled: true,
        template: roleGroove(jazz.style, role),
        amount: jazz.style === "swing" ? swingAmount : jazz.style === "ballad" ? 0.28 : 0,
      },
    });
    // applyGroove knows bar limits, while this renderer also has harmonic
    // limits. Preserve each note's authored chord boundary even if a swung
    // attack is delayed toward the next chord.
    const boundaries = new Map(source.map((note) => {
      const chord = activeChord(composition, note.startTick);
      return [note.id, chord
        ? Math.min(composition.totalTicks, chord.startTick + chord.durationTick)
        : composition.totalTicks] as const;
    }));
    return sortNotes(grooved.flatMap((note) => {
      const boundary = boundaries.get(note.id) ?? composition.totalTicks;
      const constrained = clampNoteToBoundary(note, boundary, composition.totalTicks);
      return constrained && isWithinKeyboard(constrained.midi) ? [constrained] : [];
    }));
  };
  const grooveBass = applyRoleGroove(bassNotes, "bass");
  const grooveChords = applyRoleGroove(chordNotes, "chords");
  // Melody timing is already authored by jazzMelody (including any intentional
  // swing).  Re-applying a groove here made playback and export disagree with
  // the source composition and doubled the delay on swing offbeats.
  const grooveMelody = sortNotes(composition.notes
    .filter((note) => isWithinKeyboard(note.midi))
    .map((note) => ({ ...note })));
  return [
    {
      id: "track-bass",
      name: "Bass / Walking target",
      role: "bass",
      color: "var(--track-bass)",
      fill: "var(--track-bass-fill)",
      midiChannel: 0,
      notes: grooveBass,
      editable: false,
      muted: false,
      hand: "left",
    },
    {
      id: "track-chords",
      name: "Jazz comping",
      role: "chords",
      color: "var(--track-chords)",
      fill: "var(--track-chords-fill)",
      midiChannel: 1,
      notes: grooveChords,
      editable: false,
      muted: false,
      hand: "right",
    },
    {
      id: "track-melody",
      name: "Jazz melody",
      role: "melody",
      color: "var(--track-melody)",
      fill: "var(--track-melody-fill)",
      midiChannel: 2,
      notes: grooveMelody,
      editable: true,
      muted: false,
      hand: "right",
    },
    ...(composition.voices ?? []).map((voice): CompositionTrack => ({
      id: `track-${voice.id}`,
      name: voice.name,
      role: voice.role,
      color: voice.color,
      fill: voice.fill,
      midiChannel: Math.min(15, voice.midiChannel + 1),
      notes: voice.notes
        .filter((note) => isWithinKeyboard(note.midi))
        .map((note) => ({ ...note })),
      editable: false,
      muted: voice.muted ?? false,
      sourceVoiceId: voice.id,
    })),
  ];
}
