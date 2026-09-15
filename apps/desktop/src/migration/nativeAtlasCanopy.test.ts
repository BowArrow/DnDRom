import {describe,it,expect} from "vitest";
import {buildAtlasMesh,type AtlasContext} from "../domain/worldAtlas";
import {nativeAtlasCanopy} from "./nativeAtlasCanopy";
const context:AtlasContext={seed:719,width:0,depth:0,patches:[]};
describe("distant forest crowns",()=>{
  const fixture=(level:number,height=100)=>{
    const mesh=buildAtlasMesh({x:0,z:0,level},context,()=>height);
    mesh.vegetation=new Float32Array([80,height,80,0,1,1]);return mesh;
  };
  it("keeps physical crown size and three-dimensional normals at all far LODs",()=>{
    for(const level of [5,6,9]){
      const geometry=nativeAtlasCanopy(fixture(level),()=>0,context)!.lods[0];
      const xs=geometry.positions.filter((_,i)=>i%3===0);
      expect(Math.max(...xs)-Math.min(...xs)).toBeCloseTo(4.2);
      expect(geometry.normals.some((n,i)=>i%3!==1&&Math.abs(n)>.1)).toBe(true);
    }
  });
  it("rejects crowns above treeline and crowns whose footprint crosses water",()=>{
    expect(nativeAtlasCanopy(fixture(5,900),()=>0,context)).toBeUndefined();
    expect(nativeAtlasCanopy(fixture(5),x=>x>81?1:0,context)).toBeUndefined();
  });
});
