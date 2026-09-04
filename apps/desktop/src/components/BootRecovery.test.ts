import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("boot recovery", () => {
  it("never deletes the saved campaign when recovering the UI", () => {
    const boundary = readFileSync(resolve(process.cwd(), "src/components/BootErrorBoundary.tsx"), "utf8");
    const watchdog = readFileSync(resolve(process.cwd(), "public/boot-watchdog.js"), "utf8");
    expect(boundary).not.toContain('removeItem("dndrom-campaign-v1")');
    expect(watchdog).not.toContain('removeItem("dndrom-campaign-v1")');
    expect(boundary).toContain('removeItem("dndrom.creatorPage.v1")');
    expect(watchdog).toContain('removeItem("dndrom.creatorPage.v1")');
  });
});
