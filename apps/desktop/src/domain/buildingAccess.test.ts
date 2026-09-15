import {describe,it,expect} from "vitest";
import {buildingAccess} from "./buildingAccess";
import {generateCgaBuilding} from "./worldArchitecture";
import {updateAttachmentHierarchy} from './buildPlacement';
import type {MapEntity} from "./types";
describe("procedural building access",()=>{
  const entity:MapEntity={id:"house",assetId:"wall-stone",name:"House",position:{x:20,y:3,z:40},rotation:{x:0,y:90,z:0},scale:{x:2,y:1,z:2},worldGeometry:generateCgaBuilding(41)};
  it("places the entrance in the actual transformed facade opening",()=>{
    const geometry=entity.worldGeometry!;if(geometry.kind!=="cga-building")throw Error();
    const door=geometry.facadeTiles.find(t=>t.kind==="door")!,a=geometry.footprint[door.edge];
    const access=buildingAccess(entity)!;
    expect(access.entrance.x).toBeCloseTo(entity.position.x+a.z*2);
    expect(access.entrance.y).toBeCloseTo(3.3);
    expect(Math.hypot(access.anchor.x-access.entrance.x,access.anchor.z-access.entrance.z)).toBeCloseTo(1.7);
  });
  it("does not advertise arbitrary decorative assemblies as enterable",()=>{
    expect(buildingAccess({...entity,worldGeometry:{kind:"assembly",recipeId:"decoration",parts:[]}})).toBeUndefined();
  });
  it('moves persisted entrances with an edited shared building transform',()=>{
    const house={...entity,position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},worldAccess:{entrance:{x:0,y:0,z:-5},anchor:{x:0,y:0,z:0}}};
    const [moved]=updateAttachmentHierarchy([house],house.id,{position:{x:20,y:2,z:30},rotation:{x:0,y:90,z:0}});
    expect(moved.worldAccess!.anchor).toEqual({x:20,y:2,z:30});expect(moved.worldAccess!.entrance.x).toBeCloseTo(15);expect(moved.worldAccess!.entrance.z).toBeCloseTo(30);expect(house.worldAccess.entrance.z).toBe(-5);
  });
});
