import type { GameMap, MapEntity, WorldBlueprintV1, WorldPlan } from './types';
import type { WorldManifest, WorldPosition, WorldPoint, TransportEdge } from './sharedWorld';
import { worldClearing, distance } from './sharedWorld';
import { compileWorldBlueprint, createFallbackWorldBlueprints } from './worldForge';
import { expandSceneRecipe, type ScenePart } from './sceneGrammar';
import { sampleSharedClimate } from './worldClimate';
import {dressSettlementSurfaces,settlementSurface} from './settlementSurfaces';

const unit={x:1,y:1,z:1},zero={x:0,y:0,z:0};
const part=(shape:ScenePart['shape'],x:number,y:number,z:number,w:number,h:number,d:number,material:ScenePart['material']='timber',color='#85745a'):ScenePart=>({shape,position:{x,y,z},size:{x:w,y:h,z:d},rotation:{...zero},material,color});
const local=(p:WorldPosition,o:WorldPosition)=>({x:p.x-o.x,y:p.y-o.y,z:p.z-o.z});
const entity=(id:string,name:string,p:WorldPosition,parts:ScenePart[],yaw=0,tags:string[]=[]):MapEntity=>({id,name,assetId:'house-large',position:p,rotation:{x:0,y:yaw,z:0},scale:{...unit},tags,worldGeometry:{kind:'assembly',recipeId:id,parts:expandSceneRecipe(parts)}});
export interface WorldBounds {minX:number;minZ:number;maxX:number;maxZ:number}
export function sharedWorldEntities(manifest:WorldManifest,origin:WorldPosition,bounds:WorldBounds,detailed=true,exclude?:WorldBounds):MapEntity[]{
  const owns=(p:WorldPoint)=>{const x=p.x-origin.x,z=p.z-origin.z;return x>=bounds.minX&&x<bounds.maxX&&z>=bounds.minZ&&z<bounds.maxZ&&!(exclude&&x>=exclude.minX&&x<exclude.maxX&&z>=exclude.minZ&&z<exclude.maxZ);};
  const entities:MapEntity[]=[];
  for(const l of manifest.locations){
    for(const s of l.settlement.structures??[])if(owns(s.position))entities.push(entity(s.id,'Fortification',local(s.position,origin),s.recipe,s.yaw,['world:building',`location:${l.id}`]));
    for(const s of l.settlement.publicSpaces??[])if(owns(s.position)){
      const width=Math.max(...s.polygon.map(p=>p.x))-Math.min(...s.polygon.map(p=>p.x)),depth=Math.max(...s.polygon.map(p=>p.z))-Math.min(...s.polygon.map(p=>p.z));
      entities.push(entity(s.id,s.kind,local(s.position,origin),[part('box',0,.03,0,width,.06,depth,'ground','#968a78')],0,['world:public-space']));
    }
    if(manifest.requests.find(r=>r.id===l.id)?.environment?.stratum==='underground'){
      if(owns(l.position))entities.push(entity(`${l.id}-entrance`,`${l.name} entrance`,local(l.position,origin),[part('arch',0,0,0,4,4,2,'masonry','#777369')],0,['world:entrance',`location:${l.id}`]));
      continue;
    }
    for(const b of l.settlement.buildings)if(owns(b.position)){
      const parts=detailed?b.recipe:b.recipe.map(p=>p.shape==='frame'?{...p,shape:'box' as const}:p);
      const e=entity(b.id,`${l.name} · ${b.role}`,local(b.position,origin),parts,b.yaw,['world:building',`location:${l.id}`,`role:${b.role}`]);e.worldAccess={entrance:local(b.entrance,origin),anchor:local({...b.position,y:b.position.y+.3},origin)};entities.push(e);
    }
    for(const dock of l.settlement.docks)if(owns(dock.land)){
      const len=distance(dock.land,dock.water),height=(dock.land.y+dock.water.y)/2,position={x:(dock.land.x+dock.water.x)/2,y:height,z:(dock.land.z+dock.water.z)/2},parts=[{...part('box',0,0,0,dock.width,.3,Math.hypot(len,dock.water.y-dock.land.y)),rotation:{x:-Math.atan2(dock.water.y-dock.land.y,len)*180/Math.PI,y:0,z:0}}];
      for(let d=-len/2;d<=len/2;d+=5)for(const side of [-1,1])parts.push(part('cylinder',side*(dock.width/2-.25),-2,d,.25,4,.25));
      entities.push(entity(dock.id,'Working dock',local(position,origin),parts,Math.atan2(dock.water.x-dock.land.x,dock.water.z-dock.land.z)*180/Math.PI,['world:dock']));
    }
  }
  for(const route of [...manifest.transport,...manifest.locations.flatMap(l=>l.settlement.streets)]){
    if(route.mode==='ferry'){
      // The moving actor belongs to the departure tile for its entire journey.
      if(owns(route.points[0])){const boat=entity(`${route.id}-boat`,'Ferry',local(route.points[0],origin),[part('box',0,.15,0,2.8,.55,7),part('box',0,.7,0,2.4,.2,5),part('cylinder',0,3,0,.16,6,.16),part('box',.9,3.6,0,1.8,3,.04,'roof','#dbd2b6')]);boat.routeMotion={points:route.points.map(p=>local(p,origin)),speed:route.speed,dwell:12};entities.push(boat);}continue;
    }
    for(let i=1;i<route.points.length;i++){const a=route.points[i-1],b=route.points[i],p={x:(a.x+b.x)/2,y:(a.y+b.y)/2+.04,z:(a.z+b.z)/2};if(!owns(p))continue;const bridge=route.bridges.find(s=>distance(s.start,a)<.1&&distance(s.end,b)<.1);if(!bridge)continue;
      const length=distance(a,b),parts=[part(bridge.family==='suspension'?'suspension':'bridge-deck',0,0,0,route.width,5,length,'timber','#86755c')];
      if(bridge.family==='stone'){for(const side of [-1,1])parts.push({...part('arch',side*(route.width/2-.45),-bridge.clearance,0,length,bridge.clearance-.25,.9,'masonry','#858178'),rotation:{x:0,y:90,z:0}});for(const end of [-1,1])parts.push(part('box',0,-bridge.clearance/2,end*length/2,route.width,bridge.clearance,.8,'masonry','#858178'));}
      const e=entity(bridge.id,`${bridge.family} bridge`,local(p,origin),parts,Math.atan2(b.x-a.x,b.z-a.z)*180/Math.PI,['world:bridge']);e.rotation.x=-Math.atan2(b.y-a.y,length)*180/Math.PI;entities.push(e);
    }
  }
  for(const e of entities)if(e.tags?.includes('world:building')&&e.worldGeometry?.kind==='assembly'){
    const locationId=e.tags.find(t=>t.startsWith('location:'))!.slice(9);
    e.worldGeometry.parts=dressSettlementSurfaces(e.worldGeometry.parts,settlementSurface(manifest,locationId,e.id));
    e.worldGeometry.recipeId=e.id+'/surfaces-036';
  }
  const overrides=new Map((manifest.authoredEntities??[]).filter(e=>!e.tags?.some(t=>t.startsWith('world:underground:'))).map(e=>[e.id,e])),removed=new Set(manifest.removedEntityIds??[]);
  const result=entities.filter(e=>!removed.has(e.id)&&!overrides.has(e.id));
  for(const source of overrides.values())if(!removed.has(source.id)&&owns(source.position)){const e=structuredClone(source);e.position=local(e.position,origin);if(e.worldAccess){e.worldAccess={entrance:local(e.worldAccess.entrance,origin),anchor:local(e.worldAccess.anchor,origin)};}result.push(e);}return result;
}
export function sharedSceneBlueprint(world:WorldPlan,locationId?:string):WorldBlueprintV1 {
  const m=world.manifest;if(!m)throw new Error('This world has no shared geography');
  const location=m.locations.find(l=>l.id===locationId)??m.locations[0],request=m.requests.find(r=>r.id===location.id)!;
  const [bp]=createFallbackWorldBlueprints({description:request.description||request.name,kind:'exterior',size:'large',seed:m.seed,gridShape:'square',background:'none'});
  const c=sampleSharedClimate(m.seed,m.terrain,location.position.x,location.position.z,location.position.y);
  bp.name=locationId?location.name:`${world.name} · Travel`;bp.id=`${m.id}/${location.id}/${locationId?'scene':'travel'}`;
  bp.site={version:1,x:location.position.x,z:location.position.z,datum:location.position.y,seaLevel:180,intent:{...request.intent,forest:c.forest},slope:location.slope,relief:location.relief,shared:m.terrain};
  bp.biome.vegetationDensity=c.forest;bp.biome.treeStyle=c.temperature<6?'pine':'broadleaf';bp.biome.id=c.biome.includes('desert')?'desert':c.snow>.5?'snow':c.forest>.4?'forest':'plains';
  if(request.intent.water==='coast')bp.theme='coast';
  bp.assetRequests=[];bp.architecture=undefined;return bp;
}
export function compileSharedScene(world:WorldPlan,locationId?:string):GameMap {
  const request=world.manifest!.requests.find(r=>r.id===locationId);
  if(request?.environment?.stratum==='underground')return compileUndergroundScene(world,locationId!);
  const m=world.manifest!,blueprint=sharedSceneBlueprint(world,locationId),origin={x:blueprint.site!.x,y:blueprint.site!.datum,z:blueprint.site!.z};
  const map=compileWorldBlueprint(blueprint).map;
  map.entities=map.entities.filter(e=>e.worldGeometry?.kind==='terrain'||e.worldGeometry?.kind==='water'||e.tags?.includes('world:vegetation')||e.worldGeometry?.kind==='ground-cover'||e.tags?.includes('ecology:understory'));
  for(const e of map.entities){const g=e.worldGeometry;if(g?.kind==='ground-cover'||g?.kind==='space-colonized-tree'&&g.instances)g.instances=g.instances!.filter(p=>worldClearing(m.terrain,p.x+origin.x,p.z+origin.z)<.05);}
  map.entities.push(...sharedWorldEntities(m,origin,{minX:-128,minZ:-128,maxX:128,maxZ:128}));
  map.id=`${m.id}/${locationId??'travel'}`;map.locationId=locationId;map.world!.sharedWorld=m;
  map.world!.environment=request?.environment;
  // Persist the terrain plan once, rather than once per authored chunk.
  for(const e of map.entities)if(e.worldGeometry?.kind==='terrain'&&e.worldGeometry.worldSite)e.worldGeometry.worldSite={...e.worldGeometry.worldSite,shared:undefined};
  const location=m.locations.find(l=>l.id===locationId)??m.locations[0];
  map.journey={worldId:m.id,level:locationId?'settlement':'travel',origin:{x:origin.x,z:origin.z},metersPerUnit:1,biomes:[],sites:m.locations.map(l=>({locationId:l.id,name:l.name,kind:m.requests.find(r=>r.id===l.id)!.purpose,x:l.position.x-origin.x,z:l.position.z-origin.z,biome:'plains',description:l.name})),interiors:location.settlement.buildings.map(b=>({entityId:b.id,name:b.role,entrance:local(b.entrance,origin),pointOfInterestIds:world.locations.find(l=>l.id===location.id)?.pointOfInterests.map(p=>p.id)??[]}))};
  const source=world.locations.find(l=>l.id===location.id);
  map.pointsOfInterest=(source?.pointOfInterests??[]).map((p,i)=>({...p,position:local(location.settlement.buildings[i%Math.max(1,location.settlement.buildings.length)]?.entrance??location.position,origin)}));
  for(const chunk of map.world!.chunks)chunk.entityIds=[];
  for(const e of map.entities){const chunk=map.world!.chunks.find(c=>e.position.x>=c.bounds.min.x&&e.position.x<c.bounds.max.x&&e.position.z>=c.bounds.min.z&&e.position.z<c.bounds.max.z);if(chunk){e.chunkId=chunk.id;chunk.entityIds.push(e.id);}}
  return map;
}

/** A cave has a surface entrance in the accepted transport network, while its
 * playable rooms occupy a separate layer below that same world position. */
function compileUndergroundScene(world:WorldPlan,locationId:string):GameMap{
  const m=world.manifest!,location=m.locations.find(l=>l.id===locationId)!,request=m.requests.find(r=>r.id===locationId)!;
  const [bp]=createFallbackWorldBlueprints({description:request.description,kind:'dungeon',size:'small',seed:m.seed,gridShape:'square',background:'none'});
  bp.id=`${m.id}/${locationId}/underground`;bp.name=location.name;bp.theme='dungeon';
  const map=compileWorldBlueprint(bp).map;map.id=`${m.id}/${locationId}`;map.locationId=locationId;
  map.world!.sharedWorld=m;map.world!.environment=request.environment;
  map.world!.site={version:1,x:location.position.x,z:location.position.z,datum:location.position.y-(request.environment!.depth??24),seaLevel:180,intent:request.intent,slope:0,relief:0,shared:m.terrain};
  const overrides=(m.authoredEntities??[]).filter(e=>e.tags?.includes(`world:underground:${locationId}`)),removed=new Set(m.removedEntityIds??[]),ids=new Set(overrides.map(e=>e.id));
  map.entities=map.entities.filter(e=>!removed.has(e.id)&&!ids.has(e.id));
  for(const source of overrides){const e=structuredClone(source),origin={x:location.position.x,y:map.world!.site.datum,z:location.position.z};e.position=local(e.position,origin);if(e.worldAccess)e.worldAccess={entrance:local(e.worldAccess.entrance,origin),anchor:local(e.worldAccess.anchor,origin)};map.entities.push(e);}
  map.journey={worldId:m.id,level:'settlement',origin:{x:location.position.x,z:location.position.z},metersPerUnit:1,biomes:[],sites:m.locations.map(l=>({locationId:l.id,name:l.name,kind:m.requests.find(r=>r.id===l.id)!.purpose,x:l.position.x-location.position.x,z:l.position.z-location.position.z,biome:'plains',description:l.name})),interiors:[]};
  return map;
}
