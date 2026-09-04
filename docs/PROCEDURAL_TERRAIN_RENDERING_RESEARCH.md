# Procedural terrain rendering research

This note is the implementation contract for the Scene Forge terrain pass. It records the primary-source findings used to replace the flat tile, ribbon-road, block-water, and primitive-foliage prototype.

## Findings translated into engine requirements

| Surface | Source finding | DnDRom requirement |
| --- | --- | --- |
| Roads | Unreal Landscape Splines modify both the terrain heightmap and a painted layer weightmap, with a cosine falloff. Galin et al. route roads with a weighted anisotropic shortest path before excavating/constructing the road profile. | Route on slope/water cost, smooth the centerline, grade the terrain, and paint a soft road weight into each terrain chunk. Do not render ordinary roads as joined rectangle meshes. |
| Rivers | Drainage must be sink-filled before D8 flow accumulation. Visible channels are extracted from accumulated flow, carved into the terrain, then smoothed. | Preserve Wang-Liu drainage authority, carve before infrastructure, resample connected channels into continuous curves, and carry downstream direction plus shore distance into rendering. |
| Water | PlayCanvas' reference water uses animated multi-scale normals, depth/shallow color, Fresnel/specular response, and depth-gated shore foam. | Use one shared animated water shader, advect detail downstream, add a non-emissive foam envelope at banks, and keep waves small enough for tabletop scale. |
| Grass | GPU Gems batches many crossed blade clusters into a meadow draw and moves only upper vertices with world-space wind. | Build chunk-local grass batches, use tapered multi-segment blades, encode bend weight in the vertex data, and animate upper vertices in the GPU. |
| Trees | GPU Gems separates trunk/main bending from leaf detail and uses instancing or batching plus impostors for repeated vegetation. | Replace marker cones with branched, irregular silhouettes; keep deterministic variants; batch by chunk/family and reduce cluster complexity by LOD. |
| Terrain | Layer weights should respond to slope, elevation, moisture, sediment, and authored infrastructure. | Preserve global seamless height authority, expose visible one-meter gameplay terraces with eased risers, and derive the terrain color/roughness field from physical masks rather than one repeated photograph. |

## Performance boundaries

- Keep meshes and PBR terrain authoritative; water and grass shaders only change presentation.
- Chunk-local batches retain useful frustum culling. PlayCanvas hardware instancing does not individually frustum-cull instances, so no region-wide vegetation buffer is allowed.
- Terrain and road masks are deterministic derived data and can be regenerated from the blueprint and seed.
- Shared materials are animated once per frame. Do not allocate one reflection/refraction camera or shader controller per water tile.

## Primary references

- PlayCanvas, **Shaders** and **Hardware Instancing** documentation.
- PlayCanvas Engine, bundled `water.mjs` reference implementation (v2.21.4).
- Epic Games, **Landscape Splines** documentation.
- Galin, Peytavie, Marechal, Guerin, **Procedural Generation of Roads**, Computer Graphics Forum 29(2), 2010.
- NVIDIA GPU Gems, **Rendering Countless Blades of Waving Grass**.
- NVIDIA GPU Gems 3, **Vegetation Procedural Animation and Shading in Crysis** and **GPU-Generated Procedural Wind Animations for Trees**.
- Project hydrology specification, **Wang-Liu Sink-Filling Algorithm for Continuous Hydrology**.

## Acceptance checks

1. A compiled outdoor terrain has a visible vertical range and height samples clustered around one-meter terraces while retaining rounded transition bands.
2. Ordinary road entities are absent; road paint weights exist in terrain chunks and have soft shoulders.
3. Rivers are continuous three-strip meshes with center flow UVs and two foam banks; lake masks use sub-meter cells with shoreline weights.
4. Grass uses an animated shader and multiple tapered blades per ecological placement.
5. Procedural trees have trunks, branches, and several irregular canopy/needle clusters rather than one or two primitive cones.
6. Packaged WebView inspection confirms the result under the default sun and chunk streaming profile.
