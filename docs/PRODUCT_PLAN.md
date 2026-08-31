# DnDRom Product Plan

Status: proposed baseline  
Updated: 2026-08-28  
Audience: product, engineering, art, AI, infrastructure, and legal

## 1. Product thesis

DnDRom should feel like sitting down at a responsive tabletop, not waiting for a chatbot to write a novel. Players talk, move, inspect, improvise, roll, and make consequential choices. The AI game master observes the same canonical state as the players, asks for rolls when appropriate, applies rules through code, and narrates short spoken responses while it prepares the next beat.

The product wins if it combines five things that are currently fragmented across separate tools:

1. A downloadable, private, local-first tabletop.
2. An AI game master grounded in an auditable rules and world-state engine.
3. Fast, interruptible voice interaction rather than turn-based text walls.
4. A creator workflow that starts with simple blockouts and progressively adds visual quality.
5. A session protocol that works in player-hosted, self-hosted, and company-hosted modes.

The product should not claim that an unconstrained language model can reliably run every campaign. It should make a bounded AI director dependable by giving it explicit tools, structured memory, deterministic rules, and visible correction controls.

## 2. Product principles

### 2.1 Local-first, cloud-optional

- Solo play and previously downloaded campaigns should work offline.
- Player-hosted play should require only discovery/signaling infrastructure in the common case.
- Speech, campaign content, and model prompts stay on the session host unless the group explicitly selects a hosted AI provider.
- Models are downloadable packs, not embedded into every installer.
- Every network and AI provider sits behind an interface so a user can replace it.

### 2.2 Code owns facts; AI proposes intent

- The language model never directly edits hit points, inventory, initiative, map positions, quest flags, or permissions.
- It emits schema-constrained tool requests.
- The authoritative simulation validates and applies requests, then emits immutable events.
- Narration is generated from accepted events, not from an unverified imagined result.
- A player can inspect and correct any imported or AI-inferred fact.

### 2.3 Immediate feedback before perfect prose

- The UI acknowledges speech and actions immediately.
- The DM can use a short acknowledgement while a longer resolution is still being prepared.
- Text and audio are streamed and can be interrupted.
- Long exposition is opt-in; normal turns should use one or two spoken clauses.

### 2.4 Hybrid visuals

- Meshes, materials, colliders, lights, and navigation data define the playable space.
- Gaussian splats can enhance static scenery but do not replace the gameplay representation.
- Generated assets must pass optimization and validation before joining a live session.
- Every scene has quality tiers and a no-splat fallback.

### 2.5 Respect ownership and consent

- Do not scrape third-party character services or call undocumented internal APIs.
- Import user-exported files and partner-approved formats.
- Do not ship copyrighted rule or adventure text outside licensed content.
- Require consent for voice capture, transcription retention, generated likenesses, and any cloud processing.

## 3. Target users and jobs

### 3.1 Primary users

- Two to six friends who want a game without a human DM.
- A solo player who wants a persistent spoken campaign.
- A human DM who wants rules, NPC, map, ambience, and recap assistance.
- A creator who wants to publish a reusable campaign or asset pack.

### 3.2 Core jobs

- Start a one-shot in minutes with sensible defaults.
- Import or create a character without re-entering every statistic.
- Speak naturally and see that the game understood the intended action.
- Trust that rolls, resources, and conditions are tracked consistently.
- Build an attractive map without being a professional 3D artist.
- Resume a campaign with characters, secrets, relationships, and open threads intact.
- Invite friends without configuring ports or renting a server.

## 4. Session experience

### 4.1 Create

1. Select a rules profile, tone, safety settings, expected session length, and content pack.
2. Pick an included map, build a blockout, or import a campaign package.
3. Add characters manually, from a DnDRom JSON file, or from a user-exported PDF.
4. Review all uncertain imported fields before they become canonical.
5. Select local AI quality based on a hardware probe, or choose an allowed remote provider.

### 4.2 Connect

The host creates a short-lived room code or invite link. Players join a lobby, approve microphone permissions, download missing content-addressed assets, and confirm their character. The lobby reports whether each peer is connected directly, through TURN, or to a headless server.

### 4.3 Play

- Push-to-talk is the default; optional voice activation is per player.
- A live partial transcript makes recognition errors visible.
- Players can click or drag tokens, inspect objects, invoke a sheet action, or simply describe an action.
- The AI asks a concise clarifying question only when different interpretations would materially change the result.
- The rules engine proposes a check, target, modifiers, and consequence. The player may accept, edit, or use a physical roll.
- Accepted results update the canonical state and drive narration, animation, sound, and lighting cues.
- Any player can interrupt speech. The host can pause the director, rewind the most recent uncommitted narration, or correct state.

### 4.4 Resume and export

- Autosave after every committed event and at scene boundaries.
- Export a portable campaign archive without model weights or unrelated personal data.
- Generate a recap from canonical events and approved transcript snippets.
- Re-open on another machine with a compatibility and missing-assets check.

## 5. Session modes

| Mode | Authority and AI | Infrastructure used | Best for |
| --- | --- | --- | --- |
| Solo local | Player device | None after downloads | Private/offline campaigns |
| Player hosted | Host device | Signaling, STUN, TURN only if needed | Default friend groups |
| Self-hosted node | User-operated headless process | Their VM/home server plus optional shared discovery | Communities and power users |
| Managed hosted | Company-operated headless process | Session node, persistence, optional relay and AI | Reliability and convenience |
| Human-DM assist | Host or server, AI has limited tools | Any of the above | Existing tables |

All modes use the same session commands, events, snapshots, and protocol version negotiation. The transport and process location change; game semantics do not.

## 6. Scope

### 6.1 MVP: required

- Windows desktop first, with the architecture remaining portable to macOS and Linux.
- One 5e-compatible SRD 5.2.1 rules profile.
- Solo and two-to-six-player sessions.
- Player-hosted authoritative state through WebRTC, including reconnect and late join.
- Text and push-to-talk player input.
- Local partial speech-to-text and streamed local DM speech.
- One small main text model and one smaller utility model, selected through a hardware profile.
- Deterministic dice, checks, attacks, damage, healing, initiative, movement, conditions, rests, spell/resource slots, and generic custom resources such as stamina.
- Manual character builder, DnDRom JSON import/export, and user-supplied PDF import with a mandatory review screen.
- Grid and gridless low-poly map editor with terrain tiles, walls, doors, lights, props, tokens, fog of war, colliders, and navigation.
- AI scene director with structured tools, short- and long-term campaign memory, and rules/lore retrieval.
- Save/resume, event history, state correction, and crash recovery.
- Accessibility basics: subtitles, text-only mode, remappable push-to-talk, volume channels, and no-flashing option.

### 6.2 MVP: explicitly excluded

- Automatic URL import from D&D Beyond.
- Shipping non-SRD books, official adventures, settings, art, or rules text.
- Arbitrary live text-to-3D generation during a session.
- Automatic production-quality rigging from any portrait.
- A fully splat-based, fully relightable, destructible world.
- Massive persistent worlds, public matchmaking, mobile, console, VR, or an asset marketplace.
- Guaranteed AI handling of every homebrew mechanic without author configuration.
- Company-hosted GPU inference as the default.

### 6.3 Later capabilities

- Self-hosted and managed headless session nodes.
- Human-DM copilot mode and co-DM controls.
- Campaign author scripting, extension SDK, and signed content packs.
- Optional local/cloud 2D-to-3D generation and optimization workers.
- Compressed splat scenery and capture/finishing pipelines.
- Additional licensed rules systems and community rules adapters.
- Public lobbies, spectator mode, session recordings, and marketplace only after moderation and rights systems exist.

## 7. AI game-master design

### 7.1 Responsibilities

The AI game master is an orchestrated set of capabilities, not one prompt:

- **Conversation:** understand player speech and decide whether it is table talk, a question, roleplay, or an attempted action.
- **Director:** maintain pacing, stakes, scene goals, and open story threads.
- **NPC performance:** select an NPC's knowledge, motive, attitude, voice, and immediate response.
- **Rules proposal:** request deterministic checks and actions, with retrieved rule references.
- **World query:** inspect only the entities and secrets allowed for its current role.
- **Narrator:** describe accepted outcomes without changing them.
- **Memory curator:** summarize completed beats and propose durable facts for validation.

### 7.2 Model layout

The initial local model pack should contain two text-capable models:

| Role | Initial candidate | Purpose |
| --- | --- | --- |
| Main director/narrator | Qwen3.5 4B, quantized GGUF if runtime support and quality pass Phase 0 | Tool selection, NPC dialogue, planning, narration, occasional image understanding |
| Utility model | Qwen3 0.6B, quantized GGUF | Utterance classification, entity extraction, compact summaries, safety labels, and simple JSON repair |

Both candidates use Apache 2.0 weights, but every distributed model and quantization still needs a recorded license, hash, source, and notice. Model names are benchmark candidates, not hard-coded product dependencies. If the 4B multimodal path is unstable in `llama.cpp`, use a proven text-only 3B-4B model and keep vision as an optional separate worker.

The utility model is not a rules authority. It handles cheap language transformations while the main model is busy. The runtime may use `llama.cpp` n-gram or compatible draft speculation for the main model, but it must not assume the utility model can act as a speculative draft model unless tokenizer and architecture compatibility are proven.

Additional non-text models are narrow components:

- `whisper.cpp` base or small model for speech recognition, selected by hardware/language.
- Kokoro 82M ONNX for local synthesis and multiple licensed voices.
- A VAD model for turn detection.
- Optional image-to-3D and background-removal workers used outside live play.

### 7.3 The tool boundary

Every AI request includes a minimal view of:

- current scene and visible entities;
- relevant character summaries;
- recent accepted events and transcript turns;
- retrieved SRD or campaign passages;
- unresolved story threads;
- safety/tone policy;
- an explicit list of currently legal tools.

Representative tools:

- `query_visible_state`
- `query_actor_capabilities`
- `retrieve_rule`
- `retrieve_lore`
- `propose_check`
- `propose_attack`
- `propose_resource_change`
- `move_npc`
- `reveal_entity`
- `set_scene_cue`
- `speak_as_npc`
- `commit_memory_candidate`
- `ask_clarifying_question`

Tool arguments use JSON Schema. The core rejects invalid IDs, impossible movement, unauthorized secret access, illegal targets, stale state revisions, or resource underflow. Rejections return a concise machine-readable reason so the model can recover once without looping.

### 7.4 Turn pipeline and latency

```text
microphone -> VAD -> partial STT -> intent hint
                               -> final transcript -> validated tool plan
                                                   -> accepted events
                                                   -> streamed narration text
                                                   -> clause chunker -> TTS -> audio
```

The system should feel responsive even when hardware is slow:

- Input indicator: under 100 ms.
- First useful partial transcript: target 300-700 ms after speech begins.
- Visible action acknowledgement: target under 500 ms after end of speech.
- First streamed text: target 0.7-1.5 seconds after end of speech on recommended hardware.
- First synthesized audio: target 1.2-2.5 seconds after end of speech.
- Barge-in audio stop: target under 100 ms.

These are product service-level objectives to benchmark, not current guarantees. Do not synthesize arbitrary fixed token chunks. Segment on punctuation, semantic clauses, and a maximum wait timer; enqueue the first complete clause while later text is still decoding. Never speak text until any state-changing tool it describes is accepted.

### 7.5 Multimodal observation

The AI already observes most play through canonical events: token movement, dice, sheet actions, selections, chat, and scene changes. This is more reliable and cheaper than repeatedly interpreting screenshots.

Use vision only for bounded tasks:

- PDF/OCR import fallback;
- user-requested interpretation of an uploaded image;
- a low-frequency scene snapshot when spatial language is ambiguous;
- creator-time asset analysis.

Continuous screen or camera analysis is off by default, clearly indicated when active, and never required for core play.

### 7.6 Memory

Use layered memory instead of placing the whole campaign in the context window:

1. Canonical structured state: entities, resources, relationships, quests, locations, clocks, and permissions.
2. Recent window: the last few accepted events and transcript turns.
3. Scene summary: compact, regenerated at scene boundaries.
4. Episodic memories: indexed summaries with entity, location, time, and secrecy metadata.
5. Source documents: chunked SRD, campaign notes, and creator-authored lore.
6. Story ledger: promises, clues, unresolved threads, deadlines, and character goals.

Every durable memory stores provenance. AI-proposed facts are candidates until accepted by a rule, a creator-authored source, or an explicit host action. Secrets have access-control labels and are never included in a player-facing recap or client snapshot.

### 7.7 Player agency and dynamic story

The director prepares situations, not a fixed plot. Each active scene has NPC goals, pressures, clocks, available locations/assets, known facts, and consequences that can advance without prescribing a player action.

- Never write dialogue, thoughts, movement, or a decision for a player character unless that player has explicitly enabled a narrow autopilot action.
- Treat any reasonable spoken or spatial action as a candidate, not only actions displayed as buttons.
- Ask what the player intends when success/failure stakes are unclear; do not translate ambiguity into the most convenient story branch.
- Advance NPC goals and world clocks from accepted events and elapsed campaign time.
- At scene boundaries, propose new beats from unresolved threads and character goals, then commit any new NPC/location/quest facts with provenance.
- Reuse validated assets and semantic templates during live play. New prose, relationships, clues, encounters, and state can be dynamic; expensive 3D generation stays outside the live critical path.
- Make major irreversible consequences visible before commitment when the character would reasonably understand the risk.
- Let the host inspect the director's concise scene goals and clocks without exposing hidden chain-of-thought.

Agency evaluations should include off-menu solutions, refusals of offered quests, retreats, negotiation during combat, and attempts to revisit earlier locations. Success means the world responds causally without forcing the planned encounter.

### 7.8 Failure behavior

- If local AI is unavailable, retain map, chat, dice, sheets, and human-DM play.
- If TTS fails, continue with streamed text.
- If STT fails, allow immediate text correction or typed input.
- If the model cannot produce a valid plan after one repair attempt, ask a short clarifying question or hand control to the host.
- Never invent a successful state mutation to hide a timeout.

## 8. Rules and character sheets

### 8.1 Canonical character model

The data model must be rules-profile-aware rather than a visual copy of a paper sheet. Core concepts include:

- identity, appearance, biography, player ownership, and visibility;
- level/class lineage and source provenance;
- ability scores, proficiency, saves, skills, senses, speeds, size, and defenses;
- hit points, temporary hit points, hit dice, death saves, exhaustion, and conditions;
- actions, attacks, spells, inventory, currency, equipment state, and attunement;
- resource pools with `current`, `maximum`, recharge policy, source, and visibility;
- effects expressed as validated modifiers and triggers;
- creator-defined fields kept separately from standardized rules fields.

Health is a standard pool. "Stamina" is not assumed to be a base 5e field; it uses the generic resource-pool system unless a future rules profile defines it.

### 8.2 Import pipeline

```text
file -> quarantine/type check -> form-field extraction -> text/layout extraction
     -> OCR or vision fallback -> source adapter -> canonical draft
     -> deterministic validation -> confidence/provenance review -> save
```

Import precedence:

1. Native DnDRom JSON with schema and version validation.
2. Fillable PDF fields and embedded text.
3. Template-specific layout adapters for known user-exported sheets.
4. OCR/vision extraction for scans or flattened PDFs.
5. Manual mapping for unresolved fields.

Every field shows its source and confidence. Derived values are recalculated rather than trusted. Unknown features remain named user content; the AI does not invent their mechanics. A re-import produces a diff and never silently overwrites campaign-earned inventory, damage, conditions, or custom resources.

### 8.3 D&D Beyond boundary

D&D Beyond does not expose a supported public character API, and its current terms prohibit unauthorized automation, extraction tools, scripts, and similar software interacting with its service. Therefore:

- MVP supports importing a PDF the user explicitly exported and uploaded.
- DnDRom does not accept a D&D Beyond URL, fetch `/json`, reuse session cookies, run a browser extension, or scrape a sheet.
- A direct account connection is only considered after a written partnership or documented public API permits it.
- The UI describes this as "Import character PDF," not "D&D Beyond sync."

### 8.4 Rules content

- Ship only content whose license and attribution are recorded, beginning with SRD 5.2.1 under CC BY 4.0.
- Keep rules data versioned and separate from code.
- Each rule result can expose a short rationale and a source reference.
- User-owned homebrew stays local by default and is not redistributed.
- Paid third-party packs require their own entitlement and licensing path.
- Public marketing should use a legally reviewed product name and "5e-compatible" language rather than implying affiliation.

## 9. World building and rendering

### 9.1 Why not splat everything

Vanilla 3D Gaussian splats are optimized reconstructions of a static scene's appearance from multiple images. They can render high visual fidelity, but typical splats bake illumination into appearance and do not inherently provide clean surfaces, materials, collision, navigation, skeletal animation, or simple object-level editing. They can also consume substantial GPU memory unless compressed and level-of-detail streamed.

Converting an existing low-poly map into splats by rendering many views and training a reconstruction normally removes useful editability while preserving baked lighting. It is only worthwhile if an image-generation or finishing step adds visual information that the original mesh did not contain.

### 9.2 Hybrid scene representation

Every scene can contain:

- **Gameplay layer:** lightweight glTF/GLB meshes, grid, colliders, navmesh, doors, cover, triggers, visibility volumes, interactive props, and entity anchors.
- **Lighting layer:** dynamic key lights, baked lightmaps where appropriate, probes, fog, decals, particles, and post-processing quality tiers.
- **Presentation layer:** optional static Gaussian splat regions, skyboxes, distant scenery, or non-interactive captures.
- **Fallback layer:** mesh proxy and low-resolution textures used when splats are unsupported or over budget.

Splats use explicit bounds, a collider/voxel proxy, occlusion rules, streaming LOD, and a memory budget. Dynamic characters, doors, loot, spell effects, and destructible objects remain meshes or particles in the first releases.

### 9.3 Creator workflow

1. **Block out:** paint terrain, place rooms/walls, set elevation, and define playable bounds on a grid or free plane.
2. **Dress:** drag optimized assets from local packs; use snap points, scatter brushes, and procedural clutter.
3. **Make playable:** generate colliders/navigation, tag doors/cover/traps/spawns, and run reachability checks.
4. **Light:** choose a mood preset, adjust lights/fog/probes, and preview each quality tier.
5. **AI assist:** suggest props, generate a layout from a written brief, or create concept images. All placements remain editable.
6. **Optional finish:** capture/import a splat backdrop or run a multi-view visual finishing worker outside the live session.
7. **Optimize:** enforce triangle, texture, splat, draw-call, audio, and package-size budgets.
8. **Validate and package:** run collision, secret visibility, missing license, and deterministic replay checks.

### 9.4 Asset format

- glTF/GLB is the canonical mesh interchange format.
- KTX2/Basis textures, mesh LODs, instancing, and content-addressed blobs reduce memory and transfer.
- Source assets are distinct from runtime-optimized derivatives.
- A manifest records author, license, provenance, generator/model, prompts if retained, safety status, and hashes.
- Generated assets require preview and approval; no generation job can mutate a live scene directly.

### 9.5 2D-to-3D characters

Use a progressive ladder so every user gets a useful result:

1. Portrait token.
2. Transparent 2.5D standee with optional depth/normal parallax and standard base.
3. Image-to-mesh generation from one or more approved reference images.
4. Automated cleanup: scale, orientation, texture baking, decimation, manifold checks, and LOD generation.
5. Optional rig fitting to a small supported humanoid skeleton set.
6. Manual review for weights, silhouette, held items, collision capsule, and animations.

TripoSR is a reasonable first local spike because its official implementation reports roughly 6 GB VRAM at default settings and can emit textured meshes. Higher-quality pipelines such as Hunyuan3D should be optional creator workers because their official requirements are far above a typical play machine. The runtime must also support a remote provider adapter without requiring cloud generation.

Single-image reconstruction cannot reliably infer hidden geometry, clothing layers, hands, topology, or a game-ready rig. The UI must present generated output as a draft and preserve the original image and consent/provenance record.

## 10. Multiplayer and hosting

### 10.1 Authority model

Use one authoritative simulation per session:

- In player-hosted mode, the host's Rust core is authoritative and runs the AI.
- In self-hosted or managed mode, a headless session node is authoritative.
- Clients send commands with their identity, role, expected revision, and idempotency key.
- The authority validates the command and broadcasts ordered events.
- Clients render predictions for low-risk interactions but reconcile to accepted events.

This avoids divergent rules and protects secret state from ordinary clients. In player-hosted mode, the human controlling the host machine is technically trusted and can inspect local files; the product must disclose that. A hosted state node removes player authority over state, but it only provides neutral GM secrecy if the AI also runs on that trusted node. If a designated player's machine runs the AI, that player is technically able to inspect the AI's secret context.

### 10.2 One protocol, multiple transports

Define a versioned `SessionTransport` interface over shared binary envelopes:

- WebRTC reliable ordered channel: commands, events, snapshots, chat, and control.
- WebRTC unreliable/unordered channel: cursors, token-drag previews, pings, and ephemeral presence.
- WebRTC media: player voice.
- WebSocket: authoritative data when connected to a headless node, plus signaling.
- HTTPS: authentication, manifests, asset chunks, and hosted snapshots.

Start with Protocol Buffers generated for Rust and TypeScript. Each envelope includes protocol version, session ID, sender ID, sequence/revision, message type, payload version, timestamp, idempotency key where applicable, and trace ID. Additive compatibility is preferred; incompatible versions fail in the lobby with a useful updater message.

### 10.3 Topology

- Authoritative game data is a star centered on the player host or headless node.
- Small-group voice can be a WebRTC mesh to avoid company media cost.
- Signaling exchanges offers/candidates but never becomes game authority.
- STUN is used for direct connectivity; TURN relays only failed paths.
- Assets are content-addressed and shared from the host/peers when practical, with optional object-store fallback for managed content.

Full-mesh voice is acceptable for the initial two-to-six-player target but should be measured for upstream bandwidth and CPU. An SFU is a later hosted option for larger groups or unreliable networks.

### 10.4 Required network behaviors

- Host-approved joins and role/character assignment.
- Reconnect with a resume token and event catch-up.
- Snapshot transfer for late joins, followed by ordered events.
- Per-channel backpressure and size limits.
- Chunked, hashed, resumable asset transfer outside the event stream.
- Network quality display and direct/relay/server route indicator.
- Host migration only at a committed checkpoint in a later phase; MVP ends or pauses the session if the host leaves.
- Protocol conformance tests run against desktop host and headless server.

### 10.5 Keeping hosted costs low

The minimum company-operated plane contains:

- a stateless authenticated signaling service;
- STUN;
- a rate-limited TURN pool for fallback;
- lightweight account/invite metadata if accounts are enabled;
- update and signed manifest hosting.

Managed sessions add an autoscaled headless node and snapshot storage. Cost controls:

- AI can remain on a designated player's machine by default, even when the state node is hosted, with an explicit warning that this machine receives required GM context.
- Offer managed AI as an explicit metered/premium option.
- Autosuspend empty nodes and persist a compact snapshot plus event tail.
- Avoid relaying voice/assets when peers can transfer directly.
- Deduplicate public assets by hash and set campaign storage quotas.
- Measure TURN ratio, bytes per player-hour, wake time, snapshot size, and AI seconds per session before setting prices.

The self-hosted distribution should be a signed container and documented environment variables, health endpoints, storage mount, and optional coturn configuration. It must speak the same publicly documented, versioned protocol as the managed service and pass the same conformance suite.

## 11. Persistence and campaign packages

### 11.1 Local storage

- SQLite stores profiles, campaigns, structured state, immutable events, summaries, import provenance, and settings.
- Content-addressed files store maps, models, textures, splats, audio, documents, and model manifests.
- Secrets such as provider tokens use the operating-system credential store, never campaign files or logs.
- Write-ahead logging and atomic snapshot replacement provide crash recovery.

### 11.2 Event sourcing

Each accepted mutation is an event with an actor, prior revision, payload schema, provenance, and time. Periodic snapshots bound load time. This enables:

- deterministic replay and desync investigation;
- save recovery;
- human-readable history and correction;
- compact multiplayer catch-up;
- AI recaps grounded in what actually occurred;
- migrations from older schemas.

Corrections are compensating events, not silent database edits. Voice transcripts are not canonical facts and can be excluded from saves.

### 11.3 Portable archive

A `.dndrom` campaign is a versioned archive manifest plus selected content blobs. It excludes installed foundation models, credentials, caches, telemetry, and unapproved recordings. Import checks decompression ratios, paths, executable content, hashes, licenses, schema versions, and size limits before extraction.

## 12. Security, privacy, safety, and legal work

### 12.1 Security

- Device-bound identity keys and short-lived signed join capabilities; a room code alone is not authorization.
- Host approval, role-based commands, and separate public/GM snapshot views.
- DTLS protects WebRTC traffic; TLS protects server transports.
- Strict command schemas, object-level authorization, rate limits, and payload caps.
- Imported documents and campaign text are untrusted data, never executable prompts or code.
- Signed app updates, model manifests, content packs, and self-host images.
- Dependency, archive, shader, and model-file threat reviews.
- No arbitrary creator scripts in the first public release.

### 12.2 Privacy

- Microphone state is always visible.
- Default to ephemeral audio and do not retain raw audio.
- Transcript saving is a per-campaign opt-in with a lobby disclosure.
- Clearly distinguish local, player-hosted, company-hosted, and third-party AI processing.
- Provide deletion/export controls for campaigns, transcripts, generated likenesses, and hosted snapshots.
- Never use private campaign content for training without a separate, explicit agreement.

### 12.3 Table safety

- Session-zero tone and boundaries, including lines, veils, and configurable content intensity.
- Any player can privately signal pause/rewind/change-scene.
- The AI should de-escalate and ask rather than improvise across a boundary.
- Hosts can disable romance, graphic violence, horror, inter-player conflict, or other categories.
- Safety actions are not exposed in a way that singles out the requesting player.

### 12.4 Legal checklist before public alpha

- Product-name and trademark review.
- SRD 5.2.1 CC BY 4.0 attribution and content audit.
- Model, voice, engine, font, asset, and training-output license inventory.
- D&D Beyond import language and behavior review.
- Generated likeness and voice-consent terms.
- Privacy policy, age gate/child-safety position, acceptable use, and takedown process.
- Self-hosting license and protocol terms.

This document identifies engineering boundaries, not legal advice.

## 13. Resource and quality profiles

Do not market "runs on most machines" until a real hardware matrix passes. Start with these planning targets:

| Profile | Planning hardware | Rendering | AI behavior |
| --- | --- | --- | --- |
| Compatibility | 4-core x64, 16 GB RAM, modern integrated GPU | WebGL2, low-poly mesh, reduced lights, no splats | Utility model plus smaller main pack, CPU/hybrid offload, text-first |
| Recommended | 6-core CPU, 16 GB RAM, 6 GB GPU or capable Apple silicon | WebGPU, normal PBR, bounded splats | 4B Q4-class main plus 0.6B utility, local STT/TTS |
| Quality | 8+ core CPU, 32 GB RAM, 10+ GB GPU | higher textures, splat LOD, effects | optional 8B-class director and stronger STT |

The resource governor reserves a configurable GPU budget for rendering, reduces model GPU layers or context before evicting scene assets, pauses creator-time generation during play, and exposes estimated RAM/VRAM before loading a model pack. Model downloads are optional and resumable.

## 14. Success metrics

### 14.1 Product

- Median time from install to first meaningful player choice.
- Percentage of sessions that reach a completed scene.
- Return rate for a second session/campaign resume.
- Player corrections per 100 AI actions.
- Host interventions per hour.
- Character import completion and correction rates.

### 14.2 AI quality

- Valid tool-call rate and repair rate.
- Rule proposal accuracy against a curated test suite.
- Narration contradiction and secret-leak rates.
- Story-thread recall at one, five, and ten sessions.
- End-of-speech to first text/audio latency by hardware profile.
- Barge-in success and incorrect turn-end rate.

### 14.3 Runtime and network

- Frame-time percentiles under simultaneous inference.
- Peak/steady RAM and VRAM per profile.
- Direct WebRTC success and TURN fallback rates.
- Reconnect success, desync count, and bytes per player-hour.
- Crash-free session hours and save recovery success.
- Managed node wake time and cost per hosted player-hour.

Telemetry is opt-in for local-first users and never includes raw voice, campaign prose, private prompts, or character documents by default.

## 15. Major risks and mitigations

| Risk | Consequence | Mitigation/gate |
| --- | --- | --- |
| A 4B model cannot sustain a coherent campaign | Repetitive or contradictory DM | Structured director, story ledger, evaluations, optional quality pack/provider |
| Rules hallucination | Loss of player trust | Deterministic rules core, retrieval references, corrections, golden tests |
| AI and 3D contend for GPU | Stutter and high latency | Resource governor, renderer reservation, quality tiers, sequential creator jobs |
| Splat scenes are too large or not relightable | Poor low-end support and limited interaction | Hybrid representation, compressed LOD, proxy mesh, fallback, bounded use |
| 2D-to-3D output is not game-ready | Broken rigs and unattractive characters | Progressive standee fallback, offline validation/cleanup, limited rig families |
| NAT traversal requires frequent relay | Unexpected hosting bill | Instrument early, player-visible fallback, self-host option, TURN quotas |
| Player host can inspect GM secrets | Trust issue | Clear disclosure; managed/self-hosted neutral authority option |
| Third-party character integration violates terms | Legal and platform risk | File import only until approved API/partnership |
| Imported content prompt-injects the AI | Unauthorized actions or leaks | Treat documents as quoted data, tool ACLs, provenance, prompt-injection tests |
| Scope prevents a playable release | Endless platform work | Vertical-slice gates; postpone live generation, marketplace, mobile, VR |

## 16. Definition of the first compelling demo

A successful vertical slice demonstrates all of the following in one fifteen-minute scenario:

1. A user imports a character PDF, reviews uncertain fields, and starts in a small tavern map.
2. A second client joins the player-hosted session with a room code.
3. Both players speak naturally; partial transcripts appear and can be corrected.
4. The AI DM responds aloud quickly, portrays one NPC, and offers at least two meaningful approaches.
5. A player attempts a non-scripted action. The AI proposes an appropriate check, the deterministic engine rolls or accepts a manual roll, and state changes once.
6. An encounter tracks initiative, movement, hit points, one condition, and one limited-use ability.
7. Both clients converge after a simulated disconnect/reconnect.
8. The campaign saves, closes, resumes, and produces a grounded recap.
9. The map holds the target frame rate while local STT, LLM, and TTS run.
10. The full scenario can run without a company-hosted game server.

Gaussian splats and full AI-generated 3D characters are not required for this demo; those features earn their place after the core game is fun and dependable.

## 17. Open product decisions

- Public product name and brand position.
- Whether the first release targets the 2024/5.5e SRD only or also adds an SRD 5.1 rules profile.
- Whether physical dice input needs computer vision or remains manual.
- Maximum initial party size after voice-mesh measurements.
- Which creator AI providers, if any, may be configured in the UI.
- Whether managed hosting launches with state-only nodes or includes metered AI at launch.
- Revenue model: paid app, campaign packs, hosted subscription, marketplace, or a combination.

These do not block Phase 0 technical spikes.

## 18. Current source notes

The plan was checked against current primary/official sources on 2026-08-28:

- [D&D System Reference Document 5.2.1 and licensing](https://www.dndbeyond.com/srd)
- [D&D Beyond Terms and Conditions](https://www.dndbeyond.com/en/terms-conditions)
- [Tauri 2 sidecar documentation](https://v2.tauri.app/develop/sidecar/)
- [PlayCanvas Engine](https://github.com/playcanvas/engine)
- [PlayCanvas SuperSplat and compressed formats](https://github.com/playcanvas/supersplat)
- [PlayCanvas splat-transform formats and LOD](https://github.com/playcanvas/splat-transform)
- [Compressed 3D Gaussian Splatting, CVPR 2024](https://openaccess.thecvf.com/content/CVPR2024/papers/Niedermayr_Compressed_3D_Gaussian_Splatting_for_Accelerated_Novel_View_Synthesis_CVPR_2024_paper.pdf)
- [Relightable Gaussian Splatting limitations and research direction](https://openreview.net/pdf/f2fddf9ea3393f69dcea3727eea2aba473faf63e.pdf)
- [`llama.cpp` server and structured/multimodal inference](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
- [`llama.cpp` speculative decoding](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md)
- [`whisper.cpp` VAD and streaming examples](https://github.com/ggml-org/whisper.cpp)
- [Qwen3.5 4B model card](https://huggingface.co/Qwen/Qwen3.5-4B)
- [Qwen3 0.6B model card](https://huggingface.co/Qwen/Qwen3-0.6B)
- [Kokoro ONNX runtime and streaming example](https://github.com/thewh1teagle/kokoro-onnx)
- [TripoSR official implementation](https://github.com/VAST-AI-Research/TripoSR)
- [Hunyuan3D-2 official implementation](https://github.com/Tencent-Hunyuan/Hunyuan3D-2)
- [WebRTC data channels, RFC 8831](https://www.rfc-editor.org/rfc/rfc8831.html)

Version-sensitive dependencies and terms must be rechecked at implementation and release time.
