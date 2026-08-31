import { describe, expect, it } from "vitest";
import { generateMapFromPrompt } from "./mapGenerator";

describe("map generator", () => {
  it("detects tavern prompts", () => {
    const map = generateMapFromPrompt("A busy roadside tavern with a secret patron");
    expect(map.theme).toBe("tavern");
    expect(map.entities.some((entry) => entry.assetId === "table-round")).toBe(true);
  });

  it("adds threats to forest ambushes", () => {
    const map = generateMapFromPrompt("A moonlit forest ambush by bandits");
    expect(map.theme).toBe("forest");
    expect(map.entities.some((entry) => entry.assetId === "token-orc")).toBe(true);
  });

  it("is structurally deterministic for the same prompt", () => {
    const first = generateMapFromPrompt("Ancient ruined temple courtyard");
    const second = generateMapFromPrompt("Ancient ruined temple courtyard");
    expect(first.entities.map(({ id: _id, ...entry }) => entry)).toEqual(second.entities.map(({ id: _id, ...entry }) => entry));
  });

  it("builds low-object-count city, town, and landscape scenes", () => {
    const city = generateMapFromPrompt("A busy capital city market district");
    const town = generateMapFromPrompt("A fortified crossroads town");
    const coast = generateMapFromPrompt("A dangerous coastal road and harbor");
    expect(city.theme).toBe("city");
    expect(city.entities.some((entry) => entry.assetId === "house-large")).toBe(true);
    expect(town.theme).toBe("town");
    expect(town.entities.some((entry) => entry.assetId === "market-stall")).toBe(true);
    expect(coast.theme).toBe("coast");
    expect(coast.entities.some((entry) => entry.assetId === "water-tile")).toBe(true);
    expect(city.entities.length).toBeLessThan(100);
  });
});
