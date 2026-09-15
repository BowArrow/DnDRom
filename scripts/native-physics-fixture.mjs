import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

export async function checkTerrainPhysics(c,native,profile) {
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const positions=[],normals=[],uvs=[],colors=[],indices=[];
  for(let z=0;z<=32;z++)for(let x=0;x<=32;x++){
    const px=(x-16)*1.25,pz=(z-16)*1.25;
    positions.push(px,2+px*.05,pz);normals.push(0,1,0);uvs.push(x/32,z/32);colors.push(0,1,0,1);
    if(x<32&&z<32){const a=z*33+x;indices.push(a,a+33,a+1,a+1,a+33,a+34);}
  }
  const scene={format:'dndrom.scene',version:1,coordinates:'right-handed-y-up-metres',name:'Physics terrain fixture',streamId:'physics-fixture',source:{map:{id:'physics-fixture'}},warnings:[],meshes:[{id:'terrain-fixture',material:'terrain',collision:true,lods:[{positions,normals,uvs,colors,indices}]}],instances:[{entityId:'ground',meshId:'terrain-fixture',position:{x:0,y:0,z:0},rotation:[0,0,0,1],scale:{x:1,y:1,z:1}}]};
  const upload=await native('upload.inline',{kind:'scene',text:JSON.stringify(scene)});assert(!upload.error,JSON.stringify(upload));
  let report;
  for(let i=0;i<200;i++){report=await native('app.diagnostics');if(report.streamId==='physics-fixture'&&report.importComplete&&report.terrainCollisionReady>0)break;await pause(100);}
  assert(report?.terrainCollisionReady>0,'No cooked terrain physics body');
  await native('scene.viewport',{x:0,y:0,width:1,height:1});
  await native('scene.input',{kind:'frame'});await pause(1000);
  const rect={x:.5,y:.5};
  const hit=await native('scene.input',{kind:'pick',...rect});
  assert(hit.hit&&hit.physicsHit,'Terrain placement did not hit a real physics body');
  assert(Math.abs(hit.position.y-(2+hit.position.x*.05))<.02,'Physics surface diverged from the rendered slope');
  await native('world.reveal',{enabled:true,identity:'stable-physics-world',revealRadius:10,revealComplete:true});await pause(3500);
  const before=await native('app.diagnostics');
  await native('world.reveal',{enabled:true,identity:'stable-physics-world'});await native('scene.input',{kind:'navigate',yaw:15});await pause(500);
  const after=await native('app.diagnostics');assert(after.revealRadius>=before.revealRadius);assert(after.revealOpacity<=before.revealOpacity,'Repeated world identity restarted fog');
  await native('world.reveal',{enabled:false});
  const result={collisionReady:report.terrainCollisionReady,triangles:report.terrainCollisionTriangles,hit,revealBefore:{radius:before.revealRadius,opacity:before.revealOpacity},revealAfter:{radius:after.revealRadius,opacity:after.revealOpacity}};
  await writeFile(path.join(profile,'physics-report.json'),JSON.stringify(result,null,2));
  return result;
}
