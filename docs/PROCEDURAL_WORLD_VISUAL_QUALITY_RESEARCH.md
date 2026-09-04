# Procedural World Visual Quality: Research and DnDRom Implementation Target

Date: 2026-09-03  
Decision: replace placeholder terrain decoration with a coupled, deterministic landform pipeline while retaining mesh/PBR gameplay authority.

## Executive answer

The screenshot is an accurate diagnosis of the current generator, not a minor tuning problem:

- Forests, plains, and most exteriors default to only **2.5 m of relief across 128 m**; swamps default to 1.2 m. That reads as flat from the tabletop camera.
- Hydrology is calculated, but every retained D8 cell is rendered as a separate scaled `water-tile`. Roads are A* paths reduced to straight runs and rendered as stretched floor/road assets. That is why both look like rectangles.
- Broadleaf, cypress, and pine requests all resolve to the same two-cone `tree-pine` model. Poisson spacing avoids overlaps but cannot create a believable ecosystem by itself.
- Terrain has one repeated PBR material with vertex-color modulation, not a real grass/soil/rock/mud/bank blend.

The fix is to preserve the current deterministic and chunked architecture but change the representations. AI should describe landforms and ecology in a validated blueprint. A procedural compiler should turn those instructions into continuous terrain fields, river/road feature curves, ecology masks, and curated instanced assets. AI-generated imagery or 3D assets should refine the vocabulary; it should not replace playable ground geometry.

## What modern generators actually do

The useful lesson from Minecraft is not its block aesthetic. Its documented generation order first creates base terrain, then biomes, structures, natural features, lighting, and final state. Terrain shape is driven by seeded smooth noise, while biome placement also considers height, temperature, humidity, erosion, and variation. [Microsoft's Minecraft World Generation Overview](https://learn.microsoft.com/en-us/minecraft/creator/documents/world-generation?view=minecraft-bedrock-stable)

Research-grade terrain generators go further: they treat rivers as landform operators. Génevaux and colleagues generate and classify a drainage network, then combine river, valley, hill, and mountain primitives into a continuous terrain representation. This is the opposite of drawing blue tiles over finished noise. [Terrain Generation Using Procedural Models Based on Hydrology](https://www.cs.purdue.edu/cgvlab/www/resources/papers/Genevaux-ACM_Trans_Graph-2013-Terrain_Generation_Using_Procedural_Models_Based_on_Hydrology.pdf)

The supplied Wang-Liu-style sink filling is directionally correct. The better-documented Priority-Flood formulation guarantees that every cell can drain and is efficient enough for these region sizes. But it only fixes drainage topology; the renderer must still convert raster flow cells into smooth, variable-width features. [Barnes, Lehman, and Mulla, Priority-Flood](https://rbarnes.org/sci/2014_depressions.pdf)

For roads, the current anisotropic A* is also a good start. The relevant road-generation work routes against slope and obstacles, then excavates terrain along the path and creates parameterized road geometry. Modern Unreal Landscape Splines expose the same practical pattern: smooth curves, adjustable width, side falloff, terrain raise/lower, and deformed surface meshes. [Galin et al., Procedural Generation of Roads](https://diglib.eg.org/items/0aba12a9-bdbc-43a2-982c-5d1a9a43a2ba), [Epic Landscape Splines](https://dev.epicgames.com/documentation/unreal-engine/landscape-splines-in-unreal-engine?lang=en-US)

Believable foliage is a distribution problem and an asset-variation problem. Ecosystem research models how plants respond to terrain and compete for resources; Poisson-disk sampling supplies pleasing non-clumped candidate spacing, but must be filtered by species-specific moisture, slope, light, elevation, canopy, and disturbance rules. [Deussen et al., Realistic Modeling and Rendering of Plant Ecosystems](https://graphics.stanford.edu/papers/ecosys/econofig.pdf), [Bridson, Fast Poisson Disk Sampling](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf)

## Required pipeline

### 1. AI authors constraints, not vertices

Replace the single `relief` concept with a validated `TerrainIntentV2` containing:

- landform family: rolling, valley, ridge, basin, plateau, coastal shelf, mountain;
- target elevation percentiles and maximum slope;
- optional ridge, valley, pass, basin, shoreline, and protected-play polygons;
- climate fields: moisture, temperature, prevailing wind, water table;
- erosion strength, rock resistance, soil depth, and drainage density;
- road class and maximum grade;
- biome species palette and succession stage.

The local model selects and parameterizes known operators. It does not emit code or arbitrary mesh buffers.

### 2. Build a global macro terrain before chunks

For a 128 m region, build a deterministic 129×129 or 257×257 global field in the worker. Chunks sample it with a one-cell apron so borders match exactly.

Use this order:

1. Compose broad uplift/ridge/basin fields from blueprint constraints.
2. Add domain-warped fBm and ridged noise at mesoscales.
3. Normalize into biome-specific elevation targets.
4. Run bounded thermal relaxation and stream-power/fluvial erosion.
5. Protect entry, encounter, structure, and navigation masks from destructive erosion.
6. Add fine residual detail only after drainage is stable.

Cordonnier et al. show why uplift plus stream-power erosion produces more coherent mountain/valley structure than noise alone. DnDRom can use a short deterministic approximation because its regions are small. [Large Scale Terrain Generation from Tectonic Uplift and Fluvial Erosion](https://diglib.eg.org/items/13e52c36-0200-4652-aacf-17aa3098c5fd)

Recommended initial elevation ranges (95th minus 5th percentile):

| Biome | 128 m target | Treatment |
|---|---:|---|
| Swamp | 0.8–2.5 m | hummocks, shallow basins, high water table |
| Plains | 3–7 m | long wavelengths, low roughness |
| Forest | 6–12 m | rolling ridges and drainage valleys |
| Coast | 8–20 m | shelf, dunes/bluffs, explicit shoreline |
| Mountains | 18–36 m | uplift ridges, talus, carved valleys |

The present 12 m schema ceiling should become at least 48 m. Protected gameplay zones remain locally graded even when the surrounding range is steep.

### 3. Keep raster hydrology for truth; render vector rivers

Run Priority-Flood/depression breaching and D8 or D-infinity flow on the global field. Then convert the thresholded network into a river graph:

1. Identify sources, confluences, reaches, and outlets.
2. Trace each reach as an ordered polyline; do not render individual cells.
3. Remove grid stair-stepping with constrained Chaikin/Catmull-Rom fitting while preserving confluences and downstream order.
4. Derive width and depth from flow accumulation/stream order, with non-decreasing downstream width except at authored constrictions.
5. Carve a valley and bed using a smooth cross-section before final terrain meshing.
6. Generate banks and wetness as a signed-distance field around the curves.
7. Generate the water footprint from that field using marching squares, or generate a continuous variable-width ribbon with explicit confluence junction meshes.
8. Store downstream tangent and speed for the water shader.

This removes rectangular blue tiles while keeping hydrology deterministic. It also makes rivers visibly occupy valleys rather than hover above terrain.

### 4. Turn roads into terrain-deforming spline corridors

Keep anisotropic A* but preserve the complete routed polyline. The current direction-run simplifier exposes the grid. Instead:

1. Simplify with an error tolerance measured in meters, not merely direction changes.
2. Fit a curvature-limited spline and resample every 0.5–1 m.
3. Re-evaluate grade; add switchbacks or reroute when grade exceeds the road-class limit.
4. Apply cut/fill to the terrain with a cosine shoulder falloff.
5. Extrude a cross-section containing road surface, shoulder, optional ditch, and embankment.
6. Paint a road exclusion/material mask into the terrain so grass does not grow through it.
7. Create explicit bridge spans only where a continuous water crossing is detected.

The output must be one continuous feature per reach, clipped into chunk-local mesh sections with shared boundary samples—not scaled boxes.

### 5. Build an ecosystem, not a field of cones

Use at least three placement layers:

- canopy: trees and large deadwood;
- understory: saplings, shrubs, reeds, ferns;
- ground cover: grass tufts, flowers, stones, leaf litter.

Each species profile should specify moisture, slope, elevation, water-distance, sun exposure, soil, minimum spacing, clustering, and disturbance response. Sample candidates with stable blue-noise/Poisson patterns, then score them against the fields. Add neighborhood competition so every accepted candidate is not identical in size.

For the first quality release, ship curated stylized families rather than runtime cone construction:

- at least 6 pine silhouettes;
- 6 broadleaf silhouettes with trunk/branch/crown variation;
- 4 cypress/swamp silhouettes with buttressed roots and hanging foliage;
- 4 dead-tree silhouettes;
- 4 shrub/reed/grass clusters per appropriate biome.

Randomize variant, scale, lean, hue, crown density, and wind phase deterministically. Use alpha-tested leaf cards or compact leaf-clump meshes, trunk/branch geometry, and double-sided foliage shading; do not use a cone as the final LOD0 tree. Distant LODs can become crossed cards or impostors. Crytek's published vegetation work demonstrates the quality/performance pattern of per-instance variation, low-cost leaf planes, procedural wind, and distant sprites. [NVIDIA, Vegetation Procedural Animation and Shading in Crysis](https://developer.nvidia.com/gpugems/gpugems3/part-iii/rendering/chapter-16-vegetation-procedural-animation-and-shading-crysis)

### 6. Replace the single terrain texture with material layers

Build a terrain weight set from:

- slope and curvature;
- elevation;
- moisture and distance to water;
- flow accumulation and sediment;
- road/structure disturbance;
- biome and snow/sand line.

Blend grass, soil, mud/bank, rock, and snow/sand with height-aware transitions. Use world-space projection and triplanar projection on steep slopes. Break repetition with deterministic rotation/offset, macro tint noise, and a detail-normal scale distinct from albedo scale. Modern landscape systems expose weight, alpha, and height blending for exactly this purpose. [Epic Landscape Materials](https://dev.epicgames.com/documentation/unreal-engine/landscape-materials-in-unreal-engine)

For the first release, use a small texture array/atlas and a custom PlayCanvas terrain shader; full runtime virtual texturing is unnecessary at this region scale.

### 7. Preserve chunk performance without preserving chunk seams

The global fields and feature graphs are authoritative; chunks are only derived render/storage units. Every chunk samples an apron and clips the same global splines. This prevents terrain, road, river, and foliage discontinuities.

Use:

- terrain LODs of 33×33, 17×17, and 9×9 vertices per 16 m chunk;
- edge stitching or geomorphing between adjacent LODs;
- one road mesh and one river/bank mesh per material per visible chunk;
- foliage hardware instances grouped by chunk, species variant, material, and LOD;
- spatially bounded static batches so frustum culling remains useful;
- multi-draw where supported, with the existing fallback path elsewhere.

PlayCanvas supports procedural meshes, batching, instancing, and terrain-oriented multi-draw. Its batching guidance explicitly warns that oversized batch bounds reduce culling efficiency, which is why grouping must remain chunk-local. [PlayCanvas Mesh API](https://api.playcanvas.com/engine/classes/Mesh.html), [PlayCanvas Batching](https://developer.playcanvas.com/user-manual/graphics/advanced-rendering/batching/), [PlayCanvas Hardware Instancing](https://developer.playcanvas.com/user-manual/graphics/advanced-rendering/hardware-instancing/), [PlayCanvas Multi-Draw](https://developer.playcanvas.com/user-manual/graphics/advanced-rendering/multi-draw/)

## Gap matrix

| Failure | Current cause | Required representation | Confidence |
|---|---|---|---|
| Terrain looks flat | 1.2–2.5 m defaults, noise centered around base, no explicit landform constraints | biome-scaled macro uplift/ridge/basin fields plus bounded erosion | High |
| Rivers are rectangles | each D8 cell becomes a scaled `water-tile` | ordered river graph, smooth centerlines, carved bed/banks, SDF or ribbon water mesh | High |
| Roads are rectangles | direction-run segments become stretched floor assets | curvature-limited splines, cut/fill corridor, extruded cross-section | High |
| Trees look like cones | all live styles map to `tree-pine`; asset is two cones | species-specific curated variants plus instancing and LODs | High |
| Forest is evenly sparse | one Poisson layer with one density and spacing | canopy/understory/ground layers filtered by ecology and competition | High |
| Ground repeats | one terrain material and fixed world UV scale | multi-layer weight maps, stochastic world mapping, macro/detail separation | High |
| Chunks can expose seams/pop | derived meshes own too much feature identity | global fields/graphs, chunk aprons, shared boundary samples and geomorphing | High |

## Implementation sequence

### Increment 1 — remove the obvious placeholders

- Add `WorldCurveGeometry` and `WorldRiverSurfaceGeometry` to the shared schema.
- Trace hydrology cells into reaches and emit continuous river geometry.
- Preserve road polylines, fit splines, and emit road-corridor meshes.
- Stop creating per-segment `water-tile` and scaled road/floor entities.
- Add regression tests asserting that generated exterior roads/rivers contain no scaled-box surface entities.

### Increment 2 — make the terrain read at tabletop scale

- Add `TerrainIntentV2` and biome elevation targets.
- Raise the relief ceiling and normalize actual height percentiles.
- Add ridge/basin/uplift primitives plus bounded thermal and stream-power passes.
- Carve river valleys and grade road corridors into the shared heightfield.
- Raise LOD0 terrain to 33×33 and add edge stitching/geomorphing.

### Increment 3 — foliage and material quality

- Add species profiles and three ecology layers.
- Add curated tree/shrub/ground-cover variant families.
- Replace individual tree entities with chunk-local instance buffers.
- Add the multi-layer terrain shader and road/river/structure exclusion masks.

### Increment 4 — validation and tuning

- Add deterministic golden seeds for forest, swamp, mountain, coast, and settlement.
- Add overhead, eye-level, and close-ground screenshot regressions.
- Tune ecology and terrain profiles from those captures, not from a single overhead view.
- Keep the current chunk upload limit and measure CPU generation, draw calls, visible triangles, and GPU memory on packaged builds.

## Acceptance gates

A generated outdoor region is not complete unless all of these pass:

- actual elevation percentile range reaches the biome target and protected play zones remain navigable;
- all extracted river reaches drain to a confluence, lake, or boundary and their rendered surface is continuous;
- river widths vary with flow and no visible water surface is a scaled box;
- roads are continuous, terrain-conforming corridors with shoulders/falloff and no visible surface is a stretched floor asset;
- foliage excludes roads, structures, deep water, and invalid slopes;
- each populated biome uses multiple canopy silhouettes plus understory and ground-cover families;
- neighboring chunks share identical terrain, feature-curve, mask, and vegetation boundary samples;
- material transitions show at least grass/soil/rock and biome-appropriate wet/snow/sand layers without recognizable 16 m repetition;
- the fixed packaged benchmark crosses chunk and LOD boundaries without cracks or visible feature popping;
- only outputs that pass these checks may be published as a completed generated world.

## What not to do

- Do not tune the blue and brown rectangles; remove that representation.
- Do not simply increase terrain mesh resolution; stronger landforms and erosion must feed it.
- Do not use AI to emit unrestricted vertices for the whole region.
- Do not use Gaussian splats as walkable terrain or as a substitute for missing geometry.
- Do not solve foliage quality by placing more copies of the same cone.
- Do not run expensive erosion independently per chunk; it will create seams and inconsistent watersheds.

## Notes on the supplied videos

The linked YouTube pages could not be fetched directly because YouTube throttled the research client, so I did not treat unseen transcript details as evidence. Search metadata identifies the Townscaper discussion as a hybrid of procedural rules and authored modules, and the solo-development video as a data-driven reuse/system-design example. That direction matches the recommended architecture: a compact, curated visual vocabulary assembled by deterministic rules, with AI used to author intent and fill genuine catalogue gaps.

