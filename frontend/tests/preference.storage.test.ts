import { describe, expect, it } from "vitest";
import {
  createPreferenceModel,
  isPreferenceModel,
  type PreferenceModel,
} from "../src/preference";
import {
  PreferenceStorage,
  parsePreferenceModelJson,
  serializePreferenceModel,
} from "../src/storage";

class ThrowingIDBFactory {
  open(): IDBOpenDBRequest {
    throw new Error("IndexedDB denied");
  }
}

class FakeLocalStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

interface FakeTransactionState {
  oncomplete: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onabort: ((event: Event) => void) | null;
  error: DOMException | null;
}

class FakeIDBFactory {
  private readonly values = new Map<IDBValidKey, unknown>();
  private upgraded = false;
  failWrites = false;

  open(): IDBOpenDBRequest {
    const database = {
      objectStoreNames: { contains: () => this.upgraded },
      createObjectStore: () => {
        this.upgraded = true;
        return {} as IDBObjectStore;
      },
      transaction: () => this.createTransaction(),
    } as unknown as IDBDatabase;
    const state = {
      result: database,
      error: null as DOMException | null,
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onblocked: null as ((event: Event) => void) | null,
      onupgradeneeded: null as ((event: Event) => void) | null,
    };
    queueMicrotask(() => {
      if (!this.upgraded) state.onupgradeneeded?.(new Event("upgradeneeded"));
      state.onsuccess?.(new Event("success"));
    });
    return state as unknown as IDBOpenDBRequest;
  }

  private createTransaction(): IDBTransaction {
    const transactionState: FakeTransactionState = {
      oncomplete: null,
      onerror: null,
      onabort: null,
      error: null,
    };
    const store = {
      get: (key: IDBValidKey) => this.createRequest(
        () => this.values.get(key),
        transactionState,
      ),
      put: (value: unknown, key: IDBValidKey) => this.createRequest(() => {
        if (this.failWrites) throw new Error("IndexedDB write failed");
        this.values.set(key, value);
        return key;
      }, transactionState),
      delete: (key: IDBValidKey) => this.createRequest(() => {
        this.values.delete(key);
        return undefined;
      }, transactionState),
    } as unknown as IDBObjectStore;
    const transaction = {
      ...transactionState,
      objectStore: () => store,
    } as unknown as IDBTransaction;
    Object.defineProperties(transaction, {
      oncomplete: {
        get: () => transactionState.oncomplete,
        set: (handler) => { transactionState.oncomplete = handler as (event: Event) => void; },
      },
      onerror: {
        get: () => transactionState.onerror,
        set: (handler) => { transactionState.onerror = handler as (event: Event) => void; },
      },
      onabort: {
        get: () => transactionState.onabort,
        set: (handler) => { transactionState.onabort = handler as (event: Event) => void; },
      },
    });
    return transaction;
  }

  private createRequest<T>(
    action: () => T,
    transaction: FakeTransactionState,
  ): IDBRequest<T> {
    const state = {
      result: undefined as T,
      error: null as DOMException | null,
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
    };
    queueMicrotask(() => {
      try {
        state.result = action();
        state.onsuccess?.(new Event("success"));
        queueMicrotask(() => transaction.oncomplete?.(new Event("complete")));
      } catch {
        state.error = new DOMException("Request failed", "UnknownError");
        state.onerror?.(new Event("error"));
        queueMicrotask(() => transaction.onerror?.(new Event("error")));
      }
    });
    return state as unknown as IDBRequest<T>;
  }
}

function learnedModel(): PreferenceModel {
  const model = createPreferenceModel();
  model.categories.harmony.weights["quality.tension"] = 0.25;
  model.categories.harmony.feedbackCount = 2;
  model.categories.harmony.effectiveEvidence = 2;
  model.categories.harmony.confidence = 0.329679953964;
  model.categories.harmony.evidence["quality.tension"] = {
    observations: 2,
    positiveWeight: 1.5,
    negativeWeight: 0.5,
    netSignal: 1,
  };
  return model;
}

describe("preference persistence", () => {
  it("saves defensive copies with the memory fallback", async () => {
    const storage = new PreferenceStorage({ indexedDBFactory: null, localStorage: null });
    const source = learnedModel();
    expect(await storage.save(source)).toBe("memory");
    source.categories.harmony.weights["quality.tension"] = 3;
    const loaded = await storage.load();
    expect(loaded?.categories.harmony.weights["quality.tension"]).toBe(0.25);
    loaded!.categories.harmony.weights["quality.tension"] = -2;
    expect((await storage.load())?.categories.harmony.weights["quality.tension"]).toBe(0.25);
  });

  it("falls back to memory when opening IndexedDB fails", async () => {
    const storage = new PreferenceStorage({
      indexedDBFactory: new ThrowingIDBFactory() as unknown as IDBFactory,
      localStorage: null,
    });
    expect(storage.mode).toBe("indexedDB");
    expect(await storage.save(learnedModel())).toBe("memory");
    expect(storage.mode).toBe("memory");
    expect(await storage.load()).toEqual(learnedModel());
  });

  it("persists, loads, and deletes through IndexedDB when available", async () => {
    const factory = new FakeIDBFactory() as unknown as IDBFactory;
    const first = new PreferenceStorage({ indexedDBFactory: factory, localStorage: null });
    expect(await first.save(learnedModel())).toBe("indexedDB");

    const second = new PreferenceStorage({ indexedDBFactory: factory, localStorage: null });
    expect(await second.load()).toEqual(learnedModel());
    expect(second.mode).toBe("indexedDB");
    expect(await second.reset()).toBe("indexedDB");
    expect(await second.load()).toBeNull();
  });

  it("exports canonical JSON and imports it losslessly", async () => {
    const model = learnedModel();
    const first = serializePreferenceModel(model);
    const second = serializePreferenceModel(parsePreferenceModelJson(first));
    expect(second).toBe(first);
    expect(isPreferenceModel(JSON.parse(first))).toBe(true);

    const storage = new PreferenceStorage({ indexedDBFactory: null, localStorage: null });
    const imported = await storage.importJson(first);
    expect(imported).toEqual(model);
    expect(await storage.exportJson()).toBe(first);
  });

  it("rejects malformed or schema-invalid imports without replacing data", async () => {
    const storage = new PreferenceStorage({ indexedDBFactory: null, localStorage: null });
    await storage.save(learnedModel());
    await expect(storage.importJson("{broken")).rejects.toThrow("malformed");
    await expect(storage.importJson(JSON.stringify({ version: 999 }))).rejects.toThrow(
      "invalid schema",
    );
    expect(await storage.load()).toEqual(learnedModel());
  });

  it("resets the profile and exports a valid empty model afterward", async () => {
    const storage = new PreferenceStorage({ indexedDBFactory: null, localStorage: null });
    await storage.save(learnedModel());
    expect(await storage.reset()).toBe("memory");
    expect(await storage.load()).toBeNull();
    expect(parsePreferenceModelJson(await storage.exportJson())).toEqual(createPreferenceModel());
  });

  it("falls back from IndexedDB to localStorage before memory", async () => {
    const localStorage = new FakeLocalStorage();
    const first = new PreferenceStorage({ indexedDBFactory: null, localStorage });
    expect(await first.save(learnedModel())).toBe("localStorage");

    const second = new PreferenceStorage({ indexedDBFactory: null, localStorage });
    expect(await second.load()).toEqual(learnedModel());
    expect(second.mode).toBe("localStorage");
  });

  it("does not resurrect stale IndexedDB data after a failed write uses localStorage", async () => {
    const factory = new FakeIDBFactory();
    const localStorage = new FakeLocalStorage();
    const first = new PreferenceStorage({
      indexedDBFactory: factory as unknown as IDBFactory,
      localStorage,
    });
    const oldModel = learnedModel();
    await first.save(oldModel);

    const newerModel = learnedModel();
    newerModel.categories.harmony.weights["quality.tension"] = 0.75;
    factory.failWrites = true;
    expect(await first.save(newerModel)).toBe("localStorage");

    factory.failWrites = false;
    const reopened = new PreferenceStorage({
      indexedDBFactory: factory as unknown as IDBFactory,
      localStorage,
    });
    expect((await reopened.load())?.categories.harmony.weights["quality.tension"]).toBe(0.75);
    expect(reopened.mode).toBe("localStorage");
  });

  it("keeps a reset tombstone when IndexedDB deletion cannot be persisted", async () => {
    const factory = new FakeIDBFactory();
    const localStorage = new FakeLocalStorage();
    const first = new PreferenceStorage({
      indexedDBFactory: factory as unknown as IDBFactory,
      localStorage,
    });
    await first.save(learnedModel());

    factory.failWrites = true;
    expect(await first.reset()).toBe("localStorage");

    factory.failWrites = false;
    const reopened = new PreferenceStorage({
      indexedDBFactory: factory as unknown as IDBFactory,
      localStorage,
    });
    expect(await reopened.load()).toBeNull();
    expect(reopened.mode).toBe("localStorage");
  });
});
