import type { GameMap, MapEntity } from "./types";
import { sceneRecipeBounds } from "./sceneGrammar";
import { distanceToSegment, sampleTerrainHeight, sampleWorldField, type RoadSegment, type WorldFieldSet } from "./worldProcedural";

export interface PlacementSurface {
  width:number; depth:number;
  height:(x:number,z:number)=>number;
  blocked:(x:number,z:number)=>boolean;
}
export function fieldPlacementSurface(field:WorldFieldSet,roads:readonly RoadSegment[]):PlacementSurface {
  const blockedRoad=new Uint8Array(field.resolution**2),n=field.resolution;
  for(const r of roads){
    const margin=r.width*.9+.6+field.cellSize*.71;
    const ax=Math.max(0,Math.floor((Math.min(r.ax,r.bx)-margin-field.originX)/field.cellSize)),bx=Math.min(n-1,Math.ceil((Math.max(r.ax,r.bx)+margin-field.originX)/field.cellSize));
    const az=Math.max(0,Math.floor((Math.min(r.az,r.bz)-margin-field.originZ)/field.cellSize)),bz=Math.min(n-1,Math.ceil((Math.max(r.az,r.bz)+margin-field.originZ)/field.cellSize));
    for(let z=az;z<=bz;z++)for(let x=ax;x<=bx;x++)if(distanceToSegment(field.originX+x*field.cellSize,field.originZ+z*field.cellSize,r.ax,r.az,r.bx,r.bz)<margin)blockedRoad[z*n+x]=1;
  }
  return {width:field.width,depth:field.depth,height:(x,z)=>sampleWorldField(field,"elevation",x,z),
    blocked:(x,z)=>sampleWorldField(field,"waterMask",x,z)>-.08 || Boolean(blockedRoad[Math.max(0,Math.min(n-1,Math.round((z-field.originZ)/field.cellSize)))*n+Math.max(0,Math.min(n-1,Math.round((x-field.originX)/field.cellSize)))])};
}
/** Persisted water triangles are the authority when the compiler's fields
 * are unavailable (travel silhouettes and subsequent scene edits). */
export function mapPlacementSurface(map:GameMap):PlacementSurface {
  const terrains=map.entities.flatMap(e=>e.worldGeometry?.kind==="terrain"?[e.worldGeometry]:[]);
  const waters=map.entities.flatMap(e=>e.worldGeometry?.kind==="water"?[e.worldGeometry]:[]);
  const terrainAt=(x:number,z:number)=>terrains.find(p=>x>=p.originX&&x<=p.originX+p.size&&z>=p.originZ&&z<=p.originZ+p.size);
  return {width:map.width,depth:map.depth,height:(x,z)=>{const p=terrainAt(x,z);return p?sampleTerrainHeight(p,x,z):0;},blocked:(x,z)=>{
    const p=terrainAt(x,z);
    if(p?.paths.some(r=>distanceToSegment(x,z,r.ax,r.az,r.bx,r.bz)<r.width*.9+.6))return true;
    return waters.some(w=>{
      if(x<w.originX||x>w.originX+w.size||z<w.originZ||z>w.originZ+w.size)return false;
      const ix=Math.min(w.resolution-1,Math.floor((x-w.originX)/w.size*w.resolution));
      const iz=Math.min(w.resolution-1,Math.floor((z-w.originZ)/w.size*w.resolution)),i=iz*(w.resolution+1)+ix;
      return [i,i+1,i+w.resolution+1,i+w.resolution+2].some(j=>w.wetCells[j]);
    });
  }};
}
export function entityFootprint(entity:MapEntity) {
  const g=entity.worldGeometry;
  const b=g?.kind==="assembly"?sceneRecipeBounds(g.parts):g?.kind==="cga-building"?{
    min:{x:Math.min(...g.footprint.map(p=>p.x)),y:0,z:Math.min(...g.footprint.map(p=>p.z))},
    max:{x:Math.max(...g.footprint.map(p=>p.x)),y:0,z:Math.max(...g.footprint.map(p=>p.z))},
  }:{min:{x:-.6,y:0,z:-.6},max:{x:.6,y:1,z:.6}};
  return {minX:b.min.x*entity.scale.x,maxX:b.max.x*entity.scale.x,minZ:b.min.z*entity.scale.z,maxZ:b.max.z*entity.scale.z,minY:b.min.y*entity.scale.y};
}
export function footprintSamples(entity:MapEntity,padding=.6,spacing=.5):Array<{x:number;z:number}> {
  const b=entityFootprint(entity),angle=entity.rotation.y*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const nx=Math.max(1,Math.ceil((b.maxX-b.minX+2*padding)/spacing)),nz=Math.max(1,Math.ceil((b.maxZ-b.minZ+2*padding)/spacing)),points=[];
  for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
    const x=b.minX-padding+(b.maxX-b.minX+2*padding)*ix/nx,z=b.minZ-padding+(b.maxZ-b.minZ+2*padding)*iz/nz;
    points.push({x:entity.position.x+x*c+z*s,z:entity.position.z-x*s+z*c});
  }
  return points;
}
const boundsCache=new WeakMap<MapEntity,ReturnType<typeof entityFootprint>>();
function inside(entity:MapEntity,x:number,z:number):boolean {
  let b=boundsCache.get(entity);if(!b){b=entityFootprint(entity);boundsCache.set(entity,b);}
  const a=entity.rotation.y*Math.PI/180,dx=x-entity.position.x,dz=z-entity.position.z;
  const lx=dx*Math.cos(a)-dz*Math.sin(a),lz=dx*Math.sin(a)+dz*Math.cos(a);
  return lx>b.minX-.8&&lx<b.maxX+.8&&lz>b.minZ-.8&&lz<b.maxZ+.8;
}
/** Search dry supported parcels after AI expansion, so scaling and yaw cannot
 * invalidate an earlier centre-only check. Never silently put a failed parcel
 * back in the lake. The caller records an unplaced request instead. */
export function placeOnDryGround(entity:MapEntity,surface:PlacementSurface,occupied:MapEntity[]=[],maxDistance=48):boolean {
  const original={...entity.position},bounds=entityFootprint(entity);
  const offsets=footprintSamples(entity).map(p=>({x:p.x-original.x,z:p.z-original.z}));
  const candidates=[{x:original.x,z:original.z}];
  for(let radius=2;radius<=maxDistance;radius+=2){const count=Math.ceil(2*Math.PI*radius/2);for(let i=0;i<count;i++)candidates.push({x:original.x+Math.cos(i/count*Math.PI*2)*radius,z:original.z+Math.sin(i/count*Math.PI*2)*radius});}
  for(const p of candidates){
    entity.position.x=p.x;entity.position.z=p.z;
    const samples=offsets.map(q=>({x:p.x+q.x,z:p.z+q.z}));
    if(samples.some(q=>Math.abs(q.x)>surface.width/2-.5||Math.abs(q.z)>surface.depth/2-.5||surface.blocked(q.x,q.z)||occupied.some(other=>inside(other,q.x,q.z))))continue;
    if(occupied.some(other=>footprintSamples(other,0,2).some(q=>inside(entity,q.x,q.z))))continue;
    const heights=samples.map(q=>surface.height(q.x,q.z)),low=Math.min(...heights),high=Math.max(...heights);
    if(high-low>1.5)continue;
    entity.position.y=low-bounds.minY+.025;
    if(p.x!==original.x||p.z!==original.z)entity.tags=[...(entity.tags??[]),"placement:relocated-to-dry-ground"];
    return true;
  }
  entity.position=original;return false;
}
