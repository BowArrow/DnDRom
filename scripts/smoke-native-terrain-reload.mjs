import {spawn} from 'node:child_process';
import {writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {connectNative} from './native-cdp.mjs';
const root=path.resolve(import.meta.dirname,'..'),profile=path.join(root,'artifacts/native-reference-terrain3');
const started=Date.now(),pause=ms=>new Promise(r=>setTimeout(r,ms));
const child=spawn(path.join(root,'artifacts/unreal-package/Windows/DnDRom/Binaries/Win64/DnDRom.exe'),['-windowed','-ResX=1600','-ResY=900','-WinX=-20000','-WinY=-20000','-cefdebug=9338','-DnDRomAutomation',`-UserDir=${profile}/user`,`-DnDRomData=${profile}`,`-abslog=${profile}/reload.log`],{windowsHide:true,stdio:'ignore'});
let cdp,firstVisibleMs,report;
const heartbeat=setInterval(()=>console.log('Checking terrain cache reuse and visible native tiles.'),30000);
try{
  for(let i=0;i<90&&!cdp;i++){try{cdp=await connectNative();}catch{await pause(1000);}}
  assert(cdp);const native=(method,params={})=>cdp.evaluate(`window.ue.dndrom.dispatch(${JSON.stringify(JSON.stringify({method,params}))}).then(JSON.parse)`);
  for(let i=0;i<180;i++){
    if(!await cdp.evaluate('!!window.ue?.dndrom')){await pause(1000);continue;}
    report=await native('app.diagnostics');
    if(report.visibleTiles?.length&&!firstVisibleMs)firstVisibleMs=Date.now()-started;
    if(report.visibleTiles?.filter(id=>id.startsWith('0/')).length>=25&&report.visibleTiles.length>=100)break;
    await pause(1000);
  }
  assert(firstVisibleMs,'Terrain never became visible on reload');assert(report.visibleTiles.length>=100,'Nearby terrain did not finish loading');
  await native('app.capture');await pause(1500);await copyFile(path.join(profile,'native-capture.png'),path.join(profile,'reload-terrain.png'));
  await writeFile(path.join(profile,'reload-report.json'),JSON.stringify({firstVisibleMs,nearCoverageMs:Date.now()-started,visibleTiles:report.visibleTiles.length,nearTiles:report.visibleTiles.filter(id=>id.startsWith('0/')).length,cacheProfileReused:true},null,2));
  console.log({firstVisibleMs,visibleTiles:report.visibleTiles.length});
}finally{
  clearInterval(heartbeat);cdp?.close();
  const closer=spawn('powershell.exe',['-NoProfile','-File',path.join(root,'scripts/close-native-window.ps1'),'-AppProcessId',String(child.pid)],{windowsHide:true,stdio:'ignore'});await new Promise(r=>closer.on('exit',r));
  for(let i=0;i<300&&child.exitCode===null;i++)await pause(100);if(child.exitCode===null)child.kill();
}
