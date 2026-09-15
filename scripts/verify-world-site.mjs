import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {serialize,deserialize} from 'node:v8';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'apps/desktop/package.json'));
await require('esbuild').build({stdin:{contents:'export * from "./apps/desktop/src/domain/worldSite";export * from "./apps/desktop/src/domain/worldForge";export * from "./apps/desktop/src/domain/worldAtlas";export * from "./apps/desktop/src/domain/worldErosion";export {sampleTerrainHeight} from "./apps/desktop/src/domain/worldProcedural";export {footprintSamples,mapPlacementSurface} from "./apps/desktop/src/domain/worldPlacement";',resolveDir:root},outfile:path.join(root,'artifacts/site-current.mjs'),bundle:true,platform:'node',format:'esm'});
const a=await import('../artifacts/site-current.mjs'),directory=path.join(root,'artifacts/site-erosion-cache');mkdirSync(directory,{recursive:true});
const file=key=>path.join(directory,key.replaceAll(':','_')+'.bin');
a.configureErosionCache({get:key=>existsSync(file(key))?deserialize(readFileSync(file(key))):undefined,put:(key,tile)=>writeFileSync(file(key),serialize(tile))});
const results=[];
for(const [name,description] of [['harbor','A forest harbor village on the ocean'],['valley','A mountain village in a high valley']]){
 const start=performance.now(),[blueprint]=a.createFallbackWorldBlueprints({description,kind:'settlement',size:'small',gridShape:'square',seed:719,background:'none'});
 console.log('Selecting',name);
 const prepared=a.prepareWorldSite(blueprint);console.log(name,prepared.site,(performance.now()-start)/1000);
 const compiled=a.compileWorldBlueprint(prepared),map=compiled.map,context=a.atlasContext(map),sample=a.createAtlasSampler(context,true,true);
 let maxGap=0;
 for(const terrain of context.patches)for(let i=0;i<=16;i++)for(const [x,z] of [[-32,-32+i*4],[32,-32+i*4],[-32+i*4,-32],[-32+i*4,32]]){
  if(x<terrain.originX||x>terrain.originX+terrain.size||z<terrain.originZ||z>terrain.originZ+terrain.size)continue;
  const outsideX=x===-32?x-.001:x===32?x+.001:x,outsideZ=z===-32?z-.001:z===32?z+.001:z;
  maxGap=Math.max(maxGap,Math.abs(a.sampleTerrainHeight(terrain,x,z)-sample(outsideX,outsideZ)));
 }
 assert(maxGap<.01,'Geological edge gap '+maxGap);
 const surface=a.mapPlacementSurface(map),buildings=map.entities.filter(e=>['assembly','cga-building'].includes(e.worldGeometry?.kind));
 await writeFile(path.join(root,'artifacts/site-'+name+'-world.json'),JSON.stringify(map));console.log('Buildings',buildings.length,compiled.validation.warnings);assert(buildings.length>=2,'No settlement buildings');
 for(const building of buildings)assert(a.footprintSamples(building,0,1).every(p=>!surface.blocked(p.x,p.z)),'Building overlaps water or road');
 await writeFile(path.join(root,'artifacts/site-'+name+'-world.json'),JSON.stringify(map));
 results.push({name,site:map.world.site,maxGap,buildings:buildings.length,seconds:(performance.now()-start)/1000,warnings:compiled.validation.warnings});
 console.log(results.at(-1));
}
await writeFile(path.join(root,'artifacts/site-verification.json'),JSON.stringify(results,null,2));
