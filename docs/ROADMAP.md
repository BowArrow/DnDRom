# Delivery Roadmap

This roadmap is outcome-based. Calendar estimates should be added only after Phase 0 measures the hard dependencies and the initial team is known.

## Delivery rules

- Keep `main` runnable and produce a playable artifact at every milestone.
- Complete the deterministic state path before asking an AI to control it.
- Establish low-end frame/latency budgets before increasing visual quality.
- Use one starter scenario as an end-to-end acceptance test throughout development.
- Each phase has exit criteria; unfinished experiments do not count as product capability.
- Gaussian and generated-3D work may proceed only after the core session is demonstrably fun.

## Phase 0: feasibility and foundations

Outcome: measured evidence for the architectural decisions and a repository ready for vertical development.

### Work

- Establish Rust/TypeScript workspace, formatting, linting, tests, CI, license inventory, and ADR process.
- Package a minimal Tauri 2 + React + PlayCanvas desktop app.
- Render mesh/PBR starter scene, quality tiers, and one compressed Gaussian sample.
- Run main/utility GGUF candidates through `llama.cpp` with schema-constrained tools.
- Prototype VAD, partial `whisper.cpp` transcription, clause chunking, Kokoro streaming, and barge-in.
- Build a pure Rust command -> event -> reducer slice with SQLite persistence and replay hash.
- Connect two packaged clients via WebRTC through a tiny signaling service; exercise reconnect.
- Run the same domain slice in a headless WebSocket process.
- Extract and review a representative exported character PDF entirely offline.
- Create hardware benchmark harness and collect at least compatibility and recommended profiles.

### Exit criteria

- All seven architecture gates in `ARCHITECTURE.md` have recorded results.
- No selected dependency has an unresolved distribution license blocker.
- A signed-off ADR records platform, rendering, model/runtime, protocol, and persistence decisions.
- Risks that miss targets have an explicit fallback and owner.

## Phase 1: solo vertical slice

Outcome: one person can complete and resume a short, enjoyable scenario locally.

### Work

- Campaign/session/scene/character domain aggregates and event log.
- Starter tavern scenario with one social path and one encounter.
- Camera, selection, token movement, grid, doors, colliders, fog, and basic scene cues.
- Manual starter character plus native JSON import/export.
- Checks, saves, attacks, HP, conditions, initiative, movement, rest, and one limited resource.
- Text AI director with retrieval, tools, accepted-event narration, story ledger, and corrections.
- Push-to-talk, partial transcript, local TTS, subtitles, and interruption.
- Autosave, crash recovery, close/resume, and event-grounded recap.
- Text-only and AI-off/human-control fallback.

### Exit criteria

- Ten internal runs complete the scenario without manual database repair.
- Canonical replays have identical hashes.
- AI never changes state outside validated commands in automated traces.
- Rule and narration evals meet thresholds defined during Phase 0.
- Recommended hardware meets the frame/latency targets; compatibility mode remains playable.

## Phase 2: player-hosted multiplayer alpha

Outcome: two to six friends can reliably play the vertical slice without a hosted game server.

### Work

- Device identity, invites, host approval, roles, and actor-scoped state projection.
- Reliable and ephemeral WebRTC channels plus peer voice.
- Signaling, STUN configuration, TURN fallback, route indicator, and connection metrics.
- Snapshot/late join, event catch-up, idempotent commands, backpressure, and reconnect.
- Content manifest comparison and resumable peer asset transfer.
- Player ownership, private rolls/notes, and GM-secret filtering.
- Lobby microphone/model/content compatibility checks.
- Network impairment, version compatibility, and security test suites.

### Exit criteria

- Repeated internet tests across representative NATs record direct and relay outcomes.
- Simulated disconnect/reconnect converges without duplicate state changes.
- No secret-state leak in automated per-player projection tests.
- Bytes per player-hour and TURN fallback rate are measured well enough for a cost model.
- A four-player session completes the starter scenario on consumer hardware.

## Phase 3: creator tools and robust character import

Outcome: non-developers can make a small playable campaign and bring in reviewed characters.

### Work

- Map blockout/dressing tools, asset browser, snap/scatter, gridless mode, triggers, encounters, lights, fog, audio, and validation.
- Runtime asset manifest, optimization jobs, thumbnails, LODs, texture transcode, colliders, and navigation proxies.
- Fillable PDF and layout extraction, known-template adapters, OCR/vision fallback, confidence review, and re-import diff.
- Canonical sheet editor, generic resources, inventory, spells/actions, unsupported-effect manual mode.
- Versioned `.dndrom` package export/import with security and license checks.
- Campaign authoring for scenes, NPC motives/knowledge, story beats, clocks, secrets, and safety settings.

### Exit criteria

- A creator builds a new two-scene one-shot without editing source files.
- Representative PDFs reach agreed field-level accuracy and force review for uncertain values.
- Imported files cannot silently overwrite campaign-earned state.
- Every packaged asset has provenance/license metadata and passes all quality tiers or declares exclusions.

## Phase 4: visual AI and Gaussian scenery

Outcome: creators can selectively improve presentation without harming game correctness or minimum hardware support.

### Work

- Portrait and 2.5D standee generation/import workflow.
- Local TripoSR image-to-mesh spike, remote provider interface, and job queue.
- Mesh normalization, decimation, texture baking/transcode, supported rig fitting, LODs, preview, and rejection workflow.
- Splat import/edit/compress pipeline, bounded regions, collision/voxel proxies, LOD streaming, and mesh fallback.
- Optional concept-to-blockout suggestions and multi-view finishing research.
- Provenance, consent, model license, output rights, and deletion UX.

### Exit criteria

- Every generation job is asynchronous, cancellable, attributable, and requires approval.
- Generated characters have a useful standee fallback and never enter play unvalidated.
- A splat-enhanced scene stays within compatibility/recommended budgets or cleanly disables its splats.
- Mesh actors compose correctly with splat depth, fog, and tone mapping on supported devices.

## Phase 5: self-hosted and managed sessions

Outcome: the same campaign can run on a neutral headless authority operated by a user or the company.

### Work

- Supported signed self-host container, configuration, storage, health, backup, and upgrade docs.
- Managed node allocator, autosuspend/wake, durable snapshots, quotas, and operational dashboards.
- WebSocket session transport parity and desktop route selection.
- State-only hosted mode with designated-player AI worker.
- Optional metered hosted AI and explicit retention/region controls.
- Abuse controls, account recovery, billing boundaries, support bundles, and incident runbooks.
- Optional SFU evaluation only if voice-mesh data justifies it.

### Exit criteria

- Protocol conformance fixtures match desktop authority and both headless deployments.
- A campaign migrates between local and headless authority at a safe checkpoint.
- Managed node cost, wake latency, storage, TURN, and optional AI unit economics are measured.
- Self-host backup/restore and version upgrade are tested from published instructions.

## Post-alpha candidates

- Human-DM copilot and co-DM permissions.
- Additional rules profiles and a constrained extension SDK.
- Host migration after checkpoint.
- Spectators and recordings with unanimous consent.
- Larger sessions/SFU, public matchmaking, moderation, and reputation.
- Marketplace, entitlements, creator payouts, and takedowns.
- macOS/Linux general availability, then mobile/VR research.

## Initial issue sequence

Create these as the first implementation issues after accepting the plan:

1. **Workspace bootstrap:** Rust workspace, desktop app, package manager, shared scripts, CI, lint/test/license checks.
2. **Starter scene benchmark:** PlayCanvas mesh/PBR scene, fixed camera path, frame/memory capture, WebGPU/WebGL2 profiles.
3. **Gaussian renderer spike:** compressed sample, mesh depth composition, memory release, fallback, and result ADR.
4. **Domain kernel:** IDs, command envelope, event batch, pure reducer, snapshot hash, and property tests.
5. **SQLite event store:** atomic append/snapshot, migration, crash recovery, deterministic replay CLI.
6. **Rules walking skeleton:** character resources, d20 check, damage/heal, initiative, and golden cases.
7. **Local model supervisor:** manifest, download/hash, launch/health/cancel/cleanup, main and utility adapters.
8. **AI tool transaction:** observation, one schema-constrained check tool, validation, accepted-event narration.
9. **Voice loop:** push-to-talk, VAD, partial/final STT, first-clause TTS, subtitle sync, barge-in metrics.
10. **Protocol skeleton:** protobuf generation for Rust/TS, handshake, command/event messages, compatibility tests.
11. **WebRTC host spike:** signaling, reliable/ephemeral data, two packaged clients, snapshot/reconnect.
12. **Headless parity spike:** same domain fixture through WebSocket against a minimal server.
13. **PDF import spike:** file guard, form/text extraction, canonical draft, field provenance, review UI.
14. **Hardware probe/governor:** quality recommendation, renderer reservation, AI resource leases, diagnostic report.
15. **Starter scenario harness:** scripted acceptance driver and trace across input, AI, rules, state, narration, and save.

Issues 2, 3, 7, 9, 11, 12, and 13 are feasibility spikes and must record measurements, limitations, and a keep/change decision. Issue 4 should establish domain contracts before issues 8, 10, or production UI depend on them.

## Definition of done for every capability

A capability is done only when it has:

- a user-visible path and graceful failure path;
- deterministic/core tests where applicable;
- security, privacy, permission, and secret-state review;
- accessibility behavior for its UI/audio;
- performance measurements on the applicable hardware profile;
- migration/versioning for persisted or networked data;
- provenance/license records for bundled content/models/assets;
- diagnostics that do not expose private campaign data;
- updated plan/ADR documentation if the architecture changed.
