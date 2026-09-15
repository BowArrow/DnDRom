import type { WorldWaterGeometry } from "../domain/types";
import {shoreDistanceField} from "./nativeShore";

export function sampleWaterGrid(g:WorldWaterGeometry,values:number[]|undefined,x:number,z:number,fallback:number):number {
  const u=Math.max(0,Math.min(g.resolution,(x-g.originX)/g.size*g.resolution)),v=Math.max(0,Math.min(g.resolution,(z-g.originZ)/g.size*g.resolution));
  const ix=Math.min(g.resolution-1,Math.floor(u)),iz=Math.min(g.resolution-1,Math.floor(v)),fx=u-ix,fz=v-iz,i=iz*(g.resolution+1),j=i+ix;
  const a=values?.[j]??fallback,b=values?.[j+1]??fallback,c=values?.[j+g.resolution+1]??fallback,d=values?.[j+g.resolution+2]??fallback;
  return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d*(fx+fz-1)+b*(1-fz)+c*(1-fx);
}

/** One contour and nearest wet-surface search for the whole authored region.
 * Chunk boundaries are not shorelines and may not clamp either operation. */
export function createWaterPatchSampler(geometries:WorldWaterGeometry[]) {
  const patches=[...geometries].sort((a,b)=>a.originZ-b.originZ||a.originX-b.originX);
  const depths=new Map(patches.map(g=>[g,g.depthField??g.wetCells.map(w=>w ? .5 : -.5)]));
  const loX=Math.min(...patches.map(p=>p.originX)),loZ=Math.min(...patches.map(p=>p.originZ));
  const hiX=Math.max(...patches.map(p=>p.originX+p.size)),hiZ=Math.max(...patches.map(p=>p.originZ+p.size));
  const at=(x:number,z:number)=>patches.find(p=>x>=p.originX&&x<=p.originX+p.size&&z>=p.originZ&&z<=p.originZ+p.size);
  const depth=(x:number,z:number)=>{
    // Extrapolate the region boundary, never each individual tile boundary.
    x=Math.max(loX,Math.min(hiX,x));z=Math.max(loZ,Math.min(hiZ,z));
    const p=at(x,z);return p?sampleWaterGrid(p,depths.get(p),x,z,-24):-24;
  };
  const surface=(x:number,z:number)=>{x=Math.max(loX,Math.min(hiX,x));z=Math.max(loZ,Math.min(hiZ,z));const p=at(x,z);return p?sampleWaterGrid(p,p.surfaceHeights,x,z,p.waterLevel):undefined;};
  const step=Math.max(.5,Math.min(2,...patches.map(p=>p.size/p.resolution)));
  const rawShore=patches.length?shoreDistanceField(loX,loZ,Math.max(hiX-loX,hiZ-loZ),step,depth):()=>24;
  const cache=new Map<string,number>();
  const shore=(x:number,z:number)=>{const key=`${x}:${z}`;let d=cache.get(key);if(d===undefined){d=rawShore(x,z);cache.set(key,d);}return d;};
  const bins=new Map<string,Array<{x:number;z:number;y:number}>>();
  for(const p of patches)for(let z=0;z<=p.resolution;z++)for(let x=0;x<=p.resolution;x++){
    const i=z*(p.resolution+1)+x;if(depths.get(p)![i]<=0)continue;
    const wx=p.originX+x*p.size/p.resolution,wz=p.originZ+z*p.size/p.resolution,key=`${Math.floor(wx/8)}:${Math.floor(wz/8)}`;
    if(!bins.has(key))bins.set(key,[]);bins.get(key)!.push({x:wx,z:wz,y:p.surfaceHeights?.[i]??p.waterLevel});
  }
  const wetSurface=(x:number,z:number)=>{
    let closest:number|undefined,distance=24**2;
    for(let bz=Math.floor((z-24)/8);bz<=Math.floor((z+24)/8);bz++)for(let bx=Math.floor((x-24)/8);bx<=Math.floor((x+24)/8);bx++)for(const p of bins.get(`${bx}:${bz}`)??[]){const d=(x-p.x)**2+(z-p.z)**2;if(d<distance){distance=d;closest=p.y;}}
    return closest;
  };
  return {depth,shore,wetSurface,surface};
}
