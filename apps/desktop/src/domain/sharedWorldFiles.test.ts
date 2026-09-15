import {describe,it,expect} from 'vitest';
import {createStarterCampaign} from './seed';
import {compactSharedCampaign,compactSharedMap,restoreSharedMapDetails} from './sharedWorldFiles';
import {createWorldManifest} from './worldPipeline';
import {assertWorldManifest} from './sharedWorldValidation';
import type {MapEntity,WorldPlan,WorldRegionManifest} from './types';

const entity=(id:string,extra:Partial<MapEntity>={}):MapEntity=>({id,name:id,assetId:'crate',position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},...extra});
function fixture(){
 const campaign=createStarterCampaign(),world:WorldPlan={id:'portable',seed:'42',name:'Portable',summary:'Fixture',widthMiles:124,depthMiles:124,locations:[],roads:[]};
 world.manifest=createWorldManifest(world,{x:0,z:0});campaign.world=world;
 campaign.map.world={version:1,blueprintId:'test',seed:42,chunkSize:16,chunks:[],generatedAt:'2026-09-08',sharedWorld:world.manifest} as WorldRegionManifest;
 campaign.map.entities=[entity('generated-tree',{tags:['world:vegetation']}),entity('user-crate'),entity('house',{tags:['world:building']})];
 return campaign;
}
describe('portable shared campaigns',()=>{
 it('leaves legacy maps intact',()=>{const c=createStarterCampaign();expect(compactSharedMap(c.map)).toBe(c.map);});
 it('omits disposable scatter while retaining accepted plans and authored objects without mutating the source',()=>{
  const c=fixture(),before=JSON.stringify(c),saved=compactSharedCampaign(c);
  expect(saved.map.sharedCacheOmitted).toBe(true);expect(saved.map.entities.map(e=>e.id)).toEqual(['user-crate','house']);
  expect(JSON.stringify(c)).toBe(before);assertWorldManifest(JSON.parse(JSON.stringify(saved.world!.manifest)));
  expect(saved.world!.manifest).toEqual(c.world!.manifest);
 });
 it('rehydrates caches with stable scene identity and settings, respecting accepted removals and generated edits',()=>{
  const c=fixture(),saved=compactSharedMap(c.map),generated=structuredClone(c.map);saved.name='My harbor';
  generated.world!.sharedWorld!.removedEntityIds=['house'];generated.entities=[entity('generated-tree',{tags:['world:vegetation']}),entity('user-crate',{position:{x:15,y:0,z:0}})];
  const result=restoreSharedMapDetails(saved,generated);
  expect(result.id).toBe(saved.id);expect(result.name).toBe('My harbor');expect(result.lighting).toEqual(saved.lighting);
  expect(result.sharedCacheOmitted).toBeUndefined();expect(result.entities.map(e=>e.id)).toEqual(['generated-tree','user-crate']);expect(result.entities[1].position.x).toBe(15);
 });
});
