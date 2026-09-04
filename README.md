# DnDRom

DnDRom is a downloadable, local-first 3D tabletop with an AI Dungeon Master. The repository now contains a playable Windows desktop vertical slice—not just the original plan.

## What works today

- Build and edit lit 3D encounter maps in PlayCanvas with grid placement, selection, transforms, duplication, visibility, and notes. Relationship-aware generation turns chairs toward their tables, practical lights toward the room, and perimeter walls and posts consistently inward.
- Use 43 ready-to-place assets: lightweight procedural pieces for settlements and landscapes plus bundled [Kenney Mini Dungeon](https://kenney.nl/assets/mini-dungeon) CC0 models. The complete included GLB pack is under 1 MB.
- Generate cities, towns, villages, forests, plains, mountains, coasts, swamps, taverns, dungeons, caverns, and ruins from a text prompt. An OpenAI-compatible local model can return an asset plan; a deterministic offline generator is always available.
- Generate a complete three-act campaign first, then derive a connected world containing capitals, cities, towns, villages, wilderness, dungeons, roads, and story-linked points of interest. Every location can regenerate a stable playable scene from its world seed.
- Work in a persistent three-panel Scene Forge: source/generation controls on the left, an uninterrupted live 3D world in the center, and lighting/PBR controls on the right. Prompt a panorama with the included ComfyUI-SplatKit workflows, browse CC0 HDRIs through Poly Haven, or upload an existing panorama.
- Work in a persistent three-panel Character Forge with generation controls left, a full-height 3D miniature turntable centered, and base/lighting controls right. The uncropped source image, protected original, generated model, role, scale, base, and preview lighting autosave. Paint and shade sketches on separate local layers; prompt-edit the current mesh into a recoverable material revision; organize one character into topology-changing forms, alternate visual styles, and bounded per-style versions; attach a rig to each compatible form/style; and author or reuse prompted idle, attack, ability, reaction, and transformation motions. Generated and imported miniatures share a hard 20,000-triangle gameplay ceiling, while 2048 PBR textures preserve surface detail. Completed characters are atomically stored in the reusable Character catalogue, reopened in Forge, and added to or removed from campaign Minis. Asset cards render a thumbnail from the actual local GLB instead of a generic silhouette.
- Create reusable objects and architectural materials in the responsive three-panel Prop Forge. Object references require human approval before Pixal3D/TRELLIS.2 conversion, validate as self-contained GLBs, default to 8,000 triangles, and enforce a 20,000-triangle ceiling. Reusable floor, wall, pillar, and general PBR themes use seamless repair, editable derived maps, and planar or true world-space triplanar projection. In Build mode, authored floor, tabletop, wall, ceiling, stacking, and structural surfaces support local parent transforms, compatible snapping, oriented clearance, cycle rejection, scale-aware anti-z-fighting offsets, detaching, and practical lights that follow and face with their support.
- Light maps and miniatures with a layered PlayCanvas forward pipeline: a bounded grid of bilinearly sampled nine-coefficient spherical-harmonic bounce probes over normal-dependent sky/ground ambient, panorama or procedural IBL reflections, 18 bundled 1K CC0 PBR scan sets with separate floorboard, table, chair, barrel, crate, chest, structural timber, masonry, natural rock, metal, cloth, leather, bark, terrain, plaster, and roof roles, plus procedural fallbacks for water/foliage/flesh, a warm-key/cool-fill/camera-rim rig, miniature-only Fresnel edge separation and soft radial contact decals, half-resolution blurred lighting-space SSAO, flickering inverse-square practicals with smooth falloff, one acne-resistant full-board cascaded directional shadow caster, matte floor highlights, selectable MSAA or TAA, separated overlay elevations, animated flame shaders, micro-normal clear-coated dielectric dice, ACES2 grading plus mood LUTs, bloom, gameplay-aware tilt-shift depth of field, quality-scaled volumetric mist, an anti-aliased world grid, and two-channel animated fog of war. Build mode keeps the full board plane readable with reduced near blur; Play mode tracks the selected or active-turn miniature and widens the focal band to nearby combatants. A persistent top-bar Display dialog offers Performance, Balanced, Cinematic, and 4096-shadow Diorama tiers plus render scale, antialiasing, shadow, effects, and reduced-motion overrides shared by every 3D workspace.
- On first launch DnDRom automatically and resumably provisions its complete local creation suite: GPU-specific ComfyUI, Pixal3D, TRELLIS.2, bundled workflows, scene models/nodes, and Brush. The managed engine binds to loopback and exposes CORS only so the installed WebView can reach it.
- Play through the included **The Ember Below** scenario with an AI Dungeon Master that preserves player agency and proposes schema-validated checks for deterministic rules code to resolve.
- Run SRD 5.2.1 mechanics for D20 tests, attacks, cover, damage types, resistance/vulnerability/immunity, conditions, concentration, movement, rests, exhaustion, and death saves. See the explicit [rules coverage matrix](docs/RULES_ENGINE.md).
- Stream local-model response tokens and begin queued sentence-level speech before the full response is complete. Narration can be interrupted.
- Speak actions where the system webview exposes speech recognition, or type them; stage up to 12 mixed dice in an additive tray, press Roll once, and watch Rapier rigid bodies enter from the right with randomized launch velocity, angular impulse, material density, friction, and restitution. Convex dice collide with the board, tray boundaries, and each other; the completed simulation determines the upward local face before visible playback labels it with the authoritative result, so numbers never swap. Recessed normal-mapped numerals, temporal-AA motion suppression, a centered tabletop toast, and conventional paired d10 percentile rolls keep the result readable and physical.
- Open Dice Forge to create reusable, per-die themes with a live rotating d4–d100 preview, independent body/number styling, and imported albedo, OpenGL normal, roughness, metallic, and AO maps. A downloadable 2048×1024 spherical template and prompt guide support hand painting or any opt-in cloud art tool; the same private local image runtime can generate an albedo and derive editable starter PBR maps automatically.
- Create characters through a six-step in-app SRD 5.2.1 builder with all 12 open base classes, nine SRD species, four SRD backgrounds, class-limited skills, class-weighted ability arrays, and a searchable 50+ item equipment catalog. The finished sheet calculates HP, AC, proficiency, saves, Hit Dice, weapon actions, inventory, and level-specific spell-slot tracks, and remains editable per campaign.
- Import D&D Beyond/user-exported character-sheet PDFs and portable JSON. Every inferred PDF field is shown for review before import.
- Create, rename, resume, import, export, and delete locally autosaved campaigns. Each campaign can preserve multiple independently editable scenes, including split-party membership, maps, placements, lighting, notes, and travel locations. Character sheets are editable per campaign and can be attached to any reusable miniature without changing that miniature's links in another campaign.
- Host or join a room through direct WebRTC data channels with automatic WebSocket relay fallback. The same small signaling server can run locally, on a player's server, or as a managed company endpoint.
- Package the app through Tauri 2. Windows MSI and NSIS installers are produced by the build command.

## Quick start

Requirements: Node 22+, pnpm 10+, and Rust stable. Windows desktop builds also require the normal MSVC/Tauri prerequisites.

```powershell
pnpm install
pnpm dev
```

To run the native shell:

```powershell
pnpm desktop:dev
```

To produce installers:

```powershell
pnpm desktop:build
```

Windows outputs are written to:

- `target/release/bundle/msi/DnDRom_0.1.0_x64_en-US.msi`
- `target/release/bundle/nsis/DnDRom_0.1.0_x64-setup.exe`

## Local AI

Start any local server that exposes the OpenAI-compatible `/v1/chat/completions` API, such as `llama.cpp`, then open **Session → Local AI runtime** and enter its base URL and model alias. DnDRom enforces a loopback hostname for language-model, ComfyUI, and Scenery Studio endpoints. Prop Forge additionally offers an explicitly selected hosted Krea API route; only its compiled asset prompt is sent, its separately billed token stays in the Windows credential store, and source uploads remain local. When no language model is configured—or when it fails—DnDRom uses its offline map director and deterministic DM fallback.

The current slice uses one capable chat model for DM narration and map planning. The planned two-model router/utility split remains a benchmark-driven optimization; it is not required to play.

## Multiplayer and cheap hosting

Start the included protocol server:

```powershell
pnpm signaling
```

It listens on `ws://0.0.0.0:8787` by default. Override its binding with:

```powershell
$env:DNDROM_SIGNAL_HOST = "127.0.0.1"
$env:DNDROM_SIGNAL_PORT = "9000"
pnpm signaling
```

The server only coordinates peers and relays versioned campaign snapshots when a direct connection is unavailable. It does not run the AI or renderer, keeping self-hosting inexpensive. Production internet rooms should put it behind TLS and use a `wss://` URL.

## Verification

```powershell
pnpm check
```

The current repository passes TypeScript type checking, 297 desktop web/domain tests with five optional checks skipped by default, the signaling and Rust suites, the Vite production build, the Tauri Windows installer build, and a packaged WebView2 startup/interaction/render smoke test. The smoke covers persisted display settings, gameplay-aware DoF focus, live Diorama renderer budgets, campaign resume, split scenes, the three-panel Scene/Character/Prop editors, a prompted 128-meter/64-chunk procedural world with complete overview residency and a daylight floor, real imported-GLB thumbnails, surface-aware prop placement, SH probe/SSAO/contact-shadow/rim/inverse-square lighting policies, Play-mode grid removal, randomized rigid-body dice/toast feedback, semantic scanned PBR loading, and GPU shader compilation.

## Scope boundaries

This is a functional vertical slice, not completion of every research feature in the product plan. The following remain explicit next milestones:

- Automatic splat cleanup/compression, collision-proxy derivation, and multiplayer binary transfer. Local SplatKit queueing, automatic Brush training, and PLY/SOG import/rendering work now, while the procedural mesh map remains the gameplay proxy.
- Browser-side FBX decoding/retargeting and broader rig/animation hardware benchmarks. Per-form/style rig persistence, imported animated-GLB playback, prompt-compiled procedural motion, motion reuse, and optional local HY-Motion source generation work now; converting every generated FBX into a browser-playable animated GLB remains a later compatibility milestone.
- Bundled `whisper.cpp`, Kokoro, and model-manager sidecars. The current slice uses webview speech services and an externally launched OpenAI-compatible model server.
- Direct authenticated D&D Beyond API synchronization. The supported, lawful MVP route is user-exported PDF/JSON import rather than scraping private endpoints.
- A hardened authoritative headless game server, accounts, TURN, reconnect history, permissions, encryption keys, and hosted billing/operations.

See [implementation status](docs/IMPLEMENTATION_STATUS.md), [rules coverage](docs/RULES_ENGINE.md), [product plan](docs/PRODUCT_PLAN.md), [technical architecture](docs/ARCHITECTURE.md), [delivery roadmap](docs/ROADMAP.md), and [ADR 0001](docs/adr/0001-platform-and-rendering.md).

## Licensing and product naming

DnDRom source code is MIT licensed. Bundled Kenney assets are CC0; provenance and the original notice are stored beside the files. `DnDRom` is a working product name. D&D trademarks, SRD attribution, and third-party character-sheet interoperability require legal review before public release.
