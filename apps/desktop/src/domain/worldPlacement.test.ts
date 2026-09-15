import { describe,it,expect } from "vitest";
import { footprintSamples,placeOnDryGround,mapPlacementSurface } from "./worldPlacement";
import { compileWorldBlueprint,createFallbackWorldBlueprints } from "./worldForge";
import { buildAnisotropicRoadNetwork,terrainSurfaceWeights } from "./worldProcedural";
import type { MapEntity } from "./types";
const building=():MapEntity=>({id:"house",name:"Rotated hall",assetId:"house-large",position:{x:0,y:0,z:0},rotation:{x:0,y:37,z:0},scale:{x:1.5,y:1,z:1},worldGeometry:{kind:"assembly",recipeId:"hall",parts:[{shape:"box",position:{x:0,y:2,z:0},rotation:{x:0,y:0,z:0},size:{x:6,y:4,z:4},material:"masonry",color:"#888888"}]}});
describe("physical world placement",()=>{
  it("relocates the full rotated footprint when only its corner overlaps a lake",()=>{
    const e=building(),blocked=(x:number,z:number)=>x>2&&z>1;
    expect(blocked(0,0)).toBe(false);
    expect(footprintSamples(e).some(p=>blocked(p.x,p.z))).toBe(true);
    expect(placeOnDryGround(e,{width:64,depth:64,height:()=>3,blocked})).toBe(true);
    expect(footprintSamples(e).every(p=>!blocked(p.x,p.z))).toBe(true);
    expect(e.position.y).toBeCloseTo(3.025);
  });
  it("reports an impossible placement and preserves its requested transform",()=>{
    const e=building(),original=structuredClone(e.position);
    expect(placeOnDryGround(e,{width:32,depth:32,height:()=>0,blocked:()=>true},[],8)).toBe(false);
    expect(e.position).toEqual(original);
  });
  it("keeps generated buildings off rendered water and road shoulders",()=>{
    const [b]=createFallbackWorldBlueprints({description:"A wooded mountain valley with a village beside a river",kind:"settlement",size:"small",biome:"forest",seed:719,gridShape:"square",background:"none"});
    const {map}=compileWorldBlueprint(b),surface=mapPlacementSurface(map);
    const buildings=map.entities.filter(e=>e.worldGeometry?.kind==="cga-building"||e.worldGeometry?.kind==="assembly");
    expect(buildings.length).toBeGreaterThan(1);
    for(const e of buildings)expect(footprintSamples(e,0).filter(p=>surface.blocked(p.x,p.z)),e.name).toEqual([]);
    for(const e of map.entities){
      const water=e.worldGeometry;if(water?.kind!=="water")continue;
      const terrain=map.entities.find(t=>t.chunkId===e.chunkId&&t.worldGeometry?.kind==="terrain")!.worldGeometry;
      if(terrain?.kind!=="terrain")continue;
      for(let i=0;i<water.wetCells.length;i++)if(water.wetCells[i]){
        const x=water.originX+(i%(water.resolution+1))*water.size/water.resolution,z=water.originZ+Math.floor(i/(water.resolution+1))*water.size/water.resolution;
        expect(terrainSurfaceWeights(terrain,x,z,1).road).toBeLessThan(.001);
      }
    }
  }, 180_000);
  it("routes away from a riverbank instead of following its channel",()=>{
    const [b]=createFallbackWorldBlueprints({description:"A river valley",kind:"exterior",size:"small",seed:71,gridShape:"square",background:"none"});
    b.terrain={...b.terrain,baseHeight:5,relief:0,waterLevel:undefined};
    b.zones=[{id:"a",name:"a",purpose:"entry",center:{x:-24,y:5,z:3},radius:2,requiredConnections:["b"]},{id:"b",name:"b",purpose:"exit",center:{x:24,y:5,z:3},radius:2,requiredConnections:["a"]}];
    const roads=buildAnisotropicRoadNetwork(b,[{ax:-32,az:0,bx:32,bz:0,width:2,depth:.5,flow:1}]);
    const middle=roads.filter(r=>Math.abs((r.ax+r.bx)/2)<12);
    expect(middle.length).toBeGreaterThan(0);
    expect(middle.every(r=>Math.abs((r.az+r.bz)/2)>7)).toBe(true);
  });
});
