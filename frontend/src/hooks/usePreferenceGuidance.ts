import { useCallback, useState } from "react";

/**
 * How many pieces the generate button draws before the learned model picks one.
 *
 * Kept beside the mixer rather than inside the project, for the same reason:
 * this is a property of how someone works, not of the piece. Carrying it in an
 * exported JSON would set someone else's generate button to draw eight.
 *
 * One is off, and one is the default. Turning it on is a decision to hand the
 * choice to what the A/B panel learned, and it should not happen because
 * somebody pressed generate without reading anything.
 */

const STORAGE_KEY = "vsc.preferenceGuidance.v1";

/** Above this and a press of generate is a wait rather than a response. */
export const MAX_GUIDANCE_CANDIDATES = 16;
export const DEFAULT_GUIDANCE_CANDIDATES = 1;

export function clampGuidanceCandidates(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_GUIDANCE_CANDIDATES;
  }
  return Math.min(MAX_GUIDANCE_CANDIDATES, Math.max(1, Math.round(value)));
}

export function readStoredGuidanceCandidates(): number {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    // Absent is not corrupt: a first run has nothing stored and gets the
    // default rather than a warning.
    if (!raw) return DEFAULT_GUIDANCE_CANDIDATES;
    return clampGuidanceCandidates(JSON.parse(raw));
  } catch {
    return DEFAULT_GUIDANCE_CANDIDATES;
  }
}

export interface PreferenceGuidanceControl {
  /** Draws per press. One means the model is not consulted at all. */
  candidates: number;
  setCandidates: (value: number) => void;
}

export function usePreferenceGuidance(): PreferenceGuidanceControl {
  const [candidates, setStored] = useState<number>(readStoredGuidanceCandidates);

  const setCandidates = useCallback((value: number) => {
    const next = clampGuidanceCandidates(value);
    setStored(next);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // A setting that cannot be remembered is still a setting that works for
      // this session, which is better than refusing to change it.
    }
  }, []);

  return { candidates, setCandidates };
}
