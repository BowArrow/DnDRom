import {tileSize,atlasAltitude,atlasClimate,type AtlasContext,type AtlasMesh} from "../domain/worldAtlas";
import type {UnrealScene} from "./unrealScene";

/** Small three-dimensional crown clusters, never LOD-sized opaque forest plates.
 * Each crown is independently checked against the rendered ground and treeline. */
export function nativeCanopyPlacements(mesh:AtlasMesh,flow:(x:number,z:number)=>number,context:AtlasContext) {
  const plants:Array<{x:number;y:number;z:number;pine:boolean;scale:number}>=[];
  if(mesh.tile.level<5)return plants;
  const size=tileSize(mesh.tile),cx=(mesh.tile.x+.5)*size,cz=(mesh.tile.z+.5)*size;
  const bed=(x:number,z:number)=>{
    const u=Math.max(0,Math.min(16,(x-cx+size/2)/size*16)),v=Math.max(0,Math.min(16,(z-cz+size/2)/size*16));
    const ix=Math.min(15,Math.floor(u)),iz=Math.min(15,Math.floor(v)),a=iz*17+ix,tx=u-ix,tz=v-iz;
    const h=(i:number)=>mesh.positions[i*3+1];return tx+tz<=1?h(a)+(h(a+1)-h(a))*tx+(h(a+17)-h(a))*tz:h(a+18)*(tx+tz-1)+h(a+1)*(1-tz)+h(a+17)*(1-tx);
  };
  for(let i=0;i<mesh.vegetation.length;i+=6){
    const x=mesh.vegetation[i],z=mesh.vegetation[i+2],scale=mesh.vegetation[i+4];
    const pine=mesh.vegetation[i+5]===1,radius=(pine?2.1:3.1)*scale,height=(pine?10:7)*scale;
    const y=bed(x,z),climate=atlasClimate(x+(context.site?.x??0),z+(context.site?.z??0),context.seed);
    const crownPoints=Array.from({length:6},(_,v)=>{const a=v*Math.PI/3;return {x:x+Math.cos(a)*radius,z:z+Math.sin(a)*radius};});
    if((!context.site?.shared&&atlasAltitude(context,y)>550+climate.temperature*180) || flow(x,z)>.22 || crownPoints.some(p=>Math.abs(p.x-cx)>size/2||Math.abs(p.z-cz)>size/2||flow(p.x,p.z)>.22||Math.abs(bed(p.x,p.z)-y)>radius*.75))continue;
    plants.push({x,y,z,pine,scale});
  }
  return plants;
}

export function nativeCanopyCrown(pine:boolean){
    const positions:number[]=[],normals:number[]=[],colors:number[]=[],uvs:number[]=[],indices:number[]=[];
    const lobe=(cx:number,cy:number,cz:number,radius:number,height:number,tint:number)=>{
      const start=positions.length/3;
      for(let v=0;v<8;v++){
        const a=(v-2)*Math.PI/3,rx=v<2?0:Math.cos(a),rz=v<2?0:Math.sin(a),ny=v===0?1:v===1?-1:.2;
        positions.push(cx+rx*radius,cy+height*(v===0?1:v===1?-.45:0),cz+rz*radius);
        const n=Math.hypot(rx,ny,rz);normals.push(rx/n,ny/n,rz/n);uvs.push(rx*.5+.5,rz*.5+.5);
        const shade=(v===1?.38:v===0?.94:.64)*tint;colors.push(Math.round(12*shade),Math.round(37*shade),Math.round(10*shade),255);
      }
      for(let v=0;v<6;v++){const a=start+2+v,b=start+2+(v+1)%6;indices.push(start,b,a,start+1,a,b);}
    };
    // Separate whorls/lobes retain a tree silhouette instead of a single rock-like crown.
    if(pine){lobe(0,3.8,0,2.1,3.1,.86);lobe(0,6,0,1.55,2.9,.94);lobe(0,8,0,.9,2,1);}
    else {lobe(-1.3,4.1,0,1.8,1.8,.86);lobe(1.2,4.5,.3,1.9,1.8,.93);lobe(0,5.4,-.6,1.8,1.6,1);}
    return {positions,normals,colors,uvs,indices};
}

/** Merged form retained for standalone geometry/export consumers. Streaming
 * uses these same placements with shared instanced crown meshes. */
export function nativeAtlasCanopy(mesh:AtlasMesh,flow:(x:number,z:number)=>number,context:AtlasContext):UnrealScene["meshes"][number]|undefined {
  const size=tileSize(mesh.tile),cx=(mesh.tile.x+.5)*size,cz=(mesh.tile.z+.5)*size;
  const positions:number[]=[],normals:number[]=[],colors:number[]=[],uvs:number[]=[],indices:number[]=[];
  for(const p of nativeCanopyPlacements(mesh,flow,context)){
    const crown=nativeCanopyCrown(p.pine),base=positions.length/3;
    for(let i=0;i<crown.positions.length;i+=3)positions.push(p.x-cx+crown.positions[i]*p.scale,p.y+crown.positions[i+1]*p.scale,p.z-cz+crown.positions[i+2]*p.scale);
    normals.push(...crown.normals);colors.push(...crown.colors);uvs.push(...crown.uvs);indices.push(...crown.indices.map(i=>i+base));
  }
  if(!indices.length)return;
  return {id:`canopy-${mesh.tile.level}/${mesh.tile.x}/${mesh.tile.z}`,material:"forest-crown",collision:false,castShadow:false,lods:[{positions,normals,colors,uvs,indices}]};
}
