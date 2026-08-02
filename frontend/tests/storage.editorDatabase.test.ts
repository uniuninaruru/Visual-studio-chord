import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EDITOR_HISTORY_RECORD,
  EDITOR_MIGRATION_FLAG_KEY,
  EditorDatabase,
} from "../src/storage/editorDatabase";
import { migrateEditorHistoryToDatabase as migrate } from "../src/storage/editorMigration";
import { EDITOR_HISTORY_STORAGE_KEY } from "../src/storage/editorPersistence";
import type { StorageLike } from "../src/storage/safeStorage";

/** A Web Storage stand-in whose failures can be aimed at one key. */
function fakeStorage(options: { failOn?: string } = {}): StorageLike & {
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      if (options.failOn === key) throw new Error("quota exceeded");
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe("editor history database", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to Web Storage when IndexedDB is absent, and reports it", async () => {
    const storage = fakeStorage();
    const database = new EditorDatabase({ indexedDBFactory: null, localStorage: storage });

    const mode = await database.write(EDITOR_HISTORY_RECORD, "{\"a\":1}");

    expect(mode).toBe("localStorage");
    expect(await database.read(EDITOR_HISTORY_RECORD)).toBe("{\"a\":1}");
  });

  it("reports memory rather than pretending, when nothing durable accepts it", async () => {
    // The status bar shows this as session-only. Reporting a durable write here
    // would let someone close the tab believing the work was saved.
    const database = new EditorDatabase({
      indexedDBFactory: null,
      localStorage: fakeStorage({ failOn: EDITOR_HISTORY_RECORD }),
    });

    const mode = await database.write(EDITOR_HISTORY_RECORD, "{\"a\":1}");

    expect(mode).toBe("memory");
    // Still readable for this session, which is what "memory" means.
    expect(await database.read(EDITOR_HISTORY_RECORD)).toBe("{\"a\":1}");
  });

  it("does not use the shared storage wrapper", async () => {
    // ResilientStorage marks its whole instance unwritable after any failure,
    // so sharing it would let a history quota failure report the much smaller
    // current-project snapshot as session-only too.
    const { getSafeStorage } = await import("../src/storage/safeStorage");
    const shared = getSafeStorage();
    const before = shared.getItem(EDITOR_HISTORY_RECORD);

    const database = new EditorDatabase({ indexedDBFactory: null });
    await database.write(EDITOR_HISTORY_RECORD, "{\"probe\":true}");

    // Written through the raw storage, so the shared wrapper never saw it fail.
    expect(before).toBeNull();
    expect(localStorage.getItem(EDITOR_HISTORY_RECORD)).toBe("{\"probe\":true}");
  });
});

describe("history migration from Web Storage", () => {
  it("copies an existing sidecar across and records that it did", async () => {
    const storage = fakeStorage();
    storage.map.set(EDITOR_HISTORY_STORAGE_KEY, "{\"version\":1,\"history\":[]}");
    const database = new EditorDatabase({ indexedDBFactory: null, localStorage: fakeStorage() });

    const result = await migrate(database, storage);

    expect(result.migrated).toBe(true);
    expect(await database.read(EDITOR_HISTORY_RECORD)).toBe("{\"version\":1,\"history\":[]}");
    expect(storage.getItem(EDITOR_MIGRATION_FLAG_KEY)).toBe("1");
  });

  it("leaves the original in place, so an evicted database is not a wipe", async () => {
    const storage = fakeStorage();
    storage.map.set(EDITOR_HISTORY_STORAGE_KEY, "{\"version\":1}");
    const database = new EditorDatabase({ indexedDBFactory: null, localStorage: fakeStorage() });

    await migrate(database, storage);

    expect(storage.getItem(EDITOR_HISTORY_STORAGE_KEY)).toBe("{\"version\":1}");
  });

  it("runs once, and does not re-copy over newer data on the next start", async () => {
    const storage = fakeStorage();
    storage.map.set(EDITOR_HISTORY_STORAGE_KEY, "{\"stale\":true}");
    const target = fakeStorage();
    const database = new EditorDatabase({ indexedDBFactory: null, localStorage: target });

    await migrate(database, storage);
    // Simulates edits made after the migration.
    await database.write(EDITOR_HISTORY_RECORD, "{\"fresh\":true}");
    const second = await migrate(database, storage);

    expect(second.migrated).toBe(false);
    expect(await database.read(EDITOR_HISTORY_RECORD)).toBe("{\"fresh\":true}");
  });

  it("retries on a later start when the destination could not hold it", async () => {
    // Not marking the flag is the whole point: a failed move must not be
    // recorded as done, or the data is stranded in Web Storage forever.
    const storage = fakeStorage();
    storage.map.set(EDITOR_HISTORY_STORAGE_KEY, "{\"version\":1}");
    const database = new EditorDatabase({
      indexedDBFactory: null,
      localStorage: fakeStorage({ failOn: EDITOR_HISTORY_RECORD }),
    });

    const result = await migrate(database, storage);

    expect(result.migrated).toBe(false);
    expect(result.failureReason).toBe("write-failed");
    expect(storage.getItem(EDITOR_MIGRATION_FLAG_KEY)).toBeNull();
    expect(storage.getItem(EDITOR_HISTORY_STORAGE_KEY)).toBe("{\"version\":1}");
  });

  it("marks nothing-to-migrate as done, so later starts stop looking", async () => {
    const storage = fakeStorage();
    const database = new EditorDatabase({ indexedDBFactory: null, localStorage: fakeStorage() });

    const result = await migrate(database, storage);

    expect(result.migrated).toBe(false);
    expect(result.failureReason).toBeNull();
    expect(storage.getItem(EDITOR_MIGRATION_FLAG_KEY)).toBe("1");
  });

  it("survives a storage that throws on read", async () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const database = new EditorDatabase({ indexedDBFactory: null, localStorage: fakeStorage() });

    const result = await migrate(database, throwing);

    expect(result.failureReason).toBe("read-failed");
  });
});
