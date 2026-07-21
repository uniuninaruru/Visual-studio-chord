export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

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

class ResilientStorage implements StorageLike {
  private primaryFailed = false;

  constructor(
    private readonly primary: StorageLike,
    private readonly fallback: StorageLike,
  ) {}

  getItem(key: string): string | null {
    if (!this.primaryFailed) {
      try {
        return this.primary.getItem(key);
      } catch {
        this.primaryFailed = true;
      }
    }
    return this.fallback.getItem(key);
  }

  setItem(key: string, value: string): void {
    if (!this.primaryFailed) {
      try {
        this.primary.setItem(key, value);
        return;
      } catch {
        this.primaryFailed = true;
      }
    }
    this.fallback.setItem(key, value);
  }

  removeItem(key: string): void {
    if (!this.primaryFailed) {
      try {
        this.primary.removeItem(key);
        return;
      } catch {
        this.primaryFailed = true;
      }
    }
    this.fallback.removeItem(key);
  }
}

let safeStorage: StorageLike | undefined;

function browserLocalStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storage = window.localStorage;
    const probeKey = "__music_theory_composer_storage_probe__";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
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
      ? new ResilientStorage(browserStorage, memoryStorage)
      : memoryStorage;
  }
  return safeStorage;
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
