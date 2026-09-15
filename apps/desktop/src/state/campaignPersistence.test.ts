import { beforeEach, describe, expect, it } from "vitest";
import { createStarterCampaign } from "../domain/seed";
import type { MapEntity, TokenAsset } from "../domain/types";
import { useCampaignStore } from "./campaignStore";
import { createBasePlateAsset, createBasePlateRecipe } from "../domain/baseplates";
import { compileWorldBlueprint, createFallbackWorldBlueprints, createSceneTemplate } from "../domain/worldForge";

const placed = (name: string): MapEntity => ({ id: crypto.randomUUID(), assetId: "crate", name, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
const token: TokenAsset = { id: "token-custom-test", name: "Goblin", kind: "enemy", storageKey: "sha256:test", filename: "goblin.glb", byteLength: 128, footprint: .55, modelScale: 1, modelLift: .62, defaultPlacementScale: 1, base: { shape: "round", color: "#111111", accentColor: "#aa2222", height: .14 }, source: "import", createdAt: "now", gameplayAuthority: "mesh-token" };

describe("campaign and scene persistence", () => {
  beforeEach(() => useCampaignStore.setState({ campaign: createStarterCampaign(), campaignLibrary: [], miniatureLibrary: [], diceThemeLibrary: [], propLibrary: [], materialLibrary: [], basePlateLibrary: [], sceneLibrary: [], selectedEntityId: null, activeAssetId: null }));

  it("snapshots the active campaign before creating and resuming another", () => {
    const firstId = useCampaignStore.getState().campaign.id;
    useCampaignStore.getState().addEntity(placed("Saved crate"));
    const second = useCampaignStore.getState().createCampaign("Second Quest");
    expect(second.name).toBe("Second Quest");
    expect(useCampaignStore.getState().switchCampaign(firstId)).toBe(true);
    expect(useCampaignStore.getState().campaign.map.entities.some((entity) => entity.name === "Saved crate")).toBe(true);
  });

  it("keeps maps and party membership independent across split scenes", () => {
    const firstScene = useCampaignStore.getState().campaign.activeSceneId!;
    const firstMap = useCampaignStore.getState().campaign.map;
    const characterId = useCampaignStore.getState().campaign.characters[0].id;
    useCampaignStore.getState().addEntity(placed("Only in scene one"));
    const second = useCampaignStore.getState().addScene("Other side of town", firstMap, [characterId], "Split party");
    useCampaignStore.getState().addEntity(placed("Only in scene two"));
    expect(useCampaignStore.getState().switchScene(firstScene)).toBe(true);
    expect(useCampaignStore.getState().campaign.map.entities.some((entity) => entity.name === "Only in scene one")).toBe(true);
    expect(useCampaignStore.getState().campaign.map.entities.some((entity) => entity.name === "Only in scene two")).toBe(false);
    expect(useCampaignStore.getState().switchScene(second.id)).toBe(true);
    expect(useCampaignStore.getState().campaign.map.entities.some((entity) => entity.name === "Only in scene two")).toBe(true);
  });

  it("keeps reusable miniature metadata global while sheet links stay campaign-specific", () => {
    const firstCharacter = useCampaignStore.getState().campaign.characters[0].id;
    useCampaignStore.getState().addTokenAsset(token);
    useCampaignStore.getState().linkTokenCharacter(token.id, firstCharacter);
    useCampaignStore.getState().createCampaign("Fresh sheets");
    expect(useCampaignStore.getState().miniatureLibrary).toContainEqual(token);
    expect(useCampaignStore.getState().campaign.tokenCharacterLinks?.[token.id]).toBeUndefined();
  });

  it("checkpoints a character catalogue revision without resetting the active scene", () => {
    const sceneEntity = placed("Keep this table");
    useCampaignStore.getState().addEntity(sceneEntity);
    useCampaignStore.getState().addTokenAsset(token);
    useCampaignStore.getState().addTokenAsset({ ...token, name: "Goblin revised", storageKey: "sha256:revision" });
    const state = useCampaignStore.getState();
    expect(state.campaign.map.entities).toContainEqual(sceneEntity);
    expect(state.miniatureLibrary.find((entry) => entry.id === token.id)).toMatchObject({ name: "Goblin revised", storageKey: "sha256:revision" });
  });

  it("adds and removes a library miniature per campaign without deleting the reusable model", () => {
    useCampaignStore.getState().addTokenAsset(token);
    useCampaignStore.getState().createCampaign("Library test");
    expect(useCampaignStore.getState().campaign.tokenAssets).toEqual([]);
    expect(useCampaignStore.getState().addTokenToCampaign(token.id)).toBe(true);
    expect(useCampaignStore.getState().campaign.tokenAssets).toContainEqual(token);
    useCampaignStore.getState().addEntity({ ...placed("Goblin copy"), assetId: token.id });
    expect(useCampaignStore.getState().removeTokenFromCampaign(token.id)).toBe(true);
    expect(useCampaignStore.getState().campaign.tokenAssets).toEqual([]);
    expect(useCampaignStore.getState().campaign.map.entities.some((entity) => entity.assetId === token.id)).toBe(false);
    expect(useCampaignStore.getState().miniatureLibrary).toContainEqual(token);
  });

  it("stores the world-space grid shape with its campaign map", () => {
    const firstCampaignId = useCampaignStore.getState().campaign.id;
    useCampaignStore.getState().updateMapGridShape("hex");
    expect(useCampaignStore.getState().campaign.map.gridShape).toBe("hex");
    useCampaignStore.getState().createCampaign("Square map");
    expect(useCampaignStore.getState().campaign.map.gridShape ?? "square").toBe("square");
    expect(useCampaignStore.getState().switchCampaign(firstCampaignId)).toBe(true);
    expect(useCampaignStore.getState().campaign.map.gridShape).toBe("hex");
  });

  it("keeps scenic bases reusable while scene assignments remain scene-specific", () => {
    useCampaignStore.getState().addTokenAsset(token);
    const asset = createBasePlateAsset("Frog pond", createBasePlateRecipe("pond"));
    useCampaignStore.getState().saveBasePlateAsset(asset);
    useCampaignStore.getState().assignTokenBasePlate(token.id, asset.id);
    expect(useCampaignStore.getState().miniatureLibrary.find((entry) => entry.id === token.id)?.defaultBasePlateAssetId).toBe(asset.id);
    useCampaignStore.getState().assignBasePlate("scene", `token:${token.id}`, asset.id);
    const activeScene = useCampaignStore.getState().campaign.scenes?.find((scene) => scene.id === useCampaignStore.getState().campaign.activeSceneId);
    expect(activeScene?.basePlateAssignments?.[`token:${token.id}`]).toBe(asset.id);
    expect(useCampaignStore.getState().removeBasePlateFromCampaign(asset.id)).toBe(true);
    expect(useCampaignStore.getState().basePlateLibrary.some((entry) => entry.id === asset.id)).toBe(true);
    expect(useCampaignStore.getState().campaign.basePlateAssignments?.[`token:${token.id}`]).toBeUndefined();
  });

  it("publishes generated worlds as new scenes and keeps catalogue copies reusable", () => {
    const originalSceneId = useCampaignStore.getState().campaign.activeSceneId!;
    const originalMap = useCampaignStore.getState().campaign.map;
    useCampaignStore.getState().addEntity(placed("Keep original scene"));
    const blueprint = createFallbackWorldBlueprints({ description: "A warm tavern interior", kind: "interior", biome: "forest", size: "small", gridShape: "square", mood: "warm", seed: 8021, background: "none" })[0];
    const generated = compileWorldBlueprint(blueprint).map;
    generated.id = "generated-map";
    generated.name = "Generated tavern";
    const template = createSceneTemplate(generated, "A generated swamp");
    useCampaignStore.getState().saveSceneTemplate(template);
    const created = useCampaignStore.getState().addScene(generated.name, generated, [], "Published from Scene Forge");
    expect(useCampaignStore.getState().campaign.activeSceneId).toBe(created.id);
    expect(useCampaignStore.getState().campaign.map.generation?.blueprint.kind).toBe("interior");
    expect(useCampaignStore.getState().campaign.map.world?.chunks.length).toBeGreaterThan(1);
    expect(useCampaignStore.getState().campaign.scenes?.find((scene) => scene.id === created.id)?.map.generation?.blueprint.id).toBe(blueprint.id);
    expect(useCampaignStore.getState().switchScene(originalSceneId)).toBe(true);
    expect(useCampaignStore.getState().campaign.map.entities.some((entry) => entry.name === "Keep original scene")).toBe(true);
    expect(useCampaignStore.getState().sceneLibrary).toContainEqual(expect.objectContaining({ id: template.id }));
    expect(useCampaignStore.getState().removeSceneTemplateFromCampaign(template.id)).toBe(true);
    expect(useCampaignStore.getState().sceneLibrary).toContainEqual(expect.objectContaining({ id: template.id }));
  });
});
