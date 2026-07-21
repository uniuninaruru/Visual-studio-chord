import * as Tone from "tone";
import type { GeneratedComposition } from "../types/music";

export interface PlaybackLoop {
  startTick: number;
  endTick: number;
}

export type PlaybackStatus = "stopped" | "playing" | "paused";

type TickListener = (tick: number) => void;

function secondsForTicks(ticks: number, bpm: number, ppq: number): number {
  return Math.max(0.025, (ticks / ppq) * (60 / bpm));
}

function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * A single-owner Tone.js adapter. React only sends immutable composition
 * snapshots here; scheduling and synth lifetime never live in a component.
 * Each bar reads the newest snapshot at its boundary, so edits made during
 * playback take effect without cutting notes already sounding.
 */
export class CompositionTransport {
  private readonly transport = Tone.getTransport();
  private composition: GeneratedComposition | null = null;
  private loop: PlaybackLoop = { startTick: 0, endTick: 1 };
  private chordSynth: Tone.PolySynth | null = null;
  private melodySynth: Tone.PolySynth | null = null;
  private barEventId: number | null = null;
  private tickEventId: number | null = null;
  private barCursor = 0;
  private status: PlaybackStatus = "stopped";
  private tickListener: TickListener | null = null;

  async initialize(): Promise<void> {
    await Tone.start();
    if (this.chordSynth && this.melodySynth) {
      return;
    }

    this.chordSynth = new Tone.PolySynth(Tone.Synth, {
      volume: -14,
      oscillator: { type: "triangle8" },
      envelope: { attack: 0.02, decay: 0.25, sustain: 0.35, release: 0.8 },
    }).toDestination();
    this.melodySynth = new Tone.PolySynth(Tone.Synth, {
      volume: -9,
      oscillator: { type: "sine" },
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.22, release: 0.24 },
    }).toDestination();
  }

  configure(
    composition: GeneratedComposition,
    loop: PlaybackLoop,
    tickListener?: TickListener,
  ): void {
    const loopChanged =
      this.loop.startTick !== loop.startTick ||
      this.loop.endTick !== loop.endTick ||
      this.composition?.ticksPerBar !== composition.ticksPerBar;

    this.composition = composition;
    this.loop = {
      startTick: Math.max(0, loop.startTick),
      endTick: Math.min(composition.totalTicks, Math.max(loop.startTick + 1, loop.endTick)),
    };
    this.tickListener = tickListener ?? null;
    this.transport.PPQ = composition.ppq;
    this.transport.bpm.value = composition.settings.bpm;
    this.transport.timeSignature = composition.timeSignature
      .split("/")
      .map(Number) as [number, number];
    this.transport.loop = true;
    this.transport.loopStart = `${this.loop.startTick}i`;
    this.transport.loopEnd = `${this.loop.endTick}i`;

    if (loopChanged || this.barEventId === null) {
      const wasPlaying = this.status === "playing";
      if (wasPlaying) {
        this.transport.pause();
      }
      this.scheduleLoop();
      this.transport.ticks = this.loop.startTick;
      if (wasPlaying) {
        this.transport.start("+0.04");
      }
    }
  }

  async play(): Promise<void> {
    if (!this.composition) {
      return;
    }
    await this.initialize();
    if (this.status === "stopped") {
      this.barCursor = Math.floor(this.loop.startTick / this.composition.ticksPerBar);
      this.transport.ticks = this.loop.startTick;
    }
    this.transport.start("+0.04");
    this.status = "playing";
  }

  pause(): void {
    this.transport.pause();
    this.releaseAll();
    this.status = "paused";
  }

  stop(): void {
    this.transport.stop();
    this.releaseAll();
    this.transport.ticks = this.loop.startTick;
    this.status = "stopped";
    this.tickListener?.(this.loop.startTick);
  }

  dispose(): void {
    this.stop();
    this.clearEvents();
    this.chordSynth?.dispose();
    this.melodySynth?.dispose();
    this.chordSynth = null;
    this.melodySynth = null;
  }

  private scheduleLoop(): void {
    this.clearEvents();
    const composition = this.composition;
    if (!composition) {
      return;
    }

    const startBar = Math.floor(this.loop.startTick / composition.ticksPerBar);
    this.barCursor = startBar;
    this.tickEventId = this.transport.scheduleRepeat(
      () => {
        const tick = Math.round(this.transport.ticks);
        this.tickListener?.(tick);
      },
      `${Math.max(1, Math.floor(composition.ppq / 4))}i`,
      `${this.loop.startTick}i`,
    );
    this.barEventId = this.transport.scheduleRepeat(
      (time) => this.playCurrentBar(time),
      `${composition.ticksPerBar}i`,
      `${this.loop.startTick}i`,
    );
  }

  private playCurrentBar(time: number): void {
    const composition = this.composition;
    if (!composition || !this.chordSynth || !this.melodySynth) {
      return;
    }

    const startBar = Math.floor(this.loop.startTick / composition.ticksPerBar);
    const endBar = Math.max(
      startBar + 1,
      Math.ceil(this.loop.endTick / composition.ticksPerBar),
    );
    const barIndex = Math.min(composition.bars.length - 1, this.barCursor);
    const barStart = barIndex * composition.ticksPerBar;

    for (const chord of composition.chords) {
      if (chord.startTick < barStart || chord.startTick >= barStart + composition.ticksPerBar) {
        continue;
      }
      const offset = secondsForTicks(chord.startTick - barStart, composition.settings.bpm, composition.ppq);
      const duration = secondsForTicks(chord.durationTick * 0.94, composition.settings.bpm, composition.ppq);
      this.chordSynth.triggerAttackRelease(
        chord.notes.map(midiToFrequency),
        duration,
        time + (chord.startTick === barStart ? 0 : offset),
        0.48,
      );
    }

    for (const note of composition.notes) {
      if (note.startTick < barStart || note.startTick >= barStart + composition.ticksPerBar) {
        continue;
      }
      const offset = secondsForTicks(note.startTick - barStart, composition.settings.bpm, composition.ppq);
      const duration = secondsForTicks(note.durationTick * 0.88, composition.settings.bpm, composition.ppq);
      this.melodySynth.triggerAttackRelease(
        midiToFrequency(note.midi),
        duration,
        time + (note.startTick === barStart ? 0 : offset),
        Math.max(0.08, Math.min(1, note.velocity / 127)),
      );
    }

    this.barCursor += 1;
    if (this.barCursor >= endBar) {
      this.barCursor = startBar;
    }
  }

  private clearEvents(): void {
    if (this.barEventId !== null) {
      this.transport.clear(this.barEventId);
      this.barEventId = null;
    }
    if (this.tickEventId !== null) {
      this.transport.clear(this.tickEventId);
      this.tickEventId = null;
    }
  }

  private releaseAll(): void {
    this.chordSynth?.releaseAll();
    this.melodySynth?.releaseAll();
  }
}
