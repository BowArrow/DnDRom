# Third-Party Notices

## System Reference Document 5.2.1

This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

DnDRom implements compatible mechanics from the SRD. DnDRom is not endorsed by, sponsored by, or affiliated with Wizards of the Coast LLC.

## Kenney Mini Dungeon

The bundled Mini Dungeon GLB asset pack is by Kenney and released under CC0 1.0 Universal. Its source and original notice are preserved under `apps/desktop/public/assets/kenney/mini-dungeon/`.

## Optional ComfyUI-SplatKit Integration

DnDRom can connect to a separately installed copy of ComfyUI-SplatKit by mickmumpitz, licensed under the MIT License: https://github.com/mickmumpitz/ComfyUI-SplatKit. DnDRom bundles copies of its published `0_generate_360_panorama-upscale.json` and `1_generate-dataset-hires.json` workflow presets for immediate selection. DnDRom does not bundle its executable node code, model weights, SphereSfM binary, or training applications. Those optional components retain their own licenses and notices.

## Optional Pixal3D and TRELLIS.2 Integration

DnDRom automatically downloads a pinned ComfyUI portable runtime plus native Core Pixal3D, TRELLIS.2, MoGe 2, and BiRefNet model files from the Comfy-Org repositories on first use. ComfyUI and those repackaged model repositories identify these components as MIT-licensed. DnDRom bundles the reference `pixal3d_test_jester.json` workflow attached to ComfyUI PR #14718 and adapts its native Pixal3D/TRELLIS.2 lane locally. The installer does not embed ComfyUI or model weights; downloaded components retain their upstream terms. Generated asset rights depend on the selected model and source image.

## Optional Sana and Krea Prop Image Packs

Prop Forge can install a pinned Sana 1.5 1.6B workflow and model pack for lightweight local reference generation. Sana is developed by NVIDIA and its source and model terms remain available at https://github.com/NVlabs/Sana. An optional Krea 2 local pack is isolated from the world-generation packages and requires explicit acceptance of Krea's community license and attribution requirements before installation: https://www.krea.ai/krea-2-licensing. Hosted Krea API use is separately billed and opt-in; its credential is stored in the operating-system credential manager rather than project data.

## Optional ComfyUI-UniRig Integration

DnDRom's local creation-suite installer downloads an unmodified, pinned source archive of ComfyUI-UniRig by Andrea Pozzetti from https://github.com/PozzettiAndrea/ComfyUI-UniRig. ComfyUI-UniRig is licensed under GPL-3.0 and contains its own license and source notice. Its isolated MIA/UniRig dependencies and model weights are downloaded on first auto-rig use and retain their respective upstream terms. DnDRom communicates with the separately running local ComfyUI process over its loopback API; ComfyUI-UniRig is not linked into the DnDRom executable.

HY-Motion descriptor generation is not bundled or silently installed. Its official weights require a high-memory GPU and use the HY-Motion community license; users must review and accept that upstream license before any future optional motion-pack installation.

## Optional Poly Haven Online Library

Scenery Studio can browse Poly Haven's public API and download a user-selected tone-mapped HDRI panorama. Poly Haven assets are released under CC0 1.0 Universal. Use of the hosted API is subject to Poly Haven's API terms and is attributed in the interface: https://polyhaven.com/our-api and https://polyhaven.com/license.

## Bundled Poly Haven PBR Materials

DnDRom bundles 1K CC0 texture maps from Poly Haven for distinct floorboard, furniture wood, structural wood, stone floor, masonry wall, natural rock, metal, cloth, leather, bark, grass, earth, plaster, and roof-tile materials. Their exact asset IDs, source pages, and channel packing are recorded in `apps/desktop/public/materials/polyhaven/manifest.json`. These maps provide scanned albedo, OpenGL normal, ambient-occlusion, roughness, and metalness data while remaining available fully offline: https://polyhaven.com/license.

## Bundled Interface Fonts

DnDRom bundles the Cinzel and EB Garamond typefaces so the interface renders as designed with no network access. Both are licensed under the SIL Open Font License 1.1, which permits redistribution as part of an application. Cinzel is by The Cinzel Project Authors (https://github.com/NDISCOVER/Cinzel) and EB Garamond is by The EB Garamond Project Authors (https://github.com/octaviopardo/EBGaramond12). The bundled Latin-subset WOFF2 builds, their exact provenance, and the full upstream license texts are preserved under `apps/desktop/public/fonts/`.

## Rapier Physics

Physical tabletop dice use the official `@dimforge/rapier3d-compat` rigid-body engine. Rapier is licensed under Apache-2.0 and its source is available at https://github.com/dimforge/rapier.
