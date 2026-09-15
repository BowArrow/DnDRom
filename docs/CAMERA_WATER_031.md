# DnDRom 0.3.1: camera, planning and world scenes

This update uses existing campaign data and accepted world plans. No world rebuild or campaign migration is required. The previous 0.3.0 installer is retained. Close DnDRom before running the new per-user installer.

## Changes

- Orbit and pan are integrated on the native engine tick with a short, frame-independent response. The embedded browser runs at 60 Hz. Held-key movement accumulates across delayed bridge acknowledgements instead of disappearing. Right-mouse look preserves camera position. Motion blur is disabled.
- A 30 cm camera probe checks solid geometry. Terrain triangle sampling also protects against distant render LODs without physics collision; the camera keeps 40 cm of ground clearance. Water remains traversable.
- **World scenes**, in the scene toolbar, lists accepted locations and pending requests, with search, building counts, biome and road/ferry connections. Open a scene or return to the travel view. Existing geography is reused and missing detail is generated locally. The current scene remains available during preparation.
- Planning distinguishes local runtime preparation, streamed model activity, terrain search and playable-scene construction. Indeterminate stages display **Working**, elapsed time and activity instead of a misleading 0%. The local-model planning stage has a three-minute budget across repairs after runtime preparation. Runtime setup/download and terrain erosion have separate durations. Cancellation of planning returns promptly even if shared runtime setup is still finishing.
- Underwater viewing uses a separate post process with distance-dependent absorption and scattering, wave-normal refraction, a critical-angle reflective boundary when looking up, and shallow receiver caustics from the existing wave field. The accepted above-water displacement and foam material are retained.

## Verification

Focused UI, input, local-runtime cancellation, streamed-response and scene-director checks: **17 passed**. Terrain continuity and water-field regression checks: **14 passed**. Native UE game/editor builds and SM5/SM6 material cooking passed without fallback materials in the final build.

The packaged coastal regression exercised persistent foam, decay, simulation-window movement, temporary field removal/replacement, invalid-field rejection, world reset and weather response. All passed. Foam density fell from 1,802.55 to 20.92 with emission disabled; retained foam after moving the simulation window was 1,699.93. These are diagnostic sums, not visual quality scores. Receipt: `artifacts/underwater-optics-031/report.json`.

The shared-world native test used real browser middle-mouse events. In its final four-second frame sample, median and 95th-percentile engine delta were about 16.67 ms, maximum 16.68 ms, and the largest per-frame yaw change was 0.242 degrees. An earlier run included one 46.30 ms frame; this update does not claim that all loading hitches are eliminated. Receipts: `artifacts/camera-water-final-031/camera-motion.json` and `artifacts/camera-water-review-031/camera-motion.json`.

Repeated downward movement stopped at the same local seabed height (-6.583 m) and distant terrain height (-26.904 m), while free-look left position unchanged. These are scene-relative coordinates. Receipt: `artifacts/camera-water-final-031/underwater-review.json`.

The scene panel displayed the four-location connected harbor fixture, accepted the mainland destination, and returned to the original harbor. The first harness selector matched a connection label instead of the destination title; it was corrected to match the title exactly. Do not interpret that run's `jumpSeconds` as a generation benchmark.

A subsequent saved-world navigation run used the corrected selector and waited for both the browser scene-transfer receipt and native mesh-import completion. The mainland completed in 30.27 seconds and the return to the cached harbor in 30.10 seconds, including capture settling time. The original harbor map ID was restored. This measures scene reconstruction/transfer on this workstation, not an instant camera teleport or full distant-terrain refinement. Receipt: `artifacts/camera-water-final-031/scene-navigation-verified.json`.

## Visual comparisons

- [World scenes](../artifacts/camera-water-final-031/world-scenes.png)
- [Accepted surface after the changes](../artifacts/camera-water-final-031/above-water.png)
- [Submerged receiver and caustics](../artifacts/camera-water-final-031/underwater-down.png)
- [Looking across the underwater surface](../artifacts/camera-water-final-031/underwater-horizon.png)
- [Final upward view without the rectangular sampling edge](../artifacts/underwater-final-031/below-up.png)
- [Final waterline transition](../artifacts/underwater-final-031/waterline.png)
- [Mainland after native scene import](../artifacts/camera-water-final-031/mainland-ready.png)

The first underwater test exposed incorrect HDR pre-exposure in custom scene-texture lookups. That was corrected using UE's exposure-aware lookup. The final shader also fades screen-space sampling confidence at viewport edges to avoid a rectangular reflection boundary. Final optical captures and installer verification are recorded alongside the release artifacts.

## Limits

These measurements are from an RTX 3080 10 GB / 32 GB workstation, with local AI disabled during the rendering tests. **1080p/30 FPS on 8 GB VRAM / 16 GB RAM with local AI active remains unverified.** Model streaming, malformed output and cancellation were fixture-tested; these checks do not establish live-model throughput.

Cold terrain erosion still takes minutes. Progress is more informative; this update does not replace the erosion solver or claim a new cold-generation speedup. Reflection/refraction uses available screen coverage and falls back to ambient water color for offscreen rays. This is not complete ray-traced underwater rendering; offscreen reflection detail and object-level caustic shadowing remain limitations.

Research and optical assumptions: [Underwater, camera and caustics research](research/Underwater-Camera-and-Caustics.md).

## Installer verification

Deliverable: `artifacts/installers/DnDRom-Unreal-0.3.1-x64-setup.exe`, 734,998,824 bytes. SHA-256: `8fde4a0d55ad953923b5bc1d147ae4b1b065eff2c4c9d30b3f35e8683821fae9`.

Archive integrity passed. All **438** packaged application files matched the staged archive by SHA-256 after extracting the installer. The previous 0.3.0 installer retained SHA-256 `92a8197d923048fd5c7046d8e51c6353414c94174f19f7305f328bbebac8b5d2`. Receipt: `artifacts/installer-031-verification.json`.

Validation used isolated application profiles. The installer was not run over the user's installed application or campaign data. All test application processes were closed afterward.
