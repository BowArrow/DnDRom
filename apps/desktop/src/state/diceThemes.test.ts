import { beforeEach, describe, expect, it } from "vitest";
import type { DiceTheme } from "../domain/types";
import { createStarterCampaign } from "../domain/seed";
import { useCampaignStore } from "./campaignStore";

const theme: DiceTheme = {
  id: "dice-theme-test",
  name: "Moonstone",
  description: "Blue moonstone resin",
  baseColor: "#315b87",
  numberColor: "#f4efdc",
  numberOutlineColor: "#101018",
  roughness: .2,
  metallic: .1,
  clearCoat: 1,
  clearCoatGloss: .95,
  normalStrength: .8,
  maps: { albedo: "sha256:albedo" },
  source: "painted",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

describe("campaign dice themes", () => {
  beforeEach(() => useCampaignStore.setState({ campaign: createStarterCampaign(), diceThemeLibrary: [] }));

  it("saves, assigns, and removes themes without touching roll authority", () => {
    useCampaignStore.getState().saveDiceTheme(theme);
    useCampaignStore.getState().assignDiceTheme(20, theme.id);
    expect(useCampaignStore.getState().campaign.diceThemes).toEqual([theme]);
    expect(useCampaignStore.getState().diceThemeLibrary).toEqual([theme]);
    expect(useCampaignStore.getState().campaign.diceThemeAssignments?.d20).toBe(theme.id);

    useCampaignStore.getState().removeDiceTheme(theme.id);
    expect(useCampaignStore.getState().campaign.diceThemes).toEqual([]);
    expect(useCampaignStore.getState().campaign.diceThemeAssignments?.d20).toBeUndefined();
  });

  it("autosaves reusable themes without requiring assignment", () => {
    useCampaignStore.getState().autosaveDiceTheme(theme);
    expect(useCampaignStore.getState().diceThemeLibrary).toEqual([theme]);
    expect(useCampaignStore.getState().campaign.diceThemes).toEqual([theme]);
    expect(useCampaignStore.getState().campaign.diceThemeAssignments?.d20).toBeUndefined();
  });
});
