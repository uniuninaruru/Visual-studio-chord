import { beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => {
  type Scheduler = (time: number) => void;

  class FakePolySynth {
    triggerAttackRelease = vi.fn();
    releaseAll = vi.fn();
    dispose = vi.fn();

    constructor() {
      audioMocks.synths.push(this);
    }

    toDestination() {
      return this;
    }
  }

  let transportTicks = 0;
  const tickAssignments: number[] = [];
  const transport = {
    PPQ: 480,
    bpm: { value: 120 },
    timeSignature: [4, 4] as [number, number],
    loop: false,
    loopStart: "0i",
    loopEnd: "1i",
    get ticks() {
      return transportTicks;
    },
    set ticks(value: number) {
      tickAssignments.push(value);
      transportTicks = value;
    },
    getTicksAtTime: vi.fn((time: number) => {
      void time;
      return transportTicks;
    }),
    scheduleRepeat: vi.fn((callback: Scheduler) => {
      audioMocks.scheduler = callback;
      return 17;
    }),
    clear: vi.fn(),
    start: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
  };

  return {
    FakePolySynth,
    transport,
    scheduler: null as Scheduler | null,
    synths: [] as FakePolySynth[],
    startAudio: vi.fn(async () => undefined),
    tickAssignments,
  };
});

vi.mock("tone", () => ({
  getTransport: () => audioMocks.transport,
  start: audioMocks.startAudio,
  PolySynth: audioMocks.FakePolySynth,
  Synth: class FakeSynth {},
}));

import { CompositionTransport } from "../src/audio/transport";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";

function composition(timeSignature: "4/4" | "3/4" = "4/4") {
  return generateComposition({
    ...DEFAULT_GENERATOR_SETTINGS,
    bars: 4,
    seed: `transport-${timeSignature}`,
    timeSignature,
  });
}

describe("CompositionTransport", () => {
  beforeEach(() => {
    audioMocks.scheduler = null;
    audioMocks.synths.length = 0;
    audioMocks.transport.ticks = 0;
    audioMocks.tickAssignments.length = 0;
    audioMocks.transport.getTicksAtTime.mockImplementation(() => audioMocks.transport.ticks);
    audioMocks.transport.scheduleRepeat.mockClear();
    audioMocks.transport.clear.mockClear();
    audioMocks.transport.start.mockClear();
    audioMocks.transport.pause.mockClear();
    audioMocks.transport.stop.mockClear();
    audioMocks.startAudio.mockClear();
  });

  it("commits the snapshot before scheduling audio at the boundary", async () => {
    const oldComposition = composition();
    const newComposition = structuredClone(oldComposition);
    const chord = oldComposition.chords[0];
    expect(chord).toBeDefined();
    if (!chord) return;

    oldComposition.chords = [{ ...chord, startTick: 480, durationTick: 480, notes: [60] }];
    oldComposition.notes = [];
    newComposition.chords = [{ ...chord, startTick: 480, durationTick: 480, notes: [72] }];
    newComposition.notes = [];

    const transport = new CompositionTransport();
    const loop = { startTick: 0, endTick: oldComposition.totalTicks };
    const onTick = (tick: number) => {
      if (tick === 480) transport.configure(newComposition, loop, onTick);
    };
    transport.configure(oldComposition, loop, onTick);
    await transport.play();

    audioMocks.transport.ticks = 480;
    audioMocks.scheduler?.(1);

    const chordSynth = audioMocks.synths[0];
    expect(chordSynth?.triggerAttackRelease).toHaveBeenCalledTimes(1);
    const frequencies = chordSynth?.triggerAttackRelease.mock.calls[0]?.[0] as number[];
    expect(frequencies[0]).toBeCloseTo(523.251, 3);
  });

  it("uses the scheduled callback tick instead of the look-ahead transport position", async () => {
    const snapshot = composition();
    const chord = snapshot.chords[0];
    expect(chord).toBeDefined();
    if (!chord) return;

    snapshot.chords = [
      { ...chord, id: "scheduled-zero", startTick: 0, durationTick: 120, notes: [60] },
      { ...chord, id: "scheduled-120", startTick: 120, durationTick: 120, notes: [62] },
    ];
    snapshot.notes = [];

    const transport = new CompositionTransport();
    transport.configure(snapshot, { startTick: 0, endTick: snapshot.totalTicks });
    await transport.play();
    const scheduledTicks = new Map([[1, 0], [2, 120]]);
    audioMocks.transport.getTicksAtTime.mockImplementation(
      (time: number) => scheduledTicks.get(time) ?? audioMocks.transport.ticks,
    );

    audioMocks.transport.ticks = 37;
    audioMocks.tickAssignments.length = 0;
    audioMocks.scheduler?.(1);
    audioMocks.transport.ticks = 157;
    audioMocks.tickAssignments.length = 0;
    audioMocks.scheduler?.(2);

    const chordSynth = audioMocks.synths[0];
    expect(chordSynth?.triggerAttackRelease).toHaveBeenCalledTimes(2);
    expect(chordSynth?.triggerAttackRelease.mock.calls[0]?.[0]).toEqual([
      expect.closeTo(261.626, 3),
    ]);
    expect(chordSynth?.triggerAttackRelease.mock.calls[1]?.[0]).toEqual([
      expect.closeTo(293.665, 3),
    ]);
  });

  it("splits piano hands and applies built-in track solo/mute", async () => {
    const snapshot = composition();
    const chord = snapshot.chords[0]!;
    snapshot.chords = [
      { ...chord, startTick: 0, durationTick: 480, notes: [48, 52, 55, 60] },
    ];
    snapshot.notes = [{ ...snapshot.notes[0]!, startTick: 0 }];

    const transport = new CompositionTransport();
    transport.configure(snapshot, { startTick: 0, endTick: snapshot.totalTicks });
    transport.setTrackMix([], "track-bass");
    await transport.play();
    audioMocks.transport.getTicksAtTime.mockReturnValue(0);
    audioMocks.scheduler?.(1);

    const chordSynth = audioMocks.synths[0];
    const melodySynth = audioMocks.synths[1];
    const bassSynth = audioMocks.synths[2];
    expect(bassSynth?.triggerAttackRelease).toHaveBeenCalledTimes(1);
    expect(bassSynth?.triggerAttackRelease.mock.calls[0]?.[0]).toBeCloseTo(130.813, 3);
    expect(chordSynth?.triggerAttackRelease).not.toHaveBeenCalled();
    expect(melodySynth?.triggerAttackRelease).not.toHaveBeenCalled();
  });

  it("remaps a boundary commit at its scheduled time without jumping during look-ahead", async () => {
    const oldComposition = composition("4/4");
    const newComposition = composition("3/4");
    const chord = newComposition.chords[0];
    expect(chord).toBeDefined();
    if (!chord) return;
    oldComposition.chords = [];
    oldComposition.notes = [];
    newComposition.chords = [{
      ...chord,
      startTick: newComposition.ticksPerBar,
      durationTick: 120,
      notes: [72],
    }];
    newComposition.notes = [];

    const ticksSeen: number[] = [];
    const transport = new CompositionTransport();
    const onTick = (tick: number) => {
      ticksSeen.push(tick);
      if (ticksSeen.length === 1) {
        transport.configure(
          newComposition,
          { startTick: 0, endTick: newComposition.totalTicks },
          onTick,
        );
      }
    };
    transport.configure(
      oldComposition,
      { startTick: 0, endTick: oldComposition.totalTicks },
      onTick,
    );
    await transport.play();
    audioMocks.transport.getTicksAtTime.mockReturnValue(oldComposition.ticksPerBar);
    audioMocks.transport.ticks = oldComposition.ticksPerBar + 31;
    audioMocks.tickAssignments.length = 0;
    audioMocks.transport.pause.mockClear();
    audioMocks.transport.start.mockClear();

    audioMocks.scheduler?.(4.25);

    const chordSynth = audioMocks.synths[0];
    expect(chordSynth?.triggerAttackRelease).toHaveBeenCalledTimes(1);
    expect(chordSynth?.triggerAttackRelease.mock.calls[0]?.[0]).toEqual([
      expect.closeTo(523.251, 3),
    ]);
    expect(ticksSeen).toEqual([oldComposition.ticksPerBar, newComposition.ticksPerBar]);
    expect(audioMocks.tickAssignments).toEqual([]);
    expect(audioMocks.transport.pause).toHaveBeenCalledWith(4.25);
    expect(audioMocks.transport.start).toHaveBeenCalledWith(
      4.25,
      `${newComposition.ticksPerBar}i`,
    );
  });

  it("maps the playing position across a meter change without restarting", async () => {
    const oldComposition = composition("4/4");
    const newComposition = composition("3/4");
    const transport = new CompositionTransport();
    transport.configure(
      oldComposition,
      { startTick: 0, endTick: oldComposition.totalTicks },
    );
    await transport.play();
    audioMocks.transport.ticks = 1_920;

    transport.configure(
      newComposition,
      { startTick: 0, endTick: newComposition.totalTicks },
    );

    expect(audioMocks.transport.ticks).toBe(1_440);
    expect(audioMocks.transport.pause).not.toHaveBeenCalled();
    expect(audioMocks.transport.start).toHaveBeenCalledTimes(1);
  });

  it("schedules every audible additional voice and respects saved mute state", async () => {
    const snapshot = composition();
    const lead = snapshot.notes[0];
    expect(lead).toBeDefined();
    if (!lead) return;
    snapshot.chords = [];
    snapshot.notes = [];
    snapshot.voices = [
      {
        id: "counter",
        name: "Countermelody",
        role: "countermelody",
        instrument: "softLead",
        color: "#58c7d9",
        midiChannel: 2,
        notes: [{ ...lead, id: "counter-note", startTick: 0, midi: 55 }],
      },
      {
        id: "muted",
        name: "Muted canon",
        role: "canon",
        instrument: "pluck",
        color: "#c58cff",
        midiChannel: 3,
        muted: true,
        notes: [{ ...lead, id: "muted-note", startTick: 0, midi: 67 }],
      },
    ];

    const transport = new CompositionTransport();
    transport.configure(snapshot, { startTick: 0, endTick: snapshot.totalTicks });
    await transport.play();
    audioMocks.transport.getTicksAtTime.mockReturnValue(0);
    audioMocks.scheduler?.(1);

    const counterSynth = audioMocks.synths[2];
    const mutedSynth = audioMocks.synths[3];
    expect(counterSynth?.triggerAttackRelease).toHaveBeenCalledTimes(1);
    expect(counterSynth?.triggerAttackRelease.mock.calls[0]?.[0]).toBeCloseTo(195.998, 3);
    expect(mutedSynth?.triggerAttackRelease).not.toHaveBeenCalled();
  });
});
