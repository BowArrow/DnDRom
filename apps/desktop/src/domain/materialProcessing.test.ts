import { describe, expect, it } from "vitest";
import { materialProjectionForGeometry, scoreOppositeEdgeContinuity } from "./materialProcessing";

describe("architectural material seams", () => {
  it("scores matching opposite edges as seamless", () => { const data = new Uint8ClampedArray(4 * 4 * 4).fill(120); expect(scoreOppositeEdgeContinuity(data, 4, 4)).toBe(1); });
  it("detects discontinuous edge colors", () => { const data = new Uint8ClampedArray(4 * 4 * 4).fill(0); for (let y = 0; y < 4; y++) { const i = (y * 4 + 3) * 4; data.set([255,255,255,255], i); } expect(scoreOppositeEdgeContinuity(data, 4, 4)).toBeLessThan(.8); });
  it("selects projection from modular geometry instead of baking it into one theme", () => {
    expect(materialProjectionForGeometry("floor-stone", "uv")).toBe("planar-xz");
    expect(materialProjectionForGeometry("wall-wood", "uv")).toBe("planar-xy");
    expect(materialProjectionForGeometry("kenney-column", "uv")).toBe("triplanar");
    expect(materialProjectionForGeometry("table-round", "uv")).toBe("uv");
  });
});
