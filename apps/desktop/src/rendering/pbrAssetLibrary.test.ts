import * as pc from "playcanvas";
import { describe, expect, it } from "vitest";
import { applyHobbyPaintFinish, applyMatteFloorFinish, applyMiniatureRimFinish, applyPropPhysicalProfile, applySceneReactiveMiniatureFinish, applyTabletopFinish, normalizeScannedAlbedoTint, proceduralSurfaceForRole, SCANNED_PBR_ASSETS } from "./pbrAssetLibrary";

describe("bundled scanned PBR surfaces", () => {
  it("maps the main tabletop surfaces to offline Poly Haven assets", () => {
    expect(SCANNED_PBR_ASSETS["wood-floor"]?.id).toBe("plank_flooring_04");
    expect(SCANNED_PBR_ASSETS["wood-table"]?.id).toBe("wood_table_001");
    expect(SCANNED_PBR_ASSETS["wood-chair"]?.id).toBe("coated_pine");
    expect(SCANNED_PBR_ASSETS["wood-barrel"]?.id).toBe("weathered_planks");
    expect(SCANNED_PBR_ASSETS["wood-crate"]?.id).toBe("wooden_planks");
    expect(SCANNED_PBR_ASSETS["wood-structural"]?.id).toBe("dark_wood");
    expect(SCANNED_PBR_ASSETS["stone-floor"]?.id).toBe("monastery_stone_floor");
    expect(SCANNED_PBR_ASSETS["stone-wall"]?.id).toBe("medieval_blocks_03");
    expect(SCANNED_PBR_ASSETS.metal?.id).toBe("metal_plate");
    expect(SCANNED_PBR_ASSETS.fabric?.id).toBe("cotton_jersey");
  });

  it("uses denser repetition for cloth and metal detail", () => {
    expect(SCANNED_PBR_ASSETS.fabric!.repeat[0]).toBeGreaterThan(SCANNED_PBR_ASSETS["wood-floor"]!.repeat[0]);
    expect(SCANNED_PBR_ASSETS.metal!.repeat[0]).toBeGreaterThanOrEqual(SCANNED_PBR_ASSETS["wood-floor"]!.repeat[0]);
  });

  it("adds a physical finish without replacing authored texture maps or tint", () => {
    const material = new pc.StandardMaterial();
    const albedo = {} as pc.Texture;
    const normal = {} as pc.Texture;
    material.diffuse = new pc.Color(.24, .46, .68);
    material.diffuseMap = albedo;
    material.normalMap = normal;
    applyTabletopFinish(material, "painted-miniature");
    expect(material.diffuseMap).toBe(albedo);
    expect(material.normalMap).toBe(normal);
    expect([material.diffuse.r, material.diffuse.g, material.diffuse.b]).toEqual([.24, .46, .68]);
    expect(material.clearCoat).toBeGreaterThan(0);
    expect(material.clearCoatGloss).toBeGreaterThan(0);
  });

  it("adds hobby wash, drybrush, and varnish chunks without replacing miniature maps", () => {
    const material = new pc.StandardMaterial();
    const albedo = {} as pc.Texture;
    const ao = {} as pc.Texture;
    const specialty = {} as pc.Texture;
    material.diffuseMap = albedo;
    material.aoMap = ao;
    applyHobbyPaintFinish(material, specialty);
    const diffuseChunk = material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).get("diffusePS") ?? "";
    const glossChunk = material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).get("glossPS") ?? "";
    expect(diffuseChunk).toContain("washMask");
    expect(diffuseChunk).toContain("dndrom_specialtyMap");
    expect(glossChunk).toContain("dndrom_varnishRoughness");
    expect(material.diffuseMap).toBe(albedo);
    expect(material.aoMap).toBe(ao);
    expect(material.aoIntensity).toBeGreaterThan(1);
  });

  it("uses physical prop profiles for wood, flocking, and two-sided paper", () => {
    const wood = new pc.StandardMaterial();
    const woodAlbedo = {} as pc.Texture;
    wood.diffuseMap = woodAlbedo;
    wood.metalness = .8;
    applyPropPhysicalProfile(wood, "wood-barrel");
    expect(wood.diffuseMap).toBe(woodAlbedo);
    expect(wood.enableGGXSpecular).toBe(true);
    expect(wood.anisotropyIntensity).toBeGreaterThan(0);
    expect(wood.metalness).toBeLessThan(.1);

    const foliage = new pc.StandardMaterial();
    applyPropPhysicalProfile(foliage, "foliage");
    expect(foliage.useSheen).toBe(true);
    expect(foliage.twoSidedLighting).toBe(true);

    const paper = new pc.StandardMaterial();
    applyPropPhysicalProfile(paper, "paper");
    expect(paper.cull).toBe(pc.CULLFACE_NONE);
    expect(paper.twoSidedLighting).toBe(true);
    expect(paper.refraction).toBeGreaterThan(0);
  });

  it("clamps floor highlights without replacing authored PBR maps", () => {
    const material = new pc.StandardMaterial();
    const albedo = {} as pc.Texture;
    const roughness = {} as pc.Texture;
    material.diffuseMap = albedo;
    material.glossMap = roughness;
    applyMatteFloorFinish(material, .88);
    const glossChunk = material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).get("glossPS") ?? "";
    expect(glossChunk).toContain("min(dGlossiness, dndrom_floorMaxGloss)");
    expect(material.diffuseMap).toBe(albedo);
    expect(material.glossMap).toBe(roughness);
  });

  it("adds a restrained Fresnel rim only when a miniature requests it", () => {
    const material = new pc.StandardMaterial();
    applyMiniatureRimFinish(material);
    const emissiveChunk = material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).get("emissivePS") ?? "";
    expect(emissiveChunk).toContain("smoothstep(.6, 1.0");
    expect(emissiveChunk).toContain("dndrom_miniRimStrength");
  });

  it("repairs unlit generator materials so practical lights affect miniatures", () => {
    const material = new pc.StandardMaterial();
    material.useLighting = false;
    material.emissiveIntensity = 4;
    applySceneReactiveMiniatureFinish(material);
    expect(material.useLighting).toBe(true);
    expect(material.useSkybox).toBe(true);
    expect(material.emissiveIntensity).toBeLessThanOrEqual(.12);
  });

  it("routes foliage and paper to their dedicated procedural maps", () => {
    expect(proceduralSurfaceForRole("foliage")).toBe("foliage");
    expect(proceduralSurfaceForRole("grass")).toBe("foliage");
    expect(proceduralSurfaceForRole("paper")).toBe("paper");
  });

  it("normalizes dark scanned-material tints without discarding their hue", () => {
    const tint = normalizeScannedAlbedoTint(new pc.Color(.2, .4, .1));
    expect(Math.max(tint.r, tint.g, tint.b)).toBeCloseTo(.82);
    expect(tint.g).toBeGreaterThan(tint.r);
    expect(tint.r).toBeGreaterThan(tint.b);
  });
});
