import * as Tone from "tone";
import type {
  CompositionVoice,
  CompositionVoiceInstrument,
  GeneratedComposition,
} from "../types/music";

export interface PlaybackLoop {
  startTick: number;
  endTick: number;
}

export type PlaybackStatus = "stopped" | "playing" | "paused";

type TickListener = (tick: number) => void;

interface SchedulingBoundary {
  time: number;
  effectiveTick: number;
  repositionTick: number | null;
}

function secondsForTicks(ticks: number, bpm: number, ppq: number): number {
  return Math.max(0.025, (ticks / ppq) * (60 / bpm));
}

function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * A single-owner Tone.js adapter. React only sends immutable composition
 * snapshots here; scheduling and synth lifetime never live in a component.
 * Each sixteenth-note scheduling window reads the newest snapshot. The tick
 * listener runs first, so a pending edit committed at a beat/bar/loop boundary
 * is the data scheduled for that boundary. Notes that are already sounding are
 * left alone until their natural release.
 */
export class CompositionTransport {
  private readonly transport = Tone.getTransport();
  private composition: GeneratedComposition | null = null;
  private loop: PlaybackLoop = { startTick: 0, endTick: 1 };
  private chordSynth: Tone.PolySynth | null = null;
  private melodySynth: Tone.PolySynth | null = null;
  private bassSynth: Tone.PolySynth | null = null;
  private readonly voiceSynths = new Map<string, Tone.PolySynth>();
  private schedulerEventId: number | null = null;
  private schedulerStepTicks = 1;
  private lastScheduledTick: number | null = null;
  private schedulingBoundary: SchedulingBoundary | null = null;
  private status: PlaybackStatus = "stopped";
  private tickListener: TickListener | null = null;
  private mutedTrackIds = new Set<string>();
  private soloTrackId: string | null = null;

  setTrackMix(mutedTrackIds: readonly string[], soloTrackId: string | null): void {
    this.mutedTrackIds = new Set(mutedTrackIds);
    this.soloTrackId = soloTrackId;
    this.releaseAll();
  }

  private trackIsAudible(trackId: string): boolean {
    if (this.mutedTrackIds.has(trackId)) return false;
    return this.soloTrackId === null || this.soloTrackId === trackId;
  }

  async initialize(): Promise<void> {
    await Tone.start();
    this.chordSynth ??= new Tone.PolySynth(Tone.Synth, {
      volume: -14,
      oscillator: { type: "triangle8" },
      envelope: { attack: 0.02, decay: 0.25, sustain: 0.35, release: 0.8 },
    }).toDestination();
    this.melodySynth ??= new Tone.PolySynth(Tone.Synth, {
      volume: -9,
      oscillator: { type: "sine" },
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.22, release: 0.24 },
    }).toDestination();
    this.ensureVoiceSynths(this.composition?.voices ?? []);
    this.bassSynth ??= new Tone.PolySynth(Tone.Synth, {
      volume: -12,
      oscillator: { type: "triangle" },
      envelope: { attack: 0.012, decay: 0.2, sustain: 0.3, release: 0.55 },
    }).toDestination();
  }

  /**
   * Sound one chord on its own, outside the timeline.
   *
   * Auditioning a reharmonization candidate has to be possible while the piece
   * is stopped, and it must not disturb a piece that is playing, so this
   * triggers the chord synth directly rather than scheduling anything on the
   * transport. It deliberately ignores the track mix: the point is to hear the
   * candidate, and silencing it because the chord track happens to be muted
   * would look like a broken button.
   */
  async auditionChord(midis: readonly number[], seconds = 1.2): Promise<void> {
    if (midis.length === 0) return;
    await this.initialize();
    this.chordSynth?.triggerAttackRelease(
      [...midis].map(midiToFrequency),
      seconds,
      undefined,
      0.5,
    );
  }

  configure(
    composition: GeneratedComposition,
    loop: PlaybackLoop,
    tickListener?: TickListener,
  ): void {
    const previousComposition = this.composition;
    const previousTick = this.schedulingBoundary?.effectiveTick
      ?? Math.round(this.transport.ticks);
    const loopChanged =
      this.loop.startTick !== loop.startTick ||
      this.loop.endTick !== loop.endTick;
    const ppqChanged = previousComposition?.ppq !== composition.ppq;
    const timebaseChanged = previousComposition !== null && (
      previousComposition.ppq !== composition.ppq
      || previousComposition.ticksPerBar !== composition.ticksPerBar
    );

    this.composition = composition;
    if (this.chordSynth && this.melodySynth) {
      this.ensureVoiceSynths(composition.voices ?? []);
    }
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

    if (ppqChanged || this.schedulerEventId === null) {
      this.scheduleLoop();
    }

    if (timebaseChanged && previousComposition) {
      const barPosition = previousTick / previousComposition.ticksPerBar;
      const mappedTick = Math.round(barPosition * composition.ticksPerBar);
      this.updateTransportTick(this.clampTickToLoop(mappedTick));
    } else if (loopChanged && (
      previousTick < this.loop.startTick || previousTick >= this.loop.endTick
    )) {
      this.updateTransportTick(this.loop.startTick);
    } else if (this.status === "stopped") {
      this.setTransportTick(this.loop.startTick);
    }
  }

  async play(): Promise<void> {
    if (!this.composition) {
      return;
    }
    await this.initialize();
    if (this.status === "stopped") {
      this.transport.ticks = this.loop.startTick;
      this.lastScheduledTick = null;
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
    this.lastScheduledTick = null;
    this.status = "stopped";
    this.tickListener?.(this.loop.startTick);
  }

  dispose(): void {
    this.stop();
    this.clearEvents();
    this.chordSynth?.dispose();
    this.melodySynth?.dispose();
    this.bassSynth?.dispose();
    for (const synth of this.voiceSynths.values()) synth.dispose();
    this.voiceSynths.clear();
    this.chordSynth = null;
    this.melodySynth = null;
    this.bassSynth = null;
  }

  private scheduleLoop(): void {
    this.clearEvents();
    const composition = this.composition;
    if (!composition) {
      return;
    }

    this.schedulerStepTicks = Math.max(1, Math.floor(composition.ppq / 4));
    this.schedulerEventId = this.transport.scheduleRepeat(
      (time) => this.playCurrentWindow(time),
      `${this.schedulerStepTicks}i`,
      "0i",
    );
  }

  private playCurrentWindow(time: number): void {
    const initialTick = this.clampTickToLoop(
      Math.round(this.transport.getTicksAtTime(time)),
    );
    const boundary: SchedulingBoundary = {
      time,
      effectiveTick: initialTick,
      repositionTick: null,
    };
    this.schedulingBoundary = boundary;

    try {
      this.tickListener?.(initialTick);

      // The listener may synchronously commit a snapshot with a different
      // meter. Configure records the remapped boundary without moving Tone's
      // look-ahead position before the callback's actual audio time.
      let windowStart = this.clampTickToLoop(boundary.effectiveTick);
      if (windowStart !== boundary.effectiveTick) {
        boundary.effectiveTick = windowStart;
        boundary.repositionTick = windowStart;
      }
      if (windowStart !== initialTick) {
        this.tickListener?.(windowStart);
        windowStart = this.clampTickToLoop(boundary.effectiveTick);
      }

      const composition = this.composition;
      if (composition && this.chordSynth && this.melodySynth && this.bassSynth) {
        if (this.lastScheduledTick !== null && windowStart < this.lastScheduledTick) {
          this.releaseAll(time);
        }
        this.lastScheduledTick = windowStart;
        const windowEnd = Math.min(
          this.loop.endTick,
          windowStart + this.schedulerStepTicks,
        );

        for (const chord of composition.chords) {
          if (chord.startTick < windowStart || chord.startTick >= windowEnd) {
            continue;
          }
          const offset = secondsForTicks(
            chord.startTick - windowStart,
            composition.settings.bpm,
            composition.ppq,
          );
          const duration = secondsForTicks(
            Math.min(chord.durationTick * 0.94, this.loop.endTick - chord.startTick),
            composition.settings.bpm,
            composition.ppq,
          );
          const pitches = [...chord.notes].sort((left, right) => left - right);
          const eventTime = time + (chord.startTick === windowStart ? 0 : offset);
          if (pitches.length <= 1 && this.trackIsAudible("track-chords")) {
            this.chordSynth.triggerAttackRelease(
              pitches.map(midiToFrequency),
              duration,
              eventTime,
              0.48,
            );
          } else {
            if (this.trackIsAudible("track-bass")) {
              this.bassSynth.triggerAttackRelease(
                midiToFrequency(pitches[0] as number),
                duration,
                eventTime,
                0.5,
              );
            }
            if (this.trackIsAudible("track-chords")) {
              this.chordSynth.triggerAttackRelease(
                pitches.slice(1).map(midiToFrequency),
                duration,
                eventTime,
                0.43,
              );
            }
          }
        }

        if (this.trackIsAudible("track-melody")) for (const note of composition.notes) {
          if (note.startTick < windowStart || note.startTick >= windowEnd) {
            continue;
          }
          const offset = secondsForTicks(
            note.startTick - windowStart,
            composition.settings.bpm,
            composition.ppq,
          );
          const duration = secondsForTicks(
            Math.min(note.durationTick * 0.88, this.loop.endTick - note.startTick),
            composition.settings.bpm,
            composition.ppq,
          );
          this.melodySynth.triggerAttackRelease(
            midiToFrequency(note.midi),
            duration,
            time + (note.startTick === windowStart ? 0 : offset),
            Math.max(0.08, Math.min(1, note.velocity / 127)),
          );
        }

        for (const voice of composition.voices ?? []) {
          if (voice.muted || !this.trackIsAudible(`track-${voice.id}`)) continue;
          const synth = this.voiceSynths.get(voice.id);
          if (!synth) continue;
          for (const note of voice.notes) {
            if (note.startTick < windowStart || note.startTick >= windowEnd) {
              continue;
            }
            const offset = secondsForTicks(
              note.startTick - windowStart,
              composition.settings.bpm,
              composition.ppq,
            );
            const duration = secondsForTicks(
              Math.min(note.durationTick * 0.86, this.loop.endTick - note.startTick),
              composition.settings.bpm,
              composition.ppq,
            );
            synth.triggerAttackRelease(
              midiToFrequency(note.midi),
              duration,
              time + (note.startTick === windowStart ? 0 : offset),
              Math.max(0.06, Math.min(0.82, note.velocity / 127)),
            );
          }
        }
      }

      if (boundary.repositionTick !== null) {
        this.transport.pause(boundary.time);
        this.transport.start(boundary.time, `${boundary.repositionTick}i`);
      }
    } finally {
      this.schedulingBoundary = null;
    }
  }

  private clearEvents(): void {
    if (this.schedulerEventId !== null) {
      this.transport.clear(this.schedulerEventId);
      this.schedulerEventId = null;
    }
  }

  private clampTickToLoop(tick: number): number {
    if (tick < this.loop.startTick || tick >= this.loop.endTick) {
      return this.loop.startTick;
    }
    return tick;
  }

  private setTransportTick(tick: number): void {
    if (Math.round(this.transport.ticks) !== tick) {
      this.releaseAll();
    }
    this.transport.ticks = tick;
    this.lastScheduledTick = null;
  }

  private updateTransportTick(tick: number): void {
    if (this.schedulingBoundary && this.status === "playing") {
      this.schedulingBoundary.effectiveTick = tick;
      this.schedulingBoundary.repositionTick = tick;
      return;
    }
    this.setTransportTick(tick);
  }

  private releaseAll(time?: number): void {
    this.chordSynth?.releaseAll(time);
    this.melodySynth?.releaseAll(time);
    this.bassSynth?.releaseAll(time);
    for (const synth of this.voiceSynths.values()) synth.releaseAll(time);
  }

  private ensureVoiceSynths(voices: readonly CompositionVoice[]): void {
    const activeIds = new Set(voices.map((voice) => voice.id));
    for (const [voiceId, synth] of this.voiceSynths) {
      if (activeIds.has(voiceId)) continue;
      synth.releaseAll();
      synth.dispose();
      this.voiceSynths.delete(voiceId);
    }
    for (const voice of voices) {
      if (this.voiceSynths.has(voice.id)) continue;
      this.voiceSynths.set(voice.id, this.createVoiceSynth(voice.instrument));
    }
  }

  private createVoiceSynth(instrument: CompositionVoiceInstrument): Tone.PolySynth {
    switch (instrument) {
      case "bass":
        return new Tone.PolySynth(Tone.Synth, {
          volume: -13,
          oscillator: { type: "triangle" },
          envelope: { attack: 0.01, decay: 0.16, sustain: 0.18, release: 0.18 },
        }).toDestination();
      case "pluck":
        return new Tone.PolySynth(Tone.Synth, {
          volume: -15,
          oscillator: { type: "square8" },
          envelope: { attack: 0.006, decay: 0.14, sustain: 0.05, release: 0.12 },
        }).toDestination();
      case "softLead":
        return new Tone.PolySynth(Tone.Synth, {
          volume: -13,
          oscillator: { type: "sine4" },
          envelope: { attack: 0.025, decay: 0.15, sustain: 0.2, release: 0.3 },
        }).toDestination();
    }
  }
}
