import { useEffect, useState } from "react";
import {
  estimateStorageCapacity,
  type StorageCapacityEstimate,
} from "../storage";

/**
 * Tracks how much localStorage headroom is left.
 *
 * Measuring walks every entry in the store, so this samples on an interval and
 * on save-relevant changes rather than on every render. `revision` lets the
 * caller force a fresh reading right after a write, when the number is most
 * likely to have moved and most likely to be looked at.
 */
export function useStorageCapacity(
  revision: unknown,
  intervalMs = 30_000,
): StorageCapacityEstimate | null {
  const [estimate, setEstimate] = useState<StorageCapacityEstimate | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sample = () => {
      if (cancelled) return;
      setEstimate(estimateStorageCapacity());
    };
    sample();
    const timer = window.setInterval(sample, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [revision, intervalMs]);

  return estimate;
}
