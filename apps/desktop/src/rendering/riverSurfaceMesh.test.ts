import { describe, expect, it } from "vitest";
import { buildContinuousRiverSurface, riverCrossChannelBandCount } from "./riverSurfaceMesh";

describe("continuous river surface tessellation", () => {
  it("builds a multi-band manifold strip with no per-segment duplicate rows", () => {
    const path = [
      { x: 0, y: 1, z: 0, width: 3, tangentX: 1, tangentZ: 0 },
      { x: 2, y: .9, z: .5, width: 3.2, tangentX: .97, tangentZ: .24 },
      { x: 4, y: .8, z: 2, width: 3.5, tangentX: .8, tangentZ: .6 },
    ];
    const mesh = buildContinuousRiverSurface([path], { x: 0, y: 0, z: 0 }, .7);
    expect(mesh.positions).toHaveLength(path.length * riverCrossChannelBandCount * 3);
    expect(mesh.indices).toHaveLength((path.length - 1) * (riverCrossChannelBandCount - 1) * 6);
    expect(mesh.colors.filter((_, index) => index % 4 === 0 && mesh.colors[index] === 0).length).toBeGreaterThan(0);
  });

  it("uses persisted regional tangents at clipped boundaries", () => {
    const path = [
      { x: 0, y: 0, z: 0, width: 2, tangentX: 0, tangentZ: 1 },
      { x: 1, y: 0, z: 1, width: 2, tangentX: 0, tangentZ: 1 },
    ];
    const mesh = buildContinuousRiverSurface([path], { x: 0, y: 0, z: 0 });
    expect(mesh.positions[0]).toBeCloseTo(1);
    expect(mesh.positions[2]).toBeCloseTo(0);
  });

  it("bounds the outside join of a tight meander instead of producing a radial spike", () => {
    const path = [
      { x: 0, y: 0, z: 0, width: 4 },
      { x: 1, y: -.1, z: 0, width: 4 },
      { x: 1.15, y: -.2, z: 1, width: 4 },
      { x: .3, y: -.3, z: 1.3, width: 4 },
    ];
    const mesh = buildContinuousRiverSurface([path], { x: 0, y: 0, z: 0 }, .8);
    for (let row = 0; row < path.length; row++) {
      const left = row * riverCrossChannelBandCount * 3;
      const right = (row * riverCrossChannelBandCount + riverCrossChannelBandCount - 1) * 3;
      const span = Math.hypot(mesh.positions[right] - mesh.positions[left], mesh.positions[right + 2] - mesh.positions[left + 2]);
      expect(span).toBeLessThanOrEqual(path[row].width * 1.33);
    }
  });
});
