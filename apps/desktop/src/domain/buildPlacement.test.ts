import { describe, expect, it } from "vitest";
import { attachmentLocalPosition, attachmentWorldPosition, buildSpatialHash, buildSpec, raycastAttachmentSurfaces, resolvePlacement, resolveSurfacePlacement, rotationAroundSurfaceNormal, structuralDescendants, updateAttachmentHierarchy, validatePlacement, wouldCreateAttachmentCycle } from "./buildPlacement";
import type { MapEntity } from "./types";

const entity = (id: string, assetId: string, x: number, z: number): MapEntity => ({ id, assetId, name: id, position: { x, y: 0, z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });

describe("intent-first build placement", () => {
  it("magnetically snaps a wall to a floor perimeter and auto-aligns it", () => {
    const floor = entity("floor", "floor-stone", 0, 0);
    const spec = buildSpec("wall-stone")!;
    const result = resolvePlacement({ x: 0, y: 0, z: -1.05 }, 37, spec, buildSpatialHash([floor]), { width: 20, depth: 20 });
    expect(result.snapped).toBe(true);
    expect(result.parentId).toBe("floor");
    expect(result.rotationY).toBe(0);
    expect(result.valid).toBe(true);
  });

  it("allows Alt-style free placement without a socket", () => {
    const floor = entity("floor", "floor-stone", 0, 0);
    const result = resolvePlacement({ x: .4, y: 0, z: -.9 }, 23, buildSpec("wall-stone")!, buildSpatialHash([floor]), { width: 20, depth: 20 }, [], false);
    expect(result).toMatchObject({ snapped: false, rotationY: 23, position: { x: .4, z: -.9 } });
  });

  it("uses lenient overlap volumes but still rejects substantial obstruction", () => {
    const crate = entity("crate", "crate", 0, 0);
    const spec = buildSpec("barrel")!;
    expect(validatePlacement({ x: 1.05, y: 0, z: 0 }, 0, spec, [crate], { width: 20, depth: 20 }).valid).toBe(true);
    expect(validatePlacement({ x: .1, y: 0, z: 0 }, 0, spec, [crate], { width: 20, depth: 20 }).valid).toBe(false);
  });

  it("treats floor tiles as support surfaces for tokens and placeable objects", () => {
    const floor = entity("floor", "floor-wood", 0, 0);
    const token = {
      id: "custom-token",
      name: "Goblin",
      kind: "enemy" as const,
      storageKey: "sha256:test",
      filename: "goblin.glb",
      byteLength: 128,
      footprint: .55,
      modelScale: 1,
      modelLift: .62,
      defaultPlacementScale: 1,
      base: { shape: "round" as const, color: "#111111", accentColor: "#aa2222", height: .14 },
      source: "import" as const,
      createdAt: "now",
      gameplayAuthority: "mesh-token" as const,
    };
    expect(validatePlacement({ x: 0, y: 0, z: 0 }, 0, buildSpec(token.id, [token])!, [floor], { width: 20, depth: 20 }, [token])).toEqual({ valid: true });
    expect(validatePlacement({ x: 0, y: 0, z: 0 }, 0, buildSpec("chair")!, [floor], { width: 20, depth: 20 })).toEqual({ valid: true });
  });

  it("traverses the stored structural graph", () => {
    const foundation = entity("a", "floor-stone", 0, 0);
    const wall = { ...entity("b", "wall-stone", 0, 1), build: { placedAt: "now", refundableUntil: "later", parentId: "a", socketId: "a:south", placementVersion: 1 as const } };
    const torch = { ...entity("c", "torch", 0, 2), build: { placedAt: "now", refundableUntil: "later", parentId: "b", placementVersion: 1 as const } };
    expect(structuralDescendants([foundation, wall, torch], "a")).toEqual(["b", "c"]);
  });

  it("targets an authored tabletop and stores a scale-aware local attachment", () => {
    const table = { ...entity("table", "table-long", 2, 3), rotation: { x: 0, y: 90, z: 0 } };
    const spec = buildSpec("crate")!;
    const hit = raycastAttachmentSurfaces({ x: 2, y: 5, z: 3 }, { x: 0, y: -1, z: 0 }, [table], spec)!;
    expect(hit.surface.kind).toBe("tabletop");
    const placement = resolveSurfacePlacement(hit, 45, spec, table);
    expect(placement).toMatchObject({ parentId: "table", surfaceId: "top", snapped: true });
    expect(placement.position.y).toBeGreaterThan(.86);
    expect(attachmentWorldPosition(placement.localPosition!, table).x).toBeCloseTo(placement.position.x);
  });

  it("mounts torches on procedural and imported wall faces without burying the flame", () => {
    const torch = buildSpec("torch")!;
    for (const assetId of ["wall-wood", "kenney-wall"]) {
      const wall = entity(`wall-${assetId}`, assetId, 0, 0);
      const hit = raycastAttachmentSurfaces({ x: 0, y: 1.25, z: -4 }, { x: 0, y: 0, z: 1 }, [wall], torch);
      expect(hit?.surface.kind).toBe("wall");
      const placement = resolveSurfacePlacement(hit!, 0, torch, wall);
      expect(placement.parentId).toBe(wall.id);
      expect(placement.position.z).toBeLessThan(hit!.point.z - .1);
      expect(validatePlacement(placement.position, placement.rotationY, torch, [wall], { width: 20, depth: 20 }, [], wall.id, [], placement.surfaceId)).toEqual({ valid: true });
    }
  });

  it("lets torches stand on floors and rotates wall mounts around the hit normal", () => {
    const torch = buildSpec("torch")!;
    expect(torch.acceptedSurfaceTags).toEqual(expect.arrayContaining(["floor", "wall"]));
    const floor = entity("floor", "floor-wood", 0, 0);
    const floorHit = raycastAttachmentSurfaces({ x: 0, y: 4, z: 0 }, { x: 0, y: -1, z: 0 }, [floor], torch);
    expect(floorHit?.surface.kind).toBe("floor");
    expect(resolveSurfacePlacement(floorHit!, 45, torch, floor).rotation).toMatchObject({ x: 0, y: 45, z: 0 });
    const first = rotationAroundSurfaceNormal({ x: 1, y: 0, z: 0 }, 30);
    const repeated = rotationAroundSurfaceNormal({ x: 1, y: 0, z: 0 }, 30);
    expect(repeated).toEqual(first);
    expect(Object.values(first).every(Number.isFinite)).toBe(true);
  });

  it("lets invisible lighting gizmos share space with props", () => {
    const light = buildSpec("scene-light-point")!;
    expect(light.collisionMode).toBe("none");
    expect(validatePlacement({ x: 0, y: 0, z: 0 }, 0, light, [entity("table", "table-long", 0, 0)], { width: 20, depth: 20 })).toEqual({ valid: true });
  });

  it("rejects cycles and moves descendants with parent translation, rotation, and scale", () => {
    const parent = entity("parent", "table-long", 0, 0);
    const child: MapEntity = { ...entity("child", "crate", 1, 0), build: { placedAt: "now", refundableUntil: "later", placementVersion: 2, parentId: "parent", surfaceId: "top", localPosition: { x: 1, y: .9, z: 0 }, localRotation: { x: 0, y: 0, z: 0 }, surfaceNormal: { x: 0, y: 1, z: 0 }, clearanceOffset: .002 } };
    expect(wouldCreateAttachmentCycle([parent, child], "parent", "child")).toBe(true);
    const moved = updateAttachmentHierarchy([parent, child], "parent", { position: { x: 4, y: 0, z: 2 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 2, y: 2, z: 2 } });
    const movedChild = moved.find((entry) => entry.id === "child")!;
    expect(movedChild.position).toMatchObject({ x: 4, y: 1.8, z: 4 });
    expect(movedChild.rotation.y).toBe(90);
    expect(movedChild.scale.x).toBe(2);
    expect(attachmentLocalPosition(movedChild.position, moved[0]).x).toBeCloseTo(1);
  });

  it("allows separated plates on one surface and rejects intersecting siblings", () => {
    const table = entity("table", "table-long", 0, 0);
    const sibling: MapEntity = { ...entity("plate-a", "crate", -.7, 0), position: { x: -.7, y: .91, z: 0 }, scale: { x: .2, y: .08, z: .2 }, build: { placedAt: "now", refundableUntil: "later", placementVersion: 2, parentId: "table", surfaceId: "top", localPosition: { x: -.7, y: .91, z: 0 }, localRotation: { x: 0, y: 0, z: 0 }, surfaceNormal: { x: 0, y: 1, z: 0 }, clearanceOffset: .002 } };
    const spec = { ...buildSpec("crate")!, halfX: .2, halfZ: .2, bounds: { min: { x: -.2, y: 0, z: -.2 }, max: { x: .2, y: .08, z: .2 } } };
    expect(validatePlacement({ x: .7, y: .91, z: 0 }, 0, spec, [table, sibling], { width: 20, depth: 20 }, [], "table", [], "top").valid).toBe(true);
    expect(validatePlacement({ x: -.68, y: .91, z: 0 }, 0, spec, [table, sibling], { width: 20, depth: 20 }, [], "table", [], "top").valid).toBe(false);
  });
});
