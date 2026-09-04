import * as pc from "playcanvas";

/** WebGPU chunk visibility and indirect drawing for dense ground cover. */
const GRASS_CHUNK_CULL_WGSL = `
#include "indirectCoreCS"

struct CullUniforms {
  frustumPlanes: array<vec4f, 6>,
  bounds: vec4f,
  indirectMetaData: vec4i,
  instanceCount: u32,
  indirectSlot: u32,
  pad0: u32,
  pad1: u32
};
@group(0) @binding(0) var<uniform> uniforms: CullUniforms;
@group(0) @binding(1) var<storage, read_write> indirectDrawBuffer: array<DrawIndexedIndirectArgs>;

@compute @workgroup_size(1)
fn main() {
  var visible = true;
  for (var planeIndex = 0; planeIndex < 6; planeIndex++) {
    let plane = uniforms.frustumPlanes[planeIndex];
    if (dot(plane.xyz, uniforms.bounds.xyz) + plane.w < -uniforms.bounds.w) {
      visible = false;
    }
  }
  let metaData = uniforms.indirectMetaData;
  let index = uniforms.indirectSlot;
  indirectDrawBuffer[index].indexCount = u32(metaData.x);
  indirectDrawBuffer[index].instanceCount = select(0u, uniforms.instanceCount, visible);
  indirectDrawBuffer[index].firstIndex = u32(metaData.y);
  indirectDrawBuffer[index].baseVertex = metaData.z;
  indirectDrawBuffer[index].firstInstance = 0u;
}`;

export interface WorldGrassComputeJob {
  dispatch(camera: pc.CameraComponent): void;
  destroy(): void;
}

export interface WorldGpuComputeRuntime {
  readonly backend: "webgpu-compute" | "webgl2-cpu-culling";
  readonly supportsCompute: boolean;
  createGrassCullingJob(input: {
    meshInstance: pc.MeshInstance;
    matrices: Float32Array;
    worldOrigin: pc.Vec3;
    instanceRadius: number;
  }): WorldGrassComputeJob | null;
  dispatch(camera: pc.CameraComponent): void;
  destroy(): void;
}

const calculateWorldBounds = (matrices: Float32Array, worldOrigin: pc.Vec3, instanceRadius: number): Float32Array => {
  let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY, minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY, maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < matrices.length; index += 16) {
    const x = matrices[index + 12] + worldOrigin.x;
    const y = matrices[index + 13] + worldOrigin.y;
    const z = matrices[index + 14] + worldOrigin.z;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const centerX = (minX + maxX) * .5, centerY = (minY + maxY) * .5, centerZ = (minZ + maxZ) * .5;
  const halfX = (maxX - minX) * .5 + instanceRadius;
  const halfY = (maxY - minY) * .5 + instanceRadius;
  const halfZ = (maxZ - minZ) * .5 + instanceRadius;
  return new Float32Array([centerX, centerY, centerZ, Math.hypot(halfX, halfY, halfZ)]);
};

export function createWorldGpuComputeRuntime(device: pc.GraphicsDevice): WorldGpuComputeRuntime {
  const jobs = new Set<WorldGrassComputeJob>();
  if (!device.isWebGPU || !device.supportsCompute) {
    return {
      backend: "webgl2-cpu-culling",
      supportsCompute: false,
      createGrassCullingJob: () => null,
      dispatch: () => undefined,
      destroy: () => jobs.clear(),
    };
  }

  const uniformFormat = new pc.UniformBufferFormat(device, [
    new pc.UniformFormat("frustumPlanes", pc.UNIFORMTYPE_VEC4, 6),
    new pc.UniformFormat("bounds", pc.UNIFORMTYPE_VEC4),
    new pc.UniformFormat("indirectMetaData", pc.UNIFORMTYPE_IVEC4),
    new pc.UniformFormat("instanceCount", pc.UNIFORMTYPE_UINT),
    new pc.UniformFormat("indirectSlot", pc.UNIFORMTYPE_UINT),
    new pc.UniformFormat("pad0", pc.UNIFORMTYPE_UINT),
    new pc.UniformFormat("pad1", pc.UNIFORMTYPE_UINT),
  ]);
  const bindGroupFormat = new pc.BindGroupFormat(device, [
    new pc.BindUniformBufferFormat("uniforms", pc.SHADERSTAGE_COMPUTE),
    new pc.BindStorageBufferFormat("indirectDrawBuffer", pc.SHADERSTAGE_COMPUTE),
  ]);
  const shader = new pc.Shader(device, {
    name: "DnDRomGrassChunkCull",
    shaderLanguage: pc.SHADERLANGUAGE_WGSL,
    cshader: GRASS_CHUNK_CULL_WGSL,
    cincludes: pc.ShaderChunks.get(device, pc.SHADERLANGUAGE_WGSL),
    computeBindGroupFormat: bindGroupFormat,
    computeUniformBufferFormats: { uniforms: uniformFormat },
  });

  const runtime: WorldGpuComputeRuntime = {
    backend: "webgpu-compute",
    supportsCompute: true,
    createGrassCullingJob: ({ meshInstance, matrices, worldOrigin, instanceRadius }) => {
      const compute = new pc.Compute(device, shader, "DnDRom grass chunk visibility");
      compute.setParameter("bounds", calculateWorldBounds(matrices, worldOrigin, instanceRadius));
      compute.setParameter("indirectMetaData", Array.from(meshInstance.getIndirectMetaData()));
      compute.setParameter("instanceCount", matrices.length / 16);
      compute.setParameter("pad0", 0); compute.setParameter("pad1", 0);
      const planes = new Float32Array(24);
      const job: WorldGrassComputeJob = {
        dispatch: (camera) => {
          for (let index = 0; index < 6; index++) {
            const plane = camera.frustum.planes[index];
            planes[index * 4] = plane.normal.x;
            planes[index * 4 + 1] = plane.normal.y;
            planes[index * 4 + 2] = plane.normal.z;
            planes[index * 4 + 3] = plane.distance;
          }
          compute.setParameter("frustumPlanes[0]", planes);
          const slot = device.getIndirectDrawSlot(1);
          meshInstance.setIndirect(null, slot, 1);
          compute.setParameter("indirectDrawBuffer", device.indirectDrawBuffer!);
          compute.setParameter("indirectSlot", slot);
          compute.setupDispatch(1, 1, 1);
          device.computeDispatch([compute], "DnDRom grass chunk culling");
        },
        destroy: () => {
          jobs.delete(job);
          meshInstance.setIndirect(null, -1);
          compute.destroy();
        },
      };
      jobs.add(job);
      return job;
    },
    dispatch: (camera) => jobs.forEach((job) => job.dispatch(camera)),
    destroy: () => {
      [...jobs].forEach((job) => job.destroy());
      shader.destroy();
      bindGroupFormat.destroy();
    },
  };
  return runtime;
}
