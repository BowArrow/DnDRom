// Native smoke against the prepared Editor client or a packaged executable.
// The child alone owns its isolated profile and exits after both screenshots.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const options = process.argv.slice(2);
const option = name => { const index = options.indexOf(name); return index < 0 ? undefined : options[index + 1]; };
const packaged = option("--exe");
const scene = path.resolve(option("--scene") ?? path.join(root, "artifacts/unreal/atlas.dndscene"));
const engine = process.env.UE_ROOT ?? "C:/Program Files/Epic Games/UE_5.8";
const executable = packaged ? path.resolve(packaged) : path.join(engine, "Engine/Binaries/Win64/UnrealEditor.exe");
const project = path.join(root, "apps/unreal/DnDRom.uproject");
if (!existsSync(executable) || !existsSync(scene)) throw new Error("Build the Unreal client and export a .dndscene before running the smoke test.");
if (!packaged && (!existsSync(path.join(root, "apps/unreal/Binaries/Win64/UnrealEditor-DnDRom.dll")) || !existsSync(path.join(root, "apps/unreal/Content/Maps/World.umap")))) throw new Error("Run pnpm unreal prepare first. A game executable alone does not include the Editor module or prepared content.");
const profile = await mkdtemp(path.join(os.tmpdir(), "dndrom-unreal-smoke-"));
const resultDir = path.join(root, "artifacts/unreal-smoke", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(resultDir, { recursive: true });
const argv = [...(packaged ? [] : [project, "-game"]), "-windowed", "-RenderOffscreen", "-ResX=1920", "-ResY=1080", "-ForceRes", "-nosplash", "-unattended", `-DnDRomScene=${scene}`, `-DnDRomData=${profile}`, `-DnDRomSmokeOutput=${resultDir}`, `-abslog=${path.join(resultDir, "runtime.log")}`];
const child = spawn(executable, argv, { cwd: path.dirname(executable), windowsHide: true, stdio: "ignore", env: { ...process.env, LOCALAPPDATA: profile, APPDATA: profile, XDG_DATA_HOME: profile } });
let timedOut = false;
const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 240_000);
const heartbeat = setInterval(() => console.log("Unreal smoke is running; waiting for import, warmup and screenshots."), 30_000);
try {
  const code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
  if (timedOut || code !== 0) throw new Error(`Unreal smoke ${timedOut ? "timed out" : `exited with ${code}`}. Log: ${resultDir}`);
  const report = JSON.parse(await readFile(path.join(resultDir, "report.json"), "utf8"));
  const source = JSON.parse(await readFile(scene, "utf8"));
  const checks = {
    importComplete: report.importComplete === true,
    allMeshGroups: report.meshGroups === source.meshes.length,
    allInstances: report.instances === source.instances.length,
    materialsPresent: report.missingMaterials === 0,
    vertexColorsPreserved: report.vertexColorsChecked > 0 && report.vertexColorMismatches === 0,
    collision: report.centerCollisionHit === true && Boolean(report.hitEntityId),
    ownedRuntimeConnected: report.runtimeStatus === "Local runtime connected",
    overviewCaptured: existsSync(path.join(resultDir, "overview.png")),
    groundCaptured: existsSync(path.join(resultDir, "ground.png")),
  };
  const capture = await readFile(path.join(resultDir, "overview.png"));
  const resolution = { width: capture.readUInt32BE(16), height: capture.readUInt32BE(20) };
  checks.requestedResolution = resolution.width === 1920 && resolution.height === 1080;
  await writeFile(path.join(resultDir, "verification.json"), JSON.stringify({ scene, profile, resolution, report, checks, visualReviewRequired: true, minimumHardwarePerformanceVerified: false }, null, 2));
  console.log(JSON.stringify({ resultDir, checks, frameMillisecondsP95: report.frameMillisecondsP95 }, null, 2));
  if (Object.values(checks).some(value => !value)) throw new Error("Native smoke failed one or more checks. Inspect the report and screenshots.");
} finally {
  clearTimeout(timeout); clearInterval(heartbeat);
  if (child.exitCode === null && child.signalCode === null) child.kill();
}

