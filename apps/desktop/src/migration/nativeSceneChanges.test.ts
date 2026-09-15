import {it,expect} from 'vitest';
import {nativeSceneChanges} from './nativeSceneChanges';
import type {GameMap,MapEntity} from '../domain/types';
const terrain={id:'ground',assetId:'terrain',worldGeometry:{kind:'terrain',heightfield:{heights:[0,0,0,0]}}} as MapEntity;
const token={id:'frog',assetId:'toadie',position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}} as MapEntity;
const map={id:'harbor',width:256,depth:256,entities:[terrain,token]} as GameMap;
it('uses transform deltas for a character and retains the complete terrain',()=>{
 const moved={...token,position:{x:10,y:2,z:4}};
 const result=nativeSceneChanges(map,{...map,entities:[terrain,moved]});
 expect(result.rebuild).toBe(false);expect(result.replace).toEqual([]);expect(result.transforms).toEqual([{id:'frog',before:token,after:moved}]);
});
it('adding a model and removing another sends only the affected entities',()=>{
 const newToken={...token,id:'second'};
 const result=nativeSceneChanges(map,{...map,entities:[terrain,newToken]});
 expect(result).toEqual({rebuild:false,replace:[newToken],remove:['frog'],transforms:[]});
});
it('still replaces terrain after actual heightfield editing',()=>{
 const changed=structuredClone(terrain);if(changed.worldGeometry?.kind==='terrain')changed.worldGeometry.heightfield!.heights[0]=3;
 expect(nativeSceneChanges(map,{...map,entities:[changed,token]}).rebuild).toBe(true);
});
it('refreshing an asset never recompiles unchanged generated foliage or terrain',()=>{
 const result=nativeSceneChanges(map,map,true);expect(result.rebuild).toBe(false);expect(result.replace).toEqual([token]);
});
