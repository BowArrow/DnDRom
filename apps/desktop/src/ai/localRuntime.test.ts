import { describe, expect, it } from "vitest";
import { formatRuntimeBytes, runtimeProgressPercent } from "./localRuntime";

describe("automatic local runtime presentation", () => {
  it("shows honest first-run download sizes", () => {
    expect(formatRuntimeBytes(10 * 1024 ** 3)).toBe("10.0 GB");
    expect(formatRuntimeBytes(512 * 1024 ** 2)).toBe("512 MB");
  });

  it("bounds progress from native download events", () => {
    expect(runtimeProgressPercent({ completedBytes: 5, totalBytes: 10 })).toBe(50);
    expect(runtimeProgressPercent({ completedBytes: 12, totalBytes: 10, stage: "dependencies" })).toBe(99);
    expect(runtimeProgressPercent({ completedBytes: 10, totalBytes: 10, stage: "ready" })).toBe(100);
  });
});
