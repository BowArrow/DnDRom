import {describe,it,expect} from "vitest";
import type {GameMap,MapEntity} from "../domain/types";
import {exportUnrealScene,prepareSceneWater} from "./unrealScene";
import {createTerrainPatchSampler} from "../domain/worldPatchSampling";
import {atlasContext,buildAtlasMesh} from "../domain/worldAtlas";

const height=(x:number,z:number)=>x*.12+z*.07+Math.sin(z*.12)*.2;
function fixture(split:boolean):GameMap {
 const entities:MapEntity[]=[];const size=split?16:32;
 for(let oz=-16;oz<16;oz+=size)for(let ox=-16;ox<16;ox+=size){
  const resolution=size*2,heights:number[]=[],depthField:number[]=[],surfaceHeights:number[]=[];
  for(let z=0;z<=resolution;z++)for(let x=0;x<=resolution;x++){
   const h=height(ox+x*.5,oz+z*.5);heights.push(h);depthField.push(h<0?-h:-.1);surfaceHeights.push(h<0?0:h+.12);
  }
  const transform={name:'Seam fixture',position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
  entities.push({id:`terrain:${ox}:${oz}`,assetId:'terrain',...transform,worldGeometry:{kind:'terrain',originX:ox,originZ:oz,size,seed:1,baseHeight:0,relief:0,roughness:0,erosion:0,paths:[],heightfield:{resolution:resolution+1,heights}}});
  entities.push({id:`water:${ox}:${oz}`,assetId:'water',...transform,worldGeometry:{kind:'water',originX:ox,originZ:oz,size,resolution,waterLevel:0,wetCells:depthField.map(d=>d>0),depthField,surfaceHeights}});
 }
 return {id:'seams',name:'Seams',width:32,depth:32,theme:'coast',entities} as GameMap;
}
describe('shared chunk surfaces',()=>{
 it('exports identical boundary elevations, normals and material masks across terrain chunks',()=>{
  const scene=exportUnrealScene(fixture(true)),samples=new Map<string,number[]>();let duplicates=0;
  for(const mesh of scene.meshes.filter(m=>m.material==='terrain')){
   const g=mesh.lods[0];for(let i=0;i<g.positions.length/3;i++){
    const x=g.positions[i*3],z=g.positions[i*3+2],key=`${x}:${z}`,v=[g.positions[i*3+1],...g.normals.slice(i*3,i*3+3),...g.colors.slice(i*4,i*4+4)];
    if(samples.has(key)){expect(v).toEqual(samples.get(key));duplicates++;}else samples.set(key,v);
   }
  }expect(duplicates).toBeGreaterThan(100);
 });
 it('does not change water depth, run-up height or foam phase when the region is split into tiles',()=>{
  const whole=prepareSceneWater(fixture(false)),split=prepareSceneWater(fixture(true));
  for(let z=-15;z<=15;z+=1.5)for(let x=-15;x<=15;x+=1.5){
   expect(split.depth(x,z)).toBeCloseTo(whole.depth(x,z),6);
   expect(split.shore(x,z)).toBeCloseTo(whole.shore(x,z),6);
  }
  const fields=exportUnrealScene(fixture(true)).waterFields!,samples=new Map<string,number[]>();let duplicates=0;
  for(const f of fields)for(let z=0;z<=f.resolution;z++)for(let x=0;x<=f.resolution;x++){
   const i=z*(f.resolution+1)+x,key=`${f.originX+x*f.size/f.resolution}:${f.originZ+z*f.size/f.resolution}`,v=[f.depths[i],f.distances[i],f.heights[i]];
   if(samples.has(key)){v.forEach((n,j)=>expect(n).toBeCloseTo(samples.get(key)![j],6));duplicates++;}else samples.set(key,v);
  }expect(duplicates).toBeGreaterThan(100);
 });
 it('uses the same edge normal in the streamed terrain as the authored region',()=>{
  const context=atlasContext(fixture(true)),patch=createTerrainPatchSampler(context.patches);
  const mesh=buildAtlasMesh({x:0,z:0,level:0},context,height);
  for(let i=0;i<=8;i++){
   const n=patch.normal(16,i*2),j=i*17+8;
   expect(mesh.normals[j*3]).toBeCloseTo(n.x,6);expect(mesh.normals[j*3+1]).toBeCloseTo(n.y,6);
  }
 });
});
