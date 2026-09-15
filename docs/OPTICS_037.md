# DnDRom 0.3.7: reveal fog and underwater camera

Loading fog now advances only through the selected native detail that is included in the visibility transaction. Coarse placeholders cannot prematurely uncover unfinished foliage or buildings. The local reveal begins after all local import parts are ready. Completion fades the reveal pass out over 2.5 seconds and disables it; later streaming updates and camera rotation do not restart it. A separate scene identity resets the effect, while stale reveal updates are rejected.

The fog shader uses finite camera rays, a bounded height volume and matching integration for terrain and the sky horizon. It no longer evaluates procedural noise at infinite sky positions. Upper-sky masking leaves the sky readable, and fixed integration steps prevent missing terrain from creating a differently colored edge in the fog.

The underwater camera now uses finite depth reconstruction, refined wave intersection, dielectric Fresnel and a small HDR environment capture for offscreen reflections. Sky refraction retains the established screen-space path, falling back to undistorted scene color when a refracted direction is outside the screen. It retains nearby receiver detail and applies distance-dependent RGB attenuation. The environment texture uses 0.75 MiB before renderer overhead. Captures are disabled above water and refresh at most once every two seconds after sufficient translation, or every ten seconds while submerged. Rotating the camera alone does not request a new capture.

The environment fallback omits volumetric clouds because their capture history produced cube-face seams. Screen-space refraction retains visible clouds. Reflections have approximate parallax and limited angular resolution; this is not full ray-traced underwater transport. Caustics remain the accepted bounded wave-curvature approximation. Above-water waves, shoreline foam, hydraulic erosion, settlement surfaces and campaign serialization are unchanged.

## Installation and data

Install `artifacts/installers/DnDRom-Unreal-0.3.7-x64-setup.exe` after closing DnDRom. This release changes rendering and scheduling, with no campaign schema migration and no requirement to rebuild existing worlds. All validation uses isolated profiles. The 0.3.6 installer remains available for rollback and is checked against its previous SHA-256 during package verification.

## Validation

- Production TypeScript/Vite build and native Unreal build/cook completed.
- 31 tests across eight files passed: reveal readiness, atlas visibility, terrain continuity, native chunk seams, atlas water, shoreline fields, native water fields and viewport behavior.
- All 26 packaged-app checks passed against the extracted 0.3.7 installer, including native import, custom materials, invalid-input rejection, campaign persistence, window state, graceful restart and no native crashes/ensures.
- Controlled native captures exercise delayed tile addition behind fog, completed-fog shutdown, repeat updates, stale identities, above/below-water views and waterline transitions.
- The controlled delayed-wall region changes by 0.98 levels per RGB channel while fog hides its arrival, versus 52.31 levels when revealed (8-bit pixel scale). The fixed underwater-horizon band contained 1,161 near-black pixels in 0.3.6 and zero in the final capture. All six optical poses loaded without missing materials; camera rotation reused the environment capture.
- A full-world streaming run demonstrated progressive reveal beyond 10 km. That extended run was stopped with less than 1 GiB physical memory free while another game was active. Its checkpoint is retained in `artifacts/reveal-037/partial-run.json`; it does not establish full-world completion time or a frame-time benchmark.
- The 1080p / 30 FPS target on 8 GB VRAM / 16 GB RAM with local AI remains unverified. Environment-capture spikes and complex-world reflection quality need representative hardware profiling.

See [the research report](research/DnDRom-Underwater-Camera-and-Reveal.pdf) for optical foundations, implementation tradeoffs and sources. Release capture evidence and installer verification are recorded under `artifacts/optics-037` and `artifacts/installer-037-*`.

## Installer verification

The installer is 780,750,435 bytes. All 507 distribution payload files match the validated native archive by SHA-256. The 0.3.6 installer hash is unchanged.

SHA-256: `2b850778c780efcb31876e11eafd44db5639cd1e398c20573000223ae1974b25`.
