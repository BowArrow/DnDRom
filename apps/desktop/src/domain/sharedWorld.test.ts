import {describe,it,expect} from 'vitest';
import {reserveClimate,sampleWorldClimate,validateBiomeCoverage,worldForestCandidates,orographicPrecipitation,climateHabitats} from './worldClimate';
import {applyTerrainEdits,worldClearing,BIOME_FAMILIES,worldRegionFingerprint,type SharedTerrain} from './sharedWorld';
import {routeTransport,ferryPosition,navigableWater} from './worldTransport';
import {createWorldManifest,proposeLocationProgram,validatePlan,buildSharedWorld,findDock,repairDockClearance} from './worldPipeline';
import {sharedWorldEntities} from './sharedWorldScene';
import type {WorldPlan} from './types';
import {expandSceneRecipe} from './sceneGrammar';
const world:WorldPlan={id:'fixture-world',seed:'fixture',name:'Fixture',summary:'World',widthMiles:120,depthMiles:100,roads:[],locations:[{id:'town',name:'Town',kind:'town',biome:'town',position:{x:0,z:0},description:'Town',storyBeatIds:[],pointOfInterests:[],mapSeed:'legacy'}]};
describe('shared world ownership',()=>{
 it('places a berth with clearance across the ferry width, not just its center',()=>{
   const t={height:(x:number)=>182-x*.2,flow:()=>0,level:180};
   const dock=findDock(createWorldManifest(world,{x:0,z:0}),'harbor',{x:0,y:182,z:0},t);
   expect(navigableWater(t,dock.water)).toBe(true);
   const route=routeTransport({...dock.water,y:180},{x:100,y:180,z:dock.water.z},t,{id:'ferry',from:'harbor',to:'village',mode:'ferry'});
   expect(route.length).toBeGreaterThan(0);
 });
 it('repairs a legacy shallow berth while preserving its landing and stable identity',()=>{
   const t={height:(x:number)=>182-x*.2,flow:()=>0,level:180};
   const dock={id:'saved-dock',land:{x:0,y:182,z:0},water:{x:17,y:180.35,z:0},width:4,waterBodyId:'saved-water'},saved=structuredClone(dock);
   expect(180-t.height(dock.water.x)).toBeGreaterThan(1.2);
   expect(navigableWater(t,dock.water)).toBe(false);
   repairDockClearance(dock,t);
   expect(navigableWater(t,dock.water)).toBe(true);
   expect({...dock,water:saved.water}).toEqual(saved);
   const repaired=structuredClone(dock);repairDockClearance(dock,t);expect(dock).toEqual(repaired);
 });
 it('rejects an unsafe saved berth without relocating it across dry land',()=>{
   const dock={id:'saved-dock',land:{x:0,y:182,z:0},water:{x:17,y:180.35,z:0},width:4,waterBodyId:'saved-water'},saved=structuredClone(dock);
   expect(()=>repairDockClearance(dock,{height:x=>x>=19?185:179,flow:()=>0,level:180})).toThrow(/no safe extension/);
   expect(dock).toEqual(saved);
 });
 it('builds suspension cables without zero-length terminal geometry',()=>{const parts=expandSceneRecipe([{shape:'suspension',position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},size:{x:3,y:5,z:34},material:'timber',color:'#86755c'}]);expect(parts.length).toBeGreaterThan(50);for(const p of parts)expect(Math.min(p.size.x,p.size.y,p.size.z)).toBeGreaterThan(0);});
 it('keeps forest identities across scene origins and detail levels',()=>{const whole=worldForestCandidates(9,-64,-64,128),tiles=[...worldForestCandidates(9,-64,-64,64),...worldForestCandidates(9,0,-64,64),...worldForestCandidates(9,-64,0,64),...worldForestCandidates(9,0,0,64)],ids=(points:typeof whole)=>points.map(p=>JSON.stringify(p)).sort();expect(ids(tiles)).toEqual(ids(whole));for(const p of worldForestCandidates(9,-64,-64,128,4))expect(whole).toContainEqual(p);});
 it('invalidates affected regions while preserving unrelated tile signatures',()=>{const m=createWorldManifest(world,{x:0,z:0}),a=worldRegionFingerprint(m,0,0,128),far=worldRegionFingerprint(m,8000,8000,128),edited=structuredClone(m);edited.revision++;edited.terrain.edits.push({id:'plot',kind:'foundation',points:[{x:30,y:220,z:30}],width:10,feather:3});expect(worldRegionFingerprint(edited,0,0,128)).not.toBe(a);expect(worldRegionFingerprint(edited,8000,8000,128)).toBe(far);});
 it('produces windward rain and leeward shadows, with drainage controlling wetlands',()=>{expect(orographicPrecipitation(900,500,200)).toBeGreaterThan(orographicPrecipitation(900,200,500));expect(climateHabitats(200,.8,.02,.1)).toContain('wetland');expect(climateHabitats(200,.8,.02,.8)).not.toContain('wetland');expect(climateHabitats(178,0,0,.1)).toContain('aquatic');});
 it('indexes every natural family within the campaign extent',()=>{for(const seed of [1,17,9001]){const origin={x:12000,z:-7000},r=reserveClimate(seed,origin);expect(validateBiomeCoverage(seed,r,origin,100000)).toEqual([]);expect(new Set(r.map(p=>sampleWorldClimate(seed,r,p.x,p.z).biome)).size).toBe(BIOME_FAMILIES.length);}});
 it('samples continuously across climate cell and macroregion boundaries',()=>{const r=reserveClimate(17,{x:0,z:0});for(const x of [0,128,8192,-8192]){const a=sampleWorldClimate(17,r,x-.001,37),b=sampleWorldClimate(17,r,x+.001,37);expect(Math.abs(a.temperature-b.temperature)).toBeLessThan(.001);expect(Math.abs(a.precipitation-b.precipitation)).toBeLessThan(.1);}});
 it('retains climate identity after serialization and shuffled sampling',()=>{const r=reserveClimate(3,{x:0,z:0}),clone=JSON.parse(JSON.stringify(r));const points=[[-20000,8000],[8400,-7800],[0,0]];for(const[x,z]of points.reverse())expect(sampleWorldClimate(3,r,x,z)).toEqual(sampleWorldClimate(3,clone,x,z));});
 it('shares foundation and road edits across the origin and index boundaries',()=>{const terrain:SharedTerrain={version:1,climate:[],edits:[{id:'road',kind:'road',width:4,feather:2,points:[{x:-100,y:10,z:128},{x:300,y:20,z:128}]}]};expect(applyTerrainEdits(terrain,100,128,50)).toBe(15);expect(worldClearing(terrain,100,128)).toBe(1);expect(applyTerrainEdits(terrain,100,140,50)).toBe(50);expect(applyTerrainEdits(terrain,128-.001,128,50)).toBeCloseTo(applyTerrainEdits(terrain,128+.001,128,50),3);});
 it('routes graded roads and respects water clearance',()=>{const t={height:(x:number)=>220+x*.05,flow:()=>0,level:180},r=routeTransport({x:0,z:0,y:220},{x:240,z:160,y:232},t,{id:'road',from:'a',to:'b',mode:'road'});expect(r.maxGrade).toBeLessThanOrEqual(.16);expect(r.points[0].x).toBe(0);expect(r.points.at(-1)!.x).toBe(240);});
 it('rejects disconnected water instead of drawing a ferry across land',()=>{expect(()=>routeTransport({x:0,z:0,y:180},{x:160,z:0,y:180},{height:(x)=>x>64&&x<96?190:170,flow:()=>0,level:180},{id:'ferry',from:'a',to:'b',mode:'ferry',maxNodes:1000})).toThrow();});
 it('crosses a river with dry bridge approaches and clearance',()=>{const t={height:(x:number)=>x>20&&x<44?214:220,flow:(x:number)=>x>20&&x<44?1:0,level:180};const route=routeTransport({x:0,y:220,z:0},{x:80,y:220,z:0},t,{id:'bridge',from:'a',to:'b',mode:'road',step:8,maxNodes:10000});expect(route.bridges.length).toBeGreaterThan(0);for(const b of route.bridges){expect(t.flow(b.start.x)).toBe(0);expect(t.flow(b.end.x)).toBe(0);expect(Math.min(b.start.y,b.end.y)).toBeGreaterThan(215.2);}expect(route.maxGrade).toBeLessThanOrEqual(.16);});
 it('animates a reversible ferry with dock dwell',()=>{const r=routeTransport({x:0,z:0,y:180},{x:96,z:0,y:180},{height:()=>170,flow:()=>0,level:180},{id:'ferry',from:'a',to:'b',mode:'ferry',step:16});expect(ferryPosition(r,0).state).toBe('arrival');expect(ferryPosition(r,20).position.x).toBeGreaterThan(0);expect(ferryPosition(r,12+r.length/r.speed).position.x).toBeCloseTo(96);});
 it('builds every required role with stable near and far building footprints',()=>{const m=createWorldManifest(world,{x:0,z:0}),r=m.requests[0];r.roles={home:4,inn:1};const l=proposeLocationProgram(m,r,{position:{x:0,y:220,z:0},slope:0,relief:0},{height:()=>220,flow:()=>0,level:180});m.locations=[l];expect(l.settlement.buildings).toHaveLength(5);const bounds={minX:-128,minZ:-128,maxX:128,maxZ:128},o={x:0,y:220,z:0};const near=sharedWorldEntities(m,o,bounds,true),far=sharedWorldEntities(m,o,bounds,false);expect(near.map(e=>[e.id,e.position,e.rotation])).toEqual(far.map(e=>[e.id,e.position,e.rotation]));expect(validatePlan(m)).toEqual([]);});
 it('rejects undersized and flooded settlement sites without changing the manifest',()=>{const m=createWorldManifest(world,{x:0,z:0}),before=JSON.stringify(m);expect(()=>proposeLocationProgram(m,m.requests[0],{position:{x:0,y:220,z:0},slope:0,relief:0},{height:(x,z)=>Math.abs(x)<4&&Math.abs(z)<4?220:170,flow:()=>0,level:180})).toThrow();expect(JSON.stringify(m)).toBe(before);});
 it('adds connected scenes without mutating accepted geography or IDs',()=>{const input=structuredClone(world);input.locations[0].kind='wilderness';const t={height:()=>220,flow:()=>0,level:180},first=buildSharedWorld(input,undefined,t),saved=JSON.stringify(first);const extended=structuredClone(first);extended.locations.push({...extended.locations[0],id:'forest',name:'Forest'});extended.manifest!.requests.push({...extended.manifest!.requests[0],id:'forest',name:'Forest',status:'pending'});const second=buildSharedWorld(extended,undefined,t);expect(JSON.stringify(first)).toBe(saved);expect(second.manifest!.locations[0]).toEqual(first.manifest!.locations[0]);expect(second.manifest!.transport).toHaveLength(1);expect(validatePlan(second.manifest!)).toEqual([]);});
});
