import {tileSize,tileKey,type AtlasMesh,type AtlasContext} from '../domain/worldAtlas';
import {distance} from '../domain/sharedWorld';
import type {UnrealScene} from './unrealScene';

/** Narrow roads need explicit coverage once the terrain grid exceeds their
 * width. Their centreline and width still come from the accepted roadbed. */
export function nativeWorldRoads(mesh:AtlasMesh,context:AtlasContext):UnrealScene['meshes'][number]|undefined{
 const m=context.sharedWorld,site=context.site;if(!m||!site)return;
 const size=tileSize(mesh.tile),ox=mesh.tile.x*size,oz=mesh.tile.z*size,positions:number[]=[],normals:number[]=[],uvs:number[]=[],colors:number[]=[],biomeUVs:number[]=[],indices:number[]=[];
 const height=(x:number,z:number)=>{const u=Math.max(0,Math.min(16,(x-ox)/size*16)),v=Math.max(0,Math.min(16,(z-oz)/size*16)),ix=Math.min(15,Math.floor(u)),iz=Math.min(15,Math.floor(v)),a=iz*17+ix,tx=u-ix,tz=v-iz,h=(i:number)=>mesh.positions[i*3+1];return tx+tz<=1?h(a)+(h(a+1)-h(a))*tx+(h(a+17)-h(a))*tz:h(a+18)*(tx+tz-1)+h(a+1)*(1-tz)+h(a+17)*(1-tx);};
 for(const r of [...m.transport,...m.locations.flatMap(l=>l.settlement.streets)])if(r.mode==='road')for(let i=1;i<r.points.length;i++){
  const start=r.points[i-1],end=r.points[i];if(r.bridges.some(b=>distance(b.start,start)<.1&&distance(b.end,end)<.1))continue;
  const ax=start.x-site.x,az=start.z-site.z,dx=end.x-start.x,dz=end.z-start.z,len=Math.hypot(dx,dz);if(len<.001)continue;
  let lo=0,hi=1;for(const[p,q]of [[-dx,ax-ox],[dx,ox+size-ax],[-dz,az-oz],[dz,oz+size-az]]){if(Math.abs(p)<1e-9){if(q<0){hi=-1;break;}}else if(p<0)lo=Math.max(lo,q/p);else hi=Math.min(hi,q/p);}if(lo>=hi)continue;
  const count=Math.max(1,Math.ceil((hi-lo)*len/8)),nx=-dz/len*r.width/2,nz=dx/len*r.width/2;
  for(let j=0;j<count;j++){const a=lo+(hi-lo)*j/count,b=lo+(hi-lo)*(j+1)/count,x0=ax+dx*a,z0=az+dz*a,x1=ax+dx*b,z1=az+dz*b;
   if(Math.abs((x0+x1)/2)<context.width/2&&Math.abs((z0+z1)/2)<context.depth/2)continue;
   const y0=height(x0,z0)+.06,y1=height(x1,z1)+.06,base=positions.length/3;
   for(const[x,y,z]of [[x0+nx,y0,z0+nz],[x0-nx,y0,z0-nz],[x1+nx,y1,z1+nz],[x1-nx,y1,z1-nz]]){positions.push(x-ox-size/2,y,z-oz-size/2);normals.push(0,1,0);uvs.push((x+site.x)/7.5,(z+site.z)/7.5);biomeUVs.push(1,(y+site.datum)/7.5);colors.push(0,0,255,255);}
   indices.push(base,base+2,base+1,base+1,base+2,base+3);
  }
 }
 return indices.length?{id:`roads-${tileKey(mesh.tile)}`,material:'terrain',collision:false,castShadow:false,lods:[{positions,normals,uvs,biomeUVs,colors,indices}]}:undefined;
}
