import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import {
  CompositionImportError,
  exportCompositionJson,
  exportCompositionMidi,
  importCompositionFile,
  importCompositionJson,
} from "../src/features/export";
import { MINIMAL_GENERATOR_SETTINGS, generateComposition } from "../src/music";

describe("composition export", () => {
  const composition = generateComposition({
    ...MINIMAL_GENERATOR_SETTINGS,
    seed: "export-tests",
  });

  it("round-trips the versioned JSON format", () => {
    const json = exportCompositionJson(composition);
    const document = JSON.parse(json) as { schemaVersion: number; appVersion: string };
    expect(document.schemaVersion).toBe(2);
    expect(document.appVersion).toMatch(/^0\.3\./);
    const imported = importCompositionJson(json);
    expect(imported).toEqual(composition);
    expect(imported).not.toBe(composition);
  });

  it("migrates legacy v1 documents and rejects unknown project schemas", () => {
    const legacy = JSON.parse(exportCompositionJson(composition)) as Record<string, unknown>;
    delete legacy.schemaVersion;
    delete legacy.appVersion;
    expect(importCompositionJson(JSON.stringify(legacy))).toEqual(composition);

    const future = JSON.parse(exportCompositionJson(composition)) as Record<string, unknown>;
    future.schemaVersion = 999;
    expect(() => importCompositionJson(JSON.stringify(future))).toThrow(
      /Unsupported project schema version/,
    );
  });

  it("accepts legacy harmony settings and rejects invalid advanced control values", () => {
    const legacy = JSON.parse(exportCompositionJson(composition)) as {
      composition: {
        settings: {
          harmony?: Record<string, unknown>;
        };
      };
    };
    const legacyHarmony = legacy.composition.settings.harmony;
    expect(legacyHarmony).toBeDefined();
    if (!legacyHarmony) return;
    delete legacyHarmony.borrowedChordRate;
    delete legacyHarmony.secondaryDominantRate;
    delete legacyHarmony.explorationRate;
    delete legacyHarmony.voiceLeadingStrength;
    expect(importCompositionJson(JSON.stringify(legacy)).settings.harmony).toEqual({
      complexity: "triads",
    });

    for (const field of [
      "borrowedChordRate",
      "secondaryDominantRate",
      "explorationRate",
      "voiceLeadingStrength",
    ]) {
      const invalid = JSON.parse(exportCompositionJson(composition)) as {
        composition: { settings: { harmony: Record<string, unknown> } };
      };
      invalid.composition.settings.harmony[field] = -0.01;
      expect(() => importCompositionJson(JSON.stringify(invalid))).toThrow(
        /incomplete or out of range/,
      );
    }
  });

  it("rejects malformed and unsupported JSON documents", () => {
    expect(() => importCompositionJson("not-json")).toThrow(CompositionImportError);
    expect(() =>
      importCompositionJson(
        JSON.stringify({
          format: "music-theory-composer",
          version: 999,
          composition,
        }),
      ),
    ).toThrow(/Unsupported composition version/);
  });

  it("validates file size and type hints before replacing a project", async () => {
    const validText = exportCompositionJson(composition);
    const imported = await importCompositionFile({
      name: "project.json",
      size: validText.length,
      type: "",
      text: async () => validText,
    });
    expect(imported.composition).toEqual(composition);
    expect(imported.json).toBe(validText);

    await expect(importCompositionFile({
      name: "project.json",
      size: 6_000_001,
      type: "application/json",
      text: async () => {
        throw new Error("oversized files must not be read");
      },
    })).rejects.toThrow(/too large/);

    await expect(importCompositionFile({
      name: "cover.png",
      size: 100,
      type: "image/png",
      text: async () => validText,
    })).rejects.toThrow(/JSON project file/);
  });

  it("rejects out-of-range MIDI velocity during import", () => {
    const document = JSON.parse(exportCompositionJson(composition)) as {
      composition: { notes: Array<{ velocity: number }> };
    };
    const note = document.composition.notes[0];
    expect(note).toBeDefined();
    if (!note) return;
    note.velocity = 0;
    expect(() => importCompositionJson(JSON.stringify(document))).toThrow(/incomplete or out of range/);
  });

  it("exports separate, parseable left hand, right hand and melody MIDI tracks", () => {
    const bytes = exportCompositionMidi(composition);
    const midi = new Midi(bytes);

    expect(midi.header.tempos[0]?.bpm).toBeCloseTo(composition.settings.bpm);
    expect(midi.tracks.map((track) => track.name)).toEqual([
      "Bass / Left Hand",
      "Chords / Right Hand",
      "Melody",
    ]);
    expect(midi.tracks[0]?.notes).toHaveLength(composition.chords.length);
    expect(midi.tracks[1]?.notes).toHaveLength(
      composition.chords.reduce(
        (total, chord) => total + Math.max(0, chord.notes.length - 1),
        0,
      ),
    );
    expect(midi.tracks[2]?.notes).toHaveLength(composition.notes.length);
    expect(midi.tracks[2]?.notes[0]?.ticks).toBe(composition.notes[0]?.startTick);
    expect(midi.tracks[2]?.notes[0]?.velocity).toBeCloseTo(
      (composition.notes[0]?.velocity ?? 0) / 127,
      1,
    );
  });

  it("round-trips additional voices and exports each as a MIDI track", () => {
    const arranged = generateComposition({
      ...MINIMAL_GENERATOR_SETTINGS,
      bars: 8,
      seed: "multi-voice-export",
      arrangement: {
        counterpoint: { enabled: true, position: "below", independence: 0.7 },
        canon: { enabled: true, delayBeats: 2, interval: 7 },
        polyrhythm: { enabled: true, pulses: 3 },
      },
    });

    expect(arranged.voices?.map((voice) => voice.role)).toEqual([
      "countermelody",
      "canon",
      "pulse",
    ]);
    expect(importCompositionJson(exportCompositionJson(arranged))).toEqual(arranged);

    const midi = new Midi(exportCompositionMidi(arranged));
    expect(midi.tracks.map((track) => track.name)).toEqual([
      "Bass / Left Hand",
      "Chords / Right Hand",
      "Melody",
      "Countermelody",
      "Canon",
      "Pulse layer",
    ]);
    for (const [index, voice] of (arranged.voices ?? []).entries()) {
      expect(midi.tracks[index + 3]?.notes).toHaveLength(voice.notes.length);
    }
  });
});
