/**
 * A performance: what is heard, independent of how it was generated.
 *
 * Every engine version writes this format, and the listening harness plays
 * only this format, so two versions are compared on sound alone.
 */

export const RENDER_FORMAT = "vsc-render/1";

export type TimeSignature = "4/4" | "3/4" | "6/8";

export interface RenderNote {
  midi: number;
  /** Ticks from the start of the piece. */
  start: number;
  dur: number;
  /** 1–127. */
  vel: number;
}

export interface RenderTrack {
  role: string;
  notes: RenderNote[];
}

export interface RenderChord {
  symbol: string;
  start: number;
  dur: number;
}

export interface RenderSection {
  kind: string;
  startBar: number;
  /** Exclusive. */
  endBar: number;
}

export interface Render {
  format: typeof RENDER_FORMAT;
  caseId: string;
  engine: string;
  bpm: number;
  timeSignature: TimeSignature;
  ppq: number;
  totalTicks: number;
  chords: RenderChord[];
  sections: RenderSection[];
  tracks: RenderTrack[];
}

const LOWEST_PIANO_KEY = 21;
const HIGHEST_PIANO_KEY = 108;

/**
 * Everything wrong with a render that no listener should have to notice.
 *
 * These are invariants, not taste: a render that passes can still sound bad,
 * and that is decided by listening, not here.
 */
export function renderProblems(render: Render): string[] {
  const problems: string[] = [];
  if (render.format !== RENDER_FORMAT) problems.push(`format is ${String(render.format)}`);
  if (!(render.bpm > 0)) problems.push(`bpm ${render.bpm}`);
  if (!(render.ppq > 0)) problems.push(`ppq ${render.ppq}`);
  if (!(render.totalTicks > 0)) problems.push(`totalTicks ${render.totalTicks}`);
  if (render.tracks.length === 0) problems.push("no tracks");

  for (const track of render.tracks) {
    track.notes.forEach((note, index) => {
      const where = `${track.role}[${index}]`;
      if (!Number.isInteger(note.midi) || note.midi < LOWEST_PIANO_KEY || note.midi > HIGHEST_PIANO_KEY) {
        problems.push(`${where}: pitch ${note.midi} outside the piano`);
      }
      if (!(note.dur > 0)) problems.push(`${where}: duration ${note.dur}`);
      if (note.start < 0 || note.start + note.dur > render.totalTicks) {
        problems.push(`${where}: ${note.start}+${note.dur} outside 0..${render.totalTicks}`);
      }
      if (!Number.isInteger(note.vel) || note.vel < 1 || note.vel > 127) {
        problems.push(`${where}: velocity ${note.vel}`);
      }
    });
  }

  let previousEnd = 0;
  for (const chord of render.chords) {
    if (chord.start < previousEnd) problems.push(`chord ${chord.symbol} at ${chord.start} overlaps the previous one`);
    previousEnd = chord.start + chord.dur;
  }
  if (previousEnd > render.totalTicks) problems.push("chords run past the end");

  return problems;
}

/** Length of the piece in seconds. */
export function renderSeconds(render: Pick<Render, "bpm" | "ppq" | "totalTicks">): number {
  return (render.totalTicks / render.ppq) * (60 / render.bpm);
}
