import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppMenu } from "../src/features/menu/AppMenu";
import { GUIDE, MUSIC_CREDITS, RELEASE_NOTES, RUNTIME_CREDITS } from "../src/features/menu/content";
import { DEFAULT_MIXER, type MixerSettings } from "../src/audio/transport";
import { readStoredMixer } from "../src/hooks/useMixerSettings";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The menu behind the three lines.
 *
 * Two things are worth holding here. That the reference material is reachable
 * and complete -- a guide that silently stops halfway sends people looking for
 * a control it never mentioned. And that the faders report what they are set
 * to, because a settings panel whose numbers disagree with the audio is worse
 * than no panel: it is believed.
 */

describe("the menu", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    globalThis.localStorage?.clear();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    globalThis.localStorage?.clear();
  });

  function render(overrides: Partial<Parameters<typeof AppMenu>[0]> = {}) {
    const props = {
      open: true,
      onClose: vi.fn(),
      mixer: { ...DEFAULT_MIXER } as MixerSettings,
      onMixerChange: vi.fn(),
      onOpenTutorial: vi.fn(),
      onOpenDiagnostics: vi.fn(),
      appVersion: "0.4.0",
      ...overrides,
    };
    act(() => root.render(<AppMenu {...props} />));
    return props;
  }

  function tab(label: string): HTMLButtonElement {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button.menu-tab")]
      .find((entry) => entry.textContent === label);
    expect(found, `no tab labelled ${label}`).toBeDefined();
    return found!;
  }

  function open(label: string) {
    act(() => tab(label).click());
  }

  const text = () => host.textContent ?? "";

  it("renders nothing at all when closed", () => {
    render({ open: false });
    expect(host.innerHTML).toBe("");
  });

  it("opens on the guide, which is what a first visit wants", () => {
    render();
    expect(tab("使い方").getAttribute("aria-selected")).toBe("true");
    expect(text()).toContain(GUIDE[0]!.heading);
  });

  it("moves between its four tabs", () => {
    render();
    for (const label of ["設定", "更新履歴", "ライセンス", "使い方"]) {
      open(label);
      expect(tab(label).getAttribute("aria-selected"), label).toBe("true");
      const others = ["使い方", "設定", "更新履歴", "ライセンス"].filter((entry) => entry !== label);
      for (const other of others) {
        expect(tab(other).getAttribute("aria-selected"), `${label}/${other}`).toBe("false");
      }
    }
  });

  it("shows every guide step, not a truncated list", () => {
    render();
    for (const section of GUIDE) {
      expect(text(), section.heading).toContain(section.heading);
      for (const step of section.steps) {
        expect(text(), step.title).toContain(step.title);
      }
    }
  });

  it("names a license and a link for every credit", () => {
    // A credits entry with a blank beside the name is worse than no entry.
    render();
    open("ライセンス");
    for (const credit of [...RUNTIME_CREDITS, ...MUSIC_CREDITS]) {
      const link = [...host.querySelectorAll("a")].find((entry) => entry.textContent === credit.name);
      expect(link, credit.name).toBeDefined();
      expect(link!.getAttribute("href"), credit.name).toBe(credit.url);
      expect(link!.parentElement?.textContent, credit.name).toContain(credit.license);
    }
  });

  it("opens credit links in a new tab without handing over the opener", () => {
    render();
    open("ライセンス");
    const links = [...host.querySelectorAll("a")];
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    }
  });

  it("says plainly that no corpus ships with the app", () => {
    // The claim someone checking licences is actually there to check.
    render();
    open("ライセンス");
    expect(text()).toContain("同梱していません");
  });

  it("lists the newest release first", () => {
    render();
    open("更新履歴");
    const headings = [...host.querySelectorAll("h3")].map((node) => node.textContent ?? "");
    expect(headings[0]).toContain(RELEASE_NOTES[0]!.version);
    for (const note of RELEASE_NOTES) {
      for (const change of note.changes) expect(text(), change.slice(0, 20)).toContain(change);
    }
  });

  it("reports each fader as a percentage of where it sits", () => {
    render({ mixer: { master: 0.4, chords: 1, melody: 0.75, bass: 0, reverb: 0.22 } });
    open("設定");
    const values = [...host.querySelectorAll(".menu-fader-value")].map((node) => node.textContent);
    expect(values).toEqual(["40%", "100%", "75%", "0%", "22%"]);
  });

  it("reports a moved fader by name and value", () => {
    const props = render();
    open("設定");
    const melody = [...host.querySelectorAll<HTMLDivElement>(".menu-fader")]
      .find((entry) => entry.textContent?.includes("メロディ"))!
      .querySelector("input")!;
    // React's onChange on a range listens to the native "input" event, and it
    // tracks the value on the node -- assigning .value directly leaves the
    // tracker thinking nothing changed and the handler never fires. Going
    // through the prototype setter is what makes this a real user interaction
    // rather than a call to the handler.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!
      .set!.call(melody, "30");
    act(() => {
      melody.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(props.onMixerChange).toHaveBeenCalledWith({ melody: 0.3 });
  });

  it("puts every fader back where it started", () => {
    const props = render({
      mixer: { master: 0.1, chords: 0.2, melody: 0.3, bass: 0.4, reverb: 0.5 },
    });
    open("設定");
    const reset = [...host.querySelectorAll<HTMLButtonElement>(".menu-actions button")]
      .find((entry) => entry.textContent?.includes("初期値に戻す"))!;
    act(() => reset.click());
    expect(props.onMixerChange).toHaveBeenCalledWith({ ...DEFAULT_MIXER });
  });

  it("says that the faders do not change the piece", () => {
    // The one thing a user could reasonably fear on finding volume controls
    // beside a generator, so it is stated rather than implied.
    render();
    open("設定");
    expect(text()).toContain("曲そのものは変わりません");
  });

  it("closes on Escape, and on the backdrop, but not on its own body", () => {
    const props = render();
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;

    act(() => {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);

    act(() => dialog.click());
    expect(props.onClose, "clicking the panel itself must not close it").toHaveBeenCalledTimes(1);

    act(() => (dialog.parentElement as HTMLElement).click());
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("hands the tutorial back to the app and gets out of the way", () => {
    // Both the tutorial and diagnostics live outside this dialog; leaving it
    // open would stack two modals on top of each other.
    const props = render();
    const button = [...host.querySelectorAll<HTMLButtonElement>(".menu-actions button")]
      .find((entry) => entry.textContent?.includes("はじめてのガイド"))!;
    act(() => button.click());
    expect(props.onOpenTutorial).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it("is announced as a dialog and names itself", () => {
    render();
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("メニュー");
  });
});

describe("remembering where the faders were", () => {
  beforeEach(() => globalThis.localStorage?.clear());
  afterEach(() => globalThis.localStorage?.clear());

  it("starts at the defaults with nothing stored", () => {
    expect(readStoredMixer()).toEqual({ ...DEFAULT_MIXER });
  });

  it("falls back to the defaults rather than throwing on unreadable storage", () => {
    // A mixer that cannot be parsed is not a reason to refuse to start.
    globalThis.localStorage.setItem("vsc.mixer.v1", "{not json");
    expect(readStoredMixer()).toEqual({ ...DEFAULT_MIXER });
  });

  it("clamps a value that is out of range or the wrong type", () => {
    globalThis.localStorage.setItem(
      "vsc.mixer.v1",
      JSON.stringify({ master: 7, chords: -3, melody: "loud", bass: null }),
    );
    const mixer = readStoredMixer();
    expect(mixer.master).toBe(1);
    expect(mixer.chords).toBe(0);
    expect(mixer.melody).toBe(DEFAULT_MIXER.melody);
    expect(mixer.bass).toBe(DEFAULT_MIXER.bass);
  });

  it("reads back what was written", () => {
    globalThis.localStorage.setItem(
      "vsc.mixer.v1",
      JSON.stringify({ master: 0.4, chords: 0.6, melody: 0.8, bass: 0.2, reverb: 0 }),
    );
    expect(readStoredMixer()).toEqual({
      master: 0.4, chords: 0.6, melody: 0.8, bass: 0.2, reverb: 0,
    });
  });
});
