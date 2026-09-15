import {describe,it,expect} from 'vitest';
import {inferSceneEnvironment,sampleEnvironment} from './worldEnvironment';
import {sampleSharedClimate,reserveClimate} from './worldClimate';
import {buildSharedWorld} from './worldPipeline';
import {compileSharedScene,sharedWorldEntities} from './sharedWorldScene';
import {assertWorldManifest} from './sharedWorldValidation';
import type {SharedTerrain} from './sharedWorld';
import type {WorldPlan} from './types';
describe('environment layers',()=>{
 it('keeps volcanic and magical overlays distinct from underground space',()=>{
  expect(inferSceneEnvironment('An enchanted volcanic cavern')).toMatchObject({stratum:'underground',depth:24,overlays:[{kind:'volcanic'},{kind:'magical'}]});
  expect(inferSceneEnvironment('A tropical forest')).toEqual({stratum:'surface',depth:undefined,overlays:[]});
 });
 it('blends habitat modifiers continuously without altering the underlying climate or height',()=>{
  const terrain:SharedTerrain={version:1,climate:reserveClimate(7,{x:0,z:0}),edits:[],environments:[{id:'lava',x:0,z:0,radius:100,overlays:[{kind:'volcanic',name:'Caldera',strength:.8},{kind:'magical',name:'Enchanted',strength:.5}]}]};
  const bare=sampleSharedClimate(7,{...terrain,environments:[]},0,0,220),layered=sampleSharedClimate(7,terrain,0,0,220);
  expect(layered.biome).toBe(bare.biome);expect(layered.temperature).toBe(bare.temperature);expect(layered.forest).toBeLessThan(bare.forest);expect(layered.habitats).toContain('magical:Enchanted');
  expect(sampleEnvironment(terrain,100,0).volcanic).toBe(0);expect(sampleEnvironment(terrain,99.999,0).volcanic).toBeLessThan(.00001);
 });
 it('compiles underground rooms below a persistent surface entrance, without surface foliage',()=>{
  const world:WorldPlan={id:'cave-world',seed:'7',name:'Caves',summary:'Caves',widthMiles:124,depthMiles:124,roads:[],locations:[{id:'cave',name:'Crystal cavern',kind:'wilderness',biome:'cavern',position:{x:0,z:0},description:'An enchanted underground cavern',storyBeatIds:[],pointOfInterests:[],mapSeed:'7'}]};
  const accepted=buildSharedWorld(world,undefined,{height:()=>220,flow:()=>0,level:180}),before=JSON.stringify(accepted.manifest),map=compileSharedScene(accepted,'cave');
  expect(map.world!.environment!.stratum).toBe('underground');expect(map.world!.site!.datum).toBe(196);expect(map.entities.some(e=>e.tags?.includes('world:interior'))).toBe(true);expect(map.entities.some(e=>e.tags?.includes('world:vegetation'))).toBe(false);
  expect(sharedWorldEntities(accepted.manifest!,{x:0,y:220,z:0},{minX:-128,minZ:-128,maxX:128,maxZ:128}).some(e=>e.id==='cave-entrance')).toBe(true);
  assertWorldManifest(accepted.manifest);expect(JSON.stringify(accepted.manifest)).toBe(before);
 });
});
