import {it,expect} from "vitest";
import {impostorPlanes} from "./nativeTreeImpostor";
it("provides side and overhead coverage with separate view metadata",()=>{
  const mesh=impostorPlanes(3,9);
  expect(mesh.indices.length/3).toBe(10);expect(mesh.positions.length/3).toBe(20);
  expect(mesh.colors.filter((_,i)=>i%4===3&&mesh.colors[i]===0)).toHaveLength(4);
  for(let i=0;i<mesh.positions.length;i+=3){
    expect(Math.abs(mesh.positions[i])).toBeLessThanOrEqual(3);
    expect(Math.abs(mesh.positions[i+2])).toBeLessThanOrEqual(3);
    expect(mesh.positions[i+1]).toBeGreaterThanOrEqual(0);expect(mesh.positions[i+1]).toBeLessThanOrEqual(9);
    expect(mesh.normals.slice(i,i+3)).toEqual([0,1,0]);
  }
  for(let view=0;view<5;view++)for(let vertex=0;vertex<4;vertex++){
    const u=mesh.uvs[(view*4+vertex)*2];expect(u).toBeGreaterThan(view/5);expect(u).toBeLessThan((view+1)/5);
  }
});
