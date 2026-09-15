/**
 * Deterministic dense ground-cover scattering.
 *
 * The layout uses independent globally anchored jitter and a small exclusion
 * radius resolved by stable neighbor priorities. Each accepted point is expanded by the GPU
 * into a crossed multi-blade cluster, following GPU Gems Chapter 7,
 * "Rendering Countless Blades of Waving Grass".
 */
export interface GroundCoverPoint { x: number; z: number; priority: number }

const hash01 = (x: number, z: number, seed: number): number => {
  let value = Math.imul((x ^ seed) | 0, 0x27d4eb2d) ^ Math.imul((z + seed) | 0, 0x165667b1);
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
  return ((value ^ (value >>> 13)) >>> 0) / 0xffffffff;
};

/** Independent appearance streams; acceptance priority is biased by density. */
export const scatterVariation = (x: number, z: number, seed: number, channel = 0): number =>
  hash01(Math.floor(x * 1024), Math.floor(z * 1024), seed + channel * 7919);

/** O(n) dense scatter with stable world-space cells and seamless chunk edges. */
export function denseGroundCoverPoints(
  originX: number,
  originZ: number,
  size: number,
  spacing: number,
  seed: number,
  densityAt: (x: number, z: number) => number,
): GroundCoverPoint[] {
  const step = Math.max(.18, spacing);
  const firstColumn = Math.floor(originX / step);
  const lastColumn = Math.ceil((originX + size) / step);
  const firstRow = Math.floor(originZ / step);
  const lastRow = Math.ceil((originZ + size) / step);
  const result: GroundCoverPoint[] = [];
  for (let row = firstRow; row <= lastRow; row++) for (let column = firstColumn; column <= lastColumn; column++) {
    // Independent full-cell jitter removes the eight-cell diagonal bands of
    // the former correlated lattice. Global integer cells preserve identity.
    const jitterX = hash01(column, row, seed + 17) - .5;
    const jitterZ = hash01(column, row, seed + 31) - .5;
    const x = (column + .5 + jitterX) * step;
    const z = (row + .5 + jitterZ) * step;
    if (x < originX || x >= originX + size || z < originZ || z >= originZ + size) continue;
    const priority = hash01(column, row, seed + 71);
    if (priority > Math.max(0, Math.min(1, densityAt(x, z)))) continue;
    let separated = true;
    for (let dz = -1; dz <= 1 && separated; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const cx = column + dx, cz = row + dz, rank = hash01(cx, cz, seed + 71);
      if (rank >= priority) continue;
      const nx = (cx + hash01(cx, cz, seed + 17)) * step, nz = (cz + hash01(cx, cz, seed + 31)) * step;
      if ((nx-x)**2 + (nz-z)**2 < (step*.38)**2 && rank <= Math.max(0, Math.min(1, densityAt(nx,nz)))) { separated = false; break; }
    }
    if (separated) result.push({ x, z, priority });
  }
  return result;
}
