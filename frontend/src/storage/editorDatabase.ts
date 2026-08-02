import type { StorageLike } from "./safeStorage";

export const EDITOR_DATABASE_NAME = "music-theory-composer-editor";
export const EDITOR_OBJECT_STORE = "snapshots";

/**
 * Keys inside the object store. One record each, overwritten in place.
 *
 * Namespaced because the Web Storage fallback writes under the same key, and
 * an unqualified "history" there would sit in the same flat namespace as every
 * other key on the origin.
 */
export const EDITOR_CURRENT_RECORD = "music-theory-composer:editor:current:v2";
export const EDITOR_HISTORY_RECORD = "music-theory-composer:editor-history:v2";

/**
 * Written to localStorage once the localStorage-era data has been copied across.
 *
 * The old keys are deliberately not deleted. A browser that later loses its
 * IndexedDB — private-mode eviction, a storage clear that spares Web Storage,
 * an origin whose quota was reclaimed — would otherwise come back to an empty
 * editor, and the cost of leaving a stale copy behind is a few hundred
 * kilobytes.
 */
export const EDITOR_MIGRATION_FLAG_KEY = "music-theory-composer:editor:migrated-to-idb:v1";

export type EditorPersistenceMode = "indexedDB" | "localStorage" | "memory";

export interface EditorDatabaseOptions {
  /** Explicit null disables IndexedDB, which the tests use to force fallback. */
  indexedDBFactory?: IDBFactory | null;
  databaseName?: string;
  objectStoreName?: string;
  localStorage?: StorageLike | null;
}

function availableIndexedDB(): IDBFactory | null {
  return typeof globalThis.indexedDB === "undefined" ? null : globalThis.indexedDB;
}

/**
 * The raw Web Storage, deliberately not the shared ResilientStorage.
 *
 * That wrapper marks its whole instance unwritable after any failed write, so
 * routing the history through it would let a history quota failure report the
 * much smaller current-project snapshot as session-only too. The failure this
 * class exists to survive would then damage the thing it was protecting.
 */
function rawLocalStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Key-value persistence for the editor's project and history records.
 *
 * The editor's history is unbounded and every entry holds a whole composition,
 * so a long session in Web Storage is not a risk but a certainty: a 48-bar
 * arranged piece serializes to roughly 180KB, which reaches a 5MB quota in
 * under thirty edits. IndexedDB has no comparable ceiling.
 *
 * Falls back to localStorage and then to memory, in that order, so that a
 * browser without IndexedDB is degraded rather than broken.
 */
export class EditorDatabase {
  private readonly indexedDBFactory: IDBFactory | null;
  private readonly databaseName: string;
  private readonly objectStoreName: string;
  private readonly localStorage: StorageLike | null;
  private databasePromise: Promise<IDBDatabase> | null = null;
  private indexedDBDisabled = false;
  private readonly memory = new Map<string, string>();
  private currentMode: EditorPersistenceMode;

  constructor(options: EditorDatabaseOptions = {}) {
    this.indexedDBFactory = Object.hasOwn(options, "indexedDBFactory")
      ? options.indexedDBFactory ?? null
      : availableIndexedDB();
    this.databaseName = options.databaseName ?? EDITOR_DATABASE_NAME;
    this.objectStoreName = options.objectStoreName ?? EDITOR_OBJECT_STORE;
    this.localStorage = Object.hasOwn(options, "localStorage")
      ? options.localStorage ?? null
      : rawLocalStorage();
    this.currentMode = this.indexedDBFactory
      ? "indexedDB"
      : this.localStorage
        ? "localStorage"
        : "memory";
  }

  get mode(): EditorPersistenceMode {
    return this.currentMode;
  }

  private disableIndexedDB(): void {
    this.indexedDBDisabled = true;
    this.databasePromise = null;
    this.currentMode = this.localStorage ? "localStorage" : "memory";
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
      request.onerror = () =>
        reject(request.error ?? new Error("Could not open the editor database."));
      request.onblocked = () =>
        reject(new Error("The editor database upgrade was blocked."));
    }).catch((error: unknown) => {
      this.disableIndexedDB();
      throw error;
    });
    return this.databasePromise;
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | null> {
    const databasePromise = this.openDatabase();
    if (!databasePromise) return null;
    let database: IDBDatabase;
    try {
      database = await databasePromise;
    } catch {
      return null;
    }
    return new Promise<T | null>((resolve) => {
      let request: IDBRequest<T>;
      try {
        const transaction = database.transaction(this.objectStoreName, mode);
        request = work(transaction.objectStore(this.objectStoreName));
      } catch {
        this.disableIndexedDB();
        resolve(null);
        return;
      }
      request.onsuccess = () => {
        this.currentMode = "indexedDB";
        resolve(request.result);
      };
      request.onerror = () => {
        // A quota or transaction failure is exactly the case this migration
        // exists to escape, so it degrades instead of throwing at the caller.
        this.disableIndexedDB();
        resolve(null);
      };
    });
  }

  /** Reads a record, falling through the same ladder writes use. */
  async read(key: string): Promise<string | null> {
    const stored = await this.withStore<string | undefined>("readonly", (store) =>
      store.get(key) as IDBRequest<string | undefined>);
    if (typeof stored === "string") return stored;
    if (this.localStorage) {
      try {
        const value = this.localStorage.getItem(key);
        if (value !== null) return value;
      } catch {
        // Reading Web Storage can throw in a hardened browser profile.
      }
    }
    return this.memory.get(key) ?? null;
  }

  /**
   * Writes a record and reports where it actually landed.
   *
   * Memory is a real outcome, not a failure to hide: the caller shows the
   * session-only state in the status bar so nobody closes the tab believing
   * their work is saved.
   */
  async write(key: string, value: string): Promise<EditorPersistenceMode> {
    const written = await this.withStore("readwrite", (store) => store.put(value, key));
    if (written !== null || this.currentMode === "indexedDB") {
      this.memory.set(key, value);
      return "indexedDB";
    }
    if (this.localStorage) {
      try {
        this.localStorage.setItem(key, value);
        this.memory.set(key, value);
        this.currentMode = "localStorage";
        return "localStorage";
      } catch {
        // Quota exceeded, which is the condition that motivated all of this.
      }
    }
    this.memory.set(key, value);
    this.currentMode = "memory";
    return "memory";
  }

  async remove(key: string): Promise<void> {
    await this.withStore("readwrite", (store) => store.delete(key));
    this.memory.delete(key);
    try {
      this.localStorage?.removeItem(key);
    } catch {
      // Nothing useful to do; the record is gone from everywhere reachable.
    }
  }
}
