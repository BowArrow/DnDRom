# ADR 0001: Desktop Platform and Hybrid Rendering

Status: accepted for the vertical slice; Gaussian production use remains conditional on Phase 0 evidence  
Date: 2026-08-28

## Context

DnDRom needs a downloadable, low-overhead 3D tabletop; React-quality application UI; local C/C++/Rust AI processes; WebRTC multiplayer; and Gaussian splat rendering. The project is greenfield, but the expected engineering strengths are TypeScript, React, and Rust.

Gaussian splats are central to the visual ambition, yet a game also needs editable geometry, collision, navigation, dynamic characters, stable depth, and lighting. Typical splats reconstruct a static captured appearance and bake in illumination. Relightable and deformable Gaussian methods exist as active research, but they are not a safe primary representation for a resource-conscious game today.

## Decision

Use:

- Tauri 2 as the native desktop shell;
- React + TypeScript for application UI;
- PlayCanvas Engine inside the webview for the initial 3D runtime;
- Rust for the authoritative domain/rules/session core and headless server;
- glTF/GLB mesh/PBR scenes as the gameplay representation;
- compressed Gaussian splats as optional bounded presentation regions with collision/mesh proxies and fallbacks.

Prefer WebGPU on capable systems and maintain a WebGL2 compatibility path. Package native inference components as supervised sidecars initially; move stable hot paths into libraries only when profiling justifies the integration cost.

This decision is conditional on the Phase 0 packaged-app, Gaussian composition, and simultaneous renderer/inference benchmarks.

## Why this direction

- It fits the existing React/TypeScript/Rust skill set and supports rapid product UI work.
- Tauri provides a small native shell and a supported external-binary packaging path for local inference.
- PlayCanvas has first-class mesh and Gaussian support, WebGPU/WebGL2 backends, glTF, physics integration, animation, audio, and TypeScript APIs.
- WebRTC APIs are naturally accessible in the webview.
- The Rust core can be reused by a desktop authority and a headless self/managed-hosted node.
- A hybrid representation keeps gameplay deterministic and editable while allowing splats where they materially improve presentation.

## Consequences

### Positive

- One UI/runtime stack across editor and play views.
- Strong fit for downloadable local AI through Tauri sidecars.
- A practical Gaussian path exists without building a renderer from zero.
- Server parity is designed from the start without requiring server-rendered graphics.
- Mesh-only compatibility mode is always possible.

### Negative

- Webviews vary by operating system and driver; packaged behavior must be tested rather than inferred from a browser.
- PlayCanvas is less conventional for a native desktop game than Unity, Unreal, or Godot.
- Native plugins and deep render-pipeline changes may require JavaScript/WASM/native bridging.
- Shipping WebGPU and WebGL2 paths increases test surface.
- Gaussian/mesh depth, fog, transparency, and tone mapping may expose renderer limitations.

## Alternatives considered

### Godot 4

Advantages: open source, compact native runtime, strong scene editor, mature gameplay workflows, renderer tiers, and reusable headless logic.

Why not first: current Gaussian support depends on third-party/native extensions rather than an engine-level path, and the product would split more work between Godot UI/game code and the existing React/Rust ecosystem. Reconsider if the packaged PlayCanvas Gaussian or performance spikes fail.

### Unity

Advantages: mature asset/animation ecosystem and available Gaussian projects.

Why not first: larger runtime/editor footprint, licensing/product dependency, and less direct reuse of a Rust authority. Reconsider if creator tooling and renderer interoperability dominate development cost.

### Unreal Engine

Advantages: highest conventional rendering ceiling and strong world/lighting tools.

Why not first: installation, build, runtime, and content overhead conflict with the low-resource goal; local-AI and product UI integration would be heavier.

### Bevy or a custom Rust renderer

Advantages: maximum control and direct Rust integration.

Why not first: too much foundational editor, UI, asset, rendering, and Gaussian work before validating the game.

### Browser/PWA only

Advantages: simplest distribution and direct PlayCanvas/WebRTC path.

Why not first: local model/process access, filesystem control, offline asset management, and predictable performance are weaker. A spectator or lightweight client may come later.

### Splat-only scenes

Advantages: strong captured appearance and simple static viewing.

Why not: collision, animation, object editing, relighting, navigation, secrets, and low-memory fallback all need a separate semantic representation anyway. Making that representation explicit is safer than pretending splats are authoritative geometry.

## Validation criteria

Ratify this ADR only if a packaged Windows build demonstrates:

- stable mesh/PBR frame time on the planning compatibility and recommended profiles;
- bounded splat loading, rendering, cancellation, and memory reclamation;
- correct enough mesh/splat depth composition, fog, and tone mapping for the starter scenario;
- working WebRTC data/media and Tauri sidecars;
- acceptable simultaneous renderer, STT, 4B/0.6B LLM, and TTS behavior;
- no distribution-license blocker.

If Gaussian integration alone fails, keep the rest of the stack and postpone runtime splats. If the packaged renderer or webview fails broader performance/device coverage, compare Godot against the same benchmark before production scaffolding proceeds.
