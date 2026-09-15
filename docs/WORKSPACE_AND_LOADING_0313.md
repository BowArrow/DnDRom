# Workspace and loading update 0.3.13

Close DnDRom and run [the Windows installer](../artifacts/installers/DnDRom-Unreal-0.3.13-x64-setup.exe). Existing campaigns remain in place. The previous 0.3.12 installer is preserved. No world rebuild is required. Initial visits populate new native and batched geometry caches.

## Layout and interaction

Build opens to Assets. Search, categories, Catalogue, and the asset grid have dedicated space; paused world planning cannot push the library offscreen. World and Environment occupy separate sections. Create opens a centered dialog outside the sidebar's clipping hierarchy, with keyboard dismissal and focus handling.

Scene keeps the prompt and generation action prominent while grouping advanced region settings. Character exposes artwork and base controls first; sheet attachment, restyling, and rigging are separate disclosures. Dice groups external templates separately. Workshop column widths adapt to their tasks. The existing fantasy styling is retained.

Move uses arrows and XY/YZ/XZ plane squares; Rotate uses rings; Scale uses end handles. Visible handles draw in Unreal's HUD with the current camera, so a delayed browser projection does not leave a visible handle behind the object. Transparent browser hit targets refresh while an object is selected. No-selection grid configuration is sent only when it changes.

Dragging sends live native previews and commits one durable update on release. The native renderer reconciles its last preview with the committed transform, avoiding double movement. Pointer cancellation restores the original transform. Ctrl snaps movement to the grid and rotation to 15 degrees. The ground handle follows terrain.

## Loading and reveal

The large-town cache bug was an admission failure: the combined scene exceeded a single entry's size limit and was silently omitted. Large scenes now cache individual bounded batches and publish an index after those writes. Missing parts cause a deterministic rebuild; partial data is never accepted as a complete cache hit.

Distant workers probe saved payloads before starting missing-tile erosion. Missing compiled tiles prefetch their saved regional/detail erosion fields. Geometry strings are compressed on disk. Local and distant compiled caches have separate budgets (384 MiB and 768 MiB). Large native imports also use a content-addressed JSON cache, bounded to one GiB. Native files rebind the current scene stream identity on read. Native parsing, mesh/resource creation, and graphics startup still take time.

The loading mist no longer waits for the entire approximately 160 km atlas selection. It finishes with a fixed nearby 12 km coverage cohort; ready covering parents count as scenery. Loading mist tapers across 10?12 km and excludes sky-depth receivers. Background refinement continues after the effect reaches zero. Ordinary camera orbit and object edits do not restart it. The accepted water shader is unchanged.

## Measured results

The full-town fixture contains a 256 m local scene imported in fourteen native batches. The final restart launched a new application process against the saved fixture without requesting generation or importing another campaign.

| Measurement | Final run |
|---|---:|
| First terrain coverage, from process launch | 16.2 s |
| All local batches ready, from process launch | 30.4 s |
| Nearby reveal fully faded, from process launch | 72.5 s |
| Local cached worker decode/export | 1.66 s |
| Distant completed-payload cache hits | 341 / 341 |
| Native payload cache hits | 127 |
| Erosion fields rebuilt on restart | 0 |
| Peak native process memory | 2.29 GiB |

The earlier full-town import took 35.1 seconds to finish its local batches and 96.5 seconds to clear reveal, measured from a fixture import rather than process launch. Those start points differ, so they are not presented as a controlled end-to-end speedup ratio. The important verified change is that the large local scene and every restored distant tile used cache data, with no repeated erosion. Complete local startup still takes about half a minute in this fixture; instant match-style loading is not established.

Minimum-hardware 1080p/30 FPS with local AI active remains unverified. These tests use an isolated local fixture with AI disabled, not a representative hardware/AI benchmark. Summed queue transfer durations overlap and must not be interpreted as elapsed loading time.

## Validation

- 30 focused tests across eight files passed: scene diffs, native batch boundaries, picking/update dispatch, reveal coverage, visibility, baseplates, and saved scene reuse.
- The native editing fixture moved through five distinct positions before pointer release. Planar XZ movement changed both axes while preserving Y. Rotation, scaling, selection, deletion, and plate rendering passed. Editing did not add a full-scene upload or reveal request.
- The 1280?800 workspace check retained a 343 px asset grid containing 54 starter/select cards, verified the Create chooser and its Character action, and checked every main tab without horizontal document overflow.
- The full-town reveal reached zero opacity and stayed at zero after rotation; captures show the cleared horizon.
- Reports: `artifacts/editing-0313/editing-report.json`, `artifacts/workspace-0313/report.json`, `artifacts/world-0313/restart-report.json`, and `artifacts/0313-tests-final.log`.

## Installer verification

The 0.3.13 installer is 867,027,827 bytes. All 595 extracted application files match the tested package byte for byte. The installer, launcher, and application icons match the project icon. The previous 0.3.12 installer remains unchanged.

SHA-256: `528b614ff34977391221f60a2ef0c81abbc8411286defcf69758cb6fbd2db428`.

The extracted installer application passed all 26 native smoke checks, including catalogue access, panel sizing, navigation, geometry preservation, persistence, and restart, with no native crashes or ensures. Evidence: `artifacts/native-0313-extracted-smoke/report.json`, `artifacts/installer-0313-verification.json`, and `artifacts/icons-0.3.13/report.json`. These checks launch the extracted payload; they do not automate the installer wizard on a clean Windows machine.

## Visual evidence and research

![Create actions outside the clipped sidebar](../artifacts/workspace-0313/create-dialog.png)

![Character source and contextual base settings](../artifacts/workspace-0313/character.png)

![Native planar handles](../artifacts/editing-0313/planar-move.png)

![Saved world after loading fog fades](../artifacts/world-0313/restart.png)

The [research PDF](research/DnDRom-Workspace-Interaction-and-Loading.pdf) and [linked source document](research/DnDRom-Workspace-Interaction-and-Loading.md) cover task-specific layouts, accessibility, direct manipulation, streaming, caches, and reveal ownership. Broader settlement-planner failures and full Blender feature parity are outside this update.
