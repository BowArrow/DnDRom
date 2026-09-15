import type { WorldTreeGeometry } from "../domain/types";
import type { NativeGlbMaterial } from "./nativeGlb";
import type { AssemblyBuffers } from "../rendering/sceneAssemblyMesh";

/** Four side views and an overhead projection of the actual branch graph. */
export async function nativeTreeImpostor(tree: WorldTreeGeometry, id: string): Promise<{ geometry: AssemblyBuffers; material: NativeGlbMaterial }> {
  let width = .2, height = .2;
  for (const b of tree.branches) { width = Math.max(width, Math.hypot(b.end.x, b.end.z) + b.endRadius); height = Math.max(height, b.end.y); }
  for (const c of tree.leafClusters) { width = Math.max(width, Math.hypot(c.position.x, c.position.z) + Math.max(c.radius.x, c.radius.z)); height = Math.max(height, c.position.y + c.radius.y); }
  width *= 1.06; height *= 1.03;
  const canvas = new OffscreenCanvas(1280, 256), ctx = canvas.getContext("2d")!;
  for (let view = 0; view < 5; view++) {
    const angle=view*Math.PI/4;
    const project = (x: number, y: number, z: number) => ({ x: view * 256 + 128 + (view===4?x:x*Math.cos(angle)+z*Math.sin(angle)) / (width * 2) * 244, y: view===4?128+z/(width*2)*244:251-y/height*246 });
    ctx.lineCap = "round"; ctx.strokeStyle = tree.barkColor;
    for (const b of tree.branches) {
      const a = project(b.start.x, b.start.y, b.start.z), end = project(b.end.x, b.end.y, b.end.z);
      ctx.lineWidth = Math.max(.6, (b.startRadius + b.endRadius) / (width * 2) * 244); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    }
    for (const c of tree.leafClusters) for (let i = 0; i < 224; i++) {
      const random = (k: number) => { const n = Math.sin(i * 71.31 + c.phase * 1301 + k * 31.7) * 43758.5453; return n - Math.floor(n); };
      const az = random(0) * Math.PI * 2, v = random(1) * 2 - 1, r = Math.sqrt(1 - v * v)*Math.cbrt(random(4));
      const p = project(c.position.x + Math.cos(az) * r * c.radius.x * .85, c.position.y + v * c.radius.y * .85, c.position.z + Math.sin(az) * r * c.radius.z * .85);
      const n=parseInt(tree.leafColors[i%2].slice(1),16),shade=.68+.32*(v*.5+.5);
      ctx.fillStyle=`rgb(${[n>>16&255,n>>8&255,n&255].map(c=>Math.round(c*shade)).join(",")})`;ctx.globalAlpha=1;
      const radius = Math.max(.6, .13 / (view===4?width*2:height) * 246); ctx.beginPath(); ctx.ellipse(p.x, p.y, radius, radius, random(3) * Math.PI, 0, Math.PI * 2); ctx.fill();
    }
  }
  const geometry=impostorPlanes(width,height);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  return { geometry, material: { id, maps: { albedo: { bytes, mime: "image/png" } }, roughness: 1, metallic: 0, masked: true } };
}

/** Alpha encodes which plane is overhead; it is separate from texture opacity. */
export function impostorPlanes(width:number,height:number):AssemblyBuffers {
  const mesh:AssemblyBuffers={positions:[],normals:[],uvs:[],colors:[],indices:[]};
  for(let view=0;view<5;view++){
    const angle=view*Math.PI/4,base=mesh.positions.length/3;
    for(let v=0;v<4;v++){
      const x=v%2?width:-width,y=v<2?0:height;
      mesh.positions.push(...(view===4?[x,height*.68,v<2?width:-width]:[x*Math.cos(angle),y,x*Math.sin(angle)]));
      mesh.normals.push(0,1,0);mesh.uvs.push((view+(v%2?.995:.005))/5,v<2?.995:.005);mesh.colors.push(255,255,255,view===4?0:255);
    }
    mesh.indices.push(base,base+1,base+2,base+2,base+1,base+3);
  }
  return mesh;
}
