# DnDRom

DnDRom is a downloadable, local-first 3D tabletop with an AI Dungeon Master. The repository now contains a playable Windows desktop vertical slice—not just the original plan.

## What works today

- Build and edit lit 3D encounter maps in PlayCanvas with grid placement, selection, transforms, duplication, visibility, and notes.
- Use 43 ready-to-place assets: lightweight procedural pieces for settlements and landscapes plus bundled [Kenney Mini Dungeon](https://kenney.nl/assets/mini-dungeon) CC0 models. The complete included GLB pack is under 1 MB.
- Generate cities, towns, villages, forests, plains, mountains, coasts, swamps, taverns, dungeons, caverns, and ruins from a text prompt. An OpenAI-compatible local model can return an asset plan; a deterministic offline generator is always available.
- Generate a complete three-act campaign first, then derive a connected world containing capitals, cities, towns, villages, wilderness, dungeons, roads, and story-linked points of interest. Every location can regenerate a stable playable scene from its world seed.
- Prompt a panorama and world entirely through separately installed local [ComfyUI-SplatKit](https://github.com/mickmumpitz/ComfyUI-SplatKit) workflows, search an offline scene-idea catalog, or upload an existing panorama. DnDRom monitors panorama-to-COLMAP generation and imports trained Gaussian PLY/SOG scenery into PlayCanvas. Loopback-only enforcement keeps prompts and images local; the mesh map stays authoritative and remains the low-resource fallback. See the [setup and architecture guide](docs/SPLATKIT_WORLDGEN.md).
- Play through the included **The Ember Below** scenario with an AI Dungeon Master that preserves player agency and proposes schema-validated checks for deterministic rules code to resolve.
- Run SRD 5.2.1 mechanics for D20 tests, attacks, cover, damage types, resistance/vulnerability/immunity, conditions, concentration, movement, rests, exhaustion, and death saves. See the explicit [rules coverage matrix](docs/RULES_ENGINE.md).
- Stream local-model response tokens and begin queued sentence-level speech before the full response is complete. Narration can be interrupted.
- Speak actions where the system webview exposes speech recognition, or type them; roll standard dice from the table.
- Create and edit characters, HP, abilities, resources, actions, inventory, conditions, and portraits.
- Import D&D Beyond/user-exported character-sheet PDFs and portable JSON. Every inferred PDF field is shown for review before import.
- Save locally, import/export portable `.dndrom` campaign files, and autosave application state.
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

Start any local server that exposes the OpenAI-compatible `/v1/chat/completions` API, such as `llama.cpp`, then open **Session → Local AI runtime** and enter its base URL and model alias. DnDRom enforces a loopback hostname for both language-model and Scenery Studio generation endpoints, so prompts and source images cannot be configured to use hosted inference. When no model is configured—or when it fails—DnDRom uses its offline map director and deterministic DM fallback.

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

The current repository passes TypeScript type checking, 27 web/domain tests, the signaling relay integration test, 5 Rust domain tests, the Vite production build, and the Tauri Windows installer build.

## Scope boundaries

This is a functional vertical slice, not completion of every research feature in the product plan. The following remain explicit next milestones:

- Automatic splat cleanup/compression, collision-proxy derivation, multiplayer binary transfer, and one-click trainer execution. Local SplatKit queueing plus PLY/SOG import/rendering work now, while the procedural mesh map remains the gameplay proxy.
- Local image-to-rigged-3D character generation. Portrait import and 3D miniature assets work now; generated topology, rigging, moderation, and hardware budgets still need a measured pipeline.
- Bundled `whisper.cpp`, Kokoro, and model-manager sidecars. The current slice uses webview speech services and an externally launched OpenAI-compatible model server.
- Direct authenticated D&D Beyond API synchronization. The supported, lawful MVP route is user-exported PDF/JSON import rather than scraping private endpoints.
- A hardened authoritative headless game server, accounts, TURN, reconnect history, permissions, encryption keys, and hosted billing/operations.

See [implementation status](docs/IMPLEMENTATION_STATUS.md), [rules coverage](docs/RULES_ENGINE.md), [product plan](docs/PRODUCT_PLAN.md), [technical architecture](docs/ARCHITECTURE.md), [delivery roadmap](docs/ROADMAP.md), and [ADR 0001](docs/adr/0001-platform-and-rendering.md).

## Licensing and product naming

DnDRom source code is MIT licensed. Bundled Kenney assets are CC0; provenance and the original notice are stored beside the files. `DnDRom` is a working product name. D&D trademarks, SRD attribution, and third-party character-sheet interoperability require legal review before public release.
