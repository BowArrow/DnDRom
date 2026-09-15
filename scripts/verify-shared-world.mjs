import {mkdir,writeFile} from 'node:fs/promises';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {serialize,deserialize} from 'node:v8';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,process.argv.includes('--island')?'artifacts/shared-island-world':process.argv.includes('--fresh')?'artifacts/shared-fresh-world':'artifacts/shared-world');await mkdir(out,{recursive:true});
const require=createRequire(path.join(root,'apps/desktop/package.json'));
await require('esbuild').build({stdin:{contents:'export {buildSharedWorld,createWorldManifest} from "./apps/desktop/src/domain/worldPipeline"; export {compileSharedScene} from "./apps/desktop/src/domain/sharedWorldScene"; export {erosionStatistics,configureErosionCache} from "./apps/desktop/src/domain/worldErosion";export {exportUnrealScene} from "./apps/desktop/src/migration/unrealScene";',resolveDir:root},outfile:path.join(out,'pipeline.mjs'),bundle:true,platform:'node',format:'esm'});
const {buildSharedWorld,createWorldManifest,compileSharedScene,erosionStatistics,configureErosionCache,exportUnrealScene}=await import(pathToFileURL(path.join(out,'pipeline.mjs')));
const cacheDir=path.join(root,'artifacts/shared-world/erosion-cache');mkdirSync(cacheDir,{recursive:true});const cacheFile=key=>path.join(cacheDir,Buffer.from(key).toString('hex')+'.bin');configureErosionCache({get:key=>{if(process.argv.includes('--cold'))return undefined;try{return deserialize(readFileSync(cacheFile(key)));}catch{return undefined;}},put:(key,tile)=>writeFileSync(cacheFile(key),serialize(tile))});
const world={id:'shared-harbor-fixture',seed:'719',name:'Harbor world',summary:'A harbor town beside a great lake',widthMiles:124,depthMiles:124,roads:[],locations:[{id:'harbor',name:'Lakeshore Harbor',kind:'town',biome:'coast',position:{x:0,z:0},description:'A harbor town beside a great lake, with a ferry to a mainland village',storyBeatIds:[],pointOfInterests:[],mapSeed:'legacy'}]};
if(process.argv.includes('--island'))world.locations[0].description='An island harbor town in a great lake with a ferry to a mainland village';
world.manifest=createWorldManifest(world,{x:-3264,z:4608});
if(process.argv.includes('--resume'))Object.assign(world,JSON.parse(readFileSync(path.join(out,'checkpoint.json'),'utf8')));
if(process.argv.includes('--fresh'))delete world.manifest;
const start=performance.now();
process.on('exit',()=>writeFileSync(path.join(out,'peak-memory.json'),JSON.stringify({peakRssKiB:process.resourceUsage().maxRSS,scope:'Node planner and scene compiler process'})));
try{const result=buildSharedWorld(world,p=>{console.log(JSON.stringify({elapsed:Math.round(performance.now()-start),stage:p.stage,message:p.message}));if(p.checkpoint)writeFileSync(path.join(out,'checkpoint.json'),JSON.stringify(p.checkpoint));});await writeFile(path.join(out,'world.json'),JSON.stringify(result));const planningMs=performance.now()-start,sceneStart=performance.now(),map=compileSharedScene(result,'harbor');await writeFile(path.join(out,'map.json'),JSON.stringify(map));const exportStart=performance.now(),scene=exportUnrealScene(map);await writeFile(path.join(out,'scene.dndscene'),JSON.stringify(scene));const report={planningMs,sceneMs:exportStart-sceneStart,exportMs:performance.now()-exportStart,locations:result.manifest.locations.length,buildings:result.manifest.locations.map(l=>l.settlement.buildings.length),routes:result.manifest.transport.map(r=>({mode:r.mode,length:r.length,grade:r.maxGrade})),erosion:erosionStatistics,memory:process.memoryUsage(),warnings:scene.warnings};await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}catch(error){await writeFile(path.join(out,'failure.txt'),String(error.stack));console.error(error);process.exitCode=1;}


