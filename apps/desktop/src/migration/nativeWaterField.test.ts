import {describe,it,expect} from "vitest";
import {nativeWaterField} from "./nativeWaterField";
import {waterMesh,exportUnrealScene,coastalWaterGeometry} from "./unrealScene";
import type {GameMap,WorldWaterGeometry} from "../domain/types";

describe("coastal simulation inputs",()=>{
 it("preserves metre-based shore distance independently of beach slope and bounds transfer resolution",()=>{
  for(const slope of [.03,.3]){
   const f=nativeWaterField(-16,-16,32,512,(x)=>x*slope,x=>Math.abs(x),()=>7);
   expect(f.resolution).toBe(64);expect(f.depths).toHaveLength(65*65);
   expect(f.depths[0]).toBeCloseTo(-16*slope);expect(f.distances[0]).toBe(-16);
   expect(f.distances[64]).toBe(16);expect(f.heights.every(h=>h===7)).toBe(true);
  }
 });
 it("extends the new coastal mesh onto a bounded dry strip while preserving legacy clipping",()=>{
  const g:WorldWaterGeometry={kind:"water",originX:0,originZ:0,size:2,resolution:1,waterLevel:20,wetCells:[true,false,true,false],depthField:[1,-1,1,-1]};
  const old=waterMesh(g,{x:0,y:0,z:0}),next=waterMesh(g,{x:0,y:0,z:0},true);
  const xs=(p:number[])=>p.filter((_,i)=>i%3===0);
  expect(Math.max(...xs(old.positions))).toBe(1);
  expect(Math.max(...xs(next.positions))).toBeCloseTo(1.45);
  expect(next.positions.filter((_,i)=>i%3===1).every(y=>y===20)).toBe(true);
 });
 it("does not register world-space simulation data for rotated authored water",()=>{
  const water={id:"w",assetId:"water",position:{x:0,y:0,z:0},rotation:{x:0,y:20,z:0},scale:{x:1,y:1,z:1},worldGeometry:{kind:"water",originX:0,originZ:0,size:2,resolution:1,waterLevel:0,wetCells:[true,true,true,true]}};
  const scene=exportUnrealScene({id:"a",name:"coast",entities:[water]} as unknown as GameMap);
  expect(scene.meshes).toHaveLength(1);expect(scene.waterFields).toBeUndefined();
 });
 it("recovers physical dry bed depth instead of extruding legacy mask values above land",()=>{
  const g:WorldWaterGeometry={kind:"water",originX:0,originZ:0,size:2,resolution:1,waterLevel:0,wetCells:[true,false,true,false],depthField:[1,-.025,1,-.025],surfaceHeights:[0,1.12,0,1.12]};
  const terrain={kind:"terrain",originX:0,originZ:0,size:2,seed:1,baseHeight:0,relief:0,roughness:0,erosion:0,paths:[],heightfield:{resolution:2,heights:[-1,1,-1,1]}};
  const m={entities:[{worldGeometry:terrain}]} as unknown as GameMap;
  const actual=coastalWaterGeometry(m,g);
  expect(actual.surfaceHeights).toEqual([0,0,0,0]);expect(actual.depthField).toEqual([1,-1,1,-1]);
  expect(g.surfaceHeights).toEqual([0,1.12,0,1.12]);
 });
 it("preserves excluded low ground instead of flooding the whole dry chunk",()=>{
  const depths=Array.from({length:25},(_,i)=>i%5===0?1:-.1),wet=depths.map(d=>d>0);
  const g:WorldWaterGeometry={kind:"water",originX:0,originZ:0,size:16,resolution:4,waterLevel:0,wetCells:wet,depthField:depths,surfaceHeights:wet.map(w=>w?0:.02)};
  const terrain={kind:"terrain",originX:0,originZ:0,size:16,seed:1,baseHeight:0,relief:0,roughness:0,erosion:0,paths:[],heightfield:{resolution:2,heights:[-.1,-.1,-.1,-.1]}};
  const result=coastalWaterGeometry({entities:[{worldGeometry:terrain}]} as unknown as GameMap,g);
  expect(result.depthField![4]).toBeLessThan(-.45);
  const mesh=waterMesh(result,{x:0,y:0,z:0},true);
  expect(Math.max(...mesh.positions.filter((_,i)=>i%3===0))).toBeLessThan(9);
 });
});
