import { afterEach, describe, expect, it, vi } from "vitest";
import { createStarterCampaign } from "../domain/seed";
import { createFallbackWorldBlueprints } from "../domain/worldForge";
import { generateWorldBlueprints } from "./mapDirector";

describe("World Forge AI planning boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends only the explicit request and bounded adventure context to the local planner", async () => {
    const request = { description: "A swamp village", kind: "settlement" as const, biome: "swamp" as const, size: "small" as const, gridShape: "square" as const, seed: 41, background: "none" as const };
    const concepts = createFallbackWorldBlueprints(request);
    const requests: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ concepts }) } }] }), { status: 200 });
    }));
    const settings = { ...createStarterCampaign().settings, useLocalAiForMaps: true, localAiEndpoint: "http://127.0.0.1:11434/v1" };
    const result = await generateWorldBlueprints(request, settings, {
      location: "Mirewatch", biome: "swamp", sceneTags: ["rain", "ruins"], partyFootprints: [.5, 1], recentResolvedEvents: ["The bell was recovered"],
      characterSheets: "PRIVATE SHEET", sourceArtwork: "PRIVATE IMAGE", campaignHistory: "PRIVATE HISTORY",
    } as never);
    expect(result.provider).toBe("local-ai");
    const body = JSON.parse(String(requests[0].body)) as { messages: Array<{ content: string }> };
    expect(body.messages[1].content).toContain("Mirewatch");
    expect(body.messages[1].content).toContain("The bell was recovered");
    expect(body.messages[1].content).not.toMatch(/PRIVATE SHEET|PRIVATE IMAGE|PRIVATE HISTORY/);
  });

  it("falls back deterministically when a local model returns invalid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), { status: 200 })));
    const settings = { ...createStarterCampaign().settings, useLocalAiForMaps: true, localAiEndpoint: "http://localhost:11434/v1" };
    const request = { description: "A mountain pass", kind: "auto" as const, size: "small" as const, gridShape: "hex" as const, seed: 99, background: "none" as const };
    const result = await generateWorldBlueprints(request, settings);
    expect(result.provider).toBe("procedural");
    expect(result.blueprints).toEqual(createFallbackWorldBlueprints(request));
  });
});
