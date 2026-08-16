import { useCallback, useEffect, useState } from "react";

/**
 * Light, dark, or whatever the machine says.
 *
 * Stored beside the mixer rather than inside the project, for the same reason:
 * the theme belongs to the room someone is sitting in, not to the piece, and
 * carrying it in an exported JSON would set it for whoever opened the file next.
 *
 * "system" is the default and is stored as the ABSENCE of the attribute, so the
 * `@media (prefers-color-scheme: dark)` block in styles.css governs. An explicit
 * choice writes data-theme onto the root element, where a rule with equal
 * specificity but later source order overrides the media block in both
 * directions -- including the case that is easy to miss, a machine set to dark
 * whose user wants this one app light.
 */

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "vsc.theme";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

export function readStoredTheme(): ThemeChoice {
  try {
    const raw = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(raw) ? raw : "system";
  } catch {
    // A theme that cannot be remembered still works for this session, which is
    // better than refusing to start.
    return "system";
  }
}

/**
 * Writes the choice to the document.
 *
 * Exported because index.html runs the same assignment inline before first
 * paint: without that, a user who chose dark gets a white flash on every load,
 * and the flash is worse than no toggle at all.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
}

export interface ThemeControl {
  theme: ThemeChoice;
  setTheme: (choice: ThemeChoice) => void;
  /**
   * What the MACHINE currently says, which is what the "follow the machine"
   * option has to report.
   *
   * Not what is on screen. Deriving it from the active choice made the option
   * label read "currently light" the moment the user picked light, on a machine
   * set to dark -- describing the thing they had just overridden rather than
   * the thing they would get back by choosing it.
   */
  systemResolved: "light" | "dark";
  /** What is actually on screen, choice and machine combined. */
  resolved: "light" | "dark";
}

export function useTheme(): ThemeControl {
  const [theme, setStored] = useState<ThemeChoice>(readStoredTheme);
  const [systemDark, setSystemDark] = useState(
    () => globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // The system preference can change while the app is open -- a scheduled
  // switch at sunset, or the OS setting being toggled in another window -- and
  // on "system" the label has to follow it.
  useEffect(() => {
    const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const listen = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", listen);
    return () => query.removeEventListener("change", listen);
  }, []);

  const setTheme = useCallback((choice: ThemeChoice) => {
    setStored(choice);
    try {
      globalThis.localStorage?.setItem(THEME_STORAGE_KEY, choice);
    } catch {
      // See readStoredTheme.
    }
  }, []);

  const systemResolved = systemDark ? "dark" : "light";
  return {
    theme,
    setTheme,
    systemResolved,
    resolved: theme === "system" ? systemResolved : theme,
  };
}
