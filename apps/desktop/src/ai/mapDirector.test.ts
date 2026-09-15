import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStarterCampaign } from "../domain/seed";
import { createFallbackWorldBlueprints, type WorldForgeRequest } from "../domain/worldForge";
import { generateWorldBlueprints } from "./mapDirector";

const mocks = vi.hoisted(() => ({ chat: vi.fn(), prepare: vi.fn() }));
vi.mock("./managedLanguage", () => ({ prepareLanguageSettings: mocks.prepare }));
vi.mock("./openAiClient", async importOriginal => ({ ...await importOriginal<object>(), completeLocalChat: mocks.chat }));
const request: WorldForgeRequest = { description: "An ancient Chinese mountain village", kind: "settlement", biome: "mountains", size: "medium", gridShape: "hex", seed: 42, background: "none" };
const settings = createStarterCampaign().settings;
const good = () => JSON.stringify({ concepts: createFallbackWorldBlueprints(request) });

describe("local world blueprint planning", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.prepare.mockResolvedValue({ ...settings, useLocalAiForMaps: true, localAiEndpoint: "http://127.0.0.1:8190/v1" });
  });
  it("constrains creative output and keeps engine dimensions, seeds and IDs local", async () => {
    const concepts = createFallbackWorldBlueprints(request);
    concepts[0].width = 64; concepts[0].seed = 9; concepts[0].id = "model-invented";
    concepts[0].name = "Jade terraces";
    mocks.chat.mockResolvedValue(JSON.stringify({ concepts }));
    const result = await generateWorldBlueprints(request, settings);
    expect(result.provider).toBe("local-ai");
    expect(result.blueprints[0]).toMatchObject({ name: "Jade terraces", width: 128, depth: 128, seed: 42, gridShape: "hex" });
    expect(result.blueprints[0].id).not.toBe("model-invented");
    expect(mocks.chat.mock.calls[0][0].responseSchema.properties.concepts.items.properties.name).toBeDefined();
    expect(mocks.chat.mock.calls[0][0].responseSchema.properties.concepts.items.properties.version).toBeUndefined();
  });
  it("repairs malformed model output instead of immediately abandoning AI", async () => {
    mocks.chat.mockResolvedValueOnce('{"concepts":[{}]}').mockResolvedValueOnce(good());
    const result = await generateWorldBlueprints(request, settings);
    expect(result.provider).toBe("local-ai");
    expect(mocks.chat).toHaveBeenCalledTimes(2);
    expect(mocks.chat.mock.calls[1][0].messages.at(-1).content).toContain("Repair");
  });
  it("builds connected zone references locally and repairs explicit constraint drift", async () => {
    const concepts = createFallbackWorldBlueprints(request);
    concepts[0].zones[0].requiredConnections = ["missing-zone"];
    mocks.chat.mockResolvedValueOnce(JSON.stringify({ concepts }));
    const result = await generateWorldBlueprints(request, settings);
    expect(result.provider).toBe("local-ai");
    const zones = result.blueprints[0].zones;
    const visited = new Set<string>();
    const visit = (id: string) => { if (visited.has(id)) return; visited.add(id); zones.find(zone => zone.id === id)!.requiredConnections.forEach(visit); };
    visit(zones[0].id);
    expect(visited.size).toBe(zones.length);
    concepts[0].kind = "interior";
    mocks.chat.mockResolvedValueOnce(JSON.stringify({ concepts })).mockResolvedValueOnce(good());
    expect((await generateWorldBlueprints(request, settings)).blueprints[0].kind).toBe("settlement");
    expect(mocks.chat).toHaveBeenCalledTimes(3);
  });
  it("fits an outlying AI layout uniformly while preserving relative positions", async () => {
    const concepts = createFallbackWorldBlueprints(request);
    concepts[0].zones[0].center.x = 200;
    concepts[0].zones[1].center.x = 100;
    mocks.chat.mockResolvedValue(JSON.stringify({ concepts }));
    const result = await generateWorldBlueprints(request, settings);
    expect(result.provider).toBe("local-ai");
    expect(result.blueprints[0].zones[0].center.x).toBe(62);
    expect(result.blueprints[0].zones[1].center.x).toBe(31);
    expect(mocks.chat).toHaveBeenCalledTimes(1);
  });
  it("bounds retry and shows a concise warning rather than raw schema errors", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.chat.mockResolvedValue('{"concepts":[{}]}');
    const result = await generateWorldBlueprints(request, settings);
    expect(mocks.chat).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe("procedural");
    expect(result.warning!.length).toBeLessThan(180);
    expect(result.warning).not.toContain("invalid_type");
    expect(warning).toHaveBeenCalled(); warning.mockRestore();
  });
  it("propagates cancellation without returning fallback or retrying", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(generateWorldBlueprints(request, settings, {}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.chat).not.toHaveBeenCalled();
  });
});
