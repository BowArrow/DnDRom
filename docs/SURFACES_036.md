# Settlement surfaces and plant growth — 0.3.6

Generated shared-world buildings now choose compatible plaster, earth-toned render, stone, timber and roof finishes. Building-local material coordinates keep the surface phase continuous across split facade panels and roof infill. Seeded grain, unit color and larger weathering fields reduce obvious tiling while retaining construction patterns such as mortar courses and wood grain.

Visual age and climate moisture control irregular staining, damp lower walls, roughness changes, moss-like coloration and plaster wear. Small rosettes, fern-like clumps and flowering herbs grow in irregular groups around supported wall bases. Narrow climbing shoots follow solid facade supports. Door approaches remain clear; root placements reject water and accepted road clearances and use the resident terrain height.

## Existing campaigns

No settlement rebuild is required. On native export/load, unedited shared-world building assemblies refresh from their accepted recipes. Building IDs, positions, rotations, scales, entrances and parcel layouts stay intact. Explicit authored entity overrides, removals and assigned materials take precedence. Legacy scenes without a shared-world manifest retain their existing rendering path.

Surface profiles are versioned and derived from world seed, building ID, regional style and climate. Near and distant buildings receive the same profile. Ground herbs are generated where local terrain is available; they are not guessed at a height when that terrain is absent. This release generates established growth. It does not simulate seasonal growth or elapsed campaign years.

The previous 0.3.5 installer is preserved. Its SHA-256 remains `fac3f02ed57448fed2102c281766c67a374282ec3d068a0f285a650bd664f70c`. Validation used isolated campaign profiles and did not install over the user's app or replace existing campaign data.

## Validation

- TypeScript production build and Unreal build/cook/package passed.
- 65 tests across 12 files passed: deterministic profiles and vegetation, wet/dry density, support and doorway constraints, mesh normals, authored material precedence, near/far material parity, saved facade refresh, settlement placement, shared-world persistence, native batches, terrain continuity, chunk seams, shoreline and water fields.
- Native close-up review passed with 16 mesh groups, 249 instances, no missing materials and no vertex-color mismatches across 180,342 checked vertices. The review contained three buildings on a finite flat terrain fixture, with wet/aged profiles to make the appearance pass visible.
- Native mesh construction in that fixture took approximately 276 ms. Its 24,234 LOD0 prototype triangles are a prototype count, not the full instanced scene triangle count. These figures are not a full-town or minimum-spec benchmark.

The accepted water shaders and terrain sampling equations were not changed. The new small-plant material fades over approximately 65–110 metres before final culling. Herb placements are capped at 96 and supported vine shoots at six per building; three reusable herb prototypes have simpler LODs.

## Visual comparisons

The same gabled house and camera can be compared across releases. The review ground changed from a plain floor assembly to a finite terrain fixture so plant root heights could be verified.

| View | Capture |
|---|---|
| 0.3.5 facade baseline | [Doors and windows before surface variation](../artifacts/facades-035/native-lit/door-window.png) |
| 0.3.6 facade | [Varied finish, subtle wear and base plants](../artifacts/surfaces-036/native-final/door-window.png) |
| 0.3.6 ground-level detail | [Folded leaves, supported climbing shoots and wall texture](../artifacts/surfaces-036/native-final/plants.png) |
| Neighboring buildings | [Palette and roof variation](../artifacts/surfaces-036/native-final/palette.png) |

## Scope and research

[The 10-page research report](research/DnDRom-Settlement-Surfaces-and-Growth.pdf) covers stochastic texturing, weathering, urban plant placement, climbing support, rendering, persistence and validation. Its [Markdown source](research/DnDRom-Settlement-Surfaces-and-Growth.md) contains linked references.

The shader uses a bounded stochastic approximation, not full histogram-preserving synthesis or physical moisture transport. It does not guarantee that finite source texture details can never repeat. Runoff traced from gutters, structural damage, repairs, a complete biome species library and seasonal growth remain separate work. The 1080p/30 FPS target on 8 GB VRAM / 16 GB RAM with local AI active remains unverified on representative hardware.

Build and validation logs: `artifacts/package-036-final.log`, `artifacts/surfaces-036-tests-final.log`, `artifacts/surfaces-036/native-final/report.json`. Installer verification is recorded separately in `artifacts/installer-036-verification.json` after extraction and payload comparison.

## Windows package

Installer: [DnDRom-Unreal-0.3.6-x64-setup.exe](../artifacts/installers/DnDRom-Unreal-0.3.6-x64-setup.exe), 777,759,806 bytes.

SHA-256: `94f5e09be6731b2d373bdf327203b14d4e4fe33b72b81168ee4d49c988e5e1c7`.

All 505 packaged payload files matched the tested archive byte-for-byte. The extracted package passed its launch, native scene import, authored material, invalid-input preservation, storage persistence and graceful-restart smoke checks. No native crash, ensure or material compilation failure was detected. This validates the extracted installed payload; the installer was not run over the existing user installation. Smoke evidence: `artifacts/installer-036-smoke/report.json`.
