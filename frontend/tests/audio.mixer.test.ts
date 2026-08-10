import { describe, expect, it } from "vitest";
import { CompositionTransport, DEFAULT_MIXER } from "../src/audio/transport";

/**
 * The faders reaching the audio, rather than only the label beside them.
 *
 * The menu test proves the slider reports what it is set to. That is the easy
 * half: a panel whose numbers are right and whose sound is unchanged is exactly
 * the failure worth catching, because it is the one a user believes.
 *
 * jsdom has no Web Audio, so Tone's nodes are not built here and the assertions
 * are about what the transport remembers and hands on -- which is the part that
 * was wired, and the part that can silently come unwired. Nothing here disposes
 * for the same reason: teardown reaches into a transport jsdom does not have.
 */

describe("the mixer", () => {
  it("starts at the shipped defaults", () => {
    const transport = new CompositionTransport();
    expect(transport.getMixer()).toEqual({ ...DEFAULT_MIXER });
  });

  it("keeps a value set before anything exists to apply it to", () => {
    // The synths and the bus are built lazily on the first play. A volume set
    // on a silent app must survive until there is something to apply it to,
    // or every setting made before pressing play is discarded.
    const transport = new CompositionTransport();
    transport.setMixer({ master: 0.25, reverb: 0 });
    expect(transport.getMixer().master).toBe(0.25);
    expect(transport.getMixer().reverb).toBe(0);
  });

  it("changes only what it is given", () => {
    const transport = new CompositionTransport();
    transport.setMixer({ melody: 0.5 });
    expect(transport.getMixer()).toEqual({ ...DEFAULT_MIXER, melody: 0.5 });
    transport.setMixer({ bass: 0.1 });
    expect(transport.getMixer()).toEqual({ ...DEFAULT_MIXER, melody: 0.5, bass: 0.1 });
  });

  it("hands back a copy, so a caller cannot reach in and change it", () => {
    const transport = new CompositionTransport();
    const snapshot = transport.getMixer() as { master: number };
    snapshot.master = 0;
    expect(transport.getMixer().master).toBe(DEFAULT_MIXER.master);
  });

  it("ships with headroom rather than at full scale", () => {
    // The bus runs into a limiter; arriving at unity would mean the limiter is
    // working on every chord rather than catching the low end that bassRegister
    // occasionally adds.
    expect(DEFAULT_MIXER.master).toBeLessThan(1);
    expect(DEFAULT_MIXER.reverb).toBeGreaterThan(0);
    expect(DEFAULT_MIXER.reverb).toBeLessThan(0.5);
  });
});
