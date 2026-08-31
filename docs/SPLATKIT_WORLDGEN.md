# Local AI World Finishing with ComfyUI-SplatKit

DnDRom integrates the open-source workflow demonstrated in Mickmumpitz's **We Open Sourced World Generation** video:

- Video: https://www.youtube.com/watch?v=eJuYBNrD8HI
- ComfyUI-SplatKit: https://github.com/mickmumpitz/ComfyUI-SplatKit
- Matrix-3D: https://github.com/SkyworkAI/Matrix-3D
- Brush trainer: https://github.com/ArthurBrussee/brush
- LichtFeld Studio: https://github.com/MrNeRF/LichtFeld-Studio
- PlayCanvas SplatTransform: https://github.com/playcanvas/splat-transform

## What the integration does

1. DnDRom creates the story, structured world, settlements, POIs, and authoritative low-cost mesh map.
2. The creator opens **AI scenery studio** and either supplies a 2:1 panorama or chooses **Prompt locally** with the official workflow `0_generate_360_panorama-upscale.json` exported in ComfyUI API format.
3. Prompt mode offers a searchable offline scene-idea catalog. It queues workflow 0 against loopback ComfyUI, captures the generated panorama, then feeds it into workflow `1_generate-dataset-hires.json`. Upload mode starts directly from the creator's panorama.
4. DnDRom patches only positive prompts, uploads images only to loopback ComfyUI, queues the workflows, and monitors completion.
5. SplatKit runs panorama -> MoGe geometry -> controlled WAN fly-through -> SphereSfM -> COLMAP dataset.
6. The creator trains that dataset in Brush, LichtFeld, or another COLMAP-compatible 3DGS trainer.
7. DnDRom imports the resulting Gaussian `.ply`, compressed `.ply`, or bundled `.sog`, stores it in local IndexedDB by SHA-256, and renders it with PlayCanvas.

If a workflow directly returns a PLY or SOG output, DnDRom downloads and imports it automatically. The standard SplatKit dataset workflow stops at COLMAP, so training is normally a separate creator step.

## Setup

Install ComfyUI and ComfyUI-SplatKit using the upstream instructions. Supply the WAN 2.1 image-to-video checkpoint and the Matrix-3D panorama LoRA required by the selected official workflow. Start ComfyUI with API access from the desktop webview; for a typical local setup this may require the ComfyUI CORS option:

```powershell
python main.py --listen 127.0.0.1 --port 8188 --enable-cors-header
```

Keep the server bound to loopback unless you intentionally secure it for a trusted network. In ComfyUI, enable developer options and export the upstream workflow in **API format**. The ordinary UI workflow JSON is not executable through `/prompt`.

DnDRom enforces that boundary: Scenery Studio rejects any ComfyUI hostname other than `localhost`, `127.0.0.1`, or `::1`. It contains no company generation endpoint and performs no automatic catalog search. The optional Poly Haven link simply opens the source in the user's browser; no prompt or campaign data is sent with it.

Poly Haven was linked by the reference video and its assets are CC0. Its hosted public API currently has separate non-commercial access terms, so DnDRom does not call or mirror that API. A native online browser should only be enabled after obtaining appropriate commercial API permission. The built-in idea catalog is code-local and generates through the user's own ComfyUI instead.

## Resource tiers

This is optional creator-time processing, not a play-time dependency. Matrix-3D's upstream 5B low-VRAM route documents approximately 12 GB VRAM, while larger paths require more; the video workflow's WAN 2.1 14B path should be treated as a quality-tier job. DnDRom therefore never downloads these models with the base installer and never blocks a campaign on their availability.

Imported splats are capped at 512 MB per file. The renderer applies a two-million-visible-splat budget. For distribution, convert cleaned PLY assets to SOG with SplatTransform; SOG is PlayCanvas' recommended web-delivery format.

## Gameplay and portability boundaries

- Splats are presentation-only and often contain baked lighting. They do not replace collision, navigation, doors, secrets, tokens, or dynamic lights.
- The procedural mesh scene remains authoritative and is the automatic low-resource fallback.
- Imported binary scenery is stored on the current device. Campaign JSON contains the content hash and metadata, not hundreds of megabytes of binary data. Another device must receive/import the same asset until content-addressed multiplayer asset transfer is implemented.
- Never queue untrusted workflow JSON. ComfyUI custom nodes execute local code with the user's permissions.

## Licensing

ComfyUI-SplatKit is MIT licensed and preserves notices for its vendored MIT components. The optional SphereSfM binary and every downloaded model/checkpoint have their own terms. DnDRom records the pipeline provenance but does not redistribute the workflow, model weights, SphereSfM binary, or trainers in its installer. Generated-asset commercial rights must be evaluated from the exact models and inputs selected by the creator.
