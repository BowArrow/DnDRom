import {describe,it,expect} from 'vitest';
import {settlementGrowth} from './settlementGrowth';
import {settlementHerbMesh,settlementVineMesh} from '../rendering/settlementPlantMesh';
import {buildingProgram,compileBuildingProgram} from './settlementBuildings';
import {expandSceneRecipe} from './sceneGrammar';
import {dressSettlementSurfaces,settlementMaterial,type SettlementSurface} from './settlementSurfaces';
import {buildAssemblyMeshes} from '../rendering/sceneAssemblyMesh';
import {settlementSurface} from './settlementSurfaces';
import {sharedWorldEntities} from './sharedWorldScene';
import type {WorldManifest} from './sharedWorld';
import {exportUnrealScene} from '../migration/unrealScene';
import type {GameMap} from './types';
const style={id:'style',name:'village',family:'timber' as const,material:'masonry' as const,roofColor:'#958779',wallColor:'#bcb098',roofCurve:0,bays:3,age:.8};
const profile:SettlementSurface={version:1,seed:31,age:1,moisture:1,wall:1,wood:1,roof:0};
const parts=expandSceneRecipe(compileBuildingProgram('growth-house',buildingProgram('growth-house','home',style),style));
describe('settlement surface and plant growth',()=>{
 it('chooses varied stable palettes and exports matching near/far materials while respecting authored finishes',()=>{
  const recipe=compileBuildingProgram('home',buildingProgram('home','home',style),style);
  const m={id:'world',seed:98,styles:[style],requests:[{id:'village',styleId:'style'}],terrain:{version:1,climate:[],edits:[]},transport:[],locations:[{id:'village',requestId:'village',position:{x:0,y:250,z:0},settlement:{buildings:Array.from({length:36},(_,i)=>({id:`home-${i}`,role:'home',position:{x:i*20,y:250,z:0},entrance:{x:i*20,y:250,z:-5},yaw:0,recipe})),streets:[],docks:[]}}]} as unknown as WorldManifest;
  const profiles=m.locations[0].settlement.buildings.map(b=>settlementSurface(m,'village',b.id));expect(new Set(profiles.map(p=>p.wall)).size).toBe(3);expect(new Set(profiles.map(p=>p.seed)).size).toBeGreaterThan(30);
  expect(settlementSurface(JSON.parse(JSON.stringify(m)),'village','home-0')).toEqual(profiles[0]);
  const origin={x:0,y:250,z:0},bounds={minX:-10,minZ:-10,maxX:10,maxZ:10};
  const near=sharedWorldEntities(m,origin,bounds,true),far=sharedWorldEntities(m,origin,bounds,false);
  const exported=(entities:GameMap['entities'])=>exportUnrealScene({id:'review',name:'review',entities} as GameMap);
  expect(exported(near).meshes.map(m=>m.material)).toEqual(exported(far).meshes.map(m=>m.material));
  const authored=structuredClone(near);authored[0].materialSlots={masonry:'authored-plaster'};const meshes=exported(authored).meshes;
  expect(meshes.some(m=>m.material==='authored-plaster')).toBe(true);expect(meshes.find(m=>m.material==='authored-plaster')!.lods[0].colors.every((v,i)=>i%4!==3||v===255)).toBe(true);
 });
 it('is stable across serialization and keeps vegetation out of access corridors and water/roads',()=>{
  const a=settlementGrowth('a',parts,profile,()=>.2,p=>p.x>0),b=settlementGrowth('a',JSON.parse(JSON.stringify(parts)),profile,()=>.2,p=>p.x>0);
  expect(a).toEqual(b);expect(a.herbs.length).toBeGreaterThan(0);expect(a.herbs.length).toBeLessThanOrEqual(96);expect(a.vines.length).toBeLessThanOrEqual(6);
  for(const p of a.herbs){expect(p.y).toBeCloseTo(.175);expect(p.x).toBeLessThanOrEqual(0);for(const door of parts.filter(p=>p.shape==='doorway')){const a=door.rotation.y*Math.PI/180,dx=p.x-door.position.x,dz=p.z-door.position.z;expect(Math.abs(dx*Math.cos(a)-dz*Math.sin(a))>=door.size.x/2+.55||Math.abs(dx*Math.sin(a)+dz*Math.cos(a))>=2.2).toBe(true);}}
  expect(settlementGrowth('a',parts,profile,()=>undefined).herbs).toHaveLength(0);
  expect(settlementGrowth('a',parts,profile,()=>0,()=>true).herbs).toHaveLength(0);
 });
 it('reduces growth in dry/new settlements and confines shoots to solid wall support',()=>{
  const wet=settlementGrowth('a',parts,profile,()=>0),dry=settlementGrowth('a',parts,{...profile,age:0,moisture:0},()=>0);
  expect(dry.herbs.length).toBeLessThan(wet.herbs.length);expect(dry.vines).toHaveLength(0);expect(wet.vines.length).toBeGreaterThan(0);
  for(const shoot of wet.vines)for(const p of shoot.points)expect(parts.some(w=>w.shape==='box'&&w.material==='masonry'&&p.y>=w.position.y-w.size.y/2&&p.y<=w.position.y+w.size.y/2&&Math.abs(p.x-shoot.normal.x*.17-w.position.x)<=w.size.x/2+.001&&Math.abs(p.z-shoot.normal.z*.17-w.position.z)<=w.size.z/2+.001)).toBe(true);
 });
 it('builds finite lit three-dimensional plants with bounded simpler LODs',()=>{
  const vines=settlementGrowth('a',parts,profile,()=>0).vines;
  for(const lod of [0,1,2])for(const mesh of [0,1,2].map(k=>settlementHerbMesh(k,lod)).concat(settlementVineMesh(vines,lod))){
   expect(mesh.indices.length).toBeGreaterThan(0);for(const field of ['positions','normals','uvs','colors','indices'] as const)expect(mesh[field].every(Number.isFinite)).toBe(true);
   for(let i=0;i<mesh.normals.length;i+=3)expect(Math.hypot(...mesh.normals.slice(i,i+3))).toBeCloseTo(1,4);
  }
  expect(settlementHerbMesh(1,2).indices.length).toBeLessThan(settlementHerbMesh(1,0).indices.length);
 });
 it('preserves construction while carrying coherent surface data and resolves material families',()=>{
  const dressed=dressSettlementSurfaces(parts,profile),meshes=buildAssemblyMeshes(dressed);
  expect(dressed.map(p=>p.position)).toEqual(parts.map(p=>p.position));
  for(const mesh of meshes.values()){expect(mesh.biomeUVs?.length).toBe(mesh.positions.length/3*2);for(let i=0;i<mesh.positions.length/3;i++){expect(mesh.biomeUVs![i*2]).toBeCloseTo(mesh.positions[i*3+1]);expect(mesh.biomeUVs![i*2+1]).toBeCloseTo(31.49);}}
  expect(settlementMaterial('masonry',profile)).toBe('masonry-aged-1');expect(settlementMaterial('timber',profile)).toBe('timber-aged-1');expect(settlementMaterial('masonry')).toBe('masonry');
 });
});
