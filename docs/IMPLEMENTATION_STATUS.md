# Implementation Status

Updated: 2026-08-31  
Release: 0.1.0 playable vertical slice

This document separates implemented behavior from the longer product plan. A checked item has executable code and was included in the verification pass; it does not imply production-scale security or operations.

## Implemented

| Surface | Current implementation |
| --- | --- |
| Desktop | Tauri 2 Windows application, native app-data campaign saves, MSI and NSIS packaging |
| UI | React 19 creator/play shell with persistent local state and portable campaign files |
| Renderer | PlayCanvas lit 3D scene, orbit/pan/zoom, grid, primitive compositions, GLB loading, selection and transform editing |
| Asset library | 43 exposed starter assets including settlement/landscape primitives; 31 bundled Kenney Mini Dungeon GLBs and CC0 provenance |
| AI campaign/world creation | Story-first three-act scaffold, fail-forward beats, antagonist/stakes/finale/epilogue, connected seeded world, settlements, roads and story-linked POIs |
| AI map creation | Prompt-driven local planner plus deterministic cities, towns, villages, forest, plains, mountains, coast, swamp, tavern and dungeon themes |
| AI scenery finishing | Loopback-only ComfyUI-SplatKit bridge, offline searchable idea catalog, prompt-to-panorama workflow chaining, panorama upload, queue monitoring, automatic returned-splat import, persistent PLY/compressed-PLY/SOG storage and PlayCanvas rendering |
| AI Dungeon Master | Campaign-grounded prompt, agency constraints, structured output validation, checks proposed to deterministic rules code, offline fallback |
| Response latency | OpenAI-compatible SSE input, narration-clause extraction, queued speech, and abort/barge-in controls |
| Rules | Versioned SRD 5.2.1 core: D20 tests, attacks, cover, typed damage, conditions, concentration, movement, carrying, rests, exhaustion, death saves, HP/resources, plus explicit content coverage |
| Characters | Editor for identity, stats, HP, resources, actions, inventory, portrait, conditions; PDF/JSON import review |
| Persistence | Browser persistence, `.dndrom` import/export, atomic Tauri app-data saves, bounded events/messages |
| Multiplayer | Version 1 campaign envelope, WebRTC host/client channels, WebSocket signaling, relay fallback, room UI, peer status |
| Hosting | Standalone Node/WebSocket service with configurable bind/port and no required AI workload |

## Partially implemented

| Surface | Present | Needed next |
| --- | --- | --- |
| Voice | Partial browser recognition and streamed system speech | `whisper.cpp` VAD/partials, Kokoro sidecar, voice packs, measured end-to-end latency |
| Local models | Configurable OpenAI-compatible endpoint and model alias | Installer/model manager, hardware detection, small router model, model profiles and evals |
| Rules engine | Core checks/resources and append-only frontend events | Complete SRD reducer, initiative/combat/effects, authoritative Rust command validation and replay hashes |
| Networking | Real direct/relay synchronization | TURN, host migration, reconnect delta log, identities, ACLs, encryption, abuse limits and soak tests |
| Assets | Editable mesh scene, bundled low-poly GLBs, validated local splat import and a two-million-visible-splat runtime budget | Portable binary asset packages, automatic PLY cleanup/SOG conversion, thumbnails, LOD authoring and multiplayer transfer |

## Research and later delivery

- Automated splat cleanup/compression, relighting evaluation, derived collision proxies, content-addressed multiplayer transfer, and cross-device GPU benchmarks. The current mesh scene is the low-tier and gameplay-authority fallback.
- Local 2D-to-3D character reconstruction, retopology, rigging, animation transfer, and safe import.
- Dedicated hosted session nodes, persistence/database adapters, account plane, observability and billing.
- Direct integrations only where stable, authorized third-party APIs and terms permit them.

## Verification record

- `pnpm typecheck`: pass
- `pnpm --filter @dndrom/desktop test`: 8 files, 27 tests pass
- `pnpm --filter @dndrom/signaling test`: relay integration pass
- `cargo test --workspace`: 5 Rust domain tests pass
- `pnpm build`: production bundle pass
- `pnpm desktop:build`: Windows executable, MSI, and NSIS bundle pass
- Browser smoke: 1440×900 production preview rendered the starter scene and full application shell
