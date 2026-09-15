# Harbor generation recovery — 0.3.2

The 40% Sites failure was caused by inconsistent water-clearance checks. Dock placement accepted depth at the berth center, while ferry routing also checked the surrounding 6 m footprint. The saved harbor's berth had only 0.85 m of depth at one clearance sample, below the ferry's 1.2 m draft. Four viable mainland layouts failed their ferry connection; the final two rejected layouts overwrote that explanation with a parcel-capacity error.

## Changes

- Docks and ferry paths now use the same draft and shoreline-clearance predicate.
- A legacy shallow berth can extend along its existing dock direction, within a bounded 160 m total span. It cannot extend across dry land. This repair occurs in the trial connection plan, without moving the landing, buildings, streets, or existing terrain edits.
- In the recovered checkpoint, the harbor dock extends 2 m offshore. The mainland contains all 11 required buildings and connects by a roughly 907 m ferry route. The original harbor retains all 36 buildings.
- Failed site searches report the accumulated reasons rather than only the last failure. The activity card wraps the full error and says Stopped, with resume guidance for world jobs.
- Resume reuses saved planned requirements. Editing a pending request explicitly enables replanning. Older checkpoints with an accepted location also resume without another model pass.
- A failed planning worker waits for outstanding terrain-cache writes before notifying the UI, which otherwise terminates that worker immediately.

## Migration

Close DnDRom normally, install 0.3.2, reopen the same campaign, and choose **Resume generation** in **Connected world**. A separate geography rebuild is unnecessary. The installer does not replace campaign or runtime data. The previous 0.3.1 installer is preserved.

Accepted terrain samples, buildings, street layouts, authored terrain edits, and dock landing positions are retained. Unsafe legacy offshore berth endpoints may extend as described above; connected docks receive a shared water-body identity when their ferry route is committed. Water materials and wave equations are unchanged.

## Validation

- 33 focused tests passed: shared-world contracts and transport, worker cache persistence, saved-world resume/edit/failure recovery, model contracts, progress UI, and worker client behavior.
- TypeScript checking and the native Windows packaging build passed.
- Replayed the user's failed checkpoint against its actual eroded terrain. Both cold and cached runs completed the full site-and-connection plan. All 36 existing building records and all existing terrain edits compare exactly to the checkpoint; the input checkpoint is unchanged.
- Validated ferry draft/shore clearance at 673 samples along the recovered route. Required buildings and graph connectivity pass the shared-world validator.
- Packaged native UI capture at 1280 × 900 confirms the complete failure text fits, wraps, and no longer claims live progress. See `artifacts/site-failure-032/ui/error-card.png`.

Measured on the development PC, in the isolated Node planner: cold recovery 167.52 s; cached recovery 1.26 s. Peak process RSS was approximately 204 MiB cold / 223 MiB cached. These measure terrain/site/connection planning from the accepted harbor checkpoint, excluding model startup/inference, scene compilation, native streaming, rendering, and local AI contention. Cold validation ran while packaging was active. They are not minimum-hardware performance guarantees. 1080p / 30 FPS with local AI active on 8 GB VRAM / 16 GB RAM remains unverified.

The copied checkpoint and recovered world are private diagnostic artifacts under `artifacts/site-failure-032`; they are not installer content. The user's running installed app and original data were not modified during validation.

Both recovered playable scenes compiled and exported without warnings: harbor compilation 27.14 s plus 4.25 s export (1,440 entities), mainland compilation 10.51 s plus 2.99 s export (671 entities). These are compiler timings, not native first-playable measurements.

The 0.3.2 installer was extracted and all 442 packaged files matched the tested archive by SHA-256. Installer: `artifacts/installers/DnDRom-Unreal-0.3.2-x64-setup.exe` (738,094,577 bytes). SHA-256: `98a4aced41747c7a8584189988cac47396bb8dad14fc108dcd47eeb5138b0ae7`.
