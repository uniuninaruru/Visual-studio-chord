import * as Tone from "tone";
import type { Render } from "@vsc/core";
import type { Side } from "./session";

/**
 * Plays two renders of one case on the same piano and switches between them
 * without losing the place, so the only thing that changes is the music.
 */

const SALAMANDER_BASE = "https://tonejs.github.io/audio/salamander/";

function salamanderUrls(): Record<string, string> {
  const urls: Record<string, string> = { A0: "A0.mp3", C8: "C8.mp3" };
  for (let octave = 1; octave <= 7; octave += 1) {
    urls[`C${octave}`] = `C${octave}.mp3`;
    urls[`D#${octave}`] = `Ds${octave}.mp3`;
    urls[`F#${octave}`] = `Fs${octave}.mp3`;
    urls[`A${octave}`] = `A${octave}.mp3`;
  }
  return urls;
}

export type Instrument = "piano" | "synth";

interface ScheduledNote {
  side: Side;
  midi: number;
  start: number;
  dur: number;
  vel: number;
}

type Voice = Tone.Sampler | Tone.PolySynth;

export class ComparePlayer {
  private voice: Voice | null = null;
  private instrument: Instrument | null = null;
  private part: Tone.Part<ScheduledNote & { time: string }> | null = null;
  private notes: ScheduledNote[] = [];
  private side: Side = "A";
  private totalTicks = 0;
  private ppq = 480;
  private bpm = 120;
  private endListeners = new Set<() => void>();

  get activeSide(): Side {
    return this.side;
  }

  get durationSeconds(): number {
    return (this.totalTicks / this.ppq) * (60 / this.bpm);
  }

  get positionSeconds(): number {
    return Math.min(Tone.getTransport().seconds, this.durationSeconds);
  }

  get playing(): boolean {
    return Tone.getTransport().state === "started";
  }

  onEnd(listener: () => void): () => void {
    this.endListeners.add(listener);
    return () => this.endListeners.delete(listener);
  }

  /** Replaces what is loaded. Both sides must be one case: same tempo, same length. */
  load(renders: Partial<Record<Side, Render>>): void {
    this.stop();
    this.part?.dispose();
    const reference = renders.A ?? renders.B;
    if (!reference) {
      this.notes = [];
      this.part = null;
      return;
    }
    this.ppq = reference.ppq;
    this.bpm = reference.bpm;
    this.totalTicks = reference.totalTicks;
    this.notes = (["A", "B"] as const).flatMap((side) => {
      const render = renders[side];
      if (!render) return [];
      const scale = this.ppq / render.ppq;
      return render.tracks.flatMap((track) => track.notes.map((note) => ({
        side,
        midi: note.midi,
        start: Math.round(note.start * scale),
        dur: Math.max(1, Math.round(note.dur * scale)),
        vel: note.vel,
      })));
    });
    if (!renders[this.side]) this.side = renders.A ? "A" : "B";

    const transport = Tone.getTransport();
    transport.cancel();
    transport.PPQ = this.ppq;
    transport.bpm.value = this.bpm;
    this.part = new Tone.Part<ScheduledNote & { time: string }>((time, note) => {
      if (note.side !== this.side || !this.voice) return;
      this.voice.triggerAttackRelease(
        Tone.Frequency(note.midi, "midi").toNote(),
        this.ticksToSeconds(note.dur),
        time,
        note.vel / 127,
      );
    }, this.notes.map((note) => ({ ...note, time: `${note.start}i` })));
    this.part.start(0);
    transport.scheduleOnce((time) => {
      Tone.getDraw().schedule(() => {
        this.stop();
        for (const listener of this.endListeners) listener();
      }, time);
    }, `${this.totalTicks}i`);
  }

  /** Loads the piano on first use; falls back to a plain synth when offline. */
  async prepare(): Promise<Instrument> {
    if (this.instrument) return this.instrument;
    await Tone.start();
    try {
      const sampler = await new Promise<Tone.Sampler>((resolve, reject) => {
        const candidate = new Tone.Sampler({
          urls: salamanderUrls(),
          baseUrl: SALAMANDER_BASE,
          release: 1.2,
          onload: () => resolve(candidate),
          onerror: (error) => reject(error),
        });
      });
      this.voice = sampler.toDestination();
      this.instrument = "piano";
    } catch {
      this.voice = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.005, decay: 0.3, sustain: 0.3, release: 1 },
      }).toDestination();
      this.voice.volume.value = -12;
      this.instrument = "synth";
    }
    return this.instrument;
  }

  async play(): Promise<void> {
    await this.prepare();
    const transport = Tone.getTransport();
    if (transport.seconds >= this.durationSeconds) transport.seconds = 0;
    transport.start();
  }

  pause(): void {
    Tone.getTransport().pause();
    this.voice?.releaseAll();
  }

  stop(): void {
    const transport = Tone.getTransport();
    transport.stop();
    transport.seconds = 0;
    this.voice?.releaseAll();
  }

  seek(seconds: number): void {
    const transport = Tone.getTransport();
    transport.seconds = Math.max(0, Math.min(seconds, this.durationSeconds));
    this.voice?.releaseAll();
    if (this.playing) this.sustainSounding();
  }

  /** Switches sides in place. Notes of the new side already under way are picked up. */
  setSide(side: Side): void {
    if (side === this.side) return;
    this.side = side;
    this.voice?.releaseAll();
    if (this.playing) this.sustainSounding();
  }

  dispose(): void {
    this.stop();
    this.part?.dispose();
    this.voice?.dispose();
    this.endListeners.clear();
  }

  private sustainSounding(): void {
    if (!this.voice) return;
    const now = Tone.getTransport().ticks;
    for (const note of this.notes) {
      if (note.side !== this.side || note.start >= now || note.start + note.dur <= now + 1) continue;
      this.voice.triggerAttackRelease(
        Tone.Frequency(note.midi, "midi").toNote(),
        this.ticksToSeconds(note.start + note.dur - now),
        Tone.now(),
        note.vel / 127,
      );
    }
  }

  private ticksToSeconds(ticks: number): number {
    return (ticks / this.ppq) * (60 / this.bpm);
  }
}
