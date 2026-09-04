// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { diceTextureAiPrompt, inferDiceBodyColor } from "../rendering/diceTextureTemplate";
import { useCampaignStore } from "../state/campaignStore";
import { DiceForge } from "./DiceForge";

vi.mock("./DiceThemePreview", () => ({ DiceThemePreview: ({ sides }: { sides: number }) => <div data-testid="dice-preview">d{sides} preview</div> }));

describe("Dice Forge", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useCampaignStore.getState().resetCampaign();
  });

  it("exposes template, AI, PBR, preview, and per-die assignment workflows", async () => {
    render(<DiceForge onBack={vi.fn()} onNotify={vi.fn()} />);
    expect(screen.getByLabelText("Dice Forge")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download PNG template/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copy AI prompt/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Generate texture with local AI/i })).toBeTruthy();
    expect(screen.getByText("Custom PBR maps")).toBeTruthy();
    expect(screen.getByText("Albedo")).toBeTruthy();
    expect(screen.getByText("Normal")).toBeTruthy();
    expect(screen.getAllByText("Roughness").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Metallic").length).toBeGreaterThan(0);
    expect(screen.getByText("AO")).toBeTruthy();
    expect(screen.getByText("Energy mask")).toBeTruthy();
    expect(screen.getByText("Arcane effects")).toBeTruthy();
    expect(screen.getByLabelText("Describe dice effects")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Generate effects with local AI/i })).toBeTruthy();
    expect(screen.getByLabelText("Enable surface energy")).toBeTruthy();
    expect(screen.getByLabelText("Enable motion trail")).toBeTruthy();
    expect(screen.getByLabelText("Enable landing impact")).toBeTruthy();
    expect(screen.getByLabelText("Enable dice particles")).toBeTruthy();
    expect(screen.getByText("Particle system")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Preview roll effects/i })).toBeTruthy();
    expect(await screen.findByText("Theme saved automatically", {}, { timeout: 1_000 })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /Dice catalogue/i })[0]);
    expect(screen.getByRole("dialog", { name: "Dice set catalogue" })).toBeTruthy();
    expect(screen.getByPlaceholderText("Search dice sets, materials, or effects")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open in editor/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Close Dice set catalogue/i }));
    fireEvent.click(screen.getByRole("button", { name: "d6" }));
    expect(screen.getByTestId("dice-preview").textContent).toContain("d6");
    expect(screen.getByRole("button", { name: /Use this theme for d6/i })).toBeTruthy();
  });

  it("builds a cloud-safe surface prompt without asking the model to render dice", () => {
    const prompt = diceTextureAiPrompt("blue glass with silver flakes", "#e986b8");
    expect(prompt).toContain("blue glass with silver flakes");
    expect(prompt).toContain("2:1 tiled PBR albedo texture");
    expect(prompt).toContain("not a rendered die");
    expect(prompt).toContain("dominant body and background color is #e986b8");
    expect(prompt).toContain("DnDRom can derive editable normal");
  });

  it("uses a color named in the material description instead of the untouched emerald default", () => {
    expect(inferDiceBodyColor("Pink repeating hearts and roses with pink enchantment", "#167f72")).toBe("#e986b8");
    expect(inferDiceBodyColor("Glassy cyan resin", "#167f72")).toBe("#35c7d4");
    expect(inferDiceBodyColor("Smoky clear resin", "#167f72")).toBe("#167f72");
  });
});
