import { describe,it,expect } from "vitest";
import {atlasLandform,atlasSurface,atlasVegetation,buildAtlasMesh,createAtlasSampler,parentTriangleHeight,selectAtlasTiles,tileChildren,tileKey,type AtlasContext} from "./worldAtlas";
import {simulateCoupledParticleHydrology} from "./worldProcedural";
import {WorldReveal} from "./worldReveal";
import type {WorldRegionManifest} from "./types";
const context:AtlasContext={seed:71,width:64,depth:64,patches:[]};
describe("streaming world authority",{timeout:60_000},()=>{
  it("preserves plant identities when a tile subdivides",()=>{
    const tile={x:20,z:20,level:1};
    const records=(data:Float32Array)=>Array.from({length:data.length/6},(_,i)=>Array.from(data.slice(i*6,i*6+6)).join(","));
    const parent=records(atlasVegetation(tile,context,()=>20));
    const children=tileChildren(tile).flatMap(child=>records(atlasVegetation(child,context,()=>20)));
    expect(parent.length).toBeGreaterThan(0);
    expect(children.sort()).toEqual(parent.sort());
    expect(new Set(children).size).toBe(children.length);
  });
  it("starts LOD morphs on the parent's actual triangle surface",()=>{
    const sample=(x:number,z:number)=>x*z, tile={x:0,z:0,level:0};
    expect(parentTriangleHeight(1,1,tile,sample)).toBe(0);
    expect(parentTriangleHeight(3,3,tile,sample)).toBe(8);
    const mesh=buildAtlasMesh({x:20,z:20,level:0},context);
    expect(mesh.parentHeights.length).toBe(mesh.positions.length/3);
    expect([...mesh.parentHeights].every(Number.isFinite)).toBe(true);
  });
  it("keeps requests bounded while moving far beyond the original region",()=>{
    for(const coordinate of [0,-32768,1e6,-1e7]){
      const selected=selectAtlasTiles(coordinate,coordinate,context);
      expect(selected.desired.length).toBeLessThan(800);
      expect(new Set(selected.desired.map(tileKey)).size).toBe(selected.desired.length);
      expect(selected.desired.some(tile=>tile.level===0)).toBe(true);
      expect(Number.isFinite(atlasLandform(coordinate,coordinate,71))).toBe(true);
    }
  });
  it("samples shared tile edges identically and preserves local mesh precision",()=>{
    const a=buildAtlasMesh({x:100000,z:-30000,level:0},context),b=buildAtlasMesh({x:100001,z:-30000,level:0},context);
    for(let row=0;row<17;row++)expect(a.positions[(row*17+16)*3+1]).toBe(b.positions[row*17*3+1]);
    expect(Math.max(...a.positions.filter((_,i)=>i%3!==1))).toBeLessThanOrEqual(16);
    expect([...a.positions,...a.normals].every(Number.isFinite)).toBe(true);
  });
  it("matches persisted terrain and joins it continuously at the region boundary",()=>{
    const local:AtlasContext={seed:71,width:32,depth:32,patches:[{kind:"terrain",seed:71,originX:-16,originZ:-16,size:32,baseHeight:0,relief:1,roughness:.5,erosion:.5,paths:[],heightfield:{resolution:2,heights:[10,12,14,16]}}]};
    const sample=createAtlasSampler(local);
    expect(sample(0,0)).toBeCloseTo(13,3);
    expect(Math.abs(sample(15.999,0)-sample(16.001,0))).toBeLessThan(.001);
    const near=atlasSurface(local,15.999,0,sample(15.999,0),1),far=atlasSurface(local,16.001,0,sample(16.001,0),1);
    near.forEach((weight,i)=>expect(Math.abs(weight-far[i])).toBeLessThan(.001));
  });
  it("exposes alpine rock even on broad summit slopes",()=>{
    const weights=atlasSurface(context,2000,2000,800,.95);
    expect(weights[0]).toBeGreaterThan(.7);
    expect(weights[1]).toBeLessThan(.25);
  });
  it("conserves terrain and carried sediment across continuous droplet simulation",()=>{
    const source=Array.from({length:32*32},(_,i)=>15+Math.sin(i%32*.2)*3-Math.floor(i/32)*.1);
    const result=simulateCoupledParticleHydrology(source,32,71,.7,.5);
    expect(result.height.every(Number.isFinite)).toBe(true);
    expect(result.height.reduce((a,b)=>a+b,0)+result.exportedSediment).toBeCloseTo(source.reduce((a,b)=>a+b,0),7);
    expect(result.height).not.toEqual(source);
  });
  it("never uncovers missing uploads or advances without distant coverage",()=>{
    const manifest={chunks:[{id:"missing",bounds:{min:{x:32,y:0,z:-16},max:{x:48,y:20,z:16}}}]} as WorldRegionManifest;
    const reveal=new WorldReveal();
    for(let i=0;i<200;i++)reveal.update(.1,manifest,()=>false,true);
    expect(reveal.radius).toBe(20);
    reveal.update(.1,manifest,()=>true,false);expect(reveal.radius).toBe(20);
    reveal.update(.1,manifest,()=>true,true);expect(reveal.radius).toBeGreaterThan(20);
    const before=reveal.radius;
    reveal.follow(5000,5000);expect(reveal.radius).toBe(before);
    expect(reveal.center).toEqual({x:0,z:0});
    reveal.update(.1,manifest,()=>false,false);expect(reveal.radius).toBe(before);
  });
});
