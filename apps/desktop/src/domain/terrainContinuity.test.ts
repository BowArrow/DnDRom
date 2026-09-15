import { describe, it, expect } from "vitest";
import { atlasStitchLevels, atlasTriangleSample, buildAtlasMesh, createAtlasSampler, tileSize, type AtlasContext } from "./worldAtlas";
import { simulateHydraulicErosion } from "./hydraulicErosion";
import { nativeAtlasTerrain } from "../migration/nativeAtlasTerrain";
const context:AtlasContext={seed:719,width:0,depth:0,patches:[]};
describe("rendered terrain continuity",()=>{
  it("does not extrude steep local banks into long regional walls",()=>{
    const local:AtlasContext={seed:71,width:32,depth:32,patches:[{kind:"terrain",seed:71,originX:-16,originZ:-16,size:32,baseHeight:0,relief:12,roughness:.5,erosion:1,paths:[],heightfield:{resolution:3,heights:[0,12,0,0,12,0,0,12,0]}}]};
    const sample=createAtlasSampler(local,false);
    for(const x of [17,20,24,32]){expect(sample(x,0)).toBeGreaterThan(-15);expect(sample(x,0)).toBeLessThan(20);}
  });
  it("closes a fine/coarse edge on curved terrain, including its corners",()=>{
    const fine={x:1,z:-1,level:1},coarse={x:1,z:-1,level:2};
    const height=(x:number,z:number)=>30+Math.sin(x*.09)*8+Math.cos(z*.3)*12;
    const mesh=buildAtlasMesh(fine,context,height,atlasStitchLevels(fine,[fine,coarse]));
    let beforeGap=0;
    for(let row=0;row<=16;row++){
      const x=128,z=-64+row*4,expected=atlasTriangleSample(x,z,tileSize(coarse)/16,height);
      beforeGap=Math.max(beforeGap,Math.abs(height(x,z)-expected));
      expect(mesh.positions[(row*17+16)*3+1]).toBeCloseTo(expected,4);
    }
    expect(beforeGap).toBeGreaterThan(2);
  });
  it("places forest roots on rendered triangles rather than unrendered detail",()=>{
    const tile={x:20,z:20,level:1},height=(x:number,z:number)=>30+Math.sin(x)*.6+Math.cos(z)*.6;
    const mesh=buildAtlasMesh(tile,context,height);
    expect(mesh.vegetation.length).toBeGreaterThan(0);
    for(let i=0;i<mesh.vegetation.length;i+=6){
      const x=mesh.vegetation[i],y=mesh.vegetation[i+1],z=mesh.vegetation[i+2];
      expect(y).toBeCloseTo(atlasTriangleSample(x,z,tileSize(tile)/16,height),3);
    }
    const scene=nativeAtlasTerrain(mesh,context);
    expect(scene.meshes[0].castShadow).not.toBe(false);
    expect(scene.meshes[1].castShadow).toBe(false);
    expect(scene.meshes[0].lods[0].indices.every(i=>i<289)).toBe(true);
  });
});
describe("physical erosion scales",()=>{
  it("conserves mass and scales the same transport laws with physical cell size",()=>{
    const n=32,source=Array.from({length:n*n},(_,i)=>20-Math.floor(i/n)*.3+Math.sin(i%n*.3)*3);
    const a=simulateHydraulicErosion(source,n,1,719,.8,4);
    const b=simulateHydraulicErosion(source.map(v=>v*32),n,32,719,.8,4);
    expect(Math.abs(a.massError)).toBeLessThan(1e-7);
    expect(Math.abs(b.massError)).toBeLessThan(1e-6);
    for(let i=0;i<source.length;i++)expect(b.height[i]).toBeCloseTo(a.height[i]*32,7);
    expect(a.delta.some(v=>v<-.05)).toBe(true);expect(a.delta.some(v=>v>.05)).toBe(true);
    expect(a.discharge.some(v=>v>.1)).toBe(true);
  });
});
