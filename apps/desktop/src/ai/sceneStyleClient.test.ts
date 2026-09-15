import { beforeEach, describe, expect, it, vi } from "vitest";
import { restyleScene } from "./sceneStyleClient";
import { createStarterCampaign } from "../domain/seed";
import type { GameMap } from "../domain/types";

const mocks = vi.hoisted(() => ({ image: vi.fn(), mesh: vi.fn(), material: vi.fn(), prop: vi.fn(), chat: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("./openAiClient", async (original) => ({ ...await original<typeof import("./openAiClient")>(), completeLocalChat: mocks.chat }));
vi.mock("./propImageClient", () => ({ generateLocalPropCandidate: mocks.image }));
vi.mock("./character3dClient", () => ({ generateCharacterGlb: mocks.mesh }));
vi.mock("./comfyWorkflowPreset", () => ({ loadBundledWorkflow: async () => ({}) }));
vi.mock("../domain/materialProcessing", () => ({ deriveMaterialMaps: async (file: File) => ({ albedo: file, normal: file, roughness: file, metallic: file, ambientOcclusion: file, seamScore: .01 }) }));
vi.mock("../persistence/materialAssets", () => ({ storeMaterialMap: mocks.material }));
vi.mock("../persistence/propAssets", () => ({ storePropModel: mocks.prop }));

describe("progressive local scene art pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    mocks.chat.mockResolvedValue(JSON.stringify({ materials: ["ground", "masonry", "timber", "roof", "foliage"].map((role) => ({ role, description: `Jade and ink ${role}`, materialClass: "general" })), props: [{ name: "Dragon", description: "Carved jade dragon", x: 0, z: 0, height: 2 }] }));
    mocks.image.mockResolvedValue(new File(["image"], "surface.png", { type: "image/png" }));
    mocks.material.mockImplementation(async () => `map:${crypto.randomUUID()}`);
    mocks.mesh.mockResolvedValue(new File(["glb"], "dragon.glb"));
    mocks.prop.mockResolvedValue({ id: "prop-dragon", bounds: { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } } });
  });
  it("publishes five distinct surface sets before importing the requested mesh", async () => {
    const campaign = createStarterCampaign(), previews: GameMap[] = [], material = vi.fn(), prop = vi.fn();
    const result = await restyleScene({ map: campaign.map, instruction: "Jade roofs and a dragon statue", references: [], settings: { ...campaign.settings, useLocalAiForMaps: true, localAiEndpoint: "http://127.0.0.1:11434/v1" }, signal: new AbortController().signal, saveMaterial: material, saveProp: prop, onPreview: (map) => previews.push(map), onProgress: () => {} });
    expect(material).toHaveBeenCalledTimes(5);
    expect(mocks.material).toHaveBeenCalledTimes(25);
    expect(new Set(material.mock.calls.map(([asset]) => asset.id)).size).toBe(5);
    expect(previews).toHaveLength(6);
    expect(previews[4].entities).toHaveLength(campaign.map.entities.length);
    expect(result.map.entities.at(-1)).toMatchObject({ assetId: "prop-dragon", position: { x: 0, y: 0, z: 0 } });
    expect(result.map.entities.slice(0, -1).map((entity) => entity.position)).toEqual(campaign.map.entities.map((entity) => entity.position));
    expect(mocks.image.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.mesh.mock.invocationCallOrder[0]);
    expect(prop).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/free"), expect.objectContaining({ method: "POST", body: JSON.stringify({ unload_models: true, free_memory: true }) }));
  });
  it("retains completed surfaces and stops before mesh generation when cancelled", async () => {
    const campaign = createStarterCampaign(), controller = new AbortController(), preview = vi.fn(), save = vi.fn();
    let images = 0;
    mocks.image.mockImplementation(async () => { if (++images === 2) controller.abort(); return new File(["image"], "surface.png", { type: "image/png" }); });
    await expect(restyleScene({ map: campaign.map, instruction: "Jade roofs", references: [], settings: { ...campaign.settings, useLocalAiForMaps: true }, signal: controller.signal, saveMaterial: save, saveProp: vi.fn(), onPreview: preview, onProgress: () => {} })).rejects.toMatchObject({ name: "AbortError" });
    expect(save).toHaveBeenCalledOnce(); expect(preview).toHaveBeenCalledOnce(); expect(mocks.mesh).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/free"), expect.objectContaining({ method: "POST" }));
  });
});
