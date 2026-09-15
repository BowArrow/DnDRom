// Focused native WebView harness against the local Vite app. Uses an isolated
// profile and never changes the user's saved campaigns or runtime settings.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const profile = await mkdtemp(path.join(os.tmpdir(), "dndrom-scene-review-"));
const port = 9347;
const child = spawn(path.join(root, "target/release/dndrom-desktop.exe"), [], { windowsHide: true, stdio: "ignore", env: { ...process.env, LOCALAPPDATA: profile, APPDATA: profile, WEBVIEW2_USER_DATA_FOLDER: path.join(profile, "webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
let concurrentInference;
try {
  let target;
  for (let attempt = 0; attempt < 100 && !target; attempt++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((item) => item.type === "page"); } catch {} if (!target) await delay(200); }
  if (!target) throw new Error("Native scene review did not start");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0; const pending = new Map(), errors = [];
  socket.onmessage = (event) => { const message = JSON.parse(String(event.data)); if (message.id) { const item = pending.get(message.id); pending.delete(message.id); message.error ? item.reject(message.error) : item.resolve(message.result); } else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text); };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const callId = ++id; const timeout = setTimeout(() => { pending.delete(callId); reject(new Error('Native review timed out: '+method)); }, 60_000); pending.set(callId, { resolve: value=>{clearTimeout(timeout);resolve(value)}, reject:error=>{clearTimeout(timeout);reject(error)} }); socket.send(JSON.stringify({ id: callId, method, params })); });
  socket.onclose = () => { for (const item of pending.values()) item.reject(new Error('Native WebView connection closed')); pending.clear(); };
  const evaluate = async (expression) => { const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; };
  await call("Runtime.enable"); await call("Page.enable");
  await call("Page.navigate", { url: "http://127.0.0.1:1420" });
  await delay(5000);
  const world = JSON.parse(await readFile(path.join(root, process.env.DNDROM_SCENE_FIXTURE || "artifacts/scene-director-world.json"), "utf8"));
  await evaluate(`(async () => { const source = await (await fetch('/src/App.tsx')).text(); const spec = source.match(/from\\s+["']([^"']*campaignStore[^"']*)["']/)?.[1]; if (!spec) throw Error('Live store module not found'); const {useCampaignStore} = await import(spec); globalThis.__sceneReviewStore = useCampaignStore; const state = useCampaignStore.getState(); useCampaignStore.setState({campaign: {...state.campaign, map: ${JSON.stringify(world)}}}); })()`);
  for (let attempt = 0; attempt < 80; attempt++) { const ready = await evaluate(`Number(document.querySelector('canvas')?.dataset.residentWorldChunks ?? 0) >= 16`); if (ready) break; await delay(500); }
  const inspect = await evaluate(`(async () => {
    const source = await (await fetch('/src/components/SceneViewport.tsx')).text();
    const spec = source.match(/from\\s+["']([^"']*playcanvas[^"']*)["']/)?.[1];
    if (!spec) return {error:'PlayCanvas module not found'};
    const pc = await import(spec); const app = pc.Application.getApplication();
    const renders = app.root.findComponents('render');
    const buildings = renders.filter(render => /LOD/.test(render.entity.name) && /masonry|timber|roof/.test(render.entity.name));
    globalThis.__sceneReviewBuildings = buildings;
    return { canvas: {...app.graphicsDevice.canvas.dataset}, buildings: buildings.slice(0,6).map(render=>({name:render.entity.name, materials:render.meshInstances.map(mesh=>({name:mesh.material.name,diffuse:mesh.material.diffuse.toString(),normal:mesh.material.normalMap?.name,albedo:mesh.material.diffuseMap?.name,ao:mesh.material.aoMap?.name,vertex:mesh.material.diffuseVertexColor,lighting:mesh.material.useLighting,colors:(()=>{const c=[];mesh.mesh.getColors(c);return c.slice(0,8)})(), normals:(()=>{const c=[];mesh.mesh.getNormals(c);return c.slice(0,9)})()}))}))}; })()`);
  console.log(JSON.stringify(inspect));
  if (!inspect.buildings?.length) throw new Error('Generated structures are missing from the live renderer');
  await mkdir(path.join(root, "artifacts"), { recursive: true });
  const screenshot = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(root, "artifacts/scene-forge-authored.png"), Buffer.from(screenshot.data, "base64"));
  if (process.env.DNDROM_SCENE_CONCURRENT_IMAGE === '1') {
    const inference = spawn(process.execPath, [path.join(root, 'scripts/verify-scene-material.mjs')], { cwd: root, windowsHide: true, stdio: 'ignore', env: process.env });
    concurrentInference = new Promise((resolve) => { inference.once('error', () => resolve(false)); inference.once('exit', code => resolve(code === 0)); });
  }
  if (process.env.DNDROM_SCENE_SURFACE) {
    console.log('Applying generated PBR surface');
    const surface = (await readFile(path.join(root, process.env.DNDROM_SCENE_SURFACE))).toString('base64');
    await evaluate(`(async () => {
      const {deriveMaterialMaps} = await import('/src/domain/materialProcessing.ts'); const {storeMaterialMap} = await import('/src/persistence/materialAssets.ts'); const {applySceneMaterials} = await import('/src/domain/sceneGrammar.ts');
      const blob = await (await fetch('data:image/png;base64,${surface}')).blob(); const maps = await deriveMaterialMaps(new File([blob],'jade.png',{type:'image/png'}),'stone',.7); const stored = {};
      for (const role of ['albedo','normal','roughness','metallic','ambientOcclusion']) stored[role] = await storeMaterialMap(maps[role]);
      const now = new Date().toISOString(); const asset = {id:'material-custom-jade-review',name:'Local jade tiles',target:'general',materialClass:'stone',maps:stored,projection:'uv',scale:.65,rotation:0,normalStrength:.7,roughness:1,metallic:0,seamScore:maps.seamScore,source:'local-ai',revisions:[],createdAt:now,updatedAt:now};
      const state = globalThis.__sceneReviewStore.getState();state.saveMaterialAsset(asset);state.replaceMap(applySceneMaterials(state.campaign.map,{roof:asset.id}));
    })()`);
    await delay(6000);
    const styled = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(root, 'artifacts/scene-forge-styled.png'), Buffer.from(styled.data, 'base64'));
    console.log('Styled scene captured');
  }
  if (process.env.DNDROM_SCENE_DIAGNOSE === "1") {
    await evaluate(`globalThis.__originalSceneMaterials = new Map(globalThis.__sceneReviewBuildings.flatMap(r => r.meshInstances.map(m=>[m,m.material.clone()]))); true;`);
    for (const [name, mutation] of [
      ['diffuse-only', 'mat.normalMap=null;mat.heightMap=null;mat.aoMap=null;mat.glossMap=null;mat.metalnessMap=null;'],
      ['without-diffuse', 'mat.diffuseMap=null;'],
      ['without-maps', 'mat.diffuseMap=null;mat.normalMap=null;mat.heightMap=null;mat.aoMap=null;mat.glossMap=null;mat.metalnessMap=null;'],
    ]) {
      await evaluate(`for (const [mesh, original] of globalThis.__originalSceneMaterials) { const mat=original.clone(); ${mutation} mat.update();mesh.material=mat; } true;`);
      await delay(1000);
      const shot = await call("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(root, 'artifacts/scene-forge-'+name+'.png'), Buffer.from(shot.data, "base64"));
    }
    await evaluate(`for (const render of globalThis.__sceneReviewBuildings) for (const mesh of render.meshInstances) { const mat=mesh.material; mat.aoMap=null;mat.glossMap=null;mat.metalnessMap=null;mat.update(); }`);
    await delay(1000);
    const noNormals = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(path.join(root, "artifacts/scene-forge-no-normals.png"), Buffer.from(noNormals.data, "base64"));
    await evaluate(`for (const render of globalThis.__sceneReviewBuildings) for (const mesh of render.meshInstances) { const mat=mesh.material; mat.diffuseMap=null;mat.normalMap=null;mat.heightMap=null;mat.aoMap=null;mat.glossMap=null;mat.metalnessMap=null;mat.emissive.set(.12,.12,.12);mat.emissiveVertexColor=true;mat.update(); }`);
    await delay(1000);
    const diagnostic = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(path.join(root, "artifacts/scene-forge-shading-diagnostic.png"), Buffer.from(diagnostic.data, "base64"));
  }
  if (errors.length) throw new Error(errors.join("\n"));
  for (let attempt = 0; attempt < 40; attempt++) { if (await evaluate(`localStorage.getItem('dndrom-campaign-v1') === 'dndrom:indexed-campaign:v1'`)) break; await delay(250); }
  console.log('Reloading saved scene');
  await call('Page.reload'); await delay(5000);
  const restored = await evaluate(`(async () => { const source=await(await fetch('/src/App.tsx')).text(); const spec=source.match(/from\\s+["']([^"']*campaignStore[^"']*)["']/)?.[1]; const {useCampaignStore}=await import(spec); const campaign=useCampaignStore.getState().campaign; return {hydrated:useCampaignStore.persist.hasHydrated(),mapId:campaign.map.id,entities:campaign.map.entities.length}; })()`);
  if (!restored.hydrated || restored.mapId !== world.id || restored.entities !== world.entities.length) throw new Error('Large generated campaign did not survive reload: '+JSON.stringify(restored));
  console.log('Large scene reload passed');
  if (concurrentInference && !await concurrentInference) throw new Error('Concurrent local image generation failed');
  if (concurrentInference) console.log('Concurrent rendering, reload and local image inference passed');
  console.log("Native scene review passed");
} finally {
  socket?.close(); child.kill(); await delay(500);
  if (concurrentInference) await concurrentInference;
  if (path.dirname(path.resolve(profile)) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('dndrom-scene-review-')) await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }).catch(() => {});
}
