import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarmonyInsightsPanel } from "../src/features/statistics/HarmonyInsightsPanel";
import type { StatisticalChordSuggestion } from "../src/music/statisticalHarmony";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import type { GeneratedComposition } from "../src/types/music";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("HarmonyInsightsPanel", () => {
  let host: HTMLDivElement;
  let root: Root;
  let composition: GeneratedComposition;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    composition = generateComposition({ ...DEFAULT_GENERATOR_SETTINGS, bars: 8, seed: "statistics-panel" });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(
    selectedChord = null as GeneratedComposition["chords"][number] | null,
    lockedBars: readonly number[] = [],
  ) {
    const props = {
      composition,
      analysisScope: null,
      targetLabel: "曲全体",
      selectedChord,
      lockedBars,
      onAudition: vi.fn(),
      onApply: vi.fn((_suggestion: StatisticalChordSuggestion) => {
        void _suggestion;
        return true;
      }),
      onToast: vi.fn(),
    };
    act(() => root.render(<HarmonyInsightsPanel {...props} />));
    return props;
  }

  it("shows provenance, metrics, profiles, and prevents whole-song apply", () => {
    render();
    expect(host.textContent).toContain("POP909 909曲");
    expect(host.textContent).toContain("直接観測頻度");
    expect(host.textContent).toContain("置換対象: 未選択（候補は試聴のみ）");
    expect(host.textContent).toContain("曲末の次コード候補（試聴のみ）");
    expect(host.querySelectorAll(".harmony-insights-profile")).toHaveLength(3);
    const applyButtons = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => button.textContent?.includes("適用"));
    expect(applyButtons.length).toBeGreaterThan(0);
    expect(applyButtons.every((button) => button.disabled)).toBe(true);
  });

  it("auditions and explicitly applies a selected chord", () => {
    const selectedChord = composition.chords[0]!;
    const props = render(selectedChord);
    expect(host.textContent).toContain(`置換対象: 1小節 ${selectedChord.symbol}`);
    expect(host.textContent).toContain("選択コードの置き換え候補");
    const audition = host.querySelector<HTMLButtonElement>("button[aria-label$='を試聴']");
    act(() => audition?.click());
    expect(props.onAudition).toHaveBeenCalledOnce();
    const apply = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("1小節のコードに適用"));
    expect(apply?.disabled).toBe(false);
    act(() => apply?.click());
    expect(props.onApply).toHaveBeenCalledOnce();
    const suggestion = props.onApply.mock.calls[0]?.[0];
    expect(suggestion?.chord.startTick).toBe(selectedChord.startTick);
  });

  it("explains a locked bar when a selected chord spans into it", () => {
    const bar = composition.ticksPerBar;
    const first = composition.chords[0]!;
    const barOne = composition.chords[1]!;
    composition = {
      ...composition,
      // Keep a valid timeline: the first chord holds through bar 1, the
      // original bar-1 chord is removed, and the later timeline is untouched.
      chords: composition.chords
        .filter((chord) => chord.id !== barOne.id)
        .map((chord) => chord.id === first.id
          ? { ...chord, durationTick: bar * 2 }
          : chord),
    };
    const selectedChord = composition.chords[0]!;
    render(selectedChord, [1]);
    expect(host.textContent).toContain("ロックされた小節があるため、適用できません");
    const apply = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("1小節のコードに適用"));
    expect(apply).toBeDefined();
    expect(apply?.disabled).toBe(true);
    expect(apply?.getAttribute("aria-label")).toContain("ロック");
    expect(apply?.title).toContain("ロック");
    expect(apply?.getAttribute("aria-label")).not.toContain("Chord Laneでコードを選択");
  });
});
