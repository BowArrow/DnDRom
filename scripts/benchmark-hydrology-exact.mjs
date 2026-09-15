import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'apps/desktop/package.json'));
for(const [name,file] of [['before','artifacts/referenceHydrology-024-before.ts'],['after','apps/desktop/src/domain/referenceHydrology.ts']])await require('esbuild').build({entryPoints:[path.join(root,file)],outfile:path.join(root,`artifacts/hydrology-024-${name}.mjs`),bundle:true,platform:'node',format:'esm'});
const before=await import('../artifacts/hydrology-024-before.mjs'),after=await import('../artifacts/hydrology-024-after.mjs');
const results=[];
for(const [resolution,batches,seed] of [[65,32,42],[257,128,719],[257,512,1337]]){
 const source=Float64Array.from({length:resolution**2},(_,i)=>{const x=i%resolution,z=Math.floor(i/resolution);return 400+120*Math.sin(x*.03)*Math.cos(z*.021)+x*.2;});
 const start=performance.now(),a=before.simulateHydraulicErosion(source,resolution,16,seed,1,batches),middle=performance.now(),b=after.simulateHydraulicErosion(source,resolution,16,seed,1,batches),end=performance.now();
 for(const key of ['height','delta','discharge','sediment','momentumX','momentumZ'])assert(Buffer.from(a[key].buffer).equals(Buffer.from(b[key].buffer)),`${key} differs`);
 assert.equal(a.massError,b.massError);assert.equal(a.exportedSediment,b.exportedSediment);
 results.push({resolution,batches,seed,beforeMs:middle-start,afterMs:end-middle,byteIdentical:true});
}
await writeFile(path.join(root,'artifacts/hydrology-024-benchmark.json'),JSON.stringify(results,null,2));console.log(results);
