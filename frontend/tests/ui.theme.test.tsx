import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useTheme, applyTheme, readStoredTheme, THEME_STORAGE_KEY } from "../src/hooks/useTheme";
import type { ThemeControl } from "../src/hooks/useTheme";

/**
 * Light, dark, or whatever the machine says.
 *
 * The third state is the whole difficulty. A two-position switch cannot say
 * "follow the machine", and the option that does say it has to report what the
 * MACHINE is set to -- not what is currently on screen, which is the thing the
 * user just overrode.
 */

let host: HTMLDivElement;
let root: Root;
let matches = false;
const listeners = new Set<(event: MediaQueryListEvent) => void>();

function Probe({ onRender }: { onRender: (control: ThemeControl) => void }) {
  onRender(useTheme());
  return null;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  matches = false;
  listeners.clear();
  // matchMedia does not exist in jsdom, and the hook's whole job is to read it.
  (globalThis as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
    matches: query.includes("dark") ? matches : false,
    media: query,
    addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => listeners.delete(fn),
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.documentElement.removeAttribute("data-theme");
});

function mount(): () => ThemeControl {
  let latest: ThemeControl | null = null;
  act(() => root.render(<Probe onRender={(control) => { latest = control; }} />));
  return () => latest as ThemeControl;
}

describe("the theme choice", () => {
  it("follows the machine until told otherwise, and says so by adding nothing", () => {
    // "system" is stored as the ABSENCE of the attribute, so the
    // prefers-color-scheme block in the stylesheet governs. Writing
    // data-theme="system" would match neither theme selector.
    matches = true;
    const control = mount();
    expect(control().theme).toBe("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(control().resolved).toBe("dark");
  });

  it("reports what the machine says, not what is on screen", () => {
    // The bug this replaced: on a dark machine, choosing light made the
    // "follow the machine" option read "currently light" -- describing the
    // override rather than what the option would give you back.
    matches = true;
    const control = mount();
    act(() => control().setTheme("light"));
    expect(control().resolved, "on screen").toBe("light");
    expect(control().systemResolved, "the machine").toBe("dark");
  });

  it("wins over the machine in both directions", () => {
    matches = true;
    const control = mount();
    act(() => control().setTheme("light"));
    expect(document.documentElement.dataset.theme).toBe("light");
    act(() => control().setTheme("dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows the machine changing while the app is open", () => {
    // A scheduled switch at sunset, or the setting toggled in another window.
    const control = mount();
    expect(control().systemResolved).toBe("light");
    act(() => {
      matches = true;
      for (const listen of listeners) listen({ matches: true } as MediaQueryListEvent);
    });
    expect(control().systemResolved).toBe("dark");
    expect(control().resolved).toBe("dark");
  });

  it("remembers the choice, and reads back only what it wrote", () => {
    const control = mount();
    act(() => control().setTheme("dark"));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(readStoredTheme()).toBe("dark");
    localStorage.setItem(THEME_STORAGE_KEY, "solarized");
    expect(readStoredTheme(), "an unknown value is not a theme").toBe("system");
  });

  it("applies without React, which is what index.html does before first paint", () => {
    // The inline script in index.html runs the same assignment, because a
    // module script runs after paint and a stored dark theme would otherwise
    // flash white on every load.
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyTheme("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
