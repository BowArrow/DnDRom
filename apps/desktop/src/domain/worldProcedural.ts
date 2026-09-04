import type { WorldBlueprintV1, WorldTerrainGeometry, WorldZone } from "./types";

export interface HeightfieldData {
  resolution: number;
  size: number;
  originX: number;
  originZ: number;
  heights: number[];
  roadWeights: number[];
  terraceLevels: number[];
  minimum: number;
  maximum: number;
}

export interface NavigationGrid {
  resolution: number;
  cellSize: number;
  walkable: boolean[];
  connected: boolean;
  walkableCells: number;
  blockedCells: number;
}

export interface RoadSegment { ax: number; az: number; bx: number; bz: number; width: number; fromZoneId: string; toZoneId: string; bridge?: boolean }
export interface RiverSegment { ax: number; az: number; bx: number; bz: number; width: number; depth: number; flow: number }
export interface HydrologyField {
  resolution: number;
  cellSize: number;
  filledHeights: number[];
  flowDirection: number[];
  accumulation: number[];
  riverSegments: RiverSegment[];
  maximumAccumulation: number;
  filledCellCount: number;
  maximumFillDepth: number;
}
export interface DepressionFillResult {
  filledHeights: number[];
  /** The already-flooded spillway neighbor that drains each non-outlet cell. */
  drainageParent: number[];
  /** Min-heap removal order. Reversing it is a valid accumulation order. */
  floodOrder: number[];
  outletIndices: number[];
  filledCellCount: number;
  maximumFillDepth: number;
}
export interface PoissonPoint { x: number; z: number; priority: number }
export interface SplinePoint { x: number; z: number }
export interface ProceduralRoom { id: string; x: number; z: number; width: number; depth: number; connections: string[] }
export interface TerrainSurfaceWeights { soil: number; vegetation: number; rock: number; wet: number; snow: number; road: number }
export interface WorldFieldSet {
  resolution: number;
  cellSize: number;
  originX: number;
  originZ: number;
  width: number;
  depth: number;
  elevation: number[];
  /** Continuous eroded/carved elevation used by hydrology and shore masks. */
  waterElevation: number[];
  filledElevation: number[];
  flowDirection: number[];
  accumulation: number[];
  slope: number[];
  curvature: number[];
  moisture: number[];
  sediment: number[];
  hydrology: HydrologyField;
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));
const smooth = (value: number): number => value * value * (3 - 2 * value);
const smoother = (value: number): number => value * value * value * (value * (value * 6 - 15) + 10);
const hash = (x: number, z: number, seed: number): number => {
  let value = Math.imul((x | 0) ^ seed, 0x45d9f3b) ^ Math.imul((z | 0) + seed, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
};
const lattice = (x: number, z: number, seed: number): number => hash(x, z, seed);
const valueNoise = (x: number, z: number, seed: number): number => {
  const x0 = Math.floor(x), z0 = Math.floor(z), tx = smooth(x - x0), tz = smooth(z - z0);
  const a = lattice(x0, z0, seed), b = lattice(x0 + 1, z0, seed), c = lattice(x0, z0 + 1, seed), d = lattice(x0 + 1, z0 + 1, seed);
  const top = a + (b - a) * tx, bottom = c + (d - c) * tx;
  return top + (bottom - top) * tz;
};

/** Seeded 2D simplex gradient noise normalized to 0..1. Ecology uses this
 * separately from landform fBM so forests form broad natural clusters. */
export function simplexNoise2D(x: number, z: number, seed: number): number {
  const skew = (Math.sqrt(3) - 1) / 2, unskew = (3 - Math.sqrt(3)) / 6;
  const s = (x + z) * skew, i = Math.floor(x + s), j = Math.floor(z + s), t = (i + j) * unskew;
  const x0 = x - (i - t), z0 = z - (j - t), i1 = x0 > z0 ? 1 : 0, j1 = x0 > z0 ? 0 : 1;
  const corners = [[x0, z0, i, j], [x0 - i1 + unskew, z0 - j1 + unskew, i + i1, j + j1], [x0 - 1 + 2 * unskew, z0 - 1 + 2 * unskew, i + 1, j + 1]];
  const gradients = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  let sum = 0;
  for (const [dx, dz, gx, gz] of corners) {
    const attenuation = .5 - dx * dx - dz * dz;
    if (attenuation <= 0) continue;
    const gradient = gradients[Math.floor(hash(gx, gz, seed) * gradients.length) % gradients.length];
    sum += attenuation ** 4 * (gradient[0] * dx + gradient[1] * dz);
  }
  return clamp(.5 + sum * 35, 0, 1);
}

/** Stable domain-warped FBM. It is sampled in global coordinates so chunk edges match bit-for-bit. */
export function terrainNoise(x: number, z: number, seed: number, roughness = .5): number {
  const warpX = (valueNoise(x * .012, z * .012, seed + 17) - .5) * 18;
  const warpZ = (valueNoise(x * .012, z * .012, seed + 29) - .5) * 18;
  let frequency = .025, amplitude = 1, sum = 0, weight = 0;
  for (let octave = 0; octave < 5; octave++) {
    sum += valueNoise((x + warpX) * frequency, (z + warpZ) * frequency, seed + octave * 977) * amplitude;
    weight += amplitude;
    frequency *= 2.03;
    amplitude *= clamp(roughness, .22, .78);
  }
  return sum / weight;
}

/** Slope/elevation/moisture weights used by the terrain material layer. */
export function terrainSurfaceWeights(geometry: WorldTerrainGeometry, x: number, z: number, normalY: number): TerrainSurfaceWeights {
  const slope = clamp(1 - Math.abs(normalY), 0, 1);
  const elevation = geometry.relief > .001 ? clamp((sampleTerrainHeight(geometry, x, z) - geometry.baseHeight) / geometry.relief + .5, 0, 1) : .5;
  const moistureNoise = terrainNoise(x - 907, z + 613, geometry.seed + 2903, .48);
  const riverDistance = (geometry.rivers ?? []).reduce((nearest, river) => Math.min(nearest, distanceToSegment(x, z, river.ax, river.az, river.bx, river.bz) / Math.max(.2, river.width)), Number.POSITIVE_INFINITY);
  const wet = clamp((1 - Math.min(1, riverDistance / 2.4)) * .82 + moistureNoise * .18, 0, 1);
  const snowBiome = geometry.biomeId === "snow";
  const snow = snowBiome ? clamp((elevation - .48) * 2.2 + (1 - slope) * .35, 0, 1) : 0;
  const rock = clamp(slope * 2.35 + Math.max(0, elevation - .72) * 1.5 - snow * .65, 0, 1);
  const vegetation = clamp((1 - slope * 2.6) * (1 - wet * .55) * (1 - snow) * (.62 + moistureNoise * .38), 0, 1);
  const road = roadSurfaceWeight(geometry, x, z);
  const natural = 1 - road;
  const soil = Math.max(0, 1 - rock - vegetation * .72 - wet * .35 - snow);
  const total = Math.max(.0001, soil + vegetation + rock + wet + snow);
  return { soil: soil / total * natural, vegetation: vegetation / total * natural, rock: rock / total * natural, wet: wet / total * natural, snow: snow / total * natural, road };
}

export function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, length = dx * dx + dz * dz;
  const t = length > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / length, 0, 1) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/** Cosine-like road paint used by both the terrain albedo and foliage mask. */
export function roadSurfaceWeight(geometry: WorldTerrainGeometry, x: number, z: number): number {
  let weight = 0;
  for (const path of geometry.paths) {
    if (path.bridge) continue;
    const edgeVariation = (simplexNoise2D(x * .105, z * .105, geometry.seed + 5197) - .5) * Math.min(.42, path.width * .14);
    const distance = distanceToSegment(x, z, path.ax, path.az, path.bx, path.bz) - edgeVariation;
    const core = Math.max(.32, path.width * .36);
    const shoulder = Math.max(.38, path.width * .48);
    if (distance <= core) weight = 1;
    else if (distance < core + shoulder) weight = Math.max(weight, 1 - smoother((distance - core) / shoulder));
  }
  return clamp(weight, 0, 1);
}

/** One-meter gameplay terraces with a rounded riser instead of voxel walls. */
export function roundedTerraceHeight(height: number, origin = 0, step = 1, riserFraction = .24): number {
  if (step <= 0) return height;
  const scaled = (height - origin) / step;
  const level = Math.floor(scaled);
  const fraction = scaled - level;
  const start = clamp(1 - riserFraction, .5, .95);
  const riser = smoother(clamp((fraction - start) / Math.max(.001, 1 - start), 0, 1));
  return origin + (level + riser) * step;
}

export function sampleTerrainHeight(geometry: WorldTerrainGeometry, x: number, z: number): number {
  if (geometry.heightfield) {
    const resolution = geometry.heightfield.resolution;
    const gridX = clamp((x - geometry.originX) / geometry.size * (resolution - 1), 0, resolution - 1);
    const gridZ = clamp((z - geometry.originZ) / geometry.size * (resolution - 1), 0, resolution - 1);
    const x0 = Math.floor(gridX), z0 = Math.floor(gridZ), x1 = Math.min(resolution - 1, x0 + 1), z1 = Math.min(resolution - 1, z0 + 1);
    const tx = gridX - x0, tz = gridZ - z0;
    const heights = geometry.heightfield.heights;
    const top = heights[z0 * resolution + x0] + (heights[z0 * resolution + x1] - heights[z0 * resolution + x0]) * tx;
    const bottom = heights[z1 * resolution + x0] + (heights[z1 * resolution + x1] - heights[z1 * resolution + x0]) * tx;
    return top + (bottom - top) * tz;
  }
  if (geometry.relief <= 0) return geometry.baseHeight;
  const raw = geometry.baseHeight + (terrainNoise(x, z, geometry.seed, geometry.roughness) - .5) * geometry.relief;
  // A cheap thermal-erosion approximation: blend toward a wider, smoother sample.
  const broad = geometry.baseHeight + (terrainNoise(x * .55, z * .55, geometry.seed + 503, Math.max(.25, geometry.roughness * .72)) - .5) * geometry.relief * .8;
  let height = raw + (broad - raw) * clamp(geometry.erosion, 0, 1) * .55;
  let nearestRiver: RiverSegment | undefined;
  let nearestRiverDistance = Number.POSITIVE_INFINITY;
  for (const river of geometry.rivers ?? []) {
    const distance = distanceToSegment(x, z, river.ax, river.az, river.bx, river.bz);
    if (distance < nearestRiverDistance) { nearestRiver = river; nearestRiverDistance = distance; }
  }
  if (nearestRiver && nearestRiverDistance < nearestRiver.width * 1.8) {
    const normalized = clamp(nearestRiverDistance / Math.max(.1, nearestRiver.width), 0, 1);
    height -= nearestRiver.depth * (1 - normalized) ** 2;
  }
  let nearest = Number.POSITIVE_INFINITY;
  for (const path of geometry.paths) nearest = Math.min(nearest, distanceToSegment(x, z, path.ax, path.az, path.bx, path.bz) / Math.max(.25, path.width));
  if (Number.isFinite(nearest) && nearest < 2.2) {
    const pathBlend = 1 - smooth(clamp((nearest - .65) / 1.55, 0, 1));
    const graded = geometry.baseHeight + (terrainNoise(x * .16, z * .16, geometry.seed + 811, .3) - .5) * Math.min(.35, geometry.relief * .08);
    height += (graded - height) * pathBlend;
  }
  return height;
}

export function createHeightfield(geometry: WorldTerrainGeometry, resolution = 17): HeightfieldData {
  const safeResolution = Math.max(3, Math.floor(resolution));
  const heights: number[] = [], roadWeights: number[] = [], terraceLevels: number[] = [];
  let minimum = Number.POSITIVE_INFINITY, maximum = Number.NEGATIVE_INFINITY;
  for (let row = 0; row < safeResolution; row++) for (let column = 0; column < safeResolution; column++) {
    const x = geometry.originX + column / (safeResolution - 1) * geometry.size;
    const z = geometry.originZ + row / (safeResolution - 1) * geometry.size;
    const height = sampleTerrainHeight(geometry, x, z);
    heights.push(height);
    roadWeights.push(roadSurfaceWeight(geometry, x, z));
    terraceLevels.push(Math.round(height - geometry.baseHeight));
    minimum = Math.min(minimum, height); maximum = Math.max(maximum, height);
  }
  return { resolution: safeResolution, size: geometry.size, originX: geometry.originX, originZ: geometry.originZ, heights, roadWeights, terraceLevels, minimum, maximum };
}

export function buildZoneRoadGraph(zones: WorldZone[]): RoadSegment[] {
  const byId = new Map(zones.map((zone) => [zone.id, zone]));
  const seen = new Set<string>();
  const roads: RoadSegment[] = [];
  for (const zone of zones) for (const connection of zone.requiredConnections) {
    const other = byId.get(connection);
    if (!other) continue;
    const key = [zone.id, other.id].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    roads.push({ ax: zone.center.x, az: zone.center.z, bx: other.center.x, bz: other.center.z, width: zone.purpose === "settlement" || other.purpose === "settlement" ? 2.8 : 2.1, fromZoneId: zone.id, toZoneId: other.id });
  }
  return roads;
}

class MinHeap<T> {
  private values: Array<{ priority: number; value: T }> = [];
  get size(): number { return this.values.length; }
  push(priority: number, value: T): void {
    const item = { priority, value }; this.values.push(item);
    for (let index = this.values.length - 1; index > 0;) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].priority <= priority) break;
      this.values[index] = this.values[parent]; index = parent; this.values[index] = item;
    }
  }
  pop(): T | undefined {
    if (!this.values.length) return undefined;
    const first = this.values[0].value, tail = this.values.pop()!;
    if (this.values.length) {
      this.values[0] = tail;
      for (let index = 0;;) {
        const left = index * 2 + 1, right = left + 1;
        if (left >= this.values.length) break;
        const child = right < this.values.length && this.values[right].priority < this.values[left].priority ? right : left;
        if (this.values[index].priority <= this.values[child].priority) break;
        [this.values[index], this.values[child]] = [this.values[child], this.values[index]]; index = child;
      }
    }
    return first;
  }
}

const gridNeighbors = (index: number, columns: number, rows = columns): number[] => {
  const x = index % columns, z = Math.floor(index / columns), result: number[] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if ((!dx && !dz) || x + dx < 0 || z + dz < 0 || x + dx >= columns || z + dz >= rows) continue;
    result.push((z + dz) * columns + x + dx);
  }
  return result;
};

/**
 * Exact Wang-Liu boundary flood. It never adds an artificial epsilon: a
 * depression is raised only to max(original elevation, spillway elevation).
 * The drainage-parent tree resolves equal-height flats for the later D8 pass.
 */
export function fillDepressionsWangLiu(elevations: readonly number[], columns: number, rows = columns): DepressionFillResult {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 2 || rows < 2 || elevations.length !== columns * rows) throw new Error("Wang-Liu input dimensions must match a grid of at least 2 by 2");
  if (elevations.some((elevation) => !Number.isFinite(elevation))) throw new Error("Wang-Liu elevations must be finite");
  const filledHeights = [...elevations], drainageParent = new Array(elevations.length).fill(-1), visited = new Uint8Array(elevations.length);
  const heap = new MinHeap<number>(), floodOrder: number[] = [], outletIndices: number[] = [];
  const enqueueOutlet = (index: number) => {
    if (visited[index]) return;
    visited[index] = 1;
    outletIndices.push(index);
    heap.push(filledHeights[index], index);
  };
  for (let column = 0; column < columns; column++) {
    enqueueOutlet(column);
    enqueueOutlet((rows - 1) * columns + column);
  }
  for (let row = 1; row < rows - 1; row++) {
    enqueueOutlet(row * columns);
    enqueueOutlet(row * columns + columns - 1);
  }
  while (heap.size) {
    const index = heap.pop()!;
    floodOrder.push(index);
    for (const next of gridNeighbors(index, columns, rows)) {
      if (visited[next]) continue;
      visited[next] = 1;
      filledHeights[next] = Math.max(elevations[next], filledHeights[index]);
      drainageParent[next] = index;
      heap.push(filledHeights[next], next);
    }
  }
  let filledCellCount = 0, maximumFillDepth = 0;
  for (let index = 0; index < elevations.length; index++) {
    const depth = filledHeights[index] - elevations[index];
    if (depth > 1e-9) filledCellCount++;
    maximumFillDepth = Math.max(maximumFillDepth, depth);
  }
  return { filledHeights, drainageParent, floodOrder, outletIndices, filledCellCount, maximumFillDepth };
}

const buildDrainage = (raw: readonly number[], resolution: number, cellSize: number, originX: number, originZ: number): HydrologyField => {
  const depressionFill = fillDepressionsWangLiu(raw, resolution);
  const filled = depressionFill.filledHeights;
  const outletSet = new Set(depressionFill.outletIndices);
  const flowDirection = new Array(raw.length).fill(-1);
  for (let index = 0; index < raw.length; index++) {
    if (outletSet.has(index)) continue;
    const x = index % resolution, z = Math.floor(index / resolution);
    const candidates = gridNeighbors(index, resolution).filter((next) => filled[next] < filled[index]);
    if (candidates.length) flowDirection[index] = candidates.reduce((best, next) => {
      const nextX = next % resolution, nextZ = Math.floor(next / resolution), bestX = best % resolution, bestZ = Math.floor(best / resolution);
      const nextSlope = (filled[index] - filled[next]) / Math.hypot(nextX - x, nextZ - z);
      const bestSlope = (filled[index] - filled[best]) / Math.hypot(bestX - x, bestZ - z);
      return nextSlope > bestSlope || (nextSlope === bestSlope && next < best) ? next : best;
    }, candidates[0]);
    else flowDirection[index] = depressionFill.drainageParent[index];
  }
  const accumulation = new Array(raw.length).fill(1);
  for (let orderIndex = depressionFill.floodOrder.length - 1; orderIndex >= 0; orderIndex--) {
    const index = depressionFill.floodOrder[orderIndex];
    if (flowDirection[index] >= 0) accumulation[flowDirection[index]] += accumulation[index];
  }
  // Only channels draining a meaningful share of the region become visible
  // rivers. Lower values expose the entire D8 graph as blue spaghetti.
  const maximumAccumulation = accumulation.reduce((maximum, value) => Math.max(maximum, value), 1), threshold = Math.max(48, resolution * resolution * .1, maximumAccumulation * .35);
  const riverSegments: RiverSegment[] = [];
  for (let index = 0; index < raw.length; index++) {
    const next = flowDirection[index];
    if (next < 0 || accumulation[index] < threshold) continue;
    const x = index % resolution, z = Math.floor(index / resolution), nx = next % resolution, nz = Math.floor(next / resolution);
    const strength = Math.sqrt(accumulation[index] / Math.max(1, maximumAccumulation));
    riverSegments.push({
      ax: originX + x * cellSize, az: originZ + z * cellSize,
      bx: originX + nx * cellSize, bz: originZ + nz * cellSize,
      width: .45 + strength * 2.35, depth: .16 + strength * .82, flow: accumulation[index],
    });
  }
  return { resolution, cellSize, filledHeights: filled, flowDirection, accumulation, riverSegments, maximumAccumulation, filledCellCount: depressionFill.filledCellCount, maximumFillDepth: depressionFill.maximumFillDepth };
};

const landformHeight = (blueprint: WorldBlueprintV1, x: number, z: number): number => {
  if (blueprint.kind === "interior" || blueprint.kind === "dungeon") return blueprint.terrain.baseHeight;
  const relief = Math.max(.15, blueprint.terrain.relief);
  const macro = terrainNoise(x * .55, z * .55, blueprint.seed + 101, .5);
  const detail = terrainNoise(x * 1.8, z * 1.8, blueprint.seed + 809, blueprint.terrain.roughness);
  const ridged = 1 - Math.abs(terrainNoise(x * .82 + 410, z * .82 - 270, blueprint.seed + 1601, .62) * 2 - 1);
  const normalizedX = x / Math.max(1, blueprint.width * .5), normalizedZ = z / Math.max(1, blueprint.depth * .5);
  const continental = clamp(1 - Math.hypot(normalizedX, normalizedZ) * .22, .35, 1);
  const mountainBias = blueprint.biome.id === "mountains" ? .48 : .16;
  const basinBias = blueprint.biome.id === "swamp" || blueprint.biome.id === "coast" ? -.15 * (1 - Math.min(1, Math.hypot(normalizedX, normalizedZ))) : 0;
  return blueprint.terrain.baseHeight + relief * (((macro - .5) * .72 + (detail - .5) * .22 + (ridged - .55) * mountainBias) * continental + basinBias);
};

const thermalErode = (source: readonly number[], resolution: number, strength: number, passes: number): number[] => {
  let heights = [...source];
  const talus = .18;
  for (let pass = 0; pass < passes; pass++) {
    const delta = new Array(heights.length).fill(0);
    for (let z = 1; z < resolution - 1; z++) for (let x = 1; x < resolution - 1; x++) {
      const index = z * resolution + x;
      let lowest = index, drop = 0;
      for (const neighbor of gridNeighbors(index, resolution)) {
        const candidate = heights[index] - heights[neighbor];
        if (candidate > drop) { drop = candidate; lowest = neighbor; }
      }
      if (lowest !== index && drop > talus) {
        const amount = (drop - talus) * .22 * strength;
        delta[index] -= amount; delta[lowest] += amount;
      }
    }
    heights = heights.map((height, index) => height + delta[index]);
  }
  return heights;
};

/** Builds the region once, globally. Every chunk is then sampled from this
 * authority so terrain, drainage, roads, ecology, and navigation agree. */
export function buildWorldFieldSet(blueprint: WorldBlueprintV1, requestedCellSize = 1): WorldFieldSet {
  const resolution = Math.round(Math.max(blueprint.width, blueprint.depth) / requestedCellSize) + 1;
  const cellSize = blueprint.width / (resolution - 1), originX = -blueprint.width / 2, originZ = -blueprint.depth / 2;
  const raw = new Array(resolution * resolution);
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) raw[z * resolution + x] = landformHeight(blueprint, originX + x * cellSize, originZ + z * cellSize);
  const eroded = thermalErode(raw, resolution, clamp(blueprint.terrain.erosion, 0, 1), 5 + Math.round(blueprint.terrain.erosion * 7));
  const initialDrainage = buildDrainage(eroded, resolution, cellSize, originX, originZ);
  const threshold = Math.max(48, resolution * resolution * .1, initialDrainage.maximumAccumulation * .35);
  const carveChannel = (height: number, index: number) => {
    const flow = initialDrainage.accumulation[index];
    if (flow < threshold) return height;
    const normalized = Math.sqrt(flow / Math.max(1, initialDrainage.maximumAccumulation));
    return height - (.1 + normalized * .9) * clamp(blueprint.terrain.moisture + .25, .25, 1);
  };
  const waterElevation = eroded.map(carveChannel);
  const terraced = eroded.map((height) => blueprint.kind === "interior" || blueprint.kind === "dungeon" ? height : roundedTerraceHeight(height, blueprint.terrain.baseHeight));
  const carved = terraced.map(carveChannel);
  const hydrology = buildDrainage(waterElevation, resolution, cellSize, originX, originZ);
  const slope = new Array(carved.length).fill(0), curvature = new Array(carved.length).fill(0), sediment = new Array(carved.length).fill(0), moisture = new Array(carved.length).fill(0);
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
    const index = z * resolution + x, left = carved[z * resolution + Math.max(0, x - 1)], right = carved[z * resolution + Math.min(resolution - 1, x + 1)];
    const down = carved[Math.max(0, z - 1) * resolution + x], up = carved[Math.min(resolution - 1, z + 1) * resolution + x];
    const center = carved[index], dx = (right - left) / Math.max(.001, cellSize * 2), dz = (up - down) / Math.max(.001, cellSize * 2);
    slope[index] = Math.hypot(dx, dz);
    curvature[index] = left + right + down + up - center * 4;
    sediment[index] = clamp(.5 + curvature[index] * .8 - slope[index] * .35, 0, 1);
    const flowMoisture = Math.log1p(hydrology.accumulation[index]) / Math.log1p(Math.max(1, hydrology.maximumAccumulation));
    moisture[index] = clamp(blueprint.terrain.moisture * .6 + flowMoisture * .55 - slope[index] * .16, 0, 1);
  }
  return { resolution, cellSize, originX, originZ, width: blueprint.width, depth: blueprint.depth, elevation: carved, waterElevation, filledElevation: hydrology.filledHeights, flowDirection: hydrology.flowDirection, accumulation: hydrology.accumulation, slope, curvature, moisture, sediment, hydrology };
}

export function sampleWorldField(field: WorldFieldSet, layer: "elevation" | "waterElevation" | "filledElevation" | "accumulation" | "slope" | "curvature" | "moisture" | "sediment", x: number, z: number): number {
  const values = field[layer];
  const gx = clamp((x - field.originX) / field.cellSize, 0, field.resolution - 1), gz = clamp((z - field.originZ) / field.cellSize, 0, field.resolution - 1);
  const x0 = Math.floor(gx), z0 = Math.floor(gz), x1 = Math.min(field.resolution - 1, x0 + 1), z1 = Math.min(field.resolution - 1, z0 + 1), tx = gx - x0, tz = gz - z0;
  const top = values[z0 * field.resolution + x0] + (values[z0 * field.resolution + x1] - values[z0 * field.resolution + x0]) * tx;
  const bottom = values[z1 * field.resolution + x0] + (values[z1 * field.resolution + x1] - values[z1 * field.resolution + x0]) * tx;
  return top + (bottom - top) * tz;
}

/** Bilinear-friendly nearest D8 direction for water advection. */
export function sampleWorldFlow(field: WorldFieldSet, x: number, z: number): { x: number; z: number } {
  const column = Math.max(0, Math.min(field.resolution - 1, Math.round((x - field.originX) / field.cellSize)));
  const row = Math.max(0, Math.min(field.resolution - 1, Math.round((z - field.originZ) / field.cellSize)));
  const index = row * field.resolution + column;
  const next = field.flowDirection[index];
  if (next < 0) return { x: 0, z: 1 };
  const dx = next % field.resolution - column;
  const dz = Math.floor(next / field.resolution) - row;
  const length = Math.max(.0001, Math.hypot(dx, dz));
  return { x: dx / length, z: dz / length };
}

export function gradeWorldFieldRoads(field: WorldFieldSet, roads: readonly RoadSegment[]): WorldFieldSet {
  if (!roads.length) return field;
  const elevation = [...field.elevation];
  for (let z = 0; z < field.resolution; z++) for (let x = 0; x < field.resolution; x++) {
    const index = z * field.resolution + x, worldX = field.originX + x * field.cellSize, worldZ = field.originZ + z * field.cellSize;
    let nearest: RoadSegment | undefined, distance = Number.POSITIVE_INFINITY;
    for (const road of roads) { const next = distanceToSegment(worldX, worldZ, road.ax, road.az, road.bx, road.bz); if (next < distance) { distance = next; nearest = road; } }
    if (!nearest || nearest.bridge || distance > nearest.width * 1.8) continue;
    const dx = nearest.bx - nearest.ax, dz = nearest.bz - nearest.az, denominator = dx * dx + dz * dz;
    const t = denominator > .001 ? clamp(((worldX - nearest.ax) * dx + (worldZ - nearest.az) * dz) / denominator, 0, 1) : 0;
    const start = sampleWorldField(field, "elevation", nearest.ax, nearest.az), end = sampleWorldField(field, "elevation", nearest.bx, nearest.bz);
    const grade = start + (end - start) * t;
    const roadRadius = nearest.width * .5;
    const shoulderRadius = Math.max(.75, nearest.width * .9);
    // The carriageway is authoritative and exactly follows the spline grade.
    // A smooth shoulder then transitions back to untouched terrain.
    if (distance <= roadRadius) elevation[index] = grade;
    else {
      const blend = 1 - smoother(clamp((distance - roadRadius) / shoulderRadius, 0, 1));
      elevation[index] += (grade - elevation[index]) * blend;
    }
  }
  return { ...field, elevation };
}

/** Wang-Liu sink filling followed by deterministic, flat-safe D8 accumulation. */
export function buildHydrologyField(blueprint: WorldBlueprintV1, requestedCellSize = 2): HydrologyField {
  return buildWorldFieldSet(blueprint, requestedCellSize).hydrology;
}

/** Uniform Catmull-Rom interpolation. Every interior control point is reached
 * exactly, unlike corner-cutting subdivision which rounds it away. */
export function sampleCatmullRomSpline(points: readonly SplinePoint[], samplesPerSpan = 4): SplinePoint[] {
  if (points.length < 2) return [...points];
  const samples = Math.max(1, Math.floor(samplesPerSpan));
  const output: SplinePoint[] = [];
  const interpolate = (p0: SplinePoint, p1: SplinePoint, p2: SplinePoint, p3: SplinePoint, t: number): SplinePoint => {
    const t2 = t * t, t3 = t2 * t;
    const channel = (a: number, b: number, c: number, d: number) => .5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    return { x: channel(p0.x, p1.x, p2.x, p3.x), z: channel(p0.z, p1.z, p2.z, p3.z) };
  };
  for (let span = 0; span < points.length - 1; span++) {
    const p0 = points[Math.max(0, span - 1)], p1 = points[span], p2 = points[span + 1], p3 = points[Math.min(points.length - 1, span + 2)];
    for (let sample = 0; sample < samples; sample++) output.push(interpolate(p0, p1, p2, p3, sample / samples));
  }
  output.push({ ...points[points.length - 1] });
  return output;
}

/** Repeated corner cutting produces a G1-continuous rural alignment before
 * spline fitting. It removes the 45/90 degree signature of the routing grid
 * while retaining the endpoints selected by the zone graph. */
export function cornerCutPolyline(points: readonly SplinePoint[], iterations = 2): SplinePoint[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));
  let output = points.map((point) => ({ ...point }));
  for (let iteration = 0; iteration < Math.max(0, Math.floor(iterations)); iteration++) {
    const next: SplinePoint[] = [{ ...output[0] }];
    for (let index = 0; index < output.length - 1; index++) {
      const a = output[index], b = output[index + 1];
      next.push({ x: a.x * .75 + b.x * .25, z: a.z * .75 + b.z * .25 });
      next.push({ x: a.x * .25 + b.x * .75, z: a.z * .25 + b.z * .75 });
    }
    next.push({ ...output[output.length - 1] });
    output = next;
  }
  return output;
}

/** Remove the A* grid staircase before fitting a smooth road centerline. */
export function simplifyPolyline(points: readonly SplinePoint[], tolerance: number): SplinePoint[] {
  if (points.length <= 2 || tolerance <= 0) return points.map((point) => ({ ...point }));
  const keep = new Set<number>([0, points.length - 1]);
  const pending: Array<[number, number]> = [[0, points.length - 1]];
  while (pending.length) {
    const [start, finish] = pending.pop()!;
    const a = points[start], b = points[finish];
    let farthest = -1, maximum = tolerance;
    for (let index = start + 1; index < finish; index++) {
      const distance = distanceToSegment(points[index].x, points[index].z, a.x, a.z, b.x, b.z);
      if (distance > maximum) { maximum = distance; farthest = index; }
    }
    if (farthest < 0) continue;
    keep.add(farthest);
    pending.push([start, farthest], [farthest, finish]);
  }
  return [...keep].sort((left, right) => left - right).map((index) => ({ ...points[index] }));
}

/** Resolve required zone edges onto terrain with slope, roughness, and water costs. */
export function buildAnisotropicRoadNetwork(blueprint: WorldBlueprintV1, rivers: RiverSegment[] = [], cellSize = 2, field?: WorldFieldSet): RoadSegment[] {
  const direct = buildZoneRoadGraph(blueprint.zones);
  if (blueprint.kind === "interior" || blueprint.kind === "dungeon") return direct;
  const resolutionX = Math.round(blueprint.width / cellSize) + 1, resolutionZ = Math.round(blueprint.depth / cellSize) + 1;
  const originX = -blueprint.width / 2, originZ = -blueprint.depth / 2;
  const base: WorldTerrainGeometry = { kind: "terrain", seed: blueprint.seed, originX, originZ, size: blueprint.width, baseHeight: blueprint.terrain.baseHeight, relief: blueprint.terrain.relief, roughness: blueprint.terrain.roughness, erosion: blueprint.terrain.erosion, biomeId: blueprint.biome.id, waterLevel: blueprint.terrain.waterLevel, paths: [], rivers };
  const indexAt = (x: number, z: number) => Math.max(0, Math.min(resolutionZ - 1, Math.round((z - originZ) / cellSize))) * resolutionX + Math.max(0, Math.min(resolutionX - 1, Math.round((x - originX) / cellSize)));
  const pointAt = (index: number) => ({ x: originX + (index % resolutionX) * cellSize, z: originZ + Math.floor(index / resolutionX) * cellSize });
  const neighbors = (index: number) => {
    const x = index % resolutionX, z = Math.floor(index / resolutionX), result: number[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && x + dx >= 0 && z + dz >= 0 && x + dx < resolutionX && z + dz < resolutionZ) result.push((z + dz) * resolutionX + x + dx);
    return result;
  };
  const output: RoadSegment[] = [];
  for (const edge of direct) {
    const sampleHeight = (x: number, z: number) => field ? sampleWorldField(field, "elevation", x, z) : sampleTerrainHeight(base, x, z);
    const start = indexAt(edge.ax, edge.az), goal = indexAt(edge.bx, edge.bz), open = new MinHeap<number>();
    const cost = new Map<number, number>([[start, 0]]), previous = new Map<number, number>(); open.push(0, start);
    while (open.size) {
      const current = open.pop()!; if (current === goal) break;
      const a = pointAt(current), ah = sampleHeight(a.x, a.z);
      for (const next of neighbors(current)) {
        const b = pointAt(next), bh = sampleHeight(b.x, b.z), distance = Math.hypot(b.x - a.x, b.z - a.z);
        const slope = Math.abs(bh - ah) / distance;
        const inWater = (blueprint.terrain.waterLevel !== undefined && Math.min(ah, bh) < blueprint.terrain.waterLevel + .08) || rivers.some((river) => distanceToSegment(b.x, b.z, river.ax, river.az, river.bx, river.bz) < river.width);
        const rough = terrainNoise(b.x * 1.7, b.z * 1.7, blueprint.seed + 7103, .52);
        const nextCost = (cost.get(current) ?? Number.POSITIVE_INFINITY) + distance * (1 + 18 * slope ** 2 + (inWater ? 7 : 0) + rough * .35);
        if (nextCost >= (cost.get(next) ?? Number.POSITIVE_INFINITY)) continue;
        cost.set(next, nextCost); previous.set(next, current);
        open.push(nextCost + Math.hypot(b.x - edge.bx, b.z - edge.bz), next);
      }
    }
    const path: number[] = [goal];
    while (path[0] !== start && previous.has(path[0])) path.unshift(previous.get(path[0])!);
    if (path[0] !== start) { output.push(edge); continue; }
    const gridPath = path.map(pointAt);
    const controls = cornerCutPolyline(simplifyPolyline(gridPath, cellSize * 1.15), 3);
    const curve = sampleCatmullRomSpline(controls, 4);
    const sampled = [curve[0]];
    for (let index = 0; index < curve.length - 1; index++) {
      const a = curve[index], b = curve[index + 1], spans = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 1.5));
      for (let span = 1; span <= spans; span++) sampled.push({ x: a.x + (b.x - a.x) * span / spans, z: a.z + (b.z - a.z) * span / spans });
    }
    for (let index = 0; index < sampled.length - 1; index++) {
      const a = sampled[index], b = sampled[index + 1];
      const midpointX = (a.x + b.x) / 2, midpointZ = (a.z + b.z) / 2;
      const bridge = rivers.some((river) => distanceToSegment(midpointX, midpointZ, river.ax, river.az, river.bx, river.bz) < river.width)
        || (blueprint.terrain.waterLevel !== undefined && sampleHeight(midpointX, midpointZ) < blueprint.terrain.waterLevel + .08);
      output.push({ ...edge, ax: a.x, az: a.z, bx: b.x, bz: b.z, bridge });
    }
  }
  return output;
}

/** Boundary-safe seeded Poisson candidates. Neighbor cells compete by stable priority. */
export function poissonPoints(originX: number, originZ: number, size: number, minimumDistance: number, seed: number, density = 1): PoissonPoint[] {
  const cell = minimumDistance / Math.SQRT2;
  const minCellX = Math.floor(originX / cell) - 2, maxCellX = Math.ceil((originX + size) / cell) + 2;
  const minCellZ = Math.floor(originZ / cell) - 2, maxCellZ = Math.ceil((originZ + size) / cell) + 2;
  const candidate = (cx: number, cz: number): PoissonPoint => ({ x: (cx + .08 + hash(cx, cz, seed + 31) * .84) * cell, z: (cz + .08 + hash(cx, cz, seed + 47) * .84) * cell, priority: hash(cx, cz, seed + 71) });
  const result: PoissonPoint[] = [];
  for (let cz = minCellZ; cz <= maxCellZ; cz++) for (let cx = minCellX; cx <= maxCellX; cx++) {
    const point = candidate(cx, cz);
    if (point.x < originX || point.x >= originX + size || point.z < originZ || point.z >= originZ + size || point.priority > density) continue;
    let accepted = true;
    for (let nz = cz - 2; nz <= cz + 2 && accepted; nz++) for (let nx = cx - 2; nx <= cx + 2; nx++) {
      if (nx === cx && nz === cz) continue;
      const neighbor = candidate(nx, nz);
      if (Math.hypot(point.x - neighbor.x, point.z - neighbor.z) < minimumDistance && (neighbor.priority < point.priority || (neighbor.priority === point.priority && `${nx}:${nz}` < `${cx}:${cz}`))) { accepted = false; break; }
    }
    if (accepted) result.push(point);
  }
  return result;
}

/** Variable-radius Poisson sampling driven by a caller-supplied density map.
 * Dense noise regions use the smaller radius; sparse regions retain wider
 * ecological clearings. Stable global cells keep streamed chunk borders free
 * from duplicate plants. */
export function noiseWeightedPoissonPoints(
  originX: number,
  originZ: number,
  size: number,
  minimumRadius: number,
  maximumRadius: number,
  seed: number,
  densityAt: (x: number, z: number) => number,
): PoissonPoint[] {
  const lowRadius = Math.max(.05, Math.min(minimumRadius, maximumRadius));
  const highRadius = Math.max(lowRadius, maximumRadius);
  const cell = lowRadius / Math.SQRT2;
  const reach = Math.ceil(highRadius / cell) + 1;
  const minCellX = Math.floor(originX / cell) - reach, maxCellX = Math.ceil((originX + size) / cell) + reach;
  const minCellZ = Math.floor(originZ / cell) - reach, maxCellZ = Math.ceil((originZ + size) / cell) + reach;
  const candidate = (cx: number, cz: number) => {
    const x = (cx + .08 + hash(cx, cz, seed + 31) * .84) * cell;
    const z = (cz + .08 + hash(cx, cz, seed + 47) * .84) * cell;
    const density = clamp(densityAt(x, z), 0, 1);
    return { x, z, density, radius: highRadius + (lowRadius - highRadius) * smoother(density), priority: hash(cx, cz, seed + 71) };
  };
  const result: PoissonPoint[] = [];
  for (let cz = minCellZ; cz <= maxCellZ; cz++) for (let cx = minCellX; cx <= maxCellX; cx++) {
    const point = candidate(cx, cz);
    if (point.x < originX || point.x >= originX + size || point.z < originZ || point.z >= originZ + size || point.priority > point.density) continue;
    let accepted = true;
    for (let nz = cz - reach; nz <= cz + reach && accepted; nz++) for (let nx = cx - reach; nx <= cx + reach; nx++) {
      if (nx === cx && nz === cz) continue;
      const neighbor = candidate(nx, nz);
      if (neighbor.priority > neighbor.density) continue;
      const required = Math.max(point.radius, neighbor.radius);
      if (Math.hypot(point.x - neighbor.x, point.z - neighbor.z) < required && (neighbor.priority < point.priority || (neighbor.priority === point.priority && `${nx}:${nz}` < `${cx}:${cz}`))) { accepted = false; break; }
    }
    if (accepted) result.push({ x: point.x, z: point.z, priority: point.priority });
  }
  return result;
}

export function buildNavigationGrid(geometry: WorldTerrainGeometry, resolution = 16, maxSlope = .72): NavigationGrid {
  const walkable: boolean[] = [];
  const step = geometry.size / resolution;
  for (let row = 0; row < resolution; row++) for (let column = 0; column < resolution; column++) {
    const x = geometry.originX + (column + .5) * step, z = geometry.originZ + (row + .5) * step;
    const height = sampleTerrainHeight(geometry, x, z);
    const slope = Math.max(Math.abs(sampleTerrainHeight(geometry, x + step * .5, z) - height), Math.abs(sampleTerrainHeight(geometry, x, z + step * .5) - height)) / (step * .5);
    const onBuiltRoute = geometry.paths.some((path) => distanceToSegment(x, z, path.ax, path.az, path.bx, path.bz) <= path.width * .72);
    const waterSafe = geometry.waterLevel === undefined || height >= geometry.waterLevel - .08 || onBuiltRoute;
    walkable.push(slope <= maxSlope && waterSafe);
  }
  const start = walkable.findIndex(Boolean), visited = new Set<number>(), pending = start >= 0 ? [start] : [];
  while (pending.length) {
    const index = pending.shift()!; if (visited.has(index) || !walkable[index]) continue; visited.add(index);
    const x = index % resolution, z = Math.floor(index / resolution);
    for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]) if (nx >= 0 && nz >= 0 && nx < resolution && nz < resolution) pending.push(nz * resolution + nx);
  }
  const walkableCells = walkable.filter(Boolean).length;
  return { resolution, cellSize: step, walkable, connected: walkableCells === visited.size, walkableCells, blockedCells: walkable.length - walkableCells };
}

export function generateBspRooms(width: number, depth: number, seed: number, maximumRooms = 12): ProceduralRoom[] {
  const leaves: Array<{ x: number; z: number; width: number; depth: number; key: number }> = [{ x: -width / 2, z: -depth / 2, width, depth, key: 1 }];
  while (leaves.length < maximumRooms) {
    const largestIndex = leaves.reduce((best, room, index) => room.width * room.depth > leaves[best].width * leaves[best].depth ? index : best, 0);
    const leaf = leaves.splice(largestIndex, 1)[0];
    const vertical = leaf.width > leaf.depth * 1.15 || (leaf.width >= leaf.depth * .85 && hash(leaf.key, leaves.length, seed) > .5);
    const extent = vertical ? leaf.width : leaf.depth;
    if (extent < 12) { leaves.push(leaf); break; }
    const split = extent * (.38 + hash(leaf.key, leaves.length, seed + 101) * .24);
    if (vertical) leaves.push({ ...leaf, width: split, key: leaf.key * 2 }, { ...leaf, x: leaf.x + split, width: leaf.width - split, key: leaf.key * 2 + 1 });
    else leaves.push({ ...leaf, depth: split, key: leaf.key * 2 }, { ...leaf, z: leaf.z + split, depth: leaf.depth - split, key: leaf.key * 2 + 1 });
  }
  const rooms = leaves.map((leaf, index) => ({ id: `room-${index}`, x: leaf.x + 1, z: leaf.z + 1, width: Math.max(3, leaf.width - 2), depth: Math.max(3, leaf.depth - 2), connections: [] as string[] }));
  // A deterministic nearest-neighbor spanning chain guarantees connectivity.
  for (let index = 1; index < rooms.length; index++) {
    const room = rooms[index];
    const previous = rooms.slice(0, index).reduce((best, candidate) => Math.hypot(candidate.x - room.x, candidate.z - room.z) < Math.hypot(best.x - room.x, best.z - room.z) ? candidate : best, rooms[0]);
    room.connections.push(previous.id); previous.connections.push(room.id);
  }
  return rooms;
}

export function traceDownhillFlow(geometry: WorldTerrainGeometry, startX: number, startZ: number, steps = 64): Array<{ x: number; z: number; y: number }> {
  const points: Array<{ x: number; z: number; y: number }> = [];
  let x = startX, z = startZ;
  for (let step = 0; step < steps; step++) {
    const y = sampleTerrainHeight(geometry, x, z); points.push({ x, z, y });
    let best = { x, z, y };
    for (let angle = 0; angle < 8; angle++) {
      const candidateX = x + Math.cos(angle * Math.PI / 4) * 1.5, candidateZ = z + Math.sin(angle * Math.PI / 4) * 1.5;
      const candidateY = sampleTerrainHeight(geometry, candidateX, candidateZ);
      if (candidateY < best.y) best = { x: candidateX, z: candidateZ, y: candidateY };
    }
    if (best.x === x && best.z === z) break;
    x = best.x; z = best.z;
  }
  return points;
}

export function terrainGeometryForChunk(blueprint: WorldBlueprintV1, originX: number, originZ: number, paths = buildZoneRoadGraph(blueprint.zones), rivers: RiverSegment[] = [], field?: WorldFieldSet): WorldTerrainGeometry {
  const geometry: WorldTerrainGeometry = { kind: "terrain", seed: blueprint.seed, originX, originZ, size: blueprint.chunkSize, baseHeight: blueprint.terrain.baseHeight, relief: blueprint.kind === "interior" || blueprint.kind === "dungeon" ? 0 : blueprint.terrain.relief, roughness: blueprint.terrain.roughness, erosion: blueprint.terrain.erosion, biomeId: blueprint.biome.id, waterLevel: blueprint.terrain.waterLevel, paths, rivers };
  if (field) {
    const resolution = Math.round(blueprint.chunkSize / field.cellSize) + 1, heights: number[] = [], roadWeights: number[] = [], terraceLevels: number[] = [];
    for (let row = 0; row < resolution; row++) for (let column = 0; column < resolution; column++) {
      const x = originX + column * blueprint.chunkSize / (resolution - 1), z = originZ + row * blueprint.chunkSize / (resolution - 1);
      const height = sampleWorldField(field, "elevation", x, z);
      heights.push(height);
      roadWeights.push(roadSurfaceWeight(geometry, x, z));
      terraceLevels.push(Math.round(height - geometry.baseHeight));
    }
    geometry.heightfield = { resolution, heights, roadWeights, terraceLevels };
  }
  return geometry;
}
