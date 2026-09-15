# Underwater camera optics and world reveal

An underwater camera should preserve a coherent three-dimensional scene. Close objects retain detail, distant objects lose contrast, the surface bends the view of the sky, and the underside reflects the submerged surroundings. A flat color overlay cannot establish these relationships. The camera must distinguish the distance to geometry from the distance to the air-water interface and integrate attenuation over the part of the ray that actually travels through water.

For a local fantasy tabletop renderer, the recommended system combines the existing Single Layer Water surface with a separate underwater camera pass, the same displacement field on both sides of the interface, and bounded environment information for directions outside the screen. Epic's water system also treats the underwater transition as a dedicated post-process responsibility. Its documented activation includes a narrow band above the nominal surface to accommodate waves.[^1]

Loading fog serves a different purpose. It conceals unavailable world geometry and then relinquishes control to the ordinary atmosphere. Its completion condition must come from acknowledged native geometry, not elapsed time or a worker finishing serialization. Underwater optics remain active while the camera is submerged; reveal fog must finish once selected world coverage is ready.

The implementation priorities are optical continuity, deterministic loading state, and bounded cost. Full spectral transport, continuously updated six-view reflections, and a hardware ray-tracing requirement are outside this baseline. The target remains an 8 GB VRAM / 16 GB RAM gaming PC; performance on that configuration requires separate representative testing.

---

## Refraction and the view of the sky

Water is a dielectric interface with a representative visible-light refractive index of 1.333, compared with approximately one for air. Snell's law determines the transmitted direction, while the Fresnel equations determine the reflected fraction. These are separate calculations: a distorted lookup alone does not determine how much sky should remain visible.[^2]

Using those indices, the critical angle for a water-to-air ray is approximately 48.6 degrees from the surface normal. This is a calculation from the cited refractive indices, not a measured property of this renderer. The visible sky therefore occupies a cone approximately 97.2 degrees across for a flat interface. Waves perturb the local normal and deform this window. Beyond the critical angle, total internal reflection replaces transmission; distant mountains must not remain directly visible through that part of the surface.[^2]

Use exact unpolarized dielectric Fresnel near the critical angle. A simple fifth-power approximation with a separate broad threshold can create a conspicuous ring. Antialias the transition narrowly and keep the normal derived from the accepted wave field. Do not draw a decorative circular mask in screen coordinates: the correct shape follows view direction, camera pitch, and wave normals.

A test camera should look vertically up, diagonally up, and nearly horizontally at the same location. The sky window must move consistently with camera orientation. The surrounding reflected field should contain plausible seabed or submerged geometry, rather than a uniform cyan fill or a stretched copy of screen edges.

---

## Visibility, absorption and scattering

Beam transmittance in a homogeneous participating medium follows exponential attenuation. For the real-time RGB approximation, each channel uses T = exp(-sigma × distance). Extinction combines absorption and out-scattering; the displayed result also needs an in-scattered contribution. Multiplying scene color by a blue tint omits this second term and does not reproduce distance-dependent loss of contrast.[^3]

Use a compact model C = T × Cscene + (1 - T) × Cwater. This is an engineering approximation with a spatially uniform source term, not a full solution of the radiative-transfer equation. Nearby receivers should retain their source contrast. The source term should fall with camera depth and available illumination; it should not act as a bright emissive cyan wall at night.

Natural water does not have one universal blue-green absorption setting. Laboratory optical properties of pure water differ from the behavior of water containing dissolved and suspended material. Buiteveld, Hakvoort and Donze's measurements and formulations provide a pure-water reference, including temperature dependence; they do not justify treating every harbor and freshwater lake identically.[^4]

For this release, clear and coastal coefficients are explicitly appearance parameters in inverse metres. Future world data should carry turbidity, dissolved color and suspended sediment independently of biome labels. A cold lake can be clear or turbid; a tropical coast can also vary substantially. The first acceptance requirement is continuity and readable depth, with more elaborate water chemistry reserved for a subsequent controlled extension.

---

## Rays, geometry and the waterline

The camera must classify submerged ray segments using the local water field. A camera below sea level is not necessarily underwater: it may be in a dry depression, cave or building. The native water sampler therefore checks actual registered fields and wet depth before enabling the optical pass. The shader then resolves the displaced interface rather than switching the whole screen at the mean water elevation.

Epic describes partial underwater views as a material mask over the parts of the scene that are submerged. Its implementation activates near the surface to accommodate crests and troughs.[^1] For the custom procedural mesh, the equivalent approach is to share the displacement function with the camera pass and refine the upward ray's surface intersection. An intersection on a dry bank must not be mistaken for an exit into air through water.

Depth reconstruction must remain finite. Sky depth can correspond to an effectively infinite world position. Evaluating procedural sine fields, derivatives or normal reconstruction at that position creates precision artifacts. Use a normalized camera ray and bounded depth instead. Apply receiver-space caustics only to valid submerged geometry; a sky pixel is not a seabed receiver.

Validation should sweep slowly through the waterline in both directions, orbit while submerged, and move along a sloping shore. The seabed must occlude the background normally. Camera collision belongs to the existing terrain/navigation system and must remain independent of water-volume activation; water should not be made physically solid merely to simplify the transition.

---

## Reflections beyond the screen

Screen-space sampling has a hard information limit: it cannot reveal geometry that was never rendered into the current view. Projecting a reflected direction into the scene-color buffer is also insufficient for nearby objects because it omits the reflected ray's origin and intersection depth. It can pick unrelated receivers and produce stretched horizontal fragments.

The chosen baseline uses a small HDR environment capture for offscreen reflected directions. Sky refraction retains bounded screen sampling, with undistorted scene color as its offscreen fallback. Unreal provides a cube scene-capture component with explicit capture control; its documentation warns against requesting an immediate capture while automatic every-frame capture is also enabled.[^5] The implementation disables automatic capture, keeps world orientation fixed, and refreshes on a bounded cadence rather than on camera rotation.

At 128 × 128 texels, six faces and eight bytes per RGBA16F texel, the base texture storage is 786,432 bytes, or 0.75 MiB. This is a calculated texture allocation only. It excludes scene-capture render targets, renderer state and GPU work. Six views can still be expensive even when their output texture is small, so capture spikes must be measured separately from steady frame time.

A cube capture is an approximation to spatially varying reflections. It supplies directional information at the capture point but cannot exactly reproduce parallax for every surface point. The reflection fallback omits the view-dependent volumetric-cloud pass. Captured sky is not used for refraction because atmosphere seams remained visible; screen refraction retains clouds where coverage permits. Close geometry remains a candidate for a later depth-validated screen-space trace. The current correction prioritizes a stable underside without imposing hardware ray tracing or continuously rendering six additional views; exact offscreen sky refraction remains a limitation.

---

## Unreal composition and exposure

Single Layer Water already contributes absorption, scattering, refraction and reflection in its own renderer pass. Epic documents that this pass uses the lit scene and depth and executes before conventional translucency and post-processing.[^6] Preserve it for the accepted above-water surface. Treat the underwater camera as the complementary inside-volume view, avoiding a second above-water attenuation over the same segment.

Exposure must be audited against the installed renderer, not inferred from the numeric size of a lighting parameter. Epic explains pre-exposure as remapping scene radiance around the previous frame's camera exposure before storing scene color.[^7] In the installed UE 5.8 MaterialTemplate shader, the material-facing SceneTextureLookup overload conditionally removes pre-exposure for post-process inputs before tonemapping. Adding another compensating multiplier would therefore be incorrect for that path.

The implementation keeps the HDR underwater pass before bloom and the reveal composite after tonemapping. The environment capture uses HDR scene color with the capture's post-processing disabled, so it does not recursively capture the underwater optical pass. The accepted surface material, foam history and shoreline displacement retain their existing equations.

The renderer still needs visual checks under daylight, low light and mixed surface/submerged views. A material compiling successfully proves neither exposure compatibility nor acceptable color. Image review must check that close rocks and the seabed remain readable, highlights are controlled, and entering the water does not abruptly change the entire sky or leave a persistent loading overlay.

---

## Caustics and wave agreement

Caustics arise when curved reflective or refractive surfaces concentrate light on receivers. NVIDIA's GPU Gems chapter presents a deliberately approximate procedural method and explicitly distinguishes visual plausibility from accurate photon transport.[^8] This distinction matters: a moving pattern is not automatically a physically correct caustic solution.

For the current procedural water, keep the normal and curvature derivatives tied to the accepted wave field. Bright concentrations should appear as moving, connected focal structures on submerged receivers. Their spacing and motion should change coherently with that field. A tiled array of dots or a fixed checker pattern is not an acceptable substitute. Filter the focusing estimate by pixel footprint and limit the singularity so it does not produce flickering, unbounded highlights.

Receiver validity also matters. Restrict the effect to water-covered, shallow surfaces with an appropriate orientation and available sunlight. Do not project it indiscriminately on the sky, dry terrain, or deep water. Epic notes that Single Layer Water's Color Scale Behind Water is an above-surface compositing effect; it does not physically illuminate underwater receivers when the camera moves below the surface.[^6] A separate submerged receiver calculation is therefore necessary in this architecture.

NVIDIA's later ray-guided caustic implementation uses cascaded caustic maps and GPU ray tracing, with reported costs dependent on GPU and scene.[^9] Those results establish a possible future quality tier, not a performance guarantee for stock UE 5.8 or this minimum machine. Retaining the accepted approximation is the lower-risk baseline while correcting the underwater view.

---

## Loading fog and tile coverage

Atmospheric fog and loading concealment have different success criteria. Ordinary fog can remain translucent and view dependent. A loading mask must prevent visibility of missing terrain, unfinished foliage and incomplete buildings. Epic's volumetric-fog documentation describes camera-relative volume resolution and a view-distance quality tradeoff; increasing the distance alone does not establish a reliable loading boundary.[^10]

The reveal system should expand from the scene's fixed origin through completed coverage. The native renderer's ready acknowledgement must include completed mesh and instance import. A generated JSON payload or a coarse parent tile is insufficient when detailed descendants still contain the foliage and settlement that will become visible next.

The revised transaction couples visible tile IDs and reveal radius. It does not uncover a desired leaf that remains hidden under an ancestor. The last covering parent remains resident until all necessary replacements can be shown. Completion refers to the selected surrounding coverage, not an impossible generation of the entire infinite world. Once complete, the reveal opacity fades to zero and the pass is disabled.

The fog field uses bounded rays and a finite vertical region. Sky rays receive only distant horizon concealment, preserving the upper sky. Ready geometry determines the front; noise shapes the fog without opening holes beyond it. A new scene identity resets reveal state. Camera rotation and periodic visibility messages do not restart the completed effect, and updates from an older stream identity cannot finish a newly loading scene.

---

## Acceptance and practical limits

The optical fixture should include shallow sloping terrain, a recognizable submerged receiver, a bright sky and a displaced waterline. Capture matched views above water, below looking down, below looking up, near the horizon, at the waterline and after emerging. Look for retained geometry, a coherent sky window, stable underside reflections and continuity of the original above-water waves and foam.

The loading fixture should pause incomplete coverage, introduce tiles while the front is held, then acknowledge completion. Its diagnostics must show the fog remaining active while work is missing and reaching zero opacity afterward. Repeat visibility updates, rotate the camera and submit a stale identity to verify that none restarts or incorrectly completes the reveal. Repeat with the native streamer to test the full path, not just direct reveal commands.

Unit checks should cover empty coverage sets, partially ready descendants, coarse-only ancestors and complete desired selections. Existing terrain-seam, water-field and foam-history regressions remain part of the release gate. A full material cook is required: stale generated Unreal materials can otherwise conceal a shader-source change in a packaged test.

Known limits remain explicit. The environment cube has limited angular resolution and approximate parallax. Caustics are a bounded appearance model rather than photon tracing. Capture refreshes can create transient GPU costs and require profiling on a complex world. The 1080p / 30 FPS minimum-hardware target with local AI active remains unverified until measured on representative hardware. Test results and installer hashes belong in the release notes, separate from the underlying optical evidence.

---

## Sources

[^1]: Epic Games. [Water Meshing System and Surface Rendering](https://dev.epicgames.com/documentation/en-us/unreal-engine/water-meshing-system-and-surface-rendering-in-unreal-engine), UE 5.8 documentation, accessed September 10, 2026.

[^2]: Matt Pharr, Wenzel Jakob and Greg Humphreys. [Specular Reflection and Transmission](https://www.pbr-book.org/4ed/Reflection_Models/Specular_Reflection_and_Transmission), Physically Based Rendering, fourth edition, 2023.

[^3]: Matt Pharr, Wenzel Jakob and Greg Humphreys. [Transmittance](https://pbr-book.org/4ed/Volume_Scattering/Transmittance), Physically Based Rendering, fourth edition, 2023.

[^4]: H. Buiteveld, J. H. M. Hakvoort and M. Donze. [The Optical Properties of Pure Water](https://omlc.org/spectra/water/abs/buiteveld94.html), Ocean Optics XII, 1994; abstract hosted by Oregon Medical Laser Center.

[^5]: Epic Games. [USceneCaptureComponentCube](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/USceneCaptureComponentCube), UE 5.8 API reference, accessed September 10, 2026.

[^6]: Epic Games. [Single Layer Water Shading Model](https://dev.epicgames.com/documentation/unreal-engine/single-layer-water-shading-model-in-unreal-engine), UE 5.8 documentation, accessed September 10, 2026.

[^7]: Epic Games. [Auto Exposure](https://dev.epicgames.com/documentation/en-us/unreal-engine/auto-exposure-in-unreal-engine), UE 5.8 documentation, accessed September 10, 2026. Implementation cross-check: installed UE 5.8 MaterialTemplate.ush, SceneTextureLookup overload accepting FMaterialPixelParameters.

[^8]: Juan Guardado and Daniel Sanchez-Crespo. [Rendering Water Caustics](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-2-rendering-water-caustics), GPU Gems, chapter 2, 2004.

[^9]: NVIDIA. [Generating Ray-Traced Caustic Effects in Unreal Engine 4, Part 2](https://developer.nvidia.com/blog/generating-ray-traced-caustic-effects-in-unreal-engine-4-part-2/), December 2020. Findings apply to the described NVRTX implementation and test scenes.

[^10]: Epic Games. [Volumetric Fog](https://dev.epicgames.com/documentation/en-us/unreal-engine/volumetric-fog-in-unreal-engine), UE 5.8 documentation, accessed September 10, 2026.
