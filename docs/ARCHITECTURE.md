# Technical Architecture

Status: vertical-slice implementation active; remaining research still requires Phase 0 benchmarks  
Related: [Product plan](PRODUCT_PLAN.md), [Roadmap](ROADMAP.md), [ADR 0001](adr/0001-platform-and-rendering.md)

## 1. Goals and constraints

The architecture must support:

- an installable desktop game that continues to function without cloud services;
- a responsive 3D scene while local speech and language inference are active;
- deterministic and auditable rules/state despite nondeterministic AI;
- solo, player-hosted, self-hosted, and managed-hosted sessions using the same domain core;
- untrusted user content and third-party model files without granting arbitrary execution;
- progressive assets from tokens and low-poly meshes through optional compressed splats;
- Windows first without making macOS/Linux ports structurally impossible.

It does not initially optimize for browsers, mobile, consoles, VR, public scripting, large public worlds, or more than six active players.

## 2. System context

```text
                         optional company plane
                 +----------------------------------+
                 | auth/invites  signaling  STUN   |
                 | TURN fallback  updates/manifests|
                 | optional headless session nodes |
                 +----------------+-----------------+
                                  |
                                  | WebSocket/HTTPS/WebRTC setup
                                  |
+----------------------+   WebRTC |   +----------------------+
| Player desktop       |<-------->|   | Host desktop         |
| Tauri + React + 3D   |  media/  |   | UI + authority + AI  |
| replicated state     |  data    |   | persistence + assets |
+----------------------+           |   +----------------------+
           ^                       |
           +------ other peers ----+

In hosted mode, the headless node replaces the host's authority and persistence.
AI may run on that node or on a designated private worker, depending on policy.
```

## 3. Technology baseline

### 3.1 Desktop

- Tauri 2 owns the native window, lifecycle, permissions, updater, credential access, and sidecars.
- React and TypeScript implement application UI, sheet/editor workflows, lobby, and accessibility.
- PlayCanvas Engine owns the real-time canvas, scene graph, PBR mesh rendering, animation, audio positioning, input picking, and optional Gaussian rendering.
- Rust exposes narrow Tauri commands/events instead of a general localhost control server where possible.

### 3.2 Domain and services

- Rust workspace for the domain model, rules, command validation, event application, snapshots, asset manifests, and server authority.
- SQLite for local metadata, event log, snapshots, retrieval metadata, and jobs.
- Content-addressed blob store on disk for large immutable assets and model files.
- Protocol Buffers for Rust/TypeScript network contracts. Domain storage formats have independent versions and migrations.
- Headless server reuses the domain crates and exposes WebSocket/HTTPS endpoints.

### 3.3 AI runtime

- `llama.cpp` process or library-backed sidecar for quantized LLM inference.
- `whisper.cpp` sidecar/library for VAD-assisted streaming speech recognition.
- A small native inference service wrapping ONNX Runtime for TTS and later narrow vision/audio models.
- An AI supervisor in Rust controls process lifecycle, model manifests, health, cancellation, resource leases, and request deadlines.
- Provider adapters allow a user-configured OpenAI-compatible endpoint without coupling domain logic to it.

## 4. Process model

### 4.1 Desktop client/host

```text
Tauri parent process
├── WebView
│   ├── React UI
│   ├── PlayCanvas renderer
│   └── WebRTC media/data adapters
├── Rust application core
│   ├── session authority or replica
│   ├── rules/event engine
│   ├── persistence and asset store
│   ├── network/session coordinator
│   └── AI supervisor
└── supervised sidecars
    ├── llama-server: main director model
    ├── llama-server: utility model, or shared server if supported
    ├── whisper runtime
    └── ONNX audio/creator worker
```

Sidecars bind only to loopback or use stdio/IPC, receive random per-launch credentials, have explicit model/data paths, and are terminated with the parent. The UI never receives unrestricted filesystem or process permissions.

### 4.2 Headless node

```text
dndrom-server
├── session registry
├── one authority actor per active session
├── shared rules/event crates
├── persistence adapter
├── WebSocket and HTTPS transports
├── optional AI provider adapter
└── health/metrics endpoints
```

Start as a single-node process with durable snapshots. Do not introduce distributed consensus before demand requires more than one authority process per session. A session is pinned to one node; recovery starts a new actor from snapshot plus event tail.

## 5. Proposed repository layout

```text
/
├── apps/
│   ├── desktop/               # Tauri shell, React UI, PlayCanvas viewport
│   ├── server/                # headless authoritative session node
│   └── signaling/             # room discovery and WebRTC signaling
├── crates/
│   ├── domain/                # IDs, commands, events, state reducers
│   ├── rules-5e/              # SRD rules profile and content adapters
│   ├── session/               # authority actor, permissions, snapshots
│   ├── protocol/              # protobuf envelopes and compatibility
│   ├── persistence/           # SQLite/event/blob adapters
│   ├── ai-orchestrator/       # tools, prompts, memory, provider contracts
│   ├── asset-pipeline/        # manifests, validation, optimization jobs
│   └── importers/             # PDF/native character adapters
├── packages/
│   ├── ui/                    # reusable React UI and design tokens
│   ├── renderer/              # PlayCanvas integration and scene projections
│   ├── protocol-ts/           # generated TypeScript protocol bindings
│   └── schemas/               # JSON schemas for tools/content packages
├── content/
│   ├── srd-5.2.1/             # generated licensed data and attribution
│   └── starter-campaign/      # first vertical-slice content
├── proto/                     # source protocol definitions
├── tests/
│   ├── scenarios/             # end-to-end campaign fixtures
│   ├── rules-golden/          # deterministic rules vectors
│   ├── ai-evals/              # tool/narration/memory datasets
│   └── network/               # conformance, loss, reconnect, compatibility
├── tools/                     # build, model-manifest, content, and license tools
└── docs/
```

Do not create all packages before they have code. Establish this structure incrementally while preserving the boundaries.

## 6. Domain model

### 6.1 IDs and revisions

- Globally unique opaque IDs for campaigns, sessions, actors, entities, scenes, assets, and events.
- Integer authoritative revision increments for every committed event batch.
- Stable rules/content identifiers include rules profile and content version.
- Display names are never used as foreign keys or AI tool identifiers.

### 6.2 Command lifecycle

```text
client intent
  -> Command { actor, expected_revision, idempotency_key, payload }
  -> authenticate and authorize
  -> validate against current state and rules profile
  -> optional deterministic RNG draw
  -> EventBatch { previous_revision, events, roll_receipts }
  -> atomically append and reduce
  -> project filtered events to each recipient
```

A command produces zero or one committed event batch. Retries with the same idempotency key return the prior result. Event reducers are pure and deterministic. Time-dependent mechanics receive an authority-supplied logical time rather than reading a wall clock during replay.

### 6.3 Core aggregates

- `Campaign`: rules profile, content references, settings, safety configuration, story ledger.
- `Session`: connected actors, roles, current scene, phase, authority, network state.
- `Scene`: entities, spatial data, visibility, triggers, lighting/audio cues, asset references.
- `Character`: statistics, capabilities, inventory, resources, effects, provenance, ownership.
- `Encounter`: initiative, turns, reactions, timers, targets, pending decisions.
- `NarrativeState`: threads, clocks, relationships, revealed facts, candidate memories.
- `AssetManifest`: immutable source/runtime blobs, dependencies, budgets, provenance, license.

### 6.4 Visibility

State is not broadcast as one object. The authority projects views by role and actor:

- public scene state;
- player-owned private sheet state;
- party-shared notes;
- GM/AI-only secrets;
- ephemeral authority-only data such as join tokens.

Events carry a visibility policy evaluated by the authority. Logs and AI contexts use the same projector to prevent accidental secret leakage.

## 7. Rules engine

### 7.1 Boundary

The rules engine accepts typed actions and current state; it returns legal alternatives, derived values, required decisions, and proposed events. It contains no prose generation, model invocation, UI code, or network access.

### 7.2 Initial modules

- Dice expressions and auditable roll receipts.
- Ability checks, saving throws, proficiency, advantage/disadvantage, and modifiers.
- Initiative and turn/reaction state machine.
- Attack selection, range/line-of-sight query hooks, hit resolution, damage, resistance/immunity, healing, and death state.
- Movement budget, difficult terrain, occupancy, collision-query hooks, and opportunity triggers.
- Conditions and timed effects.
- Rest/recharge and generic resource pools.
- Spell/action definitions expressed through a constrained effect vocabulary.

Complex features that cannot be represented safely remain manual until the effect vocabulary grows. The AI can explain a manual step but cannot silently execute unsupported semantics.

### 7.3 Randomness

- Authority uses an operating-system CSPRNG and records roll inputs/results.
- Provide manual/private/public roll modes.
- Add a hash-chain or commit/reveal scheme if adversarial trust becomes a product requirement.
- Replays use recorded results; they never redraw randomness.

## 8. AI orchestration

### 8.1 Provider contracts

```text
TextModel
  stream(request, schema?, cancellation) -> token/tool event stream

SpeechRecognizer
  begin(audio_format, language, options) -> partial/final transcript stream

SpeechSynthesizer
  synthesize(clause, voice, style, cancellation) -> PCM chunk stream

VisionModel
  extract(image/document pages, schema) -> grounded candidate fields
```

Provider output is untrusted. Size, schema, tool name, arguments, state revision, and permissions are validated before use.

### 8.2 Director transaction

1. Create an `Observation` from the final transcript/UI action and current projected state.
2. Utility model classifies the observation and extracts references.
3. Deterministic resolver handles direct sheet/rules actions when no main-model reasoning is required.
4. Retrieval selects rules, lore, memories, and open threads with secrecy filters.
5. Main model emits either a clarifying question or a bounded tool plan.
6. Authority validates and commits tools, one transaction at a time.
7. Narrator receives accepted events and streams player-safe text.
8. Clause chunker feeds TTS; playback remains cancellable.
9. Memory curator proposes candidates asynchronously after the turn.

No narration starts for a state-changing outcome until its events commit. A safe acknowledgement such as an NPC hesitation can play earlier if it asserts no result.

### 8.3 Context budget

Reserve explicit token budgets for system/tool schema, structured state, retrieved rules, retrieved lore, recent dialogue, story ledger, and output. Summaries are bounded and versioned. Retrieval candidates are scored by semantic similarity plus deterministic filters for entity, scene, recency, source authority, and visibility.

Long-context capacity does not justify sending an entire campaign or SRD on every turn.

### 8.4 Resource governor

Maintain resource leases for renderer, main LLM, utility LLM, STT, TTS, and creator workers. Inputs include total/system-free RAM, dedicated/shared GPU memory when discoverable, renderer frame time, model KV cache, battery/power mode, and thermal or utilization signals when available.

Degradation order:

1. Stop background creator jobs.
2. Reduce splat/texture LOD and post-processing.
3. Reduce LLM context/batch and GPU offload while retaining model quality.
4. Use a smaller STT or main model pack.
5. Prefer text before blocking the session.

Do not hot-swap models mid-turn. Expose current quality mode and estimated impact to the host.

## 9. Speech pipeline

### 9.1 Input

- Capture mono PCM with echo cancellation/noise suppression options.
- Push-to-talk establishes clear turn bounds; VAD trims silence and powers optional hands-free mode.
- Stream rolling windows to STT and mark hypotheses as partial.
- Let the user edit the final transcript before submission when confidence is low or a hotkey is held.
- Preserve speaker identity from authenticated audio tracks, not diarization guesses.

### 9.2 Output

- Main model streams UTF-8 text events.
- Chunker buffers until a safe semantic clause, punctuation, or maximum delay.
- Filter stage removes control markup, validates pronunciation tags, and maps character voice/style.
- TTS streams PCM into a jitter buffer; UI subtitles use the same clause IDs.
- Barge-in cancels LLM narration where safe, pending TTS, queued audio, and playback through a shared cancellation tree.
- Cache only stable, non-private system phrases by normalized text, voice/version, and synthesis parameters.

## 10. Rendering and scene projection

### 10.1 Source of truth

The Rust domain owns semantic transforms and gameplay data. The TypeScript renderer maintains a projection optimized for frame updates. It can predict drag previews but only committed events update canonical transforms.

### 10.2 Scene budgets

Each quality profile defines maximum visible triangles, texture memory, splat memory/count, dynamic lights/shadows, particles, draw calls, animation bones, and audio voices. The editor validates all tiers and displays the worst offenders.

### 10.3 Gaussian regions

A Gaussian region references:

- one or more supported compressed representations;
- world transform and bounds;
- quality/LOD metadata;
- collision mesh or voxel proxy;
- optional mesh fallback;
- occlusion and depth-composition settings;
- provenance and baked-lighting description.

The spike must prove depth composition with mesh actors, fog/tonemapping consistency, sorting behavior, device coverage, loading cancellation, and memory reclamation. If it fails, splats remain an import/export preview tool until the renderer matures.

### 10.4 Asset pipeline jobs

Jobs are explicit, resumable, versioned, and never executed during a live session unless marked safe:

- inspect/quarantine;
- decode/source normalize;
- texture transcode;
- mesh decimate and LOD;
- collider/nav proxy generation;
- thumbnail/turntable render;
- splat convert/compress/LOD;
- image-to-mesh generation;
- validation and package signing.

Generated derivatives key their cache by source hash, tool/model version, and settings.

## 11. Character import architecture

### 11.1 Stages

- File guard: MIME/signature, maximum pages/bytes, archive rejection, and quarantine path.
- Extractors: form fields, text spans with coordinates, rasterized pages, OCR/vision.
- Source adapters: identify templates and map raw values into a neutral draft.
- Normalizer: units, names, dice expressions, resource types, and rules IDs.
- Validator: ranges, derived totals, cross-field constraints, and licensed-reference availability.
- Review model: candidate value, raw source, confidence, warnings, and alternatives per field.
- Committer: diff against current character and apply host-approved events.

### 11.2 Provenance example

```json
{
  "path": "abilities.dexterity.score",
  "value": 16,
  "source": {
    "kind": "pdf_form_field",
    "file_sha256": "...",
    "locator": "DEX",
    "importer_version": "..."
  },
  "confidence": 1.0,
  "status": "accepted"
}
```

The raw user document remains local unless the user explicitly uploads it to a chosen service. An importer adapter is not permission to automate the source service.

## 12. Network protocol

### 12.1 Layers

```text
domain commands/events
        |
protocol envelopes + protobuf payload versions
        |
SessionTransport
        +-- WebRTC reliable data
        +-- WebRTC ephemeral data
        +-- WebSocket reliable data
```

Audio is a separate WebRTC media path. Asset payloads use manifest and chunk messages or HTTPS rather than blocking the ordered event channel.

### 12.2 Handshake

1. Resolve invite through signaling/self-host address.
2. Authenticate invite capability and device identity.
3. Exchange app, protocol, rules, content, and model-capability versions.
4. Establish transport and route type.
5. Host approves role and character.
6. Compare asset manifests and transfer missing permitted blobs.
7. Deliver actor-filtered snapshot at revision N.
8. Replay events after N, then mark ready.

### 12.3 Message classes

- Handshake/auth/role.
- Commands and command results.
- Ordered events and snapshots.
- Ephemeral presence and spatial previews.
- Chat/transcript submissions and DM stream control.
- Asset manifests, requests, chunks, acknowledgements.
- Ping/quality/backpressure.
- Error, kick, shutdown, and compatibility notices.

### 12.4 Server/peer parity

Protocol conformance fixtures execute the same command sequence against:

- an in-process authority;
- a desktop authority through WebRTC;
- a headless authority through WebSocket.

All must emit byte-equivalent domain event payloads after transport metadata is removed.

## 13. Hosted control plane

### 13.1 Minimal services

- Signaling: ephemeral room presence and WebRTC offer/candidate exchange.
- STUN/TURN: direct path discovery and fallback relay.
- Manifest/update service: signed app, model, and content metadata.
- Optional identity/invites: device/user identities and short-lived capabilities.

The signaling service stores no campaign state. TURN credentials are short-lived and scoped. Rate-limit room creation, candidate spam, and relay allocations.

### 13.2 Managed session lifecycle

```text
invite -> allocate/wake node -> load snapshot/event tail -> ready
       -> active session -> periodic durable snapshot
       -> empty grace period -> final snapshot -> suspend
```

Separate state hosting from AI hosting. A managed state node can request AI from a designated player's authenticated worker without giving other clients access, although latency and availability must be measured. This worker necessarily receives the GM context needed for its task, so its human operator remains trusted with those secrets. Groups requiring a neutral secret boundary must run AI on the self-hosted/managed node or an independently trusted provider. Premium server AI uses the same provider contract and records region/retention choices.

### 13.3 Self-host distribution

Provide a container image with:

- explicit semantic version and protocol range;
- read-only root filesystem where practical;
- one writable data mount;
- health/readiness endpoints;
- configurable public URL, TLS termination, auth mode, storage limits, and optional AI endpoint;
- no default telemetry containing campaign data;
- documented backup, update, and rollback procedure.

Publish the wire schema, compatibility policy, example client, and conformance fixtures needed to connect to the node. Keep company authentication, billing, matchmaking, and content-entitlement APIs outside the core session protocol so self-hosting does not depend on them.

## 14. Security model

### 14.1 Trust boundaries

- WebView content is less trusted than the Rust core.
- Remote peers are untrusted even when invited.
- Campaign packages, PDFs, model weights, shaders, and generated assets are untrusted.
- Player host is trusted with full campaign state in player-hosted mode.
- Company services are outside the local privacy boundary only when selected.

### 14.2 Controls

- Tauri allowlist/capability configuration grants minimum commands per window.
- Native methods accept typed IDs and bounded data, not arbitrary paths or shell strings.
- Files are opened by capability after a native picker; all resolved paths remain within approved roots.
- Model manifests specify exact hashes, size, license, architecture, and supported runtime.
- Campaign archives reject traversal, symlinks, executable payloads, oversized expansion, and hash mismatch.
- Protocol authorization is checked for every command, not just at join.
- AI tool access is derived from actor/role and current phase.
- Logs redact tokens, paths, transcript text, and private content by default.

## 15. Observability

Local diagnostic bundles should be user-generated and reviewable before sharing. Include versions, feature flags, model manifests, hardware profile, redacted logs, frame/latency aggregates, network route types, and event hashes. Exclude raw campaign content, voice, prompts, credentials, and user documents unless separately selected.

Trace one player turn across VAD, STT, classification, retrieval, LLM first token, tool validation, event commit, TTS first chunk, playback, and client acknowledgement using a shared trace ID.

## 16. Testing strategy

### 16.1 Deterministic tests

- Unit/property tests for reducers, dice expressions, modifiers, resource invariants, visibility, and migrations.
- Golden SRD rules cases with source references.
- State-machine model tests for initiative, reconnect, and session phases.
- Replay every scenario twice and compare canonical snapshot hashes.

### 16.2 AI evaluations

- Tool selection and schema validity.
- Unsupported-rule escalation.
- Narration agreement with accepted events.
- Secret leakage across actor views.
- Prompt injection from campaign/rules/PDF content.
- Long-horizon entity and story-thread recall.
- Latency/quality curves for each supported model quantization and hardware tier.

Model updates require an eval delta report and license/manifest update; they are content releases, not silent remote substitutions.

### 16.3 Network tests

- Loopback, LAN, typical NAT, TURN-only, packet loss, jitter, disconnect, duplicate, reordering, and stale revision.
- Cross-version lobby and additive-protocol compatibility.
- Late join during narration/encounter and asset transfer resume.
- Malformed/oversized messages, role forgery, replayed invite, and rate limits.

### 16.4 Runtime tests

- Frame-time and memory under simultaneous renderer, STT, both LLM roles, and TTS.
- Sidecar crash/restart/leak and parent shutdown cleanup.
- Device loss and renderer fallback.
- Save power loss/corruption recovery.
- Asset import fuzzing and archive bomb protection.

## 17. Phase 0 architecture gates

Do not scaffold the full product until these spikes produce measured evidence:

1. Tauri + PlayCanvas can render the target starter scene and a compressed splat region on the Windows minimum/recommended matrix.
2. The chosen 4B/0.6B model candidates produce valid tool calls and acceptable narration while the scene meets its frame-time budget.
3. Partial STT -> tool -> clause-streamed TTS reaches the latency envelope and cancels cleanly.
4. Two packaged desktop clients establish a host-authoritative WebRTC session through signaling, reconnect, and converge.
5. The same command/event fixture runs through a minimal headless WebSocket authority.
6. A representative user-exported character PDF becomes a reviewed canonical draft without network access.
7. Process, installer, model, asset, save, and first-run download sizes are recorded.

Any failed gate triggers an ADR update before deeper implementation.
