# DnDRom 0.3.9: character imports and Windows branding

This update fixes the character drawing picker, PDF character sheet import, the overlapping gameplay mesh target text, and accidental activation of Unreal's gameplay debugger. The installer, uninstaller and native application use the existing DnDRom icon.

## Causes and changes

- Unreal 5.8's packaged browser blocks file dialogs unless `[Browser] bAllowFileDialogsInClientBuilds=True`. The app now enables it, restoring ordinary file inputs across character, asset and campaign screens. This was verified against the installed engine's `CEFWebBrowserWindow.cpp::OnFileDialog` implementation.
- The embedded file server now serves `.mjs` modules as JavaScript. PDF.js's worker is such a module, so a successfully selected PDF must also be served with a valid module content type.
- Native testing uncovered `Uint8Array.toHex` being unavailable in Unreal's bundled Chromium. Both the PDF.js API and worker now use Mozilla's matching `legacy/build` distribution, including its compatibility implementations. PDF parsing remains local.
- The gameplay debugger's activation key is `None`, freeing apostrophes for normal typing and preventing the AI/BehaviorTree development overlay from appearing during use.
- The mesh target label, numeric value and longer explanation occupy separate rows, with wrapping at narrow widths. The field-specific rule takes precedence over the app's generic two-column slider styling.
- `scripts/unreal.mjs` copies the existing tracked `apps/desktop/src-tauri/icons/icon.ico` into Unreal's `Build/Windows/Application.ico` before compilation and staging. `scripts/unreal-installer.mjs` uses the same icon for NSIS install/uninstall resources. Future builds inherit these settings.

## Validation

All six character smoke checks passed using actual Windows file dialogs opened by UI clicks. The test cancels and reopens drawing selection, selects a local PNG and checks its preview, selects a small PDF form, checks the parsed character's review, and attaches it to the campaign. No CDP file-input injection bypasses the file picker. Measured mesh-field bounds do not overlap at 300 px or 240 px. The native screenshot after sending apostrophe shows no gameplay debugger overlay, and the field's text is visibly separated. TypeScript compilation, native build and cooking also passed.

Evidence: `artifacts/character-039-release/`, `artifacts/native-039-smoke/`, `artifacts/icons-039/`, and `artifacts/installer-039-verification.json`. Initial failing captures/logs in the other `character-039*` folders document the PDF compatibility and CSS override findings; they are not passing release evidence.

The icon check passed for the native executable, bootstrap launcher and installer: their extracted 32 px pixels match the original ICO's PNG image exactly. All 523 application payload files match the tested archive by SHA-256, and the 0.3.8 installer is unchanged. The packaged app also passed all 26 general smoke checks, including camera controls, saved storage, clean restart and absence of native crashes or ensures.

Installer: 799,295,702 bytes. SHA-256: `856e1248e505af4928f496d6a822079215a9b2ac43e9b2de5240df00508a1dad`.

## Install

Close DnDRom, install `artifacts/installers/DnDRom-Unreal-0.3.9-x64-setup.exe`, and reopen the campaign. No world rebuild is required. Existing campaign data, local models and previous installers are retained. This patch does not change terrain, water or settlement generation, and does not claim to fix distant-generation performance.
