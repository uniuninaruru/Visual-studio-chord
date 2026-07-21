export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type StoragePersistenceMode = "localStorage" | "memory";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const memoryStorage = new MemoryStorage();

export class ResilientStorage implements StorageLike {
  private primaryWritable: boolean;
  private readonly removedKeys = new Set<string>();
  private readonly fallbackKeys = new Set<string>();

  constructor(
    private readonly primary: StorageLike,
    private readonly fallback: StorageLike,
    primaryWritable = true,
  ) {
    this.primaryWritable = primaryWritable;
  }

  get mode(): StoragePersistenceMode {
    return this.primaryWritable && this.fallbackKeys.size === 0 && this.removedKeys.size === 0
      ? "localStorage"
      : "memory";
  }

  modeForKey(key: string): StoragePersistenceMode {
    return this.fallbackKeys.has(key) || this.removedKeys.has(key)
      ? "memory"
      : "localStorage";
  }

  getItem(key: string): string | null {
    const fallbackValue = this.fallback.getItem(key);
    if (fallbackValue !== null) {
      return fallbackValue;
    }
    if (this.removedKeys.has(key)) {
      return null;
    }
    try {
      return this.primary.getItem(key);
    } catch {
      return null;
    }
  }

  setItem(key: string, value: string): void {
    try {
      // Retry each key. A large history write can exceed quota while replacing
      // the much smaller current-project snapshot still succeeds.
      this.primary.setItem(key, value);
      this.fallback.removeItem(key);
      this.fallbackKeys.delete(key);
      this.removedKeys.delete(key);
      this.primaryWritable = true;
      return;
    } catch {
      // Quota and privacy errors affect writes, but existing values can still
      // be readable and removable. Keep those capabilities independent.
      this.primaryWritable = false;
    }
    this.fallback.setItem(key, value);
    this.fallbackKeys.add(key);
    this.removedKeys.delete(key);
  }

  removeItem(key: string): void {
    let removedFromPrimary = false;
    try {
      this.primary.removeItem(key);
      removedFromPrimary = true;
    } catch {
      // A per-key in-memory tombstone prevents an older primary value from
      // resurfacing during this session if deletion is denied.
    }
    this.fallback.removeItem(key);
    this.fallbackKeys.delete(key);
    if (removedFromPrimary) {
      this.removedKeys.delete(key);
    } else {
      this.removedKeys.add(key);
    }
  }
}

let safeStorage: StorageLike | undefined;

interface BrowserStorageAvailability {
  storage: StorageLike;
  writable: boolean;
}

function browserLocalStorage(): BrowserStorageAvailability | null {
  if (typeof window === "undefined") {
    return null;
  }

  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return null;
  }

  try {
    const probeKey = "__music_theory_composer_storage_probe__";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return { storage, writable: true };
  } catch {
    // A full quota can reject writes while previously saved projects remain
    // readable. Preserve that access and route new writes to memory.
    return { storage, writable: false };
  }
}

/**
 * Returns localStorage when it is usable and an in-memory implementation when
 * storage is unavailable (SSR, privacy mode, a full quota, or denied access).
 */
export function getSafeStorage(): StorageLike {
  if (!safeStorage) {
    const browserStorage = browserLocalStorage();
    safeStorage = browserStorage
      ? new ResilientStorage(
          browserStorage.storage,
          memoryStorage,
          browserStorage.writable,
        )
      : memoryStorage;
  }
  return safeStorage;
}

export function getSafeStorageMode(): StoragePersistenceMode {
  getSafeStorage();
  return safeStorage instanceof ResilientStorage ? safeStorage.mode : "memory";
}

export function getStoragePersistenceMode(
  storage: StorageLike = getSafeStorage(),
  key?: string,
): StoragePersistenceMode {
  if (storage instanceof ResilientStorage) {
    return key === undefined ? storage.mode : storage.modeForKey(key);
  }
  return storage === memoryStorage ? "memory" : "localStorage";
}

export function readJson<T>(
  key: string,
  validate: (value: unknown) => value is T,
  storage: StorageLike = getSafeStorage(),
): T | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeJson(
  key: string,
  value: unknown,
  storage: StorageLike = getSafeStorage(),
): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeStoredValue(
  key: string,
  storage: StorageLike = getSafeStorage(),
): boolean {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
