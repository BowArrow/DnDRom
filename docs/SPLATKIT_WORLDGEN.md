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
2. The creator opens **AI scenery studio** and chooses **Prompt**, **Online library**, or **Upload**. The official `0_generate_360_panorama-upscale.json` and `1_generate-dataset-hires.json` presets are included and converted to API prompts against the running ComfyUI node definitions. No workflow download or Developer Mode export is required.
3. Prompt mode offers a searchable offline story-seed catalog. Online-library mode browses Poly Haven's live public HDRI catalog and downloads only the explicitly selected tone-mapped CC0 panorama. Upload mode starts from the creator's own image. A selected API workflow is cached locally for later runs.
4. DnDRom provisions and starts its private local engine automatically, patches only positive prompts, uploads images only to that loopback process, queues the workflows, and monitors completion.
5. SplatKit runs panorama -> MoGe geometry -> controlled WAN fly-through -> SphereSfM -> COLMAP dataset.
6. DnDRom's local result node measures total and per-rail camera registration, reconstruction connectivity, ground support, and scale before the dataset can advance.
7. DnDRom launches its installed Brush tool for 3,000â€“6,000 steps, periodically exports a recoverable PLY, and stops after a measured 250-step validation-loss plateau when a safe export already exists.
8. The validated result is cleaned, compressed, partitioned into Morton-ordered spatial tiles, stored in local IndexedDB by SHA-256, and streamed with PlayCanvas.

If a workflow directly returns a PLY or SOG output, DnDRom downloads and imports it immediately. When the standard SplatKit workflow returns a COLMAP dataset, DnDRom runs Brush and imports its exported PLY without another user step.

## Setup

There is no separate setup. Choose **Prompt**, **Online library**, or **Upload**, then press the generation button. On first use DnDRom checks disk space, downloads the pinned GPU-specific ComfyUI portable runtime, model files, custom-node archives, Python requirements, and Brush release, verifies the fixed-size artifacts and SHA-256 hashes, installs everything under the app-local data directory, starts its private loopback engine on port `8189`, and continues through the full workflow. Downloads are resumable and completed dependencies are reused.

DnDRom ships the upstream UI workflows and performs UI-graph-to-API conversion locally. Custom workflow overrides remain available for advanced users but are not required.

DnDRom enforces the generation boundary: Scenery Studio rejects any ComfyUI hostname other than `localhost`, `127.0.0.1`, or `::1`, and it contains no company generation endpoint. Opening the explicitly online **Poly Haven** tab requests the public catalog and thumbnails; selecting an HDRI downloads its public tone-mapped panorama. DnDRom does not send the campaign, scene prompt, or generated data to Poly Haven.

Poly Haven's assets are CC0. Its public API terms now allow commercial integrations without a key and require the live source to be clearly attributed, so the browser and selected-asset state both display **Poly Haven** attribution. Treat this hosted catalog as optional: loss of internet access never blocks prompt generation, uploads, existing maps, or play.

## Resource tiers

This is optional creator-time processing, not a play-time dependency. The default panorama and novel-view pack is large and should be treated as a quality-tier job. DnDRom keeps it out of the base installer and shows the one-time download size before generation; building and playing procedural mesh maps never depends on it.

All three reconstruction profiles preserve four continuous 81-frame camera rails and four WAN sampling steps. They reduce high-resolution panorama reprojection frequency and model residency, never the camera coverage used by SphereSfM:

| Profile | WAN conditioning | High-resolution anchors | Composite | Runtime visible splats |
| --- | ---: | ---: | ---: | ---: |
| Low memory | 640×320 | every fourth frame | 2048 px | 150,000 |
| Game (default) | 960×480 | every fourth frame | 4096 px | 450,000 |
| Reference | 1440×720 | every second frame | 8192 px | 850,000 |

SphereSfM receives all continuous rails. Retry reuses the panorama, completed COLMAP dataset, or trained world independently and refuses to import a one-rail result as a successful world. Generated scenery is grounded at reconstruction scale rather than stretched across the tabletop; low-registration, disconnected, implausibly scaled, sparse, or oversized-cloud output is rejected. Valid backgrounds are split into independently loadable tiles and only tiles in the conservative visible set consume normal render work. Imported splats are capped at 512 MB per file. For distribution, SOG tile packaging remains a later portability optimization.

## Gameplay and portability boundaries

- Splats are presentation-only and often contain baked lighting. They do not replace collision, navigation, doors, secrets, tokens, or dynamic lights.
- The procedural mesh scene remains authoritative and is the automatic low-resource fallback.
- Imported binary scenery is stored on the current device. Campaign JSON contains the content hash and metadata, not hundreds of megabytes of binary data. Another device must receive/import the same asset until content-addressed multiplayer asset transfer is implemented.
- Never queue untrusted workflow JSON. ComfyUI custom nodes execute local code with the user's permissions.

## Licensing

ComfyUI-SplatKit is MIT licensed and preserves notices for its vendored MIT components. Every downloaded model, node, binary, and input asset retains its upstream terms. DnDRom records the pipeline provenance and downloads large components from their upstream distribution locations rather than embedding them in the installer. Generated-asset commercial rights must be evaluated from the exact models and inputs selected by the creator.
