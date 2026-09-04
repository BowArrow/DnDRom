import { describe, expect, it } from "vitest";
import { dieGeometry, roundedDieMeshData } from "./SceneViewport";

describe("physical polyhedral dice", () => {
  it.each([
    [4, 4, 3],
    [6, 6, 4],
    [8, 8, 3],
    [10, 10, 4],
    [12, 12, 5],
    [20, 20, 3],
  ])("builds a d%i with the correct face count", (sides, faceCount, verticesPerFace) => {
    const geometry = dieGeometry(sides);
    expect(geometry.faces).toHaveLength(faceCount);
    expect(geometry.faces.every((face) => face.length === verticesPerFace)).toBe(true);
  });

  it("represents d100 rolls with the standard ten-face percentile geometry", () => {
    const geometry = dieGeometry(100);
    expect(geometry.faces).toHaveLength(10);
    expect(geometry.faces.every((face) => face.length === 4)).toBe(true);
  });

  it.each([4, 6, 8, 10, 12, 20])("adds rounded bevel and corner geometry to d%i", (sides) => {
    const geometry = dieGeometry(sides);
    const data = roundedDieMeshData(geometry);
    const flatTriangleCount = geometry.faces.reduce((sum, face) => sum + face.length - 2, 0);
    expect(data.indices).toHaveLength(data.positions.length / 3);
    expect(data.indices.length / 3).toBeGreaterThan(flatTriangleCount);
    expect(data.normals).toHaveLength(data.positions.length);
    expect(data.uvs).toHaveLength(data.positions.length / 3 * 2);
    expect(data.uvs.every(Number.isFinite)).toBe(true);
    expect(data.positions.every(Number.isFinite)).toBe(true);
    expect(data.normals.every(Number.isFinite)).toBe(true);
    expect(data.indices.length / 3).toBeLessThanOrEqual(256);
  });

  it("keeps every complete numbered die below the shared 256-triangle render budget", () => {
    for (const sides of [4, 6, 8, 10, 12, 20, 100]) {
      const bodyTriangles = roundedDieMeshData(dieGeometry(sides)).indices.length / 3;
      const numberTriangles = dieGeometry(sides).faces.length * 2;
      expect(bodyTriangles + numberTriangles).toBeLessThanOrEqual(256);
    }
  });

  it.each([4, 6, 8, 10, 12, 20, 100])("preserves isotropic 2:1 texture scale on every d%i surface triangle", (sides) => {
    const data = roundedDieMeshData(dieGeometry(sides));
    const edgeScales: number[] = [];
    for (let triangle = 0; triangle < data.indices.length; triangle += 3) {
      const vertices = data.indices.slice(triangle, triangle + 3);
      for (const [left, right] of [[0, 1], [1, 2], [2, 0]]) {
        const leftPosition = vertices[left] * 3;
        const rightPosition = vertices[right] * 3;
        const worldLength = Math.hypot(
          data.positions[rightPosition] - data.positions[leftPosition],
          data.positions[rightPosition + 1] - data.positions[leftPosition + 1],
          data.positions[rightPosition + 2] - data.positions[leftPosition + 2],
        );
        if (worldLength < 1e-6) continue;
        const leftUv = vertices[left] * 2;
        const rightUv = vertices[right] * 2;
        // U has twice as many source pixels as V in the 2:1 texture. Measuring
        // U at double weight verifies equal physical texel density on the die.
        const textureLength = Math.hypot(
          (data.uvs[rightUv] - data.uvs[leftUv]) * 2,
          data.uvs[rightUv + 1] - data.uvs[leftUv + 1],
        );
        edgeScales.push(textureLength / worldLength);
      }
    }
    expect(edgeScales.length).toBeGreaterThan(0);
    expect(Math.min(...edgeScales)).toBeCloseTo(1.2, 5);
    expect(Math.max(...edgeScales)).toBeCloseTo(1.2, 5);
  });

});
