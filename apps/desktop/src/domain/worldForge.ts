import { z } from "zod";
import { DEFAULT_SCENE_LIGHTING } from "./lighting";

export const WORLD_GENERATOR_REVISION = 8;
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
import { denseGroundCoverPoints } from "./worldScatter";

export const WORLD_CHUNK_SIZE = 16 as const;
export const WORLD_REGION_METERS: Record<WorldRegionSize, 64 | 128 | 256> = { small: 64, medium: 128, large: 256 };
export const MAX_WORLD_REPAIR_PASSES = 3;
export const MAX_SCENE_TEMPLATE_REVISIONS = 8;

const paletteSchema = z.object({ ground: z.string(), accent: z.string(), water: z.string() });
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

export const worldBlueprintSchema: z.ZodType<WorldBlueprintV1> = z.object({
  version: z.literal(1), id: z.string().min(1), name: z.string().min(1).max(100), description: z.string().min(1).max(2_000),
  seed: z.number().int().min(0).max(2_147_483_647), kind: z.enum(["interior", "exterior", "settlement", "dungeon"]),
  size: z.enum(["small", "medium", "large"]), width: z.union([z.literal(64), z.literal(128), z.literal(256)]),
  depth: z.union([z.literal(64), z.literal(128), z.literal(256)]), chunkSize: z.literal(16), gridShape: z.enum(["square", "hex"]),
  theme: z.enum(["dungeon", "tavern", "forest", "ruins", "cavern", "city", "town", "village", "plains", "mountains", "coast", "swamp"]),
  mood: z.enum(["natural", "warm", "moonlight", "crypt", "desert"]),
  biome: z.object({ id: z.enum(["forest", "plains", "mountains", "coast", "swamp", "desert", "snow", "urban", "dungeon", "cavern"]), vegetationDensity: z.number().min(0).max(1), treeStyle: z.enum(["pine", "dead", "broadleaf", "cypress", "none"]), palette: paletteSchema }),
  terrain: z.object({ baseHeight: z.number().min(-10).max(30), relief: z.number().min(0).max(12), roughness: z.number().min(0).max(1), erosion: z.number().min(0).max(1), moisture: z.number().min(0).max(1), waterLevel: z.number().min(-10).max(30).optional(), roadMaterial: z.enum(["stone", "wood", "dirt"]) }),
  zones: z.array(zoneSchema).min(2).max(24), assetRequests: z.array(assetRequestSchema).max(24),
  presentation: z.object({ background: z.enum(["none", "panorama", "splat"]), prompt: z.string().max(2_000) }),
}).superRefine((value, context) => {
  const expected = WORLD_REGION_METERS[value.size];
  if (value.width !== expected || value.depth !== expected) context.addIssue({ code: "custom", path: ["size"], message: "Region dimensions must match its size preset" });
  const zoneIds = new Set(value.zones.map((zone) => zone.id));
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
  return index === 0 ? base : `${base} · Alternate`;
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
      terrain: { baseHeight: 0, relief: kind === "interior" || kind === "dungeon" ? 0 : theme === "mountains" ? 10 : theme === "swamp" ? 4.8 : theme === "coast" ? 4 : biome.id === "plains" ? 4.5 : 5.5, roughness: index === 0 ? .48 : .64, erosion: .45, moisture: biome.id === "swamp" || biome.id === "coast" ? .85 : .42, waterLevel: biome.id === "swamp" || biome.id === "coast" ? .25 : undefined, roadMaterial: biome.id === "swamp" ? "wood" : kind === "settlement" ? "stone" : "dirt" },
      zones: zonesFor(size, kind, seed), assetRequests: defaultAssetRequests(kind, description, seed),
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

const chainDirectedSegments = <T extends { ax: number; az: number; bx: number; bz: number; flow: number }>(segments: T[]): T[][] => {
  const key = (x: number, z: number) => `${x.toFixed(4)}:${z.toFixed(4)}`;
  const byStart = new Map<string, T[]>(), incoming = new Set(segments.map((entry) => key(entry.bx, entry.bz)));
  for (const segment of segments) byStart.set(key(segment.ax, segment.az), [...(byStart.get(key(segment.ax, segment.az)) ?? []), segment]);
  const visited = new Set<T>(), chains: T[][] = [];
  const trace = (first: T) => {
    const chain: T[] = []; let current: T | undefined = first;
    while (current && !visited.has(current)) {
      visited.add(current); chain.push(current);
      current = (byStart.get(key(current.bx, current.bz)) ?? []).filter((candidate) => !visited.has(candidate)).sort((left, right) => right.flow - left.flow)[0];
    }
    if (chain.length) chains.push(chain);
  };
  segments.filter((entry) => !incoming.has(key(entry.ax, entry.az))).sort((left, right) => right.flow - left.flow).forEach(trace);
  segments.filter((entry) => !visited.has(entry)).sort((left, right) => right.flow - left.flow).forEach(trace);
  return chains;
};

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

type RibbonPoint = { x: number; y: number; z: number; width: number };

/** Keep the spline continuous at streamed chunk borders. Curves are fitted to
 * the complete regional network first; chunks receive overlapping excerpts of
 * that finished curve instead of independently rounding D8 fragments. */
const clipRibbonPaths = (paths: RibbonPoint[][], minX: number, maxX: number, minZ: number, maxZ: number, _margin = 2): RibbonPoint[][] => {
  const clipped: RibbonPoint[][] = [];
  for (const path of paths) {
    let current: RibbonPoint[] = [];
    for (let index = 0; index < path.length - 1; index++) {
      const a = path[index], b = path[index + 1];
      // A segment belongs to exactly one chunk by midpoint. Keeping both end
      // points preserves the regional tangent across the boundary without
      // drawing overlapping coplanar ribbons in neighboring chunks.
      const midpointX = (a.x + b.x) * .5, midpointZ = (a.z + b.z) * .5;
      const inside = midpointX >= minX && midpointX < maxX && midpointZ >= minZ && midpointZ < maxZ;
      if (inside) {
        if (!current.length) current.push(a);
        current.push(b);
      } else if (current.length) {
        if (current.length > 1) clipped.push(current);
        current = [];
      }
    }
    if (current.length > 1) clipped.push(current);
  }
  return clipped;
};

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
    const controls = simplifyPolyline(raw, 1.05);
    const curve = sampleCatmullRomSpline(cornerCutPolyline(controls, WORLD_VISUAL_CONFIG.roads.cornerCutIterations), WORLD_VISUAL_CONFIG.roads.splineSamplesPerSpan);
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

const segmentIntersection = (a: RibbonPoint, b: RibbonPoint, c: RibbonPoint, d: RibbonPoint): boolean => {
  const cross = (px: number, pz: number, qx: number, qz: number) => px * qz - pz * qx;
  const abx = b.x - a.x, abz = b.z - a.z, cdx = d.x - c.x, cdz = d.z - c.z;
  const denominator = cross(abx, abz, cdx, cdz);
  if (Math.abs(denominator) < 1e-6) return false;
  const acx = c.x - a.x, acz = c.z - a.z;
  const t = cross(acx, acz, cdx, cdz) / denominator;
  const u = cross(acx, acz, abx, abz) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
};

/** Derive exactly one deck from each true road/water crossing. River centerline
 * intersections and lake wet/dry transitions are authoritative; proximity to
 * a blue cell is not enough to manufacture a bridge. */
const collectBridgeSpans = (roads: RibbonPoint[][], rivers: RibbonPoint[][], fields: ReturnType<typeof buildWorldFieldSet>, waterLevel?: number): BridgeSpan[] => {
  const candidates: BridgeSpan[] = [];
  const riverSegments = rivers.flatMap((path) => path.slice(0, -1).map((point, index) => ({ a: point, b: path[index + 1], width: (point.width + path[index + 1].width) * .5 })));
  for (const path of roads) {
    let run: { start: RibbonPoint; end: RibbonPoint; width: number; waterWidth: number; crossing: "river" | "lake" } | undefined;
    const flush = () => {
      if (!run) return;
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
      const intersections = riverSegments.filter((river) => segmentIntersection(a, b, river.a, river.b));
      const lakeWet = waterLevel !== undefined && sampleWorldField(fields, "waterElevation", midpointX, midpointZ) < waterLevel - .025;
      const crossing = intersections.length > 0 || lakeWet;
      if (!crossing) { flush(); continue; }
      const waterWidth = Math.max(.8, ...intersections.map((entry) => entry.width));
      const crossingKind = intersections.length ? "river" : "lake";
      if (!run) run = { start: a, end: b, width: (a.width + b.width) * .5, waterWidth, crossing: crossingKind };
      else {
        run.end = b;
        run.width = Math.max(run.width, a.width, b.width);
        run.waterWidth = Math.max(run.waterWidth, waterWidth);
        if (crossingKind === "river") run.crossing = "river";
      }
    }
    flush();
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
  const repaired = repairZoneConnectivity(parsed);
  const blueprint = repaired.blueprint;
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
  const geologicalFields = buildWorldFieldSet(blueprint, blueprint.size === "large" ? 1 : .5);
  if (blueprint.terrain.waterLevel !== undefined && blueprint.kind !== "interior" && blueprint.kind !== "dungeon") {
    const sortedElevation = [...geologicalFields.waterElevation].sort((left, right) => left - right);
    const wetRatio = sortedElevation.filter((height) => height < blueprint.terrain.waterLevel!).length / sortedElevation.length;
    if (wetRatio > .28 || wetRatio < .015) {
      const targetRatio = blueprint.biome.id === "swamp" ? .16 : .09;
      blueprint.terrain.waterLevel = sortedElevation[Math.floor((sortedElevation.length - 1) * targetRatio)];
    }
    const rawWaterElevation = [...geologicalFields.waterElevation];
    const waterAt = (column: number, row: number) => rawWaterElevation[Math.max(0, Math.min(geologicalFields.resolution - 1, row)) * geologicalFields.resolution + Math.max(0, Math.min(geologicalFields.resolution - 1, column))];
    for (let row = 0; row < geologicalFields.resolution; row++) for (let column = 0; column < geologicalFields.resolution; column++) {
      geologicalFields.waterElevation[row * geologicalFields.resolution + column] = waterAt(column, row) * .4
        + (waterAt(column - 2, row) + waterAt(column + 2, row) + waterAt(column, row - 2) + waterAt(column, row + 2)) * .1
        + (waterAt(column - 2, row - 2) + waterAt(column + 2, row - 2) + waterAt(column - 2, row + 2) + waterAt(column + 2, row + 2)) * .05;
    }
    // The hydrology mask uses continuous eroded elevation while gameplay uses
    // rounded terraces. Carve the authoritative terrain below every accepted
    // wet sample so a rounded tier cannot pierce the lake surface and create
    // false contour bands or z-fighting.
    for (let index = 0; index < geologicalFields.elevation.length; index++) {
      const waterDepth = blueprint.terrain.waterLevel - geologicalFields.waterElevation[index];
      if (waterDepth <= .04) continue;
      geologicalFields.elevation[index] = Math.min(geologicalFields.elevation[index], blueprint.terrain.waterLevel - clamp(.16 + waterDepth * .42, .16, 1.4));
    }
  }
  const hydrology = geologicalFields.hydrology;
  const roads = buildAnisotropicRoadNetwork(blueprint, hydrology.riverSegments, Math.max(1, geologicalFields.cellSize * 2), geologicalFields);
  const fields = gradeWorldFieldRoads(geologicalFields, roads);
  const regionalRiverPaths: RibbonPoint[][] = chainDirectedSegments(hydrology.riverSegments).map((entries) => smoothRibbonPath([
    { x: entries[0].ax, y: sampleWorldField(fields, "elevation", entries[0].ax, entries[0].az) + entries[0].depth * .72, z: entries[0].az, width: entries[0].width },
    ...entries.map((entry) => ({
      x: entry.bx,
      y: sampleWorldField(fields, "elevation", entry.bx, entry.bz) + entry.depth * .72,
      z: entry.bz,
      width: entry.width * (.88 + simplexNoise2D(entry.bx * .075, entry.bz * .075, blueprint.seed + 8849) * .24),
    })),
  ], 8)).filter((path) => path.length > 1);
  const regionalRoadPaths = buildSmoothRoadPaths(roads, fields, blueprint.seed);
  const bridgeSpans = collectBridgeSpans(regionalRoadPaths, regionalRiverPaths, fields, blueprint.terrain.waterLevel);
  const treeGeometryVariants = new Map<string, ReturnType<typeof generateSpaceColonizedTree>>();
  const paintedRoads = regionalRoadPaths.flatMap((path, pathIndex) => path.slice(0, -1).map((point, index) => ({
    ax: point.x, az: point.z, bx: path[index + 1].x, bz: path[index + 1].z,
    width: (point.width + path[index + 1].width) * .5,
    fromZoneId: `paint-${pathIndex}`, toZoneId: `paint-${pathIndex}`,
  })));
  for (const zone of blueprint.zones) zone.center.y = sampleWorldField(fields, "elevation", zone.center.x, zone.center.z);
  const rooms = blueprint.kind === "interior" || blueprint.kind === "dungeon" ? generateBspRooms(blueprint.width * .82, blueprint.depth * .82, blueprint.seed, Math.min(14, Math.max(5, Math.round(blueprint.width / 12)))) : [];
  for (let cz = 0; cz < countZ; cz++) for (let cx = 0; cx < countX; cx++) {
    const chunkId = `chunk-${cx}-${cz}`;
    const x = -halfWidth + cx * WORLD_CHUNK_SIZE + WORLD_CHUNK_SIZE / 2;
    const z = -halfDepth + cz * WORLD_CHUNK_SIZE + WORLD_CHUNK_SIZE / 2;
    const flat = blueprint.kind === "interior" || blueprint.kind === "dungeon";
    const chunkMinX = x - WORLD_CHUNK_SIZE / 2, chunkMaxX = x + WORLD_CHUNK_SIZE / 2;
    const chunkMinZ = z - WORLD_CHUNK_SIZE / 2, chunkMaxZ = z + WORLD_CHUNK_SIZE / 2;
    const touchesChunk = (segment: { ax: number; az: number; bx: number; bz: number; width: number }, margin = 0) => Math.max(segment.ax, segment.bx) >= chunkMinX - segment.width - margin && Math.min(segment.ax, segment.bx) <= chunkMaxX + segment.width + margin && Math.max(segment.az, segment.bz) >= chunkMinZ - segment.width - margin && Math.min(segment.az, segment.bz) <= chunkMaxZ + segment.width + margin;
    const localRoads = paintedRoads.filter((road) => touchesChunk(road, 2));
    const localRivers = hydrology.riverSegments.filter((river) => touchesChunk(river, river.width));
    const geometry = terrainGeometryForChunk(blueprint, chunkMinX, chunkMinZ, localRoads, localRivers, fields);
    const heightfield = createHeightfield(geometry, 33);
    const navigation = buildNavigationGrid(geometry, 16);
    const height = sampleTerrainHeight(geometry, x, z);
    const pathDistance = roads.reduce((nearest, road) => Math.min(nearest, distanceToSegment(x, z, road.ax, road.az, road.bx, road.bz)), Number.POSITIVE_INFINITY);
    const chunkEntities: MapEntity[] = [];
    const terrain = entity(blueprint, chunkId, 0, terrainAsset(blueprint), `${blueprint.biome.id} terrain`, x, 0, z, 1, 0, ["world:terrain", `biome:${blueprint.biome.id}`]);
    terrain.worldGeometry = geometry;
    chunkEntities.push(terrain);

    // Water follows a half-meter elevation mask instead of flooding a whole
    // 16 m chunk when only its center is wet.
    if (blueprint.terrain.waterLevel !== undefined) {
      const waterCells = 64, waterSamples = waterCells + 1, waterCellSize = WORLD_CHUNK_SIZE / waterCells;
      const wetCells: boolean[] = [];
      const depthField: number[] = [];
      for (let waterZ = 0; waterZ < waterSamples; waterZ++) for (let waterX = 0; waterX < waterSamples; waterX++) {
        const waterXPosition = chunkMinX + waterX * waterCellSize;
        const waterZPosition = chunkMinZ + waterZ * waterCellSize;
        // A continuous Gaussian sample of the global erosion field gives
        // marching squares a signed shoreline instead of a binary pixel mask.
        const radius = .34;
        const center = sampleWorldField(fields, "waterElevation", waterXPosition, waterZPosition) * 4;
        const axial = sampleWorldField(fields, "waterElevation", waterXPosition - radius, waterZPosition)
          + sampleWorldField(fields, "waterElevation", waterXPosition + radius, waterZPosition)
          + sampleWorldField(fields, "waterElevation", waterXPosition, waterZPosition - radius)
          + sampleWorldField(fields, "waterElevation", waterXPosition, waterZPosition + radius);
        const diagonal = sampleWorldField(fields, "waterElevation", waterXPosition - radius, waterZPosition - radius)
          + sampleWorldField(fields, "waterElevation", waterXPosition + radius, waterZPosition - radius)
          + sampleWorldField(fields, "waterElevation", waterXPosition - radius, waterZPosition + radius)
          + sampleWorldField(fields, "waterElevation", waterXPosition + radius, waterZPosition + radius);
        const smoothedElevation = (center + axial * 2 + diagonal) / 16;
        const bankVariation = (simplexNoise2D(waterXPosition * .11, waterZPosition * .11, blueprint.seed + 9973) - .5) * .08;
        const depth = blueprint.terrain.waterLevel - .04 + bankVariation - smoothedElevation;
        depthField.push(depth);
        wetCells.push(depth > 0);
      }
      if (wetCells.some(Boolean)) {
        const shoreline: number[] = [], flowVectors: number[] = [];
        // Two-pass chamfer distance to dry land: linear time and stable across
        // machines, unlike scanning a 7x7 neighborhood for every water cell.
        const shoreDistance: number[] = wetCells.map((wet, index) => {
          const column = index % waterSamples, row = Math.floor(index / waterSamples);
          return wet && column > 0 && row > 0 && column < waterSamples - 1 && row < waterSamples - 1 ? 99 : 0;
        });
        const relax = (index: number, other: number, cost: number) => { if (other >= 0 && other < shoreDistance.length) shoreDistance[index] = Math.min(shoreDistance[index], shoreDistance[other] + cost); };
        for (let row = 0; row < waterSamples; row++) for (let column = 0; column < waterSamples; column++) {
          const index = row * waterSamples + column;
          if (column) relax(index, index - 1, 1);
          if (row) relax(index, index - waterSamples, 1);
          if (column && row) relax(index, index - waterSamples - 1, Math.SQRT2);
        }
        for (let row = waterSamples - 1; row >= 0; row--) for (let column = waterSamples - 1; column >= 0; column--) {
          const index = row * waterSamples + column;
          if (column < waterSamples - 1) relax(index, index + 1, 1);
          if (row < waterSamples - 1) relax(index, index + waterSamples, 1);
          if (column < waterSamples - 1 && row < waterSamples - 1) relax(index, index + waterSamples + 1, Math.SQRT2);
        }
        for (let waterZ = 0; waterZ < waterSamples; waterZ++) for (let waterX = 0; waterX < waterSamples; waterX++) {
          const index = waterZ * waterSamples + waterX;
          shoreline.push(wetCells[index] ? Math.max(0, 1 - (shoreDistance[index] - .5) / 2.5) : 0);
          const worldX = chunkMinX + waterX * waterCellSize, worldZ = chunkMinZ + waterZ * waterCellSize;
          // Standing water follows a broad prevailing-wind field. Feeding the
          // discrete D8 drainage direction into a lake exposed the hydrology
          // grid as a maze of eight-direction ripple cells. River ribbons keep
          // their true downstream tangent separately.
          const flowAngle = .72 + (terrainNoise(worldX * 1.8, worldZ * 1.8, blueprint.seed + 9917, .38) - .5) * 1.1;
          flowVectors.push(Math.cos(flowAngle), Math.sin(flowAngle));
        }
        const water = entity(blueprint, chunkId, 1000, "water-tile", "Elevation-masked shallow water", x, 0, z, 1, 0, ["world:water", "world:lake-mask", "non-colliding", "shader:animated-water"]);
        water.worldGeometry = { kind: "water", originX: chunkMinX, originZ: chunkMinZ, size: WORLD_CHUNK_SIZE, waterLevel: blueprint.terrain.waterLevel - .06, resolution: waterCells, wetCells, depthField, shoreline, flowVectors };
        chunkEntities.push(water);
      }
    }
    const chunkRiverPaths = clipRibbonPaths(regionalRiverPaths, chunkMinX, chunkMaxX, chunkMinZ, chunkMaxZ, 1.8)
      .filter((path) => path.some((point) => blueprint.terrain.waterLevel === undefined || sampleWorldField(fields, "waterElevation", point.x, point.z) >= blueprint.terrain.waterLevel - .04));
    if (chunkRiverPaths.length) {
      const river = entity(blueprint, chunkId, 1100, "water-tile", "Continuous downstream river", x, 0, z, 1, 0, ["world:water", "world:river", "world:ribbon", "non-colliding"]);
      river.worldGeometry = {
        kind: "river-ribbon", surface: "water", bankDepth: Math.max(.35, ...localRivers.map((entry) => entry.depth)), flowSpeed: .16,
        paths: chunkRiverPaths,
      };
      chunkEntities.push(river);
    }
    // A feathered spline decal supplies sub-vertex edge detail while the same
    // weight field remains authoritative for grading, navigation and foliage.
    const chunkRoadPaths = clipRibbonPaths(regionalRoadPaths, chunkMinX, chunkMaxX, chunkMinZ, chunkMaxZ, 1.5);
    if (chunkRoadPaths.length) {
      const roadPaint = entity(blueprint, chunkId, 1140, "floor-dirt", "Terrain-blended spline road", x, 0, z, 1, 0, ["world:road", "world:ribbon", "render:spline-decal"]);
      roadPaint.worldGeometry = { kind: "road-ribbon", surface: blueprint.terrain.roadMaterial, paths: chunkRoadPaths };
      chunkEntities.push(roadPaint);
    }
    const ownedBridges = bridgeSpans.filter((bridge) => {
      const midpointX = (bridge.ax + bridge.bx) / 2, midpointZ = (bridge.az + bridge.bz) / 2;
      return midpointX >= chunkMinX && midpointX < chunkMaxX && midpointZ >= chunkMinZ && midpointZ < chunkMaxZ;
    });
    for (const [index, bridge] of ownedBridges.entries()) {
      const dx = bridge.bx - bridge.ax, dz = bridge.bz - bridge.az;
      const length = Math.max(.5, Math.hypot(dx, dz));
      const midpointX = (bridge.ax + bridge.bx) / 2, midpointZ = (bridge.az + bridge.bz) / 2;
      const terrainHeight = sampleWorldField(fields, "elevation", midpointX, midpointZ);
      const deckHeight = Math.max(terrainHeight, blueprint.terrain.waterLevel ?? terrainHeight) + .08;
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
        const moisture = sampleWorldField(fields, "moisture", sampleX, sampleZ);
        const slope = sampleWorldField(fields, "slope", sampleX, sampleZ);
        const sediment = sampleWorldField(fields, "sediment", sampleX, sampleZ);
        const flow = Math.log1p(sampleWorldField(fields, "accumulation", sampleX, sampleZ)) / Math.log1p(Math.max(1, hydrology.maximumAccumulation));
        const climatePatch = simplexNoise2D((sampleX - 811) * .026, (sampleZ + 503) * .026, blueprint.seed + 3371);
        const forest = clamp((moisture - .32) * 1.45 + climatePatch * .78 + sediment * .28 - slope * 1.08, 0, 1);
        const riparian = clamp(flow * .78 + moisture * .5 - slope * .7, 0, 1);
        const meadow = clamp(1.08 - forest * .72 - slope * 1.25 + climatePatch * .18, 0, 1);
        const mask = layer === "canopy" ? forest * .92 + riparian * .22 : layer === "understory" ? forest * .58 + riparian * .7 : meadow * .66 + forest * .34 + riparian * .42;
        return clamp(blueprint.biome.vegetationDensity * mask * (layer === "canopy" ? WORLD_VISUAL_CONFIG.forest.densityMultiplier : 1.35), 0, .98);
      };
      const isReserved = (sampleX: number, sampleZ: number, padding: number) => blueprint.zones.some((zone) => Math.hypot(sampleX - zone.center.x, sampleZ - zone.center.z) < zone.radius * .58 + padding);
      const candidates = noiseWeightedPoissonPoints(x - 8, z - 8, 16, blueprint.biome.treeStyle === "none" ? 2.8 : WORLD_VISUAL_CONFIG.forest.minimumTreeRadius, blueprint.biome.treeStyle === "none" ? 5.2 : WORLD_VISUAL_CONFIG.forest.maximumTreeRadius, blueprint.seed + 333, (sampleX, sampleZ) => ecologyDensity(sampleX, sampleZ, "canopy"));
      const canopyLocations: Array<{ x: number; z: number; y: number; radius: number; priority: number }> = [];
      for (const [index, point] of candidates.entries()) {
        const pointHeight = sampleTerrainHeight(geometry, point.x, point.z);
        const slope = sampleWorldField(fields, "slope", point.x, point.z), moisture = sampleWorldField(fields, "moisture", point.x, point.z);
        const onRoute = roads.some((road) => distanceToSegment(point.x, point.z, road.ax, road.az, road.bx, road.bz) < road.width + 1.2);
        if (isReserved(point.x, point.z, 1.2) || onRoute || slope > Math.tan(Math.PI / 6) || (blueprint.terrain.waterLevel !== undefined && pointHeight < blueprint.terrain.waterLevel + .12)) continue;
        const assetId = blueprint.biome.treeStyle === "none" ? "rock" : treeAsset(blueprint.biome, point.priority);
        const ecologicalScale = (.68 + point.priority * .62) * (assetId === "tree-cypress" ? .88 + moisture * .24 : 1);
        canopyLocations.push({ x: point.x, z: point.z, y: pointHeight, radius: 2.25 * ecologicalScale, priority: point.priority });
        const tree = entity(blueprint, chunkId, 10 + index, assetId, blueprint.biome.treeStyle === "none" ? "Regional stone" : `${blueprint.biome.treeStyle} space-colonized tree`, point.x, pointHeight, point.z, ecologicalScale, point.priority * 360, ["world:vegetation", "ecology:canopy", "generator:space-colonization", `instance-family:${assetId}`]);
        if (blueprint.biome.treeStyle !== "none") {
          // Six deterministic botanical variants are shared across the region;
          // transforms still vary per instance. This mirrors an HISM family and
          // avoids solving space colonization hundreds of times per compile.
          const variant = Math.min(5, Math.floor(point.priority * 6));
          const variantKey = `${blueprint.biome.treeStyle}:${variant}`;
          let treeGeometry = treeGeometryVariants.get(variantKey);
          if (!treeGeometry) {
            treeGeometry = generateSpaceColonizedTree(blueprint.seed + variant * 7919, blueprint.biome.treeStyle);
            treeGeometryVariants.set(variantKey, treeGeometry);
          }
          tree.worldGeometry = treeGeometry;
        }
        chunkEntities.push(tree);
      }
      if (blueprint.biome.treeStyle !== "none") {
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
          if (point.x < chunkMinX || point.x >= chunkMaxX || point.z < chunkMinZ || point.z >= chunkMaxZ || isReserved(point.x, point.z, .55) || onRoute || slope > .72 || (blueprint.terrain.waterLevel !== undefined && pointHeight < blueprint.terrain.waterLevel - .08)) continue;
          const wetland = moisture > .68 && (blueprint.biome.id === "swamp" || blueprint.biome.id === "coast");
          const assetId = wetland ? "reeds-wetland" : "shrub-broadleaf";
          chunkEntities.push(entity(blueprint, chunkId, 80 + index, assetId, wetland ? "Wet bank reeds" : "Regional understory", point.x, pointHeight, point.z, .55 + point.priority * .45, point.priority * 360, ["world:vegetation", wetland ? "ecology:riparian" : "ecology:understory", `instance-family:${assetId}`]));
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
          return sampleWorldField(fields, "slope", point.x, point.z) < WORLD_VISUAL_CONFIG.grass.maximumSlope
            && !roads.some((road) => distanceToSegment(point.x, point.z, road.ax, road.az, road.bx, road.bz) < road.width + WORLD_VISUAL_CONFIG.grass.roadClearanceMeters)
            && (blueprint.terrain.waterLevel === undefined || pointHeight >= blueprint.terrain.waterLevel + .03);
        });
        if (groundPoints.length) {
          const cover = entity(blueprint, chunkId, 140, "shrub-broadleaf", "GPU-instanced ecological ground cover", x, 0, z, 1, 0, ["world:vegetation", "ecology:ground-cover", "render:gpu-instanced"]);
          cover.worldGeometry = { kind: "ground-cover", color: blueprint.biome.id === "snow" ? "#aab8aa" : blueprint.biome.id === "swamp" ? "#526f42" : "#6f9848", instances: groundPoints.map((point) => ({ x: point.x, y: sampleTerrainHeight(geometry, point.x, point.z) + .015, z: point.z, scale: WORLD_VISUAL_CONFIG.grass.minimumScale + point.priority * WORLD_VISUAL_CONFIG.grass.scaleVariation, rotation: point.priority * Math.PI * 2 })) };
          chunkEntities.push(cover);
        }
      }
    }

    const settlementZone = blueprint.zones.find((zone) => zone.purpose === "settlement" && Math.hypot(x - zone.center.x, z - zone.center.z) < zone.radius + 12);
    if (blueprint.kind === "settlement" && settlementZone && pathDistance < WORLD_CHUNK_SIZE * 1.2 && ((cx + cz) % 2 === 0)) {
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
      building.worldGeometry = generateCgaBuilding(blueprint.seed + cx * 7919 + cz * 104729, prominent, blueprint.terrain.roadMaterial === "stone" ? "stone" : "timber");
      chunkEntities.push(building);
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

  const landmarkZone = blueprint.zones.find((zone) => zone.purpose === "landmark") ?? blueprint.zones[Math.min(2, blueprint.zones.length - 1)];
  blueprint.assetRequests.forEach((request, index) => {
    const materialRequest = /material|surface|texture|ground|wall finish/i.test(`${request.name} ${request.description}`);
    if (materialRequest) {
      for (const terrain of entities.filter((entry) => entry.tags?.includes("world:terrain"))) terrain.tags = [...(terrain.tags ?? []), `asset-request:${request.id}`];
      return;
    }
    if (!landmarkZone || index >= 4) return;
    const owner = chunks.find((chunk) => landmarkZone.center.x >= chunk.bounds.min.x && landmarkZone.center.x < chunk.bounds.max.x && landmarkZone.center.z >= chunk.bounds.min.z && landmarkZone.center.z < chunk.bounds.max.z);
    if (!owner) return;
    const placeholder = entity(blueprint, owner.id, 300 + index, "rock", `${request.name} placeholder`, landmarkZone.center.x + index * 2.2, landmarkZone.center.y, landmarkZone.center.z, 1.2, index * 37, ["world:asset-placeholder", `asset-request:${request.id}`]);
    entities.push(placeholder); owner.entityIds.push(placeholder.id);
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
  const now = new Date().toISOString();
  const map: GameMap = {
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
      version: 1, generatorRevision: WORLD_GENERATOR_REVISION, blueprintId: blueprint.id, seed: blueprint.seed, chunkSize: WORLD_CHUNK_SIZE, chunks,
      hydrology: { resolution: hydrology.resolution, cellSize: hydrology.cellSize, riverSegments: hydrology.riverSegments.length, maximumAccumulation: hydrology.maximumAccumulation, sinkFilled: true, filledCellCount: hydrology.filledCellCount, maximumFillDepth: hydrology.maximumFillDepth },
      fieldSet: { resolution: fields.resolution, cellSize: fields.cellSize, layers: ["elevation", "filledElevation", "flowDirection", "accumulation", "slope", "curvature", "moisture", "sediment"], erosionPasses: 5 + Math.round(blueprint.terrain.erosion * 7), authority: "global-region" },
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
    materialAssetIds: [...new Set(map.entities.flatMap((entry) => entry.materialAssetId ? [entry.materialAssetId] : []))],
    revisions: [revision, ...(existing?.revisions ?? [])].slice(0, MAX_SCENE_TEMPLATE_REVISIONS), createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
}
