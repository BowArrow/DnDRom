import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {connectNative} from './native-cdp.mjs';
const root=path.resolve(import.meta.dirname,'..'),profile=path.join(root,'artifacts/settlement-038/native'),require=createRequire(path.join(root,'apps/desktop/package.json'));
const archive=path.resolve(process.env.DNDROM_TEST_ARCHIVE??path.join(root,'artifacts/unreal-package/Windows'));
await mkdir(profile,{recursive:true});
await require('esbuild').build({stdin:{contents:'export {createStarterCampaign} from "./apps/desktop/src/domain/seed";',resolveDir:root},outfile:path.join(profile,'seed.mjs'),bundle:true,platform:'node',format:'esm'});
const {createStarterCampaign}=await import(pathToFileURL(path.join(profile,'seed.mjs'))),campaign=createStarterCampaign();
campaign.map=JSON.parse(await readFile(path.join(root,'artifacts/local-first-033/map.json'),'utf8'));
campaign.world=JSON.parse(await readFile(path.join(root,'artifacts/site-failure-032/recovered-world.json'),'utf8'));
// Isolate the saved layout and upgrade UI. The upgrade compiles its real terrain.
campaign.map.entities=campaign.map.entities.filter(e=>e.tags?.includes('world:building'));
campaign.scenes=[];delete campaign.activeSceneId;campaign.settings.localAiRuntime='disabled';
const file=path.join(profile,'legacy.dndrom');await writeFile(file,JSON.stringify(campaign));
const app=spawn(path.join(archive,'DnDRom/Binaries/Win64/DnDRom.exe'),['-windowed','-ResX=1600','-ResY=1000','-WinX=-20000','-WinY=-20000','-cefdebug=9339','-DnDRomAutomation',`-UserDir=${profile}/user`,`-DnDRomData=${profile}`,`-abslog=${profile}/runtime.log`],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let c;
const beat=setInterval(()=>console.log('Checking saved town upgrade in packaged UI.'),30000);
try{
 for(let i=0;i<90&&!c;i++){try{c=await connectNative(9339);}catch{await pause(1000);}}assert(c);await pause(5000);
 const native=(method,params={})=>c.evaluate(`window.ue.dndrom.dispatch(${JSON.stringify(JSON.stringify({method,params}))}).then(JSON.parse)`);
 const capture=async name=>{await native('app.capture');await pause(1300);await copyFile(path.join(profile,'native-capture.png'),path.join(profile,name+'.png'));};
 await c.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Session').click()");await pause(300);
 const {root:doc}=await c.call('DOM.getDocument'),{nodeId}=await c.call('DOM.querySelector',{nodeId:doc.nodeId,selector:'input[accept=".dndrom,application/json"]'});assert(nodeId);
 await c.call('DOM.setFileInputFiles',{nodeId,files:[file]});
 let initialReady=false;
 for(let i=0;i<240;i++){const d=await native('app.diagnostics');if(d.importComplete&&await c.evaluate(`!!document.querySelector('.settlement-upgrade-notice button') && window.dndromSceneImport?.cacheReady && window.dndromSceneImport.mapId===${JSON.stringify(campaign.map.id)} && window.dndromSceneImport.streamId===${JSON.stringify(d.streamId)}`)){initialReady=true;break;}await pause(500);}assert(initialReady,'Legacy scene never acknowledged readiness');
 assert(await c.evaluate("document.querySelector('.settlement-upgrade-notice button')?.textContent==='Upgrade town layout'"));
 await capture('legacy-notice');
 const started=Date.now(),previous=(await native('app.diagnostics')).streamId;
 await c.evaluate("document.querySelector('.settlement-upgrade-notice button').click()");
 for(let i=0;i<900;i++){
  const error=await c.evaluate("document.querySelector('.settlement-upgrade-notice [role=alert]')?.textContent");assert(!error,error);
  const done=await c.evaluate("!document.querySelector('.settlement-upgrade-notice') && window.dndromSceneImport?.cacheReady");
  const d=await native('app.diagnostics');
  if(done&&d.importComplete&&d.streamId!==previous&&await c.evaluate(`window.dndromSceneImport.streamId===${JSON.stringify(d.streamId)}`)){
   // A local architecture comparison, not a horizon-coverage test.
   await native('world.reveal',{enabled:false});await native('scene.input',{kind:'frame'});await pause(1200);await capture('updated-town');
   const saved=await c.evaluate(`(async()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('dndrom')&&localStorage.getItem(k)?.includes('indexed-campaign'));if(!key)throw Error('Expected persisted campaign');const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('dndrom-campaign-snapshots-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const value=await new Promise((resolve,reject)=>{const r=db.transaction('snapshots').objectStore('snapshots').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.close();const c=JSON.parse(value).state.campaign;return {locations:c.world.manifest.locations.map(l=>({id:l.id,version:l.settlement.version,buildings:l.settlement.buildings.map(b=>({id:b.id,yaw:b.yaw,position:b.position,family:b.program?.family}))})),scenes:c.scenes.map(s=>({id:s.id,location:s.map.locationId})),activeSceneId:c.activeSceneId}})()`);
   const location=saved.locations.find(l=>l.id===campaign.map.locationId);assert.equal(location.version,2);assert.equal(location.buildings.length,36);assert(new Set(location.buildings.map(b=>Math.round(b.yaw))).size>5);assert(new Set(location.buildings.map(b=>b.family)).size>=6);assert(saved.scenes.length>=2);assert.equal(d.missingMaterials,0);
   await writeFile(path.join(profile,'report.json'),JSON.stringify({seconds:(Date.now()-started)/1000,saved,native:d,previousSceneRetained:true,comparisonDisablesLoadingFog:true},null,2));console.log('Town upgrade passed');break;
  }
  if(i===899)throw Error('Town upgrade did not finish');await pause(1000);
 }
}finally{
 clearInterval(beat);c?.close();const close=spawn('powershell.exe',['-NoProfile','-File',path.join(root,'scripts/close-native-window.ps1'),'-AppProcessId',String(app.pid)],{windowsHide:true,stdio:'ignore'});await new Promise(r=>close.on('exit',r));
 for(let i=0;i<100&&app.exitCode===null;i++)await pause(100);if(app.exitCode===null)app.kill();
}
