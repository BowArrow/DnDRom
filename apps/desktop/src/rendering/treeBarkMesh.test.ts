import { describe, expect, it } from "vitest";
import { generateSpaceColonizedTree } from "../domain/worldArchitecture";
import { buildTreeBarkMesh } from "./treeBarkMesh";

describe("continuous botanical trunks", () => {
  for (const style of ["broadleaf", "pine", "cypress", "dead"] as const) {
    it(`${style}: connected growth, taper and finite outward tube geometry at every LOD`, () => {
      const tree = generateSpaceColonizedTree(441, style);
      tree.branches.forEach((branch, i) => {
        expect(branch.parent).toBeLessThanOrEqual(i);
        expect(branch.endRadius).toBeGreaterThan(0);
        expect(branch.startRadius).toBeGreaterThanOrEqual(branch.endRadius);
        if (branch.parent > 0) expect(branch.start).toEqual(tree.branches[branch.parent - 1].end);
        const children = tree.branches.filter(b => b.parent === i + 1);
        if (children.length === 1) expect(children[0].startRadius).toBeCloseTo(branch.endRadius, 10);
      });
      const counts: number[] = [];
      for (const lod of [0, 1, 2]) {
        const mesh = buildTreeBarkMesh(tree, lod);
        expect(mesh.positions.length).toBeGreaterThan(0);
        expect([...mesh.positions, ...mesh.normals, ...mesh.uvs].every(Number.isFinite)).toBe(true);
        expect(Math.max(...mesh.indices)).toBeLessThan(mesh.positions.length / 3);
        for (let i = 0; i < mesh.normals.length; i += 3) expect(Math.hypot(...mesh.normals.slice(i, i + 3))).toBeCloseTo(1, 6);
        // The base is a single closed radial ring, not an overlapping cone.
        const sides = lod === 0 ? 12 : lod === 1 ? 8 : 5;
        expect(mesh.positions.slice(0, 3)).toEqual(mesh.positions.slice(sides * 3, sides * 3 + 3).map((n, j) => Math.abs(n - mesh.positions[j]) < 1e-12 ? mesh.positions[j] : n));
        expect(mesh.uvs[(sides + 1) * 2 + 1]).toBeGreaterThan(mesh.uvs[1]);
        counts.push(mesh.indices.length);
      }
      expect(counts[1]).toBeLessThan(counts[0]); expect(counts[2]).toBeLessThan(counts[1]);
    });
  }
  it("varies architecture by seed and preserves scale proportions", () => {
    const tree = generateSpaceColonizedTree(72, "pine"), large = generateSpaceColonizedTree(72, "pine", 2);
    expect(generateSpaceColonizedTree(72, "pine")).toEqual(tree);
    expect(generateSpaceColonizedTree(73, "pine").branches).not.toEqual(tree.branches);
    expect(Math.max(...large.branches.map(b => b.end.y))).toBeCloseTo(Math.max(...tree.branches.map(b => b.end.y)) * 2, 1);
    const leader = tree.branches.filter(b => Math.hypot(b.end.x, b.end.z) < .2);
    expect(Math.max(...leader.map(b => b.end.y))).toBeGreaterThan(7);
  });
});
