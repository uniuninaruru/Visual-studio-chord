import { describe, expect, it } from "vitest";
import { readJson, writeJson, type StorageLike } from "../src/storage";

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new Error("blocked");
  }

  setItem(): void {
    throw new Error("quota exceeded");
  }

  removeItem(): void {
    throw new Error("blocked");
  }
}

describe("safe storage helpers", () => {
  it("does not crash when storage access is denied", () => {
    const storage = new ThrowingStorage();
    expect(
      readJson(
        "key",
        (value): value is object => typeof value === "object" && value !== null,
        storage,
      ),
    ).toBeNull();
    expect(writeJson("key", { ok: true }, storage)).toBe(false);
  });

  it("rejects malformed JSON", () => {
    const storage: StorageLike = {
      getItem: () => "{broken",
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(
      readJson(
        "key",
        (value): value is object => typeof value === "object" && value !== null,
        storage,
      ),
    ).toBeNull();
  });
});
