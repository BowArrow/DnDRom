import { describe, expect, it } from "vitest";
import { ASSET_BY_ID } from "../domain/assets";
import { inferMaterialRole } from "../components/SceneViewport";

const role = (assetId: string, partIndex: number) => {
  const asset = ASSET_BY_ID.get(assetId)!;
  return inferMaterialRole(asset, asset.parts![partIndex], partIndex);
};

describe("semantic PBR assignment", () => {
  it("does not reuse floorboards across the whole tavern", () => {
    expect(role("floor-wood", 0)).toBe("wood-floor");
    expect(role("table-round", 0)).toBe("wood-table");
    expect(role("chair", 0)).toBe("wood-chair");
    expect(role("barrel", 0)).toBe("wood-barrel");
    expect(role("crate", 0)).toBe("wood-crate");
    expect(role("wall-wood", 0)).toBe("plaster");
    expect(role("wall-wood", 1)).toBe("wood-structural");
  });

  it("separates structural detail, terrain, and special surfaces", () => {
    expect(role("barrel", 1)).toBe("metal");
    expect(role("tree-pine", 0)).toBe("bark");
    expect(role("tree-pine", 1)).toBe("foliage");
    expect(role("floor-grass", 0)).toBe("grass");
    expect(role("road-dirt", 0)).toBe("earth");
    expect(role("water-tile", 0)).toBe("water");
  });
});
