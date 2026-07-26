import {
  PPQ,
  type GrooveTemplateName,
  type NoteEvent,
  type StylePresetId,
  type TimeSignature,
} from "../types/music";
import { ticksPerBar } from "./time";

/**
 * Groove templates.
 *
 * Everything the engine placed sat exactly on the grid. That is what a score
 * says and not what anyone plays: a shuffle is late eighths, a bossa pushes
 * certain sixteenths ahead of the beat, and a backbeat is a velocity shape
 * rather than a note choice. None of it is expressible as which notes to play,
 * which is why none of it existed here.
 *
 * A groove template is two curves over the bar's grid — how late each step is
 * played, and how hard — applied to notes that have already been chosen. It
 * changes the performance, not the composition.
 */

/**
 * Alias of the settings-level name rather than a second declaration, so the two
 * lists cannot drift apart.
 */
export type GrooveTemplateId = GrooveTemplateName;

export interface GrooveTemplate {
  id: GrooveTemplateId;
  label: string;
  /** Steps per bar the curves are defined over. */
  resolution: number;
  /**
   * Delay per step, as a fraction of one step. Positive is late.
   *
   * A fraction rather than ticks so a template reads the same at any PPQ and in
   * any time signature — a swing is a proportion of the beat, not a duration.
   */
  timing: readonly number[];
  /** Velocity multiplier per step. */
  accent: readonly number[];
  /** Styles this groove belongs to. */
  styles?: readonly StylePresetId[];
}

/** Repeats a short cycle up to a full bar's worth of steps. */
function cycle(values: readonly number[], resolution: number): number[] {
  return Array.from({ length: resolution }, (_, index) => values[index % values.length] as number);
}

/**
 * Swing expressed as the delay on every second step.
 *
 * A triplet swing puts the off-beat two thirds of the way through the beat
 * rather than halfway, which is a delay of one sixth of a beat — a third of a
 * step when the step is half a beat.
 */
function swungTiming(resolution: number, ratio: number): number[] {
  const delay = (ratio - 0.5) * 2;
  return Array.from({ length: resolution }, (_, index) => (index % 2 === 1 ? delay : 0));
}

export const GROOVE_TEMPLATES: Readonly<Record<GrooveTemplateId, GrooveTemplate>> = {
  straight: {
    id: "straight",
    label: "Straight",
    resolution: 16,
    timing: cycle([0], 16),
    accent: cycle([1], 16),
  },
  swing8: {
    id: "swing8",
    label: "Swing (eighths)",
    resolution: 8,
    timing: swungTiming(8, 2 / 3),
    accent: cycle([1, 0.82], 8),
    styles: ["jazz", "lo-fi"],
  },
  swing16: {
    id: "swing16",
    label: "Swing (sixteenths)",
    resolution: 16,
    timing: swungTiming(16, 0.62),
    accent: cycle([1, 0.85], 16),
    styles: ["lo-fi", "j-pop"],
  },
  shuffle: {
    id: "shuffle",
    label: "Shuffle",
    resolution: 8,
    timing: swungTiming(8, 0.7),
    accent: cycle([1, 0.78], 8),
    styles: ["rock", "ballad"],
  },
  bossa: {
    id: "bossa",
    label: "Bossa nova",
    resolution: 16,
    // The push is on the second and fourth sixteenth of each beat, which is what
    // gives the pattern its forward lean without changing any note.
    timing: cycle([0, -0.08, 0, -0.05], 16),
    accent: cycle([1, 0.7, 0.85, 0.72], 16),
    styles: ["lo-fi", "ballad"],
  },
  laidBack: {
    id: "laidBack",
    label: "Laid back",
    resolution: 16,
    timing: cycle([0.06], 16),
    accent: cycle([1, 0.8, 0.9, 0.8], 16),
    styles: ["lo-fi", "ballad", "jazz"],
  },
  pushed: {
    id: "pushed",
    label: "Pushed",
    resolution: 16,
    timing: cycle([-0.06], 16),
    accent: cycle([1, 0.85, 0.95, 0.85], 16),
    styles: ["edm", "rock"],
  },
  backbeat: {
    id: "backbeat",
    label: "Backbeat",
    resolution: 16,
    timing: cycle([0], 16),
    // Beats two and four are the loud ones; that is the whole shape.
    accent: [
      0.85, 0.6, 0.7, 0.6,
      1.15, 0.65, 0.75, 0.65,
      0.85, 0.6, 0.7, 0.6,
      1.15, 0.65, 0.75, 0.65,
    ],
    styles: ["rock", "pop", "j-pop"],
  },
};

export const GROOVE_TEMPLATE_IDS = Object.keys(GROOVE_TEMPLATES) as GrooveTemplateId[];

export interface ApplyGrooveOptions {
  timeSignature: TimeSignature;
  settings: {
    enabled: boolean;
    template: GrooveTemplateId;
    /** 0..1. How much of the template's timing and accent to apply. */
    amount?: number;
  };
  ppq?: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Plays a set of notes with a groove.
 *
 * Timing is applied first and then the results are made safe: a note is never
 * moved out of its own bar, never past the note after it, and never left with a
 * duration of zero. Those constraints are what the rest of the app relies on,
 * and a groove that broke them would be a groove that could not be played back
 * or exported.
 */
export function applyGroove(
  notes: readonly NoteEvent[],
  options: ApplyGrooveOptions,
): NoteEvent[] {
  const { settings } = options;
  if (!settings.enabled || notes.length === 0) return [...notes];
  const template = GROOVE_TEMPLATES[settings.template];
  if (!template) return [...notes];

  const ppq = options.ppq ?? PPQ;
  const barTicks = ticksPerBar(options.timeSignature, ppq);
  const stepTicks = barTicks / template.resolution;
  const amount = clamp(settings.amount ?? 1, 0, 1);
  if (amount === 0) return [...notes];

  const shifted = notes.map((note) => {
    const barStart = note.barIndex * barTicks;
    const local = note.startTick - barStart;
    // The nearest step, so a note already off the grid is still given the groove
    // of the position it is closest to rather than being ignored.
    const step = clamp(Math.round(local / stepTicks), 0, template.resolution - 1);
    const delay = (template.timing[step] ?? 0) * stepTicks * amount;
    const accent = 1 + ((template.accent[step] ?? 1) - 1) * amount;
    return {
      note,
      barStart,
      barEnd: barStart + barTicks,
      target: note.startTick + Math.round(delay),
      velocity: clamp(Math.round(note.velocity * accent), 1, 127),
    };
  });

  const result: NoteEvent[] = [];
  for (const [index, entry] of shifted.entries()) {
    const previous = result[result.length - 1];
    // A note may not start before the bar it belongs to, before the note before
    // it, or so late that nothing is left of it.
    const floor = Math.max(
      entry.barStart,
      previous ? previous.startTick + 1 : entry.barStart,
    );
    const startTick = clamp(entry.target, floor, entry.barEnd - 1);

    const nextEntry = shifted[index + 1];
    const nextStart = nextEntry
      ? Math.max(nextEntry.target, startTick + 1)
      : Number.POSITIVE_INFINITY;
    const originalEnd = entry.note.startTick + entry.note.durationTick;
    const end = Math.min(originalEnd + (startTick - entry.note.startTick), entry.barEnd, nextStart);
    const durationTick = Math.max(1, end - startTick);

    result.push({ ...entry.note, startTick, durationTick, velocity: entry.velocity });
  }
  return result;
}

/** The groove a style reaches for, if it has one. */
export function grooveForStyle(style: StylePresetId): GrooveTemplateId | null {
  for (const id of GROOVE_TEMPLATE_IDS) {
    if (GROOVE_TEMPLATES[id].styles?.includes(style)) return id;
  }
  return null;
}

export interface GrooveSummary {
  /** Mean absolute timing shift, in ticks. */
  averageShift: number;
  /** Largest shift in either direction, in ticks. */
  largestShift: number;
  /** How much the loudest note exceeds the quietest, as a ratio. */
  dynamicRange: number;
  /** Notes whose start moved at all. */
  movedNotes: number;
}

/** What a groove actually did to a set of notes. */
export function summarizeGroove(
  before: readonly NoteEvent[],
  after: readonly NoteEvent[],
): GrooveSummary | null {
  if (before.length === 0 || before.length !== after.length) return null;
  const shifts = before.map((note, index) => (after[index] as NoteEvent).startTick - note.startTick);
  const velocities = after.map((note) => note.velocity);
  return {
    averageShift:
      shifts.reduce((sum, shift) => sum + Math.abs(shift), 0) / shifts.length,
    largestShift: Math.max(...shifts.map(Math.abs)),
    dynamicRange: Math.min(...velocities) === 0
      ? 1
      : Math.max(...velocities) / Math.min(...velocities),
    movedNotes: shifts.filter((shift) => shift !== 0).length,
  };
}
