import { atlasForestCoverage, atlasAltitude, atlasClimate, atlasSurface, tileSize, tileKey, type AtlasContext, type AtlasMesh } from "../domain/worldAtlas";
import { terrainSurfaceWeights } from "../domain/worldProcedural";
import type { UnrealScene } from "./unrealScene";
import {siteSurface} from "../domain/worldSite";
import {sampleSharedClimate} from '../domain/worldClimate';

/** Shared by the worker and native visual regression fixtures. Skirts cover
 * transient LOD gaps but cannot cast rectangular shadows onto adjacent tiles. */
export function nativeAtlasTerrain(mesh:AtlasMesh,context:AtlasContext):UnrealScene {
  const tile=mesh.tile,size=tileSize(tile),id=tileKey(tile),origin={x:(tile.x+.5)*size,y:0,z:(tile.z+.5)*size};
  const colors:number[]=[],uvs:number[]=[],biomeUVs:number[]=[];
  for(let i=0;i<mesh.positions.length/3;i++) {
    const x=mesh.positions[i*3]+origin.x,y=mesh.positions[i*3+1],z=mesh.positions[i*3+2]+origin.z,up=mesh.normals[i*3+1];
    if(context.site?.shared){const site=context.site,c=sampleSharedClimate(context.seed,site.shared!,x+site.x,z+site.z,y+site.datum);biomeUVs.push(1+c.aridity,(y+site.datum)/7.5);}
    const [rock,,,road]=atlasSurface(context,x,z,y,up),climate=atlasClimate(x,z,context.seed);
    const patch=context.patches.find(p=>x>=p.originX&&x<=p.originX+p.size&&z>=p.originZ&&z<=p.originZ+p.size);
    const near=patch?terrainSurfaceWeights(patch,x,z,up):null;
    const snow=context.site?siteSurface(context.site,context.seed,x,z,y,up).snow:near?.snow??Math.max(0,Math.min(1,(atlasAltitude(context,y)-630-climate.temperature*220)/180))*Math.max(0,Math.min(1,(up-.45)/.35));
    colors.push(Math.round((near?.rock??rock)*255),Math.round(snow*255),Math.round((near?.road??road)*255),Math.round((1-atlasForestCoverage(context,x,z,y,up))*255));uvs.push((x+(context.site?.shared?context.site.x:0))/7.5,(z+(context.site?.shared?context.site.z:0))/7.5);
  }
  const surface:number[]=[],skirt:number[]=[];
  for(let i=0;i<mesh.indices.length;i+=3){
    const tri=Array.from(mesh.indices.slice(i,i+3));
    if(tri.every(v=>Math.abs(mesh.positions[v*3]+origin.x)<context.width/2-.001&&Math.abs(mesh.positions[v*3+2]+origin.z)<context.depth/2-.001))continue;
    (tri.some(v=>v>=289)?skirt:surface).push(...tri);
  }
  const geometry={positions:Array.from(mesh.positions),normals:Array.from(mesh.normals),colors,uvs,...(biomeUVs.length?{biomeUVs}:{})};
  return {format:"dndrom.scene",version:1,coordinates:"right-handed-y-up-metres",name:id,source:{},warnings:[],
    meshes:[{id,material:"terrain",collision:tile.level<=1,lods:[{...geometry,indices:surface}]},{id:`${id}-skirt`,material:"terrain",collision:false,castShadow:false,lods:[{...geometry,indices:skirt}]}],
    instances:[id,`${id}-skirt`].map(meshId=>({entityId:`world:${id}`,meshId,position:origin,rotation:[0,0,0,1],scale:{x:1,y:1,z:1}}))} as unknown as UnrealScene;
}
