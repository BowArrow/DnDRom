import type { LightingQuality, Vec3, WorldChunkDescriptor, WorldChunkLodLevel, WorldRegionManifest } from "./types";

export const WORLD_CHUNK_CACHE_BUDGETS: Record<LightingQuality, number> = {
  performance: 256 * 1024 * 1024,
  balanced: 512 * 1024 * 1024,
  cinematic: 1024 * 1024 * 1024,
  diorama: 1024 * 1024 * 1024,
};

export interface WorldVisibilityInput {
  manifest: WorldRegionManifest;
  cameraPosition: Vec3;
  cameraTarget: Vec3;
  quality: LightingQuality;
  interiorChunkId?: string;
  selectedChunkIds?: ReadonlySet<string>;
  /** Creator overview cameras frame the whole draft and must not punch holes in it. */
  overview?: boolean;
  verticalFovDegrees?: number;
  aspectRatio?: number;
  farClip?: number;
}

export interface WorldVisibilitySet {
  visibleChunkIds: Set<string>;
  preloadChunkIds: Set<string>;
  lodByChunkId: Map<string, WorldChunkLodLevel>;
  estimatedBytes: number;
}

export interface WorldChunkRuntimeState {
  chunkId: string;
  resident: boolean;
  requestedLod: WorldChunkLodLevel;
  residentLod?: WorldChunkLodLevel;
  lastVisibleAt: number;
  lastRequestedAt: number;
}

interface QuadtreeNode {
  minX: number; maxX: number; minZ: number; maxZ: number;
  chunks: WorldChunkDescriptor[];
  children?: QuadtreeNode[];
}

const center = (chunk: WorldChunkDescriptor): Vec3 => ({
  x: (chunk.bounds.min.x + chunk.bounds.max.x) * .5,
  y: (chunk.bounds.min.y + chunk.bounds.max.y) * .5,
  z: (chunk.bounds.min.z + chunk.bounds.max.z) * .5,
});

const distanceXZ = (left: Vec3, right: Vec3): number => Math.hypot(left.x - right.x, left.z - right.z);
const chunkKey = (x: number, z: number): string => `${x}:${z}`;
const distanceToBoundsXZ = (point: Vec3, chunk: WorldChunkDescriptor): number => {
  const closestX = Math.max(chunk.bounds.min.x, Math.min(point.x, chunk.bounds.max.x));
  const closestZ = Math.max(chunk.bounds.min.z, Math.min(point.z, chunk.bounds.max.z));
  return Math.hypot(point.x - closestX, point.z - closestZ);
};

const boundsInPerspective = (bounds: { min: Vec3; max: Vec3 }, camera: Vec3, target: Vec3, verticalFovDegrees: number, aspectRatio: number, farClip: number): boolean => {
  const fx0 = target.x - camera.x, fy0 = target.y - camera.y, fz0 = target.z - camera.z;
  const forwardLength = Math.max(.0001, Math.hypot(fx0, fy0, fz0)), fx = fx0 / forwardLength, fy = fy0 / forwardLength, fz = fz0 / forwardLength;
  let rx = -fz, ry = 0, rz = fx;
  const rightLength = Math.max(.0001, Math.hypot(rx, rz)); rx /= rightLength; rz /= rightLength;
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  const cx = (bounds.min.x + bounds.max.x) * .5, cy = (bounds.min.y + bounds.max.y) * .5, cz = (bounds.min.z + bounds.max.z) * .5;
  const radius = Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z) * .5;
  const tx = cx - camera.x, ty = cy - camera.y, tz = cz - camera.z;
  const depth = tx * fx + ty * fy + tz * fz;
  if (depth + radius < .05 || depth - radius > farClip) return false;
  const halfHeight = Math.max(0, depth) * Math.tan(verticalFovDegrees * Math.PI / 360), halfWidth = halfHeight * Math.max(.25, aspectRatio);
  const horizontal = tx * rx + ty * ry + tz * rz, vertical = tx * ux + ty * uy + tz * uz;
  return Math.abs(horizontal) <= halfWidth + radius && Math.abs(vertical) <= halfHeight + radius;
};

const buildQuadtreeNode = (chunks: WorldChunkDescriptor[], depth = 0): QuadtreeNode => {
  const minX = Math.min(...chunks.map((chunk) => chunk.bounds.min.x)), maxX = Math.max(...chunks.map((chunk) => chunk.bounds.max.x));
  const minZ = Math.min(...chunks.map((chunk) => chunk.bounds.min.z)), maxZ = Math.max(...chunks.map((chunk) => chunk.bounds.max.z));
  const node: QuadtreeNode = { minX, maxX, minZ, maxZ, chunks };
  if (chunks.length <= 8 || depth >= 8) return node;
  const middleX = (minX + maxX) / 2, middleZ = (minZ + maxZ) / 2;
  const groups = [
    chunks.filter((chunk) => center(chunk).x < middleX && center(chunk).z < middleZ),
    chunks.filter((chunk) => center(chunk).x >= middleX && center(chunk).z < middleZ),
    chunks.filter((chunk) => center(chunk).x < middleX && center(chunk).z >= middleZ),
    chunks.filter((chunk) => center(chunk).x >= middleX && center(chunk).z >= middleZ),
  ].filter((group) => group.length > 0);
  if (groups.length > 1) node.children = groups.map((group) => buildQuadtreeNode(group, depth + 1));
  return node;
};

const nodeCouldBeVisible = (node: QuadtreeNode, camera: Vec3, target: Vec3, maximumDistance: number): boolean => {
  const closestX = Math.max(node.minX, Math.min(camera.x, node.maxX)), closestZ = Math.max(node.minZ, Math.min(camera.z, node.maxZ));
  if (Math.hypot(camera.x - closestX, camera.z - closestZ) > maximumDistance + 24) return false;
  // The broad phase must not reject by a node center's horizontal angle. A
  // high tabletop camera sees terrain behind its X/Z target; center-cone tests
  // caused visible wedges to disappear. PlayCanvas still does exact mesh-AABB
  // frustum culling, so conservative residency does not add draw calls.
  void target;
  return true;
};

const quadtreeCache = new WeakMap<WorldRegionManifest, QuadtreeNode>();

export function queryWorldQuadtree(manifest: WorldRegionManifest, camera: Vec3, target: Vec3, maximumDistance = manifest.chunkSize * 9): WorldChunkDescriptor[] {
  if (!manifest.chunks.length) return [];
  let root = quadtreeCache.get(manifest);
  if (!root) { root = buildQuadtreeNode(manifest.chunks); quadtreeCache.set(manifest, root); }
  const result: WorldChunkDescriptor[] = [], pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (!nodeCouldBeVisible(node, camera, target, maximumDistance)) continue;
    if (node.children) pending.push(...node.children); else result.push(...node.chunks);
  }
  return result;
}

export function chunkIdForPosition(manifest: WorldRegionManifest, position: Vec3): string | undefined {
  return manifest.chunks.find((chunk) => position.x >= chunk.bounds.min.x && position.x < chunk.bounds.max.x && position.z >= chunk.bounds.min.z && position.z < chunk.bounds.max.z)?.id;
}

const portalVisible = (manifest: WorldRegionManifest, originId: string): Set<string> => {
  const visible = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: originId, depth: 0 }];
  while (queue.length) {
    const current = queue.shift()!;
    if (visible.has(current.id) || current.depth > 3) continue;
    visible.add(current.id);
    const chunk = manifest.chunks.find((entry) => entry.id === current.id);
    for (const next of chunk?.portalChunkIds ?? []) queue.push({ id: next, depth: current.depth + 1 });
  }
  return visible;
};

const isPotentiallyVisible = (chunk: WorldChunkDescriptor, camera: Vec3, target: Vec3, maximumDistance: number): boolean => {
  void target;
  // Measure to the nearest point of the bounds. Center distance can evict a
  // 16-meter tile while the near side is still plainly inside the viewport.
  return distanceToBoundsXZ(camera, chunk) <= maximumDistance || chunk.landmark === true;
};

const lodForDistance = (distance: number, chunkSize: number): WorldChunkLodLevel => distance <= chunkSize * 2 ? 0 : distance <= chunkSize * 5 ? 1 : 2;

export function computeWorldVisibility(input: WorldVisibilityInput): WorldVisibilitySet {
  const { manifest, cameraPosition, cameraTarget } = input;
  const maximumDistance = input.farClip ?? manifest.chunkSize * 9;
  const verticalFov = input.verticalFovDegrees ?? 52, aspect = input.aspectRatio ?? 16 / 9;
  // The Forge overview is an editor-wide view, not the player's current room.
  // Applying portal traversal here punched visible holes out of the authored
  // draft even though the camera could still see those rooms.
  const portalSet = !input.overview && input.interiorChunkId ? portalVisible(manifest, input.interiorChunkId) : null;
  const visible = new Set<string>();
  const preload = new Set<string>();
  const lodByChunkId = new Map<string, WorldChunkLodLevel>();
  const coordinates = new Map(manifest.chunks.map((chunk) => [chunkKey(chunk.x, chunk.z), chunk]));

  const candidates = input.overview ? manifest.chunks : queryWorldQuadtree(manifest, cameraPosition, cameraTarget, maximumDistance);
  for (const chunk of candidates) {
    const selected = input.selectedChunkIds?.has(chunk.id) ?? false;
    const allowedByPortal = !portalSet || portalSet.has(chunk.id);
    if (!selected && (!allowedByPortal || (!input.overview && (!isPotentiallyVisible(chunk, cameraPosition, cameraTarget, maximumDistance) || !boundsInPerspective(chunk.bounds, cameraPosition, cameraTarget, verticalFov, aspect, maximumDistance))))) continue;
    visible.add(chunk.id);
    lodByChunkId.set(chunk.id, selected ? 0 : lodForDistance(distanceToBoundsXZ(cameraPosition, chunk), manifest.chunkSize));
    for (let z = chunk.z - 1; z <= chunk.z + 1; z++) for (let x = chunk.x - 1; x <= chunk.x + 1; x++) {
      const neighbor = coordinates.get(chunkKey(x, z));
      if (neighbor && !visible.has(neighbor.id)) preload.add(neighbor.id);
    }
  }

  const requested = [...new Set([...visible, ...preload])]
    .map((id) => manifest.chunks.find((chunk) => chunk.id === id))
    .filter((chunk): chunk is WorldChunkDescriptor => Boolean(chunk))
    .sort((left, right) => distanceXZ(cameraPosition, center(left)) - distanceXZ(cameraPosition, center(right)));
  const budget = WORLD_CHUNK_CACHE_BUDGETS[input.quality];
  let estimatedBytes = 0;
  for (const chunk of requested) {
    const lod = lodByChunkId.get(chunk.id) ?? 2;
    const bytes = chunk.lods.find((entry) => entry.level === lod)?.byteLength ?? 0;
    if (estimatedBytes + bytes <= budget || visible.has(chunk.id)) estimatedBytes += bytes;
    else preload.delete(chunk.id);
  }
  return { visibleChunkIds: visible, preloadChunkIds: preload, lodByChunkId, estimatedBytes };
}

export function lightInfluencesVisibleChunks(position: Vec3, range: number, manifest: WorldRegionManifest, visibility: WorldVisibilitySet): boolean {
  for (const id of visibility.visibleChunkIds) {
    const chunk = manifest.chunks.find((entry) => entry.id === id);
    if (!chunk) continue;
    const x = Math.max(chunk.bounds.min.x, Math.min(position.x, chunk.bounds.max.x));
    const y = Math.max(chunk.bounds.min.y, Math.min(position.y, chunk.bounds.max.y));
    const z = Math.max(chunk.bounds.min.z, Math.min(position.z, chunk.bounds.max.z));
    if (Math.hypot(position.x - x, position.y - y, position.z - z) <= range) return true;
  }
  return false;
}

export class WorldChunkStreamingController {
  private states = new Map<string, WorldChunkRuntimeState>();
  private queue: string[] = [];
  private presented = new Set<string>();
  constructor(private readonly evictionDelayMs = 5_000) {}

  update(manifest: WorldRegionManifest, visibility: WorldVisibilitySet, now: number): string[] {
    const requested = new Set([...visibility.visibleChunkIds, ...visibility.preloadChunkIds]);
    for (const chunk of manifest.chunks) {
      const lod = visibility.lodByChunkId.get(chunk.id) ?? 2;
      const state = this.states.get(chunk.id) ?? { chunkId: chunk.id, resident: false, requestedLod: lod, lastVisibleAt: 0, lastRequestedAt: 0 };
      state.requestedLod = lod;
      if (visibility.visibleChunkIds.has(chunk.id)) state.lastVisibleAt = now;
      if (requested.has(chunk.id)) {
        state.lastRequestedAt = now;
        if ((!state.resident || state.residentLod !== lod) && !this.queue.includes(chunk.id)) this.queue.push(chunk.id);
      }
      this.states.set(chunk.id, state);
    }
    const evicted: string[] = [];
    for (const state of this.states.values()) if (state.resident && !requested.has(state.chunkId) && now - Math.max(state.lastVisibleAt, state.lastRequestedAt) >= this.evictionDelayMs) {
      state.resident = false; state.residentLod = undefined; this.presented.delete(state.chunkId); evicted.push(state.chunkId);
    }
    this.queue = this.queue.filter((id) => requested.has(id));
    const priorities = new Map(manifest.chunks.map(chunk => [chunk.id, Math.hypot(center(chunk).x, center(chunk).z)]));
    this.queue.sort((a,b) => (priorities.get(a) ?? Infinity) - (priorities.get(b) ?? Infinity));
    return evicted;
  }

  takeUploads(maxChunks = 1, timeBudgetMs = 4, clock: () => number = () => performance.now(), upload?: (id:string) => void): string[] {
    const started = clock(), loaded: string[] = [];
    while (this.queue.length && loaded.length < maxChunks && clock() - started <= timeBudgetMs) {
      const id = this.queue.shift()!, state = this.states.get(id);
      if (!state) continue;
      const previous = { resident: state.resident, lod: state.residentLod };
      state.resident = true; state.residentLod = state.requestedLod;
      try { upload?.(id); loaded.push(id); }
      catch (error) { this.presented.delete(id); state.resident = previous.resident; state.residentLod = previous.lod; this.queue.unshift(id); throw error; }
    }
    return loaded;
  }

  isResident(chunkId: string): boolean { return this.states.get(chunkId)?.resident ?? false; }
  /** Called after a rendered frame, never merely when a job enters the queue. */
  markPresented(chunkIds: readonly string[]): void { for(const id of chunkIds) if(this.isResident(id)) this.presented.add(id); }
  isPresented(chunkId:string):boolean { return this.isResident(chunkId) && this.presented.has(chunkId); }
  residentLod(chunkId: string): WorldChunkLodLevel | undefined { return this.states.get(chunkId)?.residentLod; }
  snapshot(): WorldChunkRuntimeState[] { return [...this.states.values()].map((state) => ({ ...state })); }
  reset(): void { this.states.clear(); this.queue = []; this.presented.clear(); }
}

export function shouldRenderWorldEntity(chunkId: string | undefined, visibility: WorldVisibilitySet | null): boolean {
  return !chunkId || !visibility || visibility.visibleChunkIds.has(chunkId);
}
