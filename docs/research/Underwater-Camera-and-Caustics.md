# Camera, underwater optics and scene navigation

Research and implementation notes, 9 September 2026. Scope: the existing custom UE 5.8 water renderer, local planning and shared-world scene navigation. The accepted shoreline displacement, foam history and above-water material remain authoritative.

## Findings

Epic treats surface rendering and underwater post processing as separate parts of its Water system. The underwater pass activates within a water body's bounds near the surface and masks the transition through the waterline. A custom Single Layer Water mesh does not acquire that behavior automatically. Our renderer therefore needs water-bound camera detection and a separate post-process material, rather than changing the accepted surface shader.[1]

The air/water interface must behave differently from below: Fresnel reflection increases at grazing angles, and refraction ceases beyond the critical angle. Using water's approximate refractive index of 1.333 gives a critical angle of approximately 48.6 degrees from the normal. This creates the bright overhead region commonly called Snell's window. Waves change the local normal, distorting its boundary. These optical relationships follow the dielectric reflection/refraction treatment in PBRT; the implementation here approximates scene sampling in screen space.[2]

Caustics are focused illumination on submerged receivers produced by refraction at the moving surface. NVIDIA's GPU Gems chapter describes real-time approximations that evaluate the wave field and project focused illumination onto receiving geometry. It explicitly targets plausible appearance rather than a complete light-transport simulation. This supports using the same evolving wave derivatives for our normals and caustic folds, with depth attenuation and filtering, rather than overlaying an unrelated repeating texture.[3]

NVIDIA's later ray-traced water-caustics implementation uses specialized photon generation and reconstruction methods. Its measured costs belong to that implementation and hardware; they do not establish a budget for stock UE 5.8 or this app. Requiring that path would conflict with delivering the current renderer on the 8 GB VRAM target without representative benchmarks.[4]

Camera response is a separate issue. The checkout applied orbit deltas directly on browser bridge arrivals, with a 30 Hz browser and one outstanding request. Held-key travel time was discarded while waiting for acknowledgement. No collision sweep protected the resulting position. The change accumulates input, keeps ordered bounded delivery, and interpolates camera movement on the engine tick. Motion blur is explicitly disabled. Temporal reconstruction can still soften moving foliage; fixing input cadence does not prove that all frame stalls have disappeared. Epic's TSR documentation describes temporal reconstruction and the importance of correct motion information.[5]

## Implementation choices

- Water detection samples the finest visible authoritative field, using the same triangle interpolation as the renderer. Hidden and pending tiles cannot activate underwater rendering. Signed water depth is not used as a terrain collision height because its export is intentionally clamped.
- The underwater pass evaluates camera immersion against the shared shoreline wave equation, applies wavelength-dependent exponential attenuation along the submerged viewing segment, and adds scattering. Above-water rendering bypasses the pass.
- Upward rays intersect the water surface. Wave normals determine the refracted direction, Fresnel term and critical-angle boundary. Refraction and reflection use available screen coverage; rays outside that coverage use a bounded water-color fallback. This is not ray-traced reflection and cannot recover arbitrary offscreen objects.
- Shallow receiver caustics use the existing capillary-wave Hessian, not a new unrelated animation. The fold width is filtered by pixel derivatives. Depth and sunlight reduce the effect. Object-level caustic shadowing and arbitrary multiple refraction remain limitations.
- A camera sphere sweep protects against native collidable terrain and structures. A CPU triangle-height query also protects against distant terrain whose render LOD deliberately has no Chaos collision. Water remains traversable; the seabed remains solid. This follows the purpose of Epic's camera-probe collision pattern, without replacing the existing Blender-style controller with a spring arm.[6]
- Runtime preparation, streamed model activity, terrain search and scene construction are distinct progress stages. Model planning has one three-minute deadline across repair attempts after runtime preparation. Character counts show activity, not private reasoning or an invented completion percentage.
- World scenes lists accepted locations, pending requests, cached detail and road/ferry connections. Opening a location uses the existing shared-world service and leaves the current scene available during generation. Cancellation does not accept incomplete geography.

## Validation requirements and limits

Verify native packaged rendering from above, below looking down, below looking up, and through the waterline. Compare surface foam against the accepted scene. Rotate using actual browser pointer events and inspect engine-frame samples; teleport-only screenshots cannot establish smooth input. Attempt downward movement into both local and coarse terrain. Check scene-list navigation and cancellation independently of render screenshots.

The minimum target remains 1080p at 30 FPS on 8 GB VRAM / 16 GB RAM with local AI active, **unverified** until measured on representative hardware. Test receipts and captures are recorded separately in the delivery report. A bounded screen-space optical approximation is the current choice, not a claim of physically complete water simulation.

## Sources

1. Epic Games, [Water Meshing System and Surface Rendering](https://dev.epicgames.com/documentation/en-us/unreal-engine/water-meshing-system-and-surface-rendering-in-unreal-engine), UE 5.8, accessed 9 September 2026.
2. Pharr, Jakob and Humphreys, [Dielectric BSDF](https://pbr-book.org/4ed/Reflection_Models/Dielectric_BSDF), *Physically Based Rendering*, fourth edition.
3. Guardado and Sánchez-Crespo, [Rendering Water Caustics](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-2-rendering-water-caustics), *GPU Gems*, chapter 2, 2004.
4. NVIDIA, [Generating Ray-Traced Caustic Effects in Unreal Engine 4, Part 2](https://developer.nvidia.com/blog/generating-ray-traced-caustic-effects-in-unreal-engine-4-part-2/), 2020.
5. Epic Games, [Temporal Super Resolution](https://dev.epicgames.com/documentation/en-us/unreal-engine/temporal-super-resolution-in-unreal-engine), UE 5.8.
6. Epic Games, [USpringArmComponent](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/USpringArmComponent), UE 5.8 API; installed engine headers used to verify the current collision and material APIs.
