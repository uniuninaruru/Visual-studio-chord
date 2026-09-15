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

/** Control the request and commit separately, as browsers do. */
function controlledIndexedDB() {
  const request = { result: "record", onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
  const transaction = {
    oncomplete: null as (() => void) | null,
    onabort: null as (() => void) | null,
    onerror: null as (() => void) | null,
    objectStore: () => ({ put: () => request, delete: () => request }),
  };
  const begin = vi.fn(() => transaction);
  const open = { result: { transaction: begin }, onsuccess: null as (() => void) | null };
  const factory = { open: () => {
    queueMicrotask(() => open.onsuccess?.());
    return open;
  } } as unknown as IDBFactory;
  return { factory, transaction, request, begin };
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

  it("waits for transaction commit after a successful request", async () => {
    const control = controlledIndexedDB();
    const database = new EditorDatabase({ indexedDBFactory: control.factory, localStorage: null });
    let settled = false;
    const pending = database.write("record", "fresh").then((mode) => { settled = true; return mode; });
    await vi.waitFor(() => expect(control.begin).toHaveBeenCalled());
    control.request.onsuccess?.();
    await Promise.resolve();
    expect(settled).toBe(false);
    control.transaction.oncomplete?.();
    expect(await pending).toBe("indexedDB");
  });

  it("falls back when commit aborts after request success", async () => {
    const control = controlledIndexedDB();
    const storage = fakeStorage();
    const database = new EditorDatabase({ indexedDBFactory: control.factory, localStorage: storage });
    const pending = database.write("record", "fresh");
    await vi.waitFor(() => expect(control.begin).toHaveBeenCalled());
    control.request.onsuccess?.();
    control.transaction.onabort?.();
    expect(await pending).toBe("localStorage");
    expect(storage.getItem("record")).toBe("fresh");
    expect(database.mode).toBe("localStorage");
  });

  it("reads the latest session-only value instead of an older durable copy", async () => {
    const storage = fakeStorage({ failOn: "record" });
    storage.map.set("record", "stale");
    const database = new EditorDatabase({ indexedDBFactory: null, localStorage: storage });
    expect(await database.write("record", "fresh")).toBe("memory");
    expect(await database.read("record")).toBe("fresh");
  });

  it("serializes deletion behind a pending save so the completed save cannot resurrect it", async () => {
    const control = controlledIndexedDB();
    const database = new EditorDatabase({ indexedDBFactory: control.factory, localStorage: null });
    const save = database.write("record", "fresh");
    const remove = database.remove("record");
    await vi.waitFor(() => expect(control.begin).toHaveBeenCalledTimes(1));
    control.transaction.oncomplete?.();
    expect(await save).toBe("indexedDB");
    await vi.waitFor(() => expect(control.begin).toHaveBeenCalledTimes(2));
    control.transaction.oncomplete?.();
    await remove;
    expect(await database.read("record")).toBeNull();
  });

  it("does not resurrect a removed record if durable deletion fails", async () => {
    const storage = fakeStorage();
    storage.map.set("record", "stale");
    storage.removeItem = () => { throw new Error("blocked"); };
    const database = new EditorDatabase({ indexedDBFactory: null, localStorage: storage });
    await database.remove("record");
    expect(await database.read("record")).toBeNull();
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
