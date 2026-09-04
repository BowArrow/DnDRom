import { describe, expect, it } from "vitest";
import { basePlateDependencies, basePlateParticleBudget, createBasePlateAsset, createBasePlateConcepts, createBasePlateRecipe, deriveFootContactMask, MAX_BASE_DECORATION_TRIANGLES, removeBasePlateLayer, reorderBasePlateLayer, resolveBasePlateAssetId, validateBasePlateRecipe } from "./baseplates";
import { createStarterCampaign } from "./seed";
import type { CampaignScene, TokenAsset } from "./types";

const token = (): TokenAsset => ({ id: "token-a", name: "Frog", kind: "player", storageKey: "x", filename: "x.glb", byteLength: 1, footprint: 1, modelScale: 1, modelLift: 0, defaultPlacementScale: 1, base: { shape: "round", color: "#000000", accentColor: "#ffffff", height: .14 }, source: "import", states: [{ id: "state-a", formId: "frog-form", name: "Frog", storageKey: "x", filename: "x.glb", byteLength: 1, modelScale: 1, modelLift: 0, animations: [], createdAt: "now" }], createdAt: "now", gameplayAuthority: "mesh-token" });

describe("scenic baseplates", () => {
  it("creates deterministic contextual concepts", () => expect(createBasePlateConcepts("frog beside a lily pond").map((item) => item.preset)[0]).toBe("pond"));
  it("caps visual overhang and unique geometry", () => {
    const recipe = createBasePlateRecipe("grass");
    recipe.layers.push(...[1, 2].map((n) => ({ ...recipe.layers[2], id: String(n), overhang: .8, solid: false, triangleCount: 4_000 })));
    const valid = validateBasePlateRecipe(recipe);
    expect(valid.layers.every((layer) => (layer.overhang ?? 0) <= .08)).toBe(true);
    expect(valid.layers.reduce((sum, layer) => sum + (layer.triangleCount ?? 0), 0)).toBeLessThanOrEqual(MAX_BASE_DECORATION_TRIANGLES);
  });
  it("resolves assignment precedence", () => {
    const campaign = createStarterCampaign();
    campaign.basePlateAssignments = { "character:character-a": "campaign-character", "token:token-a": "campaign-token" };
    const scene = { ...(campaign.scenes?.[0] as CampaignScene), basePlateAssignments: { "entity:entity-a": "scene-entity", "token:token-a": "scene-token" } };
    expect(resolveBasePlateAssetId({ campaign, scene, token: token(), characterId: "character-a", entity: { id: "entity-a" } as never })).toBe("scene-entity");
  });
  it("inherits a form base and keeps eight revisions", () => {
    const t = token(); t.formBasePlateAssignments = { "frog-form": "form-base" };
    const campaign = createStarterCampaign();
    expect(resolveBasePlateAssetId({ campaign, token: t, entity: { tokenStateId: "state-a" } as never })).toBe("form-base");
    let asset = createBasePlateAsset("Pond", createBasePlateRecipe("pond"));
    for (let index = 0; index < 10; index += 1) asset = createBasePlateAsset("Pond", createBasePlateRecipe("pond"), "procedural", asset);
    expect(asset.revisions).toHaveLength(8);
  });
  it("tracks catalogue dependencies and motion budgets", () => {
    const asset = createBasePlateAsset("Pond", createBasePlateRecipe("pond"));
    asset.recipe.layers[1].materialAssetId = "mat-a"; asset.recipe.layers[2].propAssetId = "prop-a";
    expect(basePlateDependencies(asset)).toEqual({ propAssetIds: ["prop-a"], materialAssetIds: ["mat-a"] });
    expect(basePlateParticleBudget("diorama", false)).toBe(48);
    expect(basePlateParticleBudget("diorama", true)).toBe(0);
  });
  it("derives a protected mask from the lowest twelve percent and falls back safely", () => {
    const mask = deriveFootContactMask([{ x: -.1, y: 0, z: 0 }, { x: .1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], 1);
    expect(mask.source).toBe("mesh-lowest-12");
    expect(mask.dilation).toBe(.05);
    expect(deriveFootContactMask([], 1).source).toBe("fallback-ellipse");
  });
  it("actually reorders layers and allows scenic layers to be removed", () => {
    const recipe = createBasePlateRecipe("pond");
    const decorationId = recipe.layers[2].id;
    const moved = reorderBasePlateLayer(recipe, decorationId, -1);
    expect(moved.layers.map((layer) => layer.id)).toEqual([recipe.layers[0].id, decorationId, recipe.layers[1].id, recipe.layers[3].id]);
    expect(moved.layers.map((layer) => layer.order)).toEqual([0, 1, 2, 3]);
    expect(removeBasePlateLayer(moved, decorationId).layers.some((layer) => layer.id === decorationId)).toBe(false);
    expect(removeBasePlateLayer(recipe, recipe.layers[0].id).layers[0].kind).toBe("plinth");
    expect(reorderBasePlateLayer(recipe, recipe.layers[0].id, 1).layers[0].kind).toBe("plinth");
  });
});
