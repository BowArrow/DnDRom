# Shared worlds — Windows 0.3.0

New outdoor generation uses a persistent world manifest. The engine places scenes on measured, eroded terrain and records their buildings, streets, docks and inter-location routes before publishing the world. Travel and playable views use those same world coordinates and IDs.

## Using this build

In **Connected world**, describe the locations you need and select **Generate world**. The editable requirements list and progress appear automatically. The app-owned local language runtime can expand the prompt into connected scene requirements and structural recipes. Terrain, placement and navigation constraints remain engine-validated. Invalid model output receives two repair attempts; unresolved requirements stay visible in the generation panel.

Use **Pause generation** and **Resume generation** to save and resume planning checkpoints. Edit pending requirements to replan them. Completed locations are protected. **Add a scene to this world** extends the accepted world; **Rebuild geography as a separate world** creates another world while retaining the original scenes and world record.

Use the location selector or journey panel to enter a location or return to travel. An unspecified harbor town requests 36 buildings: 24 homes, eight working/storage buildings and four public/commercial buildings. The solver must fit every required role, connect entrances to streets and provide a navigable dock approach. A harbor without another coastal destination receives a mainland landing village and ferry connection.

## Persistence and compatibility

- The campaign schema remains version 1. The optional `WorldManifest` extension is version 1; the application persistence migration is version 10. Generator, climate and hydrology versions travel with the manifest.
- Existing campaigns and scenes keep their rendering path. Merely opening a campaign does not rebuild its geography. Explicit rebuilds archive the previous world.
- Accepted locations, structural recipes, routes, regional styles, terrain modifications and user object edits remain campaign data. Terrain/foliage arrays and erosion fields are regenerable caches.
- Save/Export omits shared-scene terrain and foliage arrays. Import reconstructs the active scene locally and reconstructs other scenes when entered. Legacy scenes retain their original saved data. Local autosaves may retain already-generated scene arrays for faster reopening.
- Cache regeneration retains scene IDs, accepted plans, lighting, weather and authored objects. World-space edits survive scene switching and cache recreation. Underground object edits are scoped to their underground location.
- Local models, speech settings and campaign storage are separate from the installer directory. The installer does not clear them. Keep exported campaign backups when comparing versions; the previous installer cannot interpret the new shared-world extension as a full shared world.

## Geography and rendering

The climate field samples world-anchored 128 m cells, with continuous interpolation across 8 km macroregion boundaries. Compact reservations index twelve natural climate families within approximately 100 km: ice, tundra, boreal forest, temperate mixed forest, temperate rainforest, steppe, Mediterranean shrubland, hot desert, cold desert, savanna, tropical seasonal forest and tropical rainforest. Altitude cooling, rain shadows, precipitation, moisture, drainage and seasonal amplitude contribute to the field. Detailed erosion remains deterministic and cached.

Alpine, riparian, wetland, coastal and aquatic habitats supplement climate. Explicit volcanic and magical reservations are separate environment overlays. Volcanic habitats reduce vegetation and moisture with a continuous spatial falloff. Magical overlays retain their authored identity; a bespoke visual effect for every magical description is not guaranteed. Underground scenes use a separate depth/layer and room generation, with a surface entrance connected to the world network.

Road routing accounts for grade, heading, curvature, water and earthworks; road cross-sections are level rather than rolling with hillside slope. Timber, stone and suspension bridge operators cover feasible spans. Ferries use persisted water routes, draft/clearance checks, matching docks and a moving boat with dock dwell and return travel. NPC passengers and economic activity remain outside this release.

Near and distant buildings share accepted footprints and entrances. Forest candidate identities, clearing fields and biome/material samples are anchored in world space. Explicit road geometry keeps narrow routes visible where coarse terrain triangles cannot resolve the road width. Terrain uses full-precision world UVs to avoid quantization artifacts at large coordinates. Covering terrain remains resident until replacements are ready; revisions invalidate intersecting regions. Failed tiles have bounded retries.

The accepted water equations and material system are preserved. This release does not replace them with another wave implementation.

## Validation and current limits

See [validation and visual comparisons](SHARED_WORLD_VALIDATION.md) for reproducible commands, fixture results and performance measurements. The core connected-world fixture and focused regressions pass. This is not a claim that arbitrary scene prompts or all biome art have achieved final visual quality.

The 8 GB VRAM / 16 GB RAM, 1080p at 30 FPS target with an actively generating local model remains **unverified**. Cold erosion, site search and refinement can take minutes. Broad coverage stays visible during refinement, but mesh arrivals can still cause frame-time spikes. Tree art currently uses a limited set of structural families; the climate index is broader than the bespoke plant art catalogue. Climate availability tests validate indexed climate candidates, not a high-detail ecological survey of the whole 100 km extent. Arbitrary long transport requests can exhaust the bounded routing budget and will report an unmet constraint instead of publishing a broken connection.

Manual building transforms preserve the object and entrance, but do not automatically re-solve its surrounding street and foundation plan. Building relocation that changes geography requires a world revision. General living-world behavior and unrestricted image-to-world reconstruction are not acceptance claims for this installer.

Research basis: [Biomes and Connected Worlds](research/DnDRom-Biomes-and-Connected-Worlds.pdf).
