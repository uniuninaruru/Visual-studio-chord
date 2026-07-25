/**
 * Estimating how much room localStorage has left.
 *
 * There is no standard API that reports the localStorage quota, so this is
 * deliberately an *estimate* and says so in its result. Two facts make a useful
 * approximation possible:
 *
 *  - Used bytes can be measured exactly, by walking the store.
 *  - Browsers that implement localStorage settle on a ~5 MB per-origin budget.
 *
 * `navigator.storage.estimate()` is not used for the denominator: it reports the
 * combined budget for IndexedDB, Cache Storage and the rest, which is typically
 * orders of magnitude larger than the localStorage cap and would make a nearly
 * full store look empty.
 */

/** The per-origin localStorage budget browsers converge on, in bytes. */
export const ASSUMED_LOCAL_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024;

export type StorageCapacityConfidence = "measured" | "unavailable";

export interface StorageCapacityEstimate {
  /** Bytes currently held by this origin's localStorage. */
  usedBytes: number;
  /** Assumed total budget. Not reported by any browser API. */
  quotaBytes: number;
  /** Bytes left before writes are expected to start failing. */
  remainingBytes: number;
  /** 0..1 fraction of the budget in use. */
  usedRatio: number;
  /**
   * `measured` when the store could be walked; `unavailable` when localStorage
   * is absent or blocked, in which case the byte counts are zero and should not
   * be shown as if they were real.
   */
  confidence: StorageCapacityConfidence;
}

const UNAVAILABLE: StorageCapacityEstimate = {
  usedBytes: 0,
  quotaBytes: ASSUMED_LOCAL_STORAGE_QUOTA_BYTES,
  remainingBytes: ASSUMED_LOCAL_STORAGE_QUOTA_BYTES,
  usedRatio: 0,
  confidence: "unavailable",
};

/**
 * UTF-16 code units are what browsers count against the localStorage quota, and
 * each costs two bytes. Keys count as well as values.
 */
function entryBytes(key: string, value: string): number {
  return (key.length + value.length) * 2;
}

/** Measures localStorage usage, or reports it as unavailable. */
export function estimateStorageCapacity(): StorageCapacityEstimate {
  if (typeof window === "undefined") return UNAVAILABLE;

  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    // Privacy mode and blocked third-party contexts throw on access.
    return UNAVAILABLE;
  }

  let usedBytes = 0;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key === null) continue;
      usedBytes += entryBytes(key, storage.getItem(key) ?? "");
    }
  } catch {
    return UNAVAILABLE;
  }

  const quotaBytes = ASSUMED_LOCAL_STORAGE_QUOTA_BYTES;
  // A store can exceed the assumed budget when the browser is more generous
  // than 5 MB, so clamp rather than report a negative remainder.
  const remainingBytes = Math.max(0, quotaBytes - usedBytes);
  return {
    usedBytes,
    quotaBytes,
    remainingBytes,
    usedRatio: Math.min(1, usedBytes / quotaBytes),
    confidence: "measured",
  };
}

/** Formats a byte count for display, e.g. "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export type StorageCapacityLevel = "ok" | "warning" | "critical";

/**
 * How alarmed to be about the current usage.
 *
 * The thresholds sit well below full because a single history write can be
 * hundreds of kilobytes: by the time the store is genuinely full the user has
 * already lost the ability to save.
 */
export function storageCapacityLevel(
  estimate: StorageCapacityEstimate,
): StorageCapacityLevel {
  if (estimate.confidence !== "measured") return "ok";
  if (estimate.usedRatio >= 0.9) return "critical";
  if (estimate.usedRatio >= 0.75) return "warning";
  return "ok";
}
