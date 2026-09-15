import { atlasHash, atlasLandform } from "./worldLandform";
import { simulateHydraulicErosion } from "./hydraulicErosion";

export interface ErosionTile { x:number; z:number; resolution:number; cellSize:number; height:Float64Array; delta:Float32Array; discharge:Float32Array; sediment:Float32Array; massError:number }
const RESOLUTION=257, REGIONAL_SPACING=8192, DETAIL_SPACING=2048;
export interface ErosionCache { get:(key:string)=>ErosionTile|undefined; put:(key:string,tile:ErosionTile)=>void }
let externalCache:ErosionCache|undefined;
// Share evolved fields between site selection and scene compilation in the
// same worker. Otherwise selecting a site immediately simulates it twice.
export const erosionStatistics={simulationMs:0,fieldsBuilt:0,cacheHits:0};
const sharedCache=new Map<string,ErosionTile>();
/** Optional local persistence; the mathematical result never depends on it. */
export function configureErosionCache(cache:ErosionCache|undefined){externalCache=cache;}
export const erosionCachePrefix=(seed:number)=>`hydrology-22:${seed}:`;

export function erodeWorldTile(tx:number,tz:number,seed:number,spacing=REGIONAL_SPACING,base=(x:number,z:number)=>atlasLandform(x,z,seed,spacing*2/(RESOLUTION-1))):ErosionTile {
  const cellSize=spacing*2/(RESOLUTION-1);
  const source=Float64Array.from({length:RESOLUTION*RESOLUTION},(_,i)=>base(tx*spacing-spacing+i%RESOLUTION*cellSize,tz*spacing-spacing+Math.floor(i/RESOLUTION)*cellSize));
  const detail=spacing<REGIONAL_SPACING;
  const started=performance.now();
  const result=simulateHydraulicErosion(source,RESOLUTION,cellSize,Math.floor(atlasHash(tx,tz,seed+1709)*0xffffffff),1,detail?512:128,1/256);
  erosionStatistics.simulationMs+=performance.now()-started;erosionStatistics.fieldsBuilt++;
  return {x:tx,z:tz,resolution:RESOLUTION,cellSize,height:result.height,delta:result.delta,discharge:result.discharge,sediment:result.sediment,massError:result.massError};
}

/** World-anchored, overlapping simulations. The fine pass evolves the regional
 * eroded surface; it is evaluated only where the mesh can resolve its gullies. */
export function createErodedWorldSampler(seed:number,maxTiles=256) {
  const coarse=new Map<string,ErosionTile>(),fine=new Map<string,ErosionTile>();
  const sampleLayer=(cache:Map<string,ErosionTile>,spacing:number,x:number,z:number,layer:"height"|"delta"|"discharge"|"sediment",base:(x:number,z:number)=>number,limit:number):number=>{
    const gx=x/spacing,gz=z/spacing,ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz;
    const sx=u*u*(3-2*u),sz=v*v*(3-2*v);let result=0;
    for(let dz=0;dz<2;dz++)for(let dx=0;dx<2;dx++) {
      const weight=(dx?sx:1-sx)*(dz?sz:1-sz);if(weight<1e-10)continue;
      const key=`${ix+dx}:${iz+dz}`;let tile=cache.get(key);
      if(tile) {cache.delete(key);cache.set(key,tile);} else {
        const diskKey=`${erosionCachePrefix(seed)}${spacing}:${key}`;
        tile=sharedCache.get(diskKey)??externalCache?.get(diskKey);
        if(tile&&(tile.resolution!==RESOLUTION||tile.cellSize!==spacing*2/(RESOLUTION-1)||tile.height?.length!==RESOLUTION*RESOLUTION||tile.discharge?.length!==RESOLUTION*RESOLUTION))tile=undefined;
        if(tile)erosionStatistics.cacheHits++;
        if(!tile){tile=erodeWorldTile(ix+dx,iz+dz,seed,spacing,base);externalCache?.put(diskKey,tile);}
        sharedCache.delete(diskKey);sharedCache.set(diskKey,tile);
        if(sharedCache.size>64)sharedCache.delete(sharedCache.keys().next().value!);
        cache.set(key,tile);if(cache.size>limit)cache.delete(cache.keys().next().value!);
      }
      const px=(x-tile.x*spacing+spacing)/tile.cellSize,pz=(z-tile.z*spacing+spacing)/tile.cellSize;
      const cx=Math.min(RESOLUTION-2,Math.floor(px)),cz=Math.min(RESOLUTION-2,Math.floor(pz)),a=pz-cz,b=px-cx,i=cz*RESOLUTION+cx,values=tile[layer];
      result+=((values[i]*(1-b)+values[i+1]*b)*(1-a)+(values[i+RESOLUTION]*(1-b)+values[i+RESOLUTION+1]*b)*a)*weight;
    }
    return result;
  };
  const fineLimit=Math.max(4,Math.min(32,Math.floor(maxTiles/4))),coarseLimit=Math.max(4,maxTiles-fineLimit);
  const raw=(x:number,z:number)=>atlasLandform(x,z,seed,64);
  const regional=(x:number,z:number)=>sampleLayer(coarse,REGIONAL_SPACING,x,z,"height",raw,coarseLimit);
  const detailBase=(x:number,z:number)=>regional(x,z)+atlasLandform(x,z,seed,16)-raw(x,z);
  const sample=(x:number,z:number,layer:"height"|"delta"|"discharge"|"sediment"="delta",detail=false)=>sampleLayer(detail?fine:coarse,detail?DETAIL_SPACING:REGIONAL_SPACING,x,z,layer,detail?detailBase:raw,detail?fineLimit:coarseLimit);
  // Reconstruct the evolved surface; adding deltas to unsampled noise revives
  // un-eroded peaks between simulation samples.
  return {height:(x:number,z:number,detail=false)=>detail?sample(x,z,"height",true):regional(x,z),sample,cachedTiles:()=>coarse.size+fine.size};
}
