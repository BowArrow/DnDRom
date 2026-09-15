import {describe,it,expect,vi} from "vitest";
// An analytic watershed makes coordinate/datum regressions measurable without
// spending minutes rerunning the separately tested physical erosion solver.
vi.mock("./worldErosion",()=>({createErodedWorldSampler:()=>({height:(x:number,z:number)=>100+x*.02+z*.01,sample:(x:number,_z:number,layer:string)=>layer==="discharge"?Math.exp(-(((x-152)/8)**2)):0})}));
import {createFallbackWorldBlueprints,compileWorldBlueprint,worldBlueprintSchema} from "./worldForge";
import {buildWorldFieldSet,sampleWorldField,sampleTerrainHeight} from "./worldProcedural";
import {atlasContext,createAtlasSampler,createAtlasHydrologySampler,atlasSurface} from "./worldAtlas";
import {evaluateSite,inferSiteIntent,siteSurface,siteWater,connectedWaterArea,WORLD_SEA_LEVEL} from "./worldSite";
const make=()=>{
  const [blueprint]=createFallbackWorldBlueprints({description:"A forest village",kind:"settlement",size:"small",gridShape:"square",seed:19,background:"none"});
  blueprint.site={version:1,x:128,z:-64,datum:101.92,seaLevel:80,intent:blueprint.siteIntent!,slope:.0224,relief:8};
  return blueprint;
};
describe("terrain-first scenes",()=>{
  it("expresses geography independently of architecture",()=>{
    expect(inferSiteIntent("An ancient Chinese harbor","forest")).toMatchObject({water:"coast",forest:.9});
    expect(inferSiteIntent("A settlement in a high mountain valley","mountains")).toMatchObject({water:"none",landform:"valley"});
    const blueprint=make();expect(worldBlueprintSchema.parse(blueprint).site).toEqual(blueprint.site);
  });
  it("scores a shoreline above a dry inland parcel for a harbor",()=>{
    const terrain={height:(x:number)=>WORLD_SEA_LEVEL+x*.1,flow:()=>0},intent={landform:"any" as const,water:"coast" as const,forest:.4};
    expect(evaluateSite(8,0,intent,terrain,64).score).toBeLessThan(evaluateSite(500,0,intent,terrain,64).score);
  });
  it("requires connected navigable water rather than accepting a pond or narrow river as a harbor",()=>{
    expect(connectedWaterArea(60,0,{height:(x,z)=>Math.hypot(x,z)<60?0:20,flow:()=>0},10)).toBeLessThan(1_000_000);
    expect(connectedWaterArea(0,10,{height:(_x,z)=>Math.abs(z)<8?0:20,flow:()=>0},10)).toBe(0);
    expect(connectedWaterArea(1999,0,{height:(x,z)=>Math.abs(x)<2000&&Math.abs(z)<1000?0:20,flow:()=>0},10)).toBeGreaterThanOrEqual(1_000_000);
  });
  it("samples the saved geographic origin directly without another local erosion",()=>{
    const blueprint=make(),field=buildWorldFieldSet(blueprint,1);
    for(const [x,z] of [[0,0],[-32,12],[32,-32],[17,29]])expect(sampleWorldField(field,"elevation",x,z)).toBeCloseTo(x*.02+z*.01,8);
    expect(sampleWorldField(field,"waterMask",24,-32)).toBeGreaterThan(0);
    expect(sampleWorldField(field,"waterMask",24,32)).toBeGreaterThan(0);
    expect(sampleWorldField(field,"waterMask",-20,0)).toBeLessThan(0);
  });
  it("keeps the compiled town perimeter, river and material field continuous with its world",()=>{
    const {map}=compileWorldBlueprint(make()),context=atlasContext(map),height=createAtlasSampler(context,true,true),water=createAtlasHydrologySampler(context,true);
    expect(map.world!.site).toEqual(make().site);
    for(const patch of context.patches)for(const [x,z] of [[patch.originX,patch.originZ],[patch.originX+16,patch.originZ+16]])if(Math.abs(x)===32||Math.abs(z)===32){
      expect(sampleTerrainHeight(patch,x,z)).toBeCloseTo(x*.02+z*.01,7);
      expect(height(x===32?x+.001:x===-32?x-.001:x,z===32?z+.001:z===-32?z-.001:z)).toBeCloseTo(sampleTerrainHeight(patch,x,z),3);
    }
    expect(water(24,31.999)).toBeCloseTo(water(24,32.001),6);
    expect(water(24,32.001)).toBeGreaterThan(.35);
    const weights=siteSurface(context.site!,19,0,0,900,.95);
    expect(atlasSurface(context,0,0,900,.95)[0]).toBe(weights.rock);
    expect(siteWater(context.site!,context.site!.seaLevel-context.site!.datum-2,0).surface).toBe(context.site!.seaLevel-context.site!.datum);
  });
});
