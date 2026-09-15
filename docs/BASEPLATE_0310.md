# Scenic baseplates — 0.3.10

The scenic base editor now generates both concept prompts from the current description. It no longer reuses the second preset's subject or labels a requested pond as tavern floorboards. Changing the description, terrain preset, or height invalidates the previous image approval. Cancelled jobs cannot attach late results.

## Height and assignment

- **Scenery height** controls the maximum height as a percentage of base width: 4–40%, default 10%. Both image prompts receive the selected limit, including plants and props. The resulting geometry is also fitted within that limit.
- Generated scenery occupies the full base footprint and replaces the visible generic plinth and painted rim once loaded. Until then, the generic base remains as loading coverage.
- The miniature stands on the central surface, rather than on the tallest peripheral prop. Height changes update its position in the preview.
- Assigned bases appear in the main character preview and native tabletop. An empty character-sheet ID no longer suppresses the token's default base assignment.
- Existing generated layers named `AI scenic mesh` are recognized. New layers record an explicit base-surface role. The new recipe field is optional; old recipes use the 10% default.

Use **Save revision** to persist an edited plate and **Confirm assignment** when assigning it to a token or form. No campaign rebuild is required. The installer was built without modifying user campaign data, and the previous 0.3.9 installer remains unchanged.

## Validation

- Desktop production build and Unreal build/cook/package succeeded. The final desktop bundle was copied into the packaged application's WebUI before installer creation.
- 38 focused tests passed across nine files: concept subjects and labels, height prompts, cancellation, geometry fitting, legacy compatibility, assignments, native model variants, and viewport integration.
- All 26 packaged native smoke checks passed, including camera controls, material loading, campaign persistence, and restart. Evidence: `artifacts/native-0310-smoke/report.json`.
- The packaged scenic-base visual test passed with five mesh instances, zero missing materials, an assigned base in Character Forge, and changing support heights at 8% and 30%. Evidence: `artifacts/baseplate-0310/native-release/report.json`.
- The installer was extracted and all 534 payload files matched the packaged archive byte for byte. The launcher, native executable, and installer icons matched the canonical DnDRom icon.

The visual checks use controlled GLB fixtures to verify placement and height, not AI-generated artwork. Image-provider responses in component tests are mocked. No fresh Sana/Pixal3D generation was performed for this release, so the artistic quality of new generated images remains unverified. Height fitting can compress an overly tall generated mesh; prompt guidance aims to avoid that shape initially. Minimum-hardware performance is not established by these checks.

## Visual comparison

These deliberately simple fixtures isolate the fitted plate and miniature. The black platform in the character preview is the preview stage; the native tabletop capture shows the assigned plate without that stage.

| 8% maximum scenery height | 30% maximum scenery height |
| --- | --- |
| ![Low plate fixture](../artifacts/baseplate-0310/native-release/low-base.png) | ![Higher plate fixture](../artifacts/baseplate-0310/native-release/higher-base.png) |

[Assigned plate in the native tabletop](../artifacts/baseplate-0310/native-release/native-assigned-base.png) · [Assigned plate in Character Forge](../artifacts/baseplate-0310/native-release/character-assigned-base.png)

## Installer

`artifacts/installers/DnDRom-Unreal-0.3.10-x64-setup.exe`

- Size: 811,487,153 bytes
- SHA-256: `1149cef72466575570dd068d82e96ae8f9d82fde70b14645362b641cc72c17e8`
- Payload verification: `artifacts/installer-0310-verification.json`
- Previous installer preserved: `DnDRom-Unreal-0.3.9-x64-setup.exe`
