# Procedural World Engine Implementation

## Authoritative generation pipeline

1. A schema-validated `WorldBlueprintV1` selects biome, landform controls, zones, roads, presentation, and reviewed asset requests. Generation is deterministic from the saved seed.
2. `buildWorldFieldSet` creates one region-wide field at 0.5 m spacing for 64/128 m regions and 1 m for 256 m regions. Chunks are exact slices of this shared authority, so borders cannot diverge.
3. Seeded Simplex fBM builds macro and detail landforms. Domain warping creates ridges; thermal erosion moves material down slopes; one-meter rounded terraces provide usable elevation gameplay.
4. Wang-Liu depression filling and D8 flow accumulation produce continuous drainage. Accumulated channels carve the elevation authority before lake masks, river ribbons, navigation, ecology, and placement sample it.
5. An anisotropic A* road graph penalizes grade, roughness, and water crossings. Collinear controls are simplified, Catmull-Rom curves pass through the remaining controls, road cores are graded exactly to the spline, and smooth shoulders cut/fill the surrounding terrain. Road surfaces are terrain weight-map layers, not stacked rectangles.
6. Road/river intersections emit aligned, walkable bridges. Navigation and collision compile from the same post-deformation heightfield.
7. Settlements use deterministic CGA shape grammar: composite footprints, floor-height constrained extrusion, facade tile subdivision, door/window/wall modules, and gable/hip roofs.
8. Trees use space colonization: biome-shaped attraction clouds, nearest-node influence, averaged directional growth, kill-radius pruning, tapered branch cylinders, and terminal leaf clusters.
9. Canopy, understory, and ground cover use Simplex density masks plus boundary-stable variable-radius Poisson sampling. Ground cover is sent as random-rotation/random-scale GPU instances.

## Rendering

- Terrain is a shadow-casting/receiving PBR mesh. Its shader uses true world-space triplanar grass, soil, rock, snow, and road layers; surface normal controls slope rock and world height controls snow. Absolute coordinates and macro variation prevent a recognizable texture patch from repeating per chunk.
- Rivers are Catmull-Rom ribbons and lakes use marching-squares shoreline meshes. Their shared shader applies three directional Gerstner waves, dual-scrolling normal maps, camera-depth Beer attenuation, screen refraction, a cubemap environment reflection probe, downstream flow, and bank-distance foam.
- Grass is a batched GPU-instanced blade-clump mesh. Its vertex shader combines stable per-blade phase wind with tip-weighted radial bending around the active player while roots remain anchored.
- Space-colonized trees render tapered branch and canopy meshes at three geometry LODs. Their PBR vertex deformation produces wind motion and animated shadows.
- Exterior worlds retain a directional readability sun and environment contribution. Practical lights supplement rather than replace daylight.
- Outdoor clouds are a fullscreen post effect backed by tiled 3D Perlin/value-Worley base noise and higher-frequency Worley detail. It raymarches the cloud slab and applies a secondary sun march with Beer-law transmittance. The effect is attached only after the viewport's real dimensions are known.

## Streaming, persistence, and interaction

- Every 16 m chunk owns terrain, water, structural entities, ecology, navigation, light influence, room/portal membership, and optional splat tiles. Terrain LOD0/1/2 uses 33/17/9 samples with skirts at mixed-LOD edges.
- Outdoor residency uses a conservative quadtree broad phase, nearest-bounds distance, and perspective-frustum bounds tests. The Forge overview keeps the complete draft resident; normal views use one-chunk preload and five-second eviction hysteresis. PlayCanvas performs final mesh-AABB draw culling.
- Indoor visibility traverses room portals before frustum testing. Off-screen lights remain only when their influence bounds touch visible chunks. Gameplay state remains in the map even when a render entity is absent.
- Upload work is queued to one chunk or four milliseconds per frame. Performance/Balanced/Cinematic caches are 256 MB/512 MB/1 GB.
- Terrain picking ray-marches the actual heightfield. Props land on elevation, and terrain chunks remain selectable across their complete 16 m bounds.
- Blueprints, chunk geometry, heightfields, navigation, splat tiles, scene thumbnails, and generation checkpoints use atomic content-addressed IndexedDB stores. The lightweight seed/blueprint/descriptors and player patches remain authoritative.

## Verified gates

- Focused algorithm, shader-contract, and visibility suite: 36 passing tests.
- Full desktop suite: 74 files, 311 passing and 5 skipped.
- Packaged 128 m Scene Forge smoke: two plans, 64 visible/resident overview chunks, gameplay validation, directional sun, generated bridges, all shader diagnostics, no WebView shader/runtime warnings, and visibly changing animation frames.
- Desktop TypeScript/Vite release build and Tauri executable/MSI/NSIS packaging complete successfully after the visual smoke gate.
