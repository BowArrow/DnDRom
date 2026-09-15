import {it,expect} from 'vitest';
import {nativeWorldRoads} from './nativeWorldRoads';
import {buildAtlasMesh,type AtlasContext} from '../domain/worldAtlas';
import {createWorldManifest} from '../domain/worldPipeline';
import type {WorldPlan} from '../domain/types';
it('preserves narrow road coverage beyond the authored map without hillside roll',()=>{
 const m=createWorldManifest({id:'roads',seed:'1',locations:[]} as unknown as WorldPlan,{x:1000,z:2000});
 m.transport=[{id:'route',from:'a',to:'b',mode:'road',width:4,points:[{x:1256,y:200,z:2040},{x:1512,y:225.6,z:2040}],bridges:[],length:256,maxGrade:.1,speed:1.4}];
 const context:AtlasContext={seed:1,width:64,depth:64,patches:[],sharedWorld:m,site:{version:1,x:1000,z:2000,datum:200,seaLevel:180,slope:0,relief:0,intent:{water:'none',landform:'any',forest:0},shared:m.terrain}};
 const mesh=buildAtlasMesh({level:3,x:1,z:0},context,(x,z)=>x*.1+z*.02),road=nativeWorldRoads(mesh,context)!;
 expect(road.lods[0].indices.length).toBeGreaterThan(100);expect(road.material).toBe('terrain');
 const g=road.lods[0];for(let i=0;i<g.positions.length;i+=12){expect(g.positions[i+1]).toBe(g.positions[i+4]);expect(g.positions[i+7]).toBe(g.positions[i+10]);}
 expect(g.biomeUVs).toHaveLength(g.positions.length/3*2);expect(g.positions.every(Number.isFinite)).toBe(true);
 m.transport[0].bridges=[{id:'bridge',start:m.transport[0].points[0],end:m.transport[0].points[1],family:'suspension',width:4,clearance:3}];expect(nativeWorldRoads(mesh,context)).toBeUndefined();
});
