import { describe, expect, it } from "vitest";
import { connectedRegionAlpha, paintedSketchFilename, sketchLayerComposite } from "./SketchPaintStudio";

describe("SketchPaintStudio helpers", () => {
  it("keeps a stable PNG name for the flattened edit", () => {
    expect(paintedSketchFilename("goblin.front.webp")).toBe("goblin.front-painted.png");
  });

  it("uses blend modes that preserve ink and separate light from shadow", () => {
    expect(sketchLayerComposite("color", true)).toBe("multiply");
    expect(sketchLayerComposite("color", false)).toBe("source-over");
    expect(sketchLayerComposite("shade", true)).toBe("multiply");
    expect(sketchLayerComposite("highlight", true)).toBe("screen");
    expect(sketchLayerComposite("erase", true)).toBe("destination-out");
  });

  it("keeps a magic-brush selection inside connected color boundaries", () => {
    const pixels = new Uint8ClampedArray([
      240, 20, 20, 255, 240, 20, 20, 255, 5, 5, 5, 255,
      240, 20, 20, 255, 240, 20, 20, 255, 5, 5, 5, 255,
    ]);
    const selected = connectedRegionAlpha({ width: 3, height: 2, data: pixels } as ImageData, 0, 0, 20);
    expect([...selected]).toEqual([255, 255, 0, 255, 255, 0]);
  });
});
