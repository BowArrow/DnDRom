import {spawn} from 'node:child_process';
import {writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {connectNative} from './native-cdp.mjs';
const root=path.resolve(import.meta.dirname,'..'),profile=path.join(root,'artifacts/settlement-038/native');
const app=spawn(path.join(root,'artifacts/installer-038-extracted/DnDRom/Binaries/Win64/DnDRom.exe'),['-windowed','-ResX=1600','-ResY=1000','-WinX=-20000','-WinY=-20000','-cefdebug=9339','-DnDRomAutomation',`-UserDir=${profile}/user`,`-DnDRomData=${profile}`,`-abslog=${profile}/revisit.log`],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let c;
const beat=setInterval(()=>console.log('Checking archived and current town navigation.'),30000);
try{
 for(let i=0;i<90&&!c;i++){try{c=await connectNative(9339);}catch{await pause(1000);}}assert(c);
 let bridgeReady=false;for(let i=0;i<180;i++){if(await c.evaluate('!!window.ue?.dndrom && !!document.querySelector(".native-scene-viewport")')){bridgeReady=true;break;}await pause(500);}assert(bridgeReady,'Native bridge did not initialize');
 const native=(method,params={})=>c.evaluate(`window.ue.dndrom.dispatch(${JSON.stringify(JSON.stringify({method,params}))}).then(JSON.parse)`);
 const ready=async()=>{for(let i=0;i<300;i++){const d=await native('app.diagnostics');if(d.importComplete&&await c.evaluate(`window.dndromSceneImport?.cacheReady && window.dndromSceneImport.streamId===${JSON.stringify(d.streamId)}`))return d;await pause(500);}throw Error('Scene import did not finish');};
 await ready();
 assert(await c.evaluate('!document.querySelector(".settlement-upgrade-notice")'),'Current town reopened as an obsolete layout');
 await c.evaluate('document.querySelector(".scene-current-button").click()');await pause(300);
 await c.evaluate('document.querySelector(".scene-card-list article:not(.active) > button").click()');
 for(let i=0;i<30;i++){if(await c.evaluate('document.querySelector(".settlement-upgrade-notice button")?.textContent==="Open current town"'))break;await pause(100);}
 assert(await c.evaluate('document.querySelector(".settlement-upgrade-notice button")?.textContent==="Open current town"'));
 // Return immediately to also exercise cancellation of the archived import.
 await c.evaluate('document.querySelector(".settlement-upgrade-notice button").click()');await pause(500);
 const after=await ready();assert(await c.evaluate('!document.querySelector(".settlement-upgrade-notice")'));assert.equal(after.missingMaterials,0);
 await native('world.reveal',{enabled:false});await pause(1000);await native('app.capture');await pause(1300);await copyFile(path.join(profile,'native-capture.png'),path.join(profile,'revisited-town.png'));
 await writeFile(path.join(profile,'revisit-report.json'),JSON.stringify({archivedLayoutRecognized:true,currentLayoutRestored:true,rapidReturnAcknowledged:true,native:after},null,2));
 console.log('Town revisit passed');
}finally{
 clearInterval(beat);c?.close();const close=spawn('powershell.exe',['-NoProfile','-File',path.join(root,'scripts/close-native-window.ps1'),'-AppProcessId',String(app.pid)],{windowsHide:true,stdio:'ignore'});await new Promise(r=>close.on('exit',r));
 for(let i=0;i<100&&app.exitCode===null;i++)await pause(100);if(app.exitCode===null)app.kill();
}
