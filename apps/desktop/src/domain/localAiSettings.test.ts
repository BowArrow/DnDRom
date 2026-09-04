import { describe, expect, it } from "vitest";
import { normalizeLocalAiSettings, worldWanBudget } from "./localAiSettings";

describe("local AI memory settings", () => {
  it("defaults to a headroom-preserving world profile", () => {
    expect(normalizeLocalAiSettings(null).memoryProfile).toBe("balanced");
    expect(worldWanBudget("balanced")).toMatchObject({
      width: 960,
      height: 480,
      length: 81,
      supplementalLength: 81,
      steps: 4,
      vramReserveGb: 1.25,
      outputWidth: 4096,
      maxTrajectories: 4,
      compositeFrames: "0-80/4",
      geometryScale: 1,
      compositePrefetch: false,
      trainingSteps: 4500,
      trainingMaxFrames: 324,
      maxSplats: 400_000,
      runtimeSplatBudget: 450_000,
    });
  });

  it("keeps maximum quality opt-in and provides a conservative fallback", () => {
    expect(worldWanBudget("maximum")).toMatchObject({ width: 1440, height: 720, length: 81, steps: 4, compositeFrames: "0-80/2", maxTrajectories: 4 });
    expect(worldWanBudget("conservative")).toMatchObject({ width: 640, height: 320, length: 81, steps: 4, compositeFrames: "0-80/4", vramReserveGb: 1.75, outputWidth: 2048, maxTrajectories: 4, maxSplats: 100_000 });
  });
});
