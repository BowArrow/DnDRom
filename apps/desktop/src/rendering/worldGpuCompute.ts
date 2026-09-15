import * as pc from "playcanvas";

const WORKGROUP_SIZE = 64;
const WORDS_PER_CHUNK = 12;

/** One invocation culls one spatial grass chunk and writes one indirect draw. */
const GRASS_CHUNK_CULL_WGSL = `
#include "indirectCoreCS"

struct CullUniforms {
  frustumPlanes: array<vec4f, 6>,
  chunkCount: u32,
  indirectStart: u32,
  pad0: u32,
  pad1: u32
};
struct ChunkData {
  bounds: vec4f,
  indirectMetaData: vec4i,
  instanceCount: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32
};
@group(0) @binding(0) var<uniform> uniforms: CullUniforms;
@group(0) @binding(1) var<storage, read> chunks: array<ChunkData>;
@group(0) @binding(2) var<storage, read_write> indirectDrawBuffer: array<DrawIndexedIndirectArgs>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let chunkIndex = gid.x;
  if (chunkIndex >= uniforms.chunkCount) { return; }
  let chunk = chunks[chunkIndex];
  var visible = true;
  for (var planeIndex = 0; planeIndex < 6; planeIndex++) {
    let plane = uniforms.frustumPlanes[planeIndex];
    if (dot(plane.xyz, chunk.bounds.xyz) + plane.w < -chunk.bounds.w) {
      visible = false;
    }
  }
  let metaData = chunk.indirectMetaData;
  let index = uniforms.indirectStart + chunkIndex;
  indirectDrawBuffer[index].indexCount = u32(metaData.x);
  indirectDrawBuffer[index].instanceCount = select(0u, chunk.instanceCount, visible);
  indirectDrawBuffer[index].firstIndex = u32(metaData.y);
  indirectDrawBuffer[index].baseVertex = metaData.z;
  indirectDrawBuffer[index].firstInstance = 0u;
}`;

export interface WorldGrassComputeJob { destroy(): void }

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

type ChunkJob = {
  meshInstance: pc.MeshInstance;
  bounds: Float32Array;
  metadata: Int32Array;
  instanceCount: number;
};

const calculateWorldBounds = (matrices: Float32Array, origin: pc.Vec3, padding: number): Float32Array => {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let index = 0; index < matrices.length; index += 16) {
    const x = matrices[index + 12] + origin.x, y = matrices[index + 13] + origin.y, z = matrices[index + 14] + origin.z;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const x = (minX + maxX) * .5, y = (minY + maxY) * .5, z = (minZ + maxZ) * .5;
  return new Float32Array([x, y, z, Math.hypot((maxX - minX) * .5 + padding, (maxY - minY) * .5 + padding, (maxZ - minZ) * .5 + padding)]);
};

export function createWorldGpuComputeRuntime(device: pc.GraphicsDevice): WorldGpuComputeRuntime {
  const computeDisabled = typeof localStorage !== "undefined" && localStorage.getItem("dndrom.render.disableCompute.v1") === "1";
  if (!device.isWebGPU || !device.supportsCompute || computeDisabled) {
    return { backend: "webgl2-cpu-culling", supportsCompute: false, createGrassCullingJob: () => null, dispatch: () => undefined, destroy: () => undefined };
  }

  const uniformFormat = new pc.UniformBufferFormat(device, [
    new pc.UniformFormat("frustumPlanes", pc.UNIFORMTYPE_VEC4, 6),
    new pc.UniformFormat("chunkCount", pc.UNIFORMTYPE_UINT),
    new pc.UniformFormat("indirectStart", pc.UNIFORMTYPE_UINT),
    new pc.UniformFormat("pad0", pc.UNIFORMTYPE_UINT),
    new pc.UniformFormat("pad1", pc.UNIFORMTYPE_UINT),
  ]);
  const bindGroupFormat = new pc.BindGroupFormat(device, [
    new pc.BindUniformBufferFormat("uniforms", pc.SHADERSTAGE_COMPUTE),
    new pc.BindStorageBufferFormat("chunks", pc.SHADERSTAGE_COMPUTE, true),
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
  const compute = new pc.Compute(device, shader, "DnDRom grass visibility table");
  compute.setParameter("pad0", 0); compute.setParameter("pad1", 0);
  const jobs = new Set<ChunkJob>();
  const planes = new Float32Array(24);
  let chunksBuffer: pc.StorageBuffer | null = null;
  let jobsDirty = true;

  const uploadJobs = (ordered: ChunkJob[]) => {
    chunksBuffer?.destroy();
    const data = new ArrayBuffer(ordered.length * WORDS_PER_CHUNK * 4);
    const floats = new Float32Array(data), ints = new Int32Array(data), uints = new Uint32Array(data);
    ordered.forEach((job, index) => {
      const offset = index * WORDS_PER_CHUNK;
      floats.set(job.bounds, offset);
      ints.set(job.metadata, offset + 4);
      uints[offset + 8] = job.instanceCount;
    });
    chunksBuffer = new pc.StorageBuffer(device, data.byteLength, pc.BUFFERUSAGE_COPY_DST);
    chunksBuffer.write(0, new Uint8Array(data), 0, data.byteLength);
    compute.setParameter("chunks", chunksBuffer);
    jobsDirty = false;
  };

  return {
    backend: "webgpu-compute",
    supportsCompute: true,
    createGrassCullingJob: ({ meshInstance, matrices, worldOrigin, instanceRadius }) => {
      const record: ChunkJob = {
        meshInstance,
        bounds: calculateWorldBounds(matrices, worldOrigin, instanceRadius),
        metadata: meshInstance.getIndirectMetaData(),
        instanceCount: matrices.length / 16,
      };
      jobs.add(record); jobsDirty = true;
      let destroyed = false;
      return { destroy: () => {
        if (destroyed) return;
        destroyed = true;
        jobs.delete(record); jobsDirty = true;
        meshInstance.setIndirect(null, -1);
      } };
    },
    dispatch: (camera) => {
      const ordered = [...jobs];
      if (!ordered.length) return;
      if (jobsDirty) uploadJobs(ordered);
      for (let index = 0; index < 6; index++) {
        const plane = camera.frustum.planes[index];
        planes[index * 4] = plane.normal.x; planes[index * 4 + 1] = plane.normal.y;
        planes[index * 4 + 2] = plane.normal.z; planes[index * 4 + 3] = plane.distance;
      }
      const firstSlot = device.getIndirectDrawSlot(ordered.length);
      // Scope indirect visibility to the gameplay camera. Shadow and auxiliary
      // cameras keep their normal instance count and do not consume these slots.
      ordered.forEach((job, index) => job.meshInstance.setIndirect(camera, firstSlot + index, 1));
      compute.setParameter("frustumPlanes[0]", planes);
      compute.setParameter("chunkCount", ordered.length);
      compute.setParameter("indirectStart", firstSlot);
      compute.setParameter("indirectDrawBuffer", device.indirectDrawBuffer!);
      compute.setupDispatch(Math.ceil(ordered.length / WORKGROUP_SIZE), 1, 1);
      device.computeDispatch([compute], "DnDRom grass chunk culling");
    },
    destroy: () => {
      jobs.forEach((job) => job.meshInstance.setIndirect(null, -1));
      jobs.clear();
      compute.destroy(); chunksBuffer?.destroy(); shader.destroy(); bindGroupFormat.destroy();
    },
  };
}
