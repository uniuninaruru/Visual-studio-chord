import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhaseControls } from "../src/features/generator/PhaseControls";
import { DEFAULT_GENERATOR_SETTINGS } from "../src/music";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("Phase A-D controls", () => {
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

  it("shows beginner labels for every phase and wires multi-voice settings", () => {
    const onPatch = vi.fn();
    act(() => {
      root.render(
        <PhaseControls settings={{ ...DEFAULT_GENERATOR_SETTINGS }} onPatch={onPatch} />,
      );
    });

    expect(host.textContent).toContain("曲の流れ");
    expect(host.textContent).toContain("歌えるメロディ");
    expect(host.textContent).toContain("和音を豊かに");
    expect(host.textContent).toContain("ノリと多声部");

    const label = [...host.querySelectorAll("label")].find(
      (candidate) => candidate.textContent?.includes("対旋律"),
    );
    const checkbox = label?.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(checkbox).toBeDefined();
    act(() => checkbox?.click());
    expect(onPatch).toHaveBeenCalledWith({
      arrangement: {
        counterpoint: {
          enabled: true,
          position: "below",
          independence: 0.65,
        },
      },
    });
  });
});
