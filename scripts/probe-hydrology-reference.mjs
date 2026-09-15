import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'apps/desktop/package.json'));
await require('esbuild').build({stdin:{contents:'export * from "./apps/desktop/src/domain/hydraulicErosion";export * from "./apps/desktop/src/domain/worldLandform";',resolveDir:root},outfile:path.join(root,'artifacts/hydrology-probe.mjs'),bundle:true,platform:'node',format:'esm'});
const {simulateHydraulicErosion,atlasGradientNoise}=await import('../artifacts/hydrology-probe.mjs');
const resolution=257,cellSize=8,source=[];
for(let z=0;z<resolution;z++)for(let x=0;x<resolution;x++){
  let h=0,amplitude=1,frequency=1/256;
  for(let o=0;o<8;o++){h+=(atlasGradientNoise(x*frequency,z*frequency,719+o*101)-.5)*amplitude;frequency*=2;amplitude*=.6;}
  source.push(h);
}
const low=Math.min(...source),high=Math.max(...source);for(let i=0;i<source.length;i++)source[i]=(source[i]-low)/(high-low)*640;
const started=performance.now(),batches=Number(process.argv[2]??512);
const result=simulateHydraulicErosion(source,resolution,cellSize,719,1,batches,1/256);
await writeFile(path.join(root,'artifacts/hydrology-reference-field.json'),JSON.stringify({resolution,cellSize,raw:source,heights:Array.from(result.height),flow:Array.from(result.discharge),sediment:Array.from(result.sediment)}));
console.log({batches,seconds:(performance.now()-started)/1000,massError:result.massError,exportedSediment:result.exportedSediment});
