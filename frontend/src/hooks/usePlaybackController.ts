import { useCallback, useEffect, useRef } from "react";
import { CompositionTransport } from "../audio/transport";
import type { UserFacingDiagnosticError } from "../features/diagnostics";
import { useComposerStore } from "../state";
import type { GeneratedComposition } from "../types/music";
import type { TickRange } from "../state";

export interface PlaybackController {
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
}

export interface PlaybackControllerOptions {
  /** The composition that is actually sounding, which trails the draft. */
  playbackComposition: GeneratedComposition;
  playbackLoopRange: TickRange;
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
  const { playbackComposition, playbackLoopRange, onAudioError, onToast } = options;
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

  const stop = useCallback(() => {
    transportRef.current?.stop();
    useComposerStore.getState().setPlaybackStatus("stopped");
  }, []);

  return { play, pause, stop };
}
