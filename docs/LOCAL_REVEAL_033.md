# Local scene loading and fog reveal — 0.3.3

The empty playable rectangle was a failed local import. The recovered harbor export contains 136,526,969 bytes, exceeding the native 128 MiB transfer limit. Distant streaming started independently and interpreted the previous scene's completed import as permission to proceed. Its terrain intentionally excluded the local square, leaving the old tavern and a hole.

## Runtime changes

Runtime imports now omit the duplicate authored campaign/map payload and partition render data into independently validated batches below 16 MiB. Terrain and water precede buildings and trees; dense grass comes last. Every render instance and its transform remain present. Full downloadable exports still retain their authored source data, and campaign persistence is unchanged.

The main local actor loads first. Additional local actors use the same import identity and remain independent of distant-tile visibility. Stale local parts are rejected, previous local parts are removed when the new root commits, and the viewport waits for each native acknowledgement. Distant streaming starts only after local imports finish. A failed local import cannot start a distant-only world.

The local opening becomes visible once its terrain, structures and trees are ready, while grass can continue importing. Startup streaming prioritizes the starting area, then returns to camera-based prioritization. Nearby coarse coverage stays hidden by reveal fog until detailed foliage is ready; existing covering geometry remains available for LOD handoffs.

## Reveal

A dedicated post-process material ray marches an animated world-space density field using Beer–Lambert transmittance. The existing Unreal atmospheric fog remains in place. Reveal compositing runs after tone mapping so bright fog cannot drive auto-exposure and darken the revealed town. A fixed origin and a monotonically increasing reveal radius drive the opening. Camera orbit does not change its center or restart it. The target is the distance to the closest uncovered quadtree rectangle, with a safety band inside that coverage. An orbit-camera visibility adjustment keeps already revealed ground readable when the camera sits beyond the opening.

This is a custom ray-marched reveal effect; it does not add weather simulation or fully shadowed atmospheric multiple scattering. Epic documents [volumetric fog controls and their rendering cost](https://dev.epicgames.com/documentation/en-us/unreal-engine/volumetric-fog-in-unreal-engine) and [local fog volumes](https://dev.epicgames.com/documentation/en-us/unreal-engine/local-fog-volumes-in-unreal-engine). The existing water and shoreline equations were retained.

## Planning and foliage

A missing optional AI architecture-style suggestion now retains the requested regional style instead of invalidating an otherwise usable scene plan. Invalid essential requirements still receive bounded repairs; the user-facing fallback omits raw schema dumps.

Middle-distance tree crowns now have more varied closed lobes and smoother normals, retaining the procedural branch structure and lower LODs. Horizon crowns use multiple whorls/lobes instead of a single diamond-like volume. Tree prototype identities changed so cached older geometry is not reused.

The voiced wizard / AI DM is deferred as requested. No speech runtime, voice downloads, or narrator behavior changed.

## Validation and upgrade

Focused tests cover bounded transport and placement preservation, the local-before-distant lifecycle and failure path, reveal coverage, forest geometry, optional AI styles, shoreline/water fields and seam regressions. Packaged native validation captures are under `artifacts/local-first-033/native`.

Install 0.3.3 and reopen the campaign/scene. An already accepted world does not need to be regenerated. If generation is paused, use Connected world → Resume generation. Existing installer versions and campaign data are retained.

The 8 GB VRAM / 16 GB RAM, 1080p / 30 FPS target with local AI active remains unverified. Native import, background streaming and shader warmup still take time; a ready local opening does not mean the complete distant world has finished loading.

35 focused tests passed across 11 files. Native playback of the previously rejected harbor confirms six local detail actors plus the local terrain actor load before any distant tile. All 195,430 placements survived the batch partition; the largest batch is below 16 MiB. Camera rotation preserved the reveal radius.

The final packaged run used the development PC with the erosion cache warm and local AI disabled. Measured from viewport import start, terrain was ready at 23.4 s, local terrain/buildings/trees at 35.7 s, and all local batches at 54.1 s. Measured from campaign file import, all local detail was acknowledged at 61.2 s and first distant coverage at 70.1 s. Focused tests also ran during this visual check, so these are diagnostic timings, not an isolated performance benchmark. Scene planning and prior scene compilation are excluded. Native loading is improved in sequencing but is still not instantaneous. The sampled frame time after rotation during active streaming was 92.7 ms; this does not establish steady-state performance or the 30 FPS target.

Visual comparison: [initial local opening](../artifacts/local-first-033/native/local-ready.png), [expanded reveal](../artifacts/local-first-033/native/world-revealed.png), and [after camera rotation](../artifacts/local-first-033/native/rotated.png). The final material preserves the town's exposure, reveals the actual local buildings, and retains the reveal radius through rotation. Near-tree art and broader world visual polish remain separate work.

## Installer

`artifacts/installers/DnDRom-Unreal-0.3.3-x64-setup.exe` is 750,289,978 bytes. SHA-256: `5ef1fd1949d1b2f722093d575e679d55b1e03b1c7d3c3b4975d36f08833d63f5`.

All 456 packaged payload files were extracted and hash-compared against the tested native archive. The previous 0.3.2 installer hash remained unchanged. Validation launched the packaged app with an isolated profile; the installer was not run over the user's installed app or campaign data. Evidence: `artifacts/installer-verification-033.json`, `artifacts/final-tests-033.log`, and `artifacts/smoke-reveal-033-verified.log`.
