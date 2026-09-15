# Shared-world validation — 2026-09-08

## Functional results

The final focused run passed **80 tests in 16 files** in 80.53 seconds. It covers world ownership, climate coverage/continuity, rain-shadow and drainage fixtures, stable forest candidates, graded roads/bridges/ferries, complete building programs, near/far footprints, environment layers, malformed local-model output and repair bounds, worker cancellation/stale-result rejection, campaign persistence, compact export recovery, native coverage selection, terrain seams and the existing water-field/wave regressions. This is a focused suite, not a claim that every unrelated repository test passes.

Receipt: [delivery test log](../artifacts/shared-world-delivery-tests.log).

```powershell
pnpm.cmd --filter @dndrom/desktop exec vitest run src/domain/sharedWorld.test.ts src/domain/sharedWorldFiles.test.ts src/domain/worldEnvironment.test.ts src/domain/sharedWorldClient.test.ts src/ai/worldDirector.test.ts src/domain/buildingAccess.test.ts src/state/campaignPersistence.test.ts src/persistence/campaignStorage.test.ts src/migration/nativeAtlasVisibility.test.ts src/migration/nativeWorldRoads.test.ts src/migration/nativeChunkSeams.test.ts src/migration/nativeAtlasWater.test.ts src/migration/nativeWaterField.test.ts src/migration/unrealScene.test.ts src/domain/worldAtlas.test.ts src/domain/sceneGrammar.test.ts --testTimeout 180000
```

The real eroded-terrain fixture has four connected locations:

| Connection | Transport | Length | Maximum road grade |
| --- | --- | ---: | ---: |
| Island harbor → mainland landing village | Ferry | 1,277.68 m | — |
| Mainland → forest gameplay location | Road | 1,148.09 m | 14.5% |
| Forest → mountain gameplay location | Road | 3,467.68 m | 15.963% |

The harbor has all 36 required buildings and the mainland village has 11. Appending the forest and mountain preserved the two existing locations. The accepted plan is [connected-world.json](../artifacts/shared-island-world/connected-world.json). Reproduce with `node scripts/verify-shared-world.mjs --island`, then `node scripts/verify-shared-connections.mjs --island`.

`node scripts/verify-shared-determinism.mjs` verified bitwise-equal samples of the actual eroded field under reversed generation order and cache eviction, manifest serialization, and identical positions, rotations and entrances for all 47 near/far building footprints. [Determinism receipt](../artifacts/shared-world/determinism-report.json).

## Packaged runtime and visual checks

The native Windows archive builds successfully. The packaged scene smoke passed geometry import, material availability, vertex colors, real terrain collision, app-owned runtime connection and 1920×1080 captures. Its fixed-camera p95 was 16.667 ms. Runtime connection is not evidence that a language model was actively generating during measurement. [Native smoke receipt](../artifacts/shared-world-native-smoke3.log).

The four-location island plan passed the moving-camera coverage test: no previously covered test point lost terrain; the cache stayed within its configured bound; materials were present. This test included refinement after camera movement and recorded stalls. [Island streaming receipt](../artifacts/shared-island-native-review/report.json).

The portable-import check uses the packaged UI to import a compact campaign, regenerate the local scene and start distant streaming. Its campaign is approximately 1.2 MB. [Portable import receipt](../artifacts/shared-island-portable-delivery/report.json).

### Visual comparison

Before the full-precision UV correction, large world coordinates caused a visible terrain checkerboard:

![Before: terrain UV quantization](../artifacts/unreal-smoke/2026-09-08T22-00-40-916Z/overview.png)

The same fixture after the correction:

![After: continuous terrain material coordinates](../artifacts/unreal-smoke/2026-09-08T22-07-52-747Z/overview.png)

The connected island world with distant terrain, forests and settlements:

![Connected island world](../artifacts/shared-island-native-review/village-far-angle.png)

Ground inspection of shared terrain and settlement foundations:

![Ground inspection](../artifacts/shared-island-native-review/seam-ground.png)

The coverage probe and screenshots are evidence for the exercised camera paths, not proof that every possible view is artifact-free.

## Timing and memory

Measurements are from an RTX 3080 10 GB / 32 GB workstation. They are not minimum-spec certification. The cold planning run and island streaming review overlapped in time and therefore include CPU contention.

| Work | Cold | Cached |
| --- | ---: | ---: |
| Fresh-origin harbor + mainland site/layout/connection planning | 186.08 s | 42.71 s |
| Detailed starting-scene compilation | 28.60 s | 25.58 s |
| Native scene export | 2.77 s | 2.97 s |
| Island-specific planning with all 36 + 11 buildings | Not separately isolated | 47.92 s |
| Append forest + mountain to the island world | — | 36.70 s |

Cold planning generated 34 erosion fields, with 165.76 seconds spent in field simulation. Planner RSS at the final sample was about 583 MiB; that sample is **not peak memory**. [Cold report](../artifacts/shared-fresh-world/report.json). The verification script now also writes a peak-RSS receipt on exit for subsequent runs.

The earlier ordinary-harbor streaming test filled all nearby coverage in 44.21 seconds, with moving-view p95 about 28.9 ms. The island review reached the same coverage criterion in 134.81 seconds and included frame-time spikes during mesh arrivals. The final empty-profile portable import recorded first visible distant coverage at 58.261 s, a restored playable scene at 74.332 s, all-near coverage at 150.499 s, and peak native process RAM of 3,019,251,712 bytes (2.81 GiB). This run overlapped installer compression and is not an isolated performance benchmark. Peak native process memory excludes separate Chromium and model-runtime processes; it must not be presented as whole-application peak RAM or VRAM.

The 8 GB VRAM / 16 GB RAM target at 1080p/30 FPS **with local AI active is unverified**. Cold generation and refinement speed remain optimization work.

## Installer

`artifacts/installers/DnDRom-Unreal-0.3.0-x64-setup.exe` is 725,998,065 bytes. SHA-256: `92A8197D923048FD5C7046D8E51C6353414C94174F19F7305F328BBEBAC8B5D2`. NSIS compilation and archive integrity checks succeeded. All 431 extracted application files matched the tested archive by SHA-256: [payload receipt](../artifacts/shared-world-installer-payload.json). The extraction tool came from the [official 7-Zip release page](https://www.7-zip.org/download.html). The packaged executable and UI were tested in isolated profiles; the installer was not run over the user installation. Extracted payload files remain in `artifacts/installer-payload-030` as validation evidence.

The previous 0.2.6 installer is preserved, with unchanged SHA-256 `4E42CE18F7208B99C99EEB012E9CA5A38E2B73B4F9B59F6BBED7B9251EA2D820`.
