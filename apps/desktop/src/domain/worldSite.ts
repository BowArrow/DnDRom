import { z } from "zod";
import { atlasClimate, atlasLandform,atlasNoise } from "./worldLandform";
import { createErodedWorldSampler } from "./worldErosion";
import type { WorldBlueprintV1 } from "./types";
import { applyTerrainEdits, worldClearing, type SharedTerrain } from './sharedWorld';
import { sampleSharedClimate } from './worldClimate';
import {sharedTerrainSchema} from './sharedWorldValidation';

/** Creative requirements belong to the director; coordinates and terrain are
 * measured by the engine. They are deliberately separate from scene props. */
export const siteIntentSchema=z.object({
  landform:z.enum(["any","lowland","highland","valley","ridge"]),
  water:z.enum(["none","coast","river"]),
  forest:z.number().min(0).max(1),
});
export type SiteIntent=z.infer<typeof siteIntentSchema>;
export const worldSiteSchema=z.object({
  shared:sharedTerrainSchema.optional(),
  version:z.literal(1), x:z.number().finite(), z:z.number().finite(), datum:z.number().finite(),
  seaLevel:z.number().finite(), intent:siteIntentSchema,
  slope:z.number().nonnegative(), relief:z.number().nonnegative(),
  waterArea:z.number().nonnegative().optional(),
});
export type WorldSite=z.infer<typeof worldSiteSchema>;
export const WORLD_SEA_LEVEL=180;
export function inferSiteIntent(description:string,biome:string):SiteIntent {
  return {
    landform:/valley|vale|glen/i.test(description)?"valley":/ridge|summit|peak/i.test(description)?"ridge":/mountain|highland|alpine/i.test(description)?"highland":/plain|lowland|prairie/i.test(description)?"lowland":"any",
    water:/harbou?r|port\b|coast|ocean|sea\b|lake|shore|dock/i.test(description)?"coast":/river|stream|creek/i.test(description)?"river":"none",
    forest:biome==="forest"?(/deep|dense|ancient|overgrown/i.test(description)?.9:.72):biome==="desert"?0:biome==="mountains"?.4:.3,
  };
}
export interface SiteTerrain { height:(x:number,z:number)=>number; flow:(x:number,z:number)=>number }
/** Conservative connected standing-water area. Count only 32 m cells whose
 * corners and centre are all submerged, stopping once a square kilometre is
 * proven. A narrow river or isolated ornamental pond cannot satisfy a port. */
export function connectedWaterArea(x:number,z:number,terrain:SiteTerrain,level=WORLD_SEA_LEVEL):number {
  const step=32,wet=new Map<string,boolean>(),visited=new Set<string>(),queue:Array<[number,number]>=[];
  const submerged=(ix:number,iz:number)=>{
    const key=`${ix}:${iz}`;if(wet.has(key))return wet.get(key)!;
    const result=[[0,0],[step,0],[0,step],[step,step],[step/2,step/2]].every(([dx,dz])=>terrain.height(ix*step+dx,iz*step+dz)<level-.25);
    wet.set(key,result);return result;
  };
  const ix=Math.floor(x/step),iz=Math.floor(z/step);
  // Start at the closest deep-water cell to the selected shoreline.
  for(let radius=0;radius<=4&&!queue.length;radius++)for(let dz=-radius;dz<=radius&&!queue.length;dz++)for(let dx=-radius;dx<=radius&&!queue.length;dx++)if(submerged(ix+dx,iz+dz))queue.push([ix+dx,iz+dz]);
  let area=0;
  for(let head=0;head<queue.length&&head<12000;head++){
    const [cx,cz]=queue[head],key=`${cx}:${cz}`;if(visited.has(key))continue;visited.add(key);
    if(Math.abs(cx-ix)>64||Math.abs(cz-iz)>64||!submerged(cx,cz))continue;
    area+=step*step;if(area>=1_000_000)return area;
    for(const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1]])queue.push([cx+dx,cz+dz]);
  }
  return area;
}
/** A bounded search scores actual geography rather than moving a village's
 * independently generated heightfield into an arbitrary mountain. */
export function evaluateSite(x:number,z:number,intent:SiteIntent,terrain:SiteTerrain,span:number) {
  const height=terrain.height(x,z),e=16;
  const slope=Math.hypot(terrain.height(x+e,z)-terrain.height(x-e,z),terrain.height(x,z+e)-terrain.height(x,z-e))/(2*e);
  const ring=Array.from({length:8},(_,i)=>terrain.height(x+Math.cos(i*Math.PI/4)*256,z+Math.sin(i*Math.PI/4)*256));
  const relief=Math.max(...ring)-Math.min(...ring),shelter=ring.reduce((a,b)=>a+b,0)/8-height;
  const water=Array.from({length:8},(_,i)=>({x:x+Math.cos(i*Math.PI/4)*span*.38,z:z+Math.sin(i*Math.PI/4)*span*.38}));
  const waterHeight=Math.min(...water.map(p=>terrain.height(p.x,p.z)));
  const flow=Math.max(terrain.flow(x,z),...water.map(p=>terrain.flow(p.x,p.z)));
  let score=slope*160+Math.max(0,WORLD_SEA_LEVEL+1-height)*10+Math.max(0,terrain.flow(x,z)-.15)*120;
  if(intent.landform==="highland"||intent.landform==="ridge")score+=Math.max(0,440-height)*.6;
  if(intent.landform==="lowland")score+=Math.max(0,height-220)*.5;
  if(intent.landform==="valley")score+=Math.max(0,24-shelter)*2+Math.max(0,350-height)*.3;
  if(intent.landform==="ridge")score+=Math.max(0,shelter+12)*2;
  if(intent.water==="coast")score+=Math.abs(height-(WORLD_SEA_LEVEL+3))*3+Math.max(0,waterHeight-WORLD_SEA_LEVEL)*8;
  if(intent.water==="river")score+=Math.max(0,.45-flow)*400;
  return {x,z,height,slope,relief,score,waterHeight,flow};
}
export function selectWorldSite(blueprint:WorldBlueprintV1,waterCandidates=1):WorldSite {
  const intent=blueprint.siteIntent??inferSiteIntent(blueprint.description,blueprint.biome.id);
  // Cheap initial geology narrows the search. Final selection always evaluates
  // the evolved hydraulic field, including slopes and shore access.
  const raw:SiteTerrain={height:(x,z)=>atlasLandform(x,z,blueprint.seed,64),flow:()=>0};
  let candidate:ReturnType<typeof evaluateSite>|undefined;
  for(let z=-8192;z<=8192;z+=256)for(let x=-8192;x<=8192;x+=256){
    const p=evaluateSite(x,z,intent,raw,blueprint.width);
    p.score+=Math.abs(atlasClimate(x,z,blueprint.seed).moisture-intent.forest)*45+Math.hypot(x,z)*.0005;
    if(!candidate||p.score<candidate.score)candidate=p;
  }
  const erosion=createErodedWorldSampler(blueprint.seed,32);
  const regional:SiteTerrain={height:(x,z)=>erosion.height(x,z),flow:(x,z)=>erosion.sample(x,z,"discharge")};
  let evolvedCandidate:ReturnType<typeof evaluateSite>|undefined;
  for(let z=candidate!.z-2048;z<=candidate!.z+2048;z+=128)for(let x=candidate!.x-2048;x<=candidate!.x+2048;x+=128){
    const p=evaluateSite(x,z,intent,regional,blueprint.width);
    if(!evolvedCandidate||p.score<evolvedCandidate.score)evolvedCandidate=p;
  }
  candidate=evolvedCandidate;
  const terrain:SiteTerrain={height:(x,z)=>erosion.height(x,z,true),flow:(x,z)=>erosion.sample(x,z,"discharge",true)};
  let best:ReturnType<typeof evaluateSite>|undefined;
  const supported:Array<ReturnType<typeof evaluateSite>>=[];
  for(let z=candidate!.z-1024;z<=candidate!.z+1024;z+=32)for(let x=candidate!.x-1024;x<=candidate!.x+1024;x+=32){
    const p=evaluateSite(x,z,intent,terrain,blueprint.width);
    if(p.height<WORLD_SEA_LEVEL||p.slope>.65)continue;
    if(intent.water==="coast"&&p.waterHeight>=WORLD_SEA_LEVEL)continue;
    if(intent.water==="river"&&p.flow<.35)continue;
    if(waterCandidates>1)supported.push(p);
    if(!best||p.score<best.score)best=p;
  }
  if(!best||best.height<WORLD_SEA_LEVEL||best.slope>.65)throw new Error("No supported dry site found in this terrain. Try another world seed or a wider scene.");
  if(intent.water==="coast"&&best.waterHeight>=WORLD_SEA_LEVEL)throw new Error("No shoreline with dry building land found in this region. Try another world seed or a wider scene.");
  if(intent.water==="river"&&best.flow<.35)throw new Error("No riverbank site found in this watershed. Try another world seed.");
  let waterArea=intent.water==="coast"?connectedWaterArea(best.x,best.z,terrain):undefined;
  if(waterArea!==undefined&&waterArea<1_000_000&&waterCandidates>1){const attempted=[best];for(const p of supported.sort((a,b)=>a.score-b.score)){if(attempted.some(a=>Math.hypot(a.x-p.x,a.z-p.z)<256))continue;attempted.push(p);const area=connectedWaterArea(p.x,p.z,terrain);if(area>=1_000_000){best=p;waterArea=area;break;}if(attempted.length>=waterCandidates)break;}}
  if(waterArea!==undefined&&waterArea<1_000_000)throw new Error("This shoreline belongs to a small water body. No harbor site beside a large lake or ocean was found; try another world seed.");
  return {version:1,x:best.x,z:best.z,datum:best.height,seaLevel:WORLD_SEA_LEVEL,intent,slope:best.slope,relief:best.relief,waterArea};
}

export function createSiteTerrain(seed:number,site:WorldSite,detail=true):SiteTerrain {
  const erosion=createErodedWorldSampler(seed,32);
  return {height:(x,z)=>applyTerrainEdits(site.shared,x+site.x,z+site.z,erosion.height(x+site.x,z+site.z,detail))-site.datum,flow:(x,z)=>erosion.sample(x+site.x,z+site.z,"discharge",detail)};
}
export function prepareWorldSite(input:WorldBlueprintV1):WorldBlueprintV1 {
  if(!input.siteIntent||input.kind==="interior"||input.kind==="dungeon")return input;
  const blueprint=structuredClone(input),site=blueprint.site??selectWorldSite(blueprint);
  blueprint.site=site;
  const terrain=createSiteTerrain(blueprint.seed,site);
  // Fit authored places onto supported dry ground before route construction.
  // The architecture director receives these measured locations afterwards.
  for(const zone of blueprint.zones){
    let best:{x:number;z:number;y:number;cost:number}|undefined;
    const margin=Math.min(12,zone.radius*.5);
    for(let z=-blueprint.depth/2+margin;z<=blueprint.depth/2-margin;z+=4)for(let x=-blueprint.width/2+margin;x<=blueprint.width/2-margin;x+=4){
      const y=terrain.height(x,z),water=siteWater(site,y,terrain.flow(x,z));
      if(water.mask>-.08)continue;
      const slope=Math.hypot(terrain.height(x+2,z)-terrain.height(x-2,z),terrain.height(x,z+2)-terrain.height(x,z-2))/4;
      if(slope>.45)continue;
      const cost=Math.hypot(x-zone.center.x,z-zone.center.z)+slope*80;
      if(!best||cost<best.cost)best={x,z,y,cost};
    }
    if(best)zone.center={x:best.x,y:best.y,z:best.z};
  }
  return blueprint;
}
/** Shared signed water mask and surface, in scene-relative coordinates. */
export function siteWater(site:WorldSite,height:number,flow:number) {
  const sea=site.seaLevel-site.datum,mask=Math.max(flow-.35,(sea-height)/.32);
  return {mask,surface:height<sea?sea:height+.12+Math.max(0,flow-.35)*.2};
}
export function siteSurface(site:WorldSite,seed:number,x:number,z:number,height:number,up:number){
  if(site.shared){const c=sampleSharedClimate(seed,site.shared,x+site.x,z+site.z,height+site.datum,0,Math.sqrt(Math.max(0,1-up*up))),rock=Math.max(0,Math.min(1,(.94-up)/.36)),snow=c.snow*Math.max(0,Math.min(1,(up-.4)/.5)),road=worldClearing(site.shared,x+site.x,z+site.z);return {rock,snow,vegetation:(1-rock)*(1-snow)*c.moisture,wet:0,soil:(1-rock)*(1-snow)*(1-c.moisture),road};}
  const smooth=(n:number)=>{n=Math.max(0,Math.min(1,n));return n*n*(3-2*n);};
  const climate=atlasClimate(x+site.x,z+site.z,seed),altitude=height+site.datum;
  const alpine=smooth((altitude-480-climate.temperature*100)/240);
  const rock=Math.max(smooth((.93-up)/.3),alpine*(.72+atlasNoise((x+site.x)/48,(z+site.z)/48,seed+1703)*.28));
  const snow=Math.max(0,Math.min(1,(altitude-630-climate.temperature*220)/180))*Math.max(0,Math.min(1,(up-.45)/.35));
  return {rock,snow,vegetation:(1-rock)*(1-snow)*smooth((up-.45)/.4),wet:0,soil:(1-rock)*(1-snow)*.4,road:0};
}
