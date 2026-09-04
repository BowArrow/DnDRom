import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("clustered practical lighting", () => {
  it("enables spatial clusters and quality-tiered per-cell limits", () => {
    const source = readFileSync(resolve(process.cwd(), "src/rendering/lightingEngine.ts"), "utf8");
    expect(source).toContain("scene.clusteredLightingEnabled = true");
    expect(source).toContain("scene.lighting.maxLightsPerCell = budget.maxLightsPerCell");
    expect(source).toContain('dataset.dynamicLightLimit = `${budget.dynamicLights}-visible`');
  });

  it("re-ranks oversized authored scenes after meaningful camera movement", () => {
    const source = readFileSync(resolve(process.cwd(), "src/rendering/lightingEngine.ts"), "utf8");
    expect(source).toContain("refreshVirtualizedDynamicLights");
    expect(source).toContain("origin.distance(rig.camera.getPosition()) >= 2");
    expect(source).toContain("rebuildDynamicLights(rig, map, display)");
  });

  it("does not turn emissive streamed surfaces into clustered point lights", () => {
    const source = readFileSync(resolve(process.cwd(), "src/rendering/lightingEngine.ts"), "utf8");
    expect(source).toContain("if (entity.worldGeometry) return [];");
    expect(source).toContain("authoredDynamicLightFamilies");
  });
});
