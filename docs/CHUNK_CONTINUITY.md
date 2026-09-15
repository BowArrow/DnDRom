# Chunk continuity repair

The 0.2.6 export changes fix disagreements between representations of the same
surface. They do not alter the accepted coastal wave, foam transport or caustic
equations, regenerate the saved harbor, or replace campaign terrain.

## Causes and changes

The harbor fixture's original duplicate height samples already agreed. Its local
terrain normals used height lookups clamped to each individual chunk, however.
At an edge that discards half the derivative and creates a different normal and
slope-dependent material weight on either side. `createTerrainPatchSampler`
samples neighboring persisted patches and supplies the same derivative to both
chunks. The nearby streamed terrain shares this boundary normal too. Mesh heights
remain the saved heights; the region's last derivative is only extended for
shading where neighboring authored data is unavailable.

Water used separate clamped shore contours and nearest-wet-surface searches per
chunk. `prepareSceneWater` now prepares the complete authored region together,
with deterministic ownership of shared samples. Geometry, foam fields and water
material inputs consume that contour. The native atlas uses the authored water
values at its boundary and transitions to regional data outside it.
Positive water depth always follows the displayed regional bed. Only dry
exclusions extend outward; copying a fixed edge depth onto a sloped lakebed
would incorrectly expose the simulation boundary through terrain wetness.

Coarse streamed water also lacked an ownership hole over the local scene. Its
triangles are now clipped against the authored rectangle, including rectangles
which do not align to the coarse water grid. This prevents two overlapping water
surfaces while retaining the surrounding water area.

## Verification

`nativeChunkSeams.test.ts` compares terrain normals and material masks across
chunk edges, water inputs for one region versus the same region split into four
tiles, and local/streamed boundary normals. `nativeAtlasWater.test.ts` checks the
area and triangle ownership of a non-grid-aligned local water exclusion.

`scripts/audit-native-seams.mjs` checks the saved harbor's actual exported data:
783 shared terrain samples and 558 shared water samples. The measured maximum
terrain height, normal, material, water-height and shore-distance differences
are zero. Maximum depth difference is below 1e-16 metres.

Fixed-camera packaged comparisons live in `artifacts/seams-before` and
`artifacts/seams-release`. The intermediate `seams-after` candidate was rejected
for a lakebed wetness discontinuity. Coverage checks and visual review are distinct evidence;
neither proves that every possible future LOD/terrain combination is artifact-free.
The water motion suite verifies the existing foam persistence, decay, field
handoff, world reset and weather behavior. Consult the final build receipt for
the installer hash and the reports belonging to that release.

The broader biome, settlement and transport system is specified in
[the research report](research/DnDRom-Biomes-and-Connected-Worlds.pdf). This patch
does not implement that future world-generation pipeline.
