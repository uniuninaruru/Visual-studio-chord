import { beforeEach, describe, expect, it } from "vitest";
import {
  CompositionImportError,
  exportCompositionJson,
  importCompositionJson,
  isGeneratorSettings,
} from "../src/features/export";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition, validateGeneratorSettings } from "../src/music";
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

function withoutJazzField(field: keyof typeof JAZZ): Record<string, unknown> {
  const value: Record<string, unknown> = { ...JAZZ };
  delete value[field];
  return value;
}

const INVALID_JAZZ_CASES: readonly [string, unknown][] = [
  ["null", null],
  ["array", []],
  ["unknown version", { ...JAZZ, version: 2 }],
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

describe("jazz settings contract", () => {
  beforeEach(() => {
    localStorage.clear();
    useComposerStore.getState().reset({ seed: "jazz-contract" });
  });

  it("starts fresh editor projects with jazz while retaining the legacy default export", () => {
    expect(DEFAULT_GENERATOR_SETTINGS.jazz).toBeUndefined();
    const fresh = useComposerStore.getState().settings;
    expect(fresh.style).toBe("jazz");
    expect(fresh.jazz).toEqual(JAZZ);
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
    expect(useComposerStore.getState().settings.jazz).toEqual({ ...JAZZ, style: "bebop" });
    useComposerStore.getState().updateSettings({ jazz: { interaction: 0.2 } });
    expect(useComposerStore.getState().settings.jazz).toEqual({ ...JAZZ, style: "bebop", interaction: 0.2 });
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
    document.composition.settings.jazz = { ...JAZZ, version: 2 };
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
