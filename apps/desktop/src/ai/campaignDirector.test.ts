import { describe, expect, it } from "vitest";
import { createStoryFirstCampaign } from "./campaignDirector";
import { createStarterCampaign } from "../domain/seed";
import { generateLocationMap } from "../domain/mapGenerator";

describe("story-first campaign generation", () => {
  it("creates a complete linked arc before deriving the world", async () => {
    const settings = { ...createStarterCampaign().settings, localAiEndpoint: "" };
    const result = await createStoryFirstCampaign("A realm whose roads are disappearing", settings);
    expect(result.provider).toBe("procedural");
    expect(result.plan.acts.length).toBeGreaterThanOrEqual(3);
    expect(result.plan.beats.length).toBeGreaterThanOrEqual(6);
    expect(result.plan.finale.length).toBeGreaterThan(10);
    expect(result.world.locations.length).toBeGreaterThanOrEqual(6);
    expect(result.world.roads).toHaveLength(result.world.locations.length - 1);
    expect(result.plan.beats.every((beat) => beat.locationId && result.world.locations.some((location) => location.id === beat.locationId))).toBe(true);
  });

  it("turns story beats into map points of interest", async () => {
    const settings = { ...createStarterCampaign().settings, localAiEndpoint: "" };
    const result = await createStoryFirstCampaign("A complete mystery campaign", settings);
    const location = result.world.locations.find((entry) => entry.pointOfInterests.some((poi) => poi.storyBeatIds.length > 0))!;
    const map = generateLocationMap(location);
    expect(map.locationId).toBe(location.id);
    expect(map.pointsOfInterest?.some((poi) => poi.storyBeatIds.length > 0)).toBe(true);
    expect(map.entities.some((entry) => entry.tags?.includes("poi"))).toBe(true);
  });
});
