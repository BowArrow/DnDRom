import * as pc from "playcanvas";

export const TOKEN_BASE_RIM_HEIGHT = .028;

export function tokenBaseTop(baseHeight: number): number {
  return baseHeight + TOKEN_BASE_RIM_HEIGHT;
}

export function localGroundingLift(modelWorldMinY: number, baseWorldY: number, parentWorldScaleY: number): number {
  const scale = Math.max(Math.abs(parentWorldScaleY), 1e-6);
  return (baseWorldY - modelWorldMinY) / scale;
}

function renderedWorldMinY(model: pc.Entity): number | null {
  model.syncHierarchy();
  let worldMinY = Number.POSITIVE_INFINITY;
  for (const render of model.findComponents("render") as pc.RenderComponent[]) {
    for (const meshInstance of render.meshInstances) worldMinY = Math.min(worldMinY, meshInstance.aabb.getMin().y);
  }
  return Number.isFinite(worldMinY) ? worldMinY : null;
}

function renderedWorldBounds(entity: pc.Entity): pc.BoundingBox | null {
  entity.syncHierarchy();
  let bounds: pc.BoundingBox | null = null;
  for (const render of entity.findComponents("render") as pc.RenderComponent[]) {
    for (const meshInstance of render.meshInstances) {
      const aabb = meshInstance.aabb;
      if (!bounds) bounds = new pc.BoundingBox(aabb.center.clone(), aabb.halfExtents.clone());
      else bounds.add(aabb);
    }
  }
  return bounds;
}

/** Frames arbitrary imported GLB units without changing their authored scale. */
export function frameEntityInCamera(camera: pc.Entity, entity: pc.Entity, padding = 1.28): boolean {
  const bounds = renderedWorldBounds(entity);
  if (!bounds) return false;
  const radius = Math.max(.35, bounds.halfExtents.length());
  const fov = (camera.camera?.fov ?? 38) * pc.math.DEG_TO_RAD;
  const distance = Math.max(1.4, radius / Math.max(.12, Math.sin(fov / 2)) * padding);
  const direction = new pc.Vec3(1.05, .76, 1.42).normalize();
  camera.setPosition(bounds.center.clone().add(direction.mulScalar(distance)));
  camera.lookAt(bounds.center);
  if (camera.camera) {
    camera.camera.nearClip = Math.max(.01, distance - radius * 1.6);
    camera.camera.farClip = Math.max(50, distance + radius * 3);
  }
  return true;
}

export function modelBaseGap(model: pc.Entity, parent: pc.Entity, baseTop: number): number | null {
  const worldMinY = renderedWorldMinY(model);
  if (worldMinY === null) return null;
  const baseWorldY = parent.getWorldTransform().transformPoint(new pc.Vec3(0, baseTop, 0)).y;
  return worldMinY - baseWorldY;
}

/**
 * Grounds an already-parented model by its rendered bounds. Scaling remains
 * centered inside the GLB, but the compensating translation keeps its lowest
 * visible point on the top of the miniature base.
 */
export function groundModelOnBase(model: pc.Entity, parent: pc.Entity, baseTop: number, fallbackLift = baseTop): number {
  const position = model.getLocalPosition().clone();
  model.setLocalPosition(position.x, 0, position.z);
  const worldMinY = renderedWorldMinY(model);

  if (worldMinY === null) {
    model.setLocalPosition(position.x, fallbackLift, position.z);
    model.syncHierarchy();
    return fallbackLift;
  }

  const baseWorldY = parent.getWorldTransform().transformPoint(new pc.Vec3(0, baseTop, 0)).y;
  const lift = localGroundingLift(worldMinY, baseWorldY, parent.getScale().y);
  model.setLocalPosition(position.x, lift, position.z);
  model.syncHierarchy();
  return lift;
}
