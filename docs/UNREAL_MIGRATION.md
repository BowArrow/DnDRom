# DnDRom Unreal Windows build

The Windows client runs the campaign and authoring interface inside Unreal 5.8.2,
with the scene rendered by native C++ meshes and hierarchical instancing. The
owned Rust process host handles local AI and rules through private pipes. A
per-user EXE installer is built separately from the existing Tauri application.
The target is 8 GB VRAM / 16 GB RAM; that minimum machine has not been benchmarked.

## Implemented path

- The building tray has one Catalogue entry with Starter Assets, Props,
  Characters and Materials tabs. Panel edges drag to resize, catalogue windows
  resize from their lower-right corner, and a preview slider adjusts asset-card
  density. Panel sizes, catalogue dimensions and the last tab persist locally.
- Bundled React campaign, scene, AI DM, asset and character workflows load from
  a private CEF scheme handler. No development server, Node installation, or
  separately managed Ollama instance is required by the installed application.
- The UObject bridge handles bounded, acknowledged scene/material transfers,
  native camera and semantic picking, viewport placement, local exports, runtime
  events, and native microphone PCM chunks. Navigation and export paths are checked.
- Native scenes retain the old scene while a replacement is validated and built.
  Worker-side compilation keeps large JSON serialization off the UI thread.
- Text generation uses the app-owned language model and existing procedural
  compiler. Native Quick mode avoids automatically downloading the much larger
  optional image/3D creation stack. Reference-based material and prop workflows
  retain that local creation backend and install it on demand.
- Native world streaming uses the existing shared, eroded terrain sampler,
  global-coordinate quadtree selection, ready-gated parent replacement, and
  bounded resident tile counts. Native forests use instanced geometry nearby
  and projected tree cutouts at intermediate distance. Atmosphere, sun, clouds
  and volumetric fog come from the Unreal boot map.
- Static self-contained GLBs and custom PBR maps are uploaded from the local
  asset database. Materials retain role assignments, vertex colors and normal
  orientation. Imported images are limited to 2048 pixels per dimension.
- App-owned Whisper uses pinned, hash-verified whisper.cpp 1.9.0 and the
  multilingual base model. CPU transcription shares the existing streamed
  speech/VAD path through Unreal audio capture. Actual transcription passed;
  a physical microphone session has not been tested.
- CEF campaign storage persists across restart. Native runtime defaults share
  the existing model directory, so installed language models can be reused.
  Existing Tauri browser storage is separate: export/import a campaign to move
  it, including its asset files through the existing asset export workflow.

## Build and install

Build prerequisites: full UE 5.8 with C++ support, compatible MSVC/Windows SDK,
.NET Framework SDK, Rust, Node and pnpm. They are not required on a player's PC.
Set `UE_ROOT` if the engine is outside the Epic Launcher installation paths.

```powershell
pnpm unreal doctor
pnpm unreal package
pnpm smoke:unreal-app
pnpm unreal:installer
```

The native archive is `artifacts/unreal-package/Windows`. The installer is
`artifacts/installers/DnDRom-Unreal-0.2.1-x64-setup.exe`. It installs for the current
Windows user, supplies the VC++ prerequisite installer, and creates shortcuts and
an uninstaller. It does not include multi-gigabyte model weights: the app installs
required models when first requested. Keep the archive immutable while building
an installer from it. The normal shortcut does not enable CEF remote debugging.

Default app model/export directory: `%LOCALAPPDATA%/ai.dndrom.desktop`.
`-DnDRomData="D:/profile"` overrides it. For isolated native tests also supply
`-UserDir="D:/profile/user"` to separate Unreal/CEF saved data. Close the old client
before taking model ownership; the runtime lease prevents simultaneous ownership.
Uninstall removes only its recorded application files, leaving saved data/models.

Additional commands: `pnpm unreal prepare`, `build`, `build-game`, `host`, `editor`,
and `play --scene <file>`. The CLI exporter remains `pnpm unreal:export`.
`pnpm smoke:unreal --exe <exe>` runs the isolated legacy scene-import/collision
smoke. `node scripts/smoke-native-app.mjs --archive <installed folder>` tests the
actual installed UI, native scene, imports, camera, persistent storage and restart.

## Scene protocol v1

Extension: `.dndscene`. The root has `format: "dndrom.scene"`, `version: 1`,
`coordinates: "right-handed-y-up-metres"`, `name`, `source`, `meshes`, `instances`
and `warnings`. The source includes the original map and, when exported from a
campaign, a snapshot of the complete campaign. Keep this file local: it contains
the campaign data, not just its public presentation.

Mesh groups carry a stable ID, material role, collision flag and one to three
LODs with positions, normals, UVs, linear RGBA bytes and triangle indices.
Instances reference a group and carry entity ID, position, XYZW quaternion and
scale. Terrain vertex RGB channels are rock, snow and road masks instead of
albedo. Terrain keeps its authoritative grid resolution up to 257 samples/side;
there is no independent edge simplification in this import path.

Coordinates convert **once**, at import: `(x,y,z) metres â†’ (x,z,y) centimetres`.
Normals and scales swap Y/Z; quaternion conversion is `(-x,-z,-y,w)`. Triangle
winding changes from PlayCanvas counterclockwise to Unreal clockwise through
the axis reflection itself; index order stays unchanged. Tangents are rebuilt
from UV gradients, preserving normal-map orientation on trunks and roofs.
Instanced foliage placements are already world coordinates: subtract the parent
translation before applying its transform, matching the existing renderer.
Mesh-description color encoding compensates for Unreal's sRGB byte conversion
so shader inputs retain the exported linear color and terrain-mask bytes.

The native importer validates schema, finite numeric arrays, matching buffer
lengths, index ranges, quaternion norms and referenced IDs before replacing the
current scene. Preview limits are 128 MiB JSON, 20,000 mesh groups, 2 million
source vertices across LODs, 4 million source triangles and 1 million instances.
Mesh construction is scheduled between frames; one individual mesh build and
initial JSON parsing can still block a frame. This format is a migration bridge,
also used for bounded native atlas tile transfers. It is not a guarantee of
bounded peak RAM across all model and texture workloads.

Supported compiled geometry: authored heightfields, CGA buildings/assemblies,
clipped basin water, road/river ribbons, seeded tree bark and leaf clusters,
ground-cover placements and supported built-in primitive props. The embedded app additionally imports self-contained static GLBs and miniature
bind poses, custom material slots, and practical point/spot lights. The CLI has
no browser asset database and reports unavailable external assets explicitly.
Splats, skeletal animation, capsule/plane primitives and animated primitive
shaders still need native support; their source data remains preserved.

Current import limitations: tree collision, navmesh generation, source weather
application, advanced water shading and foliage wind are pending. The water preview is opaque PBR. Foliage cutouts have ordinary
UE mips, not yet the coverage-preserving chain used by the desktop renderer.
Grass uses a prototype color rather than a complete biome material profile.
Packaged complex terrain collision and semantic hit lookup are smoke-tested;
broader collision coverage and gameplay interaction remain pending.

## Runtime protocol v1

Launch `dndrom-runtime-host --data-dir <absolute directory>` with private stdin
and stdout pipes. Unreal also passes `--parent-pid <its PID>` for crash cleanup.
One UTF-8 JSON object per line; requests are processed serially. Maximum request
frame: 1 MiB, including unterminated input. Each request needs version `1`, a
nonempty ID up to 128 bytes, a method and optional params. Unknown top-level
fields and unsupported versions are rejected. Stdout contains protocol only.

```json
{"version":1,"id":"hello","method":"system.hello"}
{"version":1,"id":"status","method":"runtime.status","params":{"feature":"languageModel"}}
{"version":1,"id":"prepare","method":"runtime.ensure","params":{"feature":"languageModel","vramReserveGb":4}}
{"version":1,"id":"release","method":"runtime.release"}
```

Methods: `system.hello`, `runtime.status`, `runtime.ensure`, `runtime.restart`,
`runtime.release`, `rules.roll`. Rule params use `dndrom_domain::CheckRequest`.
Feature names match the shared `RuntimeFeature` enum. Successful responses have
`ok: true, result`; errors have `ok: false, error`. Preparation events contain
`event: "runtime.progress", data` and the same request ID. This channel owns
model lifecycle; it is not yet the native AI DM or world-generation interface.

The host defaults to 4 GiB of requested GPU headroom. The shared language launcher
now passes the reservation to llama.cpp's fit target, and the creation engine
uses its existing reserve-VRAM setting. These are heuristics, **not a VRAM cap**.
Changing reservation on a running model requires restart. `runtime.release`
stops owned models and replaces the closed process job so later requests can
start again. Calls are serialized, but switching runtime features does not yet
enforce exclusive GPU residency; the memory scheduler remains required.

## Validation and remaining work

Current evidence is stored under `artifacts/`, not inferred from source checks:

- `native-tests.log`: 27 focused tests across exporter, GLB, world atlas, local
  language, streamed audio and persistence; TypeScript build/typecheck passed.
- `native-rust-tests.log`: 18 shared runtime/host unit and process tests passed.
- `native-speech-smoke/report.json`: real local CPU transcription of the public
  JFK sample, approximately 0.7 seconds for eleven seconds of prerecorded audio.
- `native-local-generation.json`: a local Qwen request for an ancient Chinese
  mountain village completed Quick generation and produced 616 editable objects.
  Native import had 126 groups, 67,474 instances, 278,069 prototype LOD0 triangles,
  zero missing materials and zero vertex-color mismatches. Publication was exercised.
- `native-app-smoke-2/report.json`: packaged authoring UI, geometry/materials,
  camera input, export path validation, invalid-scene preservation and persistent
  restart checks passed. Later release smoke reports supersede this snapshot.
- `native-installed-final/report.json`: all 15 checks passed on the actual
  installer output, including catalogue tabs, window/panel dragging, readable
  labels, persisted panel sizes, material loading and clean restart.
- `native-installed-byte-verification.json`: nine critical installed files
  match the archive. `native-final-uninstall-verification.json` confirms removal
  of application files, shortcuts and registration while preserving CEF data.
  The uninstaller also refused removal while the application was running.
- `unreal-native-build.json` records the final installer hash and evidence paths.
- `unreal-smoke/`: isolated native collision, geometry, material, memory and
  screenshot checks. The tested PC is an RTX 3080 10 GB with 32 GB RAM.

This is a usable native migration build, not visual/gameplay parity with every
legacy renderer feature. Character/prop/dice forge previews still use PlayCanvas
inside the embedded interface. Animated GLB skins, custom triplanar projection,
coverage-preserving runtime texture mips, advanced placement/snapping, native
fog-of-war, navigation, weather, detailed water, foliage wind and complete distant
roads/rivers/settlements remain incomplete. Streaming still needs traversal and
visual polish, including boundary transitions and the desired outward fog reveal.
The obsolete splat creation workflow is hidden in the native scene forge.

Runtime-generated meshes use conventional LODs; `BuildFromMeshDescriptions` does
not generate Nanite clusters. Enabling Nanite in project settings is not evidence
that arbitrary generated geometry is Nanite. Image-to-editable-world accuracy,
multiplayer native parity, physical microphone input and the 8 GB/16 GB concurrent
AI/rendering memory budget need dedicated acceptance runs. Scene size, shader
warmup and one large mesh build can still cause frame stalls. Runtime textures
and simultaneous AI backends need further memory scheduling.

References: [Unreal runtime mesh build parameters](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UStaticMesh/FBuildMeshDescriptionsParams),
[material authoring API](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/MaterialEditingLibrary),
[whisper.cpp server](https://github.com/ggml-org/whisper.cpp/blob/master/examples/server/README.md),
[UE 5.8 exposure changes](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-5-8-release-notes).


Native viewport navigation (0.2.1): middle mouse orbits a stable target;
Shift + middle mouse pans in the view plane; wheel or Ctrl + middle mouse
zooms. Home frames the local scene while the viewport has focus. Right mouse
with WASD and Q/E retains free flight (Shift speeds it up). Camera gestures
never place props. The native smoke test dispatches actual browser mouse and
keyboard events and checks camera/target invariants.

Blueprint planning uses constrained creative output, with engine IDs, seeds,
region dimensions and streaming bookkeeping supplied locally. Invalid JSON or explicit request constraints receive one bounded repair
attempt; zone IDs and connected routes are computed locally. Failure presents a short fallback notice and logs diagnostic details.


## Terrain update 0.2.2

Generator revision 22 adapts the reference particle hydrology with stream
momentum and per-step avalanching, renders the evolved fields at near/far LODs,
and uses world-space stochastic PBR sampling with triplanar cliff projection.
Local-to-regional terrain joins no longer amplify road-bank slopes into walls.
Native tile replacement retains visibility until the new mesh is complete.
See [terrain reference notes](TERRAIN_REFERENCE_IMPLEMENTATION.md) for the
algorithm, source attribution, validation and remaining limitations. Existing
persisted local terrain needs regeneration; streamed terrain uses the new code.
