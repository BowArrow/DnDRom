import * as pc from "playcanvas";
import type { ScenePart } from "../domain/sceneGrammar";
import type { WorldBuildingGeometry, WorldMaterialRole } from "../domain/types";

export interface AssemblyBuffers { positions: number[]; normals: number[]; uvs: number[]; colors: number[]; indices: number[]; biomeUVs?:number[] }

function roofGeometry(curve: number, segments: number,hip=false): { positions: number[]; normals: number[]; uvs: number[]; indices: number[] } {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  if(hip){
    // Four roof slopes share an inset ridge; normalized coordinates preserve
    // the exact building silhouette through all detail levels.
    const corners=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]],ridge=[[-.25,0],[.25,0],[.25,0],[-.25,0]];
    const bands=Math.abs(curve)>.001?segments:1;
    const at=(i:number,t:number)=>[ridge[i][0]*(1-t)+corners[i][0]*t,.5-t+curve*t*t*t,ridge[i][1]*(1-t)+corners[i][1]*t];
    const triangle=(a:number[],b:number[],c:number[])=>{
      const ab=new pc.Vec3(b[0]-a[0],b[1]-a[1],b[2]-a[2]),ac=new pc.Vec3(c[0]-a[0],c[1]-a[1],c[2]-a[2]);
      if(new pc.Vec3().cross(ab,ac).lengthSq()<1e-12)return;
      const base=positions.length/3;for(const p of [a,b,c]){positions.push(...p);uvs.push(p[0]+.5,p[2]+.5);}indices.push(base,base+1,base+2);
    };
    for(let face=0;face<4;face++)for(let j=0;j<bands;j++){
      const next=(face+1)%4,a=at(face,j/bands),b=at(next,j/bands),c=at(face,(j+1)/bands),d=at(next,(j+1)/bands);
      triangle(a,b,c);triangle(b,d,c);
    }
    return {positions,normals:pc.calculateNormals(positions,indices),uvs,indices};
  }
  for (let i = 0; i <= segments; i++) {
    const z = i / segments - .5, distance = Math.abs(z) * 2;
    const y = .5 - distance + curve * distance ** 3;
    positions.push(-.5, y, z, .5, y, z); uvs.push(0, i / segments, 1, i / segments);
    if (i < segments) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  return { positions, normals: pc.calculateNormals(positions, indices), uvs, indices };
}

/** Intersect each wall plane with the actual roof triangles. This keeps the
 * gable and curved hip infill flush with precisely the roof used at this LOD. */
export function roofWallGeometry(part:ScenePart,lod=0){
  const roof=roofGeometry(part.curve??0,lod===2?6:lod===1?8:12,part.roofProfile==='hip'),span=part.roofSpan??{x:part.size.x+1,z:part.size.z+1};
  const positions:number[]=[],indices:number[]=[],uvs:number[]=[];
  const triangle=(a:number[],b:number[],c:number[])=>{const n=new pc.Vec3().cross(new pc.Vec3(b[0]-a[0],b[1]-a[1],b[2]-a[2]),new pc.Vec3(c[0]-a[0],c[1]-a[1],c[2]-a[2]));if(n.lengthSq()<1e-14)return;const base=positions.length/3;for(const p of [a,b,c]){positions.push(...p);uvs.push(p[0]+p[2],p[1]);}indices.push(base,base+1,base+2);};
  for(const axis of [0,2])for(const side of [-1,1])for(const inset of [-.11,.11]){
    const extent=axis===0?part.size.x:part.size.z,other=axis===0?part.size.z:part.size.x,roofExtent=axis===0?span.x:span.z,roofOther=axis===0?span.z:span.x;
    const plane=side*(extent/2+inset)/roofExtent,along=axis===0?2:0,limit=(other/2+inset)/roofOther;
    for(let i=0;i<roof.indices.length;i+=3){
      const v=roof.indices.slice(i,i+3).map(index=>roof.positions.slice(index*3,index*3+3)),crossings:number[][]=[];
      for(let e=0;e<3;e++){const a=v[e],b=v[(e+1)%3],da=a[axis]-plane,db=b[axis]-plane;
        if(Math.abs(da)<1e-9)crossings.push([...a]);
        if(da*db<0){const t=da/(da-db);crossings.push(a.map((n,j)=>n+(b[j]-n)*t));}
      }
      const unique=crossings.filter((p,j)=>!crossings.slice(0,j).some(q=>Math.hypot(...p.map((n,k)=>n-q[k]))<1e-8));if(unique.length!==2)continue;
      let [a,b]=unique.sort((p,q)=>p[along]-q[along]);if(b[along]<=-limit||a[along]>=limit||b[along]-a[along]<1e-8)continue;
      const start=[...a],end=[...b],point=(t:number)=>start.map((n,j)=>n+(end[j]-n)*t);
      if(a[along]<-limit)a=point((-limit-start[along])/(end[along]-start[along]));if(b[along]>limit)b=point((limit-start[along])/(end[along]-start[along]));
      const normalize=(p:number[])=>[p[0]*span.x/part.size.x,p[1],p[2]*span.z/part.size.z];
      const ta=normalize(a),tb=normalize(b),ba=[ta[0],-.5,ta[2]],bb=[tb[0],-.5,tb[2]];
      const reverse=(axis===0?-side:side)*(inset>0?1:-1)>0;
      if(reverse){triangle(ba,tb,ta);triangle(ba,bb,tb);}else{triangle(ba,ta,tb);triangle(ba,tb,bb);}
    }
  }
  return {positions,indices,uvs,normals:pc.calculateNormals(positions,indices)};
}

export function openingParts(p:ScenePart):ScenePart[]{
  const parts:ScenePart[]=[],w=p.size.x,h=p.size.y,a=p.rotation.y*Math.PI/180;
  const box=(x:number,y:number,z:number,sx:number,sy:number,sz:number,color=p.color,yaw=0)=>parts.push({shape:'box',position:{x:p.position.x+x*Math.cos(a)+z*Math.sin(a),y:p.position.y+y,z:p.position.z-x*Math.sin(a)+z*Math.cos(a)},size:{x:sx,y:sy,z:sz},rotation:{x:0,y:p.rotation.y+yaw,z:0},material:'timber',color,settlementSurface:p.settlementSurface});
  for(const side of [-1,1])box(side*(w/2+.045),0,-.09,.09,h+.16,.3);
  box(0,h/2+.045,-.09,w+.18,.09,.3);
  if(p.shape==='window-frame'){
    box(0,-h/2-.065,-.18,w+.3,.13,.48);
    box(0,0,-.02,.055,h,.13);box(0,0,-.02,w,.055,.13);
    // Shutters are held against the facade so they don't fill the opening.
    for(const side of [-1,1]){box(side*w*.79,0,-.25,w*.48,h,.08,'#664733',side*18);box(side*w*.79,-h*.25,-.31,w*.42,.07,.04,'#b09872',side*18);}
  }else{
    // Open leaf: the hinge is on the left jamb, leaving the walkable opening clear.
    box(-w/2-.015,0,-w/2-.12,w,h-.08,.09,'#694930',90);
    for(const side of [-1,1])box(-w/2-.075,side*h*.3,-w/2-.12,w*.9,.095,.035,'#302d29',90);
    box(-w/2-.09,-.08,-w*.83,.08,.18,.08,'#302d29');
  }
  return parts;
}

/** Merge by surface role: a 100-part structure costs at most five draws. */
export function buildAssemblyMeshes(parts: ScenePart[], lod = 0): Map<WorldMaterialRole, AssemblyBuffers> {
  const output = new Map<WorldMaterialRole, AssemblyBuffers>();
  for (const part of parts.flatMap(p=>p.shape==='window-frame'||p.shape==='doorway'?openingParts(p):[p])) {
    let buffers = output.get(part.material);
    if (!buffers) { buffers = { positions: [], normals: [], uvs: [], colors: [], indices: [] }; output.set(part.material, buffers); }
    const segments = lod === 2 ? 6 : lod === 1 ? 8 : 12;
    const geometry = part.shape === "roof-wall" ? roofWallGeometry(part,lod) : part.shape === "roof" ? roofGeometry(part.curve ?? 0, segments,part.roofProfile==='hip')
      : part.shape === "sphere" ? new pc.SphereGeometry({ latitudeBands: segments, longitudeBands: segments })
      : part.shape === "cylinder" ? new pc.CylinderGeometry({ capSegments: segments, heightSegments: 1 })
      : part.shape === "cone" ? new pc.ConeGeometry({ capSegments: segments, heightSegments: 1 }) : new pc.BoxGeometry();
    const rotation = new pc.Quat().setFromEulerAngles(part.rotation.x, part.rotation.y, part.rotation.z);
    const transform = new pc.Mat4().setTRS(new pc.Vec3(part.position.x, part.position.y, part.position.z), rotation, new pc.Vec3(part.size.x, part.size.y, part.size.z));
    const color = new pc.Color().fromString(part.color), base = buffers.positions.length / 3;
    const positions = geometry.positions!, normals = geometry.normals!;
    for (let i = 0; i < positions.length; i += 3) {
      const point = transform.transformPoint(new pc.Vec3(positions[i], positions[i + 1], positions[i + 2]));
      const normal = rotation.transformVector(new pc.Vec3(normals[i] / part.size.x, normals[i + 1] / part.size.y, normals[i + 2] / part.size.z)).normalize();
      buffers.positions.push(point.x, point.y, point.z); buffers.normals.push(normal.x, normal.y, normal.z);
      // World-unit projections on each face keep both roof tiles and beams scaled.
      const nx = Math.abs(normals[i]), ny = Math.abs(normals[i + 1]);
      const surface=part.settlementSurface;
      if(surface){
        // House-local projections share phase across split wall panels and gable infill.
        const local=rotation.clone().invert().transformVector(point);
        buffers.uvs.push(ny>.6?local.x:nx>.6?local.z:local.x,ny>.6?local.z:local.y);
        (buffers.biomeUVs??=[]).push(point.y,surface.seed+surface.moisture*.49);
      }else buffers.uvs.push(ny > .6 ? positions[i] * part.size.x : nx > .6 ? positions[i + 2] * part.size.z : positions[i] * part.size.x, ny > .6 ? positions[i + 2] * part.size.z : positions[i + 1] * part.size.y);
      buffers.colors.push(...[color.r, color.g, color.b].map((channel) => Math.round(channel ** 2.2 * 255)), surface?Math.round(surface.age*255):255);
    }
    buffers.indices.push(...geometry.indices!.map((index) => base + index));
  }
  return output;
}

export function buildingAssemblyParts(building: WorldBuildingGeometry): ScenePart[] {
  const parts: ScenePart[] = [];
  const box = (position: ScenePart["position"], size: ScenePart["size"], yaw: number, material: WorldMaterialRole, color: string) => parts.push({ shape: "box", position, size, rotation: { x: 0, y: yaw, z: 0 }, material, color });
  const minX = Math.min(...building.footprint.map((p) => p.x)), maxX = Math.max(...building.footprint.map((p) => p.x)), minZ = Math.min(...building.footprint.map((p) => p.z)), maxZ = Math.max(...building.footprint.map((p) => p.z));
  box({ x: 0, y: .05, z: 0 }, { x: maxX - minX + .3, y: .5, z: maxZ - minZ + .3 }, 0, "masonry", building.palette.foundation);
  for (const tile of building.facadeTiles) {
    const integrity = tile.integrity ?? 1;
    if (integrity < .08) continue;
    const a = building.footprint[tile.edge], b = building.footprint[(tile.edge + 1) % building.footprint.length], length = Math.hypot(b.x - a.x, b.z - a.z);
    const dx = (b.x - a.x) / length, dz = (b.z - a.z) / length, yaw = -Math.atan2(dz, dx) * 180 / Math.PI;
    const x = a.x + dx * tile.offset, z = a.z + dz * tile.offset, base = .3 + tile.floor * building.floorHeight, height = building.floorHeight * integrity;
    const opening = tile.kind !== "wall" && integrity > .95;
    if (!opening) box({ x, y: base + height / 2, z }, { x: tile.width, y: height, z: building.wallThickness }, yaw, "masonry", building.palette.wall);
    else {
      const openingHeight = tile.kind === "door" ? 2.1 : height * .5, sill = tile.kind === "door" ? 0 : height * .25, jamb = tile.width * .2;
      for (const side of [-1, 1]) box({ x: x + dx * side * (tile.width - jamb) / 2, y: base + height / 2, z: z + dz * side * (tile.width - jamb) / 2 }, { x: jamb, y: height, z: building.wallThickness }, yaw, "masonry", building.palette.wall);
      const lintelHeight = Math.max(.1, height - openingHeight - sill);
      box({ x, y: base + height - lintelHeight / 2, z }, { x: tile.width, y: lintelHeight, z: building.wallThickness }, yaw, "masonry", building.palette.wall);
      if (sill) box({ x, y: base + sill / 2, z }, { x: tile.width, y: sill, z: building.wallThickness }, yaw, "masonry", building.palette.wall);
    }
    box({ x: x - dx * tile.width / 2, y: base + height / 2, z: z - dz * tile.width / 2 }, { x: .12, y: height, z: building.wallThickness + .08 }, yaw, "timber", building.palette.trim);
    box({ x, y: base + height - .08, z }, { x: tile.width, y: .16, z: building.wallThickness + .09 }, yaw, "timber", building.palette.trim);
  }
  const top = .3 + building.floors * building.floorHeight;
  if (building.roof === "ruined") for (let i = 0; i < 12; i++) {
    const noise = Math.sin((building.ruinSeed ?? 1) + i * 127.1) * 43758.5453, r = noise - Math.floor(noise);
    box({ x: minX + .3 + r * (maxX - minX - .6), y: .5 + r * .3, z: minZ + .3 + ((r * 7.13) % 1) * (maxZ - minZ - .6) }, { x: i % 3 ? .5 + r : 2.8, y: .25 + r * .25, z: .3 + r * .25 }, i * 137, i % 3 ? "masonry" : "timber", i % 3 ? building.palette.wall : building.palette.trim);
  } else parts.push({ shape: building.roof === "flat" ? "box" : "roof", position: { x: 0, y: top + .65, z: 0 }, size: { x: maxX - minX + .7, y: building.roof === "flat" ? .25 : 1.3, z: maxZ - minZ + .7 }, rotation: { x: 0, y: 0, z: 0 }, material: "roof", color: building.palette.roof, curve: .1 });
  return parts;
}
