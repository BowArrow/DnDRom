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
await require('esbuild').build({stdin:{contents:'export {createStarterCampaign} from "./apps/desktop/src/domain/seed"; export {selectAtlasTiles,tileKey} from "./apps/desktop/src/domain/worldAtlas"; export {compactSharedCampaign} from "./apps/desktop/src/domain/sharedWorldFiles";',resolveDir:root},outfile:path.join(profile,'seed.mjs'),bundle:true,platform:'node',format:'esm'});
const {createStarterCampaign,selectAtlasTiles,tileKey,compactSharedCampaign}=await import(pathToFileURL(path.join(profile,'seed.mjs')));
const campaign=createStarterCampaign();campaign.name='Terrain review';campaign.map=JSON.parse(await readFile(path.resolve(process.argv.includes('--map')?process.argv[process.argv.indexOf('--map')+1]:path.join(root,'artifacts/site-harbor-world.json')),'utf8'));campaign.scenes=[];delete campaign.activeSceneId;campaign.settings.localAiRuntime='disabled';
if(process.argv.includes('--world'))campaign.world=JSON.parse(await readFile(path.resolve(process.argv[process.argv.indexOf('--world')+1]),'utf8'));
const campaignPath=path.join(profile,'terrain.dndrom');await writeFile(campaignPath,JSON.stringify(process.argv.includes('--compact')?compactSharedCampaign(campaign):campaign));
const child=spawn(path.join(root,'artifacts/unreal-package/Windows/DnDRom/Binaries/Win64/DnDRom.exe'),['-windowed','-ResX=1920','-ResY=1080','-WinX=-20000','-WinY=-20000','-cefdebug=9338','-DnDRomAutomation',`-UserDir=${profile}/user`,`-DnDRomData=${profile}`,`-abslog=${profile}/runtime.log`],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let cdp;
const heartbeat=setInterval(()=>console.log('Terrain review is waiting for native imports and eroded world tiles.'),30000);
try{
  for(let i=0;i<90&&!cdp;i++){try{cdp=await connectNative();}catch{await pause(1000);}}
  assert(cdp,'Native browser did not start');
  const native=(method,params={})=>cdp.evaluate(`window.ue.dndrom.dispatch(${JSON.stringify(JSON.stringify({method,params}))}).then(JSON.parse)`);
  for(let i=0;i<(process.argv.includes("--load-only")?0:90);i++){if(await cdp.evaluate("!!window.ue?.dndrom && !!document.querySelector('.native-scene-viewport')"))break;await pause(500);}
  await pause(3000);
  const capture=async name=>{await native('app.capture');await pause(1500);await copyFile(path.join(profile,'native-capture.png'),path.join(profile,name+'.png'));};
  await cdp.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Session').click()");await pause(400);
  const {root:document}=await cdp.call('DOM.getDocument');const {nodeId}=await cdp.call('DOM.querySelector',{nodeId:document.nodeId,selector:'input[accept=".dndrom,application/json"]'});assert(nodeId,'Campaign import input missing');
  await cdp.call('DOM.setFileInputFiles',{nodeId,files:[campaignPath]});
  let firstPlayableSeconds,firstVisibleCoverageSeconds,peakProcessMemoryBytes=0;
  const waitNear=async()=>{
    for(let i=0;i<300;i++){
      const state=await native('app.diagnostics'),ready=new Set(state.readyTiles);
      peakProcessMemoryBytes=Math.max(peakProcessMemoryBytes,state.peakProcessMemoryBytes??0);
      if(firstPlayableSeconds===undefined&&state.importComplete&&state.instances>100&&await cdp.evaluate(`window.dndromSceneImport?.mapId===${JSON.stringify(campaign.map.id)}&&window.dndromSceneImport.cacheReady`))firstPlayableSeconds=(Date.now()-start)/1000;
      if(state.importComplete&&(state.visibleTiles??[]).length)firstVisibleCoverageSeconds??=(Date.now()-start)/1000;
      const near=selectAtlasTiles(state.cameraX,state.cameraZ,campaign.map).desired.filter(tile=>tile.level<=4);
      const visible=new Set(state.visibleTiles??[]);
      if(state.importComplete&&state.instances>100&&near.length&&near.every(tile=>ready.has(tileKey(tile))&&visible.has(tileKey(tile))))return state;
      await pause(1000);
    }
    throw new Error('Complete nearby terrain coverage never arrived');
  };
  const start=Date.now(),streamed=await waitNear(),secondsToNear=(Date.now()-start)/1000;
  const local=(x,z)=>Math.abs(x)<campaign.map.width/2&&Math.abs(z)<campaign.map.depth/2;
  const covered=(ids,x,z)=>local(x,z)||ids.some(id=>{const [l,tx,tz]=id.split('/').map(Number),size=32*2**l;return x>=tx*size&&x<(tx+1)*size&&z>=tz*size&&z<(tz+1)*size;});
  const probes=[];for(let z=-1000;z<1000;z+=32)for(let x=-1000;x<1000;x+=32)if(covered(streamed.visibleTiles,x+.1,z+.1))probes.push([x+.1,z+.1]);
  assert(probes.length>50,'Too little coverage to exercise handoff');
  const transitions=[];
  await pause(5000);await capture('village-streamed');
  if(!process.argv.includes('--load-only'))await native('scene.input',{kind:'navigate',zoom:1.2,pitch:8,yaw:25});
  for(let i=0;i<(process.argv.includes("--load-only")?0:90);i++){
    if(i===44)await capture('village-far-angle');
    if(i===45)await native('scene.input',{kind:'navigate',zoom:-1.2,yaw:-25,pitch:-8});
    const state=await native('app.diagnostics');
    const missing=probes.filter(([x,z])=>!covered(state.visibleTiles,x,z));
    transitions.push({seconds:i,frameMilliseconds:state.frameMilliseconds,visible:state.visibleTiles.length,missing:missing.length,cameraX:state.cameraX,cameraZ:state.cameraZ});
    if(missing.length){await capture('coverage-failure');await writeFile(path.join(profile,'transitions.json'),JSON.stringify(transitions,null,2));throw Error('Lost '+missing.length+' previously covered probes');}
    await pause(500);
  }
  await capture('village-distance');
  await pause(1800);await capture('water-motion');
  if(process.argv.includes('--beach')){
    await native('scene.input',{kind:'navigate',zoom:-1,pitch:10,yaw:-15});await pause(3000);await capture('beach-level');
    await pause(1500);await capture('beach-surf-motion');
    await native('scene.input',{kind:'navigate',zoom:-.7,pitch:-10,panX:.15});await pause(3000);await capture('beach-close');
    await pause(1300);await capture('beach-caustic-motion');
  }
  if(process.argv.includes('--coastal')){
    await cdp.evaluate("document.body.style.opacity='0';document.documentElement.style.background='transparent'");
    await native('scene.viewport',{x:0,y:0,width:1,height:1});
    await native('scene.input',{kind:'water-review',x:28,y:3,z:28,yaw:-135,pitch:-8});await waitNear();await pause(4000);
    for(let i=0;i<6;i++){await capture('harbor-coast-'+i);await pause(700);}
    await native('scene.input',{kind:'water-review',x:28,y:22,z:28,yaw:-135,pitch:-35});await pause(3000);await capture('harbor-coast-overhead');
    await writeFile(path.join(profile,'water-state.json'),JSON.stringify(await native('scene.input',{kind:'water-review'}),null,2));
  }
  const end=await native('app.diagnostics');assert(end.worldTiles<=512);assert.equal(end.missingMaterials,0);
  if(process.argv.includes('--seams')){
    await cdp.evaluate("document.body.style.opacity='0';document.documentElement.style.background='transparent'");
    await native('scene.viewport',{x:0,y:0,width:1,height:1});
    for(const [name,x,y,z,yaw,pitch] of [['seam-water',-18,16,-20,45,-65],['seam-ground',8,18,-12,135,-60],['seam-region',32,25,12,180,-65]]){
      await native('scene.input',{kind:'water-review',x,y,z,yaw,pitch});await pause(2500);await capture(name);
    }
  }

  if(process.argv.includes('--camera')){
    await cdp.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='World scenes').click()");await pause(400);
    assert.equal(await cdp.evaluate("document.querySelectorAll('.world-scene-list article').length"),campaign.world.manifest.locations.length);
    await capture('world-scenes');await cdp.evaluate("document.querySelector('[aria-label=\"Close world scenes\"]').click()");
    const box=await cdp.evaluate("(()=>{const r=document.querySelector('.native-scene-viewport').getBoundingClientRect();return {x:r.x+r.width*.4,y:r.y+r.height*.5};})()");
    await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',x:box.x,y:box.y,button:'middle',buttons:4,clickCount:1});
    for(let i=1;i<=70;i++){await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:box.x+i*1.5,y:box.y,button:'middle',buttons:4});await pause(20);}
    await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:box.x+105,y:box.y,button:'middle',buttons:0,clickCount:1});await pause(200);
    const orbit=await native('app.diagnostics');const frames=orbit.cameraFrames;
    const differences=frames.slice(1).map((r,i)=>Math.abs(((r[1]-frames[i][1]+540)%360)-180)).filter(d=>d>.001);
    assert(differences.length>35,'Orbit did not update continuously on engine frames');
    await writeFile(path.join(profile,'camera-motion.json'),JSON.stringify({frames,movingFrames:differences.length,maxYawStep:Math.max(...differences),maxFrameMilliseconds:Math.max(...frames.map(r=>r[0]))},null,2));
    await cdp.evaluate("document.body.style.opacity='0';document.documentElement.style.background='transparent'");await native('scene.viewport',{x:0,y:0,width:1,height:1});
    const water=[];
    for(const [name,y,pitch] of [['above-water',0,-28],['underwater-down',-4.9,-40],['underwater-up',-4.9,70],['underwater-horizon',-4.9,12],['waterline',-3.89,8],['returned-above',0,-28]]){
      await native('scene.input',{kind:'water-review',x:27,y,z:-16,yaw:0,pitch});await pause(1600);await capture(name);water.push({name,...await native('app.diagnostics')});
    }
    assert.equal(water[0].water.underwater,false);assert.equal(water[1].water.underwater,true);assert.equal(water[1].water.underwaterMaterial,true);assert.equal(water.at(-1).water.underwater,false);
    const before=await native('app.diagnostics');await native('scene.input',{kind:'camera',yaw:25});await pause(600);const after=await native('app.diagnostics');assert(Math.hypot(after.cameraX-before.cameraX,after.cameraY-before.cameraY,after.cameraZ-before.cameraZ)<.05,'Fly look moved the camera position');
    await native('scene.input',{kind:'camera',up:-2000});await pause(1000);const floor=await native('app.diagnostics');assert(floor.cameraY>-7,'Camera penetrated the seabed');assert(floor.cameraCollisions>after.cameraCollisions);await capture('seabed-collision');
    await native('scene.input',{kind:'camera',up:-2000});await pause(500);const floorAgain=await native('app.diagnostics');assert(Math.abs(floorAgain.cameraY-floor.cameraY)<.1,'Camera continues through solid terrain');

    await native('scene.input',{kind:'water-review',x:450,y:500,z:400,yaw:0,pitch:-20});await pause(500);
    for(let i=0;i<45;i++){await native('scene.input',{kind:'camera',up:-2000});await pause(20);}await pause(1500);
    const farFloor=await native('app.diagnostics');await native('scene.input',{kind:'camera',up:-2000});await pause(500);const farFloorAgain=await native('app.diagnostics');
    assert(farFloor.cameraCollisions>floorAgain.cameraCollisions,'Distant terrain did not constrain the camera');assert(Math.abs(farFloor.cameraY-farFloorAgain.cameraY)<.2,'Camera passed through distant terrain');
    await writeFile(path.join(profile,'underwater-review.json'),JSON.stringify({water,before,after,floor,floorAgain,farFloor,farFloorAgain},null,2));
    if(process.argv.includes('--jump')){
      await cdp.evaluate("document.body.style.opacity='1'");
      const target=campaign.world.manifest.locations.find(l=>l.id!==campaign.map.locationId);
      await cdp.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='World scenes').click()");await pause(150);
      await cdp.evaluate("[...document.querySelectorAll('.world-scene-list article')].find(e=>e.querySelector('h3').textContent==="+JSON.stringify(target.name)+").querySelector('button').click()");
      const jumpStart=Date.now();let jumped=false;
      for(let i=0;i<150;i++){if(await cdp.evaluate("!document.querySelector('.world-scenes-dialog').open && document.querySelector('.location-switcher select')?.value==="+JSON.stringify(target.id))){jumped=true;break;}await pause(1000);}
      assert(jumped,'World scene manager did not enter the accepted destination');
      const jumpSeconds=(Date.now()-jumpStart)/1000;await pause(5000);await capture('jumped-mainland');
      await cdp.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='World scenes').click()");await pause(150);
      await cdp.evaluate("[...document.querySelectorAll('.world-scene-list article')].find(e=>e.querySelector('h3').textContent==="+JSON.stringify(campaign.map.name)+").querySelector('button').click()");
      await pause(2000);assert.equal(await cdp.evaluate("document.querySelector('.location-switcher select').value"),campaign.map.locationId);
      await writeFile(path.join(profile,'scene-jump.json'),JSON.stringify({destination:target.id,jumpSeconds,returnedTo:campaign.map.locationId},null,2));
    }

  }

  peakProcessMemoryBytes=Math.max(peakProcessMemoryBytes,end.peakProcessMemoryBytes??0);
  await writeFile(path.join(profile,'report.json'),JSON.stringify({worldTimings:await cdp.evaluate('window.dndromWorldTimings'),streamed,end,transitions,firstPlayableSeconds,firstVisibleCoverageSeconds,peakProcessMemoryBytes,secondsToNear,totalReviewSeconds:(Date.now()-start)/1000,checks:{materials:true,nearWorldStreamed:true,boundedTileCache:true,coverageRetained:transitions.length===90?true:undefined}},null,2));
  console.log(JSON.stringify({profile,tiles:end.worldTiles,nearTiles:end.readyTiles.filter(id=>id.startsWith('0/')).length}));
}finally{
  clearInterval(heartbeat);cdp?.close();
  const closer=spawn('powershell.exe',['-NoProfile','-File',path.join(root,'scripts/close-native-window.ps1'),'-AppProcessId',String(child.pid)],{windowsHide:true,stdio:'ignore'});await new Promise(r=>closer.on('exit',r));
  for(let i=0;i<300&&child.exitCode===null;i++)await pause(100);if(child.exitCode===null)child.kill();
}


