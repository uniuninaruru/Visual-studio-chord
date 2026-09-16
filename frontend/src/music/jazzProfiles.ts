import type {
  GeneratorSettings,
  JazzSettings as SharedJazzSettings,
  JazzStyleId as SharedJazzStyleId,
} from "../types/music";

/** The five deliberately small, corpus-independent jazz identities. */
export type JazzStyleId = SharedJazzStyleId;
export type JazzFormId = "aaba" | "blues" | "modal" | "free";

/**
 * Jazz controls are kept separate from the legacy style preset.  The numbers
 * are authored engine priors, not measurements fitted to POP909 or another
 * corpus; keeping them here makes the policy easy to inspect and tune.
 */
export type JazzSettings = SharedJazzSettings;

export const DEFAULT_JAZZ_SETTINGS: Readonly<JazzSettings> = Object.freeze({
  version: 1,
  style: "swing",
  form: "aaba",
  chromaticism: 0.35,
  interaction: 0.6,
});

export interface JazzProfile {
  id: JazzStyleId;
  label: string;
  /** One chord slot per bar unless a form explicitly overrides it. */
  harmonicCycle: readonly string[];
  /** Relative number of lead attacks per bar. */
  melodyDensity: number;
  /** Relative amount of chord comping. */
  compingDensity: number;
  /** The engine's authored performance articulation. */
  articulation: "swing" | "legato" | "bebop" | "open" | "pocket";
}

export const JAZZ_PROFILES: Readonly<Record<JazzStyleId, JazzProfile>> = Object.freeze({
  swing: {
    id: "swing",
    label: "Swing",
    harmonicCycle: ["ii", "V", "I", "VI"],
    melodyDensity: 0.72,
    compingDensity: 0.56,
    articulation: "swing",
  },
  ballad: {
    id: "ballad",
    label: "Ballad",
    harmonicCycle: ["I", "vi", "ii", "V"],
    melodyDensity: 0.34,
    compingDensity: 0.25,
    articulation: "legato",
  },
  bebop: {
    id: "bebop",
    label: "Bebop",
    harmonicCycle: ["ii", "V", "I", "VI7"],
    melodyDensity: 0.88,
    compingDensity: 0.72,
    articulation: "bebop",
  },
  modern: {
    id: "modern",
    label: "Modern / modal",
    harmonicCycle: ["I", "bVII", "IV", "I"],
    melodyDensity: 0.48,
    compingDensity: 0.34,
    articulation: "open",
  },
  neoSoul: {
    id: "neoSoul",
    label: "Neo-soul jazz",
    harmonicCycle: ["I", "iii", "IV", "ii"],
    melodyDensity: 0.62,
    compingDensity: 0.68,
    articulation: "pocket",
  },
});

export function isJazzSettings(value: unknown): value is JazzSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<JazzSettings>;
  return candidate.version === 1
    && typeof candidate.style === "string"
    && Object.prototype.hasOwnProperty.call(JAZZ_PROFILES, candidate.style)
    && typeof candidate.form === "string"
    && ["aaba", "blues", "modal", "free"].includes(candidate.form)
    && typeof candidate.chromaticism === "number"
    && Number.isFinite(candidate.chromaticism)
    && candidate.chromaticism >= 0
    && candidate.chromaticism <= 1
    && typeof candidate.interaction === "number"
    && Number.isFinite(candidate.interaction)
    && candidate.interaction >= 0
    && candidate.interaction <= 1;
}

/** Reads the optional field without making the legacy settings type depend on jazz. */
export function jazzSettingsOf(
  settings: Pick<GeneratorSettings, "style"> & { jazz?: unknown },
): JazzSettings | undefined {
  return isJazzSettings(settings.jazz) ? settings.jazz : undefined;
}

export function cloneJazzSettings(value: JazzSettings): JazzSettings {
  return { ...value };
}

export function jazzProfileFor(value: JazzSettings): JazzProfile {
  return JAZZ_PROFILES[value.style];
}
