# Procedural Engine Research and DnDRom Reference Architecture

Date: 2026-09-03

Status: research complete; implementation intentionally not started in this pass.

## Decision

DnDRom needs a native terrain and ecosystem engine built on PlayCanvas, not a larger pile of noise and primitive meshes. Modern systems consistently share terrain-derived fields between erosion, water, roads, materials, foliage, navigation and streaming. That shared data model is the missing foundation.

There is one component we can adopt directly: the current PlayCanvas 2.21 water renderer. It already implements reflection/refraction, depth color, soft shore contact, foam, Gerstner waves, sun response and underwater treatment. DnDRom is pinned to PlayCanvas 2.21.4, so this is a much better baseline than writing another flat transparent-blue material. Lakes and oceans can use it directly on generated footprints. Rivers need a custom variable-width spline mesh and flow map while sharing the same water render service.

The commercial terrain tools remain references or optional studio baking tools. They are not player-runtime dependencies:

- Gaea and World Creator are licensed desktop terrain authoring applications.
- Houdini batch/custom-host integration requires the corresponding Houdini Engine license.
- Unreal and Unity systems cannot be embedded into the current PlayCanvas runtime.
- SpeedTree can provide excellent authored vegetation, but distribution and SDK terms need a license review.

## What the engines reveal

| Reference | What creates quality | What DnDRom should copy |
|---|---|---|
| [Unreal Landscape, Water, PCG and World Partition](https://dev.epicgames.com/documentation/unreal-engine/water-body-actors-in-unreal-engine?lang=en-US) | spline water that carves terrain, shared water mesh/transitions, hierarchical vegetation generation, landscape material layers, HLOD proxies | continuous terrain-deforming features, scale-separated ecology, never replace visible terrain with empty space |
| [Houdini HeightFields](https://www.sidefx.com/docs/houdini/nodes/sop/heightfield_erode.html) | multi-scale hydraulic/thermal erosion and reusable flow, sediment, debris, slope and curvature masks | make derived fields first-class outputs consumed by every later pass |
| [Gaea Erosion and Rivers](https://docs.gaea.app/reference/nodes/simulate/rivers.html) | deterministic erosion at multiple scales; rivers create unbroken paths and modify the landform | apply erosion to designed macro terrain, then turn drainage into carved continuous networks |
| [World Creator](https://docs.world-creator.com/) | designed landscape layers plus GPU filters, biome distributions, object scatter, height-blended materials and dedicated simulations | combine authored constraints with procedural variation; do not rely on undirected noise |
| [Unity Terrain Tools and HDRP](https://docs.unity3d.com/cn/6000.0/Manual/render-pipelines-feature-comparison.html) | erosion tools plus a water renderer with waves, currents, foam, deformation and gameplay queries | separate hydrology from water optics, but connect them through flow/depth data |
| [SpeedTree](https://store.speedtree.com/speedtree9ishere/) | procedural plant structure, hand-authored correction, species variants, wind tiers, LODs and billboards | use quality plant families and aggressively reduce wind, shadows and geometry by distance |
| [Minecraft world generation](https://learn.microsoft.com/en-us/minecraft/creator/documents/world-generation?view=minecraft-bedrock-stable) | deterministic ordered passes and data-driven biome/feature rules per chunk | terrain before features; stable seeds and schema-constrained rules |
| [O3DE terrain](https://docs.o3de.org/docs/user-guide/components/reference/terrain/world-renderer/) | continuous LOD/clipmaps, macro/detail material separation, gradient-driven vegetation filters | preserve a coarse terrain representation and stop texture repetition with frequency separation |
| [Terrain3D](https://github.com/TokisanGames/Terrain3D/blob/main/doc/docs/system_architecture.md) | camera-centered geometry clipmap plus region-backed editing and cell-bounded foliage instances | decouple authoritative chunks from the terrain render mesh |
| [PlayCanvas 2.21](https://github.com/playcanvas/engine/blob/main/scripts/esm/water.mjs) | PBR, procedural meshes, instancing/multi-draw and now a capable MIT water renderer | use PlayCanvas as the runtime foundation and implement the missing world compiler natively |

## The target architecture

```text
player description
  -> validated WorldBlueprintV2
  -> WorldFieldSet
       elevation, rock, soil, moisture, slope, curvature,
       filled elevation, flow, accumulation, sediment, biome weights
  -> WorldFeatureGraph
       rivers, lakes, roads, bridges, lots, structures, protected play areas
  -> derived render data
       terrain LODs, collision/nav, material weights, water surfaces,
       foliage instance groups, macro terrain proxy
  -> visibility runtime
       frustum + screen-size LOD, persistent proxy, upload/eviction budgets
```

AI chooses landform families, climate, material identities, species palettes and procedural parameters. It may request missing hero assets. It does not write unrestricted vertices or replace gameplay geometry with a splat.

### Terrain

Generate one global field for the region before cutting it into chunks. For a default 128 m scene, use a 257x257 authority heightfield at 0.5 m spacing; a higher profile can use 513x513 at 0.25 m. Each 16 m chunk samples an apron from this shared field.

The pass order should be:

1. authored ridge, basin, plateau, valley, coast and protected-play fields;
2. domain-warped macro and meso noise;
3. bounded thermal and hydraulic/fluvial erosion at two scales;
4. depression resolution, flow and accumulation;
5. river/lake extraction and terrain carving;
6. road routing, grade repair and cut/fill;
7. slope, curvature, soil, moisture, sediment and disturbance masks;
8. terrain mesh, collision, navigation and material compilation.

This matches the multi-scale erosion practice documented by [Houdini](https://www.sidefx.com/docs/houdini/heightfields/erosion.html) and [Gaea Erosion2](https://docs.gaea.app/using/using-gaea/understanding-erosion/erosion_2/). Noise creates variation; erosion and feature constraints create readable geology.

### Rivers, roads and water

Raster cells are analysis data, never final geometry.

- Trace flow cells into a graph of sources, reaches, confluences and outlets.
- Fit constrained splines while retaining junctions and downhill order.
- Increase river width/depth from flow accumulation and carve a smooth bank/bed profile.
- Generate a continuous triangulated footprint or variable-width ribbon, clipped per chunk with identical boundary samples.
- Store downstream tangent and speed in vertices or a flow texture.
- Use shoreline distance for wet terrain, shallow color, foam and foliage exclusion.
- Keep road A*, but fit curvature-limited splines, enforce grade, cut/fill terrain and extrude a road/shoulder/ditch cross-section.

For water rendering, use one scene-level service:

- Performance: sky reflection, depth color and flow normals.
- Balanced: shared half-resolution planar reflection, depth absorption and shore foam.
- Cinematic: planar reflection/refraction, waves and optional caustics.

The upstream [PlayCanvas water implementation](https://github.com/playcanvas/engine/blob/main/scripts/esm/water.mjs) explicitly includes planar/sky reflection, refraction, depth-based absorption, soft shores, foam and Gerstner waves. The [official example](https://github.com/playcanvas/engine/blob/main/examples/src/examples/graphics/water.example.mjs) also pairs it with a directional sun, procedural sky, image-based light and tone-mapped camera. That is the correct outdoor lighting baseline too.

### Terrain materials

Replace the repeated grass image with a macro/detail system:

- A low-frequency region map supplies broad color, moisture and biome variation.
- Packed field weights select grass, soil, mud, rock, sand or snow.
- Height-aware blending makes transitions organic.
- Stochastic rotation/mirroring and macro tint break tiling.
- Triplanar projection avoids stretched cliff textures.
- Road, bank and structure masks remove grass and blend disturbed ground.

[O3DE's terrain materials](https://www.docs.o3de.org/docs/user-guide/components/reference/terrain/terrain-detail-material/) explicitly combine low-frequency macro color with nearby high-frequency detail, while [Unreal Landscape Materials](https://dev.epicgames.com/documentation/unreal-engine/landscape-materials-in-unreal-engine) provide weight and height blending. DnDRom can reproduce this with a PlayCanvas texture array and packed weight textures; full virtual texturing is unnecessary until profiling shows a need.

### Foliage

Do not build forests by placing more copies of one cone tree. Use three linked populations:

- canopy: mature trees and major deadwood;
- understory: saplings, shrubs, reeds and ferns;
- ground cover: grasses, flowers, leaf litter, stones and fungi.

Species profiles score deterministic blue-noise candidates against moisture, slope, elevation, soil, canopy light, water distance, disturbance and competition. Parent-relative subobjects create natural clusters such as mushrooms near stumps or ferns under canopy.

Use curated GLB families first—potentially licensed SpeedTree exports after review—with several silhouettes, age classes and damaged/dead variants per dominant species. Group instances by chunk/cell, species, material and LOD. Close trees get branch/leaf wind and full shadows; mid trees use global sway and simplified shadows; far trees use no wind and impostors. SpeedTree's own [performance guidance](https://docs8.speedtree.com/sdk/doku.php?id=legacy_pages%3Aperformance) recommends moving quickly from full wind to global or none.

### Streaming without visible holes

The current fixed chunk-distance rule is unsuitable for a tabletop camera that can see most of the map. Distance selects detail; it must not decide that visible terrain ceases to exist.

- First intersect the actual camera frustum with chunk bounds.
- Choose LOD by projected screen error and distance.
- Keep a whole-region macro terrain/HLOD proxy resident.
- Overlay 33x33, 17x17 and 9x9 meshes per 16 m chunk as detail becomes available.
- Geomorph or cross-fade LOD transitions and share border samples.
- Keep foliage and structures chunk-streamed, but never evict the terrain proxy.
- Add an overview mode that deliberately renders the entire region at a coarse LOD.

This follows Unreal's [HLOD behavior](https://dev.epicgames.com/documentation/unreal-engine/world-partition---hierarchical-level-of-detail-in-unreal-engine?lang=en-US), where unloaded cells can retain proxy geometry, and O3DE/Terrain3D's continuous or clipmap LOD strategy.

## Build versus integrate

| Action | Systems |
|---|---|
| Adopt now | PlayCanvas Water, PBR, procedural sky/IBL, CameraFrame, instancing and multi-draw |
| Adapt | one shared water render service, polygon lake surfaces and flow-mapped river material |
| Build natively | field graph, erosion, drainage, feature curves, terrain compiler, ecosystem solver, material weights and visibility policy |
| Optional internal tools | Gaea automation or Houdini Engine for authoring presets/golden references |
| Optional licensed content | SpeedTree or another audited plant library |
| Reference only | Unreal, Unity, World Creator, O3DE and Terrain3D runtime implementations |

## Implementation order

1. Capture five golden seeds and baseline screenshots/performance from overview, eye-level and close-ground cameras.
2. Build the global `WorldFieldSet`, real landform families, protected zones and two-scale erosion.
3. Build river/lake and road feature graphs; delete the rectangular render representation.
4. Integrate PlayCanvas water and the shared scene-level render service.
5. Add macro/detail, height-blended terrain materials and outdoor sun/sky validation.
6. Replace cone trees with curated plant families, ecology scoring and instance LODs.
7. Add persistent macro terrain/HLOD coverage and screen-space LOD.
8. Run packaged quality/performance gates, then enable AI-created material and hero-asset refinements.

## Non-negotiable quality gates

- No visible road or river is made from scaled boxes.
- Rivers are continuous, downhill, terrain-carved and correctly joined.
- Neighbor chunks share identical terrain, feature, material and vegetation boundary samples.
- Frustum-visible ground never disappears; a macro/HLOD representation always remains.
- Outdoor worlds cannot publish without a directional sun, environment contribution and bounded exposure.
- The terrain reads as a landform at overview distance and as layered PBR ground at eye level.
- Each biome uses multiple plant silhouettes plus understory and ground cover.
- Water has depth-dependent color and soft shore contact; reflections are shared, not duplicated per segment.
- Fixed seeds reproduce the same field data and topology.
- AI output remains schema-constrained and player-reviewed; mesh/PBR terrain is authoritative.

## Research caveats

Vendor speed and scale claims were treated as product claims, not performance evidence. Gaea, World Creator, Houdini and SpeedTree require license review before any integration. PlayCanvas water is source-compatible in the project's current engine line, but it still needs a packaged WebView benchmark before being called production-ready.
