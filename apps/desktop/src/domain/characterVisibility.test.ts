import { describe, expect, it } from "vitest";
import { createDefaultCharacter } from "./seed";
import { canViewCharacterSheet, visibleCharacterSheets } from "./characterVisibility";

describe("character sheet visibility", () => {
  const player = { ...createDefaultCharacter(), id: "player", sheetVisibility: "players" as const };
  const boss = { ...createDefaultCharacter(), id: "boss", role: "boss" as const, sheetVisibility: "dm" as const };

  it("keeps DM-only sheets out of AI-DM player views", () => {
    expect(visibleCharacterSheets([player, boss], "play", "ai").map((entry) => entry.id)).toEqual(["player"]);
    expect(canViewCharacterSheet(boss, "play", "ai")).toBe(false);
  });

  it("lets a player DM inspect enemy and boss sheets", () => {
    expect(visibleCharacterSheets([player, boss], "play", "player")).toHaveLength(2);
    expect(canViewCharacterSheet(boss, "build", "ai")).toBe(true);
  });
});
