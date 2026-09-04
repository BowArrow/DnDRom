# Campaigns, scenes, and character ownership

DnDRom keeps three different lifetimes separate:

- Miniature GLB binaries and their reusable metadata belong to the local installation. A generated miniature is content-addressed in IndexedDB and available from every campaign.
- Character sheets and miniature links belong to a campaign. The same goblin model can be a minor enemy in one campaign and a named boss with a different sheet in another.
- Maps belong to campaign scenes. Switching scenes snapshots the active map before restoring the destination scene.

## Generation handoff

When the local character workflow returns a valid GLB, Character Forge stores it before reporting completion, adds it to the reusable Minis library, selects it as the active build asset, and leaves the rendered result open for review. If the application closed after generation but before an older build's manual library step, reopening the saved Forge draft attempts a one-time recovery into Minis.

## Campaign library

The campaign control in the application header opens the local library. Creating or switching campaigns first snapshots the current campaign and active scene. The active campaign is also persisted continuously by the Zustand store and written to the native application-data campaign folder by the desktop autosave path.

## Parallel and split-party scenes

The scene control above the tabletop opens the scene ledger. A scene stores its map, placed entities, lighting, scenery, party character IDs, notes, and timestamps. A new scene may branch from the current map or begin from a clean generated map. World travel restores an existing scene for that location when present instead of discarding prior edits.

## Character sheets

Party sheets can be created manually or imported from PDF/JSON. Identity, role, visibility, hit points, armor, speed, abilities, resources, actions, inventory, conditions, rests, and notes remain editable. The Miniature selector assigns the sheet to a reusable token only in the current campaign. Player-visible and DM-only visibility continues to apply during play.
