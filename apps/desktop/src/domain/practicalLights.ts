import { ASSET_BY_ID } from "./assets";
import type { MapEntity, PracticalLightBehavior, Vec3 } from "./types";

export interface ResolvedPracticalLight {
  behavior: PracticalLightBehavior;
  position: Vec3;
  direction: Vec3;
}

const normalized = (value: Vec3): Vec3 => {
  const length = Math.hypot(value.x, value.y, value.z) || 1;
  return { x: value.x / length, y: value.y / length, z: value.z / length };
};

const rotateY = (value: Vec3, degrees: number): Vec3 => {
  const radians = degrees * Math.PI / 180;
  return {
    x: value.x * Math.cos(radians) + value.z * Math.sin(radians),
    y: value.y,
    z: -value.x * Math.sin(radians) + value.z * Math.cos(radians),
  };
};

export const practicalLightBehaviorForEntity = (entity: MapEntity): PracticalLightBehavior | null => {
  if (entity.light?.kind === "practical-light") return entity.light;
  const behavior = ASSET_BY_ID.get(entity.assetId)?.defaultBehavior;
  return behavior?.kind === "practical-light" ? behavior : null;
};

/** Converts the editable local light anchor/direction into map space. */
export const resolvePracticalLight = (entity: MapEntity): ResolvedPracticalLight | null => {
  const behavior = practicalLightBehaviorForEntity(entity);
  if (!behavior || entity.hidden) return null;
  const scaledAnchor = {
    x: behavior.anchor.x * entity.scale.x,
    y: behavior.anchor.y * entity.scale.y,
    z: behavior.anchor.z * entity.scale.z,
  };
  const anchor = rotateY(scaledAnchor, entity.rotation.y);
  return {
    behavior,
    position: { x: entity.position.x + anchor.x, y: entity.position.y + anchor.y, z: entity.position.z + anchor.z },
    direction: normalized(rotateY(behavior.direction, entity.rotation.y)),
  };
};
