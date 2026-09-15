import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts/seam-audit');await mkdir(out,{recursive:true});
const require=createRequire(path.join(root,'apps/desktop/package.json'));
await require('esbuild').build({stdin:{contents:'export {exportUnrealScene} from "./apps/desktop/src/migration/unrealScene";',resolveDir:root},outfile:path.join(out,'export.mjs'),bundle:true,platform:'node',format:'esm'});
const {exportUnrealScene}=await import(pathToFileURL(path.join(out,'export.mjs')));
const map=JSON.parse(await readFile(path.join(root,'artifacts/site-harbor-world.json'),'utf8')),start=performance.now(),scene=exportUnrealScene(map);
const terrain=new Map(),water=new Map(),report={terrainPairs:0,waterPairs:0,maxHeightJump:0,maxNormalJump:0,maxMaterialJump:0,maxDepthJump:0,maxShoreJump:0,maxWaterHeightJump:0};
for(const instance of scene.instances){const mesh=scene.meshes.find(m=>m.id===instance.meshId);if(mesh.material!=='terrain')continue;const g=mesh.lods[0];
 for(let i=0;i<g.positions.length/3;i++){
  const key=`${(g.positions[i*3]+instance.position.x).toFixed(6)}:${(g.positions[i*3+2]+instance.position.z).toFixed(6)}`;
  const v=[g.positions[i*3+1]+instance.position.y,...g.normals.slice(i*3,i*3+3),...g.colors.slice(i*4,i*4+4)],old=terrain.get(key);
  if(old){report.terrainPairs++;report.maxHeightJump=Math.max(report.maxHeightJump,Math.abs(v[0]-old[0]));for(let j=1;j<4;j++)report.maxNormalJump=Math.max(report.maxNormalJump,Math.abs(v[j]-old[j]));for(let j=4;j<8;j++)report.maxMaterialJump=Math.max(report.maxMaterialJump,Math.abs(v[j]-old[j]));}else terrain.set(key,v);
 }
}
for(const f of scene.waterFields??[])for(let z=0;z<=f.resolution;z++)for(let x=0;x<=f.resolution;x++){
 const i=z*(f.resolution+1)+x,key=`${f.originX+x*f.size/f.resolution}:${f.originZ+z*f.size/f.resolution}`,v=[f.depths[i],f.distances[i],f.heights[i]],old=water.get(key);
 if(old){report.waterPairs++;for(const [j,name] of ['maxDepthJump','maxShoreJump','maxWaterHeightJump'].entries())report[name]=Math.max(report[name],Math.abs(v[j]-old[j]));}else water.set(key,v);
}
assert(report.terrainPairs>500&&report.waterPairs>400);
for(const [name,value] of Object.entries(report))if(name.startsWith('max'))assert(value<1e-6,`${name}: ${value}`);
report.exportMilliseconds=performance.now()-start;
await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
