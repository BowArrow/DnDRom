import {spawn} from 'node:child_process';
import {writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {connectNative} from './native-cdp.mjs';
const root=path.resolve(import.meta.dirname,'..'),profile=path.join(root,'artifacts/camera-water-final-031');
const child=spawn(path.join(root,'artifacts/unreal-package/Windows/DnDRom/Binaries/Win64/DnDRom.exe'),['-windowed','-ResX=1920','-ResY=1080','-WinX=-20000','-WinY=-20000','-cefdebug=9338','-DnDRomAutomation',`-UserDir=${profile}/user`,`-DnDRomData=${profile}`,`-abslog=${profile}/navigation-runtime.log`],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let c;const heartbeat=setInterval(()=>console.log('Checking saved-world scene navigation and completed native imports.'),30000);
try{
 for(let i=0;i<90&&!c;i++){try{c=await connectNative();}catch{await pause(1000);}}assert(c);
 const native=(method,params={})=>c.evaluate(`window.ue.dndrom.dispatch(${JSON.stringify(JSON.stringify({method,params}))}).then(JSON.parse)`);
 const waitImport=async previous=>{for(let i=0;i<180;i++){const ready=await c.evaluate(`window.dndromSceneImport?.cacheReady&&window.dndromSceneImport.mapId!==${JSON.stringify(previous??'')}`);if(ready&&(await native('app.diagnostics')).importComplete)return c.evaluate('window.dndromSceneImport.mapId');await pause(500);}throw Error('Destination native import did not complete');};
 const start=await waitImport();const results=[];
 for(const name of ['Lakeshore Harbor mainland landing','Lakeshore Harbor']){
   const before=await c.evaluate('window.dndromSceneImport.mapId');
   await c.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='World scenes').click()");await pause(200);
   const started=Date.now();await c.evaluate(`[...document.querySelectorAll('.world-scene-list article')].find(e=>e.querySelector('h3').textContent===${JSON.stringify(name)}).querySelector('button').click()`);
   const mapId=await waitImport(before);await pause(1500);await native('app.capture');await pause(1800);await copyFile(path.join(profile,'native-capture.png'),path.join(profile,name==='Lakeshore Harbor'?'returned-harbor-ready.png':'mainland-ready.png'));
   results.push({name,mapId,readySeconds:(Date.now()-started)/1000,diagnostics:await native('app.diagnostics')});
 }
 assert.equal(results[1].mapId,start);
 await writeFile(path.join(profile,'scene-navigation-verified.json'),JSON.stringify({start,results},null,2));console.log('Both destination native imports completed; original harbor restored.');
}finally{
 clearInterval(heartbeat);c?.close();const close=spawn('powershell.exe',['-NoProfile','-File',path.join(root,'scripts/close-native-window.ps1'),'-AppProcessId',String(child.pid)],{windowsHide:true,stdio:'ignore'});await new Promise(r=>close.on('exit',r));for(let i=0;i<100&&child.exitCode===null;i++)await pause(100);if(child.exitCode===null)child.kill();
}
