import { useCallback, useMemo, useState } from "react";
import {
  melodyPitchClassesOver,
  reharmonizeChord,
  type ReharmonizationCandidate,
} from "../music/reharmonization";
import { voiceChord } from "../music/chords";
import { pitchClassToSemitone } from "../music/scales";
import type { ChordEvent, GeneratedComposition } from "../types/music";

export interface ReharmonizationRequest {
  composition: GeneratedComposition;
  chord: ChordEvent | null;
  lockedBars: readonly number[];
}

export interface ReharmonizationState {
  /** Ranked substitutions for the selected chord, best first. */
  candidates: readonly ReharmonizationCandidate[];
  /** Why no candidate list is shown, when there is none. */
  unavailableReason: string | null;
  /** The candidate currently being auditioned, if any. */
  auditioningSymbol: string | null;
  audition: (candidate: ReharmonizationCandidate) => void;
  apply: (candidate: ReharmonizationCandidate) => void;
}

export interface ReharmonizationHandlers {
  /** Sounds a chord outside the timeline. */
  onAudition: (midis: readonly number[]) => void;
  /**
   * Applies the substitution. Returns false when the store refused it, which
   * the caller reports; this hook never mutates the composition itself.
   */
  onApply: (chordId: string, edit: Partial<ChordEvent> & { symbol: string }) => boolean;
  onToast: (message: string) => void;
}

/** How many substitutions to offer. More than this is a wall, not a choice. */
const CANDIDATE_LIMIT = 6;

/**
 * Voices a candidate for audition only.
 *
 * The stored chord is revoiced by the editor when the substitution is applied,
 * so this exists purely so the listener hears something in a sensible register
 * rather than a cluster of pitch classes.
 */
function auditionPitches(
  candidate: ReharmonizationCandidate,
  reference: ChordEvent,
): number[] {
  // Voice-led from the chord being replaced, so the candidate is heard in the
  // register it would occupy rather than jumping octaves between auditions.
  const { notes } = voiceChord(candidate.root, candidate.quality, reference.notes);
  if (candidate.bass === undefined) return notes;
  // A slash chord is only itself when the declared bass is what sounds lowest.
  const lowest = notes[0] ?? 60;
  const bassSemitone = pitchClassToSemitone(candidate.bass);
  let bassMidi = Math.floor(lowest / 12) * 12 + bassSemitone;
  if (bassMidi >= lowest) bassMidi -= 12;
  return [bassMidi, ...notes];
}

export function useReharmonization(
  request: ReharmonizationRequest,
  handlers: ReharmonizationHandlers,
): ReharmonizationState {
  const { composition, chord, lockedBars } = request;
  const { onAudition, onApply, onToast } = handlers;
  const [auditioningSymbol, setAuditioningSymbol] = useState<string | null>(null);

  const barIndex = chord
    ? Math.floor(chord.startTick / composition.ticksPerBar)
    : null;
  const locked = barIndex !== null && lockedBars.includes(barIndex);

  const candidates = useMemo(() => {
    if (!chord || locked) return [];
    const index = composition.chords.findIndex((entry) => entry.id === chord.id);
    const next = index >= 0 ? composition.chords[index + 1] : undefined;
    return reharmonizeChord({
      original: chord,
      melodyPitchClasses: melodyPitchClassesOver(composition.notes, chord),
      next,
      key: composition.settings.key,
      mode: composition.settings.mode,
      style: composition.settings.style,
      limit: CANDIDATE_LIMIT,
    });
  }, [chord, composition, locked]);

  const unavailableReason = useMemo(() => {
    if (!chord) return "コードを選ぶと、置き換え候補を表示します。";
    if (locked) return "この小節はロックされています。ロックを外すと候補を表示します。";
    if (candidates.length === 0) {
      // Not a failure: the melody over this chord may rule out every
      // substitution the engine knows, which is worth saying plainly.
      return "このコードに対して、旋律と両立する置き換え候補は見つかりませんでした。";
    }
    return null;
  }, [chord, locked, candidates]);

  const audition = useCallback((candidate: ReharmonizationCandidate) => {
    if (!chord) return;
    setAuditioningSymbol(candidate.symbol);
    onAudition(auditionPitches(candidate, chord));
  }, [chord, onAudition]);

  const apply = useCallback((candidate: ReharmonizationCandidate) => {
    if (!chord) return;
    if (locked) {
      onToast("ロックされた小節のコードは変更しません。");
      return;
    }
    // Passed as an object rather than a bare symbol: the symbol parser does not
    // accept slash notation, and the object form lets the bass travel as data.
    const edit: Partial<ChordEvent> & { symbol: string } = {
      symbol: candidate.symbol,
      source: "substitute",
    };
    if (candidate.bass !== undefined) {
      edit.bass = candidate.bass;
    }
    const applied = onApply(chord.id, edit);
    onToast(
      applied
        ? `${chord.symbol} を ${candidate.symbol} に置き換えました。Undoで戻せます。`
        : "コードを置き換えられませんでした。",
    );
    setAuditioningSymbol(null);
  }, [chord, locked, onApply, onToast]);

  return { candidates, unavailableReason, auditioningSymbol, audition, apply };
}
