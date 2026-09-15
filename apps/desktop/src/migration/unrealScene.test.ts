import { describe, expect, it } from "vitest";
import * as pc from "playcanvas";
import type { GameMap, MapEntity } from "../domain/types";
import { exportUnrealScene, unrealPosition, unrealQuaternion, waterMesh } from "./unrealScene";

const entity = (overrides: Partial<MapEntity>): MapEntity => ({ id: "e", name: "Fixture", assetId: "fixture", position: { x: 3, y: 7, z: 11 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, ...overrides });
const map = (entities: MapEntity[]): GameMap => ({ id: "map", name: "Migration fixture", theme: "forest", width: 64, depth: 64, gridSize: 1, gridShape: "square", ambientColor: "#ffffff", entities });

describe("Unreal scene migration", () => {
  it("converts asymmetric rotations and metres without mirroring the scene", () => {
    const q = new pc.Quat().setFromEulerAngles(23, -61, 17), source = new pc.Vec3(3, 7, 11);
    const rotated = q.transformVector(source), converted = unrealPosition(rotated);
    const uq = new pc.Quat(...unrealQuaternion([q.x, q.y, q.z, q.w]));
    const up = unrealPosition(source), actual = uq.transformVector(new pc.Vec3(up.x, up.y, up.z));
    expect(actual.x).toBeCloseTo(converted.x, 5); expect(actual.y).toBeCloseTo(converted.y, 5); expect(actual.z).toBeCloseTo(converted.z, 5);
    expect(unrealPosition({ x: 1, y: 2, z: 3 })).toEqual({ x: 100, y: 300, z: 200 });
  });
  it("preserves authoring data and identifies unsupported assets without replacing them", () => {
    const source = map([entity({ id: "external", assetId: "user-glb", notes: "Quest target" }), entity({ id: "hidden", hidden: true })]);
    const result = exportUnrealScene(source);
    expect(result.source.map).toEqual(source);
    expect(result.instances).toHaveLength(0);
    expect(result.warnings).toEqual([{ entityId: "external", message: expect.stringContaining("retained in source") }]);
  });
  it("keeps terrain elevations absolute and converts CCW to Unreal clockwise winding", () => {
    const terrain = entity({ position: { x: 16, y: 20, z: 16 }, worldGeometry: { kind: "terrain", seed: 1, originX: 0, originZ: 0, size: 32, baseHeight: 100, relief: 0, roughness: 0, erosion: 0, paths: [], heightfield: { resolution: 3, heights: Array(9).fill(100) } } });
    const scene = exportUnrealScene(map([terrain]));
    const mesh = scene.meshes[0].lods[0];
    expect(mesh.positions[1] + scene.instances[0].position.y).toBe(100);
    const [a, b, c] = mesh.indices;
    const p = (i: number) => { const v = unrealPosition({ x: mesh.positions[i * 3], y: mesh.positions[i * 3 + 1], z: mesh.positions[i * 3 + 2] }); return new pc.Vec3(v.x, v.y, v.z); };
    // Unreal's grid builder uses clockwise indices and Chaos flips the
    // geometric triangle normal. Swapping axes already changes winding.
    expect(new pc.Vec3().cross(p(b).sub(p(a)), p(c).sub(p(a))).z).toBeLessThan(0);
    expect(mesh.normals[1]).toBeGreaterThan(0);
  });
  it("clips lakes to wet ground and preserves elevated basin surfaces", () => {
    const mesh = waterMesh({ kind: "water", originX: 0, originZ: 0, size: 2, resolution: 1, waterLevel: 20, wetCells: [true, false, false, false], depthField: [1, -1, -1, -1], surfaceHeights: [25, 25, 25, 25] }, { x: 0, y: 20, z: 0 });
    expect(mesh.indices).toHaveLength(3);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      expect(mesh.positions[i] + mesh.positions[i + 2]).toBeLessThanOrEqual(1);
      expect(mesh.positions[i + 1]).toBe(5);
    }
  });
  it("deduplicates seeded forest geometry and preserves every placement", () => {
    const tree = { kind: "space-colonized-tree" as const, style: "pine" as const, prototypeSeed: 8, branches: [], leafClusters: [], barkColor: "#654321", leafColors: ["#456732", "#345623"] as [string, string], instances: [{ x: 0, y: 0, z: 0, rotation: 45, scale: 1 }, { x: 4, y: 1, z: 3, rotation: 90, scale: 1.2 }] };
    const scene = exportUnrealScene(map([entity({ id: "a", worldGeometry: tree }), entity({ id: "b", worldGeometry: tree })]));
    expect(scene.meshes).toHaveLength(2); expect(scene.instances).toHaveLength(8);
    expect(scene.instances[0].position).toEqual({ x: 0, y: 0, z: 0 });
    expect(scene.instances[1].position).toEqual({ x: 4, y: 1, z: 3 });
    expect(scene.meshes.every(m => m.lods.length === 3 && m.lods[2].indices.length < m.lods[0].indices.length)).toBe(true);
    expect(scene.warnings).toHaveLength(0);
  });
  it("preserves absolute grass placements with a translated batch parent", () => {
    const source = entity({ worldGeometry: { kind: "ground-cover", color: "#456732", instances: [{ x: 10, y: 12, z: 14, rotation: .4, scale: .8 }] } });
    const scene = exportUnrealScene(map([source]));
    expect(scene.instances[0].position).toEqual({ x: 10, y: 12, z: 14 });
    expect(scene.instances[0].scale).toEqual({ x: .8, y: .8, z: .8 });
  });
  it("does not bank a climbing road across its width", () => {
    const road = entity({ worldGeometry: { kind: "road-ribbon", surface: "dirt", paths: [[{ x: 0, y: 10, z: 0, width: 4 }, { x: 10, y: 15, z: 5, width: 4 }, { x: 15, y: 19, z: 15, width: 4 }]] } });
    const mesh = exportUnrealScene(map([road])).meshes[0].lods[0];
    for (let i = 0; i < 3; i++) expect(mesh.positions[i * 27 + 1]).toBeCloseTo(mesh.positions[i * 27 + 25]);
  });
});
