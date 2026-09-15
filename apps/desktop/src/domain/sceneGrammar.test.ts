import { describe, expect, it } from "vitest";
import { applySceneMaterials, expandSceneRecipe, sceneCompositionSchema, sceneRecipeBounds, type SceneComposition, type ScenePart } from "./sceneGrammar";
import { createFallbackWorldBlueprints, compileWorldBlueprint, createSceneTemplate } from "./worldForge";
import { buildAssemblyMeshes, buildingAssemblyParts } from "../rendering/sceneAssemblyMesh";
import { generateCgaBuilding } from "./worldArchitecture";

const part: ScenePart = { shape: "cylinder", position: { x: -3, y: 1.5, z: -2 }, size: { x: .25, y: 3, z: .25 }, rotation: { x: 0, y: 0, z: 0 }, color: "#ad4832", material: "timber", repeat: { count: 4, step: { x: 2, y: 0, z: 0 }, yaw: 0 } };
export const courtyardComposition: SceneComposition = { design: "Open timber bays under swept tile eaves", recipes: [{ id: "courtyard", name: "Timber courtyard hall", parts: [part, { shape: "roof", position: { x: 0, y: 3.5, z: 0 }, size: { x: 9, y: 1.2, z: 6 }, rotation: { x: 0, y: 0, z: 0 }, color: "#395750", material: "roof", curve: .6 }] }], buildingRecipeId: "courtyard", placements: [{ recipeId: "courtyard", x: 0, z: 0, elevation: 0, yaw: 90, scale: 1 }] };

describe("AI-authored scene construction grammar", () => {
  it("constructs connected bays and door openings from model-selected frame proportions", () => {
    const frame: ScenePart = { shape: "frame", position: { x: 0, y: 2, z: 0 }, size: { x: 8, y: 4, z: 6 }, rotation: { x: 0, y: 90, z: 0 }, material: "timber", color: "#8b4513", bays: { x: 3, z: 2 }, levels: 1, openness: .3 };
    const parts = expandSceneRecipe([frame]);
    expect(parts.length).toBeGreaterThan(15);
    expect(parts.every((part) => part.shape === "box")).toBe(true);
    const bounds = sceneRecipeBounds(parts);
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(4);
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(6.35);
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(8.35);
    expect(buildAssemblyMeshes(parts).size).toBe(2);
  });
  it("expands repeated construction without mutating its recipe and merges by material", () => {
    const original = structuredClone(courtyardComposition);
    const expanded = expandSceneRecipe(courtyardComposition.recipes[0].parts);
    expect(expanded).toHaveLength(5);
    expect(expanded.slice(0, 4).map((p) => p.position.x)).toEqual([-3, -1, 1, 3]);
    const meshes = buildAssemblyMeshes(expanded);
    expect([...meshes.keys()]).toEqual(["timber", "roof"]);
    for (const mesh of meshes.values()) {
      expect(mesh.positions.every(Number.isFinite)).toBe(true);
      expect(mesh.normals.length).toBe(mesh.positions.length);
      expect(Math.max(...mesh.indices)).toBeLessThan(mesh.positions.length / 3);
      expect(mesh.uvs.length).toBe(mesh.positions.length / 3 * 2);
    }
    expect(courtyardComposition).toEqual(original);
    const roof = meshes.get("roof")!;
    expect(roof.normals.filter((_, i) => i % 3 === 1).every((y) => y > 0)).toBe(true);
  });

  it("makes curved eaves from geometry and leaves openings in ruined facades", () => {
    const roof = expandSceneRecipe(courtyardComposition.recipes[0].parts).at(-1)!;
    const curved = buildAssemblyMeshes([roof]).get("roof")!;
    const straight = buildAssemblyMeshes([{ ...roof, curve: 0 }]).get("roof")!;
    expect(curved.positions[1]).toBeGreaterThan(straight.positions[1]);
    const ruin = generateCgaBuilding(42, true, "stone", .8);
    expect(ruin.roof).toBe("ruined");
    expect(ruin.facadeTiles.some((tile) => tile.integrity === 0)).toBe(true);
    expect(buildingAssemblyParts(ruin).some((item) => item.shape === "roof")).toBe(false);
    expect(buildAssemblyMeshes(buildingAssemblyParts(ruin)).size).toBeLessThanOrEqual(5);
  });

  it("rejects invalid recipes and excessive expansion", () => {
    expect(() => sceneCompositionSchema.parse({ ...courtyardComposition, buildingRecipeId: "invented" })).toThrow();
    expect(() => sceneCompositionSchema.parse({ ...courtyardComposition, recipes: [{ ...courtyardComposition.recipes[0], parts: Array.from({ length: 48 }, () => ({ ...part, repeat: { ...part.repeat, count: 24 } })) }] })).toThrow(/384/);
    expect(() => sceneCompositionSchema.parse({ ...courtyardComposition, recipes: [{ ...courtyardComposition.recipes[0], parts: [{ ...part, shape: "eval" }] }] })).toThrow();
  });

  it("compiles culture-specific structures and keeps all surface dependencies in saved templates", () => {
    const [blueprint] = createFallbackWorldBlueprints({ description: "A village deep in the forest", kind: "auto", size: "small", gridShape: "square", seed: 7241, background: "none" });
    expect(blueprint.biome.id).toBe("forest");
    blueprint.composition = courtyardComposition;
    const { map } = compileWorldBlueprint(blueprint);
    const structures = map.entities.filter((item) => item.tags?.includes("world:building"));
    expect(structures.length).toBeGreaterThan(1);
    expect(structures.every((item) => item.worldGeometry?.kind === "assembly")).toBe(true);
    expect(map.entities.some((item) => item.worldGeometry?.kind === "cga-building")).toBe(false);
    expect(map.world?.chunks.flatMap((chunk) => chunk.entityIds).sort()).toEqual(map.entities.map((item) => item.id).sort());
    const styled = applySceneMaterials(map, { ground: "earth-map", timber: "red-timber", roof: "jade-tiles", masonry: "white-plaster", foliage: "bamboo-green" });
    expect(createSceneTemplate(styled).materialAssetIds).toEqual(expect.arrayContaining(["earth-map", "red-timber", "jade-tiles", "bamboo-green"]));
    expect(createSceneTemplate(styled).materialAssetIds).not.toContain("white-plaster"); // This recipe has no masonry.
    expect(styled.entities.map((item) => item.position)).toEqual(map.entities.map((item) => item.position));
    expect(map.entities.every((item) => !item.materialSlots && !item.materialAssetId)).toBe(true);
  });
});
