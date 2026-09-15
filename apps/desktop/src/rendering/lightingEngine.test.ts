import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveDepthOfFieldFocus } from "./lightingEngine";

describe("gameplay-aware depth of field", () => {
  it("keeps a selected miniature inside a readable focal band", () => {
    const focus = resolveDepthOfFieldFocus(
      { x: 0, y: 12, z: 12 },
      { x: 0, y: -.707, z: -.707 },
      [{ position: { x: 0, y: 1, z: 0 }, radius: 1 }],
    );
    expect(focus.distance).toBeGreaterThan(14);
    expect(focus.range).toBeGreaterThanOrEqual(6);
    expect(focus.count).toBe(1);
  });

  it("widens focus to include a combat group at different depths", () => {
    const single = resolveDepthOfFieldFocus({ x: 0, y: 10, z: 15 }, { x: 0, y: -.5, z: -.866 }, [{ position: { x: 0, y: 1, z: 2 } }]);
    const group = resolveDepthOfFieldFocus({ x: 0, y: 10, z: 15 }, { x: 0, y: -.5, z: -.866 }, [
      { position: { x: 0, y: 1, z: 2 } },
      { position: { x: 0, y: 1, z: -6 } },
    ]);
    expect(group.range).toBeGreaterThan(single.range);
    expect(group.count).toBe(2);
  });

  it("uses a broad safe band while building", () => {
    const focus = resolveDepthOfFieldFocus({ x: 0, y: 10, z: 10 }, { x: 0, y: -.707, z: -.707 }, [
      { position: { x: -9, y: 1, z: -7 }, radius: 2.5 },
      { position: { x: 9, y: 1, z: -7 }, radius: 2.5 },
      { position: { x: -9, y: 1, z: 7 }, radius: 2.5 },
      { position: { x: 9, y: 1, z: 7 }, radius: 2.5 },
    ], true);
    expect(focus.range).toBeGreaterThanOrEqual(24);
    expect(focus.count).toBe(4);
  });

  it("includes authored practical lights in the colored bounce probe grid", () => {
    const source = readFileSync(resolve(process.cwd(), "src/rendering/lightingEngine.ts"), "utf8");
    expect(source).toContain("const practical = resolvePracticalLight(entity)");
    expect(source).toContain("intensity: practical.behavior.intensity");
    expect(source).toContain("color: colorTuple(practical.behavior.color)");
  });

  it("makes lighting teardown idempotent before a workspace transition", () => {
    const source = readFileSync(resolve(process.cwd(), "src/rendering/lightingEngine.ts"), "utf8");
    expect(source).toContain("if (rig.destroyed) return;");
    expect(source).toContain("rig.destroyed = true;");
    expect(source).toContain("rig.cameraFrame = null;");
  });

  it("routes legacy and Forge interiors through the stable direct-forward path", () => {
    const source = readFileSync(resolve(process.cwd(), "src/rendering/lightingEngine.ts"), "utf8");
    expect(source).toContain("const generatedInterior = isInteriorMap(map)");
    expect(source).toContain("frame.enabled = rig.cameraFrameRequested");
    expect(source).toContain('"disabled-interior"');
  });
});
