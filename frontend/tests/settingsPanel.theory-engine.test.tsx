import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../src/features/generator/SettingsPanel";
import { DEFAULT_GENERATOR_SETTINGS } from "../src/music";
import { DEFAULT_JAZZ_SETTINGS } from "../src/music/jazzProfiles";
import type { GeneratorSettings } from "../src/types/music";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("SettingsPanel theory-led jazz engine", () => {
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

  function render(settings: GeneratorSettings, onPatch = vi.fn()): ReturnType<typeof vi.fn> {
    act(() => {
      root.render(
        <SettingsPanel
          settings={settings}
          backend={{ state: "checking" }}
          mobileOpen={false}
          onPatch={onPatch}
          onGenerate={vi.fn()}
          onReset={vi.fn()}
          onOpenDiagnostics={vi.fn()}
          onMobileClose={vi.fn()}
        />,
      );
    });
    return onPatch;
  }

  it("identifies v1 as the saved-project mode and offers an explicit v2 opt-in", () => {
    const onPatch = vi.fn();
    render({
      ...DEFAULT_GENERATOR_SETTINGS,
      style: "jazz",
      jazz: { ...DEFAULT_JAZZ_SETTINGS, version: 1 },
    }, onPatch);

    expect(host.textContent).toContain("従来のジャズ方式 v1 / Legacy jazz v1");
    expect(host.textContent).toContain("保存済みプロジェクトの再現");
    expect(host.textContent).toContain("切り替えだけでは保存済みの音符を書き換えません");

    const switchButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Use theory-led v2 for future generations"),
    );
    expect(switchButton?.textContent).toContain("理論ベース v2");
    act(() => switchButton?.click());
    expect(onPatch).toHaveBeenCalledWith({
      jazz: { ...DEFAULT_JAZZ_SETTINGS, version: 2 },
    });
  });

  it("identifies v2 as the theory-led generation mode", () => {
    render({
      ...DEFAULT_GENERATOR_SETTINGS,
      style: "jazz",
      jazz: { ...DEFAULT_JAZZ_SETTINGS, version: 2 },
    });

    expect(host.textContent).toContain("理論ベース v2 / Theory-led v2");
    expect(host.textContent).toContain("和声法・声部進行・対位法");
    expect(host.textContent).toContain("Existing project notes are not changed");
    expect([...host.querySelectorAll<HTMLButtonElement>("button")].some(
      (button) => button.textContent?.includes("Use theory-led v2 for future generations"),
    )).toBe(false);
  });
});
