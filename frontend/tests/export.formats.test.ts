import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import {
  CompositionImportError,
  exportCompositionJson,
  exportCompositionMidi,
  importCompositionFile,
  importCompositionJson,
  isGeneratorSettings,
} from "../src/features/export";
import {
  DEFAULT_GENERATOR_SETTINGS,
  MINIMAL_GENERATOR_SETTINGS,
  assembleSectionArrangement,
  buildCompositionTracks,
  createDefaultSectionArrangement,
  generateComposition,
  reconcileSectionLinks,
} from "../src/music";
import type { GeneratedComposition, SectionArrangementPlan } from "../src/types/music";

function assembledArrangement(extraIntroInstances = 0): GeneratedComposition {
  const plan = createDefaultSectionArrangement(DEFAULT_GENERATOR_SETTINGS);
  const sequence = [...plan.sequence];
  for (let index = 0; index < extraIntroInstances; index += 1) {
    sequence.push({
      id: `instance-extra-intro-${index + 1}`,
      sourceSectionId: "source-intro",
    });
  }
  const arranged = reconcileSectionLinks(plan, sequence);
  const result = assembleSectionArrangement(arranged, DEFAULT_GENERATOR_SETTINGS);
  if (!result.ok) throw new Error(result.issues.map((entry) => entry.message).join(" "));
  return result.composition;
}

function documentFor(composition: GeneratedComposition): Record<string, unknown> {
  return JSON.parse(exportCompositionJson(composition)) as Record<string, unknown>;
}

function arrangementPlanFrom(composition: GeneratedComposition): SectionArrangementPlan {
  if (!composition.arrangementPlan) throw new Error("Expected an arrangement plan.");
  return structuredClone(composition.arrangementPlan);
}

describe("composition export", () => {
  const composition = generateComposition({
    ...MINIMAL_GENERATOR_SETTINGS,
    seed: "export-tests",
  });

  it("round-trips the versioned JSON format", () => {
    const json = exportCompositionJson(composition);
    const document = JSON.parse(json) as { schemaVersion: number; appVersion: string };
    expect(document.schemaVersion).toBe(3);
    expect(document.appVersion).toBe("0.4.0");
    const imported = importCompositionJson(json);
    expect(imported).toEqual(composition);
    expect(imported).not.toBe(composition);
  });

  it("round-trips assembled 32-bar and 128-bar projects", () => {
    const assembled32 = assembledArrangement();
    const assembled128 = assembledArrangement(12);
    expect(assembled32.settings.bars).toBe(32);
    expect(assembled128.settings.bars).toBe(128);
    expect(isGeneratorSettings(assembled128.settings)).toBe(false);
    expect(importCompositionJson(exportCompositionJson(assembled32))).toEqual(assembled32);
    const json128 = exportCompositionJson(assembled128);
    expect(json128.length).toBeLessThanOrEqual(5_000_000);
    expect(new TextEncoder().encode(json128).byteLength).toBeLessThanOrEqual(6_000_000);
    expect(importCompositionJson(json128)).toEqual(assembled128);
  });

  it("migrates legacy v1 documents and rejects unknown project schemas", () => {
    const legacy = JSON.parse(exportCompositionJson(composition)) as Record<string, unknown>;
    delete legacy.schemaVersion;
    delete legacy.appVersion;
    expect(importCompositionJson(JSON.stringify(legacy))).toEqual(composition);

    const schema2 = JSON.parse(exportCompositionJson(composition)) as Record<string, unknown>;
    schema2.schemaVersion = 2;
    schema2.appVersion = "0.3.0";
    expect(importCompositionJson(JSON.stringify(schema2))).toEqual(composition);

    const assembledForLegacy = assembledArrangement();
    const expectedLegacy = importCompositionJson(exportCompositionJson(assembledForLegacy));
    delete expectedLegacy.arrangementPlan;
    const injectedPlan = documentFor(assembledForLegacy);
    delete injectedPlan.schemaVersion;
    delete injectedPlan.appVersion;
    expect(importCompositionJson(JSON.stringify(injectedPlan))).toEqual(expectedLegacy);

    const injectedPlanV2 = documentFor(assembledForLegacy);
    injectedPlanV2.schemaVersion = 2;
    injectedPlanV2.appVersion = "0.3.0";
    expect(importCompositionJson(JSON.stringify(injectedPlanV2))).toEqual(expectedLegacy);

    const legacyWideFakePlan = documentFor(assembledArrangement(12));
    delete legacyWideFakePlan.schemaVersion;
    delete legacyWideFakePlan.appVersion;
    expect(() => importCompositionJson(JSON.stringify(legacyWideFakePlan))).toThrow(
      /incomplete or out of range/,
    );

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

  it("rejects malformed arrangement plans and fake current assemblies", () => {
    const assembled = assembledArrangement();
    const basePlan = arrangementPlanFrom(assembled);
    const rejectPlan = (mutate: (plan: Record<string, unknown>, composition: Record<string, unknown>) => void) => {
      const document = documentFor(assembled);
      const documentComposition = document.composition as Record<string, unknown>;
      const plan = structuredClone(documentComposition.arrangementPlan) as Record<string, unknown>;
      mutate(plan, documentComposition);
      documentComposition.arrangementPlan = plan;
      expect(() => importCompositionJson(JSON.stringify(document))).toThrow(CompositionImportError);
    };

    const nullPlan = documentFor(assembled);
    (nullPlan.composition as Record<string, unknown>).arrangementPlan = null;
    expect(() => importCompositionJson(JSON.stringify(nullPlan))).toThrow(CompositionImportError);
    rejectPlan((plan) => { plan.extra = true; });
    rejectPlan((plan) => { (plan.sections as Array<Record<string, unknown>>)[0]!.extra = true; });
    rejectPlan((plan) => {
      const material = (plan.sections as Array<Record<string, unknown>>)[0]!.material as Record<string, unknown>;
      material.arrangementPlan = {};
    });
    rejectPlan((plan) => {
      (plan.sequence as Array<Record<string, unknown>>)[0]!.sourceSectionId = "missing-source";
    });
    rejectPlan((plan) => {
      (plan.links as Array<Record<string, unknown>>)[0]!.fromInstanceId = "missing-instance";
    });
    rejectPlan((plan) => { (plan.links as Array<Record<string, unknown>>)[0]!.seed = "not-derived"; });
    rejectPlan((plan) => { plan.revision = -1; });
    rejectPlan((plan) => { plan.assembledRevision = (plan.revision as number) + 1; });
    rejectPlan((plan) => { plan.resolvedLinks = []; });
    rejectPlan((plan) => {
      (plan.resolvedLinks as Array<Record<string, unknown>>)[0]!.label = "";
    });
    rejectPlan((plan) => {
      (plan.resolvedLinks as Array<Record<string, unknown>>)[0]!.explanation = "";
    });
    rejectPlan((_plan, documentComposition) => {
      const sections = documentComposition.sections as Array<Record<string, unknown>>;
      sections[0]!.id = "wrong-instance";
    });
    rejectPlan((_plan, documentComposition) => {
      const sections = documentComposition.sections as Array<Record<string, unknown>>;
      sections[0]!.progressionId = "fake-progression";
    });

    const unknownPlanVersion = documentFor(assembled);
    const unknownPlan = (unknownPlanVersion.composition as Record<string, unknown>).arrangementPlan as Record<string, unknown>;
    unknownPlan.version = 2;
    expect(() => importCompositionJson(JSON.stringify(unknownPlanVersion))).toThrow(
      /Unsupported arrangement plan version: 2/,
    );

    const over128 = reconcileSectionLinks(
      basePlan,
      [
        ...basePlan.sequence,
        ...Array.from({ length: 13 }, (_, index) => ({
          id: `instance-over-${index + 1}`,
          sourceSectionId: "source-intro",
        })),
      ],
    );
    const over128Document = documentFor(assembled);
    (over128Document.composition as Record<string, unknown>).arrangementPlan = over128;
    expect(() => importCompositionJson(JSON.stringify(over128Document))).toThrow(
      /incomplete or out of range/,
    );

    const manualMissingReceipts = documentFor(assembled);
    const manualMissingPlan = (manualMissingReceipts.composition as Record<string, unknown>)
      .arrangementPlan as Record<string, unknown>;
    manualMissingPlan.manualSongEdited = true;
    manualMissingPlan.resolvedLinks = [];
    expect(() => importCompositionJson(JSON.stringify(manualMissingReceipts))).toThrow(CompositionImportError);

    const manuallyEdited = structuredClone(assembled);
    const firstNote = manuallyEdited.notes[0];
    if (!firstNote) throw new Error("Expected an assembled melody note.");
    firstNote.velocity = firstNote.velocity === 127 ? 126 : firstNote.velocity + 1;
    if (!manuallyEdited.arrangementPlan) throw new Error("Expected an assembled arrangement plan.");
    manuallyEdited.arrangementPlan.manualSongEdited = true;
    expect(importCompositionJson(exportCompositionJson(manuallyEdited))).toEqual(manuallyEdited);

    const referencedDirty = documentFor(assembled);
    const referencedDirtyPlan = (referencedDirty.composition as Record<string, unknown>)
      .arrangementPlan as Record<string, unknown>;
    const referencedSourceId = ((referencedDirtyPlan.sequence as Array<Record<string, unknown>>)[0]!)
      .sourceSectionId as string;
    const referencedSource = (referencedDirtyPlan.sections as Array<Record<string, unknown>>)
      .find((source) => ((source.design as Record<string, unknown>).id as string) === referencedSourceId);
    if (!referencedSource) throw new Error("Expected a referenced source section.");
    referencedSource.dirty = true;
    expect(() => importCompositionJson(JSON.stringify(referencedDirty))).toThrow(CompositionImportError);

    const stalePlan = reconcileSectionLinks(basePlan, basePlan.sequence.slice(1));
    const dirtyFourSource = stalePlan.sections.find((source) => source.design.id === "source-intro");
    if (!dirtyFourSource) throw new Error("Expected the retained intro source section.");
    dirtyFourSource.dirty = true;
    dirtyFourSource.material = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      bars: 4,
      seed: "dirty-four-bar-material",
    });
    const dirtyFourDocument = documentFor(assembled);
    (dirtyFourDocument.composition as Record<string, unknown>).arrangementPlan = stalePlan;
    expect(() => importCompositionJson(JSON.stringify(dirtyFourDocument))).toThrow(CompositionImportError);

    const staleEightPlan = reconcileSectionLinks(basePlan, basePlan.sequence.slice(1));
    const dirtyEightSource = staleEightPlan.sections.find((source) => source.design.id === "source-intro");
    if (!dirtyEightSource) throw new Error("Expected the retained intro source section.");
    dirtyEightSource.dirty = true;
    const dirtyEightDocument = documentFor(assembled);
    (dirtyEightDocument.composition as Record<string, unknown>).arrangementPlan = staleEightPlan;
    const importedDirtyEight = importCompositionJson(JSON.stringify(dirtyEightDocument));
    const importedDirtyEightSource = importedDirtyEight.arrangementPlan?.sections
      .find((source) => source.design.id === "source-intro");
    expect(importedDirtyEightSource?.dirty).toBe(true);
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

  it("keeps every assembled main and additional track present through 128-bar MIDI export", () => {
    const assembled = assembledArrangement(12);
    const tracks = buildCompositionTracks(assembled);
    const midi = new Midi(exportCompositionMidi(assembled));
    const totalMidiTicks = Math.round(assembled.totalTicks * midi.header.ppq / assembled.ppq);

    expect(assembled.settings.bars).toBe(128);
    expect(midi.tracks.map((track) => track.name)).toEqual(tracks.map((track) => track.name));
    expect(midi.tracks).toHaveLength(tracks.length);
    for (const [index, track] of tracks.entries()) {
      const midiTrack = midi.tracks[index];
      expect(midiTrack?.notes).toHaveLength(track.notes.length);
      expect(midiTrack?.notes.every((note) => note.ticks + note.durationTicks <= totalMidiTicks)).toBe(true);
    }

    const finalSection = assembled.sections?.at(-1);
    expect(finalSection).toBeDefined();
    if (!finalSection) return;
    const finalStartTick = finalSection.startBar * assembled.ticksPerBar;
    const finalEndTick = finalSection.endBar * assembled.ticksPerBar;
    for (const track of tracks.slice(0, 3)) {
      expect(track.notes.some((note) => (
        note.startTick < finalEndTick
        && note.startTick + note.durationTick > finalStartTick
      ))).toBe(true);
    }
  });
});
