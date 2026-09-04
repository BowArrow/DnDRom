import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("tabletop selection policy", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/SceneViewport.tsx"), "utf8");

  it("keeps floor and wall panels selectable in Build mode", () => {
    const rayPicker = source.slice(source.indexOf("const nearestObjectOnRay"), source.indexOf("const updateGhost"));
    expect(rayPicker).toContain('if (!spec || spec.shape === "floor") continue;');
    expect(rayPicker).not.toContain('spec.shape === "floor" || spec.shape === "wall"');
    expect(rayPicker).toContain('if (spec.shape === "wall")');
    expect(rayPicker).toContain("Intersect the panel's actual rotated bounds instead.");
    expect(source).toContain('const inside = Math.abs(localX) <= spec.halfX');
    expect(source).toContain('return nearest?.entity ?? floorPanel?.entity ?? null;');
  });

  it("renders the same subtle green selection overlay on structural panels", () => {
    expect(source).not.toContain('!/^(floor-|road-|water-)/.test(selected.assetId)');
    expect(source).toContain('const floorLift = selectedSpec?.shape === "floor" ? .012 : 0;');
    expect(source).toContain('selectionCanvas.dataset.selectionStyle = "subtle-green-object-overlay"');
    expect(source).toContain('selectionCanvas.dataset.selectedAssetId = selected.assetId;');
  });
});
