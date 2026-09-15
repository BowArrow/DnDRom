import * as pc from "playcanvas";
import type { WorldTreeGeometry } from "../domain/types";
import type { TreeBarkBuffers } from "./treeBarkMesh";

interface TreeImpostor { buffers: TreeBarkBuffers; material: pc.StandardMaterial }
const caches = new WeakMap<pc.GraphicsDevice, WeakMap<WorldTreeGeometry, TreeImpostor>>();

/** Two orthogonal projections of the actual seeded crown and branch graph.
 * Four triangles per tree, alpha-tested and instanced. This intermediate
 * approximation has no parallax inside a crown; it is not a horizon aggregate. */
export function buildTreeImpostor(device: pc.GraphicsDevice, tree: WorldTreeGeometry): TreeImpostor {
  let cache = caches.get(device); if (!cache) { cache = new WeakMap(); caches.set(device, cache); }
  const existing = cache.get(tree); if (existing) return existing;
  let width = .2, height = .2;
  for (const b of tree.branches) { width = Math.max(width, Math.hypot(b.end.x, b.end.z) + b.endRadius); height = Math.max(height, b.end.y); }
  for (const c of tree.leafClusters) { width = Math.max(width, Math.hypot(c.position.x, c.position.z) + Math.max(c.radius.x, c.radius.z)); height = Math.max(height, c.position.y + c.radius.y); }
  width *= 1.06; height *= 1.03;
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext("2d")!, evergreen = tree.style === "pine" || tree.style === "cypress";
  for (let view = 0; view < 2; view++) {
    const project = (x: number, y: number, z: number) => ({ x: view * 256 + 128 + (view ? z : x) / (width * 2) * 244, y: 251 - y / height * 246 });
    ctx.lineCap = "round"; ctx.strokeStyle = tree.barkColor;
    for (const b of [...tree.branches].sort((a,b) => (view ? a.end.x-b.end.x : a.end.z-b.end.z))) {
      const a=project(b.start.x,b.start.y,b.start.z), end=project(b.end.x,b.end.y,b.end.z);
      ctx.lineWidth=Math.max(.6,(b.startRadius+b.endRadius)/(width*2)*244);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(end.x,end.y);ctx.stroke();
    }
    const clusters = [...tree.leafClusters].sort((a,b) => view ? a.position.x-b.position.x : a.position.z-b.position.z);
    for (const c of clusters) {
      const random=(i:number,s:number)=>{const n=Math.sin(i*71.31+c.phase*1301+s*31.7)*43758.5453;return n-Math.floor(n);};
      for(let i=0;i<96;i++){
        const az=random(i,0)*Math.PI*2,v=random(i,1)*2-1,r=Math.sqrt(1-v*v);
        const p=project(c.position.x+Math.cos(az)*r*c.radius.x*.85,c.position.y+v*c.radius.y*.85,c.position.z+Math.sin(az)*r*c.radius.z*.85);
        ctx.fillStyle=tree.leafColors[i%2];ctx.globalAlpha=.85+random(i,2)*.15;
        const radius=Math.max(.6,(evergreen?.1:.085)/height*246);
        ctx.beginPath();ctx.ellipse(p.x,p.y,radius*(evergreen?1.8:1),radius,random(i,3)*Math.PI,0,Math.PI*2);ctx.fill();
      }
    }
  }
  ctx.globalAlpha=1;
  const texture=new pc.Texture(device,{name:`${tree.style} crown projections`,width:512,height:256,format:pc.PIXELFORMAT_RGBA8,mipmaps:true,minFilter:pc.FILTER_LINEAR_MIPMAP_LINEAR,magFilter:pc.FILTER_LINEAR,addressU:pc.ADDRESS_CLAMP_TO_EDGE,addressV:pc.ADDRESS_CLAMP_TO_EDGE});texture.setSource(canvas);
  const material=new pc.StandardMaterial();material.diffuseMap=texture;material.opacityMap=texture;material.opacityMapChannel="a";material.alphaTest=.18;material.cull=pc.CULLFACE_NONE;material.twoSidedLighting=true;material.gloss=0;material.specularityFactor=0;material.update();
  const buffers:TreeBarkBuffers={positions:[],normals:[],uvs:[],colors:[],indices:[]};
  for(let view=0;view<2;view++){
    const base=buffers.positions.length/3;
    for(const [u,v] of [[0,0],[1,0],[0,1],[1,1]]){
      const offset=(u*2-1)*width;buffers.positions.push(view?0:offset,v*height,view?offset:0);
      buffers.normals.push(view?.6:0,.8,view?0:.6);buffers.uvs.push((view+u)/2,v);buffers.colors.push(255,255,255,255);
    }
    buffers.indices.push(base,base+1,base+2,base+1,base+3,base+2);
  }
  const result={buffers,material};cache.set(tree,result);device.once("destroy",()=>{material.destroy();texture.destroy();});return result;
}
