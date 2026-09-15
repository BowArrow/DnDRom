import {it,expect} from "vitest";
import {nativeForestVolume} from "./nativeForestVolume";
import {generateSpaceColonizedTree} from "../domain/worldArchitecture";
it("retains branched, closed three-dimensional crowns with varied normals at bounded cost",()=>{
  for(const style of ["pine","broadleaf"] as const){
    const tree=generateSpaceColonizedTree(1338,style),mesh=nativeForestVolume(tree);
    expect(mesh.indices.length/3).toBeLessThan(5000);
    expect(mesh.positions.every(Number.isFinite)).toBe(true);
    const heights=mesh.positions.filter((_,i)=>i%3===1);
    expect(Math.min(...heights)).toBeLessThan(.1);expect(Math.max(...heights)).toBeGreaterThan(5);
    expect(mesh.normals.filter((n,i)=>i%3===1&&n<-.3).length).toBeGreaterThan(20);
    expect(mesh.normals.filter((n,i)=>i%3===0&&Math.abs(n)>.3).length).toBeGreaterThan(20);
    expect(Math.max(...mesh.indices)).toBeLessThan(mesh.positions.length/3);
    expect(new Set(mesh.colors.filter((_,i)=>i%4===1)).size).toBeGreaterThan(5);
    const simplified=nativeForestVolume(tree,1),horizon=nativeForestVolume(tree,2);
    expect(simplified.indices.length).toBeLessThan(mesh.indices.length*.6);
    expect(horizon.indices.length).toBeLessThan(simplified.indices.length);
    for(const lower of [simplified,horizon]){
      const maxHeight=Math.max(...lower.positions.filter((_,i)=>i%3===1));
      expect(maxHeight).toBeCloseTo(Math.max(...heights),4);
      expect(lower.normals.every(Number.isFinite)).toBe(true);
    }
  }
});
