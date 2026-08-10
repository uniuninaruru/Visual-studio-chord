import { useCallback, useState } from "react";
import { DEFAULT_MIXER, type MixerSettings } from "../audio/transport";

/**
 * Where the faders were left, across reloads.
 *
 * Separate from the project: the volume someone listens at is a property of
 * their room and their headphones, not of the piece, and carrying it inside an
 * exported JSON would set it for whoever opened the file next.
 *
 * Stored leniently. A missing or corrupt entry falls back to the defaults
 * rather than throwing, because a mixer that cannot be read is not a reason to
 * refuse to start the app.
 */

const STORAGE_KEY = "vsc.mixer.v1";

function clamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

export function readStoredMixer(): MixerSettings {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MIXER };
    const parsed = JSON.parse(raw) as Partial<Record<keyof MixerSettings, unknown>>;
    return {
      master: clamp(parsed.master, DEFAULT_MIXER.master),
      chords: clamp(parsed.chords, DEFAULT_MIXER.chords),
      melody: clamp(parsed.melody, DEFAULT_MIXER.melody),
      bass: clamp(parsed.bass, DEFAULT_MIXER.bass),
      reverb: clamp(parsed.reverb, DEFAULT_MIXER.reverb),
    };
  } catch {
    return { ...DEFAULT_MIXER };
  }
}

export interface MixerControl {
  mixer: MixerSettings;
  setMixer: (patch: Partial<MixerSettings>) => void;
}

export function useMixerSettings(): MixerControl {
  const [mixer, setState] = useState<MixerSettings>(readStoredMixer);

  const setMixer = useCallback((patch: Partial<MixerSettings>) => {
    setState((current) => {
      const next: MixerSettings = {
        master: clamp(patch.master ?? current.master, current.master),
        chords: clamp(patch.chords ?? current.chords, current.chords),
        melody: clamp(patch.melody ?? current.melody, current.melody),
        bass: clamp(patch.bass ?? current.bass, current.bass),
        reverb: clamp(patch.reverb ?? current.reverb, current.reverb),
      };
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // A full or blocked storage must not stop the fader from moving; the
        // setting simply does not survive the reload.
      }
      return next;
    });
  }, []);

  return { mixer, setMixer };
}
