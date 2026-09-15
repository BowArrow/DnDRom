import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'apps/desktop/package.json'));
await require('esbuild').build({stdin:{contents:'export {buildAtlasMesh} from "./apps/desktop/src/domain/worldAtlas";export {nativeAtlasWater} from "./apps/desktop/src/migration/nativeAtlasWater";',resolveDir:root},outfile:path.join(root,'artifacts/water-transfer-module.mjs'),bundle:true,platform:'node',format:'esm'});
const {buildAtlasMesh,nativeAtlasWater}=await import('../artifacts/water-transfer-module.mjs');
const mesh=buildAtlasMesh({x:0,z:0,level:3},{seed:719,width:0,depth:0,patches:[]},()=>-10),g=nativeAtlasWater(mesh,()=>1,0).lods[0];
const duplicate={positions:[],normals:[],uvs:[],colors:[],indices:[]};
for(const vertex of g.indices){for(const [key,width] of [['positions',3],['normals',3],['uvs',2],['colors',4]])duplicate[key].push(...g[key].slice(vertex*width,(vertex+1)*width));duplicate.indices.push(duplicate.indices.length);}
const shared=JSON.stringify(g),expanded=JSON.stringify(duplicate);
const report={triangles:g.indices.length/3,duplicatedVertices:duplicate.positions.length/3,sharedVertices:g.positions.length/3,duplicatedJsonBytes:Buffer.byteLength(expanded),sharedJsonBytes:Buffer.byteLength(shared),gzipBase64Characters:gzipSync(shared).toString('base64').length};
await writeFile(path.join(root,'artifacts/water-transfer-benchmark.json'),JSON.stringify(report,null,2));console.log(report);
