import {it,expect} from "vitest";
import {shoreDistanceField} from "./nativeShore";
it("uses metric shoreline distance independent of beach slope",()=>{
  for(const slope of [.03,.3]){const sample=shoreDistanceField(0,0,32,2,x=>(x-10)*slope);expect(sample(10,12)).toBeCloseTo(0);expect(sample(18,12)).toBeCloseTo(8);expect(sample(40,12)).toBe(24);}
});
it("agrees across padded tile boundaries and follows curved coastlines",()=>{
  const wet=(x:number,z:number)=>Math.hypot(x-32,z-16)-12;
  const a=shoreDistanceField(0,0,32,2,wet),b=shoreDistanceField(32,0,32,2,wet);
  for(let z=0;z<=32;z++)expect(a(32,z)).toBeCloseTo(b(32,z),6);
  expect(a(16,16)).toBeCloseTo(4,1);expect(b(48,16)).toBeCloseTo(4,1);
});
it("does not invent surf on uninterrupted open water",()=>{
  expect(shoreDistanceField(0,0,32,2,()=>1)(12,12)).toBe(24);
});
