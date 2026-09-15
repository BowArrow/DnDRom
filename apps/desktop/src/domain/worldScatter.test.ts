import { describe, it, expect } from "vitest";
import { denseGroundCoverPoints, scatterVariation } from "./worldScatter";

describe("world anchored ground cover", () => {
  it("has the same points when a region is partitioned, including negative coordinates", () => {
    const points = (x:number,z:number,size:number) => denseGroundCoverPoints(x,z,size,.46,719,()=>.92);
    const key = (p:{x:number;z:number}) => `${p.x}:${p.z}`;
    const whole = points(-8,-8,16).map(key).sort();
    const chunks = [[-8,-8],[0,-8],[-8,0],[0,0]].flatMap(([x,z])=>points(x,z,8)).map(key).sort();
    expect(chunks).toEqual(whole); expect(new Set(whole).size).toBe(whole.length);
  });
  it("excludes overlapping clumps without creating axis-aligned rows", () => {
    const points = denseGroundCoverPoints(0,0,8,.46,17,()=>1);
    expect(points.length).toBeGreaterThan(190);
    for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++) expect(Math.hypot(points[i].x-points[j].x,points[i].z-points[j].z)).toBeGreaterThanOrEqual(.46*.38-1e-10);
    expect(new Set(points.map(p=>p.x)).size).toBe(points.length);
    expect(new Set(points.map(p=>p.z)).size).toBe(points.length);
    expect(points.some(p=>scatterVariation(p.x,p.z,17,1)>.9)).toBe(true);
    expect(points.some(p=>scatterVariation(p.x,p.z,17,2)<.1)).toBe(true);
  });
});
