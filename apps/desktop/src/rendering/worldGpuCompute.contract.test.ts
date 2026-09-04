import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const computeSource = readFileSync(new URL("./worldGpuCompute.ts", import.meta.url), "utf8");
const viewportSource = readFileSync(new URL("../components/SceneViewport.tsx", import.meta.url), "utf8");

describe("WebGPU world compute contract", () => {
  it("culls grass chunks on the GPU and writes indirect draw arguments", () => {
    expect(computeSource).toContain("@compute @workgroup_size");
    expect(computeSource).toContain("frustumPlanes: array<vec4f, 6>");
    expect(computeSource).toContain("instanceCount = select(0u, uniforms.instanceCount, visible)");
    expect(computeSource).toContain("DrawIndexedIndirectArgs");
    expect(computeSource).not.toContain("visibleMatrices");
    expect(computeSource).toContain("getIndirectDrawSlot(1)");
    expect(computeSource).toContain("meshInstance.setIndirect(null, slot, 1)");
  });

  it("selects WebGPU first and retains a named WebGL2 fallback", () => {
    expect(viewportSource).toContain("pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2");
    expect(computeSource).toContain('backend: "webgl2-cpu-culling"');
    expect(computeSource).toContain("!device.isWebGPU || !device.supportsCompute");
  });

  it("dispatches compute inside the render update rather than a detached callback", () => {
    expect(viewportSource).toContain('app.on("update", updateScene)');
    expect(viewportSource).toContain("runtime.worldCompute.dispatch(camera.camera)");
  });
});
