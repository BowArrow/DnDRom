import { generateCgaBuilding } from "./worldArchitecture";
import { describe, expect, it } from "vitest";
import { createStarterCampaign } from "./seed";
import { worldBlueprintSchema } from "./worldForge";
import { finalizeSettlementMap, finalizeTravelMap, travelBlueprint } from "./travelWorld";
import { regionalElevation } from "./worldGeography";
import type { WorldPlan } from "./types";

const world: WorldPlan = { id: "realm", name: "Borderlands", seed: "mountain-pass", widthMiles: 120, depthMiles: 120, summary: "A forest village below snowy mountain ruins", roads: [{ id: "road", name: "Old road", fromLocationId: "village", toLocationId: "ruins", danger: .2 }], locations: [
  { id: "village", name: "Pine Hollow", kind: "village", biome: "forest", position: { x: -24, z: 0 }, description: "A timber village", storyBeatIds: ["quest"], mapSeed: "village", pointOfInterests: [{ id: "npc", name: "Missing courier", description: "Ask the innkeeper about the missing courier", kind: "story", discovered: true, position: { x: 0, y: 0, z: 0 }, storyBeatIds: ["quest"], tags: ["social"] }] },
  { id: "ruins", name: "High Watch", kind: "dungeon", biome: "mountains", position: { x: 32, z: -20 }, description: "Mountain fortress ruins", storyBeatIds: [], mapSeed: "ruins", pointOfInterests: [] },
] };
describe("linked travel and detailed geography", () => {
  it("shares location IDs, biome authority and roads with the story world", () => {
    const blueprint = worldBlueprintSchema.parse(travelBlueprint(world));
    expect(blueprint.zones.map(zone => zone.id)).toEqual(["village", "ruins"]);
    expect(blueprint.zones[0].requiredConnections).toEqual(["ruins"]);
    expect(new Set(blueprint.biomeRegions?.map(region => region.biome.id))).toEqual(new Set(["forest", "mountains"]));
    const mountain = blueprint.biomeRegions![1];
    expect(regionalElevation(blueprint.biomeRegions!, mountain.x, mountain.z)).toBeGreaterThan(20);
  });
  it("creates compact linked clusters and keeps quest identity inside detailed buildings", () => {
    const map = createStarterCampaign().map;
    const travel = finalizeTravelMap({...map,width:256,depth:256}, world);
    const sites = travel.entities.filter(entity => entity.tags?.includes("world:travel-site"));
    expect(sites).toHaveLength(2);
    expect(sites[0].worldGeometry?.kind === "assembly" && sites[0].worldGeometry.parts.length).toBeGreaterThan(10);
    const detail = finalizeSettlementMap({ ...map, entities: [{...sites[0], worldGeometry:generateCgaBuilding(71)}] }, world.locations[0], world);
    expect(detail.locationId).toBe("village");
    expect(detail.journey?.origin).toEqual({ x: -51.2, z: 0 });
    expect(detail.journey?.interiors?.[0].pointOfInterestIds).toEqual(["npc"]);
    expect(detail.pointsOfInterest?.[0].storyBeatIds).toEqual(["quest"]);
  });
});
