import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {connectNative} from './native-cdp.mjs';
const root=path.resolve(import.meta.dirname,'..'),profile=path.resolve(process.argv[2]??path.join(root,'artifacts/native-terrain-review-'+Date.now()));
await mkdir(profile,{recursive:true});
const require=createRequire(path.join(root,'apps/desktop/package.json'));
await require('esbuild').build({stdin:{contents:'export {createStarterCampaign} from "./apps/desktop/src/domain/seed"; export {selectAtlasTiles,tileKey} from "./apps/desktop/src/domain/worldAtlas";',resolveDir:root},outfile:path.join(profile,'seed.mjs'),bundle:true,platform:'node',format:'esm'});
const {createStarterCampaign,selectAtlasTiles,tileKey}=await import(pathToFileURL(path.join(profile,'seed.mjs')));
const campaign=createStarterCampaign();campaign.name='Terrain review';campaign.map=JSON.parse(await readFile(path.join(root,'artifacts/atlas-world.json'),'utf8'));campaign.scenes=[];delete campaign.activeSceneId;campaign.settings.localAiRuntime='disabled';
const campaignPath=path.join(profile,'terrain.dndrom');await writeFile(campaignPath,JSON.stringify(campaign));
const child=spawn(path.join(root,'artifacts/unreal-package/Windows/DnDRom/Binaries/Win64/DnDRom.exe'),['-windowed','-ResX=1600','-ResY=900','-WinX=-20000','-WinY=-20000','-cefdebug=9338','-DnDRomAutomation',`-UserDir=${profile}/user`,`-DnDRomData=${profile}`,`-abslog=${profile}/runtime.log`],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let cdp;
const heartbeat=setInterval(()=>console.log('Terrain review is waiting for native imports and eroded world tiles.'),30000);
try{
  for(let i=0;i<90&&!cdp;i++){try{cdp=await connectNative();}catch{await pause(1000);}}
  assert(cdp,'Native browser did not start');
  const native=(method,params={})=>cdp.evaluate(`window.ue.dndrom.dispatch(${JSON.stringify(JSON.stringify({method,params}))}).then(JSON.parse)`);
  for(let i=0;i<90;i++){if(await cdp.evaluate("!!window.ue?.dndrom && !!document.querySelector('.native-scene-viewport')"))break;await pause(500);}
  await pause(3000);
  const scene=await readFile(path.join(root,'artifacts/terrain-after.dndscene'),'utf8');
  const transfer=await native('upload.begin',{kind:'scene'});
  for(let i=0;i<scene.length;i+=96000)assert(!(await native('upload.chunk',{id:transfer.id,text:scene.slice(i,i+96000)})).error);
  assert(!(await native('upload.commit',{id:transfer.id})).error);
  for(let i=0;i<90;i++){if((await native('app.diagnostics')).importComplete)break;await pause(500);}
  await native('scene.environment',{interior:false,lighting:{keyIntensity:1,iblIntensity:1,mood:'natural'}});
  await pause(8000);
  const capture=async name=>{await native('app.capture');await pause(1500);await copyFile(path.join(profile,'native-capture.png'),path.join(profile,name+'.png'));};
  await capture('mountains-overview');
  await native('scene.input',{kind:'navigate',zoom:-.45,pitch:12,yaw:20});await pause(1500);await capture('mountains-low');
  const mountainReport=await native('app.diagnostics');assert.equal(mountainReport.missingMaterials,0);assert.equal(mountainReport.vertexColorMismatches,0);
  await cdp.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Session').click()");await pause(400);
  const {root:document}=await cdp.call('DOM.getDocument');const {nodeId}=await cdp.call('DOM.querySelector',{nodeId:document.nodeId,selector:'input[accept=".dndrom,application/json"]'});assert(nodeId,'Campaign import input missing');
  await cdp.call('DOM.setFileInputFiles',{nodeId,files:[campaignPath]});
  const waitNear=async()=>{
    for(let i=0;i<300;i++){
      const state=await native('app.diagnostics'),ready=new Set(state.readyTiles);
      const near=selectAtlasTiles(state.cameraX,state.cameraZ,campaign.map).desired.filter(tile=>tile.level<=4);
      const visible=new Set(state.visibleTiles??[]);
      if(state.importComplete&&state.instances>100&&near.length&&near.every(tile=>ready.has(tileKey(tile))&&visible.has(tileKey(tile))))return state;
      await pause(1000);
    }
    throw new Error('Complete nearby terrain coverage never arrived');
  };
  const streamed=await waitNear();
  await pause(5000);await capture('village-streamed');
  await native('scene.input',{kind:'navigate',zoom:.4,pitch:8,yaw:25});await waitNear();await pause(15000);await capture('village-distance');
  const end=await native('app.diagnostics');assert(end.worldTiles<=512);assert.equal(end.missingMaterials,0);
  await writeFile(path.join(profile,'report.json'),JSON.stringify({mountainReport,streamed,end,checks:{nativeMountainImport:true,materials:true,nearWorldStreamed:true,boundedTileCache:true}},null,2));
  console.log(JSON.stringify({profile,tiles:end.worldTiles,nearTiles:end.readyTiles.filter(id=>id.startsWith('0/')).length}));
}finally{
  clearInterval(heartbeat);cdp?.close();
  const closer=spawn('powershell.exe',['-NoProfile','-File',path.join(root,'scripts/close-native-window.ps1'),'-AppProcessId',String(child.pid)],{windowsHide:true,stdio:'ignore'});await new Promise(r=>closer.on('exit',r));
  for(let i=0;i<300&&child.exitCode===null;i++)await pause(100);if(child.exitCode===null)child.kill();
}
