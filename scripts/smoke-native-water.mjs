import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,copyFile,stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {connectNative} from './native-cdp.mjs';
const root=path.resolve(import.meta.dirname,'..'),profile=path.resolve(process.argv[2]??'artifacts/coastal-motion');
await mkdir(profile,{recursive:true});
const require=createRequire(path.join(root,'apps/desktop/package.json'));
await require('esbuild').build({stdin:{contents:'export {exportUnrealScene} from "./apps/desktop/src/migration/unrealScene";',resolveDir:root},outfile:path.join(profile,'export.mjs'),bundle:true,platform:'node',format:'esm'});
const {exportUnrealScene}=await import(pathToFileURL(path.join(profile,'export.mjs')));
const size=128,res=128,shore=z=>6*Math.sin(z*.04)+2*Math.sin(z*.11),bed=(x,z)=>(x-shore(z))*.075;
const heights=[],depths=[];for(let z=0;z<=res;z++)for(let x=0;x<=res;x++){const h=bed(x-size/2,z-size/2);heights.push(h);depths.push(-h);}
const transform={position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
const map={id:'water-test',name:'Coastal water validation',width:size,depth:size,theme:'coast',entities:[
 {id:'beach',assetId:'terrain',...transform,worldGeometry:{kind:'terrain',seed:42,originX:-64,originZ:-64,size,baseHeight:0,relief:0,roughness:0,erosion:0,paths:[],heightfield:{resolution:res+1,heights}}},
 {id:'surf',assetId:'water',...transform,worldGeometry:{kind:'water',originX:-64,originZ:-64,size,resolution:res,waterLevel:0,wetCells:depths.map(d=>d>0),depthField:depths}}
]};
const scene=exportUnrealScene(map);
scene.meshes.push({id:'receiver-marker',material:'masonry',collision:true,lods:[{positions:[-.8,0,-.8,-.8,0,.8,.8,0,.8,.8,0,-.8],normals:[0,1,0,0,1,0,0,1,0,0,1,0],uvs:[0,0,0,1,1,1,1,0],colors:Array(16).fill(255),indices:[0,1,2,0,2,3]}]});
scene.instances.push({entityId:'receiver-marker',meshId:'receiver-marker',position:{x:-18,y:-.8,z:0},rotation:[0,0,0,1],scale:{x:1,y:1,z:1}});
await writeFile(path.join(profile,'beach.dndscene'),JSON.stringify(scene));
const child=spawn(path.join(root,'artifacts/unreal-package/Windows/DnDRom/Binaries/Win64/DnDRom.exe'),['-windowed','-ResX=1280','-ResY=900','-WinX=-20000','-WinY=-20000','-cefdebug=9338','-DnDRomAutomation',`-UserDir=${profile}/user`,`-DnDRomData=${profile}`,`-abslog=${profile}/runtime.log`],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let cdp;
const heartbeat=setInterval(()=>console.log('Coastal test: checking packaged animation and GPU foam history.'),30000);
try{
 for(let i=0;i<90&&!cdp;i++){try{cdp=await connectNative();}catch{await pause(1000);}}assert(cdp);
 const native=(method,params={})=>cdp.evaluate(`window.ue.dndrom.dispatch(${JSON.stringify(JSON.stringify({method,params}))}).then(JSON.parse)`);
 await pause(7000);
 await native('world.clear');
 const load=async (data,kind='scene',name='')=>{
  const raw=Buffer.from(JSON.stringify(data)),text=gzipSync(raw).toString('base64');
  const {id}=await native('upload.begin',{kind,name,acceptEncoding:'gzip-base64',uncompressedBytes:raw.length});assert(id);
  for(let i=0;i<text.length;i+=196608){const r=await native('upload.chunk',{id,text:text.slice(i,i+196608)});assert(!r.error,JSON.stringify(r));}
  return native('upload.commit',{id});
 };
 const loaded=await load(scene);assert.equal(loaded.loaded,true,JSON.stringify(loaded));
 for(let i=0;i<90;i++){if((await native('app.diagnostics')).importComplete)break;await pause(500);}
 await native('scene.environment',{interior:false,coastalSediment:true,lighting:{keyIntensity:1,iblIntensity:1,exposure:1},lights:[]});
 await cdp.evaluate("document.body.style.opacity='0';document.documentElement.style.background='transparent'");
 await native('scene.viewport',{x:0,y:0,width:1,height:1});
 await native('scene.input',{kind:'water-review',x:-19,y:4,z:-19,yaw:25,pitch:-12});
 await pause(5000);
 const capture=async name=>{const file=path.join(profile,'native-capture.png'),previous=(await stat(file).catch(()=>({mtimeMs:0}))).mtimeMs;await native('app.capture');for(let i=0;i<100;i++){await pause(50);if((await stat(file).catch(()=>({mtimeMs:0}))).mtimeMs>previous)break;}await copyFile(file,path.join(profile,name+'.png'));};
 if(process.argv.includes('--far-reveal')){
   await native('scene.input',{kind:'water-review',x:0,y:40,z:0,yaw:0,pitch:2});
   await pause(600);await capture('horizon-clear');
   await native('world.reveal',{enabled:true,identity:'far-optics',revealRadius:16336});
   for(let i=0;i<120;i++){if((await native('app.diagnostics')).revealRadius>=16335)break;await pause(500);}
   await capture('horizon-16km');
   await native('world.reveal',{revealRadius:65000,revealIdentity:'far-optics'});
   for(let i=0;i<60;i++){if((await native('app.diagnostics')).revealRadius>=64999)break;await pause(500);}
   await capture('horizon-65km');
   await writeFile(path.join(profile,'far-reveal.json'),JSON.stringify(await native('app.diagnostics'),null,2));
   await native('world.reveal',{enabled:false});
   await native('scene.input',{kind:'water-review',x:-19,y:4,z:-19,yaw:25,pitch:-12});await pause(600);
 }
 if(process.argv.includes('--reveal')){
   const states=[];
   await native('world.reveal',{enabled:true,identity:'optics-test',revealRadius:8});await pause(1500);await capture('fog-loading');states.push(await native('app.diagnostics'));
   const marker={...scene,waterFields:[],meshes:[{id:'loading-marker',material:'masonry',collision:false,lods:[{positions:[0,4,-10,0,5.5,-10,0,5.5,10,0,4,10],normals:[-1,0,0,-1,0,0,-1,0,0,-1,0,0],uvs:[0,0,0,1,1,1,1,0],colors:Array(16).fill(255),indices:[0,2,1,0,3,2]}]}],instances:[{entityId:'loading-marker',meshId:'loading-marker',position:{x:35,y:0,z:0},rotation:[0,0,0,1],scale:{x:1,y:1,z:1}}]};
   await load(marker,'tile','loading-marker');for(let i=0;i<100;i++){if((await native('app.diagnostics')).readyTiles.includes('loading-marker'))break;await pause(100);}
   await native('world.visible',{visible:['loading-marker'],remove:[],revealRadius:8,revealIdentity:'optics-test'});await pause(300);await capture('fog-tile-added');
   await native('scene.input',{kind:'water-review',x:0,y:4,z:0,yaw:0,pitch:65});await pause(800);await capture('fog-sky');
   await native('world.reveal',{revealRadius:100,revealIdentity:'optics-test'});await pause(2500);await capture('fog-expanded');
   await native('world.reveal',{revealComplete:true,revealIdentity:'optics-test'});await pause(3200);
   assert.equal((await native('app.diagnostics')).revealOpacity,0,'Completed coverage left fog active');
   await native('world.reveal',{revealRadius:200,revealIdentity:'optics-test'});await pause(400);
   assert.equal((await native('app.diagnostics')).revealOpacity,0,'Streaming update replayed completed fog');await capture('fog-cleared');
   await native('scene.input',{kind:'water-review',x:-19,y:4,z:-19,yaw:25,pitch:-12});await pause(400);await capture('fog-tile-revealed');
   await native('world.visible',{visible:[],remove:['loading-marker']});
   await native('world.reveal',{enabled:true,identity:'optics-next'});
   await native('world.reveal',{revealComplete:true,revealRadius:9000,revealIdentity:'optics-test'});await pause(500);
   const next=await native('app.diagnostics');assert.equal(next.revealComplete,false);assert.equal(next.revealTarget,0);states.push(next);
   await native('world.reveal',{enabled:false});await native('world.reveal',{revealRadius:200});assert.equal((await native('app.diagnostics')).revealOpacity,0);
   await writeFile(path.join(profile,'reveal.json'),JSON.stringify(states,null,2));
 }
 if(process.argv.includes('--underwater')){
   const reviews=[];
   for(const [name,y,pitch] of [['above',2,-25],['below-down',-.8,-35],['below-up',-.8,70],['below-horizon',-.8,10],['waterline',.01,10],['above-again',2,-25]]){
     await native('scene.input',{kind:'water-review',x:-40,y,z:0,yaw:0,pitch});await pause(1800);await capture(name);reviews.push({name,...await native('app.diagnostics')});
   }
   await writeFile(path.join(profile,'underwater.json'),JSON.stringify(reviews,null,2));
   await native('scene.input',{kind:'water-review',x:-19,y:4,z:-19,yaw:25,pitch:-12});await pause(1000);
 }
 if(!process.argv.includes('--underwater-only')){
 const motion=[];
 const frames=[];const motionStart=Date.now();
 for(let i=0;i<72;i++){const name='surf-'+String(i).padStart(2,'0');await capture(name);frames.push({name,seconds:(Date.now()-motionStart)/1000});if(i%6===0)motion.push(await native('scene.input',{kind:'water-review'}));await pause(180);}
 const before=await native('scene.input',{kind:'water-review',emission:0});
 assert(before.foamSum>10,'Foam field never acquired density');
 await pause(1000);const lingering=await native('scene.input',{kind:'water-review'});
 assert(lingering.foamSum>1&&lingering.foamSum<before.foamSum,'Emission stop must leave dissipating foam');
 await pause(7000);const decayed=await native('scene.input',{kind:'water-review'});
 assert(decayed.foamSum<before.foamSum*.3,'Foam did not dissipate');
 await native('scene.input',{kind:'water-review',emission:1});await pause(8000);
 const handoffBefore=await native('scene.input',{kind:'water-review',emission:0});
 const missingField=structuredClone(scene);missingField.waterFields=[];
 assert.equal((await load(missingField)).loaded,true);await pause(800);
 const handoffMissing=await native('scene.input',{kind:'water-review'});
 assert(handoffBefore.foamSum>10&&handoffMissing.foamSum>1,'Temporary missing fields erased foam history');
 assert.equal((await load(scene)).loaded,true);await pause(800);
 const handoffRestored=await native('scene.input',{kind:'water-review'});
 assert(handoffRestored.foamSum>1&&handoffRestored.steps>handoffMissing.steps,'Field handoff reset simulation');
 await native('scene.input',{kind:'water-review',emission:1});await pause(8000);
 await native('scene.input',{kind:'water-review',x:-20,y:20,z:12,yaw:0,pitch:-45});await pause(1000);await capture('receiver-overhead');
 const prior=await native('scene.input',{kind:'water-review'});
 await native('scene.input',{kind:'water-review',x:-20,y:20,z:46,yaw:0,pitch:-45});await pause(300);
 const shifted=await native('scene.input',{kind:'water-review'});
 assert(shifted.reprojections>prior.reprojections,'Window did not shift');
 assert(shifted.steps>prior.steps,'Window shift reset simulation');assert(shifted.foamSum>prior.foamSum*.5,'Window shift lost retained foam');
 await native('scene.input',{kind:'water-review',x:-18,y:3,z:-4,yaw:90,pitch:-45});await pause(800);await capture('receiver-close');
 await native('scene.input',{kind:'water-review',x:-22,y:3,z:0,yaw:0,pitch:-45});await pause(800);await capture('receiver-orbit');
 const invalid=structuredClone(scene);invalid.waterFields[0].resolution=100000;
 assert.equal((await load(invalid)).loaded,undefined,'Invalid water field was accepted');
 const diagnostics=await native('app.diagnostics');assert.equal(diagnostics.missingMaterials,0);
 await native('scene.environment',{interior:false,coastalSediment:true,weather:{windSpeed:0,windDirection:65},lights:[]});
 await pause(5500);const calm=await native('scene.input',{kind:'water-review'});assert(calm.windStrength<.04,'Wind change did not calm the water');
 await capture('calm-water');
 const replacement=structuredClone(scene);replacement.source.map.id='water-test-new-world';
 assert.equal((await load(replacement)).loaded,true);
 await pause(1500);const newWorld=await native('scene.input',{kind:'water-review'});
 assert(newWorld.steps<shifted.steps,'A different world with the same name inherited foam history');
 await writeFile(path.join(profile,'report.json'),JSON.stringify({frames,motion,before,lingering,decayed,handoffBefore,handoffMissing,handoffRestored,prior,shifted,diagnostics,calm,newWorld,checks:{history:true,decay:true,reprojection:true,temporaryFieldHandoff:true,invalidFieldRejected:true,newWorldReset:true,weatherResponse:true}},null,2));
 console.log(JSON.stringify({profile,before:before.foamSum,after:decayed.foamSum,shifted:shifted.foamSum}));
 }
}finally{
 clearInterval(heartbeat);cdp?.close();const closer=spawn('powershell.exe',['-NoProfile','-File',path.join(root,'scripts/close-native-window.ps1'),'-AppProcessId',String(child.pid)],{windowsHide:true,stdio:'ignore'});await new Promise(r=>closer.on('exit',r));
 for(let i=0;i<100&&child.exitCode===null;i++)await pause(100);if(child.exitCode===null)child.kill();
}
