import {tileSize,type AtlasMesh} from "../domain/worldAtlas";
import type {UnrealScene} from "./unrealScene";
import {shoreDistanceField} from "./nativeShore";
import {nativeWaterField,type NativeWaterField} from "./nativeWaterField";

/** Contour the simulated discharge, using the displayed ground triangles as
 * the bed. No independent random river splines or floating water planes. */
export interface AuthoredWaterBoundary {width:number;depth:number;shore:(x:number,z:number)=>number;waterDepth:(x:number,z:number)=>number;surface:(x:number,z:number)=>number|undefined}
export function nativeAtlasWater(mesh:AtlasMesh,flow:(x:number,z:number)=>number,seaLevel=Number.NEGATIVE_INFINITY,authored?:AuthoredWaterBoundary):(UnrealScene["meshes"][number]&{waterField?:NativeWaterField})|undefined {
  const size=tileSize(mesh.tile),originX=mesh.tile.x*size,originZ=mesh.tile.z*size,step=size/16;
  const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[],colors:number[]=[];
  // Match the near terrain grid before reducing the watershed representation.
  // A fixed 16 m minimum dropped narrow streams immediately outside town.
  const waterStep=Math.max(2,size/(mesh.tile.level<=5?64:32)),resolution=Math.round(size/waterStep);
  if(resolution<1)return;
  const bed=(x:number,z:number)=>{
    const u=Math.min(16,Math.max(0,x/step)),v=Math.min(16,Math.max(0,z/step)),ix=Math.min(15,Math.floor(u)),iz=Math.min(15,Math.floor(v)),fx=u-ix,fz=v-iz,i=iz*17+ix;
    const a=mesh.positions[i*3+1],b=mesh.positions[(i+1)*3+1],c=mesh.positions[(i+17)*3+1],d=mesh.positions[(i+18)*3+1];
    return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d*(fx+fz-1)+b*(1-fz)+c*(1-fx);
  };
  const coastal=Number.isFinite(seaLevel)&&mesh.tile.level<=4;
  type Point={x:number;z:number;wet:number};
  const points=Array.from({length:(resolution+1)**2},(_,i)=>{const x=i%(resolution+1)*waterStep,z=Math.floor(i/(resolution+1))*waterStep;return {x,z,wet:flow(originX+x,originZ+z)-.35};});
  // Surf only needs a bounded coastal neighborhood. Avoid sampling a second
  // huge watershed for horizon tiles, where breakers are subpixel.
  const regionalShore=mesh.tile.level<=4&&points.some(p=>p.wet>0)?shoreDistanceField(originX,originZ,size,Math.max(2,waterStep), (x,z)=>flow(x,z)-.35):()=>24;
  const edgeMix=(x:number,z:number)=>{if(!authored)return 0;const d=Math.hypot(Math.max(0,Math.abs(x)-authored.width/2),Math.max(0,Math.abs(z)-authored.depth/2)),t=Math.min(1,d/24);return 1-t*t*(3-2*t);};
  const shore=(x:number,z:number)=>{const mix=edgeMix(x,z);return regionalShore(x,z)*(1-mix)+(mix?authored!.shore(x,z)*mix:0);};
  const surfaceLocal=(x:number,z:number,wet:number)=>{const h=bed(x,z),regional=h<seaLevel||wet<=0?seaLevel:h+.12+Math.min(1,wet)*.2,mix=edgeMix(originX+x,originZ+z);return mix?regional*(1-mix)+(authored!.surface(originX+x,originZ+z)??regional)*mix:regional;};
  const physicalDepth=(x:number,z:number,wet:number)=>{
    const regional=Math.min(surfaceLocal(x,z,wet)-bed(x,z),wet>0?32:-Math.max(.025,shore(originX+x,originZ+z)*.12)),mix=edgeMix(originX+x,originZ+z);
    // Depth must describe this displayed bed. Extending an edge's positive
    // depth onto a sloping seabed makes the wet-ground shader reveal a box.
    // Carry only deliberate dry exclusions across the ownership boundary.
    const authoredDepth=mix?authored!.waterDepth(originX+x,originZ+z):regional;
    return authoredDepth<0?regional*(1-mix)+Math.min(regional,authoredDepth)*mix:regional;
  };
  const vertices=new Map<string,number>();
  const emit=(tri:Point[])=>{
    const polygon:Point[]=[];
    for(let i=0;i<3;i++){
      const a=tri[i],b=tri[(i+1)%3];
      const da=coastal&&bed(a.x,a.z)<seaLevel+1?physicalDepth(a.x,a.z,a.wet)+.45:a.wet;
      const db=coastal&&bed(b.x,b.z)<seaLevel+1?physicalDepth(b.x,b.z,b.wet)+.45:b.wet;
      if(da>0)polygon.push(a);
      if((da>0)!==(db>0)){const t=da/(da-db);polygon.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,wet:a.wet+(b.wet-a.wet)*t});}
    }
    // A coarse ancestor may straddle the authored region. Give water the
    // same ownership hole as terrain, rather than drawing two surfaces.
    const clip=(input:Point[],axis:'x'|'z',boundary:number,keepLess:boolean)=>{
      const result:Point[]=[];for(let i=0;i<input.length;i++){const a=input[i],b=input[(i+1)%input.length],da=(a[axis]-boundary)*(keepLess?-1:1),db=(b[axis]-boundary)*(keepLess?-1:1);if(da>=0)result.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);result.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,wet:a.wet+(b.wet-a.wet)*t});}}return result;
    };
    let polygons=[polygon];
    if(authored){const lx=-authored.width/2-originX,hx=authored.width/2-originX,lz=-authored.depth/2-originZ,hz=authored.depth/2-originZ,mid=clip(clip(polygon,'x',lx,false),'x',hx,true);polygons=[clip(polygon,'x',lx,true),clip(polygon,'x',hx,false),clip(mid,'z',lz,true),clip(mid,'z',hz,false)];}
    for(const part of polygons){const ids=part.map(p=>{
      const key=`${p.x.toFixed(7)}:${p.z.toFixed(7)}`,existing=vertices.get(key);if(existing!==undefined)return existing;
      const index=positions.length/3,height=bed(p.x,p.z);
      positions.push(p.x-size/2,coastal?surfaceLocal(p.x,p.z,p.wet):height<seaLevel?seaLevel:height+.12+Math.min(1,Math.max(0,p.wet))*.2,p.z-size/2);
      normals.push(0,1,0);uvs.push((originX+p.x)/8,(originZ+p.z)/8);
      colors.push(Math.round(Math.min(1,Math.max(0,height<seaLevel?seaLevel-height:p.wet*.32)/4)*255),Math.round(shore(originX+p.x,originZ+p.z)/24*255),255,255);
      vertices.set(key,index);return index;
    });
    for(let i=1;i<ids.length-1;i++)indices.push(ids[0],ids[i],ids[i+1]);
    }
  };
  for(let z=0;z<resolution;z++)for(let x=0;x<resolution;x++){
    const i=z*(resolution+1)+x,a=points[i],b=points[i+1],c=points[i+resolution+1],d=points[i+resolution+2];emit([a,c,b]);emit([b,c,d]);
  }
  if(!indices.length)return;
  const surface=(x:number,z:number)=>surfaceLocal(x-originX,z-originZ,flow(x,z)-.35);
  const field=coastal?nativeWaterField(originX,originZ,size,resolution,(x,z)=>physicalDepth(x-originX,z-originZ,flow(x,z)-.35),shore,surface):undefined;
  return {id:`water-${mesh.tile.level}/${mesh.tile.x}/${mesh.tile.z}`,material:"water",collision:false,castShadow:false,lods:[{positions,normals,uvs,indices,colors}],waterField:field};
}
