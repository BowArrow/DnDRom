import { describe, expect, it } from "vitest";
import { inspectSplatFile } from "./splatAssets";

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
});
