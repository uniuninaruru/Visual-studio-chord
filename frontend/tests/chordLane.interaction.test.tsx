import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChordLane } from "../src/features/editor/ChordLane";
import { MINIMAL_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import type { GeneratedComposition } from "../src/types/music";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function piece(seed = "chord-lane-ui"): GeneratedComposition {
  return generateComposition({
    ...MINIMAL_GENERATOR_SETTINGS,
    bars: 4,
    seed,
  });
}

describe("ChordLane direct editing toolbar", () => {
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

  function render(
    composition: GeneratedComposition,
    selectedChordId: string | null = composition.chords[0]?.id ?? null,
    lockedBars: number[] = [],
    overrides: Partial<React.ComponentProps<typeof ChordLane>> = {},
  ) {
    const props: React.ComponentProps<typeof ChordLane> = {
      composition,
      selectedRange: null,
      selectedChordId,
      currentTick: 0,
      lockedBars,
      onBarSelect: vi.fn(),
      onChordSelect: vi.fn(),
      onToggleLock: vi.fn(),
      onAddChord: vi.fn(() => "added-chord"),
      onDeleteChord: vi.fn(() => true),
      onSplitChord: vi.fn(() => "right-chord"),
      onMoveChord: vi.fn(() => true),
      onResizeChord: vi.fn(() => true),
      ...overrides,
    };
    act(() => root.render(<ChordLane {...props} />));
    return props;
  }

  function button(text: string): HTMLButtonElement {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.trim() === text);
    expect(found, `button ${text} was not rendered`).toBeDefined();
    return found!;
  }

  it("passes the selected chord's quantized midpoint and one-beat bounds to every action", () => {
    const composition = piece();
    const target = composition.chords[0]!;
    const props = render(composition);
    const add = props.onAddChord as ReturnType<typeof vi.fn>;
    const split = props.onSplitChord as ReturnType<typeof vi.fn>;
    const move = props.onMoveChord as ReturnType<typeof vi.fn>;
    const resize = props.onResizeChord as ReturnType<typeof vi.fn>;
    const remove = props.onDeleteChord as ReturnType<typeof vi.fn>;
    const midpoint = target.startTick + target.durationTick / 2;
    const grid = composition.ppq / 4;
    const splitTick = Math.round(midpoint / grid) * grid;
    const beat = composition.ppq;

    const input = host.querySelector<HTMLInputElement>("#chord-add-symbol");
    expect(input).not.toBeNull();
    if (!input) return;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "F#7");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(button("実行").disabled).toBe(false);
    act(() => button("実行").click());
    expect(add).toHaveBeenCalledWith("F#7", splitTick, Math.min(beat, target.startTick + target.durationTick - splitTick));

    act(() => button("分割").click());
    expect(split).toHaveBeenCalledWith(target.id, splitTick);

    expect(button("1拍左へ").disabled).toBe(true);
    act(() => button("1拍右へ").click());
    expect(move).toHaveBeenCalledWith(target.id, target.startTick + beat);

    act(() => button("1拍短く").click());
    expect(resize).toHaveBeenCalledWith(target.id, target.durationTick - beat);
    act(() => button("1拍長く").click());
    expect(resize).toHaveBeenCalledWith(target.id, target.durationTick + beat);

    act(() => button("削除").click());
    expect(remove).toHaveBeenCalledWith(target.id);
  });

  it("shows disabled reasons for locked and terminal edits", () => {
    const composition = piece("locked-chord-lane-ui");
    const target = composition.chords[0]!;
    render(composition, target.id, [0]);
    for (const name of ["実行", "削除", "分割", "1拍右へ", "1拍短く", "1拍長く"]) {
      expect(button(name).disabled, name).toBe(true);
    }
    expect(host.querySelector(".chord-action-hint")?.textContent).toContain("ロック");

    const terminal = piece("terminal-chord-lane-ui");
    const only = { ...terminal.chords[0]!, startTick: 0, durationTick: terminal.totalTicks };
    terminal.chords = [only];
    render(terminal, only.id, []);
    expect(button("削除").disabled).toBe(true);
    expect(button("1拍短く").disabled).toBe(true);
    expect(host.querySelector(".chord-action-hint")?.textContent).toContain("終端");
  });

  it("uses overlap duration for subdivided bar columns and has an empty state", () => {
    const composition = piece("proportional-chord-lane-ui");
    const first = composition.chords[0]!;
    const fragment = { ...first, id: "fragment", startTick: 480, durationTick: 1_440 };
    composition.chords = [
      { ...first, durationTick: 480 },
      fragment,
      ...composition.chords.slice(1),
    ];
    render(composition);
    expect(host.querySelector<HTMLElement>(".chord-content-group")?.style.gridTemplateColumns)
      .toBe("480fr 1440fr");
    expect(host.textContent).toContain("Bar/Beat");

    render(composition, null);
    expect(host.textContent).toContain("コードを選ぶと直接編集できます。");
    expect(host.querySelector("#chord-add-symbol")).toBeNull();
  });
});
