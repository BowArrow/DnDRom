import type { GameMap, MapEntity } from "./types";

const hasInteriorTag = (entity: MapEntity): boolean => entity.tags?.some((tag) =>
  tag === "world:interior" || tag === "world:portal" || tag.startsWith("room:") || tag.startsWith("rooms:"),
) ?? false;

/**
 * Classifies both current Forge maps and maps created before WorldBlueprintV1.
 *
 * Older tavern/dungeon maps only stored their theme and a tiled floor/wall
 * layout. Treating those room-sized primitives as exterior props enables the
 * CameraFrame outdoor stack and projected scan materials, which can turn the
 * floor black and stretch bright texture arcs across it.
 */
export function isInteriorMap(map: GameMap): boolean {
  const kind = map.generation?.blueprint.kind;
  if (kind) return kind === "interior" || kind === "dungeon";
  if (map.entities.some(hasInteriorTag)) return true;
  if (map.world?.chunks.some((chunk) => (chunk.roomIds?.length ?? 0) > 0 || (chunk.portalChunkIds?.length ?? 0) > 0)) return true;
  if (["tavern", "dungeon", "cavern"].includes(map.theme)) return true;
  if (map.theme !== "ruins" || map.world) return false;
  const floorCount = map.entities.filter((entity) => entity.assetId === "floor-stone" || entity.assetId === "floor-wood").length;
  const wallCount = map.entities.filter((entity) => entity.assetId === "wall-stone" || entity.assetId === "wall-wood").length;
  return floorCount >= 4 && wallCount >= 4;
}

