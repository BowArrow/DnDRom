import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { connectNative } from "./native-cdp.mjs";
const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const archive = path.resolve(option("--archive") ?? path.join(root, "artifacts/unreal-package/Windows"));
const profile = path.resolve(option("--profile") ?? path.join(root, "artifacts/native-install-smoke"));
const port = Number(option("--port") ?? 9338);
assert(Number.isInteger(port) && port >= 1024 && port <= 65535);
await mkdir(profile, { recursive: true });
const checks = {}, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function boot(suffix) {
  const child = spawn(path.join(archive, "DnDRom/Binaries/Win64/DnDRom.exe"), ["-windowed", "-ResX=1600", "-ResY=900", "-WinX=-20000", "-WinY=-20000", `-cefdebug=${port}`, "-DnDRomAutomation", `-UserDir=${path.join(profile, "user")}`, `-DnDRomData=${profile}`, `-abslog=${path.join(profile, `${suffix}.log`)}`], { windowsHide: true, stdio: "ignore" });
  let cdp;
  try {
    const deadline = Date.now() + 120000;
    while (!cdp && Date.now() < deadline) { try { cdp = await connectNative(port); } catch { await pause(1000); } if (child.exitCode !== null) throw new Error(`App exited ${child.exitCode}`); }
    if (!cdp) throw new Error("Native app did not boot");
    while (Date.now() < deadline && !await cdp.evaluate("!!window.ue?.dndrom && !!document.querySelector('.native-scene-viewport')")) await pause(250);
    const native = (method, params = {}) => cdp.evaluate(`window.ue.dndrom.dispatch(${JSON.stringify(JSON.stringify({ method, params }))}).then(JSON.parse)`);
    while (Date.now() < deadline) { const result = await native("app.diagnostics"); if (result.importComplete && result.instances > 0) break; await pause(1000); }
    return { child, cdp, native };
  } catch (error) { cdp?.close(); child.kill(); throw error; }
}
async function close(app) {
  app.cdp.close();
  const closer = spawn("powershell.exe", ["-NoProfile", "-File", path.join(root, "scripts/close-native-window.ps1"), "-AppProcessId", String(app.child.pid)], { windowsHide: true, stdio: "ignore" });
  await new Promise(resolve => closer.on("exit", resolve));
  for (let i = 0; i < 300 && app.child.exitCode === null; i++) await pause(100);
  if (app.child.exitCode === null) { app.child.kill(); throw new Error("Native app did not shut down gracefully"); }
  assert.equal(app.child.exitCode, 0, "Native app exited abnormally");
}
let app;
try {
  app = await boot("first-launch");
  const ui = await app.cdp.evaluate("({bridge:!!window.ue?.dndrom,viewport:!!document.querySelector('.native-scene-viewport'),text:document.body.innerText})");
  assert(ui.bridge && ui.viewport); checks.embeddedCampaignUi = true;
  const tray = await app.cdp.evaluate("({catalogueButtons:document.querySelectorAll('.catalogue-launch-button').length,height:document.querySelector('.asset-grid').getBoundingClientRect().height})");
  assert.equal(tray.catalogueButtons, 1); assert(tray.height > 300); checks.assetTrayHasRoom = true;
  assert(await app.cdp.evaluate("[...document.querySelectorAll('.asset-grid .asset-card')].slice(0,10).every(card=>{const label=card.querySelector(':scope > span:not(.asset-prop-glyph)');return !label || label.clientHeight >= 17;})")); checks.assetLabelsFit = true;
  await app.cdp.evaluate("document.querySelector('.catalogue-launch-button').click()");
  await pause(200);
  assert.equal(await app.cdp.evaluate("document.querySelectorAll('.catalogue-tabs [role=tab]').length"), 4);
  await app.cdp.evaluate("document.querySelector('.catalogue-tabs button').click()"); await pause(200);
  assert(await app.cdp.evaluate("document.querySelectorAll('.asset-catalogue-grid article').length > 30")); checks.catalogueSwitching = true;
  await pause(700); // Wait for the modal entrance transform before aiming at its resize corner.
  const dialog = await app.cdp.evaluate("document.querySelector('.asset-catalogue-modal').getBoundingClientRect().toJSON()");
  await app.cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: dialog.right - 3, y: dialog.bottom - 3, button: "left", clickCount: 1 });
  await pause(100);
  for (let step = 1; step <= 6; step++) {
    await app.cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: dialog.right - 3 - step * 20, y: dialog.bottom - 3 - step * 10, button: "left", buttons: 1 });
    await pause(80);
  }
  await app.cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: dialog.right - 123, y: dialog.bottom - 63, button: "left", clickCount: 1 });
  await pause(300);
  const resizedDialog = await app.cdp.evaluate("document.querySelector('.asset-catalogue-modal').getBoundingClientRect().toJSON()");
  assert(resizedDialog.width < dialog.width - 60, JSON.stringify({ before: dialog, after: resizedDialog })); checks.catalogueResizing = true;
  await app.cdp.evaluate("document.querySelector('.asset-catalogue-modal .modal-close').click()");
  const divider = await app.cdp.evaluate("document.querySelector('.resize-left').getBoundingClientRect().toJSON()");
  const beforeWidth = await app.cdp.evaluate("document.querySelector('.asset-palette').getBoundingClientRect().width");
  await app.cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: divider.x + 4, y: divider.y + 150, button: "left", clickCount: 1 });
  await app.cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: divider.x + 68, y: divider.y + 150, button: "left", buttons: 1 });
  await app.cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: divider.x + 68, y: divider.y + 150, button: "left", clickCount: 1 });
  await pause(300);
  const expectedWidth = await app.cdp.evaluate("document.querySelector('.asset-palette').getBoundingClientRect().width");
  assert(expectedWidth >= beforeWidth + 30); checks.panelDragging = true;
  const report = await app.native("app.diagnostics");
  assert(report.importComplete && report.instances > 0 && report.missingMaterials === 0 && report.vertexColorMismatches === 0); checks.nativeGeometryAndMaterials = true;
  const viewport = await app.cdp.evaluate("document.querySelector('.native-scene-viewport').getBoundingClientRect().toJSON()");
  const x = viewport.x + viewport.width * .5, y = viewport.y + viewport.height * .5;
  const drag = async (modifiers = 0, button = "middle", buttons = 4) => {
    await app.cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, buttons, modifiers, clickCount: 1 });
    for (let step = 1; step <= 4; step++) {
      await app.cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + step * 15, y: y + step * 5, button, buttons, modifiers });
      await pause(60);
    }
    await app.cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: x + 60, y: y + 20, button, buttons: 0, modifiers, clickCount: 1 });
    await pause(500);
    return app.native("app.diagnostics");
  };
  const separation = (a, b, prefix) => Math.hypot(...["X", "Y", "Z"].map(axis => a[prefix + axis] - b[prefix + axis]));
  await app.native("scene.input", { kind: "frame" });
  const framed = await app.native("app.diagnostics");
  const orbited = await drag();
  assert(separation(framed, orbited, "camera") > .1);
  assert(separation(framed, orbited, "pivot") < .001);
  assert(Math.abs(framed.cameraDistance - orbited.cameraDistance) < .001);
  checks.middleMouseOrbit = true;
  const panned = await drag(8); // CDP shift modifier.
  assert(separation(orbited, panned, "pivot") > .1);
  assert(Math.abs(separation(orbited, panned, "camera") - separation(orbited, panned, "pivot")) < .001);
  assert(Math.abs(panned.cameraYaw - orbited.cameraYaw) < .001);
  checks.shiftMiddleMousePan = true;
  await app.cdp.call("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: -240 });
  await pause(500);
  const zoomed = await app.native("app.diagnostics");
  assert(zoomed.cameraDistance < panned.cameraDistance * .9);
  assert(separation(panned, zoomed, "pivot") < .001); checks.wheelZoom = true;
  const dolly = await drag(2); // Ctrl + middle mouse.
  assert(dolly.cameraDistance > zoomed.cameraDistance); checks.controlMiddleMouseZoom = true;
  const flown = await drag(0, "right", 2);
  assert(Math.abs(flown.cameraYaw - dolly.cameraYaw) > 1);
  assert(separation(flown, dolly, "camera") < .001); checks.rightMouseLook = true;
  const stopped = await app.native("app.diagnostics"); await pause(400);
  assert(separation(stopped, await app.native("app.diagnostics"), "camera") < .001); checks.navigationRelease = true;
  await app.cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Home", code: "Home", windowsVirtualKeyCode: 36 });
  await app.cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Home", code: "Home", windowsVirtualKeyCode: 36 });
  await pause(500);
  const moved = await app.native("app.diagnostics");
  assert(separation(moved, framed, "camera") < .001); checks.frameAll = true;
  assert.equal(moved.instances, report.instances); checks.navigationPreservesGeometry = true;
  const invalid = await app.native("upload.begin", { kind: "download", name: "../escape.json" }); assert(invalid.error); checks.exportPathValidation = true;
  const transfer = await app.native("upload.begin", { kind: "scene" });
  await app.native("upload.chunk", { id: transfer.id, text: "{}" });
  const rejected = await app.native("upload.commit", { id: transfer.id }); assert(rejected.error);
  const preserved = await app.native("app.diagnostics"); assert.equal(preserved.instances, moved.instances); checks.invalidScenePreservesCurrent = true;
  // Exercise the cooked custom material, rather than accepting a fallback shader.
  const material = await app.native("upload.begin", { kind: "material", name: "smoke-custom" });
  await app.native("upload.chunk", { id: material.id, text: JSON.stringify({ id: "smoke-custom", maps: {}, roughness: .7, metallic: 0 }) });
  assert(!(await app.native("upload.commit", { id: material.id })).error); checks.customMaterialLoads = true;
  assert((await app.native("upload.inline", {kind:"tile",name:"0/0/0",encoding:"gzip-base64",uncompressedBytes:129*1024*1024,text:"AAAA"})).error); checks.compressedSizeLimit=true;
  assert((await app.native("upload.inline", {kind:"tile",name:"0/0/0",encoding:"gzip-base64",uncompressedBytes:64,text:"AAAA"})).error); checks.corruptCompressionRejected=true;
  assert((await app.native("upload.inline",{kind:"scene",text:JSON.stringify({meshes:[{id:"native-tree-v2/missing",prototypeRef:"native-tree-v2/missing"}]})})).error);checks.missingPrototypeRejected=true;
  const synced=await app.native("world.sync",{visible:[],remove:[]});assert(synced.worldSync&&synced.importComplete);checks.combinedWorldSync=true;
  await app.cdp.evaluate("localStorage.setItem('dndrom-native-install-smoke','persisted')");
  // Atmosphere capture and eye adaptation need several frames after an import.
  await pause(10000); await app.native("app.capture"); await pause(2000);
  await close(app); app = undefined;
  app = await boot("second-launch");
  assert.equal(await app.cdp.evaluate("localStorage.getItem('dndrom-native-install-smoke')"), "persisted"); checks.persistentCampaignStorage = true;
  assert.equal(await app.cdp.evaluate("document.querySelector('.asset-palette').getBoundingClientRect().width"), expectedWidth); checks.panelSizePersists = true;
  await close(app); app = undefined; checks.gracefulRestart = true;
  const logs = await Promise.all(["first-launch", "second-launch"].map(name => readFile(path.join(profile, `${name}.log`), "utf8")));
  assert(!logs.some(log => /Fatal error:|Unhandled Exception:|Ensure condition failed:|Failed to compile Material/.test(log))); checks.noNativeCrashesOrEnsures = true;
  await writeFile(path.join(profile, "report.json"), JSON.stringify({ archive, checks, native: report, minimumHardwareVerified: false }, null, 2));
  console.log(JSON.stringify({ profile, checks }, null, 2));
} catch (error) { console.error(error); throw error; }
finally { if (app) await close(app); }
