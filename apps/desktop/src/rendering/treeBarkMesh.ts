import type { Vec3, WorldTreeGeometry } from "../domain/types";

export interface TreeBarkBuffers { positions: number[]; normals: number[]; uvs: number[]; colors: number[]; indices: number[] }
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const unit = (a: Vec3) => mul(a, 1 / Math.max(1e-9, length(a)));
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** Swept branch chains with transported frames, shared rings and continuous
 * arc-length bark UVs. LOD removes whole terminal limbs, never alternate links.
 * Lateral tubes overlap within the parent; this is not a watertight union. */
export function buildTreeBarkMesh(tree: WorldTreeGeometry, lod = 0, color: number[] = [100, 78, 51, 255]): TreeBarkBuffers {
  const out: TreeBarkBuffers = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
  const branches = tree.branches, children = Array.from({ length: branches.length + 1 }, () => [] as number[]);
  branches.forEach((b, i) => children[b.parent]?.push(i));
  const main = children.map(list => list.reduce((best, i) => best < 0 || branches[i].startRadius > branches[best].startRadius ? i : best, -1));
  const sides = lod === 0 ? 12 : lod === 1 ? 8 : 5;
  const threshold = lod === 0 ? 0 : lod === 1 ? .025 : .06;
  const visited = new Set<number>();
  const sweep = (first: number, inheritedLength: number) => {
    if (visited.has(first)) return;
    const chain: number[] = [];
    let index = first;
    while (index >= 0 && !visited.has(index)) { visited.add(index); chain.push(index); index = main[index + 1]; }
    const firstBranch = branches[first];
    if (!chain.length || firstBranch.startRadius < threshold) return;
    const points = [firstBranch.start, ...chain.map(i => branches[i].end)];
    const radii = [firstBranch.startRadius, ...chain.map(i => branches[i].endRadius)];
    const arc = [inheritedLength];
    for (let j = 1; j < points.length; j++) arc.push(arc[j - 1] + length(sub(points[j], points[j - 1])));
    let side: Vec3 | undefined;
    const base = out.positions.length / 3;
    for (let ring = 0; ring < points.length; ring++) {
      const before = Math.max(0, ring - 1), after = Math.min(points.length - 1, ring + 1);
      const tangent = unit(sub(points[after], points[before]));
      // Project the previous frame into the new normal plane. This avoids the
      // arbitrary per-segment frame flip that rotated each bark patch.
      side = side ? unit(sub(side, mul(tangent, dot(side, tangent))))
        : unit(cross(tangent, Math.abs(tangent.y) > .9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }));
      const forward = unit(cross(tangent, side));
      const taper = (radii[before] - radii[after]) / Math.max(.001, arc[after] - arc[before]);
      for (let segment = 0; segment <= sides; segment++) {
        const angle = segment / sides * Math.PI * 2;
        const radial = add(mul(side, Math.cos(angle)), mul(forward, Math.sin(angle)));
        const point = add(points[ring], mul(radial, radii[ring]));
        const normal = unit(add(radial, mul(tangent, taper)));
        out.positions.push(point.x, point.y, point.z); out.normals.push(normal.x, normal.y, normal.z);
        out.uvs.push(segment / sides, arc[ring] * .65); out.colors.push(...color);
        if (ring && segment < sides) {
          const a = base + (ring - 1) * (sides + 1) + segment, b = a + sides + 1;
          out.indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    chain.forEach((i, j) => { for (const child of children[i + 1]) if (child !== main[i + 1]) sweep(child, arc[j + 1]); });
  };
  for (const root of children[0]) sweep(root, 0);
  return out;
}
