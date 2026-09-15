import { afterEach, describe, expect, it, vi } from "vitest";
import { directSceneComposition } from "./sceneDirector";
import { createFallbackWorldBlueprints } from "../domain/worldForge";
import { createStarterCampaign } from "../domain/seed";
import { planSceneStyle, sceneStylePlanSchema } from "./sceneStyleClient";
import { conditionPropWorkflow } from "./propImageClient";

const [blueprint] = createFallbackWorldBlueprints({ description: "An ancient Chinese village", kind: "auto", size: "small", gridShape: "square", seed: 42, background: "none" });
const settings = { ...createStarterCampaign().settings, useLocalAiForMaps: true, localAiEndpoint: "http://127.0.0.1:11434/v1" };
const composition = { design: "Timber columns and curved roofs", recipes: [{ id: "gate", name: "Ceremonial gate", parts: [{ shape: "roof", position: { x: 0, y: 3, z: 0 }, size: { x: 8, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, material: "roof", color: "#335544", curve: .65 }] }], buildingRecipeId: "gate", placements: [] };
describe("Local scene direction", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses model-authored geometry rather than inferring a cultural preset", async () => {
    const repaired = { ...composition.recipes[0], parts: [...composition.recipes[0].parts, { shape: "cylinder", position: { x: -4, y: 1.5, z: 0 }, size: { x: .2, y: 3, z: .2 }, rotation: { x: 0, y: 0, z: 0 }, material: "timber", color: "#804020", repeat: { count: 10, step: { x: .8, y: 0, z: 0 }, yaw: 0 } }] };
    let calls = 0;
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(calls++ ? repaired : composition) } }] })));
    vi.stubGlobal("fetch", fetch);
    const result = await directSceneComposition(blueprint, settings);
    expect(result.provider).toBe("local-ai");
    expect(result.blueprint.composition).toEqual({ ...composition, recipes: [repaired] });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).messages[1].content).toContain("An ancient Chinese village");
  });
  it("does not send scene content to a remote endpoint or turn cancellation into fallback", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await directSceneComposition(blueprint, { ...settings, localAiEndpoint: "https://remote.example/v1" })).provider).toBe("procedural");
    expect(fetch).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    await expect(directSceneComposition(blueprint, settings, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
  it("falls back visibly on invalid geometry, never executing model content", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: '{"recipes": "run code"}' } }] }))));
    const result = await directSceneComposition(blueprint, settings);
    expect(result.blueprint).toEqual(blueprint); expect(result.warning).toContain("could not be planned");
  });
  it("actually wires the local reference into the sampler while retaining the source graph", () => {
    const original = { "1": { class_type: "KSampler", inputs: { latent_image: ["2", 0], denoise: 1 } }, "2": { class_type: "VAEDecode", inputs: { vae: ["3", 0] } } };
    const result = conditionPropWorkflow(original, { name: "reference.png", subfolder: "input", type: "input" });
    expect(result["1"].inputs?.latent_image).not.toEqual(["2", 0]);
    expect(Object.values(result).some((node) => node.class_type === "LoadImage" && node.inputs?.image === "input/reference.png")).toBe(true);
    expect(original["1"].inputs.denoise).toBe(1);
  });
  it("keeps all surface roles distinct and transmits references only to the selected local model", async () => {
    const map = createStarterCampaign().map;
    const { plan } = await planSceneStyle(map, "jade tiles and painted wood", { ...settings, useLocalAiForMaps: false });
    expect(() => sceneStylePlanSchema.parse({ ...plan, materials: plan.materials.map((material) => ({ ...material, role: "roof" })) })).toThrow();
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] })));
    vi.stubGlobal("fetch", fetch);
    await planSceneStyle(map, "jade tiles", settings, [{ dataUrl: "data:image/png;base64,reference" }]);
    expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).messages[1].content[1].image_url.url).toContain("base64,reference");
  });
});
