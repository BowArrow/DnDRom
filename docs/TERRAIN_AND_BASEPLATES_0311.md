# Terrain physics and baseplate corrections — 0.3.11

World terrain now creates invisible Unreal physics meshes automatically. They use the terrain's position and triangle buffers, including road and foundation edits, without the visual material, vegetation, or skirts. Async cooking has a shared limit of four outstanding jobs and two starts per frame. Near terrain gets collision; large distant scenery tiles do not. Replacement terrain waits for required collision cooking before becoming the accepted scene.

The native picker also intersects the rendered terrain triangles, covering surfaces whose physics body is not available. A packaged slope fixture verified an actual physics hit, independently of that fallback: the returned point matched the visible slope within 2 cm. The fixture cooked 2,048 triangles. This is a collision/placement verification, not a representative-hardware performance benchmark or an NPC navigation system.

World reveal identity is now tied to the world and site, rather than each upload's random ID. Token changes reuse distant streaming instead of clearing it. Stale upload cancellation remains separate. Tests cover editing the same scene, switching scenes, placement dispatch, and native reveal opacity remaining zero after a repeated request and camera rotation.

## Baseplate corrections

The old fitter independently compressed the vertical axis, then used the highest central intersection as the standing height. It could squash scenery and place a miniature on a central flower.

The replacement keeps uniform scale. It samples the upper surface and searches for a supported, low patch, applying the resulting horizontal offset and height in Character Forge, the base editor, and the native tabletop. Preferred standing-position controls let users choose a particular area; **Find low standing area** restores automatic selection. Save a revision to persist changes.

New generated meshes are checked before being saved or assigned. Oversized meshes and meshes without a sufficiently flat standing area are rejected with an actionable message. Existing saved meshes retain their original proportions and show a warning if they exceed the selected height. They may need regeneration; their old flattened preview is not a faithful representation of the source geometry.

Local concept generation now receives a physical composition guide built at the requested height, alongside the current brief. It uses image-to-image conditioning, a shallow composition prompt, and negative conditioning. Height is specified both as a fraction of width and as millimetres for a 32 mm example. The prompt keeps the middle clear and avoids introducing an unrequested central ornament. Hosted Krea retains text guidance because its existing connector does not accept this structural reference.

Image conditioning is guidance, not a provable physical measurement. Review the reference before conversion; the mesh validation is the final dimensional check. The system does not promise that every diffusion output satisfies a numeric height request.

## Harbor planning

The planner tries distinct dock landings before abandoning a site. A failed quay route retries at 4 m and 2 m grid spacing; other failed street arms can shorten or change direction without paying for every refinement. Coastal site selection now checks connected water before filling its candidate quota, and the solver can examine 24 accepted candidates. Required building counts, dry frontage, grades, and access validation remain mandatory. Existing accepted plans are preserved.

The narrow-quay fixture specifically exercises a dry passage missed by an 8 m routing grid. City/coastal fixtures also verify all requested roles and valid access. The exact failed harbor shown in the user's screenshot has not been reproduced from its saved generation checkpoint; these corrections do not establish that every requested site will fit.

## Evidence and limits

- `artifacts/0311-tests-final.log`: 54 passing tests across nine files, covering the final source.
- `artifacts/native-0311-smoke/report.json`: all 26 packaged application checks passed, including camera input, geometry/material retention, campaign persistence, and graceful restart.
- `artifacts/package-0311-physics.log`: native editor/game compilation, cooking, and packaging completed.
- `artifacts/0311-ui-final.log`: final production UI compiled successfully, with existing bundle-size and browser-externalization warnings.
- `artifacts/0311-waterfront-tests.log`: settlement and scene streaming checks.
- `artifacts/baseplate-0311/native/physics-report.json`: cooked terrain collision, matching slope, and stable cleared fog.
- `artifacts/baseplate-0311/native/report.json`: central-obstruction geometry fixture.
- `artifacts/baseplate-0311/real-mesh/report.json`: existing generated pond mesh, using a controlled miniature fixture. Its standing height is approximately 0.108 m rather than the approximately 1.064 m highest scenery point. Source geometry and textures were retained.

![Existing pond geometry with the miniature on a lower surface](../artifacts/baseplate-0311/real-mesh/low-base.png)

### Real local image check

Two references were generated through the actual cached Sana runtime using the final prompt and guide. Both recovered realistic surface detail after reducing guide retention, but the second still introduced tall leaves. **Exact image-height compliance remains unresolved.** These images are evidence of that limitation, not an acceptance pass. Stronger guide retention also produced flat illustrations and was not retained as the default.

![Final local reference, first candidate](../artifacts/baseplate-0311/release-concept-1.png)
![Final local reference, second candidate still too tall](../artifacts/baseplate-0311/release-concept-2.png)

No new Pixal3D conversion was run for these references. The mesh checks were tested with synthetic geometry and an existing generated pond GLB. Performance at 1080p/30 FPS with local AI active on an 8 GB VRAM / 16 GB RAM system remains unverified.

No campaign data was modified by the tests. The prior 0.3.10 installer is preserved. The canonical DnDRom icon remains configured for the executable and installer.

## Installer and migration

[Download the Windows 0.3.11 installer](../artifacts/installers/DnDRom-Unreal-0.3.11-x64-setup.exe) (829,873,779 bytes).

SHA-256: `8cad1a73402ee0f817d2b0aa4b598ea2de6869c591782e6299a141e346a11c7b`.

All 552 extracted payload files match the tested archive byte-for-byte. The previous 0.3.10 installer hash is unchanged. Pixel comparisons confirm the canonical brand icon on the installer, launcher, and native executable. Reports: `artifacts/installer-0311-verification.json` and `artifacts/icons-0.3.11/`.

Close DnDRom before running the installer. Existing campaigns remain in their current data directory; no campaign rebuild or terrain regeneration is required for physics meshes. The meshes are generated from loaded terrain at runtime and are not written into campaign files. Optional standing-position preferences are saved with baseplate revisions; older recipes remain readable. Existing source meshes may look taller because uniform scaling now exposes their original proportions. Regenerate those bases for shallow geometry instead of relying on the former vertical compression.

## Technical references

Unreal exposes runtime procedural collision creation and off-thread cooking through [UProceduralMeshComponent](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/ProceduralMeshComponent/UProceduralMeshComponent). The implementation was checked against the locally installed UE 5.8 source as well.

The reference-image workflow follows [ComfyUI's image-to-image documentation](https://docs.comfy.org/tutorials/basic/image-to-image). Denoise changes the balance between retaining reference structure and synthesizing new detail; it is not a geometry constraint. The installed [Sana model integration](https://github.com/city96/ComfyUI_ExtraModels) supplies the local encoder and diffusion workflow.
