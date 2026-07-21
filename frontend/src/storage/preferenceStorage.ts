import {
  clonePreferenceModel,
  createPreferenceModel,
  isPreferenceModel,
  type PreferenceModel,
} from "../preference";
import {
  getSafeStorage,
  getStoragePersistenceMode,
  readJson,
  removeStoredValue,
  type StorageLike,
  writeJson,
} from "./safeStorage";

export const PREFERENCE_DATABASE_NAME = "music-theory-composer-preferences";
export const PREFERENCE_OBJECT_STORE = "profiles";
export const PREFERENCE_PROFILE_KEY = "default";
export const PREFERENCE_LOCAL_STORAGE_KEY = "music-theory-composer:preferences:v1";
export const PREFERENCE_FALLBACK_STATE_KEY = "music-theory-composer:preferences:fallback:v1";

export type PreferencePersistenceMode = "indexedDB" | "localStorage" | "memory";

export interface PreferenceStorageOptions {
  /** Explicit null forces the in-memory fallback. */
  indexedDBFactory?: IDBFactory | null;
  databaseName?: string;
  objectStoreName?: string;
  profileKey?: string;
  /** Explicit null disables the localStorage fallback. */
  localStorage?: StorageLike | null;
}

interface PreferenceStorageEnvelope {
  storageVersion: 1;
  revision: number;
  state: "model" | "deleted";
  model?: PreferenceModel;
}

interface PreferenceStorageCandidate {
  envelope: PreferenceStorageEnvelope;
  source: PreferencePersistenceMode;
}

let preferenceRevisionClock = 0;

function isPreferenceStorageEnvelope(value: unknown): value is PreferenceStorageEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    record.storageVersion !== 1
    || !Number.isSafeInteger(record.revision)
    || (record.revision as number) < 0
    || (record.state !== "model" && record.state !== "deleted")
  ) {
    return false;
  }
  return record.state === "deleted"
    ? record.model === undefined
    : isPreferenceModel(record.model);
}

function envelopeForLegacyModel(model: PreferenceModel): PreferenceStorageEnvelope {
  return {
    storageVersion: 1,
    revision: 0,
    state: "model",
    model: clonePreferenceModel(model),
  };
}

function cloneEnvelope(envelope: PreferenceStorageEnvelope): PreferenceStorageEnvelope {
  return envelope.state === "deleted"
    ? { storageVersion: 1, revision: envelope.revision, state: "deleted" }
    : {
        storageVersion: 1,
        revision: envelope.revision,
        state: "model",
        model: clonePreferenceModel(envelope.model!),
      };
}

function nextPreferenceRevision(currentRevision: number): number {
  const timestampRevision = Date.now() * 1_000;
  preferenceRevisionClock = Math.max(
    preferenceRevisionClock + 1,
    currentRevision + 1,
    timestampRevision,
  );
  return preferenceRevisionClock;
}

function availableIndexedDB(): IDBFactory | null {
  try {
    return typeof globalThis.indexedDB === "undefined" ? null : globalThis.indexedDB;
  } catch {
    return null;
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function sortedJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, sortedJsonValue(entry)]),
  );
}

export function serializePreferenceModel(model: PreferenceModel, pretty = true): string {
  if (!isPreferenceModel(model)) throw new TypeError("Invalid preference model.");
  return JSON.stringify(sortedJsonValue(model), null, pretty ? 2 : undefined);
}

export function parsePreferenceModelJson(json: string): PreferenceModel {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new TypeError("Preference JSON is malformed.");
  }
  if (!isPreferenceModel(parsed)) {
    throw new TypeError("Preference JSON has an unsupported or invalid schema.");
  }
  return clonePreferenceModel(parsed);
}

/**
 * IndexedDB-backed preference profile storage. Any unavailable/failed browser
 * database falls back to localStorage and then to a session-local snapshot.
 * Revisioned envelopes and deletion tombstones prevent an older database value
 * from resurfacing after a fallback write or reset.
 */
export class PreferenceStorage {
  private readonly indexedDBFactory: IDBFactory | null;
  private readonly databaseName: string;
  private readonly objectStoreName: string;
  private readonly profileKey: string;
  private databasePromise: Promise<IDBDatabase> | null = null;
  private indexedDBDisabled = false;
  private memorySnapshot: PreferenceModel | null = null;
  private memoryEnvelope: PreferenceStorageEnvelope | null = null;
  private currentRevision = 0;
  private currentMode: PreferencePersistenceMode;
  private readonly localStorage: StorageLike | null;
  private readonly usesDefaultLocalStorage: boolean;

  constructor(options: PreferenceStorageOptions = {}) {
    this.indexedDBFactory = Object.hasOwn(options, "indexedDBFactory")
      ? options.indexedDBFactory ?? null
      : availableIndexedDB();
    this.databaseName = options.databaseName ?? PREFERENCE_DATABASE_NAME;
    this.objectStoreName = options.objectStoreName ?? PREFERENCE_OBJECT_STORE;
    this.profileKey = options.profileKey ?? PREFERENCE_PROFILE_KEY;
    this.usesDefaultLocalStorage = !Object.hasOwn(options, "localStorage");
    this.localStorage = this.usesDefaultLocalStorage
      ? getSafeStorage()
      : options.localStorage ?? null;
    this.currentMode = this.indexedDBFactory
      ? "indexedDB"
      : this.localStorageMode();
  }

  get mode(): PreferencePersistenceMode {
    return this.currentMode;
  }

  private disableIndexedDB(): void {
    this.indexedDBDisabled = true;
    this.currentMode = this.localStorageMode();
  }

  private localStorageMode(): PreferencePersistenceMode {
    if (!this.localStorage) return "memory";
    return this.usesDefaultLocalStorage
      && getStoragePersistenceMode(this.localStorage, PREFERENCE_FALLBACK_STATE_KEY) === "memory"
      ? "memory"
      : "localStorage";
  }

  private loadLocalEnvelope(): PreferenceStorageEnvelope | null {
    if (!this.localStorage) return null;
    const envelope = readJson(
      PREFERENCE_FALLBACK_STATE_KEY,
      isPreferenceStorageEnvelope,
      this.localStorage,
    );
    if (envelope) return cloneEnvelope(envelope);

    const legacy = readJson(
      PREFERENCE_LOCAL_STORAGE_KEY,
      isPreferenceModel,
      this.localStorage,
    );
    return legacy ? envelopeForLegacyModel(legacy) : null;
  }

  private saveLocalEnvelope(envelope: PreferenceStorageEnvelope): boolean {
    if (!this.localStorage) return false;
    const saved = writeJson(
      PREFERENCE_FALLBACK_STATE_KEY,
      cloneEnvelope(envelope),
      this.localStorage,
    );
    if (saved) {
      removeStoredValue(PREFERENCE_LOCAL_STORAGE_KEY, this.localStorage);
    }
    return saved;
  }

  private openDatabase(): Promise<IDBDatabase> | null {
    if (!this.indexedDBFactory || this.indexedDBDisabled) return null;
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = this.indexedDBFactory!.open(this.databaseName, 1);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.objectStoreName)) {
          database.createObjectStore(this.objectStoreName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open preference database."));
      request.onblocked = () => reject(new Error("Preference database upgrade was blocked."));
    }).catch((error: unknown) => {
      this.disableIndexedDB();
      throw error;
    });
    return this.databasePromise;
  }

  async load(): Promise<PreferenceModel | null> {
    const candidates: PreferenceStorageCandidate[] = [];
    const localEnvelope = this.loadLocalEnvelope();
    if (localEnvelope) {
      candidates.push({ envelope: localEnvelope, source: this.localStorageMode() });
    }

    const databasePromise = this.openDatabase();
    if (databasePromise) {
      try {
        const database = await databasePromise;
        const transaction = database.transaction(this.objectStoreName, "readonly");
        const complete = transactionComplete(transaction);
        const [stored] = await Promise.all([
          requestResult(transaction.objectStore(this.objectStoreName).get(this.profileKey)),
          complete,
        ]);
        if (isPreferenceStorageEnvelope(stored)) {
          candidates.push({ envelope: cloneEnvelope(stored), source: "indexedDB" });
        } else if (isPreferenceModel(stored)) {
          candidates.push({ envelope: envelopeForLegacyModel(stored), source: "indexedDB" });
        }
      } catch {
        this.disableIndexedDB();
      }
    }

    if (this.memoryEnvelope) {
      candidates.push({ envelope: cloneEnvelope(this.memoryEnvelope), source: "memory" });
    }
    if (candidates.length === 0) {
      return this.memorySnapshot ? clonePreferenceModel(this.memorySnapshot) : null;
    }

    const sourcePriority: Record<PreferencePersistenceMode, number> = {
      memory: 0,
      localStorage: 1,
      indexedDB: 2,
    };
    const newest = candidates.reduce((current, candidate) => {
      if (candidate.envelope.revision !== current.envelope.revision) {
        return candidate.envelope.revision > current.envelope.revision ? candidate : current;
      }
      return sourcePriority[candidate.source] > sourcePriority[current.source]
        ? candidate
        : current;
    });
    this.currentRevision = Math.max(this.currentRevision, newest.envelope.revision);
    this.currentMode = newest.source;
    this.memoryEnvelope = cloneEnvelope(newest.envelope);
    if (newest.envelope.state === "deleted") {
      this.memorySnapshot = null;
      return null;
    }
    this.memorySnapshot = clonePreferenceModel(newest.envelope.model!);
    return clonePreferenceModel(newest.envelope.model!);
  }

  async save(model: PreferenceModel): Promise<PreferencePersistenceMode> {
    if (!isPreferenceModel(model)) throw new TypeError("Invalid preference model.");
    this.memorySnapshot = clonePreferenceModel(model);
    const envelope: PreferenceStorageEnvelope = {
      storageVersion: 1,
      revision: nextPreferenceRevision(this.currentRevision),
      state: "model",
      model: clonePreferenceModel(model),
    };
    this.currentRevision = envelope.revision;
    this.memoryEnvelope = cloneEnvelope(envelope);
    let indexedDBSaved = false;
    const databasePromise = this.openDatabase();
    if (databasePromise) {
      try {
        const database = await databasePromise;
        const transaction = database.transaction(this.objectStoreName, "readwrite");
        const complete = transactionComplete(transaction);
        await Promise.all([
          requestResult(transaction.objectStore(this.objectStoreName).put(
            cloneEnvelope(envelope),
            this.profileKey,
          )),
          complete,
        ]);
        indexedDBSaved = true;
      } catch {
        this.disableIndexedDB();
      }
    }
    const localSaved = this.saveLocalEnvelope(envelope);
    this.currentMode = indexedDBSaved
      ? "indexedDB"
      : localSaved
        ? this.localStorageMode()
        : "memory";
    return this.currentMode;
  }

  async exportJson(pretty = true): Promise<string> {
    const model = await this.load() ?? createPreferenceModel();
    return serializePreferenceModel(model, pretty);
  }

  async importJson(json: string): Promise<PreferenceModel> {
    const model = parsePreferenceModelJson(json);
    await this.save(model);
    return clonePreferenceModel(model);
  }

  async reset(): Promise<PreferencePersistenceMode> {
    this.memorySnapshot = null;
    const envelope: PreferenceStorageEnvelope = {
      storageVersion: 1,
      revision: nextPreferenceRevision(this.currentRevision),
      state: "deleted",
    };
    this.currentRevision = envelope.revision;
    this.memoryEnvelope = cloneEnvelope(envelope);
    let indexedDBSaved = false;
    const databasePromise = this.openDatabase();
    if (databasePromise) {
      try {
        const database = await databasePromise;
        const transaction = database.transaction(this.objectStoreName, "readwrite");
        const complete = transactionComplete(transaction);
        await Promise.all([
          requestResult(transaction.objectStore(this.objectStoreName).put(
            cloneEnvelope(envelope),
            this.profileKey,
          )),
          complete,
        ]);
        indexedDBSaved = true;
      } catch {
        this.disableIndexedDB();
      }
    }
    const localSaved = this.saveLocalEnvelope(envelope);
    this.currentMode = indexedDBSaved
      ? "indexedDB"
      : localSaved
        ? this.localStorageMode()
        : "memory";
    return this.currentMode;
  }
}

export function createPreferenceStorage(options: PreferenceStorageOptions = {}): PreferenceStorage {
  return new PreferenceStorage(options);
}
