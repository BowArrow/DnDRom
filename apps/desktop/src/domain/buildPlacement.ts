import { ASSET_BY_ID, type AssetDefinition } from "./assets";
import type { AttachmentProfile, AttachmentSurface, AttachmentSurfaceKind, MapEntity, PropAsset, PropBehavior, PropBounds, PropCollisionMode, TokenAsset, Vec3 } from "./types";

export type BuildShape = "floor" | "wall" | "object" | "token";

export interface BuildSpec {
  assetId: string;
  shape: BuildShape;
  halfX: number;
  halfZ: number;
  footprint: number;
  rotationStep: number;
  profile: AttachmentProfile;
  acceptedSurfaceTags: AttachmentSurfaceKind[];
  providedSurfaces: AttachmentSurface[];
  bounds: PropBounds;
  collisionMode: PropCollisionMode;
  bottomAnchor: Vec3;
  forwardAnchor: Vec3;
  defaultBehavior: PropBehavior;
}

export interface BuildSocket {
  id: string;
  ownerId: string;
  position: Vec3;
  outward: { x: number; z: number };
  rotationY: number;
  accepts: BuildShape[];
}

export interface PlacementResolution {
  position: Vec3;
  rotationY: number;
  rotation?: Vec3;
  snapped: boolean;
  socketId?: string;
  parentId?: string;
  surfaceId?: string;
  surfaceName?: string;
  surfaceKind?: AttachmentSurfaceKind;
  surfaceNormal?: Vec3;
  localPosition?: Vec3;
  localRotation?: Vec3;
  clearanceOffset?: number;
  valid: boolean;
  reason?: string;
}

const structuralId = (definition: AssetDefinition): BuildShape => {
  if (/floor|grass|water/.test(definition.id)) return "floor";
  if (/wall|fence|gate/.test(definition.id)) return "wall";
  return "object";
};

const boundsFromParts = (definition: AssetDefinition): PropBounds => {
  if (!definition.parts?.length) return { min: { x: -definition.footprint, y: 0, z: -definition.footprint }, max: { x: definition.footprint, y: definition.footprint * 2, z: definition.footprint } };
  return definition.parts.reduce<PropBounds>((result, part) => ({
    min: { x: Math.min(result.min.x, part.position.x - part.scale.x / 2), y: Math.min(result.min.y, part.position.y - part.scale.y / 2), z: Math.min(result.min.z, part.position.z - part.scale.z / 2) },
    max: { x: Math.max(result.max.x, part.position.x + part.scale.x / 2), y: Math.max(result.max.y, part.position.y + part.scale.y / 2), z: Math.max(result.max.z, part.position.z + part.scale.z / 2) },
  }), { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } });
};

const inferredProfile = (shape: BuildShape): AttachmentProfile => shape === "floor" || shape === "wall" ? "structural" : "floor-standing";
const acceptedForProfile = (profile: AttachmentProfile): AttachmentSurfaceKind[] => ({
  "tabletop": ["tabletop", "stack-top"], "floor-standing": ["floor", "tabletop", "stack-top"], "wall-mounted": ["wall"], "ceiling-hanging": ["ceiling"], "stackable": ["floor", "tabletop", "stack-top"], "structural": ["floor", "structural-edge"],
} satisfies Record<AttachmentProfile, AttachmentSurfaceKind[]>)[profile];

const inferredWallSurfaces = (bounds: PropBounds): AttachmentSurface[] => {
  const centerY = (bounds.min.y + bounds.max.y) / 2;
  const halfX = Math.max(.1, (bounds.max.x - bounds.min.x) / 2);
  const halfY = Math.max(.1, (bounds.max.y - bounds.min.y) / 2);
  return [
    { id: "inward", name: "Inward face", kind: "wall", position: { x: 0, y: centerY, z: bounds.min.z }, normal: { x: 0, y: 0, z: -1 }, tangent: { x: 1, y: 0, z: 0 }, bitangent: { x: 0, y: 1, z: 0 }, halfSize: { x: halfX, y: halfY }, accepts: ["wall-mounted"] },
    { id: "outward", name: "Outward face", kind: "wall", position: { x: 0, y: centerY, z: bounds.max.z }, normal: { x: 0, y: 0, z: 1 }, tangent: { x: -1, y: 0, z: 0 }, bitangent: { x: 0, y: 1, z: 0 }, halfSize: { x: halfX, y: halfY }, accepts: ["wall-mounted"] },
  ];
};

export function buildSpec(assetId: string, tokenAssets: TokenAsset[] = [], propAssets: PropAsset[] = []): BuildSpec | null {
  const definition = ASSET_BY_ID.get(assetId);
  const token = tokenAssets.find((entry) => entry.id === assetId);
  const customProp = propAssets.find((entry) => entry.id === assetId);
  if (customProp) {
    const halfX = Math.max(.04, (customProp.bounds.max.x - customProp.bounds.min.x) / 2);
    const halfZ = Math.max(.04, (customProp.bounds.max.z - customProp.bounds.min.z) / 2);
    return { assetId, shape: "object", halfX, halfZ, footprint: Math.max(halfX, halfZ), rotationStep: 15, profile: customProp.profile, acceptedSurfaceTags: customProp.acceptedSurfaceTags, providedSurfaces: customProp.providedSurfaces, bounds: customProp.bounds, collisionMode: customProp.collisionMode, bottomAnchor: customProp.bottomAnchor, forwardAnchor: customProp.forwardAnchor, defaultBehavior: customProp.defaultBehavior };
  }
  if (token) return { assetId, shape: "token", halfX: token.footprint, halfZ: token.footprint, footprint: token.footprint, rotationStep: 15, profile: "floor-standing", acceptedSurfaceTags: ["floor"], providedSurfaces: [], bounds: { min: { x: -token.footprint, y: 0, z: -token.footprint }, max: { x: token.footprint, y: token.footprint * 3, z: token.footprint } }, collisionMode: "solid", bottomAnchor: { x: 0, y: 0, z: 0 }, forwardAnchor: { x: 0, y: 0, z: -1 }, defaultBehavior: { kind: "static" } };
  if (!definition) return null;
  let halfX = definition.footprint * .72;
  let halfZ = definition.footprint * .72;
  if (definition.parts?.length) {
    halfX = Math.max(.08, ...definition.parts.map((part) => Math.abs(part.position.x) + part.scale.x / 2));
    halfZ = Math.max(.08, ...definition.parts.map((part) => Math.abs(part.position.z) + part.scale.z / 2));
  }
  const shape = structuralId(definition);
  const profile = definition.attachmentProfile ?? inferredProfile(shape);
  const bounds = definition.bounds ?? boundsFromParts(definition);
  const providedSurfaces = definition.providedSurfaces ?? (shape === "wall" ? inferredWallSurfaces(bounds) : []);
  return { assetId, shape, halfX, halfZ, footprint: definition.footprint, rotationStep: shape === "floor" || shape === "wall" ? 90 : 15, profile, acceptedSurfaceTags: definition.acceptedSurfaceTags ?? acceptedForProfile(profile), providedSurfaces, bounds, collisionMode: definition.collisionMode ?? (shape === "floor" ? "clearance" : "solid"), bottomAnchor: definition.bottomAnchor ?? { x: 0, y: 0, z: 0 }, forwardAnchor: definition.forwardAnchor ?? { x: 0, y: 0, z: -1 }, defaultBehavior: definition.defaultBehavior ?? { kind: "static" } };
}

const rotate = (x: number, z: number, degrees: number): { x: number; z: number } => {
  const radians = degrees * Math.PI / 180;
  return { x: x * Math.cos(radians) - z * Math.sin(radians), z: x * Math.sin(radians) + z * Math.cos(radians) };
};

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const multiply = (value: Vec3, amount: number): Vec3 => ({ x: value.x * amount, y: value.y * amount, z: value.z * amount });
const normalize = (value: Vec3): Vec3 => { const length = Math.hypot(value.x, value.y, value.z) || 1; return { x: value.x / length, y: value.y / length, z: value.z / length }; };
type Quaternion = { x: number; y: number; z: number; w: number };
const normalizeQuaternion = (value: Quaternion): Quaternion => { const length = Math.hypot(value.x, value.y, value.z, value.w) || 1; return { x: value.x / length, y: value.y / length, z: value.z / length, w: value.w / length }; };
const multiplyQuaternion = (a: Quaternion, b: Quaternion): Quaternion => ({ w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z, x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w });
const axisAngleQuaternion = (axis: Vec3, degrees: number): Quaternion => { const half = degrees * Math.PI / 360, sine = Math.sin(half), unit = normalize(axis); return { x: unit.x * sine, y: unit.y * sine, z: unit.z * sine, w: Math.cos(half) }; };
const directionQuaternion = (from: Vec3, to: Vec3): Quaternion => {
  const a = normalize(from), b = normalize(to), similarity = dot(a, b);
  if (similarity < -0.999999) return axisAngleQuaternion({ x: 0, y: 1, z: 0 }, 180);
  return normalizeQuaternion({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x, w: 1 + similarity });
};
const quaternionEuler = (value: Quaternion): Vec3 => {
  const q = normalizeQuaternion(value);
  const x = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
  const y = Math.asin(Math.max(-1, Math.min(1, 2 * (q.w * q.y - q.z * q.x))));
  const z = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
  return { x: x * 180 / Math.PI, y: y * 180 / Math.PI, z: z * 180 / Math.PI };
};

/** Aligns local forward to the wall, then applies a pure twist around that surface normal. */
export function rotationAroundSurfaceNormal(normal: Vec3, degrees: number): Vec3 {
  const unit = normalize(normal);
  const alignment = directionQuaternion({ x: 0, y: 0, z: -1 }, unit);
  return quaternionEuler(multiplyQuaternion(axisAngleQuaternion(unit, degrees), alignment));
}
const transformDirection = (value: Vec3, entity: MapEntity): Vec3 => {
  const horizontal = rotate(value.x, value.z, entity.rotation.y);
  return normalize({ x: horizontal.x, y: value.y, z: horizontal.z });
};
const transformPoint = (value: Vec3, entity: MapEntity): Vec3 => {
  const horizontal = rotate(value.x * entity.scale.x, value.z * entity.scale.z, entity.rotation.y);
  return { x: entity.position.x + horizontal.x, y: entity.position.y + value.y * entity.scale.y, z: entity.position.z + horizontal.z };
};

export interface WorldAttachmentSurface extends AttachmentSurface {
  ownerId: string;
  ownerName: string;
  worldPosition: Vec3;
  worldNormal: Vec3;
  worldTangent: Vec3;
  worldBitangent: Vec3;
  worldHalfSize: { x: number; y: number };
}

export function surfacesForEntity(entity: MapEntity, tokenAssets: TokenAsset[] = [], propAssets: PropAsset[] = []): WorldAttachmentSurface[] {
  if (entity.hidden) return [];
  const spec = buildSpec(entity.assetId, tokenAssets, propAssets);
  if (!spec) return [];
  return spec.providedSurfaces.filter((entry) => !entry.hidden).map((entry) => ({
    ...entry,
    ownerId: entity.id,
    ownerName: entity.name,
    worldPosition: transformPoint(entry.position, entity),
    worldNormal: transformDirection(entry.normal, entity),
    worldTangent: transformDirection(entry.tangent, entity),
    worldBitangent: transformDirection(entry.bitangent, entity),
    worldHalfSize: { x: entry.halfSize.x * Math.max(.001, Math.abs(entity.scale.x)), y: entry.halfSize.y * Math.max(.001, Math.abs(entry.bitangent.y) > .5 ? Math.abs(entity.scale.y) : Math.abs(entity.scale.z)) },
  }));
}

export function raycastAttachmentSurfaces(origin: Vec3, direction: Vec3, entities: MapEntity[], spec: BuildSpec, tokenAssets: TokenAsset[] = [], propAssets: PropAsset[] = []): { surface: WorldAttachmentSurface; point: Vec3; distance: number } | null {
  let nearest: { surface: WorldAttachmentSurface; point: Vec3; distance: number } | null = null;
  for (const entity of entities) for (const candidate of surfacesForEntity(entity, tokenAssets, propAssets)) {
    if (!spec.acceptedSurfaceTags.includes(candidate.kind) || !candidate.accepts.includes(spec.profile)) continue;
    const denominator = dot(candidate.worldNormal, direction);
    if (Math.abs(denominator) < .0001) continue;
    const distance = dot(candidate.worldNormal, { x: candidate.worldPosition.x - origin.x, y: candidate.worldPosition.y - origin.y, z: candidate.worldPosition.z - origin.z }) / denominator;
    if (distance < 0 || (nearest && distance >= nearest.distance)) continue;
    const point = add(origin, multiply(direction, distance));
    const relative = { x: point.x - candidate.worldPosition.x, y: point.y - candidate.worldPosition.y, z: point.z - candidate.worldPosition.z };
    if (Math.abs(dot(relative, candidate.worldTangent)) > candidate.worldHalfSize.x || Math.abs(dot(relative, candidate.worldBitangent)) > candidate.worldHalfSize.y) continue;
    nearest = { surface: candidate, point, distance };
  }
  return nearest;
}

export function wouldCreateAttachmentCycle(entities: MapEntity[], childId: string, parentId: string): boolean {
  if (childId === parentId) return true;
  let current: string | undefined = parentId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    if (current === childId) return true;
    seen.add(current);
    current = entities.find((entry) => entry.id === current)?.build?.parentId;
  }
  return false;
}

export function attachmentLocalPosition(world: Vec3, parent: MapEntity): Vec3 {
  const dx = world.x - parent.position.x, dz = world.z - parent.position.z;
  const horizontal = rotate(dx, dz, -parent.rotation.y);
  return { x: horizontal.x / Math.max(.001, parent.scale.x), y: (world.y - parent.position.y) / Math.max(.001, parent.scale.y), z: horizontal.z / Math.max(.001, parent.scale.z) };
}

export function attachmentWorldPosition(local: Vec3, parent: MapEntity): Vec3 { return transformPoint(local, parent); }

export function scaleAwareClearance(spec: BuildSpec, parent?: MapEntity): number {
  const height = spec.bounds.max.y - spec.bounds.min.y;
  return Math.min(.02, Math.max(.0015, height * .0025)) * (parent ? Math.max(parent.scale.x, parent.scale.y, parent.scale.z) : 1);
}

export function resolveSurfacePlacement(hit: { surface: WorldAttachmentSurface; point: Vec3 }, rotationY: number, spec: BuildSpec, parent: MapEntity): Omit<PlacementResolution, "valid" | "reason"> {
  const clearanceOffset = scaleAwareClearance(spec, parent);
  // A wall mount's root sits on its centerline. Move its full forward depth
  // outside the support plane so the mesh cannot be buried in the wall.
  const mountDepth = hit.surface.kind === "wall" ? Math.max(Math.abs(spec.bounds.min.z), Math.abs(spec.bounds.max.z)) : 0;
  const position = add(hit.point, multiply(hit.surface.worldNormal, clearanceOffset + mountDepth));
  const rotation = hit.surface.kind === "wall" ? rotationAroundSurfaceNormal(hit.surface.worldNormal, rotationY) : hit.surface.kind === "ceiling" ? { x: 180, y: rotationY, z: 0 } : { x: 0, y: rotationY, z: 0 };
  return { position, rotationY: rotation.y, rotation, snapped: true, parentId: parent.id, surfaceId: hit.surface.id, surfaceName: hit.surface.name, surfaceKind: hit.surface.kind, surfaceNormal: hit.surface.worldNormal, localPosition: attachmentLocalPosition(position, parent), localRotation: { x: rotation.x - parent.rotation.x, y: rotation.y - parent.rotation.y, z: rotation.z - parent.rotation.z }, clearanceOffset };
}

export function socketsForEntity(entity: MapEntity, tokenAssets: TokenAsset[] = [], propAssets: PropAsset[] = []): BuildSocket[] {
  const spec = buildSpec(entity.assetId, tokenAssets, propAssets);
  if (!spec || (spec.shape !== "floor" && spec.shape !== "wall")) return [];
  const rotationY = entity.rotation.y;
  const socket = (id: string, localX: number, localZ: number, outwardX: number, outwardZ: number, localRotation: number, accepts: BuildShape[]): BuildSocket => {
    const offset = rotate(localX * entity.scale.x, localZ * entity.scale.z, rotationY);
    const outward = rotate(outwardX, outwardZ, rotationY);
    return {
      id: `${entity.id}:${id}`,
      ownerId: entity.id,
      position: { x: entity.position.x + offset.x, y: entity.position.y, z: entity.position.z + offset.z },
      outward,
      rotationY: (rotationY + localRotation + 360) % 360,
      accepts,
    };
  };
  if (spec.shape === "wall") {
    return [
      socket("end-a", -spec.halfX, 0, -1, 0, 0, ["wall"]),
      socket("end-b", spec.halfX, 0, 1, 0, 0, ["wall"]),
    ];
  }
  return [
    socket("north", 0, -spec.halfZ, 0, -1, 0, ["floor", "wall"]),
    socket("east", spec.halfX, 0, 1, 0, 90, ["floor", "wall"]),
    socket("south", 0, spec.halfZ, 0, 1, 0, ["floor", "wall"]),
    socket("west", -spec.halfX, 0, -1, 0, 90, ["floor", "wall"]),
  ];
}

export class SpatialHash<T> {
  private readonly cells = new Map<string, Set<T>>();
  constructor(private readonly cellSize = 3) {}
  private key(x: number, z: number): string { return `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`; }
  insert(value: T, position: { x: number; z: number }, radius = 0): void {
    const minX = Math.floor((position.x - radius) / this.cellSize), maxX = Math.floor((position.x + radius) / this.cellSize);
    const minZ = Math.floor((position.z - radius) / this.cellSize), maxZ = Math.floor((position.z + radius) / this.cellSize);
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const key = `${x},${z}`;
      const cell = this.cells.get(key) ?? new Set<T>();
      cell.add(value);
      this.cells.set(key, cell);
    }
  }
  query(position: { x: number; z: number }, radius = this.cellSize): T[] {
    const found = new Set<T>();
    const minX = Math.floor((position.x - radius) / this.cellSize), maxX = Math.floor((position.x + radius) / this.cellSize);
    const minZ = Math.floor((position.z - radius) / this.cellSize), maxZ = Math.floor((position.z + radius) / this.cellSize);
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) for (const value of this.cells.get(`${x},${z}`) ?? []) found.add(value);
    return [...found];
  }
}

export function buildSpatialHash(entities: MapEntity[], tokenAssets: TokenAsset[] = [], propAssets: PropAsset[] = []): SpatialHash<MapEntity> {
  const hash = new SpatialHash<MapEntity>();
  for (const entity of entities) {
    if (entity.hidden) continue;
    const spec = buildSpec(entity.assetId, tokenAssets, propAssets);
    hash.insert(entity, entity.position, (spec?.footprint ?? .7) * Math.max(entity.scale.x, entity.scale.z));
  }
  return hash;
}

export function resolveSocketPlacement(raw: Vec3, rotationY: number, spec: BuildSpec, nearby: MapEntity[], tokenAssets: TokenAsset[] = [], snapping = true, radius = 1.15, propAssets: PropAsset[] = []): Omit<PlacementResolution, "valid" | "reason"> {
  if (!snapping) return { position: { ...raw }, rotationY, snapped: false };
  let nearest: { socket: BuildSocket; distance: number } | null = null;
  for (const entity of nearby) for (const socket of socketsForEntity(entity, tokenAssets, propAssets)) {
    if (!socket.accepts.includes(spec.shape)) continue;
    const distance = Math.hypot(socket.position.x - raw.x, socket.position.z - raw.z);
    if (distance <= radius && (!nearest || distance < nearest.distance)) nearest = { socket, distance };
  }
  if (!nearest) return { position: { ...raw }, rotationY, snapped: false };
  const { socket } = nearest;
  const extension = spec.shape === "wall" && socket.id.includes(":end-") ? spec.halfX : spec.shape === "floor" ? (Math.abs(socket.outward.x) > .5 ? spec.halfX : spec.halfZ) : 0;
  return {
    position: { x: socket.position.x + socket.outward.x * extension, y: raw.y, z: socket.position.z + socket.outward.z * extension },
    rotationY: spec.shape === "wall" ? socket.rotationY : rotationY,
    snapped: true,
    socketId: socket.id,
    parentId: socket.ownerId,
  };
}

const orientedHalfExtents = (spec: BuildSpec, rotationY: number): { x: number; z: number } => {
  const quarterTurns = Math.round(rotationY / 90) % 2;
  return quarterTurns === 0 ? { x: spec.halfX, z: spec.halfZ } : { x: spec.halfZ, z: spec.halfX };
};

export function validatePlacement(position: Vec3, rotationY: number, spec: BuildSpec, nearby: MapEntity[], map: { width: number; depth: number }, tokenAssets: TokenAsset[] = [], snappedParentId?: string, propAssets: PropAsset[] = [], surfaceId?: string): { valid: boolean; reason?: string } {
  const bounds = orientedHalfExtents(spec, rotationY);
  const edgeAllowance = .15;
  if (Math.abs(position.x) + bounds.x > map.width / 2 + bounds.x * edgeAllowance || Math.abs(position.z) + bounds.z > map.depth / 2 + bounds.z * edgeAllowance) {
    return { valid: false, reason: "Outside the buildable map" };
  }
  if (spec.collisionMode === "none") return { valid: true };
  const shrink = .88;
  for (const entity of nearby) {
    if (entity.hidden || entity.id === snappedParentId) continue;
    const other = buildSpec(entity.assetId, tokenAssets, propAssets);
    if (!other || other.collisionMode === "none") continue;
    // Floors are support surfaces, not blocking solids. Anything may sit on them, and
    // a floor may be laid beneath existing dressing. Floor-on-floor still validates
    // normally so duplicate tiles cannot accidentally stack and z-fight.
    if ((spec.shape === "floor") !== (other.shape === "floor")) {
      // Attached siblings share a physical support plane and need true volume clearance.
      if (!snappedParentId || entity.build?.parentId !== snappedParentId || entity.build?.placementVersion !== 2 || (surfaceId && entity.build.surfaceId !== surfaceId)) continue;
      const aHeight = Math.max(.01, spec.bounds.max.y - spec.bounds.min.y);
      const bHeight = Math.max(.01, other.bounds.max.y - other.bounds.min.y) * Math.max(.001, entity.scale.y);
      if (Math.abs(position.y - entity.position.y) >= (aHeight + bHeight) * .48) continue;
    }
    const otherBounds = orientedHalfExtents(other, entity.rotation.y);
    const overlapX = Math.abs(position.x - entity.position.x) < (bounds.x + otherBounds.x * Math.max(entity.scale.x, entity.scale.z)) * shrink;
    const overlapZ = Math.abs(position.z - entity.position.z) < (bounds.z + otherBounds.z * Math.max(entity.scale.x, entity.scale.z)) * shrink;
    if (overlapX && overlapZ) return { valid: false, reason: `Blocked by ${entity.name}` };
  }
  return { valid: true };
}

export function resolvePlacement(raw: Vec3, rotationY: number, spec: BuildSpec, hash: SpatialHash<MapEntity>, map: { width: number; depth: number }, tokenAssets: TokenAsset[] = [], snapping = true, propAssets: PropAsset[] = []): PlacementResolution {
  const nearby = hash.query(raw, Math.max(3, spec.footprint * 2.5));
  const snapped = resolveSocketPlacement(raw, rotationY, spec, nearby, tokenAssets, snapping, 1.15, propAssets);
  const validationNearby = hash.query(snapped.position, Math.max(3, spec.footprint * 2.5));
  return { ...snapped, ...validatePlacement(snapped.position, snapped.rotationY, spec, validationNearby, map, tokenAssets, snapped.parentId, propAssets, snapped.surfaceId) };
}

export function structuralDescendants(entities: MapEntity[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const entity of entities) {
    const parentId = entity.build?.parentId;
    if (parentId) children.set(parentId, [...(children.get(parentId) ?? []), entity.id]);
  }
  const result: string[] = [];
  const pending = [...(children.get(rootId) ?? [])];
  while (pending.length) {
    const id = pending.shift()!;
    if (result.includes(id)) continue;
    result.push(id);
    pending.push(...(children.get(id) ?? []));
  }
  return result;
}

/** Applies a parent edit to every attached descendant while keeping legacy records readable. */
export function updateAttachmentHierarchy(entities: MapEntity[], parentId: string, update: Partial<MapEntity>): MapEntity[] {
  const before = entities.find((entry) => entry.id === parentId);
  if (!before) return entities;
  const after = { ...before, ...update };
  const result = new Map(entities.map((entry) => [entry.id, entry.id === parentId ? after : entry]));
  const moveChildren = (oldParent: MapEntity, newParent: MapEntity): void => {
    for (const child of entities.filter((entry) => entry.build?.parentId === oldParent.id)) {
      const ratio = {
        x: newParent.scale.x / Math.max(.001, oldParent.scale.x),
        y: newParent.scale.y / Math.max(.001, oldParent.scale.y),
        z: newParent.scale.z / Math.max(.001, oldParent.scale.z),
      };
      let next: MapEntity;
      if (child.build?.placementVersion === 2) {
        next = {
          ...child,
          position: attachmentWorldPosition(child.build.localPosition, newParent),
          rotation: { ...child.rotation, y: newParent.rotation.y + child.build.localRotation.y },
          scale: { x: child.scale.x * ratio.x, y: child.scale.y * ratio.y, z: child.scale.z * ratio.z },
        };
      } else {
        const local = attachmentLocalPosition(child.position, oldParent);
        next = { ...child, position: attachmentWorldPosition(local, newParent), rotation: { ...child.rotation, y: child.rotation.y + newParent.rotation.y - oldParent.rotation.y }, scale: { x: child.scale.x * ratio.x, y: child.scale.y * ratio.y, z: child.scale.z * ratio.z } };
      }
      result.set(child.id, next);
      moveChildren(child, next);
    }
  };
  moveChildren(before, after);
  return entities.map((entry) => result.get(entry.id) ?? entry);
}

export function detachEntity(entities: MapEntity[], entityId: string): MapEntity[] {
  return entities.map((entry) => entry.id !== entityId || !entry.build ? entry : { ...entry, build: { placedAt: entry.build.placedAt, refundableUntil: entry.build.refundableUntil, placementVersion: 2, localPosition: { ...entry.position }, localRotation: { ...entry.rotation }, surfaceNormal: { x: 0, y: 1, z: 0 }, clearanceOffset: 0 } });
}
