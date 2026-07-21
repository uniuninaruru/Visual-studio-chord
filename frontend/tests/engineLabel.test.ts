import { describe, expect, it } from "vitest";
import { formatEngineLabel } from "../src/features/status/engineLabel";

describe("formatEngineLabel", () => {
  it("reports the CPU runtime that actually completed a CUDA fallback", () => {
    expect(formatEngineLabel(true, "cuda", "cpu", "completed")).toBe("Local CPU");
  });

  it("keeps the selected runtime while running and identifies browser fallback", () => {
    expect(formatEngineLabel(true, "cuda", "cpu", "running")).toBe("Local CUDA");
    expect(formatEngineLabel(true, "cuda", "browser-linear", "completed"))
      .toBe("Browser fallback");
    expect(formatEngineLabel(false, "cpu", "browser-linear", "idle"))
      .toBe("Browser / Theory-only");
  });
});
