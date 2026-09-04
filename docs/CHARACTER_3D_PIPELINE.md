# Local drawing-to-3D miniature pipeline

DnDRom's Character Forge turns a player drawing, enemy concept, or boss illustration into a textured tabletop miniature while keeping generation and storage on the user's machine.

## Referenced workflow

This integration follows PixelArtistry's August 26, 2026 video, [Best 3D AI Generator Now Runs Natively in ComfyUI! (Free & Local)](https://www.youtube.com/watch?v=o7VJnIN31Ds), and its linked native ComfyUI implementation:

- [ComfyUI PR #14718](https://github.com/Comfy-Org/ComfyUI/pull/14718) adds Pixal3D and TRELLIS.2 mesh/texture generation plus remesh, decimation, UV unwrap, and texture baking to ComfyUI Core.
- [Comfy-Org/Pixal3D](https://huggingface.co/Comfy-Org/Pixal3D) supplies the BF16 and Int8 model files and their expected ComfyUI folders.
- [Comfy-Org/TRELLIS.2](https://huggingface.co/Comfy-Org/TRELLIS.2) supplies the higher-resource model files.
- [Comfy-Org/MoGe](https://huggingface.co/Comfy-Org/MoGe) supplies the native geometry estimator used to infer camera and surface structure.
- [Comfy-Org/BiRefNet](https://huggingface.co/Comfy-Org/BiRefNet) supplies the native subject cutout model used before reconstruction.
- [Microsoft TRELLIS.2](https://github.com/microsoft/TRELLIS.2) documents the original image-to-3D and PBR GLB pipeline.

DnDRom bundles the reference workflow attached directly to the merged ComfyUI PR and switches its Pixal3D/TRELLIS.2 lane automatically. The pinned MoGe 2 and BiRefNet preprocessors are part of the same resumable setup pack. Multi-gigabyte model weights are downloaded from their upstream repositories on first use rather than inflating the base installer.

## Setup

There is no separate setup. Open **Build → Character Forge**, choose Pixal3D or TRELLIS.2, select a drawing, and press **Generate character now**. DnDRom selects the correct Windows portable engine for the detected GPU, checks disk space, downloads the pinned runtime and model files with resume support, verifies their sizes and SHA-256 hashes, installs them in the app-local data directory, starts a private loopback process on port `8189`, and continues generation automatically.

The center preview keeps a persistent five-stage progress card visible throughout that process. Setup reports verified download bytes; generation consumes ComfyUI's local WebSocket node and sampler events; elapsed time continues even when a long-running custom node cannot expose a granular percentage. HTTP history polling remains the completion authority, so a missing progress socket cannot lose or cancel a successful model.

Interrupted downloads resume the next time Generate is pressed. A custom UI-format or API-format workflow can still override the included preset for advanced users, but is never required.

Character Forge patches the drawing input, supported face-count fields, remesh/bake budget, and save prefix. Model selection, samplers, and any licenses remain under the user's control. Advanced workflow overrides are still constrained to the same gameplay asset ceiling before they are queued.

## Performance profiles

The video recommends Pixal3D Int8 for 6–8 GB VRAM and Pixal3D BF16 or TRELLIS.2 on larger GPUs. Treat those as starting profiles rather than guaranteed requirements. The original TRELLIS.2 repository documents a much larger 24 GB reference environment, while ComfyUI's newer quantized/offload path is different. Validate latency, peak VRAM, and output quality on each supported hardware tier.

DnDRom enforces a 20,000-triangle maximum per miniature across the Character Forge UI, bundled/custom ComfyUI workflows, completed generation imports, and manually imported GLBs. The forge can target 5,000–20,000 faces; 20,000 is the default high-quality tabletop tier. Before the expensive geometry stages, DnDRom constrains the shape cascade to 1024, preclusters dense decoder output to 300,000 vertices, remeshes at 256 with three smoothing passes, and preserves that compact remesh only as the optional surface reference for a 2048-pixel texture bake. The original multi-million-face decoder mesh is never used for texture back-projection. Imported GLBs are also capped at 128 MB and must be self-contained. Higher-quality source sculpting or baking in Blender remains useful, but the imported gameplay asset must be decimated to the runtime ceiling.

## Token behavior

- Roles: player, enemy, and boss.
- Bases: round, square, or hex, with editable body and rim colors.
- Player tokens can be associated with an existing character sheet.
- Each placed copy has independent rotation, visibility, notes, and scale.
- Uniform presets provide Small, Medium, Large, and Huge visual sizes; exact creature-space rules remain in the rules/encounter layer.
- The textured GLB and base are authoritative render geometry. Gaussian splats are never used for creatures, selection, collision, or movement.

## Paint, prompt revisions, and rigging

Character Forge includes a compact layered drawing editor in the center workspace: an icon tool rail with tooltips and keyboard shortcuts, a large uninterrupted canvas, and a contextual properties panel. Color strokes can use multiply blending to preserve dark line work, shadows and highlights remain separate layers, erasing removes only edit layers, and undo/redo never mutates the uploaded source. Applying the edit flattens a new PNG revision into the autosaved draft before 3D generation, while a separately persisted original remains available through **Restore upload**.

The **Magic AI brush** turns a canvas click into a boundary-aware region mask and runs a restrained local inpaint only inside that region. Users can choose paint or shade, select a foreground color, tune the selection tolerance and AI influence, and describe the intended material. **Shade character only** derives a foreground mask, protects the background, and composites the result through a luminosity layer so the existing palette and design remain authoritative. Manual color, shadow, highlight, AI-color, and AI-shade layers are independently reversible; AI output cannot replace unmasked pixels or the locked original.

For a generated character, **Prompt-edit current 3D style** keeps the current GLB geometry authoritative and runs the local edit against that mesh's material/texture surface. It does not return to the source drawing or rerun image-to-geometry creation. Before replacement, DnDRom pushes the current GLB into that style's bounded eight-version history, so appearance edits can be undone without losing the usable miniature.

**Auto-rig this style** uses the pinned [ComfyUI-UniRig](https://github.com/PozzettiAndrea/ComfyUI-UniRig) node pack. Humanoids use Make-It-Animatable for a fast Mixamo-compatible skeleton; non-humanoid creatures use the general UniRig path with the input bounded to the 20,000-face gameplay ceiling. The resulting FBX or GLB belongs to the selected form/style, is saved in the Forge draft and catalogue, and can be replaced or downloaded without replacing the authoritative visual GLB. A duplicated style inherits its form's compatible rig; a newly imported form starts unriggered because its topology may differ.

Rigging is the first stage, not the finished animation workflow. The Forge exposes three explicit stages: **Rig style**, **Author motion**, and **Save states**. Each form/style owns named idle, attack, ability, reaction, and transformation slots. A player writes the movement in ordinary language; DnDRom compiles that description into a deterministic, low-cost tabletop motion immediately. A reusable-motion picker can copy an authored motion from any other form/style while giving the copy an independent identity, so the player can share a motion or customize it afterward. Compatible animated GLBs use PlayCanvas' animation state graph for skeletal playback, while the compiled motion remains the fallback for static GLBs, attached FBX files, reduced hardware tiers, and missing optional AI tools.

The high-end descriptor-to-animation path is [HY-Motion 1.0](https://github.com/Tencent-Hunyuan/HY-Motion-1.0) through [ComfyUI-HY-Motion1](https://github.com/jtydhr88/ComfyUI-HY-Motion1): load the Lite network, load a quantized Qwen text encoder with CPU offload, encode a motion description, generate one 0.5–12 second motion, then retarget/export it against the Mixamo-compatible FBX. The official project currently specifies at least 24 GB VRAM for Lite, supports humanoids, does not guarantee seamless loops, and uses a community license. It therefore remains an explicit optional pack and never silently triggers the much larger scenery download. Generated or imported FBX/GLB sources are content-addressed with the token so authored work survives campaign changes.

Each catalogue character has a three-level history: **forms** represent topology-changing states such as humanoid/wolf shapeshifting; **styles** represent alternate appearances on a compatible form; and each style keeps bounded **versions** for undo. Every style owns its visual GLB, rig reference, and motion slots. The catalogue stores the reusable character once; each placed copy stores only its selected form/style and active motion, so two copies can transform independently. The miniature model animates beneath a stationary base and contact shadow, preserving tabletop grounding.

## Privacy and persistence

DnDRom's managed generation engine binds only to loopback. Drawings and workflow JSON are sent only to that local process. Source/current artwork, generated GLBs, per-style rigs, revisions, and motion sources are downloaded back into DnDRom and stored by SHA-256 in the local IndexedDB asset store. The Character catalogue can reopen the complete asset in Forge or add/remove it from the current campaign's Minis collection.

Campaign JSON stores token metadata, not the potentially large GLB bytes. A campaign opened on another device shows a fallback silhouette until that GLB is imported there. Multiplayer asset transfer is a separate protocol milestone; it should use content hashes, size limits, explicit host approval, and cached chunks.

## Current boundary

Generated miniatures can be auto-rigged, given prompt-authored motion slots, grouped into reusable multi-form tokens, saved, reopened in the Forge, and switched or animated per placed copy during play. Embedded animated-GLB tracks play skeletally; procedural profiles cover every token and keep the base planted. Retargeted FBX sources remain attached and downloadable, but browser-side FBX decoding/retargeting is not claimed—the authored runtime path is an animated GLB with the matching skeleton. Appearance never infers combat statistics or silently creates rules entities. Enemy and boss mechanics are created through the deterministic encounter/rules layer.
