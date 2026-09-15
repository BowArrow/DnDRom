import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {serialize,deserialize} from 'node:v8';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../apps/desktop/package.json',import.meta.url));await require('esbuild').build({stdin:{contents:'export {buildSharedWorld} from "./apps/desktop/src/domain/worldPipeline";export {configureErosionCache} from "./apps/desktop/src/domain/worldErosion";',resolveDir:process.cwd()},outfile:'artifacts/shared-world/connections.mjs',bundle:true,platform:'node',format:'esm'});
const {buildSharedWorld,configureErosionCache}=await import('../artifacts/shared-world/connections.mjs');
const directory='artifacts/shared-world/erosion-cache';mkdirSync(directory,{recursive:true});const filename=key=>`${directory}/${Buffer.from(key).toString('hex')}.bin`;
configureErosionCache({get:key=>{try{return deserialize(readFileSync(filename(key)));}catch{return undefined;}},put:(key,tile)=>writeFileSync(filename(key),serialize(tile))});
const base=process.argv.includes('--island')?'artifacts/shared-island-world':'artifacts/shared-world';
const input=JSON.parse(readFileSync(base+'/world.json','utf8')),mainland=input.manifest.locations[1].id;
for(const [id,name,landform,from]of [['forest','Forest quest site','any',mainland],['mountain','Mountain quest site','highland','forest']]){
 input.locations.push({id,name,kind:'wilderness',biome:id==='forest'?'forest':'mountains',position:{x:0,z:0},description:name,storyBeatIds:[],pointOfInterests:[],mapSeed:input.seed});
 input.manifest.requests.push({id,name,description:name,purpose:'wilderness',intent:{water:'none',forest:id==='forest'?.9:.2,landform},island:false,scale:'wilderness',roles:{},connectsTo:[from],modes:['road'],styleId:input.manifest.styles[0].id,status:'pending'});
}
const started=performance.now();
try{const result=buildSharedWorld(input,p=>{console.log(Math.round(performance.now()-started),p.stage,p.message);if(p.checkpoint)writeFileSync(base+'/connected-checkpoint.json',JSON.stringify(p.checkpoint));});writeFileSync(base+'/connected-world.json',JSON.stringify(result));console.log(JSON.stringify({elapsed:performance.now()-started,locations:result.manifest.locations.map(l=>({id:l.id,position:l.position})),routes:result.manifest.transport.map(r=>({mode:r.mode,length:r.length,grade:r.maxGrade}))}));}catch(e){console.error(e);process.exitCode=1;}

