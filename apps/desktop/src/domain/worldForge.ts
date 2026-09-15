import { worldWeatherSchema, weatherFromDescription } from "./worldWeather";
import {siteIntentSchema,worldSiteSchema,inferSiteIntent,selectWorldSite,prepareWorldSite} from "./worldSite";
import { z } from "zod";
import { biomeAt } from "./worldGeography";
import { DEFAULT_SCENE_LIGHTING } from "./lighting";

export const WORLD_GENERATOR_REVISION = 23;
import { fieldPlacementSurface, placeOnDryGround } from "./worldPlacement";
import { inferMapTheme } from "./mapGenerator";
import type {
  GameMap,
  LightingMood,
  MapEntity,
  MapTheme,
  SceneTemplateAsset,
  WorldAssetRequest,
  WorldBiomeSpec,
  WorldBlueprintV1,
  WorldChunkDescriptor,
  WorldRegionKind,
  WorldRegionSize,
  WorldValidationReport,
  WorldZone,
} from "./types";
import { buildAnisotropicRoadNetwork, buildNavigationGrid, buildWorldFieldSet, cornerCutPolyline, createHeightfield, distanceToSegment, generateBspRooms, gradeWorldFieldRoads, noiseWeightedPoissonPoints, sampleCatmullRomSpline, sampleTerrainHeight, sampleWorldField, simplexNoise2D, simplifyPolyline, terrainGeometryForChunk, terrainNoise } from "./worldProcedural";
import { generateCgaBuilding, generateSpaceColonizedTree } from "./worldArchitecture";
import { WORLD_VISUAL_CONFIG } from "./worldVisualConfig";
import { denseGroundCoverPoints, scatterVariation } from "./worldScatter";
import {sampleSharedClimate,worldForestCandidates} from './worldClimate';
import {worldClearing} from './sharedWorld';
import { expandSceneRecipe, sceneCompositionSchema, sceneRecipeBounds } from "./sceneGrammar";

export const WORLD_CHUNK_SIZE = 16 as const;
export const WORLD_REGION_METERS: Record<WorldRegionSize, 64 | 128 | 256> = { small: 64, medium: 128, large: 256 };
export const MAX_WORLD_REPAIR_PASSES = 3;
export const MAX_SCENE_TEMPLATE_REVISIONS = 8;

const paletteSchema = z.object({ ground: z.string(), accent: z.string(), water: z.string() });
const regionalBiomeSchema = z.object({ id: z.enum(["forest", "plains", "mountains", "coast", "swamp", "desert", "snow", "urban", "dungeon", "cavern"]), vegetationDensity: z.number().min(0).max(1), treeStyle: z.enum(["pine", "dead", "broadleaf", "cypress", "none"]), palette: paletteSchema });
const zoneSchema = z.object({
  id: z.string().min(1).max(80), name: z.string().min(1).max(100),
  purpose: z.enum(["entry", "encounter", "landmark", "settlement", "wilderness", "interior", "secret", "exit"]),
  center: z.object({ x: z.number(), y: z.number(), z: z.number() }), radius: z.number().min(2).max(80),
  requiredConnections: z.array(z.string()).max(12),
});
const assetRequestSchema = z.object({
  id: z.string().min(1).max(80), name: z.string().min(1).max(100),
  category: z.enum(["architecture", "furniture", "nature", "tokens", "effects"]),
  description: z.string().max(500), importance: z.enum(["structural", "repeated", "hero"]),
  resolvedAssetId: z.string().optional(), status: z.enum(["resolved", "placeholder", "pending-review", "approved"]),
});

export const worldBlueprintFields = z.object({
  siteIntent:siteIntentSchema.optional(),site:worldSiteSchema.optional(),
  weather: worldWeatherSchema.optional(),
  version: z.literal(1), id: z.string().min(1), name: z.string().min(1).max(100), description: z.string().min(1).max(2_000),
  seed: z.number().int().min(0).max(2_147_483_647), kind: z.enum(["interior", "exterior", "settlement", "dungeon"]),
  size: z.enum(["small", "medium", "large"]), width: z.union([z.literal(64), z.literal(128), z.literal(256)]),
  depth: z.union([z.literal(64), z.literal(128), z.literal(256)]), chunkSize: z.literal(16), gridShape: z.enum(["square", "hex"]),
  theme: z.enum(["dungeon", "tavern", "forest", "ruins", "cavern", "city", "town", "village", "plains", "mountains", "coast", "swamp"]),
  mood: z.enum(["natural", "warm", "moonlight", "crypt", "desert"]),
  biome: z.object({ id: z.enum(["forest", "plains", "mountains", "coast", "swamp", "desert", "snow", "urban", "dungeon", "cavern"]), vegetationDensity: z.number().min(0).max(1), treeStyle: z.enum(["pine", "dead", "broadleaf", "cypress", "none"]), palette: paletteSchema }),
  terrain: z.object({ baseHeight: z.number().min(-10).max(30), relief: z.number().min(0).max(12), roughness: z.number().min(0).max(1), erosion: z.number().min(0).max(1), moisture: z.number().min(0).max(1), waterLevel: z.number().min(-10).max(30).optional(), roadMaterial: z.enum(["stone", "wood", "dirt"]) }),
  biomeRegions: z.array(z.object({ id: z.string(), biome: regionalBiomeSchema, x: z.number().min(-1024).max(1024), z: z.number().min(-1024).max(1024), radius: z.number().min(1).max(1024), elevation: z.number().min(-10).max(60) })).max(32).optional(),
  zones: z.array(zoneSchema).min(2).max(24), assetRequests: z.array(assetRequestSchema).max(24),
  architecture: z.object({ material: z.enum(["timber", "stone"]), ruin: z.number().min(0).max(1), density: z.number().min(.2).max(1) }).optional(),
  composition: sceneCompositionSchema.optional(),
  presentation: z.object({ background: z.enum(["none", "panorama", "splat"]), prompt: z.string().max(2_000) }),
});

export const worldBlueprintSchema: z.ZodType<WorldBlueprintV1> = worldBlueprintFields.superRefine((value, context) => {
  const expected = WORLD_REGION_METERS[value.size];
  if (value.width !== expected || value.depth !== expected) context.addIssue({ code: "custom", path: ["size"], message: "Region dimensions must match its size preset" });
  const zoneIds = new Set(value.zones.map((zone) => zone.id));
  if (zoneIds.size !== value.zones.length) context.addIssue({ code: "custom", path: ["zones"], message: "Zone IDs must be unique" });
  for (const zone of value.zones) if (Math.abs(zone.center.x) > value.width / 2 - 2 || Math.abs(zone.center.z) > value.depth / 2 - 2) context.addIssue({ code: "custom", path: ["zones"], message: "Zone centers must lie inside the region" });
  for (const zone of value.zones) for (const connection of zone.requiredConnections) if (!zoneIds.has(connection)) context.addIssue({ code: "custom", path: ["zones"], message: `Unknown zone connection ${connection}` });
});

export interface WorldForgeRequest {
  description: string;
  kind: WorldRegionKind | "auto";
  biome?: WorldBiomeSpec["id"] | "auto";
  size: WorldRegionSize;
  gridShape: "square" | "hex";
  mood?: LightingMood;
  seed: number;
  background: "none" | "panorama" | "splat";
}

export interface CompiledWorld {
  map: GameMap;
  blueprint: WorldBlueprintV1;
  validation: WorldValidationReport;
}

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
};

const stableId = (prefix: string, seed: number, index = 0): string => `${prefix}-${(hashString(`${seed}:${prefix}:${index}`) >>> 0).toString(36)}`;
const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));
const smooth = (value: number): number => value * value * (3 - 2 * value);
const lattice = (x: number, z: number, seed: number): number => {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * .013) * 43758.5453123;
  return value - Math.floor(value);
};
const valueNoise = (x: number, z: number, seed: number): number => {
  const x0 = Math.floor(x), z0 = Math.floor(z), tx = smooth(x - x0), tz = smooth(z - z0);
  const a = lattice(x0, z0, seed), b = lattice(x0 + 1, z0, seed), c = lattice(x0, z0 + 1, seed), d = lattice(x0 + 1, z0 + 1, seed);
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz;
};
export const fractalWorldNoise = terrainNoise;

const inferKind = (description: string, theme: MapTheme): WorldRegionKind => /dungeon|crypt|cave|catacomb|vault/i.test(description) ? "dungeon"
  : /town|city|village|settlement|market/i.test(description) || ["city", "town", "village"].includes(theme) ? "settlement"
    : /inn|tavern|room|hall|interior|castle/i.test(description) ? "interior" : "exterior";

const biomeFor = (theme: MapTheme, description: string): WorldBiomeSpec => {
  // Setting and subject are independent: a forest village is still woodland.
  if (/\b(forest|woodland|woods|jungle)\b/i.test(description) && !/\b(snow|frozen|arctic)\b/i.test(description)) return { id: "forest", vegetationDensity: /deep|dense|ancient|overgrown/i.test(description) ? .9 : .72, treeStyle: /pine|conifer/i.test(description) ? "pine" : "broadleaf", palette: { ground: "#3f5d3f", accent: "#78905d", water: "#355d66" } };
  if (/snow|frozen|ice|arctic/i.test(description)) return { id: "snow", vegetationDensity: .18, treeStyle: "pine", palette: { ground: "#b9c8ca", accent: "#6f8790", water: "#496b78" } };
  if (/desert|dune|sand/i.test(description)) return { id: "desert", vegetationDensity: .06, treeStyle: "none", palette: { ground: "#a67a48", accent: "#d4b173", water: "#397b84" } };
  if (theme === "swamp") return { id: "swamp", vegetationDensity: .72, treeStyle: "cypress", palette: { ground: "#334b35", accent: "#718454", water: "#263f3a" } };
  if (theme === "mountains") return { id: "mountains", vegetationDensity: .24, treeStyle: "pine", palette: { ground: "#5a5b55", accent: "#94917e", water: "#334f68" } };
  if (theme === "coast") return { id: "coast", vegetationDensity: .2, treeStyle: "broadleaf", palette: { ground: "#8d7954", accent: "#d0b875", water: "#315f73" } };
  if (["city", "town", "village", "tavern"].includes(theme)) return { id: "urban", vegetationDensity: .16, treeStyle: "broadleaf", palette: { ground: "#6c655a", accent: "#967553", water: "#365c67" } };
  if (["dungeon", "ruins"].includes(theme)) return { id: "dungeon", vegetationDensity: theme === "ruins" ? .25 : 0, treeStyle: theme === "ruins" ? "dead" : "none", palette: { ground: "#555450", accent: "#77766e", water: "#293d42" } };
  if (theme === "cavern") return { id: "cavern", vegetationDensity: .08, treeStyle: "none", palette: { ground: "#3f4142", accent: "#657176", water: "#243b45" } };
  return { id: theme === "plains" ? "plains" : "forest", vegetationDensity: theme === "plains" ? .28 : .62, treeStyle: theme === "plains" ? "broadleaf" : "pine", palette: { ground: "#466244", accent: "#77905d", water: "#365c67" } };
};

const explicitBiome = (id: WorldBiomeSpec["id"], fallback: WorldBiomeSpec): WorldBiomeSpec => {
  const presets: Record<WorldBiomeSpec["id"], WorldBiomeSpec> = {
    forest: { id: "forest", vegetationDensity: .68, treeStyle: "broadleaf", palette: { ground: "#3f5d3f", accent: "#78905d", water: "#355d66" } },
    plains: { id: "plains", vegetationDensity: .3, treeStyle: "broadleaf", palette: { ground: "#637648", accent: "#9ca567", water: "#3e6771" } },
    mountains: { id: "mountains", vegetationDensity: .22, treeStyle: "pine", palette: { ground: "#5a5b55", accent: "#94917e", water: "#334f68" } },
    coast: { id: "coast", vegetationDensity: .2, treeStyle: "broadleaf", palette: { ground: "#8d7954", accent: "#d0b875", water: "#315f73" } },
    swamp: { id: "swamp", vegetationDensity: .72, treeStyle: "cypress", palette: { ground: "#334b35", accent: "#718454", water: "#263f3a" } },
    desert: { id: "desert", vegetationDensity: .06, treeStyle: "none", palette: { ground: "#a67a48", accent: "#d4b173", water: "#397b84" } },
    snow: { id: "snow", vegetationDensity: .18, treeStyle: "pine", palette: { ground: "#b9c8ca", accent: "#6f8790", water: "#496b78" } },
    urban: { id: "urban", vegetationDensity: .14, treeStyle: "broadleaf", palette: { ground: "#6c655a", accent: "#967553", water: "#365c67" } },
    dungeon: { id: "dungeon", vegetationDensity: 0, treeStyle: "none", palette: { ground: "#555450", accent: "#77766e", water: "#293d42" } },
    cavern: { id: "cavern", vegetationDensity: .08, treeStyle: "none", palette: { ground: "#3f4142", accent: "#657176", water: "#243b45" } },
  };
  return presets[id] ?? fallback;
};

const moodFor = (description: string, fallback: LightingMood = "natural"): LightingMood => /moon|night|starlight/i.test(description) ? "moonlight"
  : /crypt|haunted|necrotic/i.test(description) ? "crypt"
    : /desert|\bsun\b|dune/i.test(description) ? "desert"
      : /warm|tavern|fire|cozy|inn/i.test(description) ? "warm" : fallback;

const titleFor = (description: string, index: number): string => {
  const words = description.replace(/[^a-z0-9' -]/gi, " ").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  const base = words.length ? words.map((word) => word[0].toUpperCase() + word.slice(1)).join(" ") : "Untitled Region";
  return index === 0 ? base : `${base} Â· Alternate`;
};

const zonesFor = (size: number, kind: WorldRegionKind, seed: number): WorldZone[] => {
  const extent = size * .34;
  const purposes: WorldZone["purpose"][] = kind === "settlement" ? ["entry", "settlement", "landmark", "encounter", "exit"]
    : kind === "interior" || kind === "dungeon" ? ["entry", "interior", "encounter", "secret", "exit"]
      : ["entry", "wilderness", "landmark", "encounter", "exit"];
  // A hierarchy-aware main spine prevents the fallback generator from asking
  // A* to connect arbitrary zig-zag points. The cost field may still bend the
  // alignment around terrain, but the authored intent remains legible.
  const points = [[-extent, -extent * .82], [-extent * .48, -extent * .38], [0, -extent * .08], [extent * .5, extent * .34], [extent, extent * .82]];
  return purposes.map((purpose, index) => ({
    id: stableId("zone", seed, index), name: `${purpose[0].toUpperCase()}${purpose.slice(1)} ${index + 1}`, purpose,
    center: { x: points[index][0], y: 0, z: points[index][1] }, radius: Math.max(5, size * (purpose === "settlement" || purpose === "wilderness" ? .14 : .09)),
    requiredConnections: index === 0 ? [stableId("zone", seed, 1)] : index === purposes.length - 1 ? [stableId("zone", seed, index - 1)] : [stableId("zone", seed, index - 1), stableId("zone", seed, index + 1)],
  }));
};

const defaultAssetRequests = (kind: WorldRegionKind, description: string, seed: number): WorldAssetRequest[] => [
  { id: stableId("asset", seed, 0), name: kind === "settlement" ? "Regional landmark" : "Scenic landmark", category: "architecture", description: `Distinctive centerpiece for ${description}`, importance: "hero", status: "placeholder" },
  { id: stableId("asset", seed, 1), name: "Regional surface", category: "architecture", description: `Seamless ground and wall materials for ${description}`, importance: "repeated", status: "placeholder" },
];

export function createFallbackWorldBlueprints(request: WorldForgeRequest): [WorldBlueprintV1, WorldBlueprintV1] {
  const description = request.description.trim() || "A playable wilderness region with a landmark and branching paths";
  const theme = inferMapTheme(description);
  const size = WORLD_REGION_METERS[request.size];
  const make = (index: number): WorldBlueprintV1 => {
    const seed = (request.seed + index * 104729) & 0x7fffffff;
    const kind = request.kind === "auto" ? inferKind(description, theme) : request.kind;
    const inferredBiome = biomeFor(theme, description);
    const biome = request.biome && request.biome !== "auto" ? explicitBiome(request.biome, inferredBiome) : inferredBiome;
    return worldBlueprintSchema.parse({
      version: 1, id: stableId("blueprint", seed), name: titleFor(description, index), description, seed, kind,
      size: request.size, width: size, depth: size, chunkSize: WORLD_CHUNK_SIZE, gridShape: request.gridShape,
      theme, mood: moodFor(description, request.mood), biome: index === 0 ? biome : { ...biome, vegetationDensity: clamp(biome.vegetationDensity * .72 + .12, 0, 1) },
      siteIntent:inferSiteIntent(description,biome.id),
      terrain: { baseHeight: 0, relief: kind === "interior" || kind === "dungeon" ? 0 : theme === "mountains" ? 10.5 : biome.id === "desert" ? 7.5 : theme === "swamp" ? 5.2 : theme === "coast" ? 4.8 : biome.id === "plains" ? 5.2 : 6.4, roughness: index === 0 ? .54 : .68, erosion: .48, moisture: biome.id === "swamp" || biome.id === "coast" ? .85 : biome.id === "desert" ? .08 : .42, waterLevel: biome.id === "swamp" || biome.id === "coast" ? .25 : undefined, roadMaterial: biome.id === "swamp" ? "wood" : kind === "settlement" ? "stone" : "dirt" },
      zones: zonesFor(size, kind, seed), assetRequests: defaultAssetRequests(kind, description, seed),
      architecture: { material: /stone|gothic|citadel|fortress|ruin/i.test(description) ? "stone" : "timber", ruin: /\b(ruined|abandoned|shattered|destroyed|ruins)\b/i.test(description) ? .72 : 0, density: /city|capital|dense town/i.test(description) ? 1 : .6 },
      presentation: { background: request.background, prompt: `${description}. Distant environment only, clear navigable foreground, coherent horizon.` },
    });
  };
  return [make(0), make(1)];
}

const entity = (blueprint: WorldBlueprintV1, chunkId: string, index: number, assetId: string, name: string, x: number, y: number, z: number, scale: number | { x: number; y: number; z: number } = 1, rotationY = 0, tags: string[] = []): MapEntity => ({
  id: stableId(`${chunkId}-${assetId}`, blueprint.seed, index), chunkId, assetId, name,
  position: { x, y, z }, rotation: { x: 0, y: rotationY, z: 0 }, scale: typeof scale === "number" ? { x: scale, y: scale, z: scale } : scale, tags,
});

const terrainAsset = (blueprint: WorldBlueprintV1): string => blueprint.kind === "interior" || blueprint.kind === "dungeon" ? (blueprint.theme === "tavern" ? "floor-wood" : "floor-stone")
  : blueprint.biome.id === "urban" || blueprint.biome.id === "dungeon" ? "floor-stone" : "floor-grass";
const treeAsset = (biome: WorldBiomeSpec, variation = 0): string => biome.treeStyle === "dead" ? "tree-dead"
  : biome.treeStyle === "broadleaf" ? (variation > .62 ? "tree-broadleaf-young" : "tree-broadleaf")
    : biome.treeStyle === "cypress" ? "tree-cypress" : variation > .72 ? "tree-pine-young" : "tree-pine";

const simplifyRibbonControls = <T extends { x: number; y: number; z: number; width: number }>(points: T[], tolerance = .72): T[] => {
  if (points.length <= 2) return points;
  const keep = new Set<number>([0, points.length - 1]), pending: Array<[number, number]> = [[0, points.length - 1]];
  while (pending.length) {
    const [start, finish] = pending.pop()!, a = points[start], b = points[finish];
    let farthest = -1, maximum = tolerance;
    for (let index = start + 1; index < finish; index++) {
      const distance = distanceToSegment(points[index].x, points[index].z, a.x, a.z, b.x, b.z);
      if (distance > maximum) { maximum = distance; farthest = index; }
    }
    if (farthest < 0) continue;
    keep.add(farthest); pending.push([start, farthest], [farthest, finish]);
  }
  return [...keep].sort((left, right) => left - right).map((index) => points[index]);
};

/** Chaikin corner cutting in all ribbon channels. Applying this before the
 * interpolating spline prevents Catmull-Rom overshoot from folding a sharp D8
 * drainage turn back across itself. */
const cornerCutRibbon = <T extends { x: number; y: number; z: number; width: number }>(points: T[], iterations = 2): T[] => {
  if (points.length < 3) return points;
  let output = points.map((point) => ({ ...point }));
  const interpolate = (a: T, b: T, amount: number): T => ({
    ...a,
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
    z: a.z + (b.z - a.z) * amount,
    width: a.width + (b.width - a.width) * amount,
  });
  for (let iteration = 0; iteration < iterations; iteration++) {
    const next: T[] = [{ ...output[0] }];
    for (let index = 0; index < output.length - 1; index++) {
      next.push(interpolate(output[index], output[index + 1], .25));
      next.push(interpolate(output[index], output[index + 1], .75));
    }
    next.push({ ...output[output.length - 1] });
    output = next;
  }
  return output;
};

const smoothRibbonPath = <T extends { x: number; y: number; z: number; width: number }>(rawPoints: T[], samplesPerSpan = 6): T[] => {
  const points = cornerCutRibbon(simplifyRibbonControls(rawPoints), 2);
  if (points.length < 2) return points;
  const output: T[] = [];
  const channel = (a: number, b: number, c: number, d: number, t: number) => {
    const t2 = t * t, t3 = t2 * t;
    return .5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  };
  for (let span = 0; span < points.length - 1; span++) {
    const p0 = points[Math.max(0, span - 1)], p1 = points[span], p2 = points[span + 1], p3 = points[Math.min(points.length - 1, span + 2)];
    for (let sample = 0; sample < samplesPerSpan; sample++) {
      const t = sample / samplesPerSpan;
      output.push({ ...p1, x: channel(p0.x, p1.x, p2.x, p3.x, t), y: channel(p0.y, p1.y, p2.y, p3.y, t), z: channel(p0.z, p1.z, p2.z, p3.z, t), width: channel(p0.width, p1.width, p2.width, p3.width, t) });
    }
  }
  output.push(points[points.length - 1]);
  return output;
};

type RibbonPoint = { x: number; y: number; z: number; width: number; tangentX?: number; tangentZ?: number };

const buildSmoothRoadPaths = (roads: ReturnType<typeof buildAnisotropicRoadNetwork>, fields: ReturnType<typeof buildWorldFieldSet>, seed: number): RibbonPoint[][] => {
  const groups = new Map<string, typeof roads>();
  for (const road of roads) {
    const key = `${road.fromZoneId}:${road.toZoneId}`;
    groups.set(key, [...(groups.get(key) ?? []), road]);
  }
  const paths: RibbonPoint[][] = [];
  for (const route of groups.values()) {
    if (!route.length) continue;
    const raw = [
      { x: route[0].ax, z: route[0].az },
      ...route.map((entry) => ({ x: entry.bx, z: entry.bz })),
    ];
    // Rendering, road grading and vegetation exclusion consume the SAME curve.
    const curve = raw;
    paths.push(curve.map((point, index) => ({
      x: point.x,
      y: sampleWorldField(fields, "elevation", point.x, point.z) + .028,
      z: point.z,
      width: route[Math.min(route.length - 1, Math.floor(index / Math.max(1, curve.length - 1) * route.length))].width
        * (.94 + simplexNoise2D(point.x * .08, point.z * .08, seed + 6751) * .12),
    })));
  }
  return paths;
};

interface BridgeSpan { ax: number; az: number; bx: number; bz: number; width: number; crossing: "river" | "lake" }

/** Derive exactly one deck from each true road/water crossing. River centerline
 * intersections and lake wet/dry transitions are authoritative; proximity to
 * a blue cell is not enough to manufacture a bridge. */
const collectBridgeSpans = (roads: RibbonPoint[][], fields: ReturnType<typeof buildWorldFieldSet>): BridgeSpan[] => {
  const candidates: BridgeSpan[] = [];
  for (const path of roads) {
    let run: { start: RibbonPoint; end: RibbonPoint; width: number; waterWidth: number; crossing: "river" | "lake"; enteredFromDry: boolean } | undefined;
    const flush = (exitedToDry: boolean) => {
      if (!run || !run.enteredFromDry || !exitedToDry) { run = undefined; return; }
      const dx = run.end.x - run.start.x, dz = run.end.z - run.start.z, measured = Math.hypot(dx, dz);
      const fallbackA = path[Math.max(0, path.indexOf(run.start) - 1)] ?? run.start;
      const fallbackB = path[Math.min(path.length - 1, path.indexOf(run.end) + 1)] ?? run.end;
      const tangentX = measured > .15 ? dx / measured : fallbackB.x - fallbackA.x;
      const tangentZ = measured > .15 ? dz / measured : fallbackB.z - fallbackA.z;
      const tangentLength = Math.max(.001, Math.hypot(tangentX, tangentZ));
      const ux = tangentX / tangentLength, uz = tangentZ / tangentLength;
      const requiredLength = Math.max(measured, run.waterWidth + WORLD_VISUAL_CONFIG.roads.bridgeShoulderMeters * 2, 3.6);
      const centerX = (run.start.x + run.end.x) * .5, centerZ = (run.start.z + run.end.z) * .5;
      candidates.push({ ax: centerX - ux * requiredLength * .5, az: centerZ - uz * requiredLength * .5, bx: centerX + ux * requiredLength * .5, bz: centerZ + uz * requiredLength * .5, width: run.width, crossing: run.crossing });
      run = undefined;
    };
    for (let index = 0; index < path.length - 1; index++) {
      const a = path[index], b = path[index + 1], midpointX = (a.x + b.x) * .5, midpointZ = (a.z + b.z) * .5;
      const samplePoints = [a, { x: midpointX, z: midpointZ }, b];
      const masks = samplePoints.map((point) => sampleWorldField(fields, "waterMask", point.x, point.z));
      const crossing = Math.max(...masks) > 0;
      if (!crossing) { flush(true); continue; }
      const stream = Math.max(...samplePoints.map((point) => sampleWorldField(fields, "streamMap", point.x, point.z)));
      const crossingKind = stream > .18 ? "river" : "lake";
      const waterWidth = Math.max(.8, Math.hypot(b.x - a.x, b.z - a.z));
      if (!run) run = { start: a, end: b, width: (a.width + b.width) * .5, waterWidth, crossing: crossingKind, enteredFromDry: index === 0 ? masks[0] <= 0 : sampleWorldField(fields, "waterMask", path[index - 1].x, path[index - 1].z) <= 0 };
      else {
        run.end = b;
        run.width = Math.max(run.width, a.width, b.width);
        run.waterWidth = Math.max(run.waterWidth, waterWidth);
        if (crossingKind === "river") run.crossing = "river";
      }
    }
    flush(false);
  }
  // Converging routes can detect the same crossing. Keep the longer single
  // deck instead of stacking two coplanar bridge assets.
  return candidates.sort((left, right) => Math.hypot(right.bx - right.ax, right.bz - right.az) - Math.hypot(left.bx - left.ax, left.bz - left.az)).filter((candidate, index, sorted) => {
    const cx = (candidate.ax + candidate.bx) * .5, cz = (candidate.az + candidate.bz) * .5;
    return !sorted.slice(0, index).some((kept) => Math.hypot(cx - (kept.ax + kept.bx) * .5, cz - (kept.az + kept.bz) * .5) < Math.max(WORLD_VISUAL_CONFIG.roads.bridgeDedupeMeters, candidate.width * 1.6));
  });
};

const connectedZoneIds = (blueprint: WorldBlueprintV1): Set<string> => {
  const reachable = new Set<string>();
  const entry = blueprint.zones.find((zone) => zone.purpose === "entry") ?? blueprint.zones[0];
  const pending = entry ? [entry.id] : [];
  while (pending.length) {
    const id = pending.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const zone = blueprint.zones.find((candidate) => candidate.id === id);
    if (zone) pending.push(...zone.requiredConnections);
  }
  return reachable;
};

const repairZoneConnectivity = (input: WorldBlueprintV1): { blueprint: WorldBlueprintV1; passes: number } => {
  const blueprint = structuredClone(input);
  let passes = 0;
  while (passes < MAX_WORLD_REPAIR_PASSES) {
    const reachable = connectedZoneIds(blueprint);
    const missing = blueprint.zones.filter((zone) => !reachable.has(zone.id));
    if (!missing.length) break;
    const sources = blueprint.zones.filter((zone) => reachable.has(zone.id));
    for (const target of missing) {
      const source = sources.reduce((best, candidate) => Math.hypot(candidate.center.x - target.center.x, candidate.center.z - target.center.z) < Math.hypot(best.center.x - target.center.x, best.center.z - target.center.z) ? candidate : best, sources[0]);
      if (source && !source.requiredConnections.includes(target.id)) source.requiredConnections.push(target.id);
    }
    passes++;
  }
  return { blueprint, passes };
};

export function compileWorldBlueprint(input: WorldBlueprintV1): CompiledWorld {
  const parsed = worldBlueprintSchema.parse(input);
  const repaired = repairZoneConnectivity(parsed.site?parsed:prepareWorldSite(parsed));
  const blueprint = repaired.blueprint;
  if(blueprint.siteIntent&&blueprint.kind!=="interior"&&blueprint.kind!=="dungeon"){
    blueprint.site??=selectWorldSite(blueprint);
    blueprint.terrain.baseHeight=0;
    blueprint.terrain.waterLevel=blueprint.site.seaLevel-blueprint.site.datum;
  }
  const entities: MapEntity[] = [];
  const chunks: WorldChunkDescriptor[] = [];
  const countX = blueprint.width / WORLD_CHUNK_SIZE, countZ = blueprint.depth / WORLD_CHUNK_SIZE;
  const halfWidth = blueprint.width / 2, halfDepth = blueprint.depth / 2;
  // Dependency order matters: geology -> sink-filled hydrology -> roads.
  // Infrastructure therefore reacts to valleys and water rather than being
  // stamped as straight lines over an already decorated scene.
  // Half-metre regional authority gives roads, contour water and one-metre
  // gameplay terraces enough lateral resolution to read as landforms rather
  // than a 1 m cellular grid. Large regions keep the coarser authoring field.
  let geologicalFields = buildWorldFieldSet(blueprint, blueprint.size === "large" ? 1 : .5);
  if (!blueprint.site && blueprint.terrain.waterLevel !== undefined && blueprint.kind !== "interior" && blueprint.kind !== "dungeon") {
    const sortedElevation = [...geologicalFields.waterElevation].sort((left, right) => left - right);
    const wetRatio = sortedElevation.filter((height) => height < blueprint.terrain.waterLevel!).length / sortedElevation.length;
    if (wetRatio > .28 || wetRatio < .015) {
      const targetRatio = blueprint.biome.id === "swamp" ? .16 : .09;
      const adjusted = sortedElevation[Math.floor((sortedElevation.length - 1) * targetRatio)];
      if (Math.abs(adjusted - blueprint.terrain.waterLevel) > .001) {
        blueprint.terrain.waterLevel = adjusted;
        geologicalFields = buildWorldFieldSet(blueprint, blueprint.size === "large" ? 1 : .5);
      }
    }
  }
  const hydrology = geologicalFields.hydrology;
  const outdoor = blueprint.kind !== "interior" && blueprint.kind !== "dungeon";
  const roads = outdoor && !blueprint.site?.shared ? buildAnisotropicRoadNetwork(blueprint, hydrology.riverSegments, Math.max(1, geologicalFields.cellSize * 2), geologicalFields) : [];
  const fields = outdoor ? gradeWorldFieldRoads(geologicalFields, roads) : geologicalFields;
  const regionalRoadPaths = outdoor ? buildSmoothRoadPaths(roads, fields, blueprint.seed) : [];
  const bridgeSpans = outdoor ? collectBridgeSpans(regionalRoadPaths, fields) : [];
  const treeGeometryVariants = new Map<string, ReturnType<typeof generateSpaceColonizedTree>>();
  const generateUnderstoryPrototype = (seed: number) => {
    const key = 'understory:' + seed;
    let prototype = treeGeometryVariants.get(key);
    if (!prototype) { prototype = generateSpaceColonizedTree(seed, 'broadleaf'); treeGeometryVariants.set(key, prototype); }
    return prototype;
  };
  const paintedRoads = regionalRoadPaths.flatMap((path, pathIndex) => path.slice(0, -1).map((point, index) => ({
    ax: point.x, az: point.z, bx: path[index + 1].x, bz: path[index + 1].z,
    width: (point.width + path[index + 1].width) * .5,
    bridge: [point,path[index+1],{x:(point.x+path[index+1].x)*.5,z:(point.z+path[index+1].z)*.5}].some(p=>sampleWorldField(fields,"waterMask",p.x,p.z)>-.08),
    fromZoneId: `paint-${pathIndex}`, toZoneId: `paint-${pathIndex}`,
  })));
  for (const zone of blueprint.zones) zone.center.y = sampleWorldField(fields, "elevation", zone.center.x, zone.center.z);
  const rooms = blueprint.kind === "interior" || blueprint.kind === "dungeon" ? generateBspRooms(blueprint.width * .82, blueprint.depth * .82, blueprint.seed, Math.min(14, Math.max(5, Math.round(blueprint.width / 12)))) : [];
  for (let cz = 0; cz < countZ; cz++) for (let cx = 0; cx < countX; cx++) {
    const chunkId = `chunk-${cx}-${cz}`;
    const x = -halfWidth + cx * WORLD_CHUNK_SIZE + WORLD_CHUNK_SIZE / 2;
    const z = -halfDepth + cz * WORLD_CHUNK_SIZE + WORLD_CHUNK_SIZE / 2;
    const chunkBiome = biomeAt(blueprint, x, z);
    const flat = blueprint.kind === "interior" || blueprint.kind === "dungeon";
    const chunkMinX = x - WORLD_CHUNK_SIZE / 2, chunkMaxX = x + WORLD_CHUNK_SIZE / 2;
    const chunkMinZ = z - WORLD_CHUNK_SIZE / 2, chunkMaxZ = z + WORLD_CHUNK_SIZE / 2;
    const touchesChunk = (segment: { ax: number; az: number; bx: number; bz: number; width: number }, margin = 0) => Math.max(segment.ax, segment.bx) >= chunkMinX - segment.width - margin && Math.min(segment.ax, segment.bx) <= chunkMaxX + segment.width + margin && Math.max(segment.az, segment.bz) >= chunkMinZ - segment.width - margin && Math.min(segment.az, segment.bz) <= chunkMaxZ + segment.width + margin;
    const localRoads = paintedRoads.filter((road) => touchesChunk(road, 2));
    const localRivers = flat ? [] : hydrology.riverSegments.filter((river) => touchesChunk(river, river.width));
    const geometry = terrainGeometryForChunk({ ...blueprint, biome: chunkBiome }, chunkMinX, chunkMinZ, localRoads, localRivers, fields);
    const heightfield = createHeightfield(geometry, 33);
    const navigation = buildNavigationGrid(geometry, 16);
    const height = sampleTerrainHeight(geometry, x, z);
    const pathDistance = roads.reduce((nearest, road) => Math.min(nearest, distanceToSegment(x, z, road.ax, road.az, road.bx, road.bz)), Number.POSITIVE_INFINITY);
    const chunkEntities: MapEntity[] = [];
    const terrain = entity(blueprint, chunkId, 0, terrainAsset(blueprint), `${chunkBiome.id} terrain`, x, 0, z, 1, 0, ["world:terrain", `biome:${chunkBiome.id}`]);
    terrain.worldGeometry = geometry;
    // BSP rooms own their floors. A second full-region terrain skin was
    // coplanar with those floors, caused z-fighting, and hid room materials in
    // the Forge overview.
    if (!flat) chunkEntities.push(terrain);

    // Water follows a half-meter elevation mask instead of flooding a whole
    // 16 m chunk when only its center is wet.
    if (!flat && fields.waterMask.some((mask) => mask > 0)) {
      const waterCells = blueprint.size === "large" ? 16 : 32, waterSamples = waterCells + 1, waterCellSize = WORLD_CHUNK_SIZE / waterCells;
      const wetCells: boolean[] = [];
      const depthField: number[] = [];
      const surfaceHeights: number[] = [];
      const sampledFlowVectors: number[] = [];
      let containsRiver = false;
      for (let waterZ = 0; waterZ < waterSamples; waterZ++) for (let waterX = 0; waterX < waterSamples; waterX++) {
        const waterXPosition = chunkMinX + waterX * waterCellSize;
        const waterZPosition = chunkMinZ + waterZ * waterCellSize;
        const waterMask = sampleWorldField(fields, "waterMask", waterXPosition, waterZPosition);
        const physicalDepth = sampleWorldField(fields, "waterDepth", waterXPosition, waterZPosition);
        const stream = sampleWorldField(fields, "streamMap", waterXPosition, waterZPosition);
        const wet = waterMask > 0;
        containsRiver ||= wet && stream > .18;
        depthField.push(wet ? Math.max(.045, physicalDepth) : Math.min(-.025, waterMask * .28));
        wetCells.push(wet);
        surfaceHeights.push(sampleWorldField(fields, "waterSurface", waterXPosition, waterZPosition));
        const momentumX = sampleWorldField(fields, "momentumX", waterXPosition, waterZPosition);
        const momentumZ = sampleWorldField(fields, "momentumZ", waterXPosition, waterZPosition);
        const momentumLength = Math.hypot(momentumX, momentumZ);
        sampledFlowVectors.push(momentumLength > .0001 ? momentumX / momentumLength : 0, momentumLength > .0001 ? momentumZ / momentumLength : 0);
      }
      if (wetCells.some(Boolean)) {
        const shoreline: number[] = [], flowVectors: number[] = [];
        for (let waterZ = 0; waterZ < waterSamples; waterZ++) for (let waterX = 0; waterX < waterSamples; waterX++) {
          const index = waterZ * waterSamples + waterX;
          const worldX = chunkMinX + waterX * waterCellSize, worldZ = chunkMinZ + waterZ * waterCellSize;
          const mask = sampleWorldField(fields, "waterMask", worldX, worldZ);
          shoreline.push(wetCells[index] ? 1 - smooth(clamp(mask / .5, 0, 1)) : 0);
          const sampledFlowX = sampledFlowVectors[index * 2], sampledFlowZ = sampledFlowVectors[index * 2 + 1];
          const flowAngle = .72 + (terrainNoise(worldX * 1.8, worldZ * 1.8, blueprint.seed + 9917, .38) - .5) * 1.1;
          flowVectors.push(Math.hypot(sampledFlowX, sampledFlowZ) > .01 ? sampledFlowX : Math.cos(flowAngle), Math.hypot(sampledFlowX, sampledFlowZ) > .01 ? sampledFlowZ : Math.sin(flowAngle));
        }
        const water = entity(blueprint, chunkId, 1000, "water-tile", "Shared discharge and pool surface", x, 0, z, 1, 0, ["world:water", "world:shared-hydrology-surface", ...(containsRiver ? ["world:river-field"] : ["world:lake-mask"]), "non-colliding", "shader:animated-water"]);
        water.worldGeometry = { kind: "water", originX: chunkMinX, originZ: chunkMinZ, size: WORLD_CHUNK_SIZE, waterLevel: blueprint.terrain.waterLevel === undefined ? 0 : blueprint.terrain.waterLevel - .06, resolution: waterCells, wetCells, depthField, shoreline, surfaceHeights, flowVectors };
        chunkEntities.push(water);
      }
    }
    // The grade-limited regional spline is rasterized once into the terrain's
    // soft road weight field. A second coplanar ribbon used to double the
    // texture, create dark blotches at overlaps, and expose chunk joins.
    const ownedBridges = bridgeSpans.filter((bridge) => {
      const midpointX = (bridge.ax + bridge.bx) / 2, midpointZ = (bridge.az + bridge.bz) / 2;
      return midpointX >= chunkMinX && midpointX < chunkMaxX && midpointZ >= chunkMinZ && midpointZ < chunkMaxZ;
    });
    for (const [index, bridge] of ownedBridges.entries()) {
      const dx = bridge.bx - bridge.ax, dz = bridge.bz - bridge.az;
      const length = Math.max(.5, Math.hypot(dx, dz));
      const midpointX = (bridge.ax + bridge.bx) / 2, midpointZ = (bridge.az + bridge.bz) / 2;
      const terrainHeight = sampleWorldField(fields, "elevation", midpointX, midpointZ);
      const waterSurface = sampleWorldField(fields, "waterSurface", midpointX, midpointZ);
      // Keep the complete deck above the animated surface, not merely its
      // entity origin. This clearance also prevents bank and wave clipping.
      const deckHeight = Math.max(terrainHeight + .28, waterSurface + .42);
      chunkEntities.push(entity(
        blueprint, chunkId, 1180 + index, blueprint.terrain.roadMaterial === "stone" ? "bridge-stone" : "bridge-wood", "Route-aligned water crossing",
        midpointX, deckHeight, midpointZ,
        { x: Math.max(.72, bridge.width / 3.2), y: .72, z: Math.max(.78, length / 4) },
        Math.atan2(dx, dz) * 180 / Math.PI,
        ["world:bridge", "world:road-crossing", `world:${bridge.crossing}-crossing`, "navigation:walkable", "structure:route-aligned"],
      ));
    }

    if (!flat) {
      // Whittaker-style macro mask: low-frequency climate patches are crossed
      // with actual elevation, moisture, slope and hydraulic deposition. It
      // yields coherent forest/riparian/meadow regions instead of uniform dots.
      const ecologyDensity = (sampleX: number, sampleZ: number, layer: "canopy" | "understory" | "ground" = "canopy") => {
        if(blueprint.site?.shared){const site=blueprint.site,wx=sampleX+site.x,wz=sampleZ+site.z,c=sampleSharedClimate(blueprint.seed,site.shared!,wx,wz,sampleWorldField(fields,'elevation',sampleX,sampleZ)+site.datum,sampleWorldField(fields,'streamMap',sampleX,sampleZ),sampleWorldField(fields,'slope',sampleX,sampleZ));return (layer==='canopy'?c.forest:layer==='understory'?c.forest*.6:Math.min(.95,c.moisture))*(1-c.snow)*(1-worldClearing(site.shared,wx,wz));}
        const moisture = sampleWorldField(fields, "moisture", sampleX, sampleZ);
        const slope = sampleWorldField(fields, "slope", sampleX, sampleZ);
        const sediment = sampleWorldField(fields, "sediment", sampleX, sampleZ);
        const flow = Math.log1p(sampleWorldField(fields, "accumulation", sampleX, sampleZ)) / Math.log1p(Math.max(1, hydrology.maximumAccumulation));
        const climatePatch = simplexNoise2D((sampleX - 811) * .026, (sampleZ + 503) * .026, blueprint.seed + 3371);
        const forest = clamp((chunkBiome.id === "forest" ? .38 : 0) + (moisture - .32) * 1.45 + climatePatch * .55 + sediment * .28 - slope * .8, 0, 1);
        const riparian = clamp(flow * .78 + moisture * .5 - slope * .7, 0, 1);
        const meadow = clamp(1.08 - forest * .72 - slope * 1.25 + climatePatch * .18, 0, 1);
        const mask = layer === "canopy" ? forest * .92 + riparian * .22 : layer === "understory" ? forest * .58 + riparian * .7 : meadow * .66 + forest * .34 + riparian * .42;
        return clamp(chunkBiome.vegetationDensity * mask * (layer === "canopy" ? WORLD_VISUAL_CONFIG.forest.densityMultiplier : 1.35), 0, .98);
      };
      const isReserved = (sampleX: number, sampleZ: number, padding: number) => blueprint.site?.shared?worldClearing(blueprint.site.shared,sampleX+blueprint.site.x,sampleZ+blueprint.site.z)>.05:blueprint.zones.some((zone) => Math.hypot(sampleX - zone.center.x, sampleZ - zone.center.z) < zone.radius * .58 + padding);
      const candidates = blueprint.site?.shared?worldForestCandidates(blueprint.seed,x-8+blueprint.site.x,z-8+blueprint.site.z,16).map(p=>({...p,x:p.x-blueprint.site!.x,z:p.z-blueprint.site!.z})).filter(p=>p.priority<ecologyDensity(p.x,p.z,'canopy')):noiseWeightedPoissonPoints(x - 8, z - 8, 16, chunkBiome.treeStyle === "none" ? 2.8 : WORLD_VISUAL_CONFIG.forest.minimumTreeRadius, chunkBiome.treeStyle === "none" ? 5.2 : WORLD_VISUAL_CONFIG.forest.maximumTreeRadius, blueprint.seed + 333, (sampleX, sampleZ) => ecologyDensity(sampleX, sampleZ, "canopy"));
      const canopyLocations: Array<{ x: number; z: number; y: number; radius: number; priority: number }> = [];
      for (const [index, point] of candidates.entries()) {
        const pointHeight = sampleTerrainHeight(geometry, point.x, point.z);
        const slope = sampleWorldField(fields, "slope", point.x, point.z), moisture = sampleWorldField(fields, "moisture", point.x, point.z);
        const onRoute = roads.some((road) => distanceToSegment(point.x, point.z, road.ax, road.az, road.bx, road.bz) < road.width + 1.2);
        if (isReserved(point.x, point.z, 1.2) || onRoute || slope > Math.tan(Math.PI / 6) || sampleWorldField(fields, "poolDepth", point.x, point.z) > .06 || sampleWorldField(fields, "streamMap", point.x, point.z) > .16 || (blueprint.terrain.waterLevel !== undefined && pointHeight < blueprint.terrain.waterLevel + .12)) continue;
        const assetId = chunkBiome.treeStyle === "none" ? "rock" : treeAsset(chunkBiome, point.priority);
        const appearance = (channel: number) => scatterVariation(point.x, point.z, blueprint.seed, channel);
        const ecologicalScale = (.72 + appearance(1) * .58) * (assetId === "tree-cypress" ? .88 + moisture * .24 : 1);
        canopyLocations.push({ x: point.x, z: point.z, y: pointHeight, radius: 2.25 * ecologicalScale, priority: point.priority });
        const tree = entity(blueprint, chunkId, 10 + index, assetId, chunkBiome.treeStyle === "none" ? "Regional stone" : `${chunkBiome.treeStyle} space-colonized tree`, point.x, pointHeight, point.z, ecologicalScale, point.priority * 360, ["world:vegetation", "ecology:canopy", "generator:space-colonization", `instance-family:${assetId}`, `biome:${chunkBiome.id}`]);
        if (chunkBiome.treeStyle !== "none") {
          // Six deterministic botanical variants are shared across the region;
          // transforms still vary per instance. This mirrors an HISM family and
          // avoids solving space colonization hundreds of times per compile.
          const variant = Math.min(5, Math.floor(appearance(2) * 6));
          const variantKey = `${chunkBiome.treeStyle}:${variant}`;
          let treeGeometry = treeGeometryVariants.get(variantKey);
          if (!treeGeometry) {
            treeGeometry = generateSpaceColonizedTree(blueprint.seed + variant * 7919, chunkBiome.treeStyle);
            treeGeometryVariants.set(variantKey, treeGeometry);
          }
          tree.worldGeometry = { ...treeGeometry, branches: [], leafClusters: [], prototypeSeed: blueprint.seed + variant * 7919 };
          const batch = chunkEntities.find(entry => entry.worldGeometry?.kind === "space-colonized-tree" && entry.worldGeometry.prototypeSeed === blueprint.seed + variant * 7919);
          const placement = { x: point.x, y: pointHeight, z: point.z, rotation: appearance(3) * 360, scale: ecologicalScale };
          if (batch?.worldGeometry?.kind === "space-colonized-tree") { batch.worldGeometry.instances!.push(placement); continue; }
          tree.worldGeometry.instances = [placement];
          tree.position = { x, y: 0, z }; tree.rotation.y = 0; tree.scale = { x: 1, y: 1, z: 1 };
        }
        chunkEntities.push(tree);
      }
      if (chunkBiome.treeStyle !== "none") {
        const understory = noiseWeightedPoissonPoints(x - 8, z - 8, 16, 1.35, 2.9, blueprint.seed + 733, (sampleX, sampleZ) => ecologyDensity(sampleX, sampleZ, "understory"));
        // Parent-child satellites make each canopy tree seed a believable
        // shade community. Independent Poisson points fill only the gaps.
        const satellites = canopyLocations.flatMap((parent, parentIndex) => Array.from({ length: 3 + Math.floor(parent.priority * 3) }, (_, childIndex) => {
          const angle = (childIndex * 2.39996 + parent.priority * Math.PI * 2 + parentIndex) % (Math.PI * 2);
          const radius = parent.radius * (.68 + ((childIndex * 37 + parentIndex * 17) % 13) / 20);
          return { x: parent.x + Math.cos(angle) * radius, z: parent.z + Math.sin(angle) * radius, priority: (parent.priority + childIndex * .173) % 1 };
        }));
        for (const [index, point] of [...satellites, ...understory].entries()) {
          const pointHeight = sampleTerrainHeight(geometry, point.x, point.z), slope = sampleWorldField(fields, "slope", point.x, point.z), moisture = sampleWorldField(fields, "moisture", point.x, point.z);
          const onRoute = roads.some((road) => distanceToSegment(point.x, point.z, road.ax, road.az, road.bx, road.bz) < road.width + .7);
          if (point.x < chunkMinX || point.x >= chunkMaxX || point.z < chunkMinZ || point.z >= chunkMaxZ || isReserved(point.x, point.z, .55) || onRoute || slope > .72 || sampleWorldField(fields, "poolDepth", point.x, point.z) > .045 || sampleWorldField(fields, "streamMap", point.x, point.z) > .14 || (blueprint.terrain.waterLevel !== undefined && pointHeight < blueprint.terrain.waterLevel - .08)) continue;
          const wetland = moisture > .68 && (chunkBiome.id === "swamp" || chunkBiome.id === "coast");
          const assetId = wetland ? "reeds-wetland" : "shrub-broadleaf";
          const plantSeed = blueprint.seed + 1709 + Math.floor(point.priority * 2) * 7919;
          const prototype = wetland ? undefined : generateUnderstoryPrototype(plantSeed);
          const batch = chunkEntities.find(entry => entry.tags?.includes(wetland ? "ecology:riparian-batch" : "ecology:understory-batch") && (wetland || (entry.worldGeometry?.kind === "space-colonized-tree" && entry.worldGeometry.prototypeSeed === plantSeed)));
          const placement = { x: Number(point.x.toFixed(3)), y: Number(pointHeight.toFixed(3)), z: Number(point.z.toFixed(3)), scale: (.55 + point.priority * .45) * (wetland ? 2.8 : .22), rotation: point.priority * (wetland ? Math.PI * 2 : 360) };
          if (batch?.worldGeometry?.kind === "space-colonized-tree") { batch.worldGeometry.instances!.push(placement); continue; }
          if (batch?.worldGeometry?.kind === "ground-cover") { batch.worldGeometry.instances.push(placement); continue; }
          const plants = entity(blueprint, chunkId, 80 + index, assetId, wetland ? "Wet bank reeds" : "Regional understory", x, 0, z, 1, 0, ["world:vegetation", wetland ? "ecology:riparian" : "ecology:understory", wetland ? "ecology:riparian-batch" : "ecology:understory-batch", `instance-family:${assetId}`]);
          plants.worldGeometry = wetland ? { kind: "ground-cover", color: "#78874a", instances: [placement] } : { ...prototype!, prototypeSeed: plantSeed, branches: [], leafClusters: [], instances: [placement] };
          chunkEntities.push(plants);
        }
        // GPU Gems-style grass is a dense field of multi-blade clusters, not a
        // scattering of individual decorative props. The ecological mask
        // modulates a deliberately high floor so every grassy surface reads as
        // a continuous meadow while one instanced draw still owns the chunk.
        const groundPoints = denseGroundCoverPoints(
          x - 8,
          z - 8,
          16,
          WORLD_VISUAL_CONFIG.grass.clusterSpacingMeters,
          blueprint.seed + 1237,
          (sampleX, sampleZ) => clamp(WORLD_VISUAL_CONFIG.grass.minimumMaskDensity + ecologyDensity(sampleX, sampleZ, "ground") * .28, 0, .995),
        ).filter((point) => {
          const pointHeight = sampleTerrainHeight(geometry, point.x, point.z);
          const riverClearance = hydrology.riverSegments.some((river) => distanceToSegment(point.x, point.z, river.ax, river.az, river.bx, river.bz) < river.width * .62 + .62);
          return sampleWorldField(fields, "slope", point.x, point.z) < WORLD_VISUAL_CONFIG.grass.maximumSlope
            && !roads.some((road) => distanceToSegment(point.x, point.z, road.ax, road.az, road.bx, road.bz) < road.width + WORLD_VISUAL_CONFIG.grass.roadClearanceMeters)
            && !riverClearance
            && sampleWorldField(fields, "poolDepth", point.x, point.z) < .035
            && sampleWorldField(fields, "streamMap", point.x, point.z) < .13
            && (blueprint.terrain.waterLevel === undefined || pointHeight >= blueprint.terrain.waterLevel + .03);
        });
        if (groundPoints.length) {
          const cover = entity(blueprint, chunkId, 140, "shrub-broadleaf", "GPU-instanced ecological ground cover", x, 0, z, 1, 0, ["world:vegetation", "ecology:ground-cover", "render:gpu-instanced"]);
          cover.worldGeometry = { kind: "ground-cover", color: chunkBiome.id === "snow" ? "#8ea684" : chunkBiome.id === "swamp" ? "#45683c" : "#527d3e", instances: groundPoints.map((point) => ({ x: point.x, y: sampleTerrainHeight(geometry, point.x, point.z) - .035, z: point.z, scale: WORLD_VISUAL_CONFIG.grass.minimumScale + scatterVariation(point.x, point.z, blueprint.seed, 1) * WORLD_VISUAL_CONFIG.grass.scaleVariation, rotation: scatterVariation(point.x, point.z, blueprint.seed, 2) * Math.PI * 2 })) };
          chunkEntities.push(cover);
        }
      }
    }

    const settlementZone = blueprint.zones.find((zone) => zone.purpose === "settlement" && Math.hypot(x - zone.center.x, z - zone.center.z) < zone.radius + 12);
    if (blueprint.kind === "settlement" && settlementZone && roads.length && pathDistance < WORLD_CHUNK_SIZE * 1.2 && ((cx + cz) % 2 === 0 || (blueprint.architecture?.density ?? 0) > .8)) {
      const side = ((cx + cz) % 4 < 2 ? 1 : -1);
      const road = roads.reduce((nearest, candidate) => distanceToSegment(x, z, candidate.ax, candidate.az, candidate.bx, candidate.bz) < distanceToSegment(x, z, nearest.ax, nearest.az, nearest.bx, nearest.bz) ? candidate : nearest, roads[0]);
      const roadDx = road.bx - road.ax, roadDz = road.bz - road.az, roadLengthSquared = roadDx * roadDx + roadDz * roadDz;
      const roadT = roadLengthSquared > .001 ? clamp(((x - road.ax) * roadDx + (z - road.az) * roadDz) / roadLengthSquared, 0, 1) : 0;
      const roadX = road.ax + roadDx * roadT, roadZ = road.az + roadDz * roadT, roadLength = Math.max(.001, Math.hypot(roadDx, roadDz));
      const parcelSetback = road.width + 4 + lattice(cx, cz, blueprint.seed + 901) * 2;
      const bx = roadX - roadDz / roadLength * side * parcelSetback, bz = roadZ + roadDx / roadLength * side * parcelSetback;
      const buildingHeight = sampleTerrainHeight(geometry, bx, bz);
      const roadHeading = Math.atan2(roadDx, roadDz) * 180 / Math.PI;
      const prominent = (cx + cz) % 4 === 0;
      const building = entity(blueprint, chunkId, 20, prominent ? "house-large" : "house-small", "CGA regional building", bx, buildingHeight, bz, 1, roadHeading + (side > 0 ? 180 : 0), ["world:building", "layout:road-parcel", "generator:cga-shape-grammar", "grammar:footprint-extrusion-floor-split-facade-instances", "facade:constrained-modules"]);
      building.worldGeometry = generateCgaBuilding(blueprint.seed + cx * 7919 + cz * 104729, prominent, blueprint.architecture?.material ?? (blueprint.terrain.roadMaterial === "stone" ? "stone" : "timber"), blueprint.architecture?.ruin ?? 0);
      building.name = `${building.worldGeometry.roof === "ruined" ? "Ruined" : prominent ? "Village hall" : "Cottage"} ${cx + cz * countX + 1}`;
      const recipe = blueprint.composition?.recipes.find((entry) => entry.id === blueprint.composition?.buildingRecipeId);
      if (recipe) {
        building.name = recipe.name;
        building.worldGeometry = { kind: "assembly", recipeId: recipe.id, parts: expandSceneRecipe(recipe.parts) };
        const bounds = sceneRecipeBounds(recipe.parts), scale = Math.min(1, 10 / Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z));
        building.scale = { x: scale, y: scale, z: scale };
        building.position.y -= bounds.min.y * scale;
      }
      if (!blueprint.composition || recipe) chunkEntities.push(building);
    }
    if (flat) {
      const chunkRooms = rooms.filter((room) => room.x + room.width / 2 >= x - 8 && room.x + room.width / 2 < x + 8 && room.z + room.depth / 2 >= z - 8 && room.z + room.depth / 2 < z + 8);
      for (const [index, room] of chunkRooms.entries()) {
        const baseIndex = 40 + index * 10, centerX = room.x + room.width / 2, centerZ = room.z + room.depth / 2;
        const wallAsset = blueprint.theme === "tavern" ? "wall-wood" : "wall-stone";
        chunkEntities.push(entity(blueprint, chunkId, baseIndex, blueprint.theme === "tavern" ? "floor-wood" : "floor-stone", `Room ${room.id}`, centerX, .02, centerZ, { x: room.width / 2, y: .08, z: room.depth / 2 }, 0, ["world:interior", `room:${room.id}`, blueprint.kind === "dungeon" ? "generator:bsp-wfc" : "generator:bsp"]));
        chunkEntities.push(entity(blueprint, chunkId, baseIndex + 1, wallAsset, `${room.id} north wall`, centerX, 0, room.z, { x: Math.max(.5, room.width / 2), y: 1, z: 1 }, 0, ["world:interior", "world:wall", `room:${room.id}`]));
        chunkEntities.push(entity(blueprint, chunkId, baseIndex + 2, wallAsset, `${room.id} south wall`, centerX, 0, room.z + room.depth, { x: Math.max(.5, room.width / 2), y: 1, z: 1 }, 0, ["world:interior", "world:wall", `room:${room.id}`]));
        chunkEntities.push(entity(blueprint, chunkId, baseIndex + 3, wallAsset, `${room.id} west wall`, room.x, 0, centerZ, { x: Math.max(.5, room.depth / 2), y: 1, z: 1 }, 90, ["world:interior", "world:wall", `room:${room.id}`]));
        chunkEntities.push(entity(blueprint, chunkId, baseIndex + 4, wallAsset, `${room.id} east wall`, room.x + room.width, 0, centerZ, { x: Math.max(.5, room.depth / 2), y: 1, z: 1 }, 90, ["world:interior", "world:wall", `room:${room.id}`]));
      }
    }
    entities.push(...chunkEntities);
    const intersectingZones = blueprint.zones.filter((zone) => Math.hypot(zone.center.x - x, zone.center.z - z) <= zone.radius + WORLD_CHUNK_SIZE * .72);
    chunks.push({
      id: chunkId, x: cx, z: cz,
      bounds: { min: { x: x - 8, y: Math.min(-12, heightfield.minimum - 2), z: z - 8 }, max: { x: x + 8, y: Math.max(12, heightfield.maximum + 8), z: z + 8 } },
      entityIds: chunkEntities.map((entry) => entry.id), lods: [{ level: 0, triangleCount: 512 + chunkEntities.length * 120, byteLength: 20_480 + chunkEntities.length * 5_760 }, { level: 1, triangleCount: 128 + chunkEntities.length * 48, byteLength: 5_120 + chunkEntities.length * 2_304 }, { level: 2, triangleCount: 32 + chunkEntities.length * 12, byteLength: 1_280 + chunkEntities.length * 576 }],
      navigationSummary: { resolution: navigation.resolution, walkableCells: navigation.walkableCells, blockedCells: navigation.blockedCells, connected: navigation.connected },
      roomIds: flat ? [...new Set([...intersectingZones.map((zone) => zone.id), ...rooms.filter((room) => chunkEntities.some((entry) => entry.tags?.includes(`room:${room.id}`))).map((room) => room.id)])] : undefined,
      portalChunkIds: flat ? [] : undefined,
      landmark: intersectingZones.some((zone) => zone.purpose === "landmark"), generationHash: stableId("generation", blueprint.seed, cz * countX + cx),
    });
  }

  if (blueprint.kind === "interior" || blueprint.kind === "dungeon") {
    const chunkAt = (x: number, z: number) => chunks.find((chunk) => x >= chunk.bounds.min.x && x < chunk.bounds.max.x && z >= chunk.bounds.min.z && z < chunk.bounds.max.z);
    const connectChunks = (leftId: string, rightId: string) => {
      if (leftId === rightId) return;
      const left = chunks.find((chunk) => chunk.id === leftId), right = chunks.find((chunk) => chunk.id === rightId);
      if (left && !left.portalChunkIds?.includes(rightId)) left.portalChunkIds = [...(left.portalChunkIds ?? []), rightId];
      if (right && !right.portalChunkIds?.includes(leftId)) right.portalChunkIds = [...(right.portalChunkIds ?? []), leftId];
    };
    let doorwayIndex = 0;
    for (const room of rooms) for (const connectionId of room.connections) {
      const other = rooms.find((candidate) => candidate.id === connectionId);
      if (!other || room.id > other.id) continue;
      const ax = room.x + room.width / 2, az = room.z + room.depth / 2, bx = other.x + other.width / 2, bz = other.z + other.depth / 2;
      const doorwayX = (ax + bx) / 2, doorwayZ = (az + bz) / 2, doorwayOwner = chunkAt(doorwayX, doorwayZ);
      if (doorwayOwner) {
        const doorway = entity(blueprint, doorwayOwner.id, 500 + doorwayIndex++, "door-wood", `${room.id} to ${other.id}`, doorwayX, 0, doorwayZ, 1, Math.atan2(bx - ax, bz - az) * 180 / Math.PI, ["world:interior", "world:portal", `rooms:${room.id}:${other.id}`]);
        entities.push(doorway); doorwayOwner.entityIds.push(doorway.id);
      }
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 6));
      let previous = chunkAt(ax, az);
      for (let step = 1; step <= steps; step++) {
        const current = chunkAt(ax + (bx - ax) * step / steps, az + (bz - az) * step / steps);
        if (previous && current) connectChunks(previous.id, current.id);
        previous = current ?? previous;
      }
    }
  }

  // Resolve parcel ownership globally, then dress each building and clear its
  // footprint. A tree generated in a neighboring chunk must also respect it.
  for (const [index, placement] of (blueprint.composition?.placements ?? []).entries()) {
    const recipe = blueprint.composition!.recipes.find((entry) => entry.id === placement.recipeId);
    const owner = chunks.find((chunk) => placement.x >= chunk.bounds.min.x && placement.x < chunk.bounds.max.x && placement.z >= chunk.bounds.min.z && placement.z < chunk.bounds.max.z);
    if (!recipe || !owner) continue;
    const assembly = entity(blueprint, owner.id, 4000 + index, "house-large", recipe.name, placement.x, sampleWorldField(fields, "elevation", placement.x, placement.z) + placement.elevation, placement.z, placement.scale, placement.yaw, ["world:building", "world:ai-composition"]);
    assembly.worldGeometry = { kind: "assembly", recipeId: recipe.id, parts: expandSceneRecipe(recipe.parts) };
    assembly.position.y -= sceneRecipeBounds(recipe.parts).min.y * placement.scale;
    entities.push(assembly);
  }
  const placementSurface = fieldPlacementSurface(fields, roads);
  const placementWarnings: string[] = [];
  const acceptedBuildings: MapEntity[] = [];
  if (blueprint.kind !== "interior" && blueprint.kind !== "dungeon") for (const building of entities.filter(e => e.worldGeometry?.kind === "assembly" || e.worldGeometry?.kind === "cga-building")) {
    if (placeOnDryGround(building, placementSurface, acceptedBuildings)) acceptedBuildings.push(building);
    else { placementWarnings.push(`No dry supported parcel for ${building.name}`); entities.splice(entities.indexOf(building), 1); }
  }
  const dryPlant = (x:number,z:number,radius:number) => [[0,0],[radius,0],[-radius,0],[0,radius],[0,-radius]].every(([dx,dz]) => !placementSurface.blocked(x+dx,z+dz));
  const buildings = entities.filter((entry) => entry.worldGeometry?.kind === "cga-building" || entry.worldGeometry?.kind === "assembly");
  const assemblyBounds = new Map(buildings.filter((building) => building.worldGeometry?.kind === "assembly").map((building) => [building.id, sceneRecipeBounds((building.worldGeometry as import("./types").WorldAssemblyGeometry).parts)]));
  const insideBuilding = (x: number, z: number, padding = 0) => buildings.some((building) => {
    if (building.worldGeometry?.kind !== "cga-building" && building.worldGeometry?.kind !== "assembly") return false;
    const angle = building.rotation.y * Math.PI / 180, dx = x - building.position.x, dz = z - building.position.z;
    const lx = (dx * Math.cos(angle) - dz * Math.sin(angle)) / building.scale.x, lz = (dx * Math.sin(angle) + dz * Math.cos(angle)) / building.scale.z;
    const bounds = assemblyBounds.get(building.id);
    const points = building.worldGeometry.kind === "cga-building" ? building.worldGeometry.footprint : [bounds!.min, bounds!.max];
    return lx > Math.min(...points.map((p) => p.x)) - padding / building.scale.x && lx < Math.max(...points.map((p) => p.x)) + padding / building.scale.x && lz > Math.min(...points.map((p) => p.z)) - padding / building.scale.z && lz < Math.max(...points.map((p) => p.z)) + padding / building.scale.z;
  });
  for (let index = entities.length - 1; index >= 0; index--) {
    const item = entities[index];
    if (item.worldGeometry?.kind === "space-colonized-tree" && item.worldGeometry.instances) { item.worldGeometry.instances = item.worldGeometry.instances.filter(p => !insideBuilding(p.x, p.z, 2) && dryPlant(p.x, p.z, .65)); if (!item.worldGeometry.instances.length) entities.splice(index, 1); }
    else if (item.worldGeometry?.kind === "ground-cover") item.worldGeometry.instances = item.worldGeometry.instances.filter((p) => !insideBuilding(p.x, p.z, .6) && dryPlant(p.x, p.z, .3));
    else if ((item.tags?.includes("world:vegetation") || item.tags?.includes("ecology:understory")) && (insideBuilding(item.position.x, item.position.z, 2) || !dryPlant(item.position.x, item.position.z, .65))) entities.splice(index, 1);
  }
  for (const [buildingIndex, building] of buildings.entries()) {
    if (blueprint.composition) continue; // The director owns dressing for custom compositions.
    const ruined = building.worldGeometry?.kind === "cga-building" && building.worldGeometry.roof === "ruined";
    for (let index = 0; index < (ruined ? 9 : 4); index++) {
      const angle = lattice(buildingIndex, index, blueprint.seed + 73) * Math.PI * 2;
      const radius = 4.8 + lattice(index, buildingIndex, blueprint.seed + 91) * 2.3;
      const px = building.position.x + Math.cos(angle) * radius, pz = building.position.z + Math.sin(angle) * radius;
      if (Math.abs(px) > halfWidth - 1 || Math.abs(pz) > halfDepth - 1 || insideBuilding(px, pz, .3) || roads.some((r) => distanceToSegment(px, pz, r.ax, r.az, r.bx, r.bz) < r.width + .5)) continue;
      if (!dryPlant(px, pz, 1)) continue;
      const prop = entity(blueprint, building.chunkId!, 2000 + buildingIndex * 16 + index, ruined ? (index % 3 ? "rock" : "crate") : ["barrel", "crate", "fence-wood", "market-stall"][index], ruined ? "Scattered ruin debris" : "Village courtyard prop", px, sampleWorldField(fields, "elevation", px, pz), pz, ruined ? { x: .45 + index * .07, y: .3, z: .5 } : .8, angle * 180 / Math.PI, ["world:dressing"]);
      entities.push(prop);
    }
  }
  for (const chunk of chunks) chunk.entityIds = [];
  for (const item of entities) {
    const owner = chunks.find((chunk) => item.position.x >= chunk.bounds.min.x && item.position.x < chunk.bounds.max.x && item.position.z >= chunk.bounds.min.z && item.position.z < chunk.bounds.max.z);
    const chunk = owner ?? chunks.find((chunk) => chunk.id === item.chunkId);
    if (chunk) { item.chunkId = chunk.id; chunk.entityIds.push(item.id); }
  }

  const landmarkZone = blueprint.zones.find((zone) => zone.purpose === "landmark") ?? blueprint.zones[Math.min(2, blueprint.zones.length - 1)];
  blueprint.assetRequests.forEach((request, index) => {
    const materialRequest = /material|surface|texture|ground|wall finish/i.test(`${request.name} ${request.description}`);
    if (materialRequest) {
      for (const terrain of entities.filter((entry) => entry.tags?.includes("world:terrain"))) terrain.tags = [...(terrain.tags ?? []), `asset-request:${request.id}`];
      return;
    }
    if (!landmarkZone || index >= 4) return;
    if (blueprint.composition) return;
    const owner = chunks.find((chunk) => landmarkZone.center.x >= chunk.bounds.min.x && landmarkZone.center.x < chunk.bounds.max.x && landmarkZone.center.z >= chunk.bounds.min.z && landmarkZone.center.z < chunk.bounds.max.z);
    if (!owner) return;
    const placeholder = entity(blueprint, owner.id, 300 + index, "house-large", request.name, landmarkZone.center.x + index * 2.2, landmarkZone.center.y, landmarkZone.center.z, 1, index * 37, ["world:asset-placeholder", "world:landmark", `asset-request:${request.id}`]);
    placeholder.worldGeometry = generateCgaBuilding(blueprint.seed + 301 + index, true, "stone", blueprint.architecture?.ruin ?? (blueprint.theme === "ruins" ? .8 : 0));
    if (blueprint.kind !== "interior" && blueprint.kind !== "dungeon" && !placeOnDryGround(placeholder, placementSurface, [...buildings, ...entities.filter(e => e.tags?.includes("world:asset-placeholder"))])) { placementWarnings.push(`No dry supported parcel for ${placeholder.name}`); return; }
    entities.push(placeholder);
    const placedOwner = chunks.find(c => placeholder.position.x >= c.bounds.min.x && placeholder.position.x < c.bounds.max.x && placeholder.position.z >= c.bounds.min.z && placeholder.position.z < c.bounds.max.z) ?? owner;
    placeholder.chunkId = placedOwner.id; placedOwner.entityIds.push(placeholder.id);
  });

  const lightColor = blueprint.mood === "moonlight" ? "#a9c8ff" : blueprint.mood === "crypt" ? "#8fd4bd" : blueprint.mood === "desert" ? "#ffd09a" : "#ffd7a0";
  const localLightScale = blueprint.kind === "interior" || blueprint.kind === "dungeon" || blueprint.mood === "moonlight" || blueprint.mood === "crypt" ? 1 : .04;
  blueprint.zones.filter((zone) => zone.purpose === "landmark" || zone.purpose === "settlement" || zone.purpose === "encounter").slice(0, 3).forEach((zone, index) => {
    const owner = chunks.find((chunk) => zone.center.x >= chunk.bounds.min.x && zone.center.x < chunk.bounds.max.x && zone.center.z >= chunk.bounds.min.z && zone.center.z < chunk.bounds.max.z);
    if (!owner) return;
    const fill = entity(blueprint, owner.id, 100 + index, index === 0 ? "scene-light-spot" : "scene-light-point", `${zone.name} readable fill`, zone.center.x, zone.center.y, zone.center.z, 1, 0, ["world:light", "world:invisible-fill"]);
    fill.light = { kind: "practical-light", lightType: index === 0 ? "spot" : "point", color: lightColor, intensity: (index === 0 ? 1.05 : .68) * localLightScale, range: Math.max(8, zone.radius * 1.6), coneAngle: 58, anchor: { x: 0, y: 3.2, z: 0 }, direction: { x: 0, y: -1, z: -.2 }, flicker: { enabled: false, amount: 0, speed: 0 } };
    entities.push(fill);
    owner.entityIds.push(fill.id);
    owner.lightEntityIds = [...(owner.lightEntityIds ?? []), fill.id];
  });

  const validation = { ...validateCompiledWorld(blueprint, chunks, entities), repairPasses: repaired.passes };
  validation.warnings.push(...placementWarnings);
  const now = new Date().toISOString();
  const map: GameMap = {
    weather: blueprint.weather ?? weatherFromDescription(blueprint.description),
    id: stableId("world-map", blueprint.seed), name: blueprint.name, theme: blueprint.theme, width: blueprint.width, depth: blueprint.depth,
    gridSize: 1, gridShape: blueprint.gridShape, ambientColor: blueprint.biome.palette.ground, entities,
    lighting: {
      ...DEFAULT_SCENE_LIGHTING,
      mood: blueprint.mood,
      iblIntensity: 1,
      keyIntensity: 1.15,
      fillIntensity: 1.15,
      exposure: 1.12,
      // Readable first frame; authored mood and practical lights still layer on.
      fogMist: false,
    },
    world: {
      site:blueprint.site,
      version: 1, generatorRevision: WORLD_GENERATOR_REVISION, blueprintId: blueprint.id, seed: blueprint.seed, chunkSize: WORLD_CHUNK_SIZE, chunks,
      hydrology: { resolution: hydrology.resolution, cellSize: hydrology.cellSize, riverSegments: hydrology.riverSegments.length, maximumAccumulation: hydrology.maximumAccumulation, sinkFilled: true, filledCellCount: hydrology.filledCellCount, maximumFillDepth: hydrology.maximumFillDepth },
      fieldSet: { resolution: fields.resolution, cellSize: fields.cellSize, layers: ["elevation", "waterMask", "waterSurface", "waterDepth", "filledElevation", "poolDepth", "streamMap", "momentumX", "momentumZ", "soilDepth", "screeDepth", "bedrockExposure", "saturation", "flowDirection", "accumulation", "slope", "curvature", "moisture", "sediment", "aeolianSediment", "windPath", "abrasion"], erosionPasses: 5 + Math.round(blueprint.terrain.erosion * 7), authority: "global-region" },
      generatedAt: now,
    },
    generation: { blueprint, provider: "procedural", quality: blueprint.presentation.background === "splat" ? "showpiece" : "complete", revision: 1, generatedAt: now },
    spawnZones: [
      { id: stableId("spawn-party", blueprint.seed), kind: "party", center: blueprint.zones[0].center, radius: Math.min(6, blueprint.zones[0].radius) },
      { id: stableId("spawn-enemy", blueprint.seed), kind: "enemy", center: blueprint.zones.find((zone) => zone.purpose === "encounter")?.center ?? blueprint.zones[2].center, radius: 5 },
      { id: stableId("spawn-exit", blueprint.seed), kind: "exit", center: blueprint.zones[blueprint.zones.length - 1].center, radius: 4 },
    ], validation,
  };
  return { map, blueprint, validation };
}

export function validateCompiledWorld(blueprint: WorldBlueprintV1, chunks: WorldChunkDescriptor[], entities: MapEntity[]): WorldValidationReport {
  const errors: string[] = [], warnings: string[] = [];
  const ids = new Set(chunks.map((chunk) => chunk.id));
  if (chunks.length !== (blueprint.width / WORLD_CHUNK_SIZE) * (blueprint.depth / WORLD_CHUNK_SIZE)) errors.push("The generated region is missing chunks");
  if (!blueprint.zones.some((zone) => zone.purpose === "entry") || !blueprint.zones.some((zone) => zone.purpose === "exit")) errors.push("The region requires an entry and exit");
  if (entities.some((entry) => entry.chunkId && !ids.has(entry.chunkId))) errors.push("An entity references an unknown chunk");
  if (!entities.some((entry) => entry.tags?.includes("world:path"))) warnings.push("The primary route is represented by terrain grading only");
  const reachable = new Set<string>();
  const pending = [blueprint.zones.find((zone) => zone.purpose === "entry")?.id].filter((value): value is string => Boolean(value));
  while (pending.length) {
    const id = pending.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const zone = blueprint.zones.find((entry) => entry.id === id);
    if (zone) pending.push(...zone.requiredConnections.filter((connection) => !reachable.has(connection)));
  }
  if (reachable.size !== blueprint.zones.length) errors.push("The zone graph is disconnected");
  return { valid: errors.length === 0, repairPasses: 0, reachableZoneIds: [...reachable], warnings, errors };
}

export function createSceneTemplate(map: GameMap, description = map.generation?.blueprint.description ?? map.name, existing?: SceneTemplateAsset): SceneTemplateAsset {
  const now = new Date().toISOString();
  const revision = { id: stableId("scene-revision", hashString(`${map.id}:${now}`)), map: structuredClone(map), createdAt: now, summary: existing ? "Updated from Scene Forge" : "Initial generated world" };
  return {
    id: existing?.id ?? stableId("scene-template", hashString(map.id)), name: map.name, description, map: structuredClone(map),
    thumbnailStorageKey: existing?.thumbnailStorageKey,
    propAssetIds: [...new Set(map.entities.map((entry) => entry.assetId).filter((id) => !id.startsWith("floor-") && !id.startsWith("wall-") && !id.startsWith("tree-") && !id.startsWith("token-") && !["chair", "table-round", "table-long", "barrel", "crate", "chest", "torch", "pillar", "door-wood", "rock"].includes(id)))],
    materialAssetIds: [...new Set(map.entities.flatMap((entry) => [...(entry.materialAssetId ? [entry.materialAssetId] : []), ...Object.values(entry.materialSlots ?? {}).filter((id): id is string => Boolean(id))]))],
    revisions: [revision, ...(existing?.revisions ?? [])].slice(0, MAX_SCENE_TEMPLATE_REVISIONS), createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
}
