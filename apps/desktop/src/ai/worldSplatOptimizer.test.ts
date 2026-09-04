import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { MIN_GENERATED_WORLD_SPLATS, assessGeneratedWorldSplat, inspectSplatFile } from "../persistence/splatAssets";
import { needsRuntimeSplatCompression, optimizeWorldSplatForRuntime, partitionWorldSplatForStreaming, runtimeSplatFilename } from "./worldSplatOptimizer";

describe("world splat runtime optimization", () => {
  it("only recompresses editable PLY training output", () => {
    expect(needsRuntimeSplatCompression({ name: "world.ply" })).toBe(true);
    expect(needsRuntimeSplatCompression({ name: "world.compressed.ply" })).toBe(false);
    expect(needsRuntimeSplatCompression({ name: "world.sog" })).toBe(false);
  });

  it("uses PlayCanvas' recognizable compressed PLY suffix", () => {
    expect(runtimeSplatFilename("dndrom-world.ply")).toBe("dndrom-world.compressed.ply");
  });

  it("converts a Brush-style Gaussian PLY into compact runtime data", async () => {
    const header = `ply
format binary_little_endian 1.0
element vertex 1
property float x
property float y
property float z
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
`;
    const values = new Float32Array([0, 0, 0, 0.5, 0.4, 0.3, 1, -2, -2, -2, 1, 0, 0, 0]);
    const result = await optimizeWorldSplatForRuntime(new File([header, values.buffer], "world.ply"));
    expect(result.name).toBe("world.compressed.ply");
    expect(result.size).toBeGreaterThan(0);
    expect(await result.slice(0, 3).text()).toBe("ply");
  }, 15_000);

  it("partitions runtime scenery into independently loadable Morton tiles", async () => {
    const header = `ply
format binary_little_endian 1.0
element vertex 2
property float x
property float y
property float z
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
`;
    const first = [1, 0, 1, .5, .4, .3, 1, -2, -2, -2, 1, 0, 0, 0];
    const second = [7, 0, 1, .5, .4, .3, 1, -2, -2, -2, 1, 0, 0, 0];
    const tiles = await partitionWorldSplatForStreaming(new File([header, new Float32Array([...first, ...second]).buffer], "world.ply"), { min: { x: 0, y: -1, z: 0 }, max: { x: 8, y: 1, z: 4 } }, 4);
    expect(tiles.map((tile) => tile.id)).toEqual(["splat-0-0", "splat-1-0"]);
    await expect(Promise.all(tiles.map((tile) => inspectSplatFile(tile.file)))).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ splatCount: 1 }), expect.objectContaining({ splatCount: 1 })]));
  }, 15_000);

  it("removes oversized Gaussian sheets before runtime compression", async () => {
    const header = `ply
format binary_little_endian 1.0
element vertex 2
property float x
property float y
property float z
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
`;
    const safe = [0, 0, 0, .5, .4, .3, 1, -2, -2, -2, 1, 0, 0, 0];
    const sheet = [1, 1, 1, .5, .4, .3, 1, 4, 4, 4, 1, 0, 0, 0];
    const values = new Float32Array([...safe, ...sheet]);
    const result = await optimizeWorldSplatForRuntime(new File([header, values.buffer], "world.ply"), undefined, { maxGaussianScale: .5 });
    await expect(inspectSplatFile(result)).resolves.toMatchObject({ format: "compressed-ply", splatCount: 1 });
  }, 15_000);

  it("removes real-world outliers when the linear threshold is greater than one", async () => {
    const header = `ply
format binary_little_endian 1.0
element vertex 2
property float x
property float y
property float z
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
`;
    const safe = [0, 0, 0, .5, .4, .3, 1, Math.log(2), Math.log(2), Math.log(2), 1, 0, 0, 0];
    const sheet = [1, 1, 1, .5, .4, .3, 1, Math.log(18), Math.log(18), Math.log(18), 1, 0, 0, 0];
    const result = await optimizeWorldSplatForRuntime(new File([header, new Float32Array([...safe, ...sheet]).buffer], "world.ply"), undefined, { maxGaussianScale: 10 });
    await expect(inspectSplatFile(result)).resolves.toMatchObject({ format: "compressed-ply", splatCount: 1 });
  }, 15_000);

  it.skipIf(!process.env.DNDROM_LIVE_WORLD_PLY)("repairs a completed local Brush world without retraining it", async () => {
    const path = process.env.DNDROM_LIVE_WORLD_PLY!;
    const source = new File([await readFile(path)], "dndrom-world.ply");
    const inspection = await inspectSplatFile(source);
    const assessment = assessGeneratedWorldSplat(inspection);
    expect(assessment.repairable || assessment.accepted).toBe(true);
    const result = await optimizeWorldSplatForRuntime(source, undefined, { maxGaussianScale: inspection.quality?.recommendedMaxScale });
    const repaired = await inspectSplatFile(result);
    expect(repaired.splatCount).toBeGreaterThanOrEqual(MIN_GENERATED_WORLD_SPLATS);
    expect(result.size).toBeGreaterThan(0);
  }, 30_000);
});
