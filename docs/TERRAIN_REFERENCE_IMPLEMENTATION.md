# Reference erosion and terrain materials

The visual target is the evolved watershed in Nicholas McDonald's December 2023
[hydrology article](https://nickmcd.me/2023/12/12/meandering-rivers-in-particle-based-hydraulic-erosion-simulations/),
including connected valleys, incised tributaries and sediment-settled slopes.
An altered noise silhouette alone is not sufficient validation.

## Simulation

`referenceHydrology.ts` adapts SimpleHydrology's particle motion, exponentially
averaged discharge/momentum, discharge-dependent entrainment, low evaporation,
and per-step sorted-neighbour sediment cascade. The pinned source revision and
MIT notice are in `third-party/SimpleHydrology.txt`. Differences are explicit:
finite-difference gradients, physical cell units, deterministic randomness,
mass-based sediment accounting including open-boundary outflow, and an incision
limit that prevents a single exchange from excavating below the local descent.
The simulation is not a full fluid solver or a dynamic lake simulation.

Initial terrain uses fractal simplex noise. Each regional field is 257 x 257
samples at 64 m spacing with 128 rain batches. Overlapping detailed fields use
16 m spacing and 512 batches, evolving the regional terrain plus resolvable
initial detail. The renderer reconstructs the evolved heightfield, rather than
adding a low-resolution delta back to unsimulated high-frequency noise. LOD
boundaries project onto the neighbouring triangles. Regional elevation uses the
local map's datum, while alpine shading retains geological altitude.

The regions overlap and blend to remain continuous and deterministic. This is
an approximation to an unbounded watershed: independent simulation boundaries
are not a globally solved hydrology network. Local persisted terrain and water
remain authoritative; regenerate a region to apply generator revision 22.
Streamed water contours use simulated discharge and the displayed ground bed;
forest placement excludes those channels. Water currently uses an opaque native
surface, without a full refraction/foam simulation.

Simulation runs in the terrain worker. IndexedDB caches evolved fields locally
with a versioned seed key and a 192-field disk limit; worker memory retains at
most 96 persisted records plus bounded active sampling caches. Cache failure
falls back to deterministic computation. First-time generation has a real CPU
cost and has not been benchmarked on the target 8 GB VRAM / 16 GB RAM machine.

## Texture repetition research and implementation

[Heitz and Neyret (2018)](https://eheitzresearch.wordpress.com/722-2/) sample
random source patches on a triangular lattice and use histogram-preserving
blending to retain appearance. [Deliot and Heitz](https://eheitzresearch.wordpress.com/738-2/)
extend the method for practical rendering, including filtering and compression.
[Mikkelsen (2022)](https://jcgt.org/published/0011/03/05/paper-lowres.pdf)
provides an alternative that retains the original texture assets, sharpens and
modulates blend weights, and treats normals as surface gradients.

The native terrain shader implements that latter approach: three randomized
rotated patches per projection, shared patch identities and weights for color,
normal and ARM maps, inverse rotation of normal gradients, derivative-correct
mip sampling, and triplanar projection on cliffs. World position anchors the
pattern across local and streamed meshes. Continuous variation at roughly
140 m and 550 m scales breaks up uniform regional coloration. There is no
camera-dependent texture scale switch or repeated per-tile UV origin.

This is contrast-preserving hex blending, not the exact histogram/LUT method.
It removes a regular repeat lattice; it cannot guarantee that recognizable
features in an arbitrary source image will never recur. Structured brickwork
and imported prop materials retain their authored mapping. Texture cost is
bounded by the number of contributing terrain layers/projections; inactive
layers are skipped. Native images and shader compilation are required checks.

## Validation tools

### Terrain-first scenes (revision 23)

The scene director supplies geographic requirements separately from building
recipes. Site selection scores eroded terrain for elevation, slope, shelter,
dry parcels and water access. The saved site stores geographic X/Z, elevation
datum, sea level and ecological intent. The architecture director receives the
selected site and measured dry zone locations before authoring recipes.

The local field is sampled from that world coordinate system. It receives no
second local erosion, stream network or shoreline adjustment. Dry road grading
tapers to zero at the scene perimeter; the streamed world needs no blend apron.
Water and terrain materials share site coordinates and elevation datum. Old
blueprints without a site remain supported; explicitly regenerating through
the scene forge performs site selection. Existing campaign geometry is not
silently relocated.

The current water requirement distinguishes coast and river access. Coast uses
a shared sea level and verifies at least one square kilometre of connected
standing water using conservatively submerged cells. It does not yet distinguish
an ocean from a closed great lake. Site search is bounded and reports failure if it cannot
find dry shoreline or river access; it does not fabricate a harbor inland.
This is not a global settlement network: roads and detailed structures remain
local to the selected scene. Additional biome-specific geology and more natural
forest silhouettes are still needed. Cold watershed computation remains
expensive; workers persist evolved fields for reuse. Constant per-batch flow
terms are cached lazily without changing the solver's output arrays.

Native visibility retains both coarse fallback parents and finer fallback
descendants until replacement coverage exists. Eviction cannot remove a tile
that still supplies visible coverage. UE's frustum and occlusion culling remain
enabled. Far forests use bounded canopy geometry rather than disappearing at
LOD 5; this represents stands, not individual distant tree meshes.

- `verify-world-site.mjs`: real harbor and high-valley site selection, building
  footprints and town-to-world boundary measurements.
- `smoke-native-site.mjs`: cold native load, screenshots and retention of
  previously covered geographic probes during camera movement.

- `probe-hydrology-reference.mjs` and `render-hydrology-relief.py`: initial
  heightfield, evolved terrain and discharge from identical initial conditions.
- `verify-terrain.mjs`: actual production LOD stitching and native geometry.
- `smoke-native-terrain.mjs`: real campaign import, complete nearby **visible**
  coverage, camera movement, native materials and captures.
- Focused domain tests cover physical scaling, sediment mass/outflow, reduced
  slope energy, connected stream extent, mesh continuity and water contours.

The shaded-relief artifact is a diagnostic plot, not an in-game screenshot.
Numerical or import checks do not establish visual parity with the reference.
