import {planSettlement} from './settlementPlanner';
import {buildingFootprint,polygonDistance,rectangle} from './settlementSpatial';
import { createErodedWorldSampler } from './worldErosion';
import { atlasLandform } from './worldLandform';
import { inferSiteIntent, WORLD_SEA_LEVEL, selectWorldSite, connectedWaterArea } from './worldSite';
import { createFallbackWorldBlueprints } from './worldForge';
import { reserveClimate, sampleWorldClimate, validateBiomeCoverage } from './worldClimate';
import { navigableWater, routeTransport, type RoutingTerrain } from './worldTransport';
import { BIOME_FAMILIES, sharedWorldSeed, worldHash, worldStableId, distance, nearestOnSegment, applyTerrainEdits, type SceneRequest, type WorldManifest, type WorldPosition, type LocatedScene, type RegionalStyle, type DockPlan, type WorldPoint, type BuildingPlan, type TransportEdge } from './sharedWorld';
import type { WorldPlan, WorldLocation } from './types';
import type { ScenePart } from './sceneGrammar';
import {sceneRecipeBounds,expandSceneRecipe} from './sceneGrammar';
import {inferSceneEnvironment} from './worldEnvironment';

export interface PipelineProgress {stage:string; message:string; completed:string[]; requests:SceneRequest[]; checkpoint?:WorldPlan}
export const defaultStyle:RegionalStyle={id:'regional-timber',name:'Regional timber and stone',material:'timber',roofColor:'#685342',wallColor:'#a99b7a',roofCurve:0,bays:3,age:.25};
export function requestForLocation(location:WorldLocation):SceneRequest {
  const text=`${location.name}. ${location.description}. ${location.biome}`,castle=/castle|fortress|citadel|stronghold/i.test(text),harbor=/harbou?r|port\b|dock/i.test(text),scale=inferSceneEnvironment(text).stratum==='underground'?'wilderness':['city','capital'].includes(location.kind)?'city':location.kind==='town'||harbor?'town':location.kind==='village'?'village':'wilderness';
  const biome=BIOME_FAMILIES.find(b=>text.toLowerCase().includes(b.replaceAll('-',' ')));
  return {id:location.id,name:location.name,description:location.description,purpose:location.kind,biome,environment:inferSceneEnvironment(text),intent:inferSiteIntent(text,location.biome),island:/island/i.test(text),scale,roles:castle?{keep:1,hall:1,workshop:2,home:4,shrine:1}:harbor?{home:24,warehouse:4,workshop:4,inn:1,market:1,hall:1,shrine:1}:scale==='town'?{home:24,workshop:6,inn:1,market:1,hall:1,shrine:1}:scale==='city'?{home:64,workshop:16,inn:4,market:4,hall:2,shrine:2}:scale==='village'?{home:10,workshop:2,inn:1}: {},connectsTo:[],modes:['road','ferry'],styleId:defaultStyle.id,status:'pending'};
}
export function createWorldManifest(world:WorldPlan,origin:WorldPoint):WorldManifest {
  const seed=sharedWorldSeed(world.seed),climate=reserveClimate(seed,origin),errors=validateBiomeCoverage(seed,climate,origin,100000);if(errors.length)throw new Error(errors.join('; '));
  return {version:1,id:world.id,seed,revision:1,generatorVersion:1,climateVersion:1,hydrologyVersion:1,startingRadius:100000,origin,terrain:{version:1,climate,edits:[]},waterBodies:[],requests:world.locations.map(requestForLocation),locations:[],transport:[],styles:[defaultStyle],checkpoints:[]};
}
export function architectureRecipe(width:number,depth:number,height:number,style:RegionalStyle,role:string):ScenePart[]{
  const part=(shape:ScenePart['shape'],x:number,y:number,z:number,w:number,h:number,d:number,material:ScenePart['material'],color:string):ScenePart=>({shape,position:{x,y,z},size:{x:w,y:h,z:d},rotation:{x:0,y:0,z:0},material,color});
  return [ {...part('frame',0,height*.5,0,width,height,depth,style.material,style.wallColor),bays:{x:style.bays,z:2},levels:1,openness:role==='market'?.8:.25}, {...part('roof',0,height+1.1,0,width+1.2,2.2,depth+1.2,'roof',style.roofColor),curve:style.roofCurve},part('box',0,.12,-depth*.5-1,2,.24,2,'masonry','#8d877b') ];
}
function fitRecipe(parts:ScenePart[],width:number,depth:number,height:number):ScenePart[]{const bounds=sceneRecipeBounds(parts),scale=Math.min(width/Math.max(.1,bounds.max.x-bounds.min.x),depth/Math.max(.1,bounds.max.z-bounds.min.z),(height+2.2)/Math.max(.1,bounds.max.y-bounds.min.y)),cx=(bounds.min.x+bounds.max.x)/2,cz=(bounds.min.z+bounds.max.z)/2;return parts.map(p=>({...p,repeat:p.repeat?{...p.repeat,step:{x:p.repeat.step.x*scale,y:p.repeat.step.y*scale,z:p.repeat.step.z*scale}}:undefined,position:{x:(p.position.x-cx)*scale,y:(p.position.y-bounds.min.y)*scale,z:(p.position.z-cz)*scale},size:{x:p.size.x*scale,y:p.size.y*scale,z:p.size.z*scale}}));}
function recipeEntrance(parts:ScenePart[],position:WorldPosition,yaw:number):WorldPosition{
  const frame=parts.filter(p=>p.shape==='frame').sort((a,b)=>(a.position.y-a.size.y/2)-(b.position.y-b.size.y/2))[0];
  if(!frame)throw new Error('A building needs a ground-floor structural frame');
  const bays=frame.bays?.x??3,doorX=-frame.size.x/2+(Math.floor(bays/2)+.5)*frame.size.x/bays,doorZ=-frame.size.z/2-1,a=frame.rotation.y*Math.PI/180,b=yaw*Math.PI/180;
  const x=frame.position.x+doorX*Math.cos(a)+doorZ*Math.sin(a),z=frame.position.z-doorX*Math.sin(a)+doorZ*Math.cos(a);
  return {x:position.x+x*Math.cos(b)+z*Math.sin(b),y:position.y+frame.position.y-frame.size.y/2+.15,z:position.z-x*Math.sin(b)+z*Math.cos(b)};
}
export function worldTerrain(manifest:WorldManifest):RoutingTerrain {
  const erosion=createErodedWorldSampler(manifest.seed,32);
  const heights=new Map<string,number>(),flows=new Map<string,number>();
  const memo=(cache:Map<string,number>,x:number,z:number,fn:()=>number)=>{const key=`${x}/${z}`;let v=cache.get(key);if(v===undefined){v=fn();if(cache.size>=180000)cache.delete(cache.keys().next().value!);cache.set(key,v);}return v;};
  return {height:(x,z)=>applyTerrainEdits(manifest.terrain,x,z,memo(heights,x,z,()=>erosion.height(x,z,true))),flow:(x,z)=>memo(flows,x,z,()=>erosion.sample(x,z,'discharge',true)),coarse:(x,z)=>erosion.height(x,z),level:WORLD_SEA_LEVEL};
}
const slopeAt=(t:RoutingTerrain,x:number,z:number,e=4)=>Math.hypot(t.height(x+e,z)-t.height(x-e,z),t.height(x,z+e)-t.height(x,z-e))/(2*e);
const islandIndices=new WeakMap<RoutingTerrain,Map<string,boolean>>();
/** Screen the initial geology before paying for detailed erosion. The index
 * proposes islands; the measured terrain flood still decides whether they exist. */
function indexIslandRegions(seed:number,origin:WorldPoint):WorldPoint[]{
  const resolution=385,half=192,step=256,heights=new Float32Array(resolution*resolution),seen=new Uint8Array(heights.length),regions:Array<{point:WorldPoint;cost:number}>=[];
  for(let z=0;z<resolution;z++)for(let x=0;x<resolution;x++)heights[z*resolution+x]=atlasLandform(origin.x+(x-half)*step,origin.z+(z-half)*step,seed,128);
  for(let start=0;start<heights.length;start++){if(seen[start]||heights[start]<WORLD_SEA_LEVEL)continue;const queue=[start];seen[start]=1;let boundary=false,best=start;
    for(let i=0;i<queue.length;i++){const n=queue[i],x=n%resolution,z=Math.floor(n/resolution);if(!x||!z||x===resolution-1||z===resolution-1)boundary=true;if(Math.abs(heights[n]-210)<Math.abs(heights[best]-210))best=n;
      for(const next of [x>0?n-1:-1,x<resolution-1?n+1:-1,z>0?n-resolution:-1,z<resolution-1?n+resolution:-1])if(next>=0&&!seen[next]&&heights[next]>=WORLD_SEA_LEVEL){seen[next]=1;queue.push(next);}
    }
    if(!boundary&&queue.length>=2&&queue.length<=192){const point={x:origin.x+(best%resolution-half)*step,z:origin.z+(Math.floor(best/resolution)-half)*step};regions.push({point,cost:distance(origin,point)+Math.max(0,6-queue.length)*2000});}
  }
  return regions.sort((a,b)=>a.cost-b.cost).slice(0,12).map(r=>r.point);
}
export function islandAt(t:RoutingTerrain,p:WorldPoint){
  let index=islandIndices.get(t);if(!index){index=new Map();islandIndices.set(t,index);}
  const step=32,ox=Math.round(p.x/step),oz=Math.round(p.z/step),queue=[[ox,oz]],visited=new Set<string>(),land:string[]=[];let area=0;
  const known=index.get(`${ox}/${oz}`);if(known!==undefined)return known;
  const finish=(island:boolean)=>{for(const key of land)index!.set(key,island);return island;};
  for(let i=0;i<queue.length&&i<64000;i++){const [x,z]=queue[i],key=`${x}/${z}`;if(visited.has(key))continue;visited.add(key);if(t.height(x*step,z*step)<t.level)continue;land.push(key);if(index.get(key)===false||Math.abs(x-ox)>96||Math.abs(z-oz)>96)return finish(false);area+=step*step;for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]])queue.push([x+dx,z+dz]);}
  return finish(area>=24000&&queue.length<64000);
}
export function querySites(manifest:WorldManifest,request:SceneRequest,terrain:RoutingTerrain,preferred=manifest.origin):Array<{position:WorldPosition;slope:number;relief:number}> {
  const anchor=request.biome?manifest.terrain.climate.find(r=>r.biome===request.biome)??preferred:preferred;
  const coarse:Array<{x:number;z:number;cost:number}>=[],raw:Array<{x:number;z:number;cost:number}>=[];
  for(let z=-2048;z<=2048;z+=128)for(let x=-2048;x<=2048;x+=128){const px=anchor.x+x,pz=anchor.z+z,h=terrain.coarse?.(px,pz)??atlasLandform(px,pz,manifest.seed,64),target=request.intent.water==='coast'?WORLD_SEA_LEVEL+8:request.intent.landform==='highland'||request.intent.landform==='ridge'?520:280;coarse.push({x:px,z:pz,cost:Math.abs(h-target)+Math.hypot(x,z)*.012});}
  for(let z=-2048;z<=2048;z+=128)for(let x=-2048;x<=2048;x+=128){const px=anchor.x+x,pz=anchor.z+z,h=atlasLandform(px,pz,manifest.seed,64),target=request.intent.water==='coast'?WORLD_SEA_LEVEL+4:request.intent.landform==='highland'||request.intent.landform==='ridge'?520:280;raw.push({x:px,z:pz,cost:Math.abs(h-target)+Math.hypot(x,z)*.025});}
  coarse.sort((a,b)=>a.cost-b.cost);raw.sort((a,b)=>a.cost-b.cost);
  const search=[{x:preferred.x,z:preferred.z,cost:-1},...raw.slice(0,12),...coarse.slice(0,16)];
  const candidates:Array<{position:WorldPosition;slope:number;relief:number;cost:number}>=[],seen=new Set<string>();
  for(const c of search)for(let dz=-96;dz<=96;dz+=32)for(let dx=-96;dx<=96;dx+=32){const x=c.x+dx,z=c.z+dz,key=`${x}/${z}`;if(seen.has(key))continue;seen.add(key);
    if(manifest.locations.some(l=>distance({x,z},l.position)<l.radius+150))continue;
    const y=terrain.height(x,z),slope=slopeAt(terrain,x,z),flow=terrain.flow(x,z);if(y<terrain.level+.7||slope>.22||flow>.22)continue;
    if((request.intent.landform==='highland'||request.intent.landform==='ridge')&&y<400)continue;
    const ring=Array.from({length:8},(_,i)=>terrain.height(x+Math.cos(i*Math.PI/4)*256,z+Math.sin(i*Math.PI/4)*256)),relief=Math.max(...ring)-Math.min(...ring);
    if(request.intent.landform==='valley'&&ring.reduce((a,b)=>a+b,0)/8<y+10)continue;
    if(request.intent.water==='coast'&&Math.min(...Array.from({length:12},(_,i)=>terrain.height(x+Math.cos(i*Math.PI/6)*120,z+Math.sin(i*Math.PI/6)*120)))>terrain.level-1.5)continue;
    if(request.intent.water==='river'&&Math.max(...Array.from({length:8},(_,i)=>terrain.flow(x+Math.cos(i*Math.PI/4)*80,z+Math.sin(i*Math.PI/4)*80)))<.35)continue;
    const climate=sampleWorldClimate(manifest.seed,manifest.terrain.climate,x,z,y);if(request.biome&&climate.biome!==request.biome)continue;
    candidates.push({position:{x,y,z},slope,relief,cost:slope*300+distance({x,z},anchor)*.015+(request.intent.water==='coast'?Math.abs(y-terrain.level-4)*3:0)});
  }
  const required=Object.values(request.roles).reduce((a,b)=>a+b,0);
  if(required)for(const c of candidates){let supported=0;for(let z=-144;z<=144;z+=36)for(let x=-144;x<=144;x+=36){const px=c.position.x+x,pz=c.position.z+z;if(terrain.height(px,pz)>terrain.level+.7&&slopeAt(terrain,px,pz)<.18&&terrain.flow(px,pz)<.22)supported++;}c.cost+=Math.max(0,required*1.25-supported)*30-supported*2;}
  const ranked:typeof candidates=[];let waterChecks=0;for(const c of candidates.sort((a,b)=>a.cost-b.cost)){if(request.island&&!islandAt(terrain,c.position)||!request.island&&/mainland/i.test(request.name)&&islandAt(terrain,c.position))continue;if(ranked.some(r=>distance(r.position,c.position)<=112))continue;
    if(request.intent.water==='coast'){if(waterChecks++>=96)break;if(connectedWaterArea(c.position.x,c.position.z,terrain,terrain.level)<1_000_000)continue;}
    ranked.push(c);if(ranked.length>=24)break;}
  const shores=ranked;
  return request.island?shores.filter(c=>islandAt(terrain,c.position)):shores;
}
export function findDock(manifest:WorldManifest,locationId:string,position:WorldPosition,t:RoutingTerrain,choice=0):DockPlan {
  const candidates:Array<{land:WorldPosition;water:WorldPosition;cost:number}>=[];
  let minWater=Infinity,bestGrade=Infinity;
  for(let i=0;i<48;i++){const a=i*Math.PI/24,dx=Math.cos(a),dz=Math.sin(a),landings=[position];
    for(let r=4;r<=220;r+=4){const x=position.x+dx*r,z=position.z+dz*r,y=t.height(x,z);minWater=Math.min(minWater,y);if(y<t.level-1.4)for(const land of landings)bestGrade=Math.min(bestGrade,Math.abs(land.y-t.level-.35)/Math.max(1,distance(land,{x,z})));
      if(y<t.level-1.4){const water={x,y:t.level+.35,z};if(!navigableWater(t,water))continue;for(const land of [...landings].reverse())if(land.y>t.level+.2&&distance(land,water)<=160&&Math.abs(land.y-water.y)/Math.max(1,distance(land,water))<.12){candidates.push({land,water,cost:r+Math.abs(land.y-water.y)*10});break;}break;}
      if(y>t.level+.3&&t.flow(x,z)<.22&&slopeAt(t,x,z)<.2)landings.push({x,y:y+.15,z});
    }
  }
  if(!candidates.length){const shore:Array<WorldPosition>=[];for(let dz=-640;dz<=640;dz+=16)for(let dx=-640;dx<=640;dx+=16){const x=position.x+dx,z=position.z+dz,y=t.height(x,z);if(y>t.level+.4&&y<t.level+3&&t.flow(x,z)<.22&&slopeAt(t,x,z)<.2)shore.push({x,y:y+.15,z});}
    for(const land of shore.sort((a,b)=>distance(a,position)-distance(b,position)).slice(0,48)){
      for(let i=0;i<16;i++){const angle=i*Math.PI/8;for(let r=8;r<=96;r+=8){const x=land.x+Math.cos(angle)*r,z=land.z+Math.sin(angle)*r;
        if(navigableWater(t,{x,z})&&Math.abs(land.y-t.level-.35)/r<.12){candidates.push({land,water:{x,y:t.level+.35,z},cost:distance(position,land)+r});break;}
      }}if(candidates.length>=8)break;
    }
  }
  const distinct:typeof candidates=[];for(const c of candidates.sort((a,b)=>a.cost-b.cost))if(distinct.every(d=>distance(d.land,c.land)>16))distinct.push(c);
  const dock=distinct[choice];if(!dock)throw new Error(`No accessible deep-water dock approach (site ${position.x},${position.z}, elevation ${position.y.toFixed(1)}, bed ${minWater.toFixed(1)}, grade ${bestGrade.toFixed(2)})`);
  return {id:`${locationId}-dock`,land:dock.land,water:dock.water,width:4,waterBodyId:worldStableId(manifest.id,'water',`${Math.floor(dock.water.x/32)}/${Math.floor(dock.water.z/32)}`)};
}
export function proposeLocationProgram(manifest:WorldManifest,request:SceneRequest,candidate:ReturnType<typeof querySites>[number],t:RoutingTerrain,progress?:(count:number)=>void):LocatedScene {
  const position=candidate.position;let settlement:ReturnType<typeof planSettlement>|undefined,lastFailure:unknown,docks:DockPlan[]=[];
  for(let choice=0;choice<(request.intent.water==='coast'?4:1);choice++)try{
    docks=request.intent.water==='coast'?[findDock(manifest,request.id,position,t,choice)]:[];
    settlement=planSettlement(manifest,request,position,t,docks,progress);break;
  }catch(error){lastFailure=error;}
  if(!settlement)throw lastFailure;
  const radius=Math.max(100,...settlement.buildings.map(b=>distance(b.position,position)+Math.hypot(b.width,b.depth)/2+12));
  return {id:request.id,requestId:request.id,name:request.name,position,radius,biome:sampleWorldClimate(manifest.seed,manifest.terrain.climate,position.x,position.z,position.y).biome,slope:candidate.slope,relief:candidate.relief,waterBodyId:docks[0]?.waterBodyId,settlement};
}
/** Repair a legacy point-depth berth without moving its landing or reshaping land.
 * Call only on a trial manifest: a failed connection must not alter accepted plans. */
export function repairDockClearance(dock:DockPlan,t:RoutingTerrain):void {
  if(navigableWater(t,dock.water))return;
  const span=distance(dock.land,dock.water);
  if(span<.01)throw new Error('The dock needs a distinct offshore berth');
  const dx=(dock.water.x-dock.land.x)/span,dz=(dock.water.z-dock.land.z)/span;
  for(let extra=2;span+extra<=160;extra+=2){
    const water={x:dock.water.x+dx*extra,z:dock.water.z+dz*extra,y:dock.water.y};
    if(t.height(water.x,water.z)>=t.level)break;
    if(navigableWater(t,water)){dock.water=water;return;}
  }
  throw new Error('The saved dock has insufficient ferry draft and no safe extension. Choose a different waterfront.');
}
function commitLocation(manifest:WorldManifest,location:LocatedScene){
  manifest.locations.push(location);const request=manifest.requests.find(r=>r.id===location.requestId)!;request.status='located';
  for(const b of location.settlement.buildings)manifest.terrain.edits.push({id:b.id,kind:'foundation',points:[b.position],width:Math.max(b.width,b.depth)+1,feather:3,footprint:b.footprint});
  for(const r of location.settlement.streets)commitRoad(manifest,r);
  for(const s of location.settlement.structures??[]){const b=sceneRecipeBounds(s.recipe);manifest.terrain.edits.push({id:s.id,kind:'foundation',points:[s.position],width:Math.max(b.max.x-b.min.x,b.max.z-b.min.z),feather:1,footprint:rectangle(s.position,b.max.x-b.min.x,b.max.z-b.min.z,s.yaw)});}
  for(const p of location.settlement.publicSpaces??[])manifest.terrain.edits.push({id:p.id,kind:'foundation',points:[p.position],width:24,feather:2,footprint:p.polygon});
}
function commitRoad(manifest:WorldManifest,r:TransportEdge){for(let i=1;i<r.points.length;i++){if(r.bridges.some(b=>distance(b.start,r.points[i-1])<.1&&distance(b.end,r.points[i])<.1))continue;manifest.terrain.edits.push({id:`${r.id}/${i}`,kind:'road',points:[r.points[i-1],r.points[i]],width:r.width,feather:3});}}
export function connectLocations(manifest:WorldManifest,a:LocatedScene,b:LocatedScene,t:RoutingTerrain,mode:'road'|'ferry'):TransportEdge {
  const id=worldStableId(manifest.id,'route',`${a.id}/${b.id}/${mode}`),da=a.settlement.docks[0],db=b.settlement.docks[0];
  if(mode==='ferry'&&(!da||!db))throw new Error('Ferry endpoints need validated docks');
  if(mode==='ferry'){repairDockClearance(da,t);repairDockClearance(db,t);}
  const start=mode==='ferry'?{...da.water,y:t.level}:a.settlement.buildings[0]?.entrance??a.position,end=mode==='ferry'?{...db.water,y:t.level}:b.settlement.buildings[0]?.entrance??b.position;
  let route:TransportEdge|undefined,failure:unknown;
  const routing=mode==='ferry'?t:{...t,blocked:(x:number,z:number)=>!!t.blocked?.(x,z)||manifest.locations.some(l=>l.settlement.buildings.some(b=>polygonDistance(buildingFootprint(b),{x,z})<.4))};
  for(const step of mode==='ferry'?[16]:[32,16,24])try{route=routeTransport(start,end,routing,{id,from:a.id,to:b.id,mode,existing:[...manifest.transport,...manifest.locations.flatMap(l=>l.settlement.streets)],step,maxNodes:mode==='ferry'?45000:150000});break;}catch(error){failure=error;}
  if(!route)throw failure;
  if(mode==='ferry'){
    const bodyId=manifest.waterBodies.find(w=>w.id===da.waterBodyId||w.id===db.waterBodyId)?.id??[da.waterBodyId,db.waterBodyId].sort()[0];route.waterBodyId=bodyId;
    for(const l of manifest.locations)for(const d of l.settlement.docks)if([da.waterBodyId,db.waterBodyId].includes(d.waterBodyId)){d.waterBodyId=bodyId;l.waterBodyId=bodyId;}
    let body=manifest.waterBodies.find(w=>w.id===bodyId);if(!body){body={id:bodyId,kind:'lake',level:t.level,cellSize:16,cells:[]};manifest.waterBodies.push(body);}body.cells=[...new Set([...body.cells,...route.points.map(p=>`${Math.floor(p.x/16)}/${Math.floor(p.z/16)}`)])];
  }else commitRoad(manifest,route);
  return route;
}
export function validatePlan(manifest:WorldManifest):string[]{
  const errors=validateBiomeCoverage(manifest.seed,manifest.terrain.climate,manifest.origin,manifest.startingRadius),ids=new Set(manifest.locations.map(l=>l.id));
  for(const r of manifest.requests){const l=manifest.locations.find(l=>l.id===r.id);if(!l){errors.push(`Unplaced scene: ${r.name}`);continue;}for(const[role,count]of Object.entries(r.roles))if(l.settlement.buildings.filter(b=>b.role===role).length<count)errors.push(`${r.name}: missing ${role}`);}
  for(const l of manifest.locations){const {buildings,streets,docks}=l.settlement,nodes=new Set([...buildings.map(b=>b.id),...docks.map(d=>d.id),...(l.settlement.nodes??[]).map(n=>n.id)]),reached=new Set<string>(),queue=buildings.length?[buildings[0].id]:[];
    for(let i=0;i<queue.length;i++){const id=queue[i];if(reached.has(id))continue;reached.add(id);for(const r of streets){if(!nodes.has(r.from)||!nodes.has(r.to))errors.push(`${l.name}: invalid street endpoint`);if(r.from===id)queue.push(r.to);if(r.to===id)queue.push(r.from);}}
    for(const id of nodes)if(buildings.length&&!reached.has(id))errors.push(`${l.name}: an entrance or dock is disconnected`);
    for(const b of buildings)for(const r of streets)for(let i=1;i<r.points.length;i++){const a=r.points[i-1],end=r.points[i],steps=Math.max(1,Math.ceil(distance(a,end)/2));for(let j=0;j<=steps;j++){const x=a.x+(end.x-a.x)*j/steps,z=a.z+(end.z-a.z)*j/steps;if(polygonDistance(buildingFootprint(b),{x,z})<-.05){errors.push(`${l.name}: street crosses parcel ${b.id}`);break;}}}
  }
  const seen=new Set<string>(),queue=manifest.locations.length?[manifest.locations[0].id]:[];for(let i=0;i<queue.length;i++){const id=queue[i];if(seen.has(id))continue;seen.add(id);for(const r of manifest.transport){if(!ids.has(r.from)||!ids.has(r.to))errors.push(`Invalid route ${r.id}`);if(r.from===id)queue.push(r.to);if(r.to===id)queue.push(r.from);}}
  for(const id of ids)if(!seen.has(id))errors.push(`Disconnected scene ${id}`);return errors;
}
export function buildSharedWorld(input:WorldPlan,onProgress?:(p:PipelineProgress)=>void,providedTerrain?:RoutingTerrain):WorldPlan {
  const world=structuredClone(input),existing=world.manifest;let manifest:WorldManifest;
  if(existing)manifest=existing;else{
    const first=world.locations[0];if(!first)throw new Error('Add at least one scene before generating the world');
    const [bp]=createFallbackWorldBlueprints({description:`${first.name}. ${first.description}`,kind:'settlement',size:'large',gridShape:'square',seed:sharedWorldSeed(world.seed),background:'none'});
    const origin=providedTerrain?{x:0,z:0}:selectWorldSite(bp,12);manifest=createWorldManifest(world,origin);
    for(const road of world.roads){const request=manifest.requests.find(r=>r.id===road.toLocationId);if(request&&!request.connectsTo.includes(road.fromLocationId))request.connectsTo.push(road.fromLocationId);}
  }
  if(world.generationRequests)manifest.requests=world.generationRequests.map(r=>manifest.locations.some(l=>l.id===r.id)?manifest.requests.find(p=>p.id===r.id)??r:r);
  if(world.generationStyles)for(const style of world.generationStyles)if(!manifest.styles.some(s=>s.id===style.id))manifest.styles.push(style);
  delete world.generationRequests;delete world.generationStyles;
  const t=providedTerrain??worldTerrain(manifest),report=(stage:string,message:string)=>onProgress?.({stage,message,completed:manifest.locations.map(l=>l.id),requests:structuredClone(manifest.requests),...(stage==='Checkpoint'?{checkpoint:structuredClone({...world,manifest})}:{})});
  report('Climate','Indexed climate regions and shared terrain');
  // An isolated harbor always needs a destination, even for a one-scene prompt.
  for(const r of [...manifest.requests])if(r.intent.water==='coast'&&!manifest.requests.some(q=>q.id!==r.id&&q.intent.water==='coast')){
    const id=worldStableId(world.id,'scene',`${r.id}/mainland`);manifest.requests.push({...r,id,name:`${r.name} mainland landing`,description:'A mainland landing with a village serving the island ferry',island:false,scale:'village',roles:{home:8,warehouse:2,inn:1},connectsTo:[r.id],modes:['ferry'],status:'pending'});
  }
  for(const request of manifest.requests){if(manifest.locations.some(l=>l.id===request.id))continue;report('Sites',`Finding supported land for ${request.name}`);
    const previous=manifest.locations.at(-1),preferred=previous?{x:previous.position.x+700,z:previous.position.z+300}:manifest.origin;
    let candidates=providedTerrain?[{position:{...preferred,y:t.height(preferred.x,preferred.z)},slope:0,relief:0}]:querySites(manifest,request,t,preferred);let location:LocatedScene|undefined,lastError='No site satisfies the terrain constraints';
    const candidateStream=function*(){yield* candidates.slice(0,24);if(!providedTerrain&&request.island)for(const region of indexIslandRegions(manifest.seed,preferred)){
      report('Sites',`Measuring an indexed island ${Math.round(distance(preferred,region)/1000)} km from the starting region`);
      yield* querySites(manifest,request,t,region).slice(0,12);
    }
    if(!providedTerrain&&!request.island&&request.intent.water==='coast')for(const radius of [1536,3072])for(let i=0;i<8;i++){
      const a=i*Math.PI/4,region={x:preferred.x+Math.cos(a)*radius,z:preferred.z+Math.sin(a)*radius};
      report('Sites',`Searching another shoreline ${Math.round(radius/1000)} km away for sufficient dry frontage`);
      yield* querySites(manifest,request,t,region).slice(0,8);
    }};
    let index=0;const failures=new Map<string,number>(),tried=new Set<string>();
    for(const candidate of candidateStream())try{const key=`${candidate.position.x}/${candidate.position.z}`;if(tried.has(key))continue;tried.add(key);index++;
      const proposed=proposeLocationProgram(manifest,request,candidate,t,count=>report('Parcels',`${request.name}: site ${index}, ${count} connected buildings`));
      const trial=structuredClone(manifest);commitLocation(trial,proposed);
      if(request.environment?.stratum!=='underground'&&request.environment?.overlays.length)(trial.terrain.environments??=[]).push({id:request.id,x:proposed.position.x,z:proposed.position.z,radius:proposed.radius*3,overlays:structuredClone(request.environment.overlays)});
      if(previous){const targets=request.connectsTo.length?request.connectsTo:[previous.id];for(const target of targets){const a=trial.locations.find(l=>l.id===target);if(!a)continue;const modes=request.modes.filter(m=>m!=='ferry'||a.settlement.docks.length&&proposed.settlement.docks.length);if(a.settlement.docks.length&&proposed.settlement.docks.length)modes.sort(m=>m==='ferry'?-1:1);let route:TransportEdge|undefined,error='No permitted connection';for(const mode of modes)try{route=connectLocations(trial,a,proposed,providedTerrain??worldTerrain(trial),mode);break;}catch(e){error=String(e);}if(!route)throw new Error(error);trial.transport.push(route);}}
      Object.assign(manifest,trial);location=proposed;break;
    }catch(error){lastError=error instanceof Error?error.message:String(error);failures.set(lastError,(failures.get(lastError)??0)+1);report('Sites',`${request.name}: ${lastError}`);}
    if(!location)throw new Error(`Could not place ${request.name} after ${index} measured sites. ${[...failures].map(([reason,count])=>`${count} site(s): ${reason}`).join('; ')||lastError}`);manifest.checkpoints.push({stage:'located',revision:manifest.revision,completed:manifest.locations.map(l=>l.id)});
    if(!world.locations.some(l=>l.id===location!.id))world.locations.push({id:location.id,name:request.name,kind:'village',biome:'coast',position:{x:location.position.x,z:location.position.z},description:request.description,storyBeatIds:[],pointOfInterests:[],mapSeed:world.seed});
    report('Checkpoint',`${request.name} layout saved`);
  }
  for(let i=0;i<manifest.locations.length;i++){
    const b=manifest.locations[i],request=manifest.requests.find(r=>r.id===b.id)!;
    const targets=request.connectsTo.length?request.connectsTo:i?[manifest.locations[i-1].id]:[];
    for(const target of targets){const a=manifest.locations.find(l=>l.id===target);if(!a)throw new Error(`Unknown destination ${target}`);if(manifest.transport.some(r=>(r.from===a.id&&r.to===b.id)||(r.from===b.id&&r.to===a.id)))continue;report('Connections',`Connecting ${a.name} and ${b.name}`);
      const modes=request.modes.filter(m=>m!=='ferry'||(a.settlement.docks.length&&b.settlement.docks.length));if(a.settlement.docks.length&&b.settlement.docks.length)modes.sort(m=>m==='ferry'?-1:1);
      let route:TransportEdge|undefined,error='No compatible transport modes';for(const mode of modes)try{route=connectLocations(manifest,a,b,t,mode);break;}catch(e){error=String(e);}if(!route)throw new Error(error);manifest.transport.push(route);report('Checkpoint',`${a.name} to ${b.name} route saved`);
    }
  }
  const errors=validatePlan(manifest);if(errors.length)throw new Error(errors.join('; '));
  for(const l of world.locations){const located=manifest.locations.find(p=>p.id===l.id);if(located){l.position={x:located.position.x,z:located.position.z};l.mapSeed=world.seed;}}
  manifest.checkpoints.push({stage:'validated',revision:manifest.revision,completed:manifest.locations.map(l=>l.id)});world.manifest=manifest;report('Ready','World geography and connections validated');return world;
}




/** Transactional settlement revision. Geography and other accepted locations are
 * retained; edits to generated buildings require a manual parcel-preserving revision. */
export function reviseSettlement(input:WorldPlan,locationId:string,onProgress?:(p:PipelineProgress)=>void,providedTerrain?:RoutingTerrain):WorldPlan {
  const world=structuredClone(input),m=world.manifest;
  if(!m)throw new Error('This campaign has no shared world');
  const old=m.locations.find(l=>l.id===locationId),request=m.requests.find(r=>r.id===locationId);
  if(!old||!request)throw new Error('Choose an accepted settlement');
  const owned=new Set([...old.settlement.buildings.map(b=>b.id),...(old.settlement.structures??[]).map(s=>s.id),...(old.settlement.publicSpaces??[]).map(s=>s.id)]);
  if((m.authoredEntities??[]).some(e=>owned.has(e.id))||(m.removedEntityIds??[]).some(id=>owned.has(id)))throw new Error('This settlement has edited or removed buildings. Automatic rebuilding would conflict with those edits. Create a separate world to try a new layout; the current settlement has been preserved.');
  const roadIds=[...old.settlement.streets,...m.transport.filter(r=>r.mode==='road'&&(r.from===locationId||r.to===locationId))].map(r=>r.id+'/');
  m.terrain={...m.terrain,edits:m.terrain.edits.filter(e=>!owned.has(e.id)&&!roadIds.some(id=>e.id.startsWith(id)))};
  const t=providedTerrain??worldTerrain(m);
  onProgress?.({stage:'Settlement',message:'Fitting streets and varied buildings to the existing site',completed:[],requests:m.requests});
  const settlement=planSettlement(m,request,old.position,t,old.settlement.docks);
  const revised={...old,settlement,radius:Math.max(100,...settlement.buildings.map(b=>distance(b.position,old.position)+Math.hypot(b.width,b.depth)/2+12))};
  const order=m.locations.map(l=>l.id);m.locations=m.locations.filter(l=>l.id!==locationId);commitLocation(m,revised);m.locations.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
  m.transport=m.transport.map(r=>r.mode==='road'&&(r.from===locationId||r.to===locationId)?connectLocations(m,m.locations.find(l=>l.id===r.from)!,m.locations.find(l=>l.id===r.to)!,providedTerrain??worldTerrain(m),'road'):r);
  const errors=validatePlan(m);if(errors.length)throw new Error(errors.join('; '));
  m.revision++;m.checkpoints.push({stage:'settlement-revised',revision:m.revision,completed:[locationId]});
  return world;
}
