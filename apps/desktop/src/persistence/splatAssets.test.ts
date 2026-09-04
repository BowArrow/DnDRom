import { describe, expect, it } from "vitest";
import { alignGeneratedSplatToWorld, assessGeneratedWorldSplat, assessSplatReconstructionQuality, fitSplatBoundsToTabletop, inspectSplatFile } from "./splatAssets";

const gaussianHeader = `ply
format binary_little_endian 1.0
element vertex 42
property float x
property float y
property float z
property float f_dc_0
property float scale_0
property float rot_0
property float opacity
end_header
`;

describe("Gaussian-splat import validation", () => {
  it("recognizes a standard trained 3DGS PLY and its splat count", async () => {
    const file = new File([gaussianHeader, new Uint8Array(32)], "village.ply");
    await expect(inspectSplatFile(file)).resolves.toEqual({ format: "ply", splatCount: 42 });
  });

  it("rejects an ordinary mesh PLY", async () => {
    const file = new File(["ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nend_header\n"], "mesh.ply");
    await expect(inspectSplatFile(file)).rejects.toThrow(/Gaussian-splat properties/);
  });

  it("reads binary source bounds without decoding colors or spherical harmonics", async () => {
    const header = gaussianHeader.replace("element vertex 42", "element vertex 2");
    const body = new ArrayBuffer(2 * 7 * 4);
    const view = new DataView(body);
    [-10, -2, -5, 0, 0, 0, 0, 10, 4, 5, 0, 0, 0, 0].forEach((value, index) => view.setFloat32(index * 4, value, true));
    const file = new File([header, body], "bounded-world.ply");
    await expect(inspectSplatFile(file)).resolves.toMatchObject({
      format: "ply",
      splatCount: 2,
      bounds: { min: { x: -10, y: -2, z: -5 }, max: { x: 10, y: 4, z: 5 } },
    });
  });

  it("reads chunk bounds from PlayCanvas compressed PLY files", async () => {
    const chunkProperties = ["min_x", "min_y", "min_z", "max_x", "max_y", "max_z", "min_scale_x", "min_scale_y", "min_scale_z", "max_scale_x", "max_scale_y", "max_scale_z", "min_r", "min_g", "min_b", "max_r", "max_g", "max_b"];
    const header = [
      "ply", "format binary_little_endian 1.0", "element chunk 1",
      ...chunkProperties.map((name) => `property float ${name}`),
      "element vertex 1", "property uint packed_position", "property uint packed_rotation", "property uint packed_scale", "property uint packed_color", "end_header\n",
    ].join("\n");
    const body = new ArrayBuffer(chunkProperties.length * 4 + 16);
    const view = new DataView(body);
    [-474, -669, -650, 747, 250, 542].forEach((value, index) => view.setFloat32(index * 4, value, true));
    const file = new File([header, body], "legacy-world.compressed.ply");
    await expect(inspectSplatFile(file)).resolves.toMatchObject({
      format: "compressed-ply",
      splatCount: 1,
      bounds: { min: { x: -474, y: -669, z: -650 }, max: { x: 747, y: 250, z: 542 } },
    });
  });

  it("fits uncalibrated reconstruction coordinates to the gameplay tabletop", () => {
    const transform = fitSplatBoundsToTabletop({
      min: { x: -473.911, y: -669.007, z: -649.855 },
      max: { x: 747.225, y: 249.706, z: 541.923 },
    }, { width: 18, depth: 14, gridSize: 1 });
    expect(transform.scale.x).toBeCloseTo(0.0141, 3);
    expect(transform.scale).toEqual({ x: transform.scale.x, y: transform.scale.x, z: transform.scale.x });
    expect(transform.rotation).toEqual({ x: 180, y: 0, z: 0 });
    expect(Math.max(1221.136 * transform.scale.x, 1191.778 * transform.scale.z)).toBeLessThan(18);
  });

  it("grounds generated scenery without stretching it to the tabletop", () => {
    const transform = alignGeneratedSplatToWorld({ min: { x: -4, y: -2, z: -8 }, max: { x: 6, y: 3, z: 2 } });
    expect(transform.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(transform.position).toEqual({ x: -1, y: 3, z: -3 });
  });

  it("requires complete camera coverage and rejects presentation clouds in gameplay space", () => {
    const accepted = assessSplatReconstructionQuality({
      registeredCameraRatio: .91, railRegistrationRatios: [.8, .78, .82, .76], largestComponentRatio: .94,
      gaussianCount: 240_000, groundPlaneSupport: .73, boundsToRailRatio: 3,
    });
    expect(accepted.accepted).toBe(true);
    const rejected = assessSplatReconstructionQuality({
      registeredCameraRatio: .9, railRegistrationRatios: [.9], largestComponentRatio: .94,
      gaussianCount: 240_000, groundPlaneSupport: .73, boundsToRailRatio: 3, gameplayVolumeIntersection: true,
    });
    expect(rejected).toMatchObject({ accepted: false, reasons: expect.arrayContaining([expect.stringMatching(/every camera rail/i), expect.stringMatching(/gameplay volume/i)]) });
  });

  it("rejects sparse or sheet-like training output before it can cover the tabletop", () => {
    expect(assessGeneratedWorldSplat({
      format: "ply",
      splatCount: 71_948,
      quality: {
        robustSpan: 283.5,
        medianScale: 2.08,
        p90Scale: 7.15,
        p99Scale: 18.75,
        visibleP99Scale: 16.2,
        recommendedMaxScale: 9.92,
      },
    })).toMatchObject({ accepted: false, repairable: false, reasons: expect.arrayContaining([expect.stringMatching(/80,000 minimum/), expect.stringMatching(/oversized Gaussian/)]) });
  });

  it("marks a dense world with only oversized outliers as repairable", () => {
    expect(assessGeneratedWorldSplat({
      format: "ply",
      splatCount: 113_568,
      quality: {
        robustSpan: 277.63,
        medianScale: 1.65,
        p90Scale: 6.32,
        p99Scale: 17.81,
        visibleP99Scale: 12.57,
        recommendedMaxScale: 9.72,
      },
    })).toMatchObject({ accepted: false, repairable: true, reasons: [expect.stringMatching(/oversized Gaussian/)] });
  });

  it("accepts a dense reconstruction with bounded Gaussian scales", () => {
    expect(assessGeneratedWorldSplat({
      format: "ply",
      splatCount: 240_000,
      quality: {
        robustSpan: 120,
        medianScale: .18,
        p90Scale: .7,
        p99Scale: 2.2,
        visibleP99Scale: 1.8,
        recommendedMaxScale: 4.2,
      },
    })).toEqual({ accepted: true, repairable: false, reasons: [] });
  });
});
