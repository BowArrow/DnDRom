# Coastal water implementation

The UE renderer uses one world-level coastal simulation rather than restarting a foam shader in every streamed tile. The design follows the [coastal water research](research/DnDRom-Coastal-Water-Research.pdf); that PDF records the pre-implementation investigation and is not a release receipt.

## Runtime behavior

- Two 512-square RG16F render targets retain foam density and terrain wetness. A fixed 30 Hz update transports and dissipates foam, then injects new density behind spilling-wave profiles. Terrain wetness remains in place and dries more slowly.
- A 256 m simulation window moves in 32 m increments. Previous world coordinates reproject existing history. Tile replacement does not reset it; temporary missing inputs retain decaying history, while switching map identity resets it. Catch-up is limited to three steps after a stall.
- Signed coastal inputs come from the displayed terrain and the generated hydrology. Legacy dry samples containing wetness proxies or a surface above dry ground are corrected during export. Deliberate dry exclusions remain dry at mean water level, with only a bounded strip available to swash. Source campaign recipes remain unchanged.
- Water geometry extends into that strip. Vertex displacement, pixel coverage and foam birth share the same wave profile and clock. Height gradients suppress beach breakers in sloping channels.
- Wetness darkens and lowers the roughness of compatible terrain. Pale sediment is enabled for coastal-themed maps; forest scenes retain their ground treatment.
- Weather wind strength changes gradually. Wind direction affects exposed foam generation. Displacement remains bounded: this is gentle spilling surf, not a storm-wave or overturning-breaker solver.
- Water normals and caustic focusing use derivatives of the same continuous, nonperiodic fine surface. Caustics use a perspective reconstruction of the visible underwater receiver. Single Layer Water supplies volume scattering, absorption and refraction. Sun intensity gates the focusing effect.

## Limits and budgets

Raw simulation texture allocation is 4 MiB: 2 MiB of coastal input and 2 MiB of ping-pong RG16F history. This excludes texture/resource overhead, staging copies, registered CPU fields, the renderer and local AI models. The field registry accepts at most 1,024 fields; each imported scene allows up to 256 bounded grids with at most 65 by 65 samples. Large individual imports still obey the existing scene byte/geometry limits.

Caustics are an optical approximation, not photon tracing. Unrefracted receiver reconstruction can differ from the water pass's internal refracted UVs. There is no full underwater-camera volume transition, overturning lip, spray-particle simulation or separate entrained-air simulation. Higher camera distances use the existing water surface with the detailed coastal effect fading out. The 8 GB VRAM / 16 GB RAM target requires a separate minimum-spec run with local AI active.

## Code and validation

- Export: `nativeWaterField.ts`, `unrealScene.ts`, `nativeAtlasWater.ts` and `nativeAtlas.worker.ts` under `apps/desktop/src/migration`.
- Native ownership, input validation and render-target updates: `DnDRomWaterSubsystem` under `apps/unreal/Source/DnDRom`.
- Cooked materials: `scripts/unreal/prepare_content.py`, `coastal_common.hlsl`, `foam_update.hlsl`, `water_displacement.hlsl`, `water_surface.hlsl` and the existing terrain shader.
- `scripts/smoke-native-water.mjs` builds a controlled beach, samples its animation and checks GPU density history, decay, reprojection, temporary field handoff, malformed-field rejection, world reset and calm-weather response. It also captures a submerged marker from two views.
- `scripts/smoke-native-site.mjs --coastal` exercises the generated harbor, streamed tile coverage and coastline views. Coverage checks establish residency, not subjective visual quality.
- `scripts/smoke-native-app.mjs` checks campaign persistence, catalogues, controls and native transfer behavior.

The final build receipt is `artifacts/unreal-native-build.json`. Only its referenced reports and installer hash identify the validated release; earlier candidate reports are retained for diagnosis.
