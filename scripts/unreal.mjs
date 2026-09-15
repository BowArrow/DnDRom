// UE build entry point. Never installs Epic software, opens games during a
// build, or silently substitutes UEFN for the full engine.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, mkdir, copyFile, cp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = path.join(root, "apps/unreal/DnDRom.uproject");
const mode = process.argv[2] ?? "doctor";
const args = process.argv.slice(3);
function run(exe, argv, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, argv, { cwd: root, stdio: ["ignore","pipe","pipe"], windowsHide: true, ...options });
    let materialFailure=false,tail="";
    const inspect=data=>{tail=(tail+data.toString()).slice(-16000);if(/Failed to compile Material|doesn't have a valid ShaderMap/.test(tail))materialFailure=true;};
    child.stdout?.on("data",data=>{inspect(data);process.stdout.write(data);});
    child.stderr?.on("data",data=>{inspect(data);process.stderr.write(data);});
    child.once("error", reject);
    child.once("exit", code => code === 0 && !materialFailure ? resolve() : reject(new Error(materialFailure ? "Material shader compilation failed; refusing to distribute fallback materials." : `${path.basename(exe)} exited with ${code}`)));
  });
}
async function discover() {
  const candidates = [process.env.UE_ROOT, "C:/Program Files/Epic Games/UE_5.8"];
  try {
    const launcher = JSON.parse(await readFile(path.join(process.env.ProgramData ?? "C:/ProgramData", "Epic/UnrealEngineLauncher/LauncherInstalled.dat"), "utf8"));
    for (const app of launcher.InstallationList ?? []) if (app.AppName?.startsWith("UE_")) candidates.push(app.InstallLocation);
  } catch {}
  for (const candidate of candidates.filter(Boolean)) {
    try {
      const version = JSON.parse(await readFile(path.join(candidate, "Engine/Build/Build.version"), "utf8"));
      if (version.MajorVersion === 5 && version.MinorVersion === 8 && existsSync(path.join(candidate, "Engine/Binaries/Win64/UnrealEditor.exe"))) return path.resolve(candidate);
    } catch {}
  }
  return null;
}
async function main() {
  if (!["doctor", "host", "build", "build-game", "prepare", "package", "editor", "play"].includes(mode)) throw new Error("Usage: pnpm unreal <doctor|host|build|build-game|prepare|package|editor|play> [--scene <file>]");
  if (process.platform !== "win32") throw new Error("This migration build currently targets Windows x64.");
  const host = async () => {
    await run("cargo", ["build", "--release", "-p", "dndrom-runtime-host"]);
    const destination = path.join(root, "apps/unreal/Binaries/Win64"); await mkdir(destination, { recursive: true });
    await copyFile(path.join(root, "target/release/dndrom-runtime-host.exe"), path.join(destination, "dndrom-runtime-host.exe"));
  };
  if (mode === "host") return host();
  const ui = async () => {
    await run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm.cmd --filter @dndrom/desktop build"]);
    for (const relative of ["apps/unreal/WebUI", "artifacts/unreal-package/Windows/DnDRom/WebUI"]) {
      const directory = path.join(root, relative);
      if (existsSync(directory)) {
        const resolved = await realpath(directory);
        if (resolved.toLowerCase() !== directory.toLowerCase() || !resolved.toLowerCase().startsWith(root.toLowerCase() + path.sep)) throw new Error("Generated UI directory resolves outside its expected workspace path");
        // Copy over generated files below. Keeping unused content-hashed UI
        // assets is harmless and avoids deleting an archive being inspected.
      }
    }
    await cp(path.join(root, "apps/desktop/dist"), path.join(root, "apps/unreal/WebUI"), { recursive: true });
    await mkdir(path.join(root,"apps/unreal/WebUI/licenses"),{recursive:true});
    await copyFile(path.join(root,"docs/third-party/SimpleHydrology.txt"),path.join(root,"apps/unreal/WebUI/licenses/SimpleHydrology.txt"));
  };
  const engine = await discover();
  // One canonical brand icon for the executable, bootstrap launcher and installer.
  // UE's Windows resource compiler and staging pipeline read this exact path.
  const iconDirectory = path.join(root, "apps/unreal/Build/Windows");
  await mkdir(iconDirectory, { recursive: true });
  await copyFile(path.join(root, "apps/desktop/src-tauri/icons/icon.ico"), path.join(iconDirectory, "Application.ico"));
  if (!engine) throw new Error("Full Unreal Engine 5.8 was not found. Install it through Epic Games Launcher, or set UE_ROOT to its installation folder. UEFN cannot compile this project.");
  const editor = path.join(engine, "Engine/Binaries/Win64/UnrealEditor.exe");
  const commandlet = path.join(engine, "Engine/Binaries/Win64/UnrealEditor-Cmd.exe");
  const dotnet = path.join(engine, "Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.dll");
  // Build.bat selects Epic's bundled .NET and the installed MSVC/Windows SDK.
  // Use cmd only for this fixed build command, never filesystem operations.
  const batch = async (name, parameters) => {
    if (parameters.some(p => /["\r\n&|<>^%!]/.test(p))) throw new Error("Unsupported shell character in Unreal build path or argument");
    const file = path.join(engine, "Engine/Build/BatchFiles", name);
    if (/["\r\n&|<>^%!]/.test(file)) throw new Error("Unsupported shell character in engine path");
    await run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `""${file}" ${parameters.map(p => `"${p}"`).join(" ")}"`], { windowsVerbatimArguments: true });
  };
  if (mode === "doctor") {
    if (!existsSync(dotnet) || !existsSync(commandlet)) throw new Error("Unreal installation is incomplete; C++ build tools or commandlet are missing.");
    const sdkRoot = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Windows Kits/NETFXSDK");
    const { readdir } = await import("node:fs/promises");
    const sdkVersions = await readdir(sdkRoot).catch(() => []);
    const netFxSdk = sdkVersions.find(version => existsSync(path.join(sdkRoot, version, "Include/um/mscoree.h")));
    console.log(JSON.stringify({ engine, project, version: "5.8", target: { vramGb: 8, ramGb: 16 }, netFxSdk: netFxSdk ? path.join(sdkRoot, netFxSdk) : "Not found in Windows Kits; Editor builds require .NET Framework SDK 4.6 or later", next: netFxSdk ? "pnpm unreal prepare" : "Visual Studio Installer: add .NET Framework 4.8 SDK. pnpm unreal build-game can compile the game target independently." }, null, 2)); return;
  }
  const build = async (target = "DnDRomEditor") => { await host(); await batch("Build.bat", [target, "Win64", "Development", `-Project=${project}`, "-WaitMutex", "-NoHotReloadFromIDE"]); };
  const prepare = async () => {
    const receipt = path.join(root, `artifacts/unreal-prepare-${randomUUID()}.json`);
    await mkdir(path.dirname(receipt), { recursive: true });
    await run(commandlet, [project, "-unattended", "-nop4", "-stdout", "-FullStdOutLogOutput", "-run=pythonscript", `-script=${path.join(root, "scripts/unreal/prepare_content.py")}`], { env: { ...process.env, DNDROM_REPO_ROOT: root, DNDROM_PREPARE_RECEIPT: receipt } });
    if (!existsSync(receipt) || JSON.parse(await readFile(receipt, "utf8")).ready !== true) throw new Error("Unreal content preparation failed; inspect the editor log. A zero commandlet exit code alone is not success.");
    if (!existsSync(path.join(root, "apps/unreal/Content/Maps/World.umap"))) throw new Error("Content preparation did not create the boot map.");
  };
  if (mode === "build") return build();
  if (mode === "build-game") return build("DnDRom");
  if (mode === "prepare") { await build(); return prepare(); }
  if (mode === "package") {
    await ui();
    await build(); await prepare();
    await batch("RunUAT.bat", ["BuildCookRun", `-project=${project}`, "-noP4", "-platform=Win64", "-clientconfig=Development", "-build", "-cook", "-stage", "-pak", "-iostore", "-archive", `-archivedirectory=${path.join(root, "artifacts/unreal-package")}`, "-utf8output"]);
    console.log("Unreal archive built. Run the packaged smoke and memory tests before distributing it."); return;
  }
  if (!existsSync(path.join(root, "apps/unreal/Content/Maps/World.umap"))) throw new Error("Run pnpm unreal prepare first to build the module, materials and boot map.");
  const launch = [project]; if (mode === "play") launch.push("-game", "-windowed", "-ResX=1920", "-ResY=1080");
  if (args.length) {
    if (args.length !== 2 || args[0] !== "--scene" || !existsSync(args[1])) throw new Error("Expected --scene <existing .dndscene file>");
    launch.push(`-DnDRomScene=${path.resolve(args[1])}`);
  }
  await run(editor, launch);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
