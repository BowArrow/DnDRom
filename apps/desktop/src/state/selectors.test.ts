import { describe, expect, it } from "vitest";
import { createStarterCampaign } from "../domain/seed";
import { EMPTY_BASE_PLATE_ASSETS, EMPTY_MATERIAL_ASSETS, EMPTY_TOKEN_ASSETS, EMPTY_TOKEN_CHARACTER_LINKS, selectBasePlateAssets, selectMaterialAssets, selectTokenAssets, selectTokenCharacterLinks } from "./selectors";

describe("campaign selectors", () => {
  it("returns a stable empty token collection for legacy campaigns", () => {
    const campaign = createStarterCampaign();
    delete campaign.tokenAssets;
    const state = { campaign };
    expect(selectTokenAssets(state)).toBe(EMPTY_TOKEN_ASSETS);
    expect(selectTokenAssets(state)).toBe(selectTokenAssets(state));
  });
  it("returns a stable empty scenic-base collection for legacy campaigns", () => {
    const campaign = createStarterCampaign(); delete campaign.basePlateAssets;
    expect(selectBasePlateAssets({ campaign })).toBe(EMPTY_BASE_PLATE_ASSETS);
  });
  it("never allocates new selector fallbacks while React reads a legacy snapshot", () => {
    const campaign = createStarterCampaign();
    delete campaign.materialAssets;
    delete campaign.tokenCharacterLinks;
    expect(selectMaterialAssets({ campaign })).toBe(EMPTY_MATERIAL_ASSETS);
    expect(selectMaterialAssets({ campaign })).toBe(selectMaterialAssets({ campaign }));
    expect(selectTokenCharacterLinks({ campaign })).toBe(EMPTY_TOKEN_CHARACTER_LINKS);
    expect(selectTokenCharacterLinks({ campaign })).toBe(selectTokenCharacterLinks({ campaign }));
  });
});
