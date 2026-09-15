import * as pc from "playcanvas";
import type { AssemblyBuffers } from "../rendering/sceneAssemblyMesh";
import { fitScenicBase } from "../rendering/scenicBaseGeometry";

interface Accessor { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean; sparse?: unknown }
interface View { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }
interface Primitive { attributes: Record<string, number>; indices?: number; material?: number; mode?: number; extensions?: Record<string, unknown> }
interface Node { mesh?: number; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; children?: number[] }
interface TextureInfo { index: number }
interface Material { pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: TextureInfo; metallicRoughnessTexture?: TextureInfo; metallicFactor?: number; roughnessFactor?: number }; normalTexture?: TextureInfo; occlusionTexture?: TextureInfo; alphaMode?: string }
interface Document { buffers: { uri?: string }[]; bufferViews: View[]; accessors: Accessor[]; nodes?: Node[]; meshes: { primitives: Primitive[] }[]; scenes?: { nodes: number[] }[]; scene?: number; materials?: Material[]; textures?: { source: number }[]; images?: { bufferView?: number; mimeType?: string; uri?: string }[]; animations?: unknown[] }
export interface NativeModel { tokenBase?: {shape:string;diameter:number;height:number;color:string;rimColor:string}; bytes: ArrayBuffer; scale?: number; yaw?: number; offset?: { x: number; y: number; z: number }; ground?: number; cacheKey?: string; materialNamespace?: string; scenicBase?: { bytes: ArrayBuffer; id: string; diameter: number; heightRatio: number; standingPoint?: { x: number; z: number } } }
export interface NativeGlbMaterial { id: string; maps: Record<string, { bytes: Uint8Array; mime: string; channel?: number }>; roughness: number; metallic: number; masked: boolean }
export interface NativeGlb { parts: { material: string; geometry: AssemblyBuffers }[]; materials: NativeGlbMaterial[]; animated: boolean; cacheKey?: string }

/** Decode self-contained static glTF surfaces without creating a WebGL device. */
export function parseNativeGlb(model: NativeModel, assetId: string): NativeGlb {
  assetId = model.materialNamespace ?? assetId;
  const file = new DataView(model.bytes);
  if (file.byteLength < 20 || file.getUint32(0, true) !== 0x46546c67 || file.getUint32(4, true) !== 2 || file.getUint32(8, true) !== file.byteLength) throw new Error("Invalid GLB container");
  let document: Document | undefined, binary: DataView | undefined;
  for (let offset = 12; offset + 8 <= file.byteLength;) {
    const length = file.getUint32(offset, true), type = file.getUint32(offset + 4, true); offset += 8;
    if (offset + length > file.byteLength) throw new Error("GLB chunk exceeds its container");
    if (type === 0x4e4f534a) document = JSON.parse(new TextDecoder().decode(new Uint8Array(model.bytes, offset, length)).trim());
    if (type === 0x004e4942) binary = new DataView(model.bytes, offset, length);
    offset += length;
  }
  if (!document || !binary || document.buffers?.some(b => b.uri)) throw new Error("Native models must embed their binary buffer");
  const doc = document, bin = binary;
  function accessor(index: number): number[][] {
    const a = doc.accessors[index], v = a && doc.bufferViews[a.bufferView];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a?.type];
    const bytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a?.componentType];
    if (!a || !v || !width || !bytes || a.sparse || v.buffer !== 0 || a.count < 0 || a.count > 500_000) throw new Error("Unsupported GLB accessor");
    const stride = v.byteStride ?? width * bytes, start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    if (stride < width * bytes || start < 0 || start + Math.max(0, a.count - 1) * stride + width * bytes > Math.min(bin.byteLength, (v.byteOffset ?? 0) + v.byteLength)) throw new Error("GLB accessor is out of bounds");
    return Array.from({ length: a.count }, (_, i) => Array.from({ length: width }, (_, j) => {
      const p = start + i * stride + j * bytes;
      const value = a.componentType === 5126 ? bin.getFloat32(p, true) : a.componentType === 5125 ? bin.getUint32(p, true) : a.componentType === 5123 ? bin.getUint16(p, true) : a.componentType === 5122 ? bin.getInt16(p, true) : a.componentType === 5121 ? bin.getUint8(p) : bin.getInt8(p);
      if (!Number.isFinite(value)) throw new Error("GLB has non-finite geometry");
      return !a.normalized || a.componentType === 5126 ? value : a.componentType === 5121 ? value / 255 : a.componentType === 5123 ? value / 65535 : Math.max(-1, value / (a.componentType === 5120 ? 127 : 32767));
    }));
  }
  const parts: NativeGlb["parts"] = [], materials = new Map<number, NativeGlbMaterial>(); let triangles = 0;
  function material(index = -1) {
    if (materials.has(index)) return materials.get(index)!;
    const source = doc.materials?.[index] ?? {}, pbr = source.pbrMetallicRoughness ?? {};
    const result: NativeGlbMaterial = { id: `glb-${assetId.replace(/[^a-zA-Z0-9-]/g, "-")}-${index + 1}`, maps: {}, roughness: pbr.roughnessFactor ?? 1, metallic: pbr.metallicFactor ?? 1, masked: source.alphaMode === "MASK" };
    for (const [slot, info, channel] of [["albedo", pbr.baseColorTexture], ["normal", source.normalTexture], ["roughness", pbr.metallicRoughnessTexture, 1], ["metallic", pbr.metallicRoughnessTexture, 2], ["ambientOcclusion", source.occlusionTexture, 0]] as const) {
      if (!info) continue;
      const image = doc.images?.[doc.textures?.[info.index]?.source ?? -1], view = image?.bufferView === undefined ? undefined : doc.bufferViews[image.bufferView];
      if (!image || !view || image.uri || view.buffer !== 0 || (view.byteOffset ?? 0) + view.byteLength > bin.byteLength) throw new Error("Model texture must be embedded in its GLB");
      result.maps[slot] = { bytes: new Uint8Array(bin.buffer.slice(bin.byteOffset + (view.byteOffset ?? 0), bin.byteOffset + (view.byteOffset ?? 0) + view.byteLength)), mime: image.mimeType ?? "image/png", channel };
    }
    materials.set(index, result); return result;
  }
  function visit(index: number, parent: pc.Mat4, ancestors = new Set<number>()) {
    const node = doc.nodes?.[index]; if (!node || ancestors.has(index) || ancestors.size > 100) throw new Error("Invalid GLB node graph");
    const local = node.matrix ? new pc.Mat4().set(node.matrix) : new pc.Mat4().setTRS(new pc.Vec3(...(node.translation ?? [0, 0, 0])), new pc.Quat(...(node.rotation ?? [0, 0, 0, 1])), new pc.Vec3(...(node.scale ?? [1, 1, 1])));
    const world = new pc.Mat4().mul2(parent, local), normalMatrix = world.clone().invert().transpose();
    if (node.mesh !== undefined) for (const primitive of doc.meshes[node.mesh]?.primitives ?? []) {
      if ((primitive.mode ?? 4) !== 4 || primitive.extensions?.KHR_draco_mesh_compression) throw new Error("Native GLB import requires uncompressed triangles");
      const positions = accessor(primitive.attributes.POSITION), normals = primitive.attributes.NORMAL === undefined ? undefined : accessor(primitive.attributes.NORMAL), uv = primitive.attributes.TEXCOORD_0 === undefined ? undefined : accessor(primitive.attributes.TEXCOORD_0), color = primitive.attributes.COLOR_0 === undefined ? undefined : accessor(primitive.attributes.COLOR_0);
      const indices = primitive.indices === undefined ? positions.map((_, i) => i) : accessor(primitive.indices).flat();
      triangles += indices.length / 3; if (triangles > 20_000 || indices.length % 3 || indices.some(i => !Number.isInteger(i) || i < 0 || i >= positions.length)) throw new Error("Model exceeds the 20000-triangle budget or has invalid indices");
      const factor = doc.materials?.[primitive.material ?? -1]?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
      const geometry: AssemblyBuffers = { positions: [], normals: [], uvs: [], colors: [], indices };
      positions.forEach((p, i) => {
        const v = world.transformPoint(new pc.Vec3(...p)); geometry.positions.push(v.x, v.y, v.z);
        if (normals) { const n = normalMatrix.transformVector(new pc.Vec3(...normals[i])).normalize(); geometry.normals.push(n.x, n.y, n.z); }
        geometry.uvs.push(...(uv?.[i] ?? [0, 0]));
        for (let channel = 0; channel < 4; channel++) geometry.colors.push(Math.round(Math.max(0, Math.min(1, (color?.[i]?.[channel] ?? 1) * factor[channel])) * 255));
      });
      const d = world.data, determinant = d[0] * (d[5] * d[10] - d[6] * d[9]) - d[4] * (d[1] * d[10] - d[2] * d[9]) + d[8] * (d[1] * d[6] - d[2] * d[5]);
      if (determinant < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
      if (!normals) geometry.normals = [...pc.calculateNormals(geometry.positions, indices)];
      parts.push({ material: material(primitive.material).id, geometry });
    }
    const next = new Set(ancestors).add(index); node.children?.forEach(child => visit(child, world, next));
  }
  const transform = new pc.Mat4().setTRS(new pc.Vec3(), new pc.Quat().setFromEulerAngles(0, model.yaw ?? 0, 0), new pc.Vec3(model.scale ?? 1, model.scale ?? 1, model.scale ?? 1));
  const children = new Set(doc.nodes?.flatMap(n => n.children ?? []) ?? []);
  for (const index of doc.scenes?.[doc.scene ?? 0]?.nodes ?? (doc.nodes ?? []).map((_, i) => i).filter(i => !children.has(i))) visit(index, transform);
  if (!parts.length) throw new Error("GLB has no renderable triangles");
  const base = model.scenicBase ? parseNativeGlb({bytes:model.scenicBase.bytes},model.scenicBase.id) : undefined;
  const fit = base && model.scenicBase ? fitScenicBase(base.parts.map(part=>part.geometry),model.scenicBase.diameter,model.scenicBase.heightRatio,model.scenicBase.standingPoint) : undefined;
  const ground = fit?.anchorTop ?? model.ground;
  const minY = parts.reduce((min, part) => part.geometry.positions.reduce((v, p, i) => i % 3 === 1 ? Math.min(v, p) : v, min), Infinity);
  for (const part of parts) for (let i = 0; i < part.geometry.positions!.length; i += 3) {
    part.geometry.positions![i] += (model.offset?.x ?? 0) + (fit?.anchorOffset.x ?? 0);
    part.geometry.positions![i + 1] += ground === undefined ? model.offset?.y ?? 0 : ground - minY;
    part.geometry.positions![i + 2] += (model.offset?.z ?? 0) + (fit?.anchorOffset.z ?? 0);
  }
  if(base && fit) for(const part of base.parts) {
    for(let i=0;i<part.geometry.positions!.length;i+=3) {
      const p=part.geometry.positions,n=part.geometry.normals;
      p[i]=p[i]*fit.scale.x+fit.position.x;p[i+1]=p[i+1]*fit.scale.y+fit.position.y;p[i+2]=p[i+2]*fit.scale.z+fit.position.z;
      const nx=n[i]/fit.scale.x,ny=n[i+1]/fit.scale.y,nz=n[i+2]/fit.scale.z,d=Math.hypot(nx,ny,nz)||1;n[i]=nx/d;n[i+1]=ny/d;n[i+2]=nz/d;
    }parts.push(part);
  }
  if(model.tokenBase&&!base){
    const b=model.tokenBase;
    for(const [diameter,height,y,color] of [[b.diameter,b.height,b.height/2,b.color],[b.diameter*.94,.026,b.height+.013,b.rimColor]] as const){
      const geometry=b.shape==='square'?new pc.BoxGeometry():new pc.CylinderGeometry({height:1,radius:.5,capSegments:b.shape==='hex'?6:48});
      const rgb=new pc.Color().fromString(color),buffer:AssemblyBuffers={positions:[],normals:[...geometry.normals!],uvs:[...geometry.uvs!],indices:[...geometry.indices!],colors:[]};
      for(let i=0;i<geometry.positions!.length;i+=3){buffer.positions.push(geometry.positions![i]*diameter,geometry.positions![i+1]*height+y,geometry.positions![i+2]*diameter);buffer.colors.push(Math.round(rgb.r*255),Math.round(rgb.g*255),Math.round(rgb.b*255),255);}
      parts.push({material:'masonry',geometry:buffer});
    }
  }
  return { parts, materials: [...materials.values(),...(base?.materials??[])], animated: Boolean(doc.animations?.length),cacheKey:model.cacheKey };
}
