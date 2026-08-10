import { useCallback, useEffect, useRef } from "react";
import { CompositionTransport, type MixerSettings } from "../audio/transport";
import type { UserFacingDiagnosticError } from "../features/diagnostics";
import { useComposerStore } from "../state";
import type { GeneratedComposition } from "../types/music";
import type { TickRange } from "../state";

export interface PlaybackController {
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  /** Sound one chord outside the timeline, for auditioning a candidate. */
  auditionChord: (midis: readonly number[]) => void;
}

export interface PlaybackControllerOptions {
  /** The composition that is actually sounding, which trails the draft. */
  playbackComposition: GeneratedComposition;
  playbackLoopRange: TickRange;
  mutedTrackIds?: readonly string[];
  soloTrackId?: string | null;
  /** Where the listener put the faders. Absent leaves the transport's own. */
  mixer?: MixerSettings;
  /** Audio failures are reported as diagnostics, never as AI failures. */
  onAudioError: (error: UserFacingDiagnosticError | null) => void;
  onToast: (message: string) => void;
}

/**
 * Owns the Tone.js transport: its lifetime, the tick subscription, and
 * play/pause/stop.
 *
 * Starting audio can be refused by the browser or the OS, and that failure is
 * kept strictly separate from generation failures — the composition is never
 * affected by it.
 */
export function usePlaybackController(
  options: PlaybackControllerOptions,
): PlaybackController {
  const {
    playbackComposition,
    playbackLoopRange,
    mutedTrackIds = [],
    soloTrackId = null,
    mixer,
    onAudioError,
    onToast,
  } = options;
  const transportRef = useRef<CompositionTransport | null>(null);

  useEffect(() => {
    const transport = new CompositionTransport();
    transportRef.current = transport;
    return () => {
      transport.dispose();
      transportRef.current = null;
    };
  }, []);

  useEffect(() => {
    const transport = transportRef.current;
    if (!transport) return;
    const handleTick = (tick: number) => {
      // Read the store imperatively: the callback outlives this effect's
      // closure, and a stale composition here would schedule the wrong notes.
      const before = useComposerStore.getState().committedComposition;
      useComposerStore.getState().setCurrentTick(tick);
      const after = useComposerStore.getState();
      if (after.committedComposition !== before) {
        transport.configure(
          after.committedComposition,
          after.playbackLoopRange,
          handleTick,
        );
      }
    };
    transport.configure(playbackComposition, playbackLoopRange, handleTick);
  }, [playbackComposition, playbackLoopRange]);

  useEffect(() => {
    transportRef.current?.setTrackMix(mutedTrackIds, soloTrackId);
  }, [mutedTrackIds, soloTrackId]);

  // Pushed on every change, including before the first play: the transport
  // holds the values until it has synths to apply them to, so a volume set on a
  // silent app is not lost.
  useEffect(() => {
    if (mixer) transportRef.current?.setMixer(mixer);
  }, [mixer]);

  const play = useCallback(async () => {
    try {
      await transportRef.current?.play();
      useComposerStore.getState().setPlaybackStatus("playing");
      onAudioError(null);
    } catch {
      onAudioError({
        title: "音声再生を開始できませんでした",
        message: "ブラウザまたはOSがAudioContextの開始を拒否しました。曲データとAI処理は安全です。",
        remedy: "ページの音声許可と出力デバイスを確認し、Playをもう一度押してください。",
        canRetry: true,
        diagnosticCode: "AUDIO_CONTEXT_START_FAILED",
      });
      onToast("ブラウザの音声を開始できませんでした。ページの音声許可を確認してください。");
    }
  }, [onAudioError, onToast]);

  const pause = useCallback(() => {
    transportRef.current?.pause();
    useComposerStore.getState().setPlaybackStatus("paused");
  }, []);

  /**
   * Stops, and gives the piece back.
   *
   * Clicking a chord in the progression lane also selects its bar, and a bar
   * selection sets the playback loop -- so inspecting a chord quietly locked
   * playback to one bar and there was no way out of it. Stop returned the
   * playhead to the top of that one bar, so pressing it and playing again
   * replayed the same bar forever.
   *
   * Stop means back to the beginning of the piece, which is what the button
   * means everywhere else. The chord stays selected: the inspector is not what
   * was wrong.
   */
  const stop = useCallback(() => {
    transportRef.current?.stop();
    const store = useComposerStore.getState();
    store.setPlaybackStatus("stopped");
    store.playWholePiece();
  }, []);

  /**
   * Sound one chord without touching the timeline, so a reharmonization
   * candidate can be heard while the piece is stopped or playing.
   */
  const auditionChord = useCallback((midis: readonly number[]) => {
    void transportRef.current?.auditionChord(midis).catch(() => {
      onAudioError({
        title: "候補を試聴できませんでした",
        message: "ブラウザまたはOSがAudioContextの開始を拒否しました。曲データは変更されていません。",
        remedy: "ページの音声許可と出力デバイスを確認し、もう一度押してください。",
        canRetry: true,
        diagnosticCode: "AUDIO_CONTEXT_START_FAILED",
      });
    });
  }, [onAudioError]);

  return { play, pause, stop, auditionChord };
}
