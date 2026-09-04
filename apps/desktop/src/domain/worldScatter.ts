/**
 * Deterministic dense ground-cover scattering.
 *
 * The layout uses a globally anchored, correlated multi-jittered lattice. It
 * avoids both Math.random clumps and the quadratic neighbor search of Poisson
 * sampling at grass-blade density. Each accepted point is expanded by the GPU
 * into a crossed multi-blade cluster, following GPU Gems Chapter 7,
 * "Rendering Countless Blades of Waving Grass".
 */
export interface GroundCoverPoint { x: number; z: number; priority: number }

const hash01 = (x: number, z: number, seed: number): number => {
  let value = Math.imul((x ^ seed) | 0, 0x27d4eb2d) ^ Math.imul((z + seed) | 0, 0x165667b1);
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
  return ((value ^ (value >>> 13)) >>> 0) / 0xffffffff;
};

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
    // Correlated multi-jitter: X takes its secondary stratum from row, Z from
    // column. Neighboring points cannot collapse into the same corner.
    const rankX = ((row * 5 + column * 3) & 7) / 8;
    const rankZ = ((column * 5 + row * 7) & 7) / 8;
    const jitterX = (rankX + hash01(column, row, seed + 17) / 8 - .5) * .82;
    const jitterZ = (rankZ + hash01(column, row, seed + 31) / 8 - .5) * .82;
    const x = (column + .5 + jitterX) * step;
    const z = (row + .5 + jitterZ) * step;
    if (x < originX || x >= originX + size || z < originZ || z >= originZ + size) continue;
    const priority = hash01(column, row, seed + 71);
    if (priority <= Math.max(0, Math.min(1, densityAt(x, z)))) result.push({ x, z, priority });
  }
  return result;
}
