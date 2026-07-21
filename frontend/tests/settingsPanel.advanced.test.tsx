import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../src/features/generator/SettingsPanel";
import { DEFAULT_GENERATOR_SETTINGS } from "../src/music";
import type { GeneratorSettings } from "../src/types/music";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("SettingsPanel advanced harmony controls", () => {
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

  function render(settings: GeneratorSettings): void {
    act(() => {
      root.render(
        <SettingsPanel
          settings={settings}
          backend={{ state: "checking" }}
          mobileOpen={false}
          onPatch={vi.fn()}
          onGenerate={vi.fn()}
          onReset={vi.fn()}
          onOpenDiagnostics={vi.fn()}
          onMobileClose={vi.fn()}
        />,
      );
    });
  }

  it("disables special-chord multipliers outside Advanced and explains their scale", () => {
    render({
      ...DEFAULT_GENERATOR_SETTINGS,
      harmony: { complexity: "triads" },
    });

    for (const label of ["借用和音率", "セカンダリードミナント率", "ハーモニー探索率"]) {
      const slider = host.querySelector<HTMLInputElement>(`input[aria-label='${label}']`);
      expect(slider?.disabled).toBe(true);
      const hint = document.getElementById(slider?.getAttribute("aria-describedby") ?? "");
      expect(hint?.textContent).toContain("Advanced時のみ有効");
      expect(hint?.textContent).toContain("100% = スタイル既定、0% = 無効");
    }
    const voiceLeading = host.querySelector<HTMLInputElement>(
      "input[aria-label='ボイスリーディング強度']",
    );
    expect(voiceLeading?.disabled).toBe(false);
    expect(
      document.getElementById(voiceLeading?.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toContain("前のコードを考慮しない");
  });

  it("enables special-chord multipliers in Advanced mode", () => {
    render({
      ...DEFAULT_GENERATOR_SETTINGS,
      harmony: {
        complexity: "advanced",
        borrowedChordRate: 0.25,
        secondaryDominantRate: 0.5,
        explorationRate: 0.75,
        voiceLeadingStrength: 0.4,
      },
    });

    expect(
      host.querySelector<HTMLInputElement>("input[aria-label='借用和音率']")?.disabled,
    ).toBe(false);
    expect(
      host.querySelector<HTMLInputElement>("input[aria-label='セカンダリードミナント率']")?.disabled,
    ).toBe(false);
    expect(
      host.querySelector<HTMLInputElement>("input[aria-label='ハーモニー探索率']")?.disabled,
    ).toBe(false);
    expect(host.textContent).toContain("25%");
    expect(host.textContent).toContain("50%");
    expect(host.textContent).toContain("75%");
    expect(host.textContent).toContain("40%");
  });
});
