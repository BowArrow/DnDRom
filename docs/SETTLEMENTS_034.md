# Procedural settlements — 0.3.4

This release replaces the shared-world house grid with a street-first settlement solver and modular building programs. It implements the settlement layer described in the [research report](research/DnDRom-Procedural-Settlements.md); population, economy, voiced narration and daily activity remain later work.

## What changes

- Reserve a market or inner court, waterfront access and connected terrain-following streets before allocating parcels. Street junctions and building entrances form a validated graph. Parcels have variable dimensions and headings and are checked against water, slope, roads, public spaces and other parcels.
- Fit the full required program. An unspecified harbor still receives 24 homes, eight work/storage buildings and four public/commercial buildings. Insufficient usable frontage produces an explicit failure; it does not drop roles or shrink doorways.
- Generate street houses, service wings, courtyard houses, warehouses, workshops, arcades, halls and keeps from structural operators. Roof profiles, height, footprint, bays, surface color, chimneys and subsidiary ranges vary deterministically. Timber, courtyard, earthen and fortress construction profiles change massing and roofs. These are extensible procedural families, not a complete library of every historical architectural tradition. The local model can supply bounded custom structural recipes and regional parameters.
- Occupied houses have actual facade openings, internal partitions with doors, floor slabs and stairs with upper-floor openings. These are usable architectural shells, not furnished or populated interiors. Castles add an inner court, keep, service buildings, terrain-adapted curtain segments, gate openings and towers. Detailed castle wall-walk traversal and historical fortification typologies need further work.
- Persist parcels, nodes, districts, public spaces, building programs and fortifications in the optional settlement-version-2 extension. Native near and distant entities use the same accepted building IDs and recipes. Terrain foundation polygons and clearings follow rotated footprints at every terrain detail level.
- Permit a validated direct connection for long unobstructed routes, retaining the terrain-following search for short hillside streets. Existing grade, water and earthwork validation still applies.

## Upgrading an existing campaign

Install 0.3.4, enter the settlement, then use **Connected world → Rebuild this settlement**. The new layout is generated on the current land, validated and compiled before committing a new world revision. The previous scene remains in the campaign. Other locations and ferry routes are retained; affected regional roads are reconnected to the revised settlement. Entering a world location will not reuse a cached scene from an older world revision.

Automatic rebuilding stops if generated buildings have been manually edited or removed, because replacing their parcels would conflict with those edits. The existing world remains untouched. A separate-world rebuild is available for experimenting with a new layout. Unrelated authored entities and explored geography remain persisted. A failed or cancelled revision cannot commit a partial replacement.

Legacy scenes retain their current path. Nothing automatically rebuilds a campaign on install. The 0.3.3 installer remains available.

## Validation

The focused pipeline suite passed 40 tests across seven files. It covers complete building programs, non-overlap, graph connectivity, multiple city/coast seeds, regional recipes, door/stairwell openings, rotated foundations, castle structures, deterministic IDs, manifest persistence, revision rollback, worker cancellation and local model validation. The revised mesh tests also check finite positions, normals, UVs, colors and indices. They caught a degenerate hipped-roof ridge during packaged testing; the ridge now emits only nondegenerate triangles.

A separate five-file regression run passed 18 tests, including the slower scene-grammar compilation, building access, shared-world files, terrain continuity and river-surface meshes. One persistence test file overlaps the pipeline suite. The terrain compilation test used a 180-second timeout; its ordinary five-second default was inadequate for cold terrain generation. TypeScript/Vite and the Unreal package build succeeded.

Commands and artifacts:

- `pnpm.cmd --dir apps/desktop exec vitest run src/domain/settlementPlanner.test.ts src/domain/sharedWorld.test.ts src/domain/sharedWorldClient.test.ts src/domain/sharedWorld.worker.test.ts src/domain/sharedWorldFiles.test.ts src/state/worldGeneration.test.ts src/ai/worldDirector.test.ts`
- `pnpm.cmd --dir apps/desktop exec vitest run src/domain/sceneGrammar.test.ts src/domain/buildingAccess.test.ts src/domain/sharedWorldFiles.test.ts src/domain/terrainContinuity.test.ts src/rendering/riverSurfaceMesh.test.ts --testTimeout=180000`
- `node scripts/verify-settlements.mjs`: saved real harbor revision and terrain compilation, `artifacts/settlement-034/report.json`.
- `node scripts/settlement-review-fixtures.mjs`: deterministic architecture/castle review maps.
- `node scripts/smoke-settlements.mjs`: isolated packaged local import, outward fog reveal and camera rotation.
- `node scripts/smoke-settlement-architecture.mjs`: isolated packaged architecture and castle captures.

## Measured limits

The final real-harbor Node fixture fitted 36 buildings in **1.44 seconds** with cached terrain data. Compiling its terrain/foliage/playable map took **74.0 seconds** separately; peak process RSS was **300 MiB**. This is not a cold end-to-end AI generation benchmark. Local scene generation and native import remain material loading costs.

The 1080p/30 FPS goal on an 8 GB VRAM /16 GB RAM system with the local model active remains **unverified**. Runtime captures use the development machine and disable the local model to isolate rendering. No claim of finished population simulation, fully optimized interiors, arbitrary cultural coverage or instant world loading is made.
## Packaged visual results and delivery

The final Unreal smoke completed the local import before any distant tile appeared. All six additional local batches were present. The fog radius increased from 182.8 m to 201.9 m across the camera rotation check instead of restarting. The harbor, architectural-family review and castle review all imported successfully with zero missing materials and zero checked vertex-color mismatches.

Captures:

- [Previous 0.3.3 harbor](../artifacts/local-first-033/native/world-revealed.png) and [0.3.4 harbor](../artifacts/settlement-034/native-final/world-revealed.png): comparable default framing, not a pixel-aligned benchmark.
- [New town close view](../artifacts/settlement-034/native-final/town-close.png).
- [Regional massing review](../artifacts/settlement-034/gallery-native/architecture-close.png): controlled examples on a plain review floor; the palette is held constant to compare construction forms.
- [Castle review](../artifacts/settlement-034/gallery-native/castle-close.png): compound structure on a plain review floor, not a generated terrain integration capture.

In a fresh isolated native profile, terrain became visible at 27.1 seconds and the playable import stage completed at 59.0 seconds on the local-import timer. The complete local import was observed 90.3 seconds after importing the campaign; the first distant tile appeared at 192.9 seconds. Peak native-process memory was 2,112 MiB, excluding CEF/worker/local-model processes and GPU memory. Observed frame-time p95 during loading was 109 ms. Installer compression ran concurrently, so these observations do not establish steady-state or minimum-spec performance. Cold loading and frame pacing still need optimization. Raw results: [validation summary](../artifacts/settlement-034/validation-summary.json).

Installer: [DnDRom-Unreal-0.3.4-x64-setup.exe](../artifacts/installers/DnDRom-Unreal-0.3.4-x64-setup.exe), 759,832,996 bytes.

SHA-256: `78c59c89e68ce3dbb9ec976f356002e1d51c1f8791b6012b93d952df681cb504`.

The installer was extracted without installing over the user's application. All 473 expected payload files matched the tested archive byte-for-byte. The previous 0.3.3 installer remains unchanged, verified against SHA-256 `5ef1fd1949d1b2f722093d575e679d55b1e03b1c7d3c3b4975d36f08833d63f5`. Campaign validation used isolated profiles; existing campaign files were not replaced. All test app windows were closed afterward.
