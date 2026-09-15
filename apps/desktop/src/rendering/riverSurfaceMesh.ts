/**
 * Continuous spline river surface tessellation.
 *
 * The centerline is sampled region-wide before streaming. This builder uses
 * those persistent tangents to create a shared-width frame, then tessellates
 * several cross-channel bands. Adjacent chunk excerpts therefore meet with
 * identical bank vertices instead of looking like independent quad planes.
 *
 * Reference model: Unreal Water Body rivers use a spline with per-point
 * width/depth/velocity metadata and transition into other water bodies.
 */

export interface RiverSurfacePoint {
  x: number;
  y: number;
  z: number;
  width: number;
  tangentX?: number;
  tangentZ?: number;
}

export interface RiverSurfaceMeshData {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
}

const CROSS_CHANNEL_BANDS = [-1, -.84, -.58, -.28, 0, .28, .58, .84, 1] as const;

const tangentAt = (path: readonly RiverSurfacePoint[], index: number): { x: number; z: number } => {
  const point = path[index];
  if (Number.isFinite(point.tangentX) && Number.isFinite(point.tangentZ)) {
    const length = Math.max(.0001, Math.hypot(point.tangentX!, point.tangentZ!));
    return { x: point.tangentX! / length, z: point.tangentZ! / length };
  }
  const previous = path[Math.max(0, index - 1)], next = path[Math.min(path.length - 1, index + 1)];
  const dx = next.x - previous.x, dz = next.z - previous.z, length = Math.max(.0001, Math.hypot(dx, dz));
  return { x: dx / length, z: dz / length };
};

const offsetAt = (path: readonly RiverSurfacePoint[], index: number, halfWidth: number): { x: number; z: number } => {
  const current = path[index];
  const direction = (a: RiverSurfacePoint, b: RiverSurfacePoint) => {
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.max(.0001, Math.hypot(dx, dz));
    return { x: dx / length, z: dz / length };
  };
  if (index === 0 || index === path.length - 1) {
    const tangent = tangentAt(path, index);
    return { x: -tangent.z * halfWidth, z: tangent.x * halfWidth };
  }
  const incoming = direction(path[index - 1], current), outgoing = direction(current, path[index + 1]);
  const incomingNormal = { x: -incoming.z, z: incoming.x }, outgoingNormal = { x: -outgoing.z, z: outgoing.x };
  const sumX = incomingNormal.x + outgoingNormal.x, sumZ = incomingNormal.z + outgoingNormal.z;
  const sumLength = Math.hypot(sumX, sumZ);
  if (sumLength < .001) return { x: outgoingNormal.x * halfWidth, z: outgoingNormal.z * halfWidth };
  const miterX = sumX / sumLength, miterZ = sumZ / sumLength;
  const denominator = Math.max(.38, Math.abs(miterX * outgoingNormal.x + miterZ * outgoingNormal.z));
  // A bounded miter keeps tight meanders from producing the radial spikes and
  // self-intersecting triangles seen in the old per-row normal frame.
  const length = Math.min(halfWidth * 1.32, halfWidth / denominator);
  return { x: miterX * length, z: miterZ * length };
};

export const buildContinuousRiverSurface = (
  paths: readonly (readonly RiverSurfacePoint[])[],
  origin: { x: number; y: number; z: number },
  bankDepth = .5,
): RiverSurfaceMeshData => {
  const mesh: RiverSurfaceMeshData = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
  for (const path of paths) {
    const cleanPath = path.filter((point, index) => index === 0 || Math.hypot(point.x - path[index - 1].x, point.z - path[index - 1].z) > .025);
    if (cleanPath.length < 2) continue;
    const base = mesh.positions.length / 3;
    let along = 0;
    for (let index = 0; index < cleanPath.length; index++) {
      const point = cleanPath[index], tangent = tangentAt(cleanPath, index);
      if (index) along += Math.hypot(point.x - cleanPath[index - 1].x, point.z - cleanPath[index - 1].z);
      const halfWidth = Math.max(.18, point.width * .5), bankOffset = offsetAt(cleanPath, index, halfWidth);
      const previous = cleanPath[Math.max(0, index - 1)], next = cleanPath[Math.min(cleanPath.length - 1, index + 1)];
      const alongX = next.x - previous.x, alongY = next.y - previous.y, alongZ = next.z - previous.z;
      const alongLength = Math.max(.0001, Math.hypot(alongX, alongY, alongZ));
      const normalX = -alongY * tangent.x / alongLength;
      const normalZ = -alongY * tangent.z / alongLength;
      const normalY = Math.sqrt(Math.max(.0001, 1 - Math.min(.95, normalX * normalX + normalZ * normalZ)));
      for (const band of CROSS_CHANNEL_BANDS) {
        // A shallow concave cross section keeps the banks visually embedded;
        // only the outermost 8% is lowered, so the water itself remains a
        // coherent surface rather than nine visibly stepped strips.
        const bankSink = Math.max(0, (Math.abs(band) - .92) / .08) * .025;
        mesh.positions.push(
          point.x - origin.x + bankOffset.x * band,
          point.y - origin.y - bankSink,
          point.z - origin.z + bankOffset.z * band,
        );
        mesh.normals.push(normalX, normalY, normalZ);
        mesh.uvs.push((band + 1) * .5, along / 3.5);
        const bank = Math.max(0, (Math.abs(band) - .72) / .28);
        mesh.colors.push(
          Math.round(bank * 255),
          Math.round((tangent.x * .5 + .5) * 255),
          Math.round((tangent.z * .5 + .5) * 255),
          Math.round(Math.min(1, Math.max(.08, bankDepth) / 3.2) * 255),
        );
      }
    }
    for (let index = 0; index < cleanPath.length - 1; index++) {
      const row = base + index * CROSS_CHANNEL_BANDS.length;
      const next = row + CROSS_CHANNEL_BANDS.length;
      for (let band = 0; band < CROSS_CHANNEL_BANDS.length - 1; band++) {
        mesh.indices.push(row + band, next + band, row + band + 1, row + band + 1, next + band, next + band + 1);
      }
    }
  }
  return mesh;
};

export const riverCrossChannelBandCount = CROSS_CHANNEL_BANDS.length;
