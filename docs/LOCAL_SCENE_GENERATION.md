# Local scene generation and speak mode

Open **Scene**, describe a world, then select **Generate scene**. The local language model plans terrain and zones, authors construction recipes, and repairs weak structural recipes. The procedural worker builds terrain, routes, vegetation, buildings and focal assemblies. The scene appears before optional image and mesh generation finishes. **Publish base world** adds the draft as a new campaign scene.

The **Quick** profile uses procedural surfaces. **Complete** also generates coordinated surfaces and requested props through the local ComfyUI runtime. An unavailable art runtime leaves the built scene available, with a visible error and a separate retry through **Art direction & custom props**.

## Architecture rather than cultural presets

The model writes a validated construction grammar, not JavaScript. It can combine boxes, cylinders, spheres, cones, curved roofs and structural frames. Frames expand dimensions, bay counts, levels and openness into connected columns, beams, floors and walls with an entrance. Repetition, rotation, palette and placement remain model-controlled. Frames and roof curvature are construction operations shared across styles, not a list of named village presets.

Recipes are bounded to 384 expanded parts, and geometry is merged by five semantic surface roles. Settlement recipes fit their parcels. Placement bounds account for rotated parts; vegetation is cleared around structures. The compiled geometry is stored in the scene so playback does not require another inference call.

Examples:

- “A ruined village deep in an old-growth forest, with broken walls, exposed timber and an open route through the settlement.”
- “An ancient Chinese village with timber courtyard houses, curved jade-tile roofs, a ceremonial gate and a shrine beside a bamboo grove.”
- “A settlement of giant mushroom pavilions connected by raised wooden walkways.”

These are open-ended model inputs. Quality depends on the selected local model; schema validity does not establish architectural authenticity or visual quality. The current renderer produces editable stylized geometry. It does not guarantee production-quality geometry for every imaginable subject.

## Surface references and props

In **Art direction & custom props**, enter the new art direction and optionally supply up to three PNG, JPEG or WebP references. A local vision-capable chat model can interpret the actual images. Each reference is also uploaded directly to local ComfyUI and encoded into the image sampler's latent input. A text-only model failure is reported; reference conditioning can still run.

The pipeline generates distinct ground, masonry, timber, roof and foliage albedos, then derives normal, roughness, metallic and ambient-occlusion maps. These derived maps are useful approximations from image contrast and material class, not recovered physical geometry. Surface bindings apply across the scene without changing placements. **Undo style** restores the in-memory scene before the current styling pass. Completed materials remain in the local library if a later stage fails.

Explicitly requested props are generated as isolated images and passed to the bundled Pixal3D workflow, imported as GLB assets, and placed in the scene. Image and mesh work run sequentially. This requires the relevant local image and 3D model packs and executable ComfyUI nodes.

Completed and cancelled art jobs release their cached ComfyUI model weights so the next language-model request has room on the GPU. Other applications holding GPU memory can still slow local inference. Terrain planning has a three-minute deadline and reports a procedural fallback if the model cannot finish.

## Local inference setup

- Desktop defaults to the app-managed language runtime. **Session > Local AI > Prepare local language model** provisions the pinned llama.cpp runtime and Qwen model; the app owns its process and lifetime. A separate Ollama installation is not required. External loopback endpoints are an explicit advanced option. The bundled Qwen model is text-only; image interpretation requires a compatible local vision model.
- The desktop app uses its managed ComfyUI runtime for Sana/Krea image generation and Pixal3D. Browser development uses the configured loopback ComfyUI endpoint. Model installation may need an initial download; inference and reference processing stay on the machine.

The Sana pack uses the [MIT HAN Lab Diffusers-format DC-AE decoder](https://huggingface.co/mit-han-lab/dc-ae-f32c32-sana-1.1-diffusers), matching its loader. Older packs used the original-format weights, which have incompatible parameter names. Setup verifies the replacement checksum and corrects the Sana extension's initial device metadata before startup. Gemma text encoding uses CPU memory so its weights do not crowd diffusion and the scene renderer out of a small GPU. Restart an already-running local runtime after updating an older pack.
- Configure **Local Whisper endpoint**, for example `http://127.0.0.1:8081/inference`. The endpoint must accept multipart 16 kHz mono PCM WAV. Both whisper.cpp `/inference` and compatible `/audio/transcriptions` routes are supported.
- For spoken replies, configure a Kokoro-compatible local speech endpoint such as `http://127.0.0.1:8880/v1` and a voice identifier. Without that endpoint, only an installed browser voice marked `localService` is eligible; there is no network-voice fallback.

The scene and speech clients reject non-loopback endpoints and redirects. Existing optional online asset-library and hosted Prop Forge routes are separate features, not used by this scene pipeline.

## Speak mode

Scene **Speak mode** captures the microphone through an AudioWorklet. Voice activity detection emits cumulative audio chunks about every 1.2 seconds, limits each segment to eight seconds, and closes an utterance after approximately 550 ms of silence. Transcription starts before speech ends. Obsolete partial jobs are coalesced, while completed phrases are retained when inference is slower than a pause.

In Scene, partial text updates the description and the completed utterance starts generation. Speaking again cancels that generation and accepts a replacement description. In the DM panel, completed utterances become player actions; streamed narration sentences are synthesized locally while earlier audio plays. Speaking interrupts narration and pending synthesis.

This is chunked local transcription, not token streaming from whisper.cpp. First response latency includes voice-activity delay and local ASR/model inference. “Instant” response is not guaranteed, especially when scene rendering and AI share a GPU. Enable echo cancellation or use headphones to avoid narration re-entering the microphone.

## Persistence and verification

Large campaign snapshots use IndexedDB once they exceed the small localStorage budget. The pointer is switched after a complete snapshot commits; older localStorage saves remain readable. Startup waits for a large snapshot to hydrate. A save failure is visible and preserves the prior committed snapshot.

Validation commands:

```powershell
pnpm.cmd typecheck
pnpm.cmd test:web
pnpm.cmd --filter @dndrom/desktop tauri build --no-bundle
```

`scripts/verify-scene-director.mjs` exercises an already-running local chat model and writes a generated world under ignored `artifacts/`. `scripts/verify-scene-material.mjs` exercises the actual bundled Sana workflow against local ComfyUI. `scripts/smoke-scene-forge.mjs` renders the generated fixture in an isolated native WebView profile against the local Vite server, checks scene reload, and optionally applies a surface supplied by `DNDROM_SCENE_SURFACE`.

Unit tests cover construction bounds, local routing, reference graph wiring, material/mesh stage ordering, cancellation, speech chunk boundaries, overlapping synthesis/playback, and large-save failure/retry. Microphone acoustics, sustained voice latency and generated mesh quality require testing with the installed speech and 3D runtimes on the target hardware.

## World streaming implementation checkpoint

The renderer now requests a sparse quadtree around the camera through a dedicated terrain worker. It keeps coarse terrain until replacement children are available, interpolates child heights from the parent triangle surface, and uses skirts at LOD boundaries. Mesh vertices are relative to tile centres. The worker queue is limited to four requests; mesh uploads are limited to two tiles and a four-millisecond scheduling budget per frame. The resident tile cache has a 1,024-entry cap. A single upload or prototype construction can exceed the scheduling budget; it is not a measured frame-time guarantee.

The terrain sampler extends outside the compiled region with seeded ridges, climate fields and biome-dependent canopy placement. Forest candidate cells remain identical when a tile subdivides. Canopy and understory prototypes are instanced, including forests in streamed terrain; the renderer retains at most 96 cached tree meshes/prototype-LOD entries. Coarse remote tiles use terrain colour instead of individual plants. This reduces object and geometry duplication; it does not establish a million-assets performance result.

A depth-aware, animated volumetric reveal is integrated into CameraFrame's compose shaders for both WebGPU and WebGL. The opening remains within presented authored chunks and waits for distant coverage. It can move with exploration and closes over a teleport while terrain becomes ready. Presentation readiness is separate from gameplay fog-of-war. Authored geometry is prepared through the upload callback and marked presented after the frame ends. Interior maps keep their existing rendering path.

Hydraulic particles now use continuous positions, bilinear gradients, bilinear erosion/deposition and conservative terminal sediment deposition. Roads use sixteen travel directions with heading, grade and water costs; cached edge costs keep the search practical. Rendering, terrain grading and vegetation clearance consume the same road curve. These are bounded regional simulations, not a global watershed solver.

**Sky & weather** controls persist time, clouds, precipitation state and wind with the map. Local AI blueprints may supply the same validated fields. The sun, clouds, terrain wetness/snow and vegetation wind consume that shared state. Precipitation currently changes cloud and surface state; rain/snow particles, shelter accumulation and seasonal ecology remain unfinished. Snow cover uses temperature/elevation instead of the previous five-metre threshold.

Settlement access uses generated facade doors for CGA buildings. Decorative travel silhouettes are not enterable buildings. Story markers retain their quest IDs and use floor anchors. Arbitrary AI assemblies currently infer access from a floor and roof; complete room/portal/stair validation is still needed.

### Visual corrections in 0.1.2

Generation revision 20 validates expanded, scaled, rotated building footprints against water, road shoulders, other buildings and ground support. Failed parcels are relocated deterministically or reported in validation warnings. Vegetation and dressing share the exclusion surface. Travel silhouettes fit each house to a dry parcel. Existing saved geometry needs regeneration to receive these placement corrections.

The atlas now uses the same triplanar materials and persisted edge weights as detailed terrain, blending into regional geology over 96 metres. Alpine exposure limits grass and trees, with stronger ridge relief and irregular rock normals. Instanced ground cover extends across the authored boundary and shrinks gradually between 35 and 70 metres from the camera. Road routing adds bank clearance and flow-direction penalties, and rejects smoothing that lengthens water crossings. Persisted road weights are zero on wet field samples, and bridge flags survive conversion to terrain paint.

### Remaining work

- Native visual verification resumed with user authorization. The river-village fixture has dry building footprints and no WebGPU shader/runtime errors; this is a targeted regression check, not unrestricted scene-quality acceptance.
- Travel locations still use a compressed regional layout. The expanding terrain sampler does not yet provide a shared physical-coordinate world graph, cross-region hydrology, persistent distant settlement generation, or a complete floating-origin transform for all gameplay objects.
- Fine vegetation promotion and diverse biome/weather combinations still need broader visual evaluation. The current smoke scene does not establish quality or frame-time guarantees for every generated world.
- The compiler still completes and validates a region before publishing its final map. Incremental compilation publication, beyond render-time upload/reveal, remains unfinished.
- Speech clients remain local and chunked, but speech runtime provisioning still needs to join app-managed setup. VRAM scheduling between language, image, speech and rendering needs further work.
- Reference-derived normal/roughness maps remain approximations. A physically coherent material graph, richer architecture/plant grammars and unrestricted subject quality are not complete.
