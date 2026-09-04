export const MIN_MINIATURE_FACES = 5_000;
export const MAX_MINIATURE_FACES = 20_000;
export const DEFAULT_MINIATURE_FACES = MAX_MINIATURE_FACES;
export const DEFAULT_MINIATURE_TEXTURE_SIZE = 2_048;
export const DEFAULT_MINIATURE_SOURCE_RESOLUTION = 1_024;
export const DEFAULT_MINIATURE_REMESH_RESOLUTION = 256;
export const DEFAULT_MINIATURE_PRECLUSTER_MAX_VERTICES = 300_000;
export const DEFAULT_MINIATURE_SMOOTH_ITERATIONS = 3;
export const MAX_PROCEDURAL_DIE_TRIANGLES = 256;

export function clampMiniatureFaces(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MINIATURE_FACES;
  return Math.min(MAX_MINIATURE_FACES, Math.max(MIN_MINIATURE_FACES, Math.round(value)));
}
