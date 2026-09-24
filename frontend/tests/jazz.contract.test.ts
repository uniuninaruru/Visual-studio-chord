import { beforeEach, describe, expect, it } from "vitest";
import {
  CompositionImportError,
  exportCompositionJson,
  importCompositionJson,
  isGeneratorSettings,
} from "../src/features/export";
import {
  DEFAULT_GENERATOR_SETTINGS,
  generateComposition,
  regenerateRange,
  validateComposition,
  validateGeneratorSettings,
} from "../src/music";
import { generateJazzComposition, regenerateJazzRange } from "../src/music/jazzEngine";
import { planTheoryHarmony } from "../src/music/theoryHarmony";
import { useComposerStore } from "../src/state";
import { EDITOR_STORAGE_KEY, loadEditorSnapshotWithStatus } from "../src/storage";
import type { GeneratorSettings } from "../src/types/music";

const JAZZ = {
  version: 1 as const,
  style: "swing" as const,
  form: "aaba" as const,
  chromaticism: 0.35,
  interaction: 0.6,
};

const THEORY_JAZZ = { ...JAZZ, version: 2 as const };

function withoutJazzField(field: keyof typeof JAZZ): Record<string, unknown> {
  const value: Record<string, unknown> = { ...JAZZ };
  delete value[field];
  return value;
}

const INVALID_JAZZ_CASES: readonly [string, unknown][] = [
  ["null", null],
  ["array", []],
  ["unknown version", { ...JAZZ, version: 3 }],
  ["unknown style", { ...JAZZ, style: "smoothJazz" }],
  ["unknown form", { ...JAZZ, form: "verse" }],
  ["missing version", withoutJazzField("version")],
  ["missing style", withoutJazzField("style")],
  ["missing form", withoutJazzField("form")],
  ["missing chromaticism", withoutJazzField("chromaticism")],
  ["missing interaction", withoutJazzField("interaction")],
  ["negative chromaticism", { ...JAZZ, chromaticism: -0.01 }],
  ["high chromaticism", { ...JAZZ, chromaticism: 1.01 }],
  ["negative interaction", { ...JAZZ, interaction: -0.01 }],
  ["high interaction", { ...JAZZ, interaction: 1.01 }],
  ["NaN chromaticism", { ...JAZZ, chromaticism: Number.NaN }],
  ["Infinity interaction", { ...JAZZ, interaction: Number.POSITIVE_INFINITY }],
];

function legacyComposition() {
  return generateComposition({
    ...DEFAULT_GENERATOR_SETTINGS,
    style: "pop",
    seed: "legacy-contract",
    bars: 12,
  });
}

function theoryBluesComposition(jazzVersion: 1 | 2) {
  const jazz = { ...THEORY_JAZZ, version: jazzVersion, form: "blues" as const };
  const settings: GeneratorSettings = {
    ...DEFAULT_GENERATOR_SETTINGS,
    style: "jazz",
    bars: 12,
    jazz,
    seed: `blues-cadence-v${jazzVersion}`,
  };
  const base = generateComposition({
    ...DEFAULT_GENERATOR_SETTINGS,
    style: "pop",
    bars: 12,
    seed: `blues-cadence-base-v${jazzVersion}`,
  });
  const harmony = planTheoryHarmony({ settings, jazz, ppq: base.ppq });
  return {
    ...base,
    settings,
    chords: harmony.chords,
    sections: harmony.sections,
    cadence: harmony.cadence,
    resolvedStyle: harmony.resolvedStyle,
  };
}

describe("jazz settings contract", () => {
  beforeEach(() => {
    localStorage.clear();
    useComposerStore.getState().reset({ seed: "jazz-contract" });
  });

  it("starts fresh editor projects with jazz while retaining the legacy default export", () => {
    expect(DEFAULT_GENERATOR_SETTINGS.jazz).toBeUndefined();
    const fresh = useComposerStore.getState().settings;
    expect(fresh.style).toBe("jazz");
    expect(fresh.jazz).toEqual(THEORY_JAZZ);
  });

  it("keeps a restored legacy composition free of an implicit jazz field", () => {
    useComposerStore.getState().importJson(exportCompositionJson(legacyComposition()));
    const restored = useComposerStore.getState().settings;
    expect(Object.prototype.hasOwnProperty.call(restored, "jazz")).toBe(false);
    useComposerStore.getState().updateSettings({ bpm: restored.bpm + 1 });
    expect(Object.prototype.hasOwnProperty.call(useComposerStore.getState().settings, "jazz")).toBe(false);
  });

  it("keeps the optional jazz field absent while hydrating a legacy snapshot", () => {
    const composition = legacyComposition();
    const snapshot = {
      version: 1 as const,
      settings: composition.settings,
      composition,
      selectedBarRange: null,
      loopRange: { startTick: 0, endTick: composition.totalTicks },
      lockedBars: composition.lockedBars,
      updateTiming: "nextBar" as const,
      history: [{
        id: "legacy-hydration-history",
        action: "generate",
        timestamp: new Date().toISOString(),
        seed: String(composition.seed),
        range: null,
        composition,
      }],
      historyIndex: 0,
      regenerationIteration: 0,
    };
    localStorage.setItem(EDITOR_STORAGE_KEY, JSON.stringify(snapshot));

    const loaded = loadEditorSnapshotWithStatus();
    expect(loaded.snapshot).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(loaded.snapshot?.settings ?? {}, "jazz")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(loaded.snapshot?.composition.settings ?? {}, "jazz"))
      .toBe(false);
  });

  it("merges profile changes without replacing the other jazz controls", () => {
    useComposerStore.getState().updateSettings({ jazz: { style: "bebop" } });
    expect(useComposerStore.getState().settings.jazz).toEqual({ ...THEORY_JAZZ, style: "bebop" });
    useComposerStore.getState().updateSettings({ jazz: { interaction: 0.2 } });
    expect(useComposerStore.getState().settings.jazz).toEqual({ ...THEORY_JAZZ, style: "bebop", interaction: 0.2 });
  });

  it("accepts an exact 12-bar jazz project and rejects incompatible blues lengths", () => {
    const blues = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      style: "jazz",
      jazz: { ...JAZZ, form: "blues" },
      bars: 12,
      seed: "blues-contract",
    });
    expect(blues.bars).toHaveLength(12);
    expect(blues.totalTicks).toBe(blues.ticksPerBar * 12);
    expect(importCompositionJson(exportCompositionJson(blues))).toEqual(blues);
    expect(isGeneratorSettings(blues.settings)).toBe(true);

    const invalid = { ...blues.settings, bars: 16 as const } satisfies GeneratorSettings;
    const validation = validateGeneratorSettings(invalid);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((issue) => issue.code === "settings.jazz.form")).toBe(true);
  });

  it.each([JAZZ, THEORY_JAZZ])("round-trips supported jazz schema version $version", (jazz) => {
    const composition = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      style: "jazz",
      jazz,
      bars: 12,
      seed: `schema-v${jazz.version}-round-trip`,
    });

    const imported = importCompositionJson(exportCompositionJson(composition));
    expect(imported.settings.jazz?.version).toBe(jazz.version);
    expect(isGeneratorSettings(imported.settings)).toBe(true);
  });

  it("retains version 1 settings when an imported legacy jazz project is regenerated", () => {
    const legacy = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      style: "jazz",
      jazz: JAZZ,
      bars: 12,
      seed: "legacy-jazz-regeneration",
    });
    const imported = importCompositionJson(exportCompositionJson(legacy));
    const regenerationSettings = {
      ...imported.settings,
      seed: "legacy-jazz-regeneration-again",
    };
    const regenerated = generateComposition(regenerationSettings);
    const directLegacyGeneration = generateJazzComposition(regenerationSettings, JAZZ);
    const range = { startBar: 1, endBar: 2 };
    const partialRegeneration = regenerateRange(imported, regenerationSettings, range);
    const directLegacyRegeneration = regenerateJazzRange(imported, regenerationSettings, range);

    expect(imported.settings.jazz?.version).toBe(1);
    expect(regenerated.settings.jazz?.version).toBe(1);
    expect(regenerated).toEqual(directLegacyGeneration);
    expect(partialRegeneration).toEqual(directLegacyRegeneration);
  });

  it("accepts the theory v2 I7-to-V7 blues turnaround cadence label", () => {
    const composition = theoryBluesComposition(2);
    expect(composition.chords.slice(-2).map(({ degree, quality }) => [degree, quality]))
      .toEqual([[1, "dominant7"], [5, "dominant7"]]);

    const validation = validateComposition(composition);
    expect(validation.warnings.map(({ code }) => code)).not.toContain("cadence.metadata");
  });

  it("still warns for an incorrect v2 blues turnaround and preserves v1 cadence semantics", () => {
    const v2 = theoryBluesComposition(2);
    const incorrectEnding = {
      ...v2,
      chords: v2.chords.map((chord, index) => index === v2.chords.length - 1
        ? { ...chord, degree: 4 }
        : chord),
    };
    expect(validateComposition(incorrectEnding).warnings.map(({ code }) => code))
      .toContain("cadence.metadata");

    const legacyV1 = theoryBluesComposition(1);
    expect(validateComposition(legacyV1).warnings.map(({ code }) => code))
      .toContain("cadence.metadata");
  });

  it.each([
    ["key", { key: "invalid-key" as never }, "sections.key"],
    ["mode", { mode: "invalid-mode" as never }, "sections.mode"],
  ] as const)("returns a validation error for a malformed final section %s without throwing", (_field, patch, code) => {
    const composition = theoryBluesComposition(2);
    const finalSectionIndex = composition.sections.length - 1;
    const malformed = {
      ...composition,
      sections: composition.sections.map((section, index) => index === finalSectionIndex
        ? { ...section, ...patch }
        : section),
    };

    expect(() => validateComposition(malformed)).not.toThrow();
    expect(validateComposition(malformed).errors.map(({ code: issueCode }) => issueCode))
      .toContain(code);
  });

  it("keeps section composer sources valid when the current project is 12-bar blues", () => {
    const store = useComposerStore.getState();
    store.reset({
      bars: 12,
      jazz: { ...JAZZ, form: "blues" },
      seed: "blues-sections",
    });
    expect(store.initializeSectionArrangement()).toBe(true);
    const result = store.assembleArrangement();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.composition.settings.jazz?.form).toBe("free");
    }
  });

  it("labels any assembled jazz sequence as free rather than implying AABA", () => {
    const store = useComposerStore.getState();
    store.reset({
      bars: 16,
      jazz: { ...JAZZ, form: "aaba" },
      seed: "aaba-sections",
    });
    expect(store.initializeSectionArrangement()).toBe(true);
    const result = store.assembleArrangement();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.composition.settings.jazz?.form).toBe("free");
  });

  it("rejects an unknown jazz version and out-of-range numbers at the file boundary", () => {
    const composition = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      style: "jazz",
      jazz: JAZZ,
      bars: 12,
      seed: "schema-contract",
    });
    const document = JSON.parse(exportCompositionJson(composition)) as {
      composition: { settings: Record<string, unknown> };
    };
    document.composition.settings.jazz = { ...JAZZ, version: 3 };
    expect(() => importCompositionJson(JSON.stringify(document))).toThrow(CompositionImportError);
    document.composition.settings.jazz = { ...JAZZ, chromaticism: 1.1 };
    expect(() => importCompositionJson(JSON.stringify(document))).toThrow(CompositionImportError);
  });

  it.each(INVALID_JAZZ_CASES)("rejects %s in direct validation and settings boundary", (_label, jazz) => {
    const composition = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      style: "jazz",
      jazz: JAZZ,
      bars: 12,
      seed: "direct-schema-contract",
    });
    const settings = { ...composition.settings, jazz } as GeneratorSettings;
    expect(validateGeneratorSettings(settings).valid).toBe(false);
    expect(isGeneratorSettings(settings)).toBe(false);
  });

  it.each(INVALID_JAZZ_CASES)("rejects %s after JSON serialization at the file boundary", (_label, jazz) => {
    const composition = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS,
      style: "jazz",
      jazz: JAZZ,
      bars: 12,
      seed: "file-schema-contract",
    });
    const document = JSON.parse(exportCompositionJson(composition)) as {
      composition: { settings: Record<string, unknown> };
    };
    document.composition.settings.jazz = jazz;
    // JSON.stringify intentionally turns NaN/Infinity into null; the file
    // boundary must reject that representation just as it rejects the direct
    // non-finite object before serialization.
    expect(() => importCompositionJson(JSON.stringify(document))).toThrow(CompositionImportError);
  });
});
