import {
  clonePreferenceModel,
  createPreferenceModel,
  isPreferenceModel,
  type PreferenceModel,
} from "../preference";

export const PREFERENCE_DATABASE_NAME = "music-theory-composer-preferences";
export const PREFERENCE_OBJECT_STORE = "profiles";
export const PREFERENCE_PROFILE_KEY = "default";

export type PreferencePersistenceMode = "indexedDB" | "memory";

export interface PreferenceStorageOptions {
  /** Explicit null forces the in-memory fallback. */
  indexedDBFactory?: IDBFactory | null;
  databaseName?: string;
  objectStoreName?: string;
  profileKey?: string;
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
 * database transparently falls back to a session-local in-memory snapshot.
 */
export class PreferenceStorage {
  private readonly indexedDBFactory: IDBFactory | null;
  private readonly databaseName: string;
  private readonly objectStoreName: string;
  private readonly profileKey: string;
  private databasePromise: Promise<IDBDatabase> | null = null;
  private indexedDBDisabled = false;
  private memorySnapshot: PreferenceModel | null = null;
  private currentMode: PreferencePersistenceMode;

  constructor(options: PreferenceStorageOptions = {}) {
    this.indexedDBFactory = Object.hasOwn(options, "indexedDBFactory")
      ? options.indexedDBFactory ?? null
      : availableIndexedDB();
    this.databaseName = options.databaseName ?? PREFERENCE_DATABASE_NAME;
    this.objectStoreName = options.objectStoreName ?? PREFERENCE_OBJECT_STORE;
    this.profileKey = options.profileKey ?? PREFERENCE_PROFILE_KEY;
    this.currentMode = this.indexedDBFactory ? "indexedDB" : "memory";
  }

  get mode(): PreferencePersistenceMode {
    return this.currentMode;
  }

  private disableIndexedDB(): void {
    this.indexedDBDisabled = true;
    this.currentMode = "memory";
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
        if (isPreferenceModel(stored)) {
          this.memorySnapshot = clonePreferenceModel(stored);
          return clonePreferenceModel(stored);
        }
      } catch {
        this.disableIndexedDB();
      }
    }
    return this.memorySnapshot ? clonePreferenceModel(this.memorySnapshot) : null;
  }

  async save(model: PreferenceModel): Promise<PreferencePersistenceMode> {
    if (!isPreferenceModel(model)) throw new TypeError("Invalid preference model.");
    this.memorySnapshot = clonePreferenceModel(model);
    const databasePromise = this.openDatabase();
    if (databasePromise) {
      try {
        const database = await databasePromise;
        const transaction = database.transaction(this.objectStoreName, "readwrite");
        const complete = transactionComplete(transaction);
        await Promise.all([
          requestResult(transaction.objectStore(this.objectStoreName).put(
            clonePreferenceModel(model),
            this.profileKey,
          )),
          complete,
        ]);
        this.currentMode = "indexedDB";
        return this.currentMode;
      } catch {
        this.disableIndexedDB();
      }
    }
    return "memory";
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
    const databasePromise = this.openDatabase();
    if (databasePromise) {
      try {
        const database = await databasePromise;
        const transaction = database.transaction(this.objectStoreName, "readwrite");
        const complete = transactionComplete(transaction);
        await Promise.all([
          requestResult(transaction.objectStore(this.objectStoreName).delete(this.profileKey)),
          complete,
        ]);
        this.currentMode = "indexedDB";
        return this.currentMode;
      } catch {
        this.disableIndexedDB();
      }
    }
    return "memory";
  }
}

export function createPreferenceStorage(options: PreferenceStorageOptions = {}): PreferenceStorage {
  return new PreferenceStorage(options);
}
