import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const computeSource = readFileSync(new URL("./worldGpuCompute.ts", import.meta.url), "utf8");
const viewportSource = readFileSync(new URL("../components/SceneViewport.tsx", import.meta.url), "utf8");

describe("WebGPU world compute contract", () => {
  it("culls grass chunks on the GPU and writes indirect draw arguments", () => {
    expect(computeSource).toContain("@compute @workgroup_size");
    expect(computeSource).toContain("frustumPlanes: array<vec4f, 6>");
    expect(computeSource).toContain("instanceCount = select(0u, chunk.instanceCount, visible)");
    expect(computeSource).toContain("var<storage, read> chunks: array<ChunkData>");
    expect(computeSource).toContain("DrawIndexedIndirectArgs");
    expect(computeSource).not.toContain("visibleMatrices");
    expect(computeSource).toContain("getIndirectDrawSlot(ordered.length)");
    expect(computeSource).toContain("setIndirect(camera, firstSlot + index, 1)");
  });

  it("selects WebGPU first and retains a named WebGL2 fallback", () => {
    expect(viewportSource).toContain("pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2");
    expect(computeSource).toContain('backend: "webgl2-cpu-culling"');
    expect(computeSource).toContain("!device.isWebGPU || !device.supportsCompute");
  });

  it("dispatches compute during update before render encoders open", () => {
    expect(viewportSource).toContain('app.on("update", updateScene)');
    expect(viewportSource).toContain('app.on("update", dispatchWorldCompute)');
    expect(viewportSource).not.toContain('app.on("prerender", dispatchWorldCompute)');
  });
});
