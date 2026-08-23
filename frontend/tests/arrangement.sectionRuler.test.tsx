import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SectionRuler } from "../src/features/arrangement/SectionRuler";
import {
  DEFAULT_GENERATOR_SETTINGS,
  MINIMAL_GENERATOR_SETTINGS,
  createDefaultSectionArrangement,
  generateComposition,
} from "../src/music";
import type { BarRange, GeneratedComposition, SectionEvent } from "../src/types/music";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function compositionWithSections(bars = 8): GeneratedComposition {
  const composition = generateComposition({
    ...MINIMAL_GENERATOR_SETTINGS,
    bars: bars as 8 | 16 | 24 | 32,
    seed: `section-ruler-${bars}`,
  });
  composition.sections = [
    {
      id: "plain-intro",
      kind: "intro",
      startBar: 0,
      endBar: Math.min(4, bars),
      key: "C",
      mode: "major",
      transpose: 0,
    },
    ...(bars >= 8 ? [{
      id: "plain-verse",
      kind: "verse" as const,
      startBar: 4,
      endBar: 8,
      key: "C" as const,
      mode: "major" as const,
      transpose: 0,
    }] : []),
  ];
  return composition;
}

function arrangedComposition(): GeneratedComposition {
  const composition = generateComposition({
    ...DEFAULT_GENERATOR_SETTINGS,
    bars: 32,
    seed: "section-ruler-arrangement",
  });
  const plan = createDefaultSectionArrangement({
    ...DEFAULT_GENERATOR_SETTINGS,
    bars: 8,
  });
  composition.arrangementPlan = plan;
  composition.sections = plan.sequence.map((instance, index) => {
    const source = plan.sections.find((candidate) => candidate.design.id === instance.sourceSectionId);
    const startBar = index * 8;
    return {
      id: instance.id,
      kind: (index === 0 ? "intro" : index === 1 ? "verse" : index === 2 ? "preChorus" : "chorus") as SectionEvent["kind"],
      startBar,
      endBar: startBar + 8,
      key: "C",
      mode: "major",
      transpose: 0,
      progressionId: source?.material.settings.progressionId,
    };
  });
  return composition;
}

describe("SectionRuler", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(composition: GeneratedComposition, currentTick = 0, selectedRange: BarRange | null = null, onSelectRange = vi.fn()) {
    act(() => root.render(
      <SectionRuler
        composition={composition}
        currentTick={currentTick}
        selectedRange={selectedRange}
        onSelectRange={onSelectRange}
      />,
    ));
    return onSelectRange;
  }

  it("renders nothing when sections are absent or empty", () => {
    const composition = compositionWithSections();
    delete composition.sections;
    render(composition);
    expect(host.querySelector(".section-ruler")).toBeNull();

    composition.sections = [];
    render(composition);
    expect(host.querySelector(".section-ruler")).toBeNull();
  });

  it("resolves arrangement instance roles and display names into aligned spans", () => {
    const composition = arrangedComposition();
    render(composition);
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".section-ruler-segment")];
    expect(buttons).toHaveLength(4);
    expect(buttons.map((button) => button.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining("Intro"),
      expect.stringContaining("Aメロ"),
      expect.stringContaining("Bメロ"),
      expect.stringContaining("Cメロ"),
    ]));
    expect(buttons[0]?.textContent).toContain("1–8小節");
    expect(buttons[0]?.style.gridColumn).toBe("1 / 9");
    expect(buttons[3]?.style.gridColumn).toBe("25 / 33");
    expect(buttons[0]?.querySelector(".section-ruler-segment-label")?.textContent).toBe("Intro");
    expect(host.querySelector<HTMLElement>(".section-ruler")?.style.getPropertyValue("--bar-count")).toBe("32");
    expect(host.querySelector<HTMLElement>(".section-ruler-track")?.style.getPropertyValue("--bar-count")).toBe("32");
  });

  it("falls back to the normal section label when no arrangement plan resolves", () => {
    const composition = compositionWithSections();
    render(composition);
    const first = host.querySelector<HTMLButtonElement>(".section-ruler-segment");
    expect(first?.querySelector(".section-ruler-segment-label")?.textContent).toBe("イントロ");
    expect(first?.querySelector(".section-ruler-segment-label")?.textContent).not.toContain("イントロイントロ");
    expect(first?.getAttribute("aria-label")).toContain("イントロ");
  });

  it("marks overlap, exact selection, and a terminal playback tick without relying on color", () => {
    const composition = compositionWithSections();
    render(composition, composition.totalTicks + composition.ticksPerBar, { startBar: 2, endBar: 6 });
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".section-ruler-segment")];
    expect(buttons[0]?.classList.contains("is-selected")).toBe(true);
    expect(buttons[1]?.classList.contains("is-selected")).toBe(true);
    expect(buttons[0]?.getAttribute("aria-pressed")).not.toBe("true");
    expect(buttons[0]?.getAttribute("aria-current")).not.toBe("true");

    const terminal = buttons[1];
    expect(terminal?.getAttribute("aria-current")).toBe("true");
    expect(terminal?.textContent).toContain("再生位置");

    render(composition, composition.totalTicks + 1, { startBar: 4, endBar: 8 });
    const exact = host.querySelectorAll<HTMLButtonElement>(".section-ruler-segment")[1];
    expect(exact?.classList.contains("is-selected-exact")).toBe(true);
    expect(exact?.getAttribute("aria-pressed")).toBe("true");
  });

  it("emits the exact normalized bar range on click", () => {
    const composition = compositionWithSections();
    const onSelectRange = render(composition);
    act(() => host.querySelector<HTMLButtonElement>(".section-ruler-segment")?.click());
    expect(onSelectRange).toHaveBeenCalledWith({ startBar: 0, endBar: 4 });
  });

  it("clamps boundary sections and excludes invalid or empty ranges", () => {
    const composition = compositionWithSections();
    composition.sections = [
      {
        id: "clamped",
        kind: "intro",
        startBar: -4,
        endBar: 99,
        key: "C",
        mode: "major",
        transpose: 0,
      },
      {
        id: "outside-left",
        kind: "verse",
        startBar: -5,
        endBar: -1,
        key: "C",
        mode: "major",
        transpose: 0,
      },
      {
        id: "outside-right",
        kind: "chorus",
        startBar: 9,
        endBar: 12,
        key: "C",
        mode: "major",
        transpose: 0,
      },
      {
        id: "empty",
        kind: "bridge",
        startBar: 4,
        endBar: 4,
        key: "C",
        mode: "major",
        transpose: 0,
      },
      {
        id: "nonfinite-start",
        kind: "outro",
        startBar: Number.NaN,
        endBar: 8,
        key: "C",
        mode: "major",
        transpose: 0,
      },
      {
        id: "nonfinite-end",
        kind: "outro",
        startBar: 0,
        endBar: Number.POSITIVE_INFINITY,
        key: "C",
        mode: "major",
        transpose: 0,
      },
    ];
    const onSelectRange = render(composition);
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".section-ruler-segment")];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.style.gridColumn).toBe("1 / 9");
    act(() => buttons[0]?.click());
    expect(onSelectRange).toHaveBeenCalledWith({ startBar: 0, endBar: 8 });
  });
});
