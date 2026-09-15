# Building facades and roof closures — 0.3.5

Generated houses now have window frames, mullions, sills and open shutters, plus visible door leaves and hardware. Door leaves rest open and leave the existing entrances passable. Interactive opening/closing is not part of this patch.

Walls now extend to the roof. The infill is constructed by intersecting wall planes with the actual roof triangles at each level of detail, so gables and curved hipped eaves meet their roofs without an approximate triangular cap. The same structural recipes produce local and distant geometry.

Existing unedited shared-world buildings are refreshed from their accepted recipes during native export and scene switching. Their IDs, positions, rotations, material assignments, roads and parcels remain unchanged; no settlement-layout rebuild is needed. Explicitly authored or removed buildings are protected. Legacy non-shared scenes retain their existing rendering path.

Validation:

- 40 tests passed across settlement facades, settlement planning, shared-world ownership/persistence, native scene export and native import batching.
- Roof closure tests cover gabled and hipped roofs, three curvature values and all three detail levels. They verify the infill follows the sampled roof surface and produces finite, normalized geometry.
- Door tests verify a clear threshold after expanding the opening fittings; saved-map tests verify idempotent refresh and preservation of transforms and authored overrides.
- TypeScript/Vite build passed. The existing Unreal native binary was packaged with the updated generator and renderer; no native protocol change was required.
- Isolated packaged Unreal tests loaded pre-0.3.5 saved building meshes and verified their refresh. Imports completed with no missing materials, compatibility notices or vertex-color mismatches.
- Close-up captures: [doors and windows](../artifacts/facades-035/native-lit/door-window.png), [gable closure](../artifacts/facades-035/native-lit/roof-gable.png), [hipped eaves](../artifacts/facades-035/native-lit/hip-eaves.png), [courtyard](../artifacts/facades-035/native-lit/courtyard.png). These are structural review fixtures on a plain floor, not a terrain-performance benchmark. Shadow-side captures are also retained in `artifacts/facades-035/native`.

Installer: [DnDRom-Unreal-0.3.5-x64-setup.exe](../artifacts/installers/DnDRom-Unreal-0.3.5-x64-setup.exe), 763,191,681 bytes.

SHA-256: `fac3f02ed57448fed2102c281766c67a374282ec3d068a0f285a650bd664f70c`.

All 482 expected extracted payload files matched the tested archive. The 0.3.4 installer was preserved and its previous hash verified. Testing used isolated profiles and did not install over the user's application or replace campaign data. This patch does not establish new loading-time or minimum-hardware performance results.
