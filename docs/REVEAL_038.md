# DnDRom 0.3.8: distant loading fog and saved town layouts

The 0.3.7 reveal material reproduced the reported patterned horizon wall in packaged captures at both 16 km and 65 km. Its finite height slab had visible boundaries, while small world-space billows became a repeating screen pattern at long range. The replacement uses continuous height extinction and filters billows according to their pixel footprint. The upper sky remains visible. Near loading fog still conceals newly arriving geometry.

Initial streaming now completes a fixed tile selection. Orbiting the camera previously changed that selection and requested new stitch variants while the loading reveal was trying to finish. Ordinary camera-dependent LOD selection resumes after the initial cohort is visible. Completion remains latched, and the native fade begins after the outward front reaches its acknowledged target. No timer uncovers missing tiles. Hydraulic erosion and water equations are unchanged.

## Saved towns

The scene cache could attach a current world revision to an older grid of buildings, then reuse that grid when entering the town. Cache validity now checks the accepted building IDs, positions and orientations, respecting authored changes and removals. Saving and loading an archived layout no longer relabels it as current.

In Build mode, older towns show **Upgrade town layout**. This uses the existing terrain-aware settlement planner and retains the previous scene. When the world already contains an upgraded town but its archived scene is open, **Open current town** loads the accepted layout. Installing the update does not silently rearrange saved towns. Layout upgrades preserve scene lighting, weather and grid settings; existing authored-building protections remain active.

Native scene readiness is reset for every import and tagged with its stream ID. Cancelled imports cannot start an orphaned terrain stream or overwrite the new scene's environment. The embedded file handler also retains its factory beyond bridge shutdown, preventing outstanding CEF requests from dereferencing a destroyed factory.

## Validation

- TypeScript compilation, native build and material cook passed.
- All 26 final packaged-application smoke checks passed, including catalogue controls, camera navigation, malformed-transfer rejection, persistent storage, zero-exit-code restart and no native crashes or ensures. The same checks also passed from a fresh extraction of the final installer. Evidence: `artifacts/installer-038-smoke-release/report.json`, `artifacts/installer-038-extracted-smoke/report.json` and their launch logs.
- 59 focused tests across 16 files passed. The new streamer integration tests exercise the real atlas selection with simulated worker responses and delayed native acknowledgements. They verify completion during continuous camera movement, resumption of normal LOD selection, and waiting for the last distant tile. Existing seam, water-field, shoreline and local-first checks pass. Town tests cover stale caches, saved-scene preservation, explicit upgrade controls, and lighting/weather/grid preservation.
- Packaged captures at 16 km and 65 km remove the reproduced repeating fog pattern. A fixed horizon-region high-frequency residual falls from 1.95 to less than 0.001 and from 4.84 to 0.17 respectively, on an 8-bit RGB scale. These are controlled image comparisons, not a general perceptual score.
- A delayed wall changes its covered image region by 0.73 RGB levels while hidden, versus 52.55 when revealed. Native completion disables the effect; ordinary updates do not replay it; stale scene updates are rejected.
- All six underwater camera poses remain passing, with zero black horizon pixels, no missing materials, correct entry/exit and reuse of the reflection capture during rotation. Above-water wave and foam equations are unchanged.
- Visual comparisons: `artifacts/reveal-038/comparison.html`; native captures and optical checks: `artifacts/reveal-038/after/`.
- The full-world packaged run completed all 375 selected distant tiles, reached a 65,488 m reveal radius, faded opacity to zero and remained clear after camera rotation. Evidence: `artifacts/reveal-038/world/report.json`, `world-revealed.png` and `rotated.png`.
- A real native UI upgrade completed in 89.457 seconds with 36 buildings, varied orientations and at least six building families. The prior scene was retained. Opening the archived grid and returning through **Open current town** also passed with a matching completed native import. Evidence and visual comparison: `artifacts/settlement-038/comparison.html`, `native/report.json`, `native/revisit-report.json`. These geometry comparisons used a reduced legacy fixture and disabled reveal fog for the completed close-up. Later code preserves lighting across the upgrade; that addition is unit-tested.

## Generation timing limitations

The extended world run reused a profile containing 73 cached erosion fields and still took **1,509.681 seconds (25.2 minutes)** to complete the entire selected horizon. It reported local readiness at 40.092 seconds and the first distant tile at 42.918 seconds, but this run preceded the per-import readiness reset, so its local timing is diagnostic rather than a validated first-playable benchmark. The final world completion check used native tile acknowledgements and opacity, independent of that UI flag.

An earlier cold run timed out after 632.78 seconds with 313 of 375 distant tiles ready. It does not establish a full cold-generation duration. Hydraulic field generation remains the dominant cost; this release does not claim to solve that performance problem. These runs are not representative minimum-hardware or local-AI-active benchmarks. Peak memory and 1080p frame-time targets remain unverified.

## Installer and compatibility

`artifacts/installers/DnDRom-Unreal-0.3.8-x64-setup.exe` is a per-user Windows installer (789,744,065 bytes). All 514 application payload files match the tested archive by SHA-256. The previous 0.3.7 installer is unchanged; existing campaigns and user profiles are preserved. This update does not require rebuilding a world. Restart the application and reopen the campaign after installing it; use the town upgrade notice to explicitly replace an older layout.

Installer SHA-256: `fb4360133a5361506cde19a59530afb149ed071ad271475e17cdaa163d11d8f0`.

The 1080p / 30 FPS target with local AI active on 8 GB VRAM / 16 GB RAM remains unverified. Cold generation speed must be assessed separately from this fog correction.
