# WebGPU compute pipeline

DnDRom requests PlayCanvas WebGPU first and retains WebGL2 as a compatibility
fallback. Compute work is dispatched during `prerender`, after the WebGPU frame
starts and before the frame graph opens its first render pass.

## Implemented renderer workload

Dense grass is grouped by the existing 16 m world chunks. Each active chunk
contributes one packed storage-buffer record containing its world-space bounding
sphere, indexed-mesh metadata, and instance count. One WGSL dispatch evaluates
all records against the gameplay camera's six frustum planes and writes a
contiguous table of `DrawIndexedIndirectArgs`. The main camera consumes those
slots; shadow and auxiliary cameras retain their normal instance counts.

This design intentionally keeps PlayCanvas's instance matrices in an ordinary
vertex buffer. Aliasing that buffer as writable compute storage caused invalid
mesh bindings in WebGPU. The packed chunk table is recreated only when streamed
chunk membership changes and is reused frame-to-frame.

When WebGPU compute is unavailable, the world keeps the existing CPU quadtree,
frustum, room/portal, LOD, preload, and eviction path. A local recovery switch,
`dndrom.render.disableCompute.v1=1`, forces that fallback without disabling the
WebGPU renderer.

## Next compute workloads

The same runtime boundary should host these as separate generation/render passes:

1. Heightfield noise, droplet hydraulic erosion, thermal relaxation, and flow
   accumulation into storage textures. These are generation jobs and should run
   only when a chunk is authored or invalidated, never every render frame.
2. Biome-mask evaluation and blue-noise foliage candidate classification. The
   resulting instance buffers remain content-addressed chunk artifacts.
3. Hi-Z occlusion after the current frustum pass. Build a depth pyramid from the
   prior frame, test conservative chunk bounds, and preserve one-frame hysteresis
   so camera motion does not pop terrain or landmarks.
4. Water simulation tiles near the camera. Distant rivers and lakes keep the
   cheaper analytic Gerstner/flow shader.

CPU-authored blueprint, seed, gameplay height/collision, and patches remain the
authority. GPU products are derived caches and must be reproducible or safely
discardable.

## Validation

`scripts/smoke-packaged.mjs` exposes `graphicsBackend` and `worldCompute` from
the real packaged WebView. Set `DNDROM_SMOKE_PROCEDURAL_WORLD=1` and
`DNDROM_SMOKE_WORLD_ONLY=1` to generate a medium world and assert the active
backend without running unrelated character/dice flows.
