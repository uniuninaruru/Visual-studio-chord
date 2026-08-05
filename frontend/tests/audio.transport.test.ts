import { beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => {
  type Scheduler = (time: number) => void;

  class FakeNode {
    dispose = vi.fn();
    destination = false;
    target: unknown = null;

    constructor(readonly kind: string, readonly options?: unknown) {
      audioMocks.nodes.push(this as unknown as FakeNode);
    }

    toDestination() {
      this.destination = true;
      return this;
    }

    connect(target: unknown) {
      this.target = target;
      return this;
    }
  }

  class FakePolySynth extends FakeNode {
    triggerAttackRelease = vi.fn();
    releaseAll = vi.fn();
    voice: unknown;
    preset: Record<string, unknown>;

    constructor(voice?: unknown, preset?: Record<string, unknown>) {
      super("polySynth");
      this.voice = voice;
      this.preset = preset ?? {};
      audioMocks.synths.push(this);
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
    FakeNode,
    FakePolySynth,
    transport,
    scheduler: null as Scheduler | null,
    synths: [] as FakePolySynth[],
    nodes: [] as FakeNode[],
    startAudio: vi.fn(async () => undefined),
    tickAssignments,
  };
});

vi.mock("tone", () => ({
  getTransport: () => audioMocks.transport,
  start: audioMocks.startAudio,
  PolySynth: audioMocks.FakePolySynth,
  Synth: class FakeSynth {},
  // The real MonoSynth needs an audio context; only the surface the subclass
  // touches is reproduced here.
  MonoSynth: class FakeMonoSynth extends audioMocks.FakeNode {
    filterEnvelope = { baseFrequency: 620 as number | string };
    constructor() {
      super("monoSynth");
    }
    static getDefaults() {
      return {};
    }
    toFrequency(value: number | string) {
      return typeof value === "number" ? value : 440;
    }
    protected _triggerEnvelopeAttack() {}
  },
  Gain: class extends audioMocks.FakeNode {
    constructor(gain?: number) {
      super("gain", gain);
    }
  },
  Limiter: class extends audioMocks.FakeNode {
    constructor(threshold?: number) {
      super("limiter", threshold);
    }
  },
  Compressor: class extends audioMocks.FakeNode {
    constructor(options?: unknown) {
      super("compressor", options);
    }
  },
  Reverb: class extends audioMocks.FakeNode {
    constructor(options?: unknown) {
      super("reverb", options);
    }
  },
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
    audioMocks.nodes.length = 0;
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

    // A one-note chord renders as a bass-track note. Playback used to
    // special-case it to the chord synth while MIDI export already put it on
    // the bass track; scheduling from the rendered tracks removed that
    // divergence, so the assertions follow what is exported.
    const bassSynth = audioMocks.synths[2];
    expect(bassSynth?.triggerAttackRelease).toHaveBeenCalledTimes(1);
    expect(bassSynth?.triggerAttackRelease.mock.calls[0]?.[0]).toBeCloseTo(523.251, 3);
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

    // A one-note chord renders as a bass-track note. Playback used to
    // special-case it to the chord synth while MIDI export already put it on
    // the bass track; scheduling from the rendered tracks removed that
    // divergence, so the assertions follow what is exported.
    const bassSynth = audioMocks.synths[2];
    expect(bassSynth?.triggerAttackRelease).toHaveBeenCalledTimes(2);
    expect(bassSynth?.triggerAttackRelease.mock.calls[0]?.[0]).toBeCloseTo(261.626, 3);
    expect(bassSynth?.triggerAttackRelease.mock.calls[1]?.[0]).toBeCloseTo(293.665, 3);
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

    // One-note chord, so it renders onto the bass track; see the note above.
    const bassSynth = audioMocks.synths[2];
    expect(bassSynth?.triggerAttackRelease).toHaveBeenCalledTimes(1);
    expect(bassSynth?.triggerAttackRelease.mock.calls[0]?.[0]).toBeCloseTo(523.251, 3);
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

/**
 * The shared output chain.
 *
 * Every synth used to run straight to the destination, which is why the piece
 * sounded like several separate instruments in separate rooms. These pin that
 * the chain exists, that it is the only route out, and that a React remount
 * does not leave a copy of it behind.
 */
describe("effects bus", () => {
  beforeEach(() => {
    audioMocks.synths.length = 0;
    audioMocks.nodes.length = 0;
    audioMocks.scheduler = null;
  });

  /** Follows connect() from a node until it reaches the destination. */
  function chainFrom(node: { target: unknown; destination: boolean }): string[] {
    const path: string[] = [];
    let current: typeof node | null = node;
    while (current) {
      const kind = (current as unknown as { kind: string }).kind;
      if (kind !== "polySynth") path.push(kind);
      if (current.destination) return path;
      current = current.target as typeof node | null;
      if (path.length > 10) break;
    }
    return path;
  }

  /**
   * A piece carrying an additional voice per instrument, so every branch of
   * createVoiceSynth runs. Without one, the bus is only ever requested from
   * initialize and a chain rebuilt per request would look identical; without
   * all three, a single branch left on toDestination() goes unnoticed.
   */
  function withVoice() {
    const piece = composition();
    const lead = piece.notes[0]!;
    const instruments = ["softLead", "bass", "pluck"] as const;
    piece.voices = instruments.map((instrument, index) => ({
      id: `voice-${instrument}`,
      name: instrument,
      role: "countermelody" as const,
      instrument,
      color: "#58c7d9",
      midiChannel: 2 + index,
      notes: [{ ...lead, id: `note-${instrument}`, startTick: 0, midi: 55 + index }],
    }));
    return piece;
  }

  async function started(transport = new CompositionTransport()) {
    const piece = withVoice();
    transport.configure(piece, { startTick: 0, endTick: piece.totalTicks }, () => {});
    await transport.play();
    audioMocks.scheduler?.(0);
    return transport;
  }

  it("builds every synth as a filtered voice, with a preset that reaches it", async () => {
    // The oscillators used to run unfiltered, so every note of a given
    // instrument had one spectrum and only its loudness changed. A preset
    // dropped on the floor here would look exactly like the old behaviour.
    const { VelocityFilterSynth } = await import("../src/audio/velocityFilterSynth");
    await started();

    expect(audioMocks.synths.length).toBeGreaterThan(0);
    for (const synth of audioMocks.synths) {
      expect(synth.voice).toBe(VelocityFilterSynth);
      const preset = synth.preset as {
        filter?: { type?: string };
        filterEnvelope?: { baseFrequency?: number; octaves?: number };
      };
      expect(preset.filter?.type).toBe("lowpass");
      expect(preset.filterEnvelope?.baseFrequency).toBeGreaterThan(0);
      expect(preset.filterEnvelope?.octaves).toBeGreaterThan(0);
    }
  });

  it("filters each instrument in its own register, low to high", async () => {
    // A bass and a lead filtered at the same frequency is one instrument
    // played at two pitches. Merely being distinct is not enough either: the
    // order has to follow the register, or the bass is the bright one.
    // No additional voices, because ensureVoiceSynths runs between the melody
    // and the bass and would otherwise sit at index 2.
    const transport = new CompositionTransport();
    const piece = composition();
    transport.configure(piece, { startTick: 0, endTick: piece.totalTicks }, () => {});
    await transport.play();

    const cutoff = (index: number) =>
      (audioMocks.synths[index]?.preset as { filterEnvelope?: { baseFrequency?: number } })
        .filterEnvelope?.baseFrequency ?? 0;

    expect(audioMocks.synths).toHaveLength(3);
    // initialize builds them in this order: chord, melody, then bass.
    const [chord, melody, bass] = [cutoff(0), cutoff(1), cutoff(2)];
    expect(bass).toBeGreaterThan(0);
    expect(chord).toBeGreaterThan(bass);
    expect(melody).toBeGreaterThan(chord);
  });

  it("routes every synth to the destination through the chain", async () => {
    await started();

    expect(audioMocks.synths.length).toBeGreaterThan(0);
    for (const synth of audioMocks.synths) {
      // Reaching the destination is not enough: it has to arrive via the bus,
      // in this order. Reverb before the compressor so the compressor does not
      // pump against the tail; the limiter last, as a ceiling and not a sound.
      expect(chainFrom(synth)).toEqual(["gain", "reverb", "compressor", "limiter", "gain"]);
    }
  });

  it("gives no synth a private route to the destination", async () => {
    await started();

    // The mutation this catches is one synth left on toDestination(): it would
    // still be audible, still pass every scheduling test, and simply skip the
    // effects. Only the master gain may end the chain.
    const direct = audioMocks.nodes.filter((node) => node.destination);
    expect(direct).toHaveLength(1);
    expect(direct[0]?.kind).toBe("gain");
    for (const synth of audioMocks.synths) {
      expect(synth.destination).toBe(false);
    }
  });

  it("builds one chain and shares it, however many synths there are", async () => {
    await started();

    // Six by now: chord, melody, bass, and one per additional voice.
    expect(audioMocks.synths.length).toBe(6);
    expect(audioMocks.nodes.filter((node) => node.kind === "reverb")).toHaveLength(1);
    expect(audioMocks.nodes.filter((node) => node.kind === "compressor")).toHaveLength(1);
    expect(audioMocks.nodes.filter((node) => node.kind === "limiter")).toHaveLength(1);
    // All three synths land on the same input node.
    const inputs = new Set(audioMocks.synths.map((synth) => synth.target));
    expect(inputs.size).toBe(1);
  });

  it("leaves the master with headroom rather than running at full scale", async () => {
    await started();

    const master = audioMocks.nodes.find((node) => node.destination);
    expect(master?.options).toBeLessThan(1);
    expect(master?.options).toBeGreaterThan(0.5);
  });

  it("tears the chain down on dispose and builds a fresh one after", async () => {
    // A remount that reuses a disposed chain is silence; one that leaks a chain
    // per mount stacks reverb until the mix collapses.
    const transport = await started();
    const first = audioMocks.nodes.filter((node) => node.kind !== "polySynth");
    const firstSynths = [...audioMocks.synths];
    expect(first.length).toBeGreaterThan(0);

    transport.dispose();
    // Twice, because a StrictMode remount runs cleanup twice. Disposing a node
    // that is already gone must not happen at all.
    transport.dispose();
    for (const node of first) {
      expect(node.dispose).toHaveBeenCalledTimes(1);
    }

    // The same instance, because that is what a remount reuses. Forgetting to
    // clear the handle leaves it pointing at a chain that has been torn down,
    // and the second mount plays into nothing.
    await started(transport);
    const second = audioMocks.nodes.filter(
      (node) => node.kind === "reverb" && !first.includes(node),
    );
    expect(second).toHaveLength(1);
    expect(second[0]?.dispose).not.toHaveBeenCalled();
    const rebuilt = audioMocks.synths.filter((entry) => !firstSynths.includes(entry));
    expect(rebuilt.length).toBeGreaterThan(0);
    for (const synth of rebuilt) {
      expect(chainFrom(synth)).toEqual(["gain", "reverb", "compressor", "limiter", "gain"]);
      // Specifically the new chain. Reusing a disposed one still type-checks.
      expect((synth.target as { target: unknown } | null)?.target).toBe(second[0]);
      expect(first).not.toContain(synth.target);
    }
  });
});
