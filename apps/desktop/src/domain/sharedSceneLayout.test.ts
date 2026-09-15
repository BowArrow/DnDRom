import {expect,it} from 'vitest';
import {sharedSceneMatchesLayout} from './sharedSceneLayout';
import {refreshSharedMap} from './sharedWorldPersistence';
import type {Campaign,GameMap} from './types';
import type {WorldManifest} from './sharedWorld';

function fixture(){
 const entity={id:'house',position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},tags:['world:building']};
 const manifest={id:'world',revision:1,terrain:{},locations:[{id:'town',settlement:{id:'town',buildings:[{id:'house',position:{x:100,y:20,z:200},yaw:0,recipe:[]}],streets:[],docks:[]}}]} as unknown as WorldManifest;
 const map={width:256,depth:256,locationId:'town',entities:[entity],world:{site:{x:100,z:200,datum:20},sharedWorld:manifest}} as unknown as GameMap;
 return {map,manifest};
}
it('checks generated positions independently of the manifest revision label',()=>{
 const {map,manifest}=fixture();expect(sharedSceneMatchesLayout(map,manifest)).toBe(true);
 const revised=structuredClone(manifest);revised.revision=2;revised.locations[0].settlement.buildings[0].position.x+=25;
 map.world!.sharedWorld=revised; // Reproduce a scene mislabeled by an old release.
 expect(sharedSceneMatchesLayout(map,revised)).toBe(false);
 map.entities[0].position.x=25;expect(sharedSceneMatchesLayout(map,revised)).toBe(true);
});
it('does not stamp an archived grid with a rebuilt town revision',()=>{
 const {map,manifest}=fixture(),revised=structuredClone(manifest);revised.revision=2;revised.locations[0].settlement.buildings[0].position.z+=20;
 const campaign={world:{manifest:revised}} as Campaign;
 const restored=refreshSharedMap(map,campaign);expect(restored.world!.sharedWorld!.revision).toBe(1);expect(restored.entities[0].position.z).toBe(0);
 expect(sharedSceneMatchesLayout(restored,revised)).toBe(false);
});
it('allows accepted author edits and removals without treating them as stale layout',()=>{
 const {map,manifest}=fixture();manifest.authoredEntities=[{...map.entities[0],position:{x:130,y:20,z:200}}];
 expect(sharedSceneMatchesLayout(map,manifest)).toBe(true);
 const refreshed=refreshSharedMap(map,{world:{manifest}} as Campaign);expect(refreshed.entities[0].position.x).toBe(30);
 manifest.authoredEntities=[];manifest.removedEntityIds=['house'];expect(sharedSceneMatchesLayout(map,manifest)).toBe(true);
});
it('detects missing and extra generated buildings, and rotated obsolete footprints',()=>{
 const {map,manifest}=fixture();map.entities[0].rotation.y=45;expect(sharedSceneMatchesLayout(map,manifest)).toBe(false);
 map.entities[0].rotation.y=360;expect(sharedSceneMatchesLayout(map,manifest)).toBe(true);
 map.entities.push({...map.entities[0],id:'obsolete'});expect(sharedSceneMatchesLayout(map,manifest)).toBe(false);
 map.entities=[];expect(sharedSceneMatchesLayout(map,manifest)).toBe(false);
});
