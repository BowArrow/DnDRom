import { describe, expect, it } from "vitest";
import { generateMapFromPrompt } from "./mapGenerator";
import { isInteriorMap } from "./mapClassification";
import { createFallbackWorldBlueprints } from "./worldForge";
import type { GameMap } from "./types";

const bareMap = (theme: GameMap["theme"]): GameMap => ({
  id: "map", name: "Map", theme, width: 32, depth: 32, gridSize: 1,
  ambientColor: "#202020", entities: [],
});

describe("map classification", () => {
  it("recognizes legacy tavern and dungeon layouts without Forge metadata", () => {
    expect(isInteriorMap(generateMapFromPrompt("A warm roadside tavern"))).toBe(true);
    expect(isInteriorMap(generateMapFromPrompt("An underground dungeon"))).toBe(true);
  });

  it("lets an explicit exterior blueprint override an ambiguous theme", () => {
    const map = bareMap("ruins");
    const blueprint = createFallbackWorldBlueprints({ description: "An exterior ruined temple", seed: 17, size: "small", kind: "exterior", biome: "auto", mood: "natural", gridShape: "square", background: "none" })[0];
    map.generation = { blueprint, provider: "procedural", quality: "complete", revision: 16, generatedAt: new Date(0).toISOString() };
    expect(isInteriorMap(map)).toBe(false);
  });

  it("recognizes room metadata while leaving ordinary landscapes outside", () => {
    const room = bareMap("city");
    room.entities.push({ id: "floor", assetId: "floor-wood", name: "Room", position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, tags: ["room:a"] });
    expect(isInteriorMap(room)).toBe(true);
    expect(isInteriorMap(bareMap("forest"))).toBe(false);
  });
});
