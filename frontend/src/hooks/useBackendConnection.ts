import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureLocalAccessToken,
  detectLocalBackend,
  type BackendConnection,
} from "../api/inferenceClient";

/**
 * Delays before each startup probe. The first is immediate; the rest give a
 * backend that is still booting time to answer before the app settles into
 * browser-only mode.
 */
const BACKEND_STARTUP_RETRY_DELAYS_MS = [0, 500, 1_500, 3_000, 6_000] as const;

export interface BackendConnectionState {
  backend: BackendConnection;
  /** Exposed because inference failures downgrade the connection in place. */
  setBackend: React.Dispatch<React.SetStateAction<BackendConnection>>;
  online: boolean;
  /** True when the local server is reachable *and* authorised to infer. */
  backendCanInfer: boolean;
  refreshBackend: () => Promise<void>;
  /** Re-probes after a delay, used to recover from a dropped connection. */
  scheduleBackendRecovery: (delay?: number) => void;
}

/**
 * Owns the local inference server connection: the startup probe with backoff,
 * online/offline transitions, and recovery after a dropped connection.
 *
 * The app is fully usable without a backend, so every path here degrades to
 * browser-only rather than failing.
 */
export function useBackendConnection(): BackendConnectionState {
  const [backend, setBackend] = useState<BackendConnection>({ state: "checking" });
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const retryTimerRef = useRef<number | null>(null);

  // The access token arrives in the URL fragment and must be captured before
  // any request is made.
  useEffect(() => {
    captureLocalAccessToken();
  }, []);

  const refreshBackend = useCallback(async () => {
    setBackend({ state: "checking" });
    setBackend(await detectLocalBackend());
  }, []);

  const scheduleBackendRecovery = useCallback((delay = 1_500) => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
    }
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      void detectLocalBackend().then(setBackend);
    }, delay);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let startupTimer: number | null = null;
    const probe = async (attempt: number) => {
      const connection = await detectLocalBackend();
      if (cancelled) return;
      setBackend(connection);
      // Only an unreachable server is worth retrying: a server that answered
      // and declined is not going to change its mind.
      if (
        connection.state === "browser"
        && connection.reason === "unreachable"
        && attempt + 1 < BACKEND_STARTUP_RETRY_DELAYS_MS.length
      ) {
        startupTimer = window.setTimeout(
          () => void probe(attempt + 1),
          BACKEND_STARTUP_RETRY_DELAYS_MS[attempt + 1],
        );
      }
    };
    void probe(0);

    const handleOnline = () => {
      setOnline(true);
      scheduleBackendRecovery(0);
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      cancelled = true;
      if (startupTimer !== null) window.clearTimeout(startupTimer);
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [scheduleBackendRecovery]);

  return {
    backend,
    setBackend,
    online,
    backendCanInfer: backend.state === "connected" && backend.inferenceAuthorized,
    refreshBackend,
    scheduleBackendRecovery,
  };
}
