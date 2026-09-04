# Procedural World Architecture

DnDRom treats the world as deterministic data, not as a single generated picture or opaque mesh. The authoritative dependency order is:

1. Global domain-warped fBm geology and biome parameters.
2. Exact Wang-Liu priority-flood sink removal, flat-safe D8 drainage accumulation, river extraction, and terrain carving.
3. Zone connectivity followed by anisotropic A* roads, bridge detection, road-facing parcels, and constrained building modules.
4. Slope, elevation, moisture, water, and biome material weights sampled in absolute world coordinates.
5. Directional sun, sky/ground ambient, practical lights, probes, fog, and optional background atmosphere.
6. Catalogue resolution first; reviewed AI PBR materials and distinctive props only where reusable systems cannot satisfy the blueprint.
7. Independent 16-meter chunk generation, persistence, simulation, LOD residency, visibility, and rendering.

The language model may select schema-validated parameters and request missing assets. It cannot emit executable generator code, replace collision/navigation geometry, mutate a published scene, or treat a splat as gameplay authority.

## Runtime contract

- Forge overview cameras keep the complete framed draft resident so editing never shows missing wedges.
- Game cameras use conservative quadtree/portal visibility, a preload margin, three LODs, bounded GPU uploads, and delayed eviction.
- Hidden chunks stop issuing ordinary draw calls, but their simulation, navigation, timers, combat, and relevant light influence continue.
- Generated worlds retain a readable directional sun, sky contribution, and exposure floor. Mood changes color and contrast rather than making the board unusably dark.
- Terrain UVs are continuous across chunk borders. Macro variation and biome weights break up recognizable scan repetition; water follows elevation cells and river paths instead of covering an entire chunk from one wet sample.
- Wang-Liu filling uses `max(original, spillway)` without epsilon elevation drift. An explicit drainage-parent tree routes equal-height filled basins to boundary outlets, and reverse flood order accumulates catchments without cycles.

Sparse voxel cave volumes, production-scale tensor-field street networks, full Wave Function Collapse kits, runtime virtual-texture clipmaps, and volumetric weather remain extension points. They must plug into the same blueprint, chunk, validation, and persistence contracts rather than bypass them with presentation-only output.
