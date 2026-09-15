import { describe, it, expect } from "vitest";
import { createErodedWorldSampler, erodeWorldTile } from "./worldErosion";
import { atlasLandform } from "./worldLandform";

describe("regional hydraulic erosion", {timeout:60_000}, () => {
  it("transports sediment conservatively and deterministically", () => {
    const a=erodeWorldTile(0,0,719),b=erodeWorldTile(0,0,719);
    expect(a.delta).toEqual(b.delta);expect(Math.abs(a.massError)).toBeLessThan(1e-7);
    expect([...a.delta,...a.discharge,...a.sediment].every(Number.isFinite)).toBe(true);
    expect(a.delta.some(v=>v < -1)).toBe(true);expect(a.delta.some(v=>v > 1)).toBe(true);
  });
  it("joins overlapping simulations continuously without depending on request order", () => {
    const a=createErodedWorldSampler(719,16),b=createErodedWorldSampler(719,16);
    const x=8192,z=100;
    expect(Math.abs(a.height(x-.001,z)-a.height(x+.001,z))).toBeLessThan(.02);
    b.height(9000,4000);
    expect(a.height(x,z)).toBe(b.height(x,z));
    expect(a.height(7500,z)).not.toBe(atlasLandform(7500,z,719));
    expect(a.cachedTiles()).toBeLessThanOrEqual(16);
  });
});
