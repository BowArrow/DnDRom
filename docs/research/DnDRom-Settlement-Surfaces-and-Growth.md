# Settlement surfaces, weathering and plant growth

Convincing settlements require variation at three scales: differences between buildings, coherent construction within a building, and small evidence of exposure and occupation. A different color on every wall does not provide this structure. Neither does covering every surface in the same noise or placing vegetation uniformly around every parcel.

The recommended system assigns a reproducible material and age profile to each building, evaluates surface wear in building coordinates, and grows small plants against the actual architectural supports and local terrain. These layers share climate moisture, but retain separate controls. A damp house need not be derelict; an old desert building need not be covered in ivy. This is a design recommendation for a local procedural VTT, not a scientific prediction of deterioration.

The evidence comes from stochastic texture synthesis, physically motivated weathering, environment-sensitive plant modeling, urban vegetation placement, and Unreal's current rendering documentation. These sources address complementary problems. None establishes that a complete procedural settlement will meet a particular frame-rate target merely by combining their techniques.[^1][^3][^5][^7]

The first implementation should synthesize established appearance when a scene is generated. Continuous seasonal ecology, structural failure, pruning, repair histories and biological competition can later operate on explicit state. They should not be represented by a constantly changing random seed. Loading a save or rotating a camera must never change a house's texture identity or move its plants.

The practical quality criterion for texture repetition is the absence of conspicuous repeated motifs at gameplay distances. Finite source images and finite numerical hashes cannot establish a literal guarantee that no pattern will ever repeat. Construction itself intentionally repeats: brick courses, roof tiles and boards should retain their organization. The random detail belongs to grain, individual-unit variation, exposure and wear.

---

## Texture synthesis and construction patterns

Deliot and Heitz's stochastic tiling work uses randomized patches and distribution-preserving transformations to reduce the recognizable repetition of example textures. Their follow-up addresses preprocessing cost, mipmap color deviation and texture compression. The accompanying Grenoble demonstration identifies stochastic natural textures such as moss and granite as suitable inputs. These are strong reasons to distinguish irregular surface grain from ordered construction.[^1][^2]

Burley's analysis examines alternatives for preserving texture histograms during randomized blending. It also identifies coloration problems with independent channel processing and discusses luminance preservation. The important engineering implication is that blending random samples is not automatically color-neutral. A shader that merely averages three samples should not be described as a complete histogram-preserving implementation.[^8]

For this application, use coherent building-local metric coordinates. Split facade panels, window lintels and roof infill should sample the same phase wherever their surfaces meet. Coordinate discontinuities can make a sound architectural model look like separate pasted tiles. Keep the existing terrain's world-space sampling separate from this building coordinate system.

Use randomized triangular patches for irregular plaster and stone grain. The albedo, tangent normal and packed roughness channels must use identical sample locations, weights and derivatives. Apply explicit texture gradients across randomized offsets so mip selection follows the continuous coordinate field rather than the discontinuous hash. Sharp blend weights reduce washout, but are an approximation with a measurable contrast tradeoff.

For courses, generate coherent mortar placement independently of stone grain. For wood and roofing, retain the directional texture and introduce seeded unit-to-unit color and larger irregular weathering fields. Arbitrary rotations of a board texture would turn its grain sideways. Arbitrary rotations of a normal map without rotating its tangent perturbation would produce inconsistent lighting. The initial implementation therefore uses offset sampling rather than rotated patches.

---

## Material diversity within a regional style

A regional palette should define a family of compatible finishes, not force every building to use the same scan. A timber settlement can combine exposed masonry, pale rendered walls, warmer earth-toned render, darker beams, weathered boards and alternative roofing. Earthen architecture should emphasize rendered finishes; a fortress should favor stone. These are art-direction rules, not universal claims about historical cultures.

Distinguish the building's structural recipe from its finish. Changing a surface should preserve wall thickness, doorway clearance, parcel placement and roof profile. Existing AI-authored colors remain useful as regional tints. The material system should vary the substrate beneath them rather than replacing a requested palette with unrelated random colors.

The proposed bounded palette uses three masonry finishes, two timber finishes and two roof finishes. Each building chooses a stable member of each applicable family. The initial roof alternatives are tile and weathered-board appearances. They do not introduce new roof construction geometry, and an earthen roof still needs an appropriately specialized finish in a future extension.

| Surface | Fine structure | Larger variation |
|---|---|---|
| Exposed masonry | Coherent mortar courses and stone grain | Seeded block tone, damp base, stains |
| Render/plaster | Irregular scanned relief | Patchy substrate exposure and discoloration |
| Timber | Directional grain and board structure | Board tint, moisture and weathering |
| Roof | Coherent tile or board direction | Uneven weathering and moisture-sensitive deposits |

Unreal supports layered material composition through several mechanisms, including ordinary material graphs. A compact custom material is suitable when the layering rules are generated and bounded; a full artist-facing layer editor is a separate product feature. Materials must still be cooked, assigned and inspected in the native application. Correct source code alone does not demonstrate that the intended shader reached the mesh.[^9]

---

## Weathering from environmental causes

Dorsey, Pedersen and Hanrahan model appearance changes caused by water moving over surfaces. Their particle approach accounts for factors such as gravity and surface interaction, with absorption, dissolution and deposition affecting appearance. It provides a useful causal model: staining follows material and environmental interaction rather than an arbitrary dirt overlay.[^3]

The later weathered-stone work represents processes within a shallow volume around the surface, including moisture transport, mineral dissolution and recrystallization. That work includes changes in shape as well as appearance. A lightweight VTT shader should not claim to reproduce these volumetric processes. It can instead approximate selected visible results and reserve deeper physical simulation for an explicit future subsystem.[^4]

The initial runtime approximation combines age, climate moisture, height above the building base, orientation and elongated irregular streak fields. Dampness concentrates near the lower wall. Streaks have much more variation across the wall than vertically, suggesting gravity. Moss-like coloration depends on moisture and age. Plaster wear exposes patches of a darker substrate. The same masks affect roughness as well as color.

This approximation deliberately does not calculate runoff from every roof edge, window sill or gutter. It also does not simulate chipped silhouettes, mineral transport, structural cracks, standing water inside a building or accumulated rainfall over campaign time. These limits matter: simple height and noise fields cannot know where a gutter actually diverts rain. A later exposure pass should trace roof drainage and shelter against the accepted geometry, then bake low-resolution reusable fields.

Age should be a normalized visual control rather than a claim about calendar years. Different materials deteriorate at different rates, and maintenance can dominate chronological age. The engine can preserve a stable age variation now and later split it into construction age, maintenance, repair patches and exposure history. That extension should migrate explicit values rather than re-rolling the scene.

---

## Ground plants in settlements

Procedural Urban Forestry introduces vegetation placement models sensitive to the structural and functional zones of a city. Its examples distinguish placement strategies such as boundaries, clusters and regular distributions. It also discusses keeping vegetation away from entrances and other functional clearances. The relevant transfer to small settlement flora is a spatial rule system tied to architecture and access, rather than unrestricted scatter.[^5]

The ecosystem work of Deussen and colleagues separates plant distribution, procedural plant shape and efficient rendering. Its use of representative instances provides an important foundation for large populations. The environment-sensitive modeling work of Mech and Prusinkiewicz further emphasizes that growth depends on interactions with surrounding space and resources.[^6][^10]

For the initial settlement pass, choose cluster centers along supported wall bases. Apply irregular offsets within each cluster and enforce minimum separation. Sample the visible terrain height at each root. Reject roots in water and within the accepted street clearance. Use the generated doorway operators to reserve access corridors, including the area immediately outside an open door.

Vary density with moisture and age. Favor fern-like forms in wetter conditions and a mixture of low rosettes and small flowering herbs in moderate conditions. Dry or newly maintained settings should have substantially less growth. These three forms are intentionally a modest visual vocabulary, not a complete biome species library or a botanically exact reconstruction.

Plant geometry should be reusable across buildings. A clump can contain several folded leaves and a small flowering stem. Rotate and scale whole clumps, preserving a stable placement identity. This gives foliage a changing silhouette and distinct lighting from different view directions without requiring a separate actor for each leaf. The renderer can instance the prototypes while the generation service retains only the small placement list.

---

## Climbing plants and architectural support

Hädrich and colleagues represent climbing plants with connected particles that respond to biological state and the surrounding environment. Their system supports interactions such as obstacles, editing and deformation. This is a much richer model than simply placing an ivy texture on a wall, but also a different computational commitment from decorating a streamed town.[^7]

Historic England distinguishes superficial attachment roots from roots that establish within existing defects. It also reports that ivy can moderate environmental exposure in some circumstances. A visual system should therefore avoid equating every vine with a cracked, collapsing wall. Plant coverage, substrate condition and structural damage are separate variables.[^11]

The recommended first step is a bounded supported-shoot generator. Match the actual facade panels to outward-facing opening operators so interior partitions are excluded. Start short shoots near a wall base. Advance upward with controlled lateral variation, keep each point within solid supporting geometry, and add alternating leaves with slight depth away from the surface. Stop before unsupported gaps.

Windows and doors should remain legible and functional. The initial conservative generator stops at panel boundaries rather than bridging openings. It produces narrow climbing shoots rather than an entire mature ivy canopy. This is appropriate for inhabited settlements; ruins may later request wider branching, broken support and controlled intrusion through abandoned openings.

Support constraints should be checked in the building's own coordinates. The resulting mesh then inherits the building transform. This makes rotated buildings straightforward and prevents a scene-origin change from detaching the vine. Root placement against terrain still requires the accepted world transform. Tilted or nonuniformly scaled authored buildings should be protected from automatic regrowth until their geometry is explicitly evaluated.

---

## Rendering and bounded work

Unreal's foliage documentation explains that instances are rendered in clusters and that an end cull distance alone can make groups disappear abruptly. It describes fading before removal through material support. It also notes that Nanite foliage does not follow the same instance-distance fading behavior. These distinctions prevent treating all UE foliage paths as interchangeable.[^12]

For small settlement plants, use conventional instanced meshes with inexpensive folded leaf geometry. A few hundred triangles in a nearby clump are preferable to large mostly transparent cards when the latter waste substantial shading work. This is an engineering hypothesis to validate on the actual scene; the break-even point depends on coverage, lighting and hardware.

The first implementation caps herbs at 96 placements and climbing shoots at six per building. These are hard work limits, not a guarantee that every visible settlement can be rendered simultaneously at full detail. Use three simpler prototype LODs. Ground herbs share their prototype meshes; supported vines are merged per building. Neither requires per-frame growth computation or a physics body.

A material fade between approximately 65 and 110 metres removes small plants before their component's final cull distance. This avoids making little weeds part of the horizon rendering budget. Coarser settlement representations keep building surfaces and their larger wear fields. Existing distant trees remain a separate system and should not be reduced to pay for this detail pass.

Record generation time, vertex counts, draw/component counts, native import time and frame distributions separately. A local model consumes memory and compute that an isolated graphics test does not represent. The intended 1080p/30 FPS target on an 8 GB VRAM, 16 GB RAM system remains unverified until measured with local AI active on representative hardware.

---

## Persistence and generation integration

Derive a surface seed from world seed and stable building ID. Assign age and palette choices with independent hash channels so adding another property does not shift existing choices. The climate sampler supplies moisture from the same persistent world geography used for terrain and biome selection. Plants must not use frame count, camera position, tile arrival order or a globally consumed random sequence.

Attach the small versioned surface profile to generated assembly parts. The same profile travels with near and distant building meshes. Metric UVs and a second UV channel carry coherent sampling and height/seed/moisture data. Vertex alpha supplies visual age while existing vertex RGB continues to carry the requested tint. Preserve all channels through native mesh conversion, batching, material replacement and save/load.

Upgrade disposable meshes from accepted building recipes on load or export. The upgrade must preserve entity IDs, positions, rotations, scales, entrances and authored material assignments. Explicit authored entity overrides and removed entities take precedence. This is an appearance refresh, not a settlement-layout revision.

Ground vegetation should be emitted only where a resident terrain sampler can establish a root height. Missing terrain is not permission to guess an elevation. Distant building surfaces can be generated without nearby ground clutter. When the playable scene becomes available, its local detail pass uses the same accepted building identities and constraints.

Regenerable appearance needs an explicit algorithm version. A future recipe or climate revision should invalidate affected derived meshes while preserving authored changes. Saved established growth is not a time simulation: if growth is later made dynamic, its simulation epoch and maintenance events must become persistent state rather than an implicit function of loading time.

---

## Validation and remaining quality gates

Verify deterministic profiles and geometry after serialization, alternate generation order and scene switching. Compare near and distant material selection for the same building ID. Check that an existing campaign refresh retains transforms and authored overrides. Inspect all generated buffers for finite values and valid unit normals; folded leaf construction can otherwise introduce degenerate triangles that fail native import.

Use controlled wet/old and dry/new fixtures to demonstrate the direction of density changes. Check every root against the height sampler and forbidden regions. Confirm that entry corridors remain clear and climbing-shoot points remain on their supported panel. Confirm hard bounds even when a large facade provides many potential sites.

Native visual review should include a sunlit wall at pedestrian height, a shaded wall, a roof/eave angle, several neighboring material variants and a distant settlement view. Capture a before/after using the same geometry and camera where practical. Examine mortar scale, UV continuity, tint clipping, roughness, leaf lighting, floating roots and plant intersections. A successful import is necessary but cannot establish aesthetic quality.

The initial implementation is a bounded appearance system. It does not claim full histogram-preserving synthesis, physically simulated moisture transport, a complete botanical species library, runtime seasonal growth, repair gameplay or structural deterioration. These limitations do not prevent useful results, but they must remain distinct from implemented features.

Recommended subsequent improvements are a geometry-aware runoff/exposure bake, explicit regional material recipes, ground debris and repair history, and richer climbing-plant branching with obstacle queries. Each should be introduced with its own profiling and persistence checks. Increasing asset counts without improving placement rules would recreate the original problem at greater cost.

---

## Sources

[^1]: Thomas Deliot and Eric Heitz. [Procedural Stochastic Textures by Tiling and Blending](https://eheitzresearch.wordpress.com/738-2/). GPU Zen 2, 2019. Randomized sampling, preprocessing, mipmaps and compression.

[^2]: Thomas Deliot, Eric Heitz and Fabrice Neyret. [Texture synthesis with histogram-preserving blending](https://unity-grenoble.github.io/website/demo/2020/10/16/demo-histogram-preserving-blend-synthesis.html). 2020. Source texture suitability and working demonstration.

[^3]: Julie Dorsey, Hans Køhling Pedersen and Pat Hanrahan. [Flow and Changes in Appearance](https://graphics.cs.yale.edu/publications/flow-and-changes-appearance). SIGGRAPH, 1996. Surface transport and weathering.

[^4]: Julie Dorsey and colleagues. [Modeling and Rendering of Weathered Stone](https://graphics.stanford.edu/~henrik/papers/sig99/). SIGGRAPH, 1999. Moisture transport and volumetric stone weathering.

[^5]: Till Niese and colleagues. [Procedural Urban Forestry](https://arxiv.org/html/2008.05567v1). 2020. Context-sensitive vegetation placement and functional clearances.

[^6]: Oliver Deussen and colleagues. [Realistic modeling and rendering of plant ecosystems](https://algorithmicbotany.org/papers/ecosys.sig98.html). SIGGRAPH, 1998. Distribution and approximate instancing.

[^7]: Torsten Hädrich and colleagues. [Interactive Modeling and Authoring of Climbing Plants](https://storage.googleapis.com/pirk.io/projects/climbing_plants/index.html). Computer Graphics Forum 36(2), 2017. Environment-sensitive climbing growth.

[^8]: Brent Burley. [On Histogram-Preserving Blending for Randomized Texture Tiling](https://jcgt.org/published/0008/04/02/). JCGT 8(4), 2019. Histogram and color-preservation tradeoffs.

[^9]: Epic Games. [Layering Materials in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/layering-materials-in-unreal-engine). UE 5.8 documentation, accessed September 10, 2026.

[^10]: Radomir Mech and Przemyslaw Prusinkiewicz. [Visual Models of Plants Interacting with Their Environment](https://algorithmicbotany.org/papers/enviro.sig96.html). SIGGRAPH, 1996.

[^11]: Historic England. [Ivy on Walls](https://historicengland.org.uk/advice/technical-advice/monuments-and-sites/ivy-on-walls/). Updated August 8, 2024. Attachment, environment and damage distinctions.

[^12]: Epic Games. [Foliage Mode in Unreal Engine](https://dev.epicgames.com/documentation/unreal-engine/foliage-mode-in-unreal-engine). UE 5.8 documentation, accessed September 10, 2026. Instancing, culling and fade behavior.
