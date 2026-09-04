import { describe, expect, it } from "vitest";
import { practicalLightBehaviorForEntity, resolvePracticalLight } from "./practicalLights";
import type { MapEntity } from "./types";

const entity = (assetId: string): MapEntity => ({ id: "light", assetId, name: "Light", position: { x: 2, y: 0, z: 3 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 1, y: 1, z: 1 } });

describe("editable practical lights", () => {
  it("resolves invisible scene lights from their build asset defaults", () => {
    const resolved = resolvePracticalLight(entity("scene-light-point"));
    expect(resolved?.behavior.lightType).toBe("point");
    expect(resolved?.position).toMatchObject({ x: 2, y: 2.4, z: 3 });
  });

  it("prefers per-instance settings and rotates spot direction with its entity", () => {
    const placed = entity("scene-light-spot");
    placed.light = { kind: "practical-light", lightType: "spot", color: "#ff00ff", intensity: 3, range: 9, coneAngle: 30, anchor: { x: 0, y: 2, z: 0 }, direction: { x: 0, y: 0, z: -1 }, flicker: { enabled: true, amount: .2, speed: 4 } };
    expect(practicalLightBehaviorForEntity(placed)?.color).toBe("#ff00ff");
    expect(resolvePracticalLight(placed)?.direction).toMatchObject({ x: -1, y: 0 });
  });

  it("does not emit from hidden editor lights", () => {
    expect(resolvePracticalLight({ ...entity("scene-light-point"), hidden: true })).toBeNull();
  });
});
