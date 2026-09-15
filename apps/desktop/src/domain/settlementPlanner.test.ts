import {describe,it,expect} from 'vitest';
import {createWorldManifest,proposeLocationProgram,validatePlan,buildSharedWorld,reviseSettlement} from './worldPipeline';
import {planSettlement} from './settlementPlanner';
import {compileBuildingProgram,buildingProgram,settlementStyle} from './settlementBuildings';
import {expandSceneRecipe,scenePartSchema} from './sceneGrammar';
import {assertWorldManifest} from './sharedWorldValidation';
import {buildingFootprint,polygonsOverlap,polygonDistance,rectangle} from './settlementSpatial';
import {applyTerrainEdits} from './sharedWorld';
import {buildAssemblyMeshes,openingParts} from '../rendering/sceneAssemblyMesh';
import type {WorldPlan} from './types';

export const settlementFixture:WorldPlan={id:'settlement-fixture',seed:'7',name:'Town',summary:'Town',widthMiles:100,depthMiles:100,roads:[],locations:[{id:'town',name:'Market town',kind:'town',biome:'town',description:'A thriving timber market town',position:{x:0,z:0},storyBeatIds:[],pointOfInterests:[],mapSeed:'7'}]};
const flat={height:()=>220,flow:()=>0,level:180};
describe('settlement architecture',()=>{
 it('fits every required role without a repeated parcel grid',()=>{
   const m=createWorldManifest(settlementFixture,{x:0,z:0}),r=m.requests[0];r.roles={home:24,warehouse:4,workshop:4,inn:1,market:1,hall:1,shrine:1};
   const l=proposeLocationProgram(m,r,{position:{x:0,y:220,z:0},slope:0,relief:0},flat);m.locations=[l];
   expect(l.settlement.buildings).toHaveLength(36);expect(validatePlan(m)).toEqual([]);assertWorldManifest(m);
   expect(new Set(l.settlement.buildings.map(b=>b.program!.family)).size).toBeGreaterThanOrEqual(6);
   expect(new Set(l.settlement.buildings.map(b=>Math.round(b.yaw))).size).toBeGreaterThan(5);
   for(const[a,b]of l.settlement.buildings.flatMap((a,i)=>l.settlement.buildings.slice(i+1).map(b=>[a,b])))expect(polygonsOverlap(buildingFootprint(a),buildingFootprint(b))).toBe(false);
   expect(proposeLocationProgram(m,r,{position:{x:0,y:220,z:0},slope:0,relief:0},flat).settlement).toEqual(l.settlement);
 });
 it('refines a narrow dock approach that an eight metre routing grid misses',()=>{
   const m=createWorldManifest(settlementFixture,{x:0,z:0}),r={...m.requests[0],roles:{home:1}};
   const t={height:()=>220,flow:()=>0,level:180,blocked:(x:number,z:number)=>z < -30 && z > -90 && Math.abs(x-4)>1.9};
   const docks=[{id:'narrow-dock',land:{x:0,y:220,z:-120},water:{x:0,y:180,z:-160},width:4,waterBodyId:'lake'}];
   const plan=planSettlement(m,r,{x:0,y:220,z:0},t,docks);
   expect(plan.buildings).toHaveLength(1);expect(plan.streets.some(s=>s.to==='narrow-dock')).toBe(true);
   for(const street of plan.streets)for(const p of street.points)expect(t.blocked(p.x,p.z)).toBe(false);
 });
 it('keeps scene and role identities independent of role insertion order',()=>{
   const m=createWorldManifest(settlementFixture,{x:0,z:0}),r={...m.requests[0],roles:{home:3,inn:1}};
   const a=planSettlement(m,r,{x:0,y:220,z:0},flat,[]),b=planSettlement(m,{...r,roles:{inn:1,home:3}},{x:0,y:220,z:0},flat,[]);
   expect(a).toEqual(b);
 });
 it('creates distinct regional structures with valid native meshes and bounded recipes',()=>{
   const m=createWorldManifest(settlementFixture,{x:0,z:0});
   for(const family of ['timber','courtyard','earthen','fortress'] as const)for(const role of ['home','inn','warehouse','market','keep']){
     const style=settlementStyle({...m.styles[0],family},m.requests[0]),p=buildingProgram('test-'+family+role,role,style),recipe=compileBuildingProgram('test',p,style),expanded=expandSceneRecipe(recipe);
     recipe.forEach(part=>scenePartSchema.parse(part));expect(expanded.length).toBeLessThanOrEqual(384);
     for(const mesh of buildAssemblyMeshes(expanded).values()){for(const field of ['positions','normals','uvs','colors','indices'] as const)expect(mesh[field].every(Number.isFinite),`${family}/${role}/${field}`).toBe(true);expect(mesh.indices.every(i=>i>=0&&i<mesh.positions.length/3)).toBe(true);}
   }
 });
 it('leaves a real entrance and upper-floor stairwell in occupied shells',()=>{
   const parts=expandSceneRecipe([{shape:'house',position:{x:0,y:3.1,z:0},size:{x:9,y:6.2,z:10},rotation:{x:0,y:0,z:0},material:'masonry',color:'#aaa999',levels:2,bays:{x:3,z:2}}]);
   const solids=parts.flatMap(p=>p.shape==='window-frame'||p.shape==='doorway'?openingParts(p):[p]);
   const occupied=(x:number,y:number,z:number)=>solids.some(p=>{const a=p.rotation.y*Math.PI/180,dx=x-p.position.x,dz=z-p.position.z;return Math.abs(dx*Math.cos(a)-dz*Math.sin(a))<p.size.x/2&&Math.abs(y-p.position.y)<p.size.y/2&&Math.abs(dx*Math.sin(a)+dz*Math.cos(a))<p.size.z/2;});
   expect(occupied(0,1.2,-5)).toBe(false);expect(occupied(-4,1.2,-5)).toBe(true);
   expect(occupied(3.3,3.2,0)).toBe(false);expect(occupied(-2,3.2,0)).toBe(true);
 });
 it('grades rotated foundations in world space without flattening their surrounding square',()=>{
   const footprint=rectangle({x:127,z:127},6,18,45),terrain={version:1 as const,climate:[],edits:[{id:'f',kind:'foundation' as const,points:[{x:127,y:220,z:127}],width:18,feather:1,footprint}]};
   expect(applyTerrainEdits(terrain,127,127,210)).toBe(220);expect(applyTerrainEdits(terrain,135,119,210)).toBe(210);
   expect(polygonDistance(footprint,{x:130,z:130})).toBeLessThan(0);
 });
 it('generates an enclosure and varied castle buildings instead of a house-grid castle',()=>{
   const w=structuredClone(settlementFixture);w.locations[0].name='Ridge castle';w.locations[0].description='A stone fortress';
   const m=createWorldManifest(w,{x:0,z:0}),r=m.requests[0],l=proposeLocationProgram(m,r,{position:{x:0,y:220,z:0},slope:0,relief:0},flat);m.locations=[l];
   expect(l.settlement.buildings.some(b=>b.role==='keep')).toBe(true);expect(l.settlement.structures!.length).toBeGreaterThan(10);expect(validatePlan(m)).toEqual([]);assertWorldManifest(m);
 });
 it('revises a settlement transactionally and keeps other locations and custom entities',()=>{
   const original=buildSharedWorld(settlementFixture,undefined,flat),before=JSON.stringify(original);
   original.manifest!.authoredEntities=[{id:'authored-tree',assetId:'tree',name:'My tree',position:{x:800,y:220,z:800},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}];
   const revised=reviseSettlement(original,'town',undefined,flat);
   expect(revised.manifest!.revision).toBe(original.manifest!.revision+1);
   expect(revised.manifest!.terrain.climate).toEqual(original.manifest!.terrain.climate);
   expect(revised.manifest!.authoredEntities).toEqual(original.manifest!.authoredEntities);
   expect(JSON.stringify({...original,manifest:{...original.manifest,authoredEntities:undefined}})).toBe(before);
   const edited=structuredClone(original);edited.manifest!.removedEntityIds=[edited.manifest!.locations[0].settlement.buildings[0].id];const saved=JSON.stringify(edited);
   expect(()=>reviseSettlement(edited,'town',undefined,flat)).toThrow(/edited or removed/);expect(JSON.stringify(edited)).toBe(saved);
 });
 it('fits varied cities and coastal towns across seeds with valid access',()=>{
   for(const seed of ['21','91','717'])for(const coastal of [false,true]){
     const w=structuredClone(settlementFixture);w.seed=seed;w.locations[0].kind=coastal?'town':'city';
     const m=createWorldManifest(w,{x:0,z:0}),r=m.requests[0];
     const terrain=coastal?{height:(x:number,z:number)=>220+Math.min(0,z)*.1,flow:()=>0,level:180}:flat;
     const docks=coastal?[{id:'dock',land:{x:0,y:184,z:-360},water:{x:0,y:180,z:-420},width:4,waterBodyId:'lake'}]:[];
     const settlement=planSettlement(m,r,{x:0,y:220,z:0},terrain,docks);
     m.locations=[{id:r.id,requestId:r.id,name:r.name,position:{x:0,y:220,z:0},radius:400,biome:'temperate-forest',slope:0,relief:0,settlement}];
     expect(settlement.buildings.length).toBe(Object.values(r.roles).reduce((a,b)=>a+b,0));expect(validatePlan(m)).toEqual([]);assertWorldManifest(m);
   }
 },30000);

});
