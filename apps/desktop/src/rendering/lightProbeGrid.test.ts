import { describe, expect, it } from "vitest";
import { bakeLightProbeGrid, sampleLightProbe } from "./lightProbeGrid";

describe("light probe grid", () => {
  it("keeps the bake bounded and adds colored bounce near a practical light", () => {
    const base = new Float32Array(27);
    const grid = bakeLightProbeGrid({
      width: 100,
      depth: 80,
      base,
      bounceTint: [.35, .12, .04],
      sources: [{ x: 0, y: 1.5, z: 0, radius: 8, intensity: 1.4, color: [1, .4, .1] }],
    });
    expect(grid.columns).toBe(12);
    expect(grid.rows).toBe(12);
    const center = sampleLightProbe(grid, 0, 0);
    const edge = sampleLightProbe(grid, 50, 40);
    expect(center[0]).toBeGreaterThan(edge[0]);
    expect(center[0]).toBeGreaterThan(center[2]);
    expect(center.slice(12).some((value) => Math.abs(value) > 0)).toBe(true);
  });

  it("bilinearly interpolates without leaving the board", () => {
    const grid = bakeLightProbeGrid({ width: 8, depth: 8, base: new Float32Array(27).fill(.1), bounceTint: [1, 1, 1], sources: [] });
    expect(Array.from(sampleLightProbe(grid, 0, 0))).toEqual(new Array(27).fill(expect.closeTo(.1)));
    expect(sampleLightProbe(grid, 100, 100)[0]).toBeCloseTo(.1);
  });
});
