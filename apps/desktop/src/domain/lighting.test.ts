import { describe, expect, it } from "vitest";
import { hemisphereAmbientCoefficients, LIGHTING_QUALITY_BUDGETS, prioritizeVisibleLights, resolveSceneLighting, shadowCoverageDistance, tabletopLightingProfile } from "./lighting";

describe("tabletop lighting profiles", () => {
  it("uses short, translucent overhead shadows for indoor maps", () => {
    const profile = tabletopLightingProfile("tavern", 20, 16);
    expect(profile.sunElevation).toBeGreaterThanOrEqual(70);
    expect(profile.shadowIntensity).toBeLessThanOrEqual(0.35);
    expect(profile.shadowIntensity).toBeGreaterThan(0);
    expect(profile.shadowDistance).toBeGreaterThan(Math.hypot(20, 16) * 2);
    expect(profile.shadowBias).toBeGreaterThanOrEqual(.24);
    expect(profile.normalOffsetBias).toBeGreaterThanOrEqual(.15);
  });

  it("keeps outdoor shadows readable without returning to solid black", () => {
    const indoor = tabletopLightingProfile("dungeon", 20, 20);
    const outdoor = tabletopLightingProfile("forest", 20, 20);
    expect(outdoor.shadowIntensity).toBeGreaterThan(indoor.shadowIntensity);
    expect(outdoor.shadowIntensity).toBeLessThan(0.6);
    expect(outdoor.shadowResolution).toBe(2048);
  });

  it("bounds the shadow camera for both tiny and very large maps", () => {
    expect(tabletopLightingProfile("city", 2, 2).shadowDistance).toBe(52);
    expect(tabletopLightingProfile("city", 200, 200).shadowDistance).toBe(96);
  });

  it("covers the full board diagonal before clamping to each quality budget", () => {
    expect(shadowCoverageDistance(20, 16, "balanced")).toBeGreaterThan(Math.hypot(20, 16) * 2);
    expect(shadowCoverageDistance(20, 16, "cinematic")).toBeGreaterThan(shadowCoverageDistance(20, 16, "balanced"));
    expect(shadowCoverageDistance(20, 16, "diorama")).toBeGreaterThan(shadowCoverageDistance(20, 16, "cinematic"));
  });

  it("layers mood and user intensities over the theme profile", () => {
    const profile = tabletopLightingProfile("tavern", 20, 20, { mood: "moonlight", keyIntensity: .5, rimIntensity: 1.2 });
    expect(profile.sunColor[2]).toBeGreaterThan(profile.sunColor[0]);
    expect(profile.sunIntensity).toBeCloseTo(.525);
    expect(profile.rimIntensity).toBeCloseTo(.504);
  });

  it("gives generated worlds a readable sun and sky floor", () => {
    const darkRequest = tabletopLightingProfile("forest", 128, 128, { mood: "natural", keyIntensity: 0, fillIntensity: 0 }, true);
    expect(darkRequest.sunIntensity).toBeGreaterThanOrEqual(1.48);
    expect(Math.min(...darkRequest.ambient)).toBeGreaterThanOrEqual(.15);
    expect(Math.min(...darkRequest.skyAmbient)).toBeGreaterThanOrEqual(.18);
    expect(darkRequest.shadowIntensity).toBeGreaterThanOrEqual(.86);
    expect(darkRequest.shadowDistance).toBeGreaterThan(Math.hypot(128, 128));
  });

  it("encodes a sky-to-ground hemisphere without a flat ambient wash", () => {
    const sky: [number, number, number] = [.2, .3, .4];
    const ground: [number, number, number] = [.1, .05, .02];
    const coefficients = hemisphereAmbientCoefficients(sky, ground);
    expect(Array.from(coefficients.slice(0, 3))).toEqual(expect.arrayContaining([expect.closeTo(.15), expect.closeTo(.175), expect.closeTo(.21)]));
    expect(Array.from(coefficients.slice(6, 9))).toEqual(expect.arrayContaining([expect.closeTo(.05), expect.closeTo(.125), expect.closeTo(.19)]));
    expect(Array.from(coefficients.slice(9))).toEqual(new Array(18).fill(0));
  });

  it("keeps dynamic light and post-process budgets bounded by quality", () => {
    expect(LIGHTING_QUALITY_BUDGETS.performance.dynamicLights).toBe(254);
    expect(LIGHTING_QUALITY_BUDGETS.balanced.dynamicLights).toBe(254);
    expect(LIGHTING_QUALITY_BUDGETS.cinematic.dynamicLights).toBe(254);
    expect(LIGHTING_QUALITY_BUDGETS.diorama.dynamicLights).toBe(254);
    expect(LIGHTING_QUALITY_BUDGETS.performance.maxLightsPerCell).toBe(6);
    expect(LIGHTING_QUALITY_BUDGETS.diorama.maxLightsPerCell).toBe(32);
    expect(LIGHTING_QUALITY_BUDGETS.performance.shadowedDynamicLights).toBe(0);
    expect(LIGHTING_QUALITY_BUDGETS.balanced.shadowedDynamicLights).toBe(0);
    expect(LIGHTING_QUALITY_BUDGETS.cinematic.shadowedDynamicLights).toBe(0);
    expect(LIGHTING_QUALITY_BUDGETS.diorama.shadowedDynamicLights).toBe(0);
    expect(LIGHTING_QUALITY_BUDGETS.balanced.shadowResolution).toBe(2048);
    expect(LIGHTING_QUALITY_BUDGETS.diorama.shadowResolution).toBe(4096);
    expect(resolveSceneLighting({ bloom: false }).ssao).toBe(true);
  });

  it("keeps unlimited authored lights while selecting the strongest visible cluster set", () => {
    const authored = Array.from({ length: 400 }, (_, index) => ({ id: index, relevance: index }));
    const rendered = prioritizeVisibleLights(authored, LIGHTING_QUALITY_BUDGETS.balanced.dynamicLights, (light) => light.relevance);
    expect(authored).toHaveLength(400);
    expect(rendered).toHaveLength(254);
    expect(rendered[0].id).toBe(399);
    expect(rendered.at(-1)?.id).toBe(146);
  });
});
