import type { ScenePart } from './sceneGrammar';
import type { SiteIntent } from './worldSite';
import {polygonDistance} from './settlementSpatial';

export const BIOME_FAMILIES = ['ice','tundra','boreal-forest','temperate-forest','temperate-rainforest','steppe','mediterranean','hot-desert','cold-desert','savanna','tropical-seasonal','tropical-rainforest'] as const;
export type BiomeFamily = typeof BIOME_FAMILIES[number];
export interface WorldPoint { x:number; z:number }
export interface WorldPosition extends WorldPoint { y:number }
export interface ClimateReservation extends WorldPoint { id:string; biome:BiomeFamily; radius:number; temperature:number; precipitation:number }
export interface TerrainEdit { id:string; kind:'foundation'|'road'; points:WorldPosition[]; width:number; feather:number; footprint?:WorldPoint[] }
export interface SceneEnvironment {stratum:'surface'|'underground';depth?:number;overlays:Array<{kind:'volcanic'|'magical';name:string;strength:number}>}
export interface EnvironmentReservation {id:string;x:number;z:number;radius:number;overlays:SceneEnvironment['overlays']}
export interface SharedTerrain { version:1; climate:ClimateReservation[]; edits:TerrainEdit[]; environments?:EnvironmentReservation[] }
export interface SceneRequest {
  environment?:SceneEnvironment;
  recipes?:Record<string,ScenePart[]>;
  id:string; name:string; description:string; purpose:string; biome?:BiomeFamily;
  intent:SiteIntent; island:boolean; scale:'wilderness'|'village'|'town'|'city';
  roles:Record<string,number>; connectsTo:string[]; modes:Array<'road'|'ferry'>;
  styleId:string; status:'pending'|'located'|'ready'|'failed'; error?:string;
}
export interface BuildingPlan { id:string; role:string; position:WorldPosition; yaw:number; width:number; depth:number; height:number; entrance:WorldPosition; recipe:ScenePart[]; parcelId?:string; program?:{family:string;floors:number;rooms:string[];style:string}; footprint?:WorldPoint[] }
export interface DockPlan { id:string; land:WorldPosition; water:WorldPosition; width:number; waterBodyId:string }
export interface ParcelPlan {id:string;polygon:WorldPoint[];frontage:WorldPosition;districtId:string;buildingId:string}
export interface SettlementStructure {id:string;position:WorldPosition;yaw:number;recipe:ScenePart[]}
export interface SettlementPlan { id:string; buildings:BuildingPlan[]; streets:TransportEdge[]; docks:DockPlan[]; version?:2; nodes?:Array<WorldPosition&{id:string}>; parcels?:ParcelPlan[]; districts?:Array<{id:string;name:string;position:WorldPosition}>; publicSpaces?:Array<{id:string;kind:'market'|'waterfront'|'court';polygon:WorldPoint[];position:WorldPosition}>; structures?:SettlementStructure[]; morphology?:string }
export interface LocatedScene { id:string; requestId:string; name:string; position:WorldPosition; radius:number; biome:BiomeFamily; slope:number; relief:number; waterBodyId?:string; settlement:SettlementPlan }
export interface BridgeSpan { id:string; start:WorldPosition; end:WorldPosition; family:'timber'|'stone'|'suspension'; width:number; clearance:number }
export interface TransportEdge { id:string; from:string; to:string; mode:'road'|'ferry'; points:WorldPosition[]; width:number; bridges:BridgeSpan[]; length:number; maxGrade:number; waterBodyId?:string; speed:number }
export interface WaterBody { id:string; level:number; cells:string[]; cellSize:number; kind:'lake'|'ocean'|'river'; outlet?:WorldPoint }
export interface RegionalStyle { id:string; name:string; material:'timber'|'masonry'; roofColor:string; wallColor:string; roofCurve:number; bays:number; age:number; family?:'timber'|'courtyard'|'earthen'|'fortress'; roofPitch?:number; floorHeight?:number }
export interface WorldManifest {
  authoredEntities?:import('./types').MapEntity[];
  removedEntityIds?:string[];
  version:1; id:string; seed:number; revision:number; generatorVersion:1; climateVersion:1; hydrologyVersion:1;
  startingRadius:number; origin:WorldPoint; terrain:SharedTerrain; waterBodies:WaterBody[];
  requests:SceneRequest[]; locations:LocatedScene[]; transport:TransportEdge[]; styles:RegionalStyle[];
  checkpoints:Array<{ stage:string; revision:number; completed:string[] }>;
}
export const worldHash=(value:string)=>{let h=2166136261;for(const c of value)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
export const worldStableId=(worldId:string,kind:string,key:string)=>`${kind}-${worldHash(`${worldId}/${kind}/${key}`).toString(36)}`;
export const sharedWorldSeed=(seed:string)=>/^\d+$/.test(seed)?Number(seed)&0x7fffffff:worldHash(seed)&0x7fffffff;
export const distance=(a:WorldPoint,b:WorldPoint)=>Math.hypot(a.x-b.x,a.z-b.z);
export const clamp01=(v:number)=>Math.max(0,Math.min(1,v));
export const smooth01=(v:number)=>{v=clamp01(v);return v*v*(3-2*v);};
const regionIndices=new WeakMap<WorldManifest,Array<{minX:number;maxX:number;minZ:number;maxZ:number;hash:number}>>();
/** Only accepted features intersecting a tile invalidate its cached geometry. */
export function worldRegionFingerprint(m:WorldManifest,minX:number,minZ:number,size:number):string{
  let features=regionIndices.get(m);if(!features){features=[];
    const add=(points:WorldPoint[],radius:number,value:unknown)=>{if(points.length)features!.push({minX:Math.min(...points.map(p=>p.x))-radius,maxX:Math.max(...points.map(p=>p.x))+radius,minZ:Math.min(...points.map(p=>p.z))-radius,maxZ:Math.max(...points.map(p=>p.z))+radius,hash:worldHash(JSON.stringify(value))});};
    for(const edit of m.terrain.edits)add(edit.footprint??edit.points,edit.footprint?edit.feather:edit.width/2+edit.feather,edit);
    for(const environment of m.terrain.environments??[])add([environment],environment.radius,environment);
    for(const location of m.locations){for(const s of location.settlement.structures??[])add([s.position],40,s);for(const b of location.settlement.buildings)add([b.position],Math.max(b.width,b.depth),[b,m.removedEntityIds?.includes(b.id)]);for(const d of location.settlement.docks)add([d.land,d.water],d.width,d);}
    for(const route of [...m.transport,...m.locations.flatMap(l=>l.settlement.streets)])add(route.points,route.width,route);
    for(const e of m.authoredEntities??[])add([e.position],100,e);
    regionIndices.set(m,features);
  }
  return `${m.id}/${m.generatorVersion}/${m.climateVersion}/${m.hydrologyVersion}/${m.seed}/surfaces-1/${worldHash(JSON.stringify(m.styles))}/`+worldHash(features.filter(f=>f.maxX>=minX&&f.minX<=minX+size&&f.maxZ>=minZ&&f.minZ<=minZ+size).map(f=>f.hash).join('/'));
}
const editIndices=new WeakMap<SharedTerrain,{count:number;bins:Map<string,TerrainEdit[]>}>();
export function terrainEditsAt(terrain:SharedTerrain|undefined,x:number,z:number):TerrainEdit[]{
  if(!terrain)return [];let index=editIndices.get(terrain);
  if(!index||index.count!==terrain.edits.length){index={count:terrain.edits.length,bins:new Map()};for(const e of terrain.edits){const margin=e.width*.5+e.feather+2,minX=Math.floor((Math.min(...(e.footprint??e.points).map(p=>p.x))-margin)/128),maxX=Math.floor((Math.max(...(e.footprint??e.points).map(p=>p.x))+margin)/128),minZ=Math.floor((Math.min(...(e.footprint??e.points).map(p=>p.z))-margin)/128),maxZ=Math.floor((Math.max(...(e.footprint??e.points).map(p=>p.z))+margin)/128);for(let iz=minZ;iz<=maxZ;iz++)for(let ix=minX;ix<=maxX;ix++){const key=`${ix}/${iz}`,list=index.bins.get(key)??[];list.push(e);index.bins.set(key,list);}}editIndices.set(terrain,index);}
  return index.bins.get(`${Math.floor(x/128)}/${Math.floor(z/128)}`)??[];
}
export function nearestOnSegment(p:WorldPoint,a:WorldPosition,b:WorldPosition){const dx=b.x-a.x,dz=b.z-a.z,t=clamp01(((p.x-a.x)*dx+(p.z-a.z)*dz)/Math.max(.00001,dx*dx+dz*dz));return {x:a.x+dx*t,z:a.z+dz*t,y:a.y+(b.y-a.y)*t};}
export function applyTerrainEdits(terrain:SharedTerrain|undefined,x:number,z:number,height:number):number {
  for(const edit of terrainEditsAt(terrain,x,z)){
    let d=Infinity,y=height;
    if(edit.kind==='foundation'){const p=edit.points[0];d=edit.footprint?polygonDistance(edit.footprint,{x,z})+edit.width/2:Math.max(Math.abs(x-p.x),Math.abs(z-p.z));y=p.y;}
    else for(let i=1;i<edit.points.length;i++){const p=nearestOnSegment({x,z},edit.points[i-1],edit.points[i]),n=distance(p,{x,z});if(n<d){d=n;y=p.y;}}
    const w=1-smooth01((d-edit.width*.5)/Math.max(.01,edit.feather));height=height*(1-w)+y*w;
  }
  return height;
}
export function worldClearing(terrain:SharedTerrain|undefined,x:number,z:number):number {
  let coverage=0;
  for(const edit of terrainEditsAt(terrain,x,z)){let d=Infinity;
    if(edit.kind==='foundation')d=edit.footprint?polygonDistance(edit.footprint,{x,z})+edit.width/2:Math.max(Math.abs(x-edit.points[0].x),Math.abs(z-edit.points[0].z));
    else for(let i=1;i<edit.points.length;i++)d=Math.min(d,distance({x,z},nearestOnSegment({x,z},edit.points[i-1],edit.points[i])));
    coverage=Math.max(coverage,1-smooth01((d-edit.width*.5-1)/Math.max(1,edit.feather)));
  }return coverage;
}
