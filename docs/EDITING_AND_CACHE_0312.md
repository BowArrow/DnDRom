# Native world editing and render caches — 0.3.12

The 0.3.11 viewport still uploaded the complete scene whenever its entity array changed. Each replacement removed the previous local detail batches. Preserving the reveal identity alone did not prevent terrain and foliage from being rebuilt. This release separates ordinary object edits from terrain imports.

## Editing

- New or visually changed objects upload independently. The existing object remains until its replacement finishes importing. Removing an object and changing its position, rotation, or scale update native instances directly.
- Terrain and distant streaming remain resident during character and prop edits. Actual terrain/road/water geometry changes still require an updated terrain import.
- Native picking resolves the hit object's owning actor, including later local batches and incremental objects. Hidden replacements are excluded from picking.
- Placing an asset exits placement mode and selects the new object. Clicking again selects instead of repeatedly adding more copies. Choose the asset again to place another.
- Build mode exposes Move, Rotate, and Scale controls. Drag a colored axis or rotation ring; drag the central yellow handle along terrain. Ctrl snaps translation to the grid or rotation to 15-degree steps. W/E/S select the tools while the viewport has focus. Existing camera navigation remains available.
- The square/hex grid follows the ground near the view. It has bounded coverage and does not generate a new terrain mesh. Regular heightfields use direct cell lookup for grid/camera height samples.
- Plain miniature plinths and rims are now included in native model geometry. Saved scenic plates resolve from both the campaign and the local baseplate library; importing a library miniature also brings its plate dependencies into the campaign.
- Ordinary movements no longer recreate all practical lights.

## Loading and fog

Local terrain/settlement geometry is cached separately from ordinary characters and props. Completed distant tile payloads are cached too, including the full prototype definitions needed by a fresh process. Cache keys include geometry context and generator version. They do not depend on the current upload's random stream ID.

The regenerable IndexedDB render cache is bounded to 512 MiB, with a 128 MiB per-entry limit. Storage failures fall back to generation. The first load after upgrading may populate this new cache; previous erosion fields remain usable. Evicted or genuinely revised regions still need rebuilding. Campaign plans and authored changes remain authoritative and are never replaced by cache records.

Distant selection uses a larger movement threshold and a settling interval. Replaced geometry stays until covering replacements are ready. Character edits do not invalidate distant terrain. The initial reveal can finish once complete covering geometry exists, rather than waiting for all fine-detail leaves at the horizon. It then fades without waiting for a radius animation to traverse kilometres of already visible landscape. Ordinary edits never restart it.

## Validation and limits

- `artifacts/0312-tests-final.log`: 49 passing tests across nine files, covering targeted regressions for incremental scene updates, terrain invalidation, native picking dispatch, model/baseplate conversion, controls, reveal, and shared settlement planning.
- `artifacts/native-0312-smoke/report.json`: 26 packaged application checks, including navigation, persistence, materials, and shutdown.
- `artifacts/editing-0312-verified/cold-report.json`: actual native placement, selection, movement, deletion, terrain collision, and disk-cache evidence. The controlled distant tile took 37.9 seconds cold and 16.8 ms from the completed render cache in a fresh worker, with zero erosion simulation on the cached run. These are worker timings, **not** complete world-load times or minimum-hardware frame-rate results.
- `artifacts/editing-0312-verified/`: final native handle checks and screenshots. Explicit synthetic miniature/plate geometry is used so placement can be asserted independently of image-model quality.
- `artifacts/editing-0312-verified/editing-report.json`: repeat run after restarting the app confirmed the local compiled-scene cache hit (14 ms worker export) and cached distant geometry in both fresh workers (13.4 and 14.1 ms). Placement, all three transform handles, picking, and deletion passed again.

The harbor planner can search additional nearby shorelines after exhausting the initial coastal sites. Building roles and dry-frontage checks remain mandatory. An older saved harbor checkpoint was inspected, but it differs from the latest screenshot's failure; that exact request has not been reproduced. Existing playable scenes can be edited independently of the paused planner.

This release does not change the accepted water shader or claim to resolve image-generator height compliance. 1080p/30 FPS on an 8 GB VRAM / 16 GB RAM system with local AI active remains unverified.

![Native move/rotate/scale handles and ground grid](../artifacts/editing-0312-verified/transformed.png)

![Assigned plate in the native scene](../artifacts/editing-0312-verified/plate-close.png)

The native editing fixture recorded seven transform batches and one incremental object upload. Main-scene upload and reveal-request counters did not increase during editing. The original terrain retained its mesh-build timing and stream identity. Picking the new object returned its correct entity ID from its separate native actor. Deletion removed that actor without replacing terrain.

## Installation

Close DnDRom, then run the [0.3.12 installer](../artifacts/installers/DnDRom-Unreal-0.3.12-x64-setup.exe). Existing campaigns and the previous installer are preserved. No world rebuild is required to use native object editing or automatic terrain collision. The first visit fills any missing render-cache entries.

The installer was extracted into a fresh validation directory: all 572 payload files matched the tested package byte for byte, and the previous 0.3.11 installer remained unchanged. The application, launcher, and installer icons all matched the project icon.

- Installer size: 848,376,145 bytes.
- SHA-256: `a452f8f31447d17451d94f25d7c2d31f2f054ba38e44d6a57e7ebac9861828df`.
- Package verification: `artifacts/installer-0312-verification.json`.
