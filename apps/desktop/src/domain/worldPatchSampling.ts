import type { WorldTerrainGeometry } from "./types";
import { sampleTerrainHeight } from "./worldProcedural";

/** A derivative needs both sides of an edge. A tile-local clamped lookup
 * halves its edge slope and disagrees with the tile on the other side. */
export function createTerrainPatchSampler(patches:WorldTerrainGeometry[]) {
  const ordered=[...patches].sort((a,b)=>a.originZ-b.originZ||a.originX-b.originX);
  const at=(x:number,z:number)=>ordered.find(p=>x>=p.originX&&x<=p.originX+p.size&&z>=p.originZ&&z<=p.originZ+p.size);
  const height=(x:number,z:number):number=>{
    const inside=at(x,z);if(inside)return sampleTerrainHeight(inside,x,z);
    // Extend only the last boundary derivative when a neighbor is not resident.
    // All consumers use this same extension; it never changes mesh elevations.
    let best:WorldTerrainGeometry|undefined,distance=Infinity;
    for(const p of ordered){const d=Math.hypot(Math.max(p.originX-x,0,x-p.originX-p.size),Math.max(p.originZ-z,0,z-p.originZ-p.size));if(d<distance){distance=d;best=p;}}
    if(!best)return 0;
    const p=best,bx=Math.max(p.originX,Math.min(p.originX+p.size,x)),bz=Math.max(p.originZ,Math.min(p.originZ+p.size,z)),e=Math.min(2,p.size/4);
    const ax=Math.max(p.originX,bx-e),ex=Math.min(p.originX+p.size,bx+e),az=Math.max(p.originZ,bz-e),ez=Math.min(p.originZ+p.size,bz+e);
    return sampleTerrainHeight(p,bx,bz)+(x-bx)*(sampleTerrainHeight(p,ex,bz)-sampleTerrainHeight(p,ax,bz))/(ex-ax)+(z-bz)*(sampleTerrainHeight(p,bx,ez)-sampleTerrainHeight(p,bx,az))/(ez-az);
  };
  const normal=(x:number,z:number)=>{
    const e=2,nx=height(x-e,z)-height(x+e,z),nz=height(x,z-e)-height(x,z+e),length=Math.hypot(nx,2*e,nz);
    return {x:nx/length,y:2*e/length,z:nz/length};
  };
  return {at,height,normal};
}
