import type { GameMap, WorldTerrainGeometry } from "./types";
import { terrainSurfaceWeights } from "./worldProcedural";
import { denseGroundCoverPoints, scatterVariation } from "./worldScatter";
import {siteWater,siteSurface,type WorldSite} from "./worldSite";
import {createTerrainPatchSampler} from "./worldPatchSampling";
import { applyTerrainEdits, worldClearing, type WorldManifest } from './sharedWorld';
import { sampleSharedClimate, worldForestCandidates } from './worldClimate';

/** Tile addresses and samples use double precision world coordinates. Meshes
 * store offsets from the tile centre, never large absolute vertex positions. */
export interface AtlasTile { x: number; z: number; level: number }
export interface AtlasContext { seed: number; width: number; depth: number; patches: WorldTerrainGeometry[];site?:WorldSite;sharedWorld?:WorldManifest }
export const tileSize = (tile: AtlasTile) => 32 * 2 ** tile.level;
export const tileKey = (tile: AtlasTile) => `${tile.level}/${tile.x}/${tile.z}`;
export const tileChildren = (tile: AtlasTile): AtlasTile[] => [0, 1, 2, 3].map(i => ({ x: tile.x * 2 + i % 2, z: tile.z * 2 + Math.floor(i / 2), level: tile.level - 1 }));
const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x*x*(3-2*x); };
export { atlasHash,atlasNoise,atlasClimate,atlasLandform } from "./worldLandform";
import { atlasHash,atlasNoise,atlasClimate,atlasLandform } from "./worldLandform";
import { createErodedWorldSampler } from "./worldErosion";
/** One material field across the authored/streamed boundary. The near edge
 * retains the persisted geology and road paint, then joins regional ecology. */
export function atlasSurface(context:AtlasContext,x:number,z:number,y:number,up:number):number[] {
  if(context.site){const weights=siteSurface(context.site,context.seed,x,z,y,up);return [weights.rock,weights.vegetation,weights.snow*.55,weights.road];}
  const climate=atlasClimate(x,z,context.seed);
  const alpine=smooth((atlasAltitude(context,y)-(480+climate.temperature*100))/240);
  const exposure=atlasNoise(x/48,z/48,context.seed+1703);
  const rock=Math.max(smooth((.93-up)/.3),alpine*(.72+exposure*.28));
  const grass=(.35+climate.moisture*.5)*smooth((up-.45)/.4)*(1-rock);
  const regional=[rock,grass,smooth((climate.moisture-.7)/.3)*.3*(1-rock),0];
  const bx=Math.max(-context.width/2,Math.min(context.width/2,x)),bz=Math.max(-context.depth/2,Math.min(context.depth/2,z));
  const distance=Math.hypot(x-bx,z-bz);
  if(distance>=96)return regional;
  const patch=context.patches.find(p=>bx>=p.originX-.001&&bx<=p.originX+p.size+.001&&bz>=p.originZ-.001&&bz<=p.originZ+p.size+.001);
  if(!patch)return regional;
  const near=terrainSurfaceWeights(patch,bx,bz,up),blend=smooth(distance/96);
  return [near.rock,near.vegetation,near.wet+near.snow*.55,near.road].map((weight,i)=>weight*(1-blend)+regional[i]*blend);
}
export function atlasContext(map: GameMap): AtlasContext {
  return { seed: map.world?.seed ?? 1, width: map.width, depth: map.depth, site:map.world?.site, sharedWorld:map.world?.sharedWorld, patches: map.entities.flatMap(e => e.worldGeometry?.kind === "terrain" ? [map.world?.site?.shared?{...e.worldGeometry,worldSite:map.world.site}:e.worldGeometry] : []) };
}
const erosionSamplers=new WeakMap<AtlasContext,ReturnType<typeof createErodedWorldSampler>>();
const elevationDatums=new WeakMap<AtlasContext,number>();
const patchSamplers=new WeakMap<AtlasContext,ReturnType<typeof createTerrainPatchSampler>>();
export const atlasAltitude=(context:AtlasContext,y:number)=>y+(context.site?.datum??elevationDatums.get(context)??0);
/** Canopy coverage for the subpixel forest material, in the same world frame
 * as tree placement. Alpha stores its complement so legacy white stays clear. */
export function atlasForestCoverage(context:AtlasContext,x:number,z:number,y:number,up:number):number {
  if(context.site?.shared){const wx=x+context.site.x,wz=z+context.site.z,c=sampleSharedClimate(context.seed,context.site.shared,wx,wz,y+context.site.datum,0,Math.sqrt(Math.max(0,1-up*up)));return c.forest*(1-c.snow)*(1-worldClearing(context.site.shared,wx,wz));}
  const climate=atlasClimate(x+(context.site?.x??0),z+(context.site?.z??0),context.seed);
  const distance=Math.hypot(Math.max(0,Math.abs(x)-context.width/2),Math.max(0,Math.abs(z)-context.depth/2));
  const localForest=context.site?.intent.forest??(context.patches.some(p=>p.biomeId==="forest")?.8:undefined);
  const regional=smooth((climate.moisture-.28)/.4),mix=smooth(distance/1600);
  const woodland=localForest===undefined?regional:localForest*(1-mix)+regional*mix;
  const treeLine=1-smooth((atlasAltitude(context,y)-(510+climate.temperature*180))/40);
  return Math.min(.96,woodland*1.2)*(.72+atlasNoise(x/95,z/95,context.seed+127)*.28)*treeLine*smooth((up-.8)/.12);
}
export function createAtlasHydrologySampler(context:AtlasContext,detail=true){
  let erosion=erosionSamplers.get(context);if(!erosion){erosion=createErodedWorldSampler(context.seed);erosionSamplers.set(context,erosion);}
  return (x:number,z:number)=>{
    if(context.site){const site=context.site,flow=erosion.sample(x+site.x,z+site.z,"discharge",detail),height=erosion.height(x+site.x,z+site.z,detail)-site.datum;return .35+siteWater(site,height,flow).mask;}
    // Persisted local water remains authoritative inside the authored map.
    const distance=Math.hypot(Math.max(0,Math.abs(x)-context.width/2),Math.max(0,Math.abs(z)-context.depth/2));
    return erosion.sample(x,z,"discharge",detail)*(context.patches.length?smooth(distance/64):1);
  };
}
export function createAtlasSampler(context: AtlasContext,simulate=true,detail=false): (x: number,z: number) => number {
  let erosion=simulate?erosionSamplers.get(context):undefined;if(simulate&&!erosion){erosion=createErodedWorldSampler(context.seed);erosionSamplers.set(context,erosion);}
  const globalHeight=(x:number,z:number)=>erosion?erosion.height(x,z,detail):atlasLandform(x,z,context.seed);
  // Match the persisted region's elevation datum. Blending a village at zero
  // straight into an unrelated 300 m regional datum produced a crater wall.
  let datum:number|undefined;
  const regional=(x:number,z:number)=>{
    if(context.site)return applyTerrainEdits(context.site.shared,x+context.site.x,z+context.site.z,globalHeight(x+context.site.x,z+context.site.z))-context.site.datum;
    if(datum===undefined){
      const centre=context.patches.find(p=>p.originX<=0&&p.originX+p.size>=0&&p.originZ<=0&&p.originZ+p.size>=0);
      const field=centre?.heightfield;
      const localHeight=field?field.heights[Math.min(field.resolution-1,Math.round(-centre!.originZ/centre!.size*(field.resolution-1)))*field.resolution+Math.min(field.resolution-1,Math.round(-centre!.originX/centre!.size*(field.resolution-1)))]:0;
      // One detailed anchor for every LOD; the extra fine erosion at the
      // origin must not lower the regional world around the saved settlement.
      datum=context.patches.length?(erosion?erosion.height(0,0,true):atlasLandform(0,0,context.seed))-localHeight:0;
      elevationDatums.set(context,datum);
    }
    return globalHeight(x,z)-datum;
  };
  const patches = new Map(context.patches.map(p => [`${Math.floor((p.originX+context.width/2)/p.size)}:${Math.floor((p.originZ+context.depth/2)/p.size)}`, p]));
  const size = context.patches[0]?.size ?? 16;
  const local = (x: number,z: number) => {
    const p = patches.get(`${Math.floor((x+context.width/2)/size)}:${Math.floor((z+context.depth/2)/size)}`), field = p?.heightfield;
    if (!p || !field) return regional(x,z);
    const u = Math.max(0,Math.min(field.resolution-1,(x-p.originX)/p.size*(field.resolution-1)));
    const v = Math.max(0,Math.min(field.resolution-1,(z-p.originZ)/p.size*(field.resolution-1)));
    const ix = Math.min(field.resolution-2,Math.floor(u)), iz = Math.min(field.resolution-2,Math.floor(v));
    const stride=field.resolution, i=iz*stride+ix, tx=u-ix,tz=v-iz;
    return (field.heights[i]*(1-tx)+field.heights[i+1]*tx)*(1-tz)+(field.heights[i+stride]*(1-tx)+field.heights[i+stride+1]*tx)*tz;
  };
  return (x,z) => {
    if (!context.patches.length) return regional(x,z);
    const bx = Math.max(-context.width/2+.001,Math.min(context.width/2-.001,x));
    const bz = Math.max(-context.depth/2+.001,Math.min(context.depth/2-.001,z));
    const distance = Math.hypot(x-bx,z-bz);
    if (distance < .002) return local(bx,bz);
    // New worlds already share the same geological coordinates. No apron,
    // extrapolated local slopes or independent elevation datum is necessary.
    if(context.site)return regional(x,z);
    const blend = smooth(distance/128);
    // Do not extrude a local road bank or river's one-metre derivative for
    // hundreds of metres: that created the straight walls in the screenshots.
    // Grow a low-pass footprint away from the exact persisted boundary.
    const radius=Math.min(32,distance*.5);let extension=0,weightSum=0;
    for(let iz=-1;iz<=1;iz++)for(let ix=-1;ix<=1;ix++){
      const weight=(ix===0?2:1)*(iz===0?2:1);
      const px=Math.max(-context.width/2+.001,Math.min(context.width/2-.001,bx+ix*radius));
      const pz=Math.max(-context.depth/2+.001,Math.min(context.depth/2-.001,bz+iz*radius));
      extension+=local(px,pz)*weight;weightSum+=weight;
    }
    extension/=weightSum;
    return extension*(1-blend)+regional(x,z)*blend;
  };
}
export function selectAtlasTiles(x: number,z: number,context: Pick<AtlasContext,"width"|"depth">): { roots: AtlasTile[]; desired: AtlasTile[] } {
  const rootLevel=10, rootSize=32*2**rootLevel, roots: AtlasTile[]=[], desired: AtlasTile[]=[];
  const visit = (tile: AtlasTile) => {
    const s=tileSize(tile), ax=tile.x*s, az=tile.z*s;
    const inside = ax>=-context.width/2 && az>=-context.depth/2 && ax+s<=context.width/2 && az+s<=context.depth/2;
    if (inside) return;
    const intersects = ax<context.width/2 && ax+s>-context.width/2 && az<context.depth/2 && az+s>-context.depth/2;
    const distance=Math.hypot(Math.max(ax-x,0,x-ax-s),Math.max(az-z,0,z-az-s));
    if (tile.level>0 && (distance<s*1.25 || intersects)) tileChildren(tile).forEach(visit); else desired.push(tile);
  };
  for(let dz=-2;dz<=2;dz++) for(let dx=-2;dx<=2;dx++) { const tile={x:Math.floor(x/rootSize)+dx,z:Math.floor(z/rootSize)+dz,level:rootLevel}; roots.push(tile); visit(tile); }
  return {roots,desired};
}
/** Height on the parent's rendered triangle, rather than bilinear sampling.
 * A new child starts exactly on this surface before gaining detail. */
export function parentTriangleHeight(x:number,z:number,child:AtlasTile,sample:(x:number,z:number)=>number):number {
  const step=tileSize(child)/8, ax=Math.floor(x/step)*step,az=Math.floor(z/step)*step,u=(x-ax)/step,v=(z-az)/step;
  const a=sample(ax,az),b=sample(ax+step,az),c=sample(ax,az+step);
  return u+v<=1?a+(b-a)*u+(c-a)*v:sample(ax+step,az+step)*(u+v-1)+b*(1-v)+c*(1-u);
}
/** Global candidate cells keep plant identities stable across tile boundaries
 * and LOD changes. Intermediate tiles use instanced crown projections. */
export function atlasVegetation(tile:AtlasTile,context:AtlasContext,sample=createAtlasSampler(context)):Float32Array {
  const size=tileSize(tile),spacing=(tile.level<=3?4.5:tile.level===4?6:8)*Math.max(1,2**(tile.level-5)),plants:number[]=[];
  if(context.site?.shared){const site=context.site;
    for(const p of worldForestCandidates(context.seed,tile.x*size+site.x,tile.z*size+site.z,size,2**Math.max(0,tile.level-3))){const x=p.x-site.x,z=p.z-site.z;
      if(Math.abs(x)<=context.width/2&&Math.abs(z)<=context.depth/2)continue;
      const y=sample(x,z),slope=Math.hypot(sample(x+1,z)-sample(x-1,z),sample(x,z+1)-sample(x,z-1))/2,c=sampleSharedClimate(context.seed,site.shared!,p.x,p.z,y+site.datum,0,slope);
      if(slope>.58||c.snow>.65||worldClearing(site.shared,p.x,p.z)>.05||p.priority>c.forest)continue;
      plants.push(x,y,z,p.rotation,p.scale,c.temperature<7?1:0);
    }return new Float32Array(plants);
  }
  for(let z=Math.floor(tile.z*size/spacing);z<Math.ceil((tile.z+1)*size/spacing);z++)for(let x=Math.floor(tile.x*size/spacing);x<Math.ceil((tile.x+1)*size/spacing);x++){
    const px=(x+atlasHash(x,z,context.seed+107))*spacing,pz=(z+atlasHash(x,z,context.seed+211))*spacing;
    if(px<tile.x*size||px>=(tile.x+1)*size||pz<tile.z*size||pz>=(tile.z+1)*size)continue;
    if(Math.abs(px)<=context.width/2+5&&Math.abs(pz)<=context.depth/2+5)continue;
    if(context.site?.shared){const y=sample(px,pz),slope=Math.hypot(sample(px+1,pz)-sample(px-1,pz),sample(px,pz+1)-sample(px,pz-1))/2,wx=px+context.site.x,wz=pz+context.site.z,c=sampleSharedClimate(context.seed,context.site.shared,wx,wz,y+context.site.datum,0,slope);if(slope>.75||c.snow>.65||worldClearing(context.site.shared,wx,wz)>.05||atlasHash(x,z,context.seed+311)>c.forest)continue;plants.push(px,y,pz,atlasHash(x,z,context.seed+421)*360,.8+atlasHash(x,z,context.seed+523)*.65,c.temperature<7?1:0);continue;}
    const climate=atlasClimate(px+(context.site?.x??0),pz+(context.site?.z??0),context.seed);
    const distance=Math.hypot(Math.max(0,Math.abs(px)-context.width/2),Math.max(0,Math.abs(pz)-context.depth/2));
    const localForest=context.site?.intent.forest??(context.patches.some(p=>p.biomeId==="forest")?.8:undefined);
    const regionalDensity=smooth((climate.moisture-.28)/.4);
    const woodland=localForest===undefined?regionalDensity:localForest*(1-smooth(distance/1600))+regionalDensity*smooth(distance/1600);
    const density=Math.min(.96,woodland*1.2)*(.72+atlasNoise(px/95,pz/95,context.seed+127)*.28);
    if(atlasHash(x,z,context.seed+311)>density)continue;
    const y=sample(px,pz),slope=Math.hypot(sample(px+1,pz)-sample(px-1,pz),sample(px,pz+1)-sample(px,pz-1))/2;
    if(atlasAltitude(context,y)>550+climate.temperature*180||slope>.75)continue;
    const localStyle=context.patches.find(p=>p.biomeId==="forest");
    plants.push(px,y,pz,atlasHash(x,z,context.seed+421)*360,.8+atlasHash(x,z,context.seed+523)*.65,localStyle&&distance<800?0:climate.temperature<.45||atlasAltitude(context,y)>500?1:0);
  }
  return new Float32Array(plants);
}
export function atlasGroundCover(tile:AtlasTile,context:AtlasContext,sample=createAtlasSampler(context)):Float32Array {
  if(tile.level!==0)return new Float32Array();
  const s=tileSize(tile),result:number[]=[];
  for(const p of denseGroundCoverPoints(tile.x*s,tile.z*s,s,.46,context.seed+1237,()=>.92)){
    if(Math.abs(p.x)<=context.width/2 && Math.abs(p.z)<=context.depth/2)continue;
    const y=sample(p.x,p.z),slope=Math.hypot(sample(p.x+.5,p.z)-sample(p.x-.5,p.z),sample(p.x,p.z+.5)-sample(p.x,p.z-.5));
    if(slope>.62)continue;
    const weights=atlasSurface(context,p.x,p.z,y,1/Math.sqrt(1+slope*slope));
    if(weights[0]>.55||weights[1]<.15||weights[2]>.3||weights[3]>.02)continue;
    result.push(p.x,y-.035,p.z,scatterVariation(p.x,p.z,context.seed,1)*Math.PI*2,.72+scatterVariation(p.x,p.z,context.seed,2)*.26);
  }
  return new Float32Array(result);
}
export interface AtlasMesh { tile: AtlasTile; positions: Float32Array; parentHeights: Float32Array; vegetation:Float32Array; grass:Float32Array; normals: Float32Array; colors: Uint8Array; indices: Uint16Array }
export function buildAtlasMesh(tile: AtlasTile, context: AtlasContext, sample=createAtlasSampler(context),stitchLevels?:number[],sampleForLevel: (level:number)=>(x:number,z:number)=>number=()=>sample): AtlasMesh {
  let patches=patchSamplers.get(context);if(!patches){patches=createTerrainPatchSampler(context.patches);patchSamplers.set(context,patches);}
  const resolution=16, size=tileSize(tile), step=size/resolution, positions:number[]=[],normals:number[]=[],colors:number[]=[],indices:number[]=[];
  for(let z=0;z<=resolution;z++) for(let x=0;x<=resolution;x++) {
    const wx=tile.x*size+x*step,wz=tile.z*size+z*step;
    const neighbourLevel=stitchLevels?.[z*17+x] ?? tile.level;
    const y=neighbourLevel>tile.level ? atlasTriangleSample(wx,wz,tileSize({level:neighbourLevel,x:0,z:0})/16,sampleForLevel(neighbourLevel)) : sample(wx,wz);
    const e=2,nx=sample(wx-e,wz)-sample(wx+e,wz),nz=sample(wx,wz-e)-sample(wx,wz+e),length=Math.hypot(nx,2*e,nz);
    const distance=Math.hypot(Math.max(0,Math.abs(wx)-context.width/2),Math.max(0,Math.abs(wz)-context.depth/2)),mix=context.patches.length?1-smooth(distance/16):0;
    const pn=mix?patches.normal(wx,wz):{x:0,y:1,z:0};
    let normalX=nx/length*(1-mix)+pn.x*mix,up=2*e/length*(1-mix)+pn.y*mix,normalZ=nz/length*(1-mix)+pn.z*mix;
    const normalLength=Math.hypot(normalX,up,normalZ);normalX/=normalLength;up/=normalLength;normalZ/=normalLength;
    positions.push(x*step-size/2,y,z*step-size/2); normals.push(normalX,up,normalZ);
    colors.push(...atlasSurface(context,wx,wz,y,up).map(weight=>Math.round(weight*255)));
    if(x<resolution&&z<resolution) {const a=z*(resolution+1)+x,b=a+resolution+1; indices.push(a,b,a+1,a+1,b,b+1);}
  }
  // Skirts cover differing neighbour tessellation without opening cracks.
  const edges=[Array.from({length:17},(_,i)=>i),Array.from({length:17},(_,i)=>i*17+16),Array.from({length:17},(_,i)=>288-i),Array.from({length:17},(_,i)=>(16-i)*17)];
  for(const edge of edges) {const start=positions.length/3; for(const i of edge) {positions.push(positions[i*3],positions[i*3+1]-Math.max(3,step*.8),positions[i*3+2]);normals.push(0,1,0);colors.push(...colors.slice(i*4,i*4+4));} for(let i=0;i<16;i++) indices.push(edge[i],start+i,edge[i+1],edge[i+1],start+i,start+i+1);}
  const parentHeights=new Float32Array(positions.length/3);
  for(let i=0;i<parentHeights.length;i++) {
    const x=positions[i*3]+(tile.x+.5)*size,z=positions[i*3+2]+(tile.z+.5)*size;
    parentHeights[i]=parentTriangleHeight(x,z,tile,sample)-(i>=289?Math.max(3,step*.8):0);
    // Authored patch edges never morph away from their persisted heightfield.
    if(Math.abs(x)<=context.width/2+.01 && Math.abs(z)<=context.depth/2+.01)parentHeights[i]=positions[i*3+1];
  }
  // Instance roots must sit on the triangles that are actually displayed,
  // including stitched edge bands, rather than on an unrendered fine field.
  const rendered=(x:number,z:number)=>{
    const u=Math.max(0,Math.min(16,(x-tile.x*size)/step)),v=Math.max(0,Math.min(16,(z-tile.z*size)/step));
    const ix=Math.min(15,Math.floor(u)),iz=Math.min(15,Math.floor(v)),fx=u-ix,fz=v-iz,i=iz*17+ix;
    const a=positions[i*3+1],b=positions[(i+1)*3+1],c=positions[(i+17)*3+1],d=positions[(i+18)*3+1];
    return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d*(fx+fz-1)+b*(1-fz)+c*(1-fx);
  };
  return {tile,positions:new Float32Array(positions),parentHeights,vegetation:atlasVegetation(tile,context,rendered),grass:atlasGroundCover(tile,context,rendered),normals:new Float32Array(normals),colors:new Uint8Array(colors),indices:new Uint16Array(indices)};
}

/** LOD edge vertices lie on the neighbouring coarse triangles, closing cracks
 * instead of exposing deep shadow-casting curtains between terrain tiles. */
export function atlasTriangleSample(x:number,z:number,step:number,sample:(x:number,z:number)=>number):number {
  const ax=Math.floor(x/step)*step,az=Math.floor(z/step)*step,u=(x-ax)/step,v=(z-az)/step;
  const a=sample(ax,az),b=sample(ax+step,az),c=sample(ax,az+step);
  return u+v<=1?a+(b-a)*u+(c-a)*v:sample(ax+step,az+step)*(u+v-1)+b*(1-v)+c*(1-u);
}
const stitchLookups=new WeakMap<AtlasTile[],Map<string,number>>();
export function atlasStitchLevels(tile:AtlasTile,leaves:AtlasTile[]):number[] {
  const size=tileSize(tile),levels=new Array<number>(289).fill(tile.level);
  let lookup=stitchLookups.get(leaves);if(!lookup){lookup=new Map(leaves.map(leaf=>[tileKey(leaf),leaf.level]));stitchLookups.set(leaves,lookup);}
  const at=(x:number,z:number)=>{for(let level=tile.level+1;level<=10;level++){const s=32*2**level;if(lookup.has(`${level}/${Math.floor(x/s)}/${Math.floor(z/s)}`))return level;}return tile.level;};
  for(let z=0;z<=16;z++)for(let x=0;x<=16;x++)if(x===0||z===0||x===16||z===16){
    const wx=tile.x*size+x*size/16,wz=tile.z*size+z*size/16;
    levels[z*17+x]=Math.max(at(wx-.001,wz-.001),at(wx+.001,wz-.001),at(wx-.001,wz+.001),at(wx+.001,wz+.001));
  }
  return levels;
}
