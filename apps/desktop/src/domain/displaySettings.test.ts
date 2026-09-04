import { describe, expect, it } from "vitest";
import { displayPreset, normalizeDisplaySettings } from "./displaySettings";

describe("display settings", () => {
  it("normalizes malformed persisted values into safe rendering bounds", () => {
    const settings = normalizeDisplaySettings({ quality: "diorama", resolutionScale: 9, antialiasing: "taa" });
    expect(settings.quality).toBe("diorama");
    expect(settings.resolutionScale).toBe(1.25);
    expect(settings.shadowQuality).toBe("auto");
  });

  it("provides four meaningfully different presets", () => {
    expect(displayPreset("performance").ambientOcclusion).toBe(false);
    expect(displayPreset("balanced").depthOfField).toBe(false);
    expect(displayPreset("cinematic").depthOfField).toBe(true);
    expect(displayPreset("diorama").shadowQuality).toBe("ultra");
    expect(displayPreset("diorama").resolutionScale).toBeGreaterThan(1);
  });
});
