export interface ProbeBounceSource {
  x: number;
  y: number;
  z: number;
  radius: number;
  intensity: number;
  color: [number, number, number];
}

export interface LightProbeGrid {
  originX: number;
  originZ: number;
  spacingX: number;
  spacingZ: number;
  columns: number;
  rows: number;
  coefficients: Float32Array[];
}

interface BakeLightProbeGridOptions {
  width: number;
  depth: number;
  base: Float32Array;
  bounceTint: [number, number, number];
  sources: ProbeBounceSource[];
  maximumAxisProbes?: number;
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

const addCoefficient = (target: Float32Array, coefficient: number, color: [number, number, number], factor: number): void => {
  for (let channel = 0; channel < 3; channel++) target[coefficient * 3 + channel] += color[channel] * factor;
};

/**
 * Produces a bounded grid of nine-coefficient diffuse SH probes. The work is
 * done only when scene lighting/topology changes; a rendered object receives a
 * bilinearly interpolated 27-float value at runtime.
 */
export function bakeLightProbeGrid({ width, depth, base, bounceTint, sources, maximumAxisProbes = 12 }: BakeLightProbeGridOptions): LightProbeGrid {
  const columns = clamp(Math.ceil(width / 4) + 1, 2, maximumAxisProbes);
  const rows = clamp(Math.ceil(depth / 4) + 1, 2, maximumAxisProbes);
  const originX = -width / 2;
  const originZ = -depth / 2;
  const spacingX = width / (columns - 1);
  const spacingZ = depth / (rows - 1);
  const coefficients: Float32Array[] = [];

  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const x = originX + column * spacingX;
    const z = originZ + row * spacingZ;
    const probe = new Float32Array(base);
    for (const source of sources) {
      const dx = source.x - x;
      const dy = source.y - .55;
      const dz = source.z - z;
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      const radiusSquared = Math.max(.01, source.radius * source.radius);
      const window = Math.pow(clamp(1 - Math.pow(distanceSquared / radiusSquared, 2), 0, 1), 2);
      if (window <= .0001) continue;
      const inverseSquare = 1 / (1 + distanceSquared);
      const energy = Math.min(.24, inverseSquare * window * source.intensity * .42);
      const inverseLength = 1 / Math.sqrt(Math.max(.0001, distanceSquared));
      const direction = [dx * inverseLength, dy * inverseLength, dz * inverseLength] as const;
      const bounced: [number, number, number] = [
        source.color[0] * .55 + bounceTint[0] * .45,
        source.color[1] * .55 + bounceTint[1] * .45,
        source.color[2] * .55 + bounceTint[2] * .45,
      ];

      // Constant energy plus first-order directionality and restrained
      // second-order detail. Coefficient ordering matches PlayCanvas ambientSH.
      addCoefficient(probe, 0, bounced, energy * .72);
      addCoefficient(probe, 1, bounced, energy * direction[0] * .24);
      addCoefficient(probe, 2, bounced, energy * direction[1] * .24);
      addCoefficient(probe, 3, bounced, energy * direction[2] * .24);
      addCoefficient(probe, 4, bounced, energy * direction[0] * direction[2] * .08);
      addCoefficient(probe, 5, bounced, energy * direction[2] * direction[1] * .08);
      addCoefficient(probe, 6, bounced, energy * direction[1] * direction[0] * .08);
      addCoefficient(probe, 7, bounced, energy * (3 * direction[2] * direction[2] - 1) * .04);
      addCoefficient(probe, 8, bounced, energy * (direction[0] * direction[0] - direction[1] * direction[1]) * .04);
    }
    coefficients.push(probe);
  }

  return { originX, originZ, spacingX, spacingZ, columns, rows, coefficients };
}

export function sampleLightProbe(grid: LightProbeGrid, x: number, z: number): Float32Array {
  const gridX = clamp((x - grid.originX) / grid.spacingX, 0, grid.columns - 1);
  const gridZ = clamp((z - grid.originZ) / grid.spacingZ, 0, grid.rows - 1);
  const x0 = Math.floor(gridX), z0 = Math.floor(gridZ);
  const x1 = Math.min(grid.columns - 1, x0 + 1), z1 = Math.min(grid.rows - 1, z0 + 1);
  const tx = gridX - x0, tz = gridZ - z0;
  const at = (column: number, row: number) => grid.coefficients[row * grid.columns + column];
  const a = at(x0, z0), b = at(x1, z0), c = at(x0, z1), d = at(x1, z1);
  const result = new Float32Array(27);
  for (let index = 0; index < result.length; index++) {
    const top = a[index] + (b[index] - a[index]) * tx;
    const bottom = c[index] + (d[index] - c[index]) * tx;
    result[index] = top + (bottom - top) * tz;
  }
  return result;
}
