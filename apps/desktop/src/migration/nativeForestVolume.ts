import type {WorldTreeGeometry} from "../domain/types";
import {buildTreeBarkMesh} from "../rendering/treeBarkMesh";
import type {AssemblyBuffers} from "../rendering/sceneAssemblyMesh";

/** A real branched silhouette at middle distance. Every foliage lobe comes
 * from the same procedural branch graph as the detailed tree. No view planes. */
export function nativeForestVolume(tree:WorldTreeGeometry,lod=0):AssemblyBuffers {
  const linear=(hex:string)=>[1,3,5].map(i=>Math.round((parseInt(hex.slice(i,i+2),16)/255)**2.2*255));
  const out:AssemblyBuffers=lod===0?buildTreeBarkMesh(tree,2,[...linear(tree.barkColor),255]):{positions:[],normals:[],colors:[],uvs:[],indices:[]};
  if(lod>0){
    const threshold=lod===1?.12:.24,color=linear(tree.barkColor);
    for(const b of tree.branches){
      if(b.startRadius<threshold)continue;
      const dx=b.end.x-b.start.x,dy=b.end.y-b.start.y,dz=b.end.z-b.start.z,len=Math.hypot(dx,dy,dz);if(len<.001)continue;
      const nx=dx/len,ny=dy/len,nz=dz/len,slen=Math.hypot(nx,nz),sx=slen>.001?nz/slen:1,sz=slen>.001?-nx/slen:0;
      const fx=ny*sz,fy=nz*sx-nx*sz,fz=-ny*sx,base=out.positions.length/3;
      for(let ring=0;ring<2;ring++)for(let v=0;v<3;v++){
        const a=v*2*Math.PI/3,rx=sx*Math.cos(a)+fx*Math.sin(a),ry=fy*Math.sin(a),rz=sz*Math.cos(a)+fz*Math.sin(a),p=ring?b.end:b.start,r=ring?b.endRadius:b.startRadius;
        out.positions.push(p.x+rx*r,p.y+ry*r,p.z+rz*r);out.normals.push(rx,ry,rz);out.uvs.push(v/3,ring);out.colors.push(...color,255);
      }
      for(let v=0;v<3;v++){const a=base+v,bn=base+(v+1)%3;out.indices.push(a,bn,a+3,bn,bn+3,a+3);}
    }
  }
  let clusters=tree.leafClusters;
  if(lod>0){
    // Merge overlapping leaf volumes spatially; never thin away whole crown
    // sections. Their union bounds retain canopy coverage at small pixel size.
    const cell=lod===1?1.8:3.6,bins=new Map<string,typeof clusters>();
    for(const c of clusters){const key=[c.position.x,c.position.y,c.position.z].map(v=>Math.floor(v/cell)).join('/');if(!bins.has(key))bins.set(key,[]);bins.get(key)!.push(c);}
    clusters=[...bins.values()].map(group=>{
      const bounds=(axis:'x'|'y'|'z')=>[Math.min(...group.map(c=>c.position[axis]-c.radius[axis])),Math.max(...group.map(c=>c.position[axis]+c.radius[axis]))];
      const x=bounds('x'),y=bounds('y'),z=bounds('z');
      return {position:{x:(x[0]+x[1])/2,y:(y[0]+y[1])/2,z:(z[0]+z[1])/2},radius:{x:(x[1]-x[0])/2,y:(y[1]-y[0])/2,z:(z[1]-z[0])/2},phase:group[0].phase};
    });
  }
  const pine=tree.style==="pine"||tree.style==="cypress";
  for(const [index,c] of clusters.entries()){
    const base=out.positions.length/3,color=linear(tree.leafColors[index%tree.leafColors.length]);
    const phase=c.phase*6.283+index*2.39996;
    // Closed, irregular whorls follow each branch, rather than one rounded
    // blob per tree. Lower lobes carry baked canopy occlusion, not emission.
    const segments=lod===0?8:lod===1?6:5,rings=lod<2?2:1;
    const vertex=(x:number,y:number,z:number)=>{
      out.positions.push(c.position.x+x*c.radius.x,c.position.y+y*c.radius.y,c.position.z+z*c.radius.z);
      const nx=x/Math.max(.1,c.radius.x),ny=y/Math.max(.1,c.radius.y),nz=z/Math.max(.1,c.radius.z),n=Math.hypot(nx,ny,nz);
      out.normals.push(nx/n,ny/n,nz/n);out.uvs.push(x*.5+.5,z*.5+.5);
      const shade=.38+.48*(y*.5+.5)+.045*Math.sin(index*2.37);
      out.colors.push(...color.map(channel=>Math.round(channel*shade)),255);
    };
    vertex(0,1,0);vertex(0,-1,0);
    for(let ring=0;ring<rings;ring++)for(let v=0;v<segments;v++){
      const angle=v*Math.PI*2/segments+phase+(ring? .17:0),y=rings===1?0:ring===0?.38:-.42;
      const r=(pine?(ring===0?.56:1):Math.sqrt(1-y*y))*(1+.16*Math.sin(index*7.13+v*2.17)+.07*Math.sin(angle*3+phase));
      vertex(Math.cos(angle)*r,y,Math.sin(angle)*r);
    }
    for(let v=0;v<segments;v++){
      const next=(v+1)%segments,a=base+2+v,b=base+2+next;
      out.indices.push(base,b,a);
      if(rings===2){const c=a+segments,d=b+segments;out.indices.push(a,b,c,b,d,c,base+1,c,d);}
      else out.indices.push(base+1,a,b);
    }
  }
  return out;
}
