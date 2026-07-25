import { afterEach, describe, expect, it } from "vitest";
import {
  ASSUMED_LOCAL_STORAGE_QUOTA_BYTES,
  estimateStorageCapacity,
  formatBytes,
  storageCapacityLevel,
} from "../src/storage";

afterEach(() => {
  localStorage.clear();
});

describe("localStorage capacity estimate", () => {
  it("reports an empty store as unused", () => {
    const estimate = estimateStorageCapacity();
    expect(estimate.confidence).toBe("measured");
    expect(estimate.usedBytes).toBe(0);
    expect(estimate.usedRatio).toBe(0);
    expect(estimate.remainingBytes).toBe(ASSUMED_LOCAL_STORAGE_QUOTA_BYTES);
  });

  it("counts both keys and values, at two bytes per UTF-16 unit", () => {
    localStorage.setItem("ab", "cde"); // 2 + 3 units = 10 bytes
    expect(estimateStorageCapacity().usedBytes).toBe(10);
  });

  it("grows as entries are added and shrinks as they are removed", () => {
    localStorage.setItem("k", "x".repeat(1000));
    const withEntry = estimateStorageCapacity();
    localStorage.removeItem("k");
    const without = estimateStorageCapacity();
    expect(withEntry.usedBytes).toBeGreaterThan(without.usedBytes);
    expect(withEntry.remainingBytes).toBeLessThan(without.remainingBytes);
  });

  it("keeps used and remaining consistent with the assumed quota", () => {
    localStorage.setItem("k", "y".repeat(5_000));
    const estimate = estimateStorageCapacity();
    expect(estimate.usedBytes + estimate.remainingBytes).toBe(estimate.quotaBytes);
    expect(estimate.usedRatio).toBeCloseTo(estimate.usedBytes / estimate.quotaBytes, 10);
  });

  it("clamps rather than underflowing when usage exceeds the assumption", () => {
    // A browser more generous than the assumed 5 MB would otherwise produce a
    // negative remainder. jsdom enforces its own quota, so the oversized store
    // is simulated to drive the real code down that branch.
    const huge = "z".repeat(ASSUMED_LOCAL_STORAGE_QUOTA_BYTES);
    const stub: Pick<Storage, "length" | "key" | "getItem"> = {
      length: 1,
      key: (index: number) => (index === 0 ? "big" : null),
      getItem: (key: string) => (key === "big" ? huge : null),
    };
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { value: stub, configurable: true });
    try {
      const estimate = estimateStorageCapacity();
      expect(estimate.confidence).toBe("measured");
      expect(estimate.usedBytes).toBeGreaterThan(estimate.quotaBytes);
      expect(estimate.remainingBytes).toBe(0);
      expect(estimate.usedRatio).toBe(1);
      expect(storageCapacityLevel(estimate)).toBe("critical");
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });

  it("reports unavailable, not zero usage, when the store cannot be read", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked by privacy settings");
      },
      configurable: true,
    });
    try {
      const estimate = estimateStorageCapacity();
      expect(estimate.confidence).toBe("unavailable");
      // Must not be presented as a real reading.
      expect(storageCapacityLevel(estimate)).toBe("ok");
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });
});

describe("capacity levels", () => {
  const at = (ratio: number) => ({
    usedBytes: ratio * ASSUMED_LOCAL_STORAGE_QUOTA_BYTES,
    quotaBytes: ASSUMED_LOCAL_STORAGE_QUOTA_BYTES,
    remainingBytes: (1 - ratio) * ASSUMED_LOCAL_STORAGE_QUOTA_BYTES,
    usedRatio: ratio,
    confidence: "measured" as const,
  });

  it("escalates as the store fills", () => {
    expect(storageCapacityLevel(at(0))).toBe("ok");
    expect(storageCapacityLevel(at(0.5))).toBe("ok");
    expect(storageCapacityLevel(at(0.75))).toBe("warning");
    expect(storageCapacityLevel(at(0.89))).toBe("warning");
    expect(storageCapacityLevel(at(0.9))).toBe("critical");
    expect(storageCapacityLevel(at(1))).toBe("critical");
  });

  it("stays calm when the figure could not be measured", () => {
    // An unmeasurable store must not look like an emergency.
    expect(storageCapacityLevel({ ...at(1), confidence: "unavailable" })).toBe("ok");
  });
});

describe("byte formatting", () => {
  it("scales the unit to the magnitude", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(100 * 1024)).toBe("100 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });

  it("returns a placeholder rather than NaN for invalid input", () => {
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });
});
