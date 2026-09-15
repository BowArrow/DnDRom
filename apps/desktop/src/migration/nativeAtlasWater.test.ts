import {describe,it,expect} from "vitest";
import {buildAtlasMesh,type AtlasContext} from "../domain/worldAtlas";
import {nativeAtlasWater} from "./nativeAtlasWater";
const context:AtlasContext={seed:719,width:0,depth:0,patches:[]};
describe("streamed discharge surface",()=>{
  it("keeps coastal depth attached to the displayed bed outside the local boundary",()=>{
    const mesh=buildAtlasMesh({x:0,z:0,level:0},context,x=>-1-x*.1);
    const water=nativeAtlasWater(mesh,()=>2,0,{width:32,depth:32,shore:()=>8,waterDepth:()=>1,surface:()=>0})!;
    const f=water.waterField!;
    for(let z=0;z<=f.resolution;z++)for(let x=0;x<=f.resolution;x++){
      const wx=f.originX+x*f.size/f.resolution,i=z*(f.resolution+1)+x;
      expect(f.depths[i]).toBeCloseTo(1+wx*.1,5);
    }
  });
  it("cuts the authored rectangle out of overlapping coarse water triangles",()=>{
    const mesh=buildAtlasMesh({x:0,z:0,level:3},context,()=>-2);
    const g=nativeAtlasWater(mesh,()=>2,0,{width:63,depth:47,shore:()=>24,waterDepth:()=>2,surface:()=>0})!.lods[0];
    let area=0;
    for(let i=0;i<g.indices.length;i+=3){
      const points=g.indices.slice(i,i+3).map(j=>[g.positions[j*3]+128,g.positions[j*3+2]+128]);
      const [a,b,c]=points;area+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]))/2;
      const x=(a[0]+b[0]+c[0])/3,z=(a[1]+b[1]+c[1])/3;
      expect(x>=31.5||z>=23.5).toBe(true);
    }
    expect(area).toBeCloseTo(256**2-31.5*23.5,5);
  });
  it("clips river banks and keeps the water on the rendered terrain",()=>{
    const height=(x:number,z:number)=>x*.02+z*.01;
    const mesh=buildAtlasMesh({x:0,z:0,level:2},context,height);
    const water=nativeAtlasWater(mesh,(x)=>Math.max(0,1-Math.abs(x-64)/24));
    expect(water).toBeDefined();const geometry=water!.lods[0];
    expect(geometry.indices.length).toBeGreaterThan(0);
    for(let i=0;i<geometry.positions.length;i+=3){
      const x=geometry.positions[i]+64,y=geometry.positions[i+1],z=geometry.positions[i+2]+64;
      expect(Math.abs(x-64)).toBeLessThanOrEqual(16);
      expect(y-height(x,z)).toBeGreaterThan(.119);expect(y-height(x,z)).toBeLessThan(.26);
    }
    expect(Math.max(...geometry.indices)).toBeLessThan(geometry.positions.length/3);
  });
  it("does not create water geometry on dry terrain",()=>{
    const mesh=buildAtlasMesh({x:0,z:0,level:1},context,()=>20);
    expect(nativeAtlasWater(mesh,()=>0)).toBeUndefined();
    const excluded=buildAtlasMesh({x:0,z:0,level:1},context,()=>-.1);
    expect(nativeAtlasWater(excluded,()=>0,0)).toBeUndefined();
  });
  it("encodes depth for attenuation and preserves a level lake surface",()=>{
    const mesh=buildAtlasMesh({x:0,z:0,level:1},context,x=>x/8);
    const geometry=nativeAtlasWater(mesh,x=>(4-x/8)*3+.35,4)!.lods[0];
    const depths=geometry.colors.filter((_,i)=>i%4===0);
    expect(Math.min(...depths)).toBe(0);expect(Math.max(...depths)).toBe(255);
    const shores=geometry.colors.filter((_,i)=>i%4===1);
    expect(Math.min(...shores)).toBe(0);expect(Math.max(...shores)).toBe(255);
    expect(geometry.colors.filter((_,i)=>i%4===2).every(v=>v===255)).toBe(true);
    for(let i=0;i<geometry.positions.length;i+=3){
      const bed=(geometry.positions[i]+32)/8;
      if(bed<4)expect(geometry.positions[i+1]).toBe(4);
    }
  });
});
