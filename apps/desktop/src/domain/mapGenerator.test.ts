import { describe, expect, it } from "vitest";
import { generateMapFromPrompt, yawToward } from "./mapGenerator";

describe("map generator", () => {
  it("detects tavern prompts", () => {
    const map = generateMapFromPrompt("A busy roadside tavern with a secret patron");
    expect(map.theme).toBe("tavern");
    expect(map.entities.some((entry) => entry.assetId === "table-round")).toBe(true);
    const tables = map.entities.filter((entry) => entry.assetId === "table-round");
    const chairs = map.entities.filter((entry) => entry.assetId === "chair");
    for (const chair of chairs) {
      const nearest = tables.reduce((best, table) => Math.hypot(table.position.x - chair.position.x, table.position.z - chair.position.z) < Math.hypot(best.position.x - chair.position.x, best.position.z - chair.position.z) ? table : best);
      expect(chair.rotation.y).toBeCloseTo(yawToward(chair.position, nearest.position));
    }
  });

  it("orients perimeter walls inward and torches toward the room", () => {
    const map = generateMapFromPrompt("A busy roadside tavern with a secret patron");
    const north = map.entities.find((entry) => entry.assetId === "wall-wood" && entry.position.z === map.depth / 2);
    const south = map.entities.find((entry) => entry.assetId === "wall-wood" && entry.position.z === -map.depth / 2);
    const hearth = map.entities.find((entry) => entry.assetId === "torch");
    expect(north?.rotation.y).toBe(0);
    expect(south?.rotation.y).toBe(180);
    expect(hearth?.rotation.y).toBe(-90);
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
