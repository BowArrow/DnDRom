import type { GameMap, LocationKind, MapEntity, MapTheme, PointOfInterest, Vec3, WorldLocation } from "./types";

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const randomFromSeed = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const entity = (assetId: string, name: string, x: number, z: number, rotationY = 0, scale = 1, y = 0): MapEntity => ({
  id: crypto.randomUUID(), assetId, name,
  position: { x, y, z }, rotation: { x: 0, y: rotationY, z: 0 }, scale: { x: scale, y: scale, z: scale },
});

const stretchedEntity = (assetId: string, name: string, x: number, z: number, scale: Vec3, rotationY = 0, y = 0): MapEntity => ({
  id: crypto.randomUUID(), assetId, name,
  position: { x, y, z }, rotation: { x: 0, y: rotationY, z: 0 }, scale,
});

const detectTheme = (prompt: string): MapTheme => {
  const value = prompt.toLowerCase();
  if (/capital|metropolis|city|district|urban/.test(value)) return "city";
  if (/town|market|crossroads/.test(value)) return "town";
  if (/village|hamlet|farmstead/.test(value)) return "village";
  if (/tavern|inn|pub|alehouse|banquet/.test(value)) return "tavern";
  if (/swamp|marsh|bog/.test(value)) return "swamp";
  if (/coast|beach|harbor|port|island/.test(value)) return "coast";
  if (/mountain|alpine|cliff|pass/.test(value)) return "mountains";
  if (/plain|grassland|steppe|road/.test(value)) return "plains";
  if (/forest|woods|grove|outdoor|camp/.test(value)) return "forest";
  if (/cave|cavern|mine|underground/.test(value)) return "cavern";
  if (/ruin|temple|castle|courtyard|crypt/.test(value)) return "ruins";
  return "dungeon";
};

const floorGrid = (assetId: string, width: number, depth: number): MapEntity[] => {
  const entities: MapEntity[] = [];
  for (let x = -width / 2 + 1; x < width / 2; x += 2) for (let z = -depth / 2 + 1; z < depth / 2; z += 2) entities.push(entity(assetId, "Floor", x, z));
  return entities;
};

const broadGround = (assetId: string, width: number, depth: number): MapEntity => stretchedEntity(assetId, "Terrain", 0, 0, { x: width / 2, y: 1, z: depth / 2 });

const tagInteriorShell = (entities: MapEntity[]): MapEntity[] => entities.map((entry) => ({
  ...entry,
  tags: [...new Set([...(entry.tags ?? []), "world:interior", /^(floor-)/.test(entry.assetId) ? "world:floor" : /^(wall-)/.test(entry.assetId) ? "world:wall" : "world:interior-prop"])],
}));

export const yawToward = (from: Pick<Vec3, "x" | "z">, target: Pick<Vec3, "x" | "z">): number => Math.atan2(target.x - from.x, target.z - from.z) * 180 / Math.PI;

const chairAt = (table: Pick<Vec3, "x" | "z">, offsetX: number, offsetZ: number): MapEntity => {
  const position = { x: table.x + offsetX, z: table.z + offsetZ };
  return entity("chair", "Chair", position.x, position.z, yawToward(position, table));
};

const perimeter = (assetId: string, width: number, depth: number, doorSide: "north" | "south" | "east" | "west" = "south"): MapEntity[] => {
  const entities: MapEntity[] = [];
  for (let x = -width / 2 + 1; x < width / 2; x += 2) {
    const northDoor = doorSide === "north" && Math.abs(x) < 1;
    const southDoor = doorSide === "south" && Math.abs(x) < 1;
    entities.push(entity(northDoor ? "door-wood" : assetId, northDoor ? "Door" : "Wall", x, depth / 2, 0));
    entities.push(entity(southDoor ? "door-wood" : assetId, southDoor ? "Door" : "Wall", x, -depth / 2, 180));
  }
  for (let z = -depth / 2 + 1; z < depth / 2; z += 2) {
    const westDoor = doorSide === "west" && Math.abs(z) < 1;
    const eastDoor = doorSide === "east" && Math.abs(z) < 1;
    entities.push(entity(westDoor ? "door-wood" : assetId, westDoor ? "Door" : "Wall", -width / 2, z, -90));
    entities.push(entity(eastDoor ? "door-wood" : assetId, eastDoor ? "Door" : "Wall", width / 2, z, 90));
  }
  return entities;
};

const attachPoiMarkers = (entities: MapEntity[], pois: PointOfInterest[] | undefined, width: number, depth: number, random: () => number): PointOfInterest[] => (pois ?? []).map((poi, index) => {
  const angle = (index / Math.max(1, pois?.length ?? 1)) * Math.PI * 2 + random() * 0.35;
  const radius = 4 + random() * Math.min(width, depth) * 0.3;
  const position = { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius };
  entities.push({ ...entity("poi-beacon", poi.name, position.x, position.z), notes: poi.description, tags: ["poi", ...poi.tags, ...poi.storyBeatIds] });
  return { ...poi, position };
});

function generateTavern(prompt: string, random: () => number, location?: WorldLocation): GameMap {
  const width = 18, depth = 14;
  const entities = [...floorGrid("floor-wood", width, depth), ...perimeter("wall-wood", width, depth), entity("table-long", "Bar", -6.4, 3.8, 90), entity("barrel", "Ale barrel", -7.5, 5.1), entity("chest", "Strongbox", -7.2, -4.8), entity("torch", "Hearth light", -8.2, 0, -90, 1, 0.5), entity("token-hero", "Adventurer", 0, -4)];
  for (const position of [{ x: -2.5, z: -1.8 }, { x: 2.7, z: -1.6 }, { x: -1, z: 3.4 }, { x: 4.6, z: 3.7 }]) {
    entities.push(entity("table-round", "Tavern table", position.x, position.z, random() * 30), chairAt(position, 1.25, 0), chairAt(position, -1.25, 0));
  }
  const pointsOfInterest = attachPoiMarkers(entities, location?.pointOfInterests, width, depth, random);
  return makeMap(location?.name ?? "The Lantern & Thorn", "tavern", width, depth, "#30271f", tagInteriorShell(entities), prompt, location, pointsOfInterest);
}

function generateSettlement(prompt: string, theme: "city" | "town" | "village", random: () => number, location?: WorldLocation): GameMap {
  const width = theme === "city" ? 52 : theme === "town" ? 42 : 32;
  const depth = theme === "city" ? 44 : theme === "town" ? 36 : 28;
  const entities: MapEntity[] = [broadGround("floor-grass", width, depth)];
  entities.push(stretchedEntity("road-dirt", "North Road", 0, 0, { x: 2.2, y: 1, z: depth / 4 }));
  entities.push(stretchedEntity("road-dirt", "Market Road", 0, 0, { x: 2.2, y: 1, z: width / 8 }, 90, .008));
  const buildingCount = theme === "city" ? 34 : theme === "town" ? 23 : 13;
  const blocks = [
    { minX: -width / 2 + 3, maxX: -4, minZ: -depth / 2 + 3, maxZ: -4 },
    { minX: 4, maxX: width / 2 - 3, minZ: -depth / 2 + 3, maxZ: -4 },
    { minX: -width / 2 + 3, maxX: -4, minZ: 4, maxZ: depth / 2 - 3 },
    { minX: 4, maxX: width / 2 - 3, minZ: 4, maxZ: depth / 2 - 3 },
  ];
  for (let index = 0; index < buildingCount; index += 1) {
    const block = blocks[index % blocks.length];
    const x = block.minX + random() * Math.max(1, block.maxX - block.minX);
    const z = block.minZ + random() * Math.max(1, block.maxZ - block.minZ);
    const major = index < (theme === "city" ? 5 : 2);
    entities.push(entity(major ? "house-large" : "house-small", major ? "Civic building" : "Home", x, z, random() > 0.5 ? 90 : 0, 0.75 + random() * 0.35));
  }
  const stalls = theme === "village" ? 3 : theme === "town" ? 6 : 9;
  for (let index = 0; index < stalls; index += 1) entities.push(entity("market-stall", "Market stall", -6 + index * 1.6, random() > 0.5 ? 2.8 : -2.8, random() > 0.5 ? 0 : 180, 0.75));
  for (let index = 0; index < 12; index += 1) entities.push(entity("tree-pine", "Street tree", (random() - 0.5) * (width - 5), (random() - 0.5) * (depth - 5), random() * 360, 0.45 + random() * 0.35));
  entities.push(entity("token-hero", "Adventurer", 0, -6), entity("campfire", "Market brazier", 0, 0));
  const pointsOfInterest = attachPoiMarkers(entities, location?.pointOfInterests, width, depth, random);
  return makeMap(location?.name ?? (theme === "city" ? "Asterfall" : theme === "town" ? "Briarwatch" : "Dunmere"), theme, width, depth, "#283027", entities, prompt, location, pointsOfInterest);
}

function generateLandscape(prompt: string, theme: "forest" | "plains" | "mountains" | "coast" | "swamp", random: () => number, location?: WorldLocation): GameMap {
  const width = 48, depth = 40;
  const ground = theme === "swamp" ? "floor-stone" : "floor-grass";
  const entities: MapEntity[] = [broadGround(ground, width, depth), stretchedEntity("road-dirt", "Travel road", 0, 0, { x: 1.5, y: 1, z: depth / 4 }, -18), entity("token-hero", "Adventurer", 0, -8)];
  if (theme === "coast" || theme === "swamp") {
    const waterCount = theme === "coast" ? 8 : 6;
    for (let index = 0; index < waterCount; index += 1) entities.push(stretchedEntity("water-tile", theme === "coast" ? "Coast" : "Marsh pool", theme === "coast" ? -19 + index * 5 : (random() - 0.5) * 30, theme === "coast" ? 12 : (random() - 0.5) * 25, { x: theme === "coast" ? 3 : 2 + random() * 2, y: 1, z: theme === "coast" ? 8 : 1 + random() * 2 }));
  }
  const treeCount = theme === "forest" ? 48 : theme === "swamp" ? 30 : 16;
  for (let index = 0; index < treeCount; index += 1) entities.push(entity(random() > (theme === "swamp" ? 0.55 : 0.12) ? "tree-pine" : "tree-dead", "Tree", (random() - 0.5) * 44, (random() - 0.5) * 36, random() * 360, 0.55 + random() * 0.65));
  const rocks = theme === "mountains" ? 42 : 18;
  for (let index = 0; index < rocks; index += 1) entities.push(entity("rock", theme === "mountains" ? "Crag" : "Rock", (random() - 0.5) * 44, (random() - 0.5) * 36, random() * 360, (theme === "mountains" ? 1 : 0.4) + random() * 1.5));
  if (theme === "plains") for (let index = 0; index < 12; index += 1) entities.push(entity("fence-wood", "Farm fence", -15 + index * 2, 11, 0));
  if (/ambush|bandit|raider|goblin|danger/.test(prompt.toLowerCase())) entities.push(entity("token-orc", "Hidden raider", 7, 4, -140), entity("token-orc", "Hidden raider", -8, 5, 130));
  const pointsOfInterest = attachPoiMarkers(entities, location?.pointOfInterests, width, depth, random);
  return makeMap(location?.name ?? `${theme[0].toUpperCase()}${theme.slice(1)} Expanse`, theme, width, depth, theme === "coast" ? "#243642" : theme === "swamp" ? "#28332b" : "#253328", entities, prompt, location, pointsOfInterest);
}

function generateDungeon(prompt: string, random: () => number, theme: "dungeon" | "cavern" | "ruins", location?: WorldLocation): GameMap {
  const width = theme === "cavern" ? 22 : 20, depth = 18;
  const entities = [...floorGrid("floor-stone", width, depth), ...perimeter("wall-stone", width, depth, "south"), entity("token-hero", "Adventurer", 0, -6), entity("chest", "Ancient chest", 6.4, 5.4, -25), entity("torch", "Torch", -8.7, -3.5, -90, 1, 0.6), entity("torch", "Torch", 8.7, 3.5, 90, 1, 0.6)];
  for (let x = -7; x <= 7; x += 2) entities.push(entity(Math.abs(x - 1) < 1 ? "door-wood" : "wall-stone", Math.abs(x - 1) < 1 ? "Inner door" : "Inner wall", x, -1));
  if (theme === "cavern") for (let index = 0; index < 18; index += 1) entities.push(entity("rock", "Cavern rock", (random() - 0.5) * 17, (random() - 0.5) * 14, random() * 360, 0.55 + random()));
  entities.push(theme === "ruins" ? entity("token-monster", "Ruins guardian", 0, 6.5, 180) : entity("token-orc", "Dungeon guard", 2.5, 4.8, 180));
  const pointsOfInterest = attachPoiMarkers(entities, location?.pointOfInterests, width, depth, random);
  return makeMap(location?.name ?? (theme === "cavern" ? "Echoing Cavern" : theme === "ruins" ? "Sunken Shrine" : "Ashen Vault"), theme, width, depth, theme === "cavern" ? "#242a2d" : "#282624", tagInteriorShell(entities), prompt, location, pointsOfInterest);
}

function makeMap(name: string, theme: MapTheme, width: number, depth: number, ambientColor: string, entities: MapEntity[], prompt: string, location?: WorldLocation, pointsOfInterest?: PointOfInterest[]): GameMap {
  return { id: crypto.randomUUID(), name: prompt.trim() ? name : `${name} Map`, theme, width, depth, gridSize: 1, ambientColor, entities, locationId: location?.id, pointsOfInterest };
}

export function generateLocationMap(location: WorldLocation, storyPrompt = ""): GameMap {
  const prompt = `${location.name} ${location.description} ${storyPrompt}`;
  const random = randomFromSeed(hashString(location.mapSeed));
  if (location.kind === "capital" || location.kind === "city") return generateSettlement(prompt, "city", random, location);
  if (location.kind === "town") return generateSettlement(prompt, "town", random, location);
  if (location.kind === "village") return generateSettlement(prompt, "village", random, location);
  if (["forest", "plains", "mountains", "coast", "swamp"].includes(location.biome)) return generateLandscape(prompt, location.biome as "forest" | "plains" | "mountains" | "coast" | "swamp", random, location);
  if (location.biome === "tavern") return generateTavern(prompt, random, location);
  return generateDungeon(prompt, random, (["dungeon", "cavern", "ruins"].includes(location.biome) ? location.biome : "dungeon") as "dungeon" | "cavern" | "ruins", location);
}

export function generateMapFromPrompt(prompt: string): GameMap {
  const normalized = prompt.trim() || "a compact dungeon with a guarded treasure room";
  const theme = detectTheme(normalized);
  const random = randomFromSeed(hashString(normalized));
  if (theme === "city" || theme === "town" || theme === "village") return generateSettlement(normalized, theme, random);
  if (["forest", "plains", "mountains", "coast", "swamp"].includes(theme)) return generateLandscape(normalized, theme as "forest" | "plains" | "mountains" | "coast" | "swamp", random);
  if (theme === "tavern") return generateTavern(normalized, random);
  return generateDungeon(normalized, random, (["dungeon", "cavern", "ruins"].includes(theme) ? theme : "dungeon") as "dungeon" | "cavern" | "ruins");
}

export const mapEntity = entity;
export const inferMapTheme = detectTheme;
export const locationKindForTheme = (theme: MapTheme): LocationKind => theme === "city" ? "city" : theme === "town" ? "town" : theme === "village" ? "village" : ["dungeon", "cavern", "ruins"].includes(theme) ? "dungeon" : "wilderness";
