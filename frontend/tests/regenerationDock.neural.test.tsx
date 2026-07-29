import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegenerationDock } from "../src/features/variations/RegenerationDock";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("RegenerationDock neural harmony controls", () => {
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

  it("offers an accessible device selector and explains theory fallback", () => {
    const onPreferredDeviceChange = vi.fn();
    act(() => {
      root.render(
        <RegenerationDock
          selectedRange={{ startBar: 0, endBar: 2 }}
          lockedCount={0}
          target="chords"
          strength="moderate"
          processing={false}
          harmonyModel={null}
          preferredDevice="auto"
          onTargetChange={vi.fn()}
          onStrengthChange={vi.fn()}
          onPreferredDeviceChange={onPreferredDeviceChange}
          onRegenerate={vi.fn()}
          onSelectAll={vi.fn()}
        />,
      );
    });

    expect(host.textContent).toContain("Neural unavailable · Theory fallback");
    const selector = host.querySelector<HTMLSelectElement>(
      'select[aria-label="ニューラルハーモニーの推論デバイス"]',
    );
    expect(selector).not.toBeNull();
    expect([...selector!.options].map((option) => option.value))
      .toEqual(["auto", "mps", "cuda", "cpu"]);
    act(() => {
      selector!.value = "cpu";
      selector!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onPreferredDeviceChange).toHaveBeenCalledWith("cpu");
    expect(host.querySelector(".regenerate-button")?.getAttribute("title"))
      .toContain("理論生成へ安全にフォールバック");
  });

  it("marks an available mock as explicit and untrained", () => {
    act(() => {
      root.render(
        <RegenerationDock
          selectedRange={{ startBar: 0, endBar: 1 }}
          lockedCount={0}
          target="chords"
          strength="subtle"
          processing={false}
          harmonyModel={{
            id: "mock-harmonyforge-bimask-v1",
            name: "HarmonyForge Mock",
            runtime: "cpu",
            available: true,
            loaded: true,
            capabilities: ["generateHarmony"],
            backend: "mock",
            mock: true,
          }}
          preferredDevice="auto"
          onTargetChange={vi.fn()}
          onStrengthChange={vi.fn()}
          onPreferredDeviceChange={vi.fn()}
          onRegenerate={vi.fn()}
          onSelectAll={vi.fn()}
        />,
      );
    });

    expect(host.textContent).toContain("Explicit Mock · untrained");
    expect(host.textContent).toContain("Neural条件はメロディ・調性・固定コードのみ");
    expect(host.textContent).toContain("変化量（Theory fallback）");
    expect(host.querySelector(".regenerate-button")?.getAttribute("aria-describedby"))
      .toContain("neural-conditioning-note");
    expect(host.querySelector(".regeneration-engine-note")?.classList.contains("is-mock"))
      .toBe(true);
  });
});
