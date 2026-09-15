// Package the verified native archive into a per-user Windows installer.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const archive = path.join(root, "artifacts/unreal-package/Windows");
const nsis = process.env.MAKENSIS ?? path.join(process.env.LOCALAPPDATA, "tauri/NSIS/makensis.exe");
const output = path.join(root, "artifacts/installers/DnDRom-Unreal-0.3.13-x64-setup.exe");
const icon = path.join(root, "apps/desktop/src-tauri/icons/icon.ico");
for (const file of [icon, nsis, path.join(archive, "DnDRom.exe"), path.join(archive, "DnDRom/WebUI/index.html"), path.join(archive, "DnDRom/Binaries/Win64/dndrom-runtime-host.exe")]) {
  if (!existsSync(file)) throw new Error(`Missing build prerequisite: ${file}. Run pnpm unreal package first.`);
}
await mkdir(path.dirname(output), { recursive: true });
const redist = path.join(process.env.UE_ROOT ?? "C:/Program Files/Epic Games/UE_5.8", "Engine/Extras/Redist/en-us/vc_redist.x64.exe");
if (!existsSync(redist)) throw new Error("Unreal prerequisites installer is missing from the engine.");
await mkdir(path.join(archive, "Prerequisites"), { recursive: true });
await copyFile(redist, path.join(archive, "Prerequisites/vc_redist.x64.exe"));
const walk = async directory => {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(full));
    else if (!/\.(pdb|log|tmp)$/i.test(entry.name) && !["Launch Preview.cmd", "README.txt"].includes(entry.name) && !full.includes(`${path.sep}Sample${path.sep}`)) result.push(path.relative(archive, full));
  }
  return result.sort();
};
const files = await walk(archive);
const escape = value => value.replaceAll("$", "$$").replaceAll('"', '$\\"');
const directories = [...new Set(files.flatMap(file => { const result = []; for (let dir = path.dirname(file); dir !== "."; dir = path.dirname(dir)) result.push(dir); return result; }))];
const install = files.map(file => `SetOutPath "$INSTDIR\\${escape(path.dirname(file))}"\nFile "${escape(path.join(archive, file))}"`).join("\n");
const uninstall = [...files.map(file => `Delete "$INSTDIR\\${escape(file)}"`), ...directories.sort((a, b) => b.length - a.length).map(dir => `RMDir "$INSTDIR\\${escape(dir)}"`)].join("\n");
// Refuse replacement/removal while native/CEF binaries are still shutting down.
// Checking every executable/library also covers the private runtime host.
const lockFiles = files.filter(file => /\.(exe|dll)$/i.test(file));
const checkClosed = prefix => `Function ${prefix}CheckAppClosed
retry:
${lockFiles.map((file, i) => `IfFileExists "$INSTDIR\\${escape(file)}" 0 next_${i}\nClearErrors\nFileOpen $0 "$INSTDIR\\${escape(file)}" a\nIfErrors busy\nFileClose $0\nnext_${i}:`).join("\n")}
Return
busy:
MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Close DnDRom and wait for it to finish shutting down, then select Retry." /SD IDCANCEL IDRETRY retry
SetErrorLevel 2
Abort
FunctionEnd`;
const script = `Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!define MUI_ICON "${escape(icon)}"
!define MUI_UNICON "${escape(icon)}"
Name "DnDRom Unreal"
OutFile "${escape(output)}"
InstallDir "$LOCALAPPDATA\\Programs\\DnDRom-Unreal"
InstallDirRegKey HKCU "Software\\DnDRom\\Unreal" "InstallDir"
RequestExecutionLevel user
SetCompressor zlib
VIProductVersion "0.3.13.0"
VIAddVersionKey /LANG=1033 "ProductName" "DnDRom Unreal"
VIAddVersionKey /LANG=1033 "FileDescription" "DnDRom native Windows installer"
VIAddVersionKey /LANG=1033 "FileVersion" "0.3.13"
VIAddVersionKey /LANG=1033 "LegalCopyright" "DnDRom"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\\DnDRom.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
${checkClosed("")}
${checkClosed("un.")}
Section "DnDRom Unreal"
SetShellVarContext current
SetRegView 64
Call CheckAppClosed
${install}
ReadRegDWORD $0 HKLM "SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64" "Installed"
StrCmp $0 1 prereqs_done
ExecWait '"$INSTDIR\\Prerequisites\\vc_redist.x64.exe" /quiet /norestart' $1
StrCmp $1 0 prereqs_done
StrCmp $1 3010 prereqs_done
MessageBox MB_ICONSTOP "Required Windows components could not be installed. Run the prerequisites setup in the installation folder, then start DnDRom."
SetErrorLevel 1
prereqs_done:
WriteUninstaller "$INSTDIR\\Uninstall.exe"
CreateDirectory "$SMPROGRAMS\\DnDRom Unreal"
CreateShortcut "$SMPROGRAMS\\DnDRom Unreal\\DnDRom Unreal.lnk" "$INSTDIR\\DnDRom.exe"
CreateShortcut "$SMPROGRAMS\\DnDRom Unreal\\Uninstall.lnk" "$INSTDIR\\Uninstall.exe"
CreateShortcut "$DESKTOP\\DnDRom Unreal.lnk" "$INSTDIR\\DnDRom.exe"
WriteRegStr HKCU "Software\\DnDRom\\Unreal" "InstallDir" "$INSTDIR"
WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DnDRomUnreal" "DisplayName" "DnDRom Unreal"
WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DnDRomUnreal" "DisplayVersion" "0.3.13"
WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DnDRomUnreal" "UninstallString" '$\\"$INSTDIR\\Uninstall.exe$\\"'
WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DnDRomUnreal" "DisplayIcon" "$INSTDIR\\DnDRom.exe"
WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DnDRomUnreal" "NoModify" 1
WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DnDRomUnreal" "NoRepair" 1
SectionEnd
Section "Uninstall"
SetShellVarContext current
SetRegView 64
Call un.CheckAppClosed
${uninstall}
Delete "$INSTDIR\\Uninstall.exe"
RMDir "$INSTDIR"
Delete "$DESKTOP\\DnDRom Unreal.lnk"
Delete "$SMPROGRAMS\\DnDRom Unreal\\DnDRom Unreal.lnk"
Delete "$SMPROGRAMS\\DnDRom Unreal\\Uninstall.lnk"
RMDir "$SMPROGRAMS\\DnDRom Unreal"
DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DnDRomUnreal"
DeleteRegKey HKCU "Software\\DnDRom\\Unreal"
; Campaigns, models, exports, and Chromium storage live outside INSTDIR.
SectionEnd
`;
const source = path.join(root, "artifacts/installers/DnDRom-Unreal.nsi");
await writeFile(source, script);
await writeFile(path.join(root, "artifacts/installers/native-file-manifest.json"), JSON.stringify(files, null, 2));
await new Promise((resolve, reject) => {
  const child = spawn(nsis, ["/V2", source], { stdio: "inherit", windowsHide: true });
  child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`NSIS exited ${code}`)));
});
console.log(output);



