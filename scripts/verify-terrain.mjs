import {createRequire} from 'node:module';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {serialize,deserialize} from 'node:v8';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'apps/desktop/package.json'));
await require('esbuild').build({stdin:{contents:'export * from "./apps/desktop/src/domain/worldAtlas";export * from "./apps/desktop/src/domain/worldErosion";export * from "./apps/desktop/src/migration/nativeAtlasTerrain";export * from "./apps/desktop/src/migration/nativeAtlasWater";export * from "./apps/desktop/src/migration/unrealScene";',resolveDir:root},outfile:path.join(root,'artifacts/terrain-current.mjs'),bundle:true,platform:'node',format:'esm'});
const a=await import('../artifacts/terrain-current.mjs');
const cacheDirectory=path.join(root,'artifacts/erosion-cache');mkdirSync(cacheDirectory,{recursive:true});
const cacheFile=key=>path.join(cacheDirectory,key.replaceAll(':','_')+'.bin');
a.configureErosionCache({get:key=>existsSync(cacheFile(key))?deserialize(readFileSync(cacheFile(key))):undefined,put:(key,tile)=>writeFileSync(cacheFile(key),serialize(tile))});
const map=JSON.parse(await readFile(path.join(root,'artifacts/atlas-world.json'),'utf8'));
const c=a.atlasContext(map),coarse=a.createAtlasSampler(c),fine=a.createAtlasSampler(c,true,true);
const selection=a.selectAtlasTiles(-150,-150,c),leaves=selection.desired;
const scene=a.exportUnrealScene({...map,entities:map.entities.filter(e=>e.worldGeometry?.kind==='terrain'||e.worldGeometry?.kind==='water')});
scene.name='Eroded mountain terrain review';
const started=performance.now();let maxGapBefore=0,maxGapAfter=0,tiles=0;
for(const tile of leaves){
  const size=a.tileSize(tile);
  if(Math.abs((tile.x+.5)*size)>2400||Math.abs((tile.z+.5)*size)>2400)continue;
  const sample=tile.level<=5?fine:coarse,levels=a.atlasStitchLevels(tile,leaves);
  const mesh=a.buildAtlasMesh(tile,c,sample,levels,l=>l<=5?fine:coarse);
  for(let i=0;i<289;i++)if(levels[i]>tile.level){
    const x=tile.x*size+(i%17)*size/16,z=tile.z*size+Math.floor(i/17)*size/16;
    const expected=a.atlasTriangleSample(x,z,32*2**levels[i]/16,levels[i]<=5?fine:coarse);
    maxGapBefore=Math.max(maxGapBefore,Math.abs(sample(x,z)-expected));maxGapAfter=Math.max(maxGapAfter,Math.abs(mesh.positions[i*3+1]-expected));
  }
  const native=a.nativeAtlasTerrain(mesh,c);scene.meshes.push(...native.meshes);scene.instances.push(...native.instances);tiles++;
  const water=a.nativeAtlasWater(mesh,a.createAtlasHydrologySampler(c,tile.level<=5));
  if(water){scene.meshes.push(water);scene.instances.push({entityId:`water-${a.tileKey(tile)}`,meshId:water.id,position:{x:(tile.x+.5)*size,y:0,z:(tile.z+.5)*size},rotation:[0,0,0,1],scale:{x:1,y:1,z:1}});}
}
await writeFile(path.join(root,'artifacts/terrain-after.dndscene'),JSON.stringify(scene));
// A numerical before/after heightfield suitable for independent shaded relief
// inspection. Both stages share the same initial geology and world coordinates.
const resolution=161,cellSize=16,origin=0,heights=[],raw=[],regional=[];
for(let z=0;z<resolution;z++)for(let x=0;x<resolution;x++){const wx=origin+x*cellSize,wz=origin+z*cellSize;raw.push(a.atlasLandform(wx,wz,c.seed));regional.push(coarse(wx,wz));heights.push(fine(wx,wz));}
await writeFile(path.join(root,'artifacts/erosion-heightfields.json'),JSON.stringify({resolution,cellSize,raw,regional,heights}));
const report={seed:c.seed,tiles,seconds:(performance.now()-started)/1000,maxGapBefore,maxGapAfter,fineCellMetres:16,regionalCellMetres:64};
await writeFile(path.join(root,'artifacts/terrain-verification.json'),JSON.stringify(report,null,2));console.log(report);
if(maxGapAfter>.0002)throw new Error('Stitched terrain edges do not meet');
