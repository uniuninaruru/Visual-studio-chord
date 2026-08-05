import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhaseControls } from "../src/features/generator/PhaseControls";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import { buildCompositionTracks } from "../src/music/compositionTracks";
import type { GeneratorSettings } from "../src/types/music";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The expression settings, from the panel.
 *
 * Dynamics, bass register, arpeggio and colour tones are all opt-in and all
 * default to off, which is what keeps existing pieces byte-identical. That
 * also means an unreachable control is indistinguishable from a feature that
 * was never built: nothing in the app would sound any different either way.
 */

describe("expression controls", () => {
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

  function render(settings: GeneratorSettings, onPatch = vi.fn()) {
    act(() => root.render(<PhaseControls settings={settings} onPatch={onPatch} />));
    // The controls live in a collapsed <details>; open every one so the test
    // drives the same elements a user reaches by clicking the summary.
    act(() => {
      for (const details of host.querySelectorAll("details")) details.open = true;
    });
    return onPatch;
  }

  function toggleLabelled(text: string): HTMLInputElement {
    const label = [...host.querySelectorAll("label.phase-toggle")]
      .find((entry) => entry.textContent?.includes(text));
    expect(label, `no toggle labelled ${text}`).toBeDefined();
    return label!.querySelector("input[type=checkbox]") as HTMLInputElement;
  }

  const SWITCHES = [
    { text: "強弱をつける", key: "dynamics" },
    { text: "ベースを低い音域で鳴らす", key: "bassRegister" },
    { text: "和音を分散させて弾く", key: "arpeggio" },
    { text: "テンションを加える", key: "tensions" },
  ] as const;

  it("offers every expression setting", () => {
    render(DEFAULT_GENERATOR_SETTINGS);
    for (const { text } of SWITCHES) {
      expect(toggleLabelled(text)).toBeDefined();
    }
  });

  it("starts every one of them off", () => {
    // They have to default to off, or an existing project would change the
    // moment it was opened.
    render(DEFAULT_GENERATOR_SETTINGS);
    for (const { text } of SWITCHES) {
      expect(toggleLabelled(text).checked).toBe(false);
    }
  });

  it("switches each one on through its own key", () => {
    for (const { text, key } of SWITCHES) {
      const onPatch = render(DEFAULT_GENERATOR_SETTINGS, vi.fn());
      act(() => toggleLabelled(text).click());
      expect(onPatch).toHaveBeenCalledTimes(1);
      const patch = onPatch.mock.calls[0]![0] as Record<string, { enabled: boolean }>;
      expect(patch[key]?.enabled).toBe(true);
    }
  });

  it("switches each one back off", () => {
    for (const { text, key } of SWITCHES) {
      const settings = {
        ...DEFAULT_GENERATOR_SETTINGS,
        [key]: { enabled: true },
      } as GeneratorSettings;
      const onPatch = render(settings, vi.fn());
      expect(toggleLabelled(text).checked).toBe(true);
      act(() => toggleLabelled(text).click());
      const patch = onPatch.mock.calls[0]![0] as Record<string, { enabled: boolean }>;
      expect(patch[key]?.enabled).toBe(false);
    }
  });

  it("hides the detail controls until the setting is on", () => {
    render(DEFAULT_GENERATOR_SETTINGS);
    const labels = [...host.querySelectorAll("label.field")].map((entry) => entry.textContent);
    for (const detail of ["強弱の幅", "弾く向き", "細かさ", "どこまで高い音を使うか"]) {
      expect(labels.some((label) => label?.includes(detail))).toBe(false);
    }
  });

  function fieldLabelled(text: string): HTMLSelectElement {
    const label = [...host.querySelectorAll("label.field")]
      .find((entry) => entry.textContent?.includes(text));
    expect(label, `no field labelled ${text}`).toBeDefined();
    return label!.querySelector("select") as HTMLSelectElement;
  }

  it("reveals the arpeggio detail controls once it is on", () => {
    const onPatch = render(
      { ...DEFAULT_GENERATOR_SETTINGS, arpeggio: { enabled: true } } as GeneratorSettings,
      vi.fn(),
    );

    const direction = fieldLabelled("弾く向き");
    act(() => {
      direction.value = "upDown";
      direction.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect((onPatch.mock.calls[0]![0] as { arpeggio: { pattern: string; enabled: boolean } })
      .arpeggio).toMatchObject({ pattern: "upDown", enabled: true });

    const rate = fieldLabelled("細かさ");
    act(() => {
      rate.value = "4";
      rate.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // A number, not the string the DOM hands back: the generator divides by it.
    expect((onPatch.mock.calls[1]![0] as { arpeggio: { rate: unknown } }).arpeggio.rate).toBe(4);
  });

  it("reveals the tension detail controls once it is on", () => {
    const onPatch = render(
      { ...DEFAULT_GENERATOR_SETTINGS, tensions: { enabled: true } } as GeneratorSettings,
      vi.fn(),
    );

    const ceiling = fieldLabelled("どこまで高い音を使うか");
    act(() => {
      ceiling.value = "9";
      ceiling.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect((onPatch.mock.calls[0]![0] as { tensions: { ceiling: string; enabled: boolean } })
      .tensions).toMatchObject({ ceiling: "9", enabled: true });

    const rate = fieldLabelled("どのくらいの和音に足すか");
    act(() => {
      rate.value = "1";
      rate.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect((onPatch.mock.calls[1]![0] as { tensions: { rate: unknown } }).tensions.rate).toBe(1);
  });

  it("reveals the dynamics depth once it is on, as a number", () => {
    const onPatch = render(
      { ...DEFAULT_GENERATOR_SETTINGS, dynamics: { enabled: true } } as GeneratorSettings,
      vi.fn(),
    );
    const depth = fieldLabelled("強弱の幅");
    act(() => {
      depth.value = "0.6";
      depth.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect((onPatch.mock.calls[0]![0] as { dynamics: { depth: unknown } }).dynamics.depth).toBe(0.6);
  });

  it("changes the piece for every setting the panel offers", () => {
    // The end of the chain. A control that patches a key the generator ignores
    // would pass every assertion above and still do nothing.
    const base = generateComposition({
      ...DEFAULT_GENERATOR_SETTINGS, seed: "ui", bars: 8,
    } as GeneratorSettings);
    const baseTracks = JSON.stringify(buildCompositionTracks(base));

    for (const { key } of SWITCHES) {
      const changed = generateComposition({
        ...DEFAULT_GENERATOR_SETTINGS, seed: "ui", bars: 8, [key]: { enabled: true },
      } as GeneratorSettings);
      expect(
        JSON.stringify(buildCompositionTracks(changed)),
        `enabling ${key} changed nothing`,
      ).not.toBe(baseTracks);
    }
  });
});
