# Dice Forge

Dice Forge is the local asset workflow for customizing DnDRom's physical dice without changing deterministic roll authority or Rapier collision geometry.

## Surface format

Every die uses the same 2048 × 1024, seamless 2:1 material surface. The renderer projects it independently onto every face, bevel, and rounded corner with aspect-correct texel density, eliminating spherical pole pinching and directional stretching across d4, d6, d8, d10, d12, d20, and percentile geometry. Engraved numbers remain separate runtime decals, so a material can be reused across shapes while number and outline colors remain adjustable.

The **Download PNG template** action produces a labeled neutral surface with longitude, latitude, center, and wrap-seam guides. **Download prompt + PBR guide** produces a text prompt suitable for an opt-in cloud image tool or another local generator. DnDRom does not send the template, prompt, or result to a cloud provider itself.

## Supported PBR maps

- Albedo/base color in sRGB, without baked lighting.
- OpenGL normal map (+Y).
- Roughness: white is matte, black is glossy.
- Metallic: white is metal, black is dielectric resin/plastic.
- Ambient occlusion: white is unoccluded.

PNG, JPEG, and WebP files from 256 × 128 through 4096 × 2048 are accepted when their aspect ratio is 2:1. Each file is capped at 32 MB. Blobs are content-addressed in local IndexedDB; campaign JSON stores only theme metadata and hashes.

## Creation paths

1. **Paint:** download the PNG, paint it in any image editor, then import the albedo and optional PBR companions.
2. **Cloud AI, opt-in:** download the template/guide or copy the generated prompt, use a provider chosen by the player, and import the resulting albedo. No cloud service is required or contacted by DnDRom.
3. **Local AI:** press **Generate texture with local AI**. DnDRom automatically starts or provisions the same private loopback image runtime used by Scenery Studio, produces a seamless surface, normalizes it to the template, and derives editable normal, roughness, metallic, and AO starters.
4. **Imported PBR:** replace any generated map individually. Saving merges changed maps with the theme's existing maps.

Themes can be assigned to one die family or the complete set. Tray icons inherit the assigned body and number colors; thrown meshes load the full PBR theme while preserving the existing authoritative result and randomized physics.
