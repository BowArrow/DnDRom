import {settlementGrowth} from '../domain/settlementGrowth';
import {settlementHerbMesh,settlementVineMesh} from '../rendering/settlementPlantMesh';
import {nearestOnSegment} from '../domain/sharedWorld';
import {settlementMaterial} from '../domain/settlementSurfaces';
import {refreshSettlementFacades} from '../domain/settlementFacadeRefresh';
import * as pc from "playcanvas";
import { ASSET_BY_ID } from "../domain/assets";
import type { Campaign, GameMap, MapEntity, Vec3, WorldWaterGeometry } from "../domain/types";
import { snapshotActiveScene } from "../domain/campaignScenes";
import { createHeightfield, sampleTerrainHeight, terrainSurfaceWeights } from "../domain/worldProcedural";
import { generateSpaceColonizedTree } from "../domain/worldArchitecture";
import { buildAssemblyMeshes, buildingAssemblyParts, type AssemblyBuffers } from "../rendering/sceneAssemblyMesh";
import { buildTreeBarkMesh } from "../rendering/treeBarkMesh";
import { buildContinuousRiverSurface } from "../rendering/riverSurfaceMesh";
import type { NativeGlb } from "./nativeGlb";
import {shoreDistanceField} from "./nativeShore";
import {nativeWaterField,type NativeWaterField} from "./nativeWaterField";
import {createTerrainPatchSampler} from "../domain/worldPatchSampling";
import {createWaterPatchSampler} from "./nativeWaterSampling";
import {sampleSharedClimate} from '../domain/worldClimate';

/** Engine-neutral, versioned transfer format. Arrays remain Y-up metres; only
 * the receiving renderer converts axes. Source recipes are never discarded. */
export interface UnrealScene {
  format: "dndrom.scene";
  version: 1;
  coordinates: "right-handed-y-up-metres";
  name: string;
  source: { map: GameMap; campaign?: Campaign };
  meshes: Array<{ id: string; material: string; collision: boolean; castShadow?: boolean; lods: AssemblyBuffers[] }>;
  instances: Array<{ entityId: string; meshId: string; position: Vec3; rotation: [number, number, number, number]; scale: Vec3; routeMotion?:MapEntity['routeMotion'] }>;
  warnings: Array<{ entityId: string; message: string }>;
  waterFields?:NativeWaterField[];
}

const empty = (): AssemblyBuffers => ({ positions: [], normals: [], uvs: [], colors: [], indices: [] });
const white = (out: AssemblyBuffers) => { out.colors = Array.from({ length: out.positions.length / 3 * 4 }, () => 255); return out; };
const quat = (r: Vec3): [number, number, number, number] => { const q = new pc.Quat().setFromEulerAngles(r.x, r.y, r.z); return [q.x, q.y, q.z, q.w]; };
export const unrealPosition = (p: Vec3): Vec3 => ({ x: p.x * 100, y: p.z * 100, z: p.y * 100 });
export const unrealQuaternion = ([x, y, z, w]: [number, number, number, number]): [number, number, number, number] => [-x, -z, -y, w];

function terrainMesh(entity: MapEntity,patches?:ReturnType<typeof createTerrainPatchSampler>,site?:import('../domain/worldSite').WorldSite): AssemblyBuffers {
  const g = entity.worldGeometry?.kind==='terrain'&&site?.shared?{...entity.worldGeometry,worldSite:site}:entity.worldGeometry;
  if (g?.kind !== "terrain") throw new Error("Expected terrain");
  // Keep the authoritative edge samples at every imported tile. Runtime tile
  // LOD stitching is a separate migration step; independent simplification
  // here would recreate the existing near/far cracks.
  const field = createHeightfield(g, Math.min(257, g.heightfield?.resolution ?? 33));
  const out = empty(), step = field.size / (field.resolution - 1);
  for (let z = 0; z < field.resolution; z++) for (let x = 0; x < field.resolution; x++) {
    const wx = field.originX + x * step, wz = field.originZ + z * step;
    out.positions.push(wx - entity.position.x, field.heights[z * field.resolution + x] - entity.position.y, wz - entity.position.z);
    const n = patches?.normal(wx,wz)??new pc.Vec3(sampleTerrainHeight(g, wx - step, wz) - sampleTerrainHeight(g, wx + step, wz), 2 * step, sampleTerrainHeight(g, wx, wz - step) - sampleTerrainHeight(g, wx, wz + step)).normalize();
    out.normals.push(n.x, n.y, n.z); out.uvs.push((wx+(g.worldSite?.shared?g.worldSite.x:0)) / 7.5, (wz+(g.worldSite?.shared?g.worldSite.z:0)) / 7.5);
    const w = terrainSurfaceWeights(g, wx, wz, n.y);
    if(g.worldSite?.shared){const site=g.worldSite,altitude=field.heights[z*field.resolution+x]+site.datum,c=sampleSharedClimate(g.seed,site.shared!,wx+site.x,wz+site.z,altitude);(out.biomeUVs??=[]).push(1+c.aridity,altitude/7.5);}
    // Blend weights, not baked green albedo: Unreal's terrain material reads
    // rock, snow and road masks and supplies its own PBR layers.
    out.colors.push(Math.round(w.rock * 255), Math.round(w.snow * 255), Math.round(w.road * 255), 255);
    if (z < field.resolution - 1 && x < field.resolution - 1) {
      const a = z * field.resolution + x, b = a + field.resolution;
      out.indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return out;
}

/** Clip each source heightfield triangle at depth zero. Unlike a lake quad,
 * this cannot cover a dry corner or connect two diagonal wet islands. */
export function waterMesh(g: WorldWaterGeometry, origin: Vec3, coastal=false,sharedShore?:((x:number,z:number)=>number)): AssemblyBuffers {
  const out = empty(), stride = g.resolution + 1;
  type V = { x: number; y: number; z: number; d: number };
  const at = (x: number, z: number): V => { const i = z * stride + x; return { x: g.originX + x * g.size / g.resolution - origin.x, y: (g.surfaceHeights?.[i] ?? g.waterLevel) - origin.y, z: g.originZ + z * g.size / g.resolution - origin.z, d: g.depthField?.[i] ?? (g.wetCells[i] ? .5 : -.5) }; };
  const shore=sharedShore??shoreDistanceField(g.originX,g.originZ,g.size,g.size/g.resolution,(x,z)=>{
    const u=Math.max(0,Math.min(g.resolution,(x-g.originX)/g.size*g.resolution)),v=Math.max(0,Math.min(g.resolution,(z-g.originZ)/g.size*g.resolution));
    const ix=Math.min(g.resolution-1,Math.floor(u)),iz=Math.min(g.resolution-1,Math.floor(v)),fx=u-ix,fz=v-iz,a=at(ix,iz).d,b=at(ix+1,iz).d,c=at(ix,iz+1).d,d=at(ix+1,iz+1).d;
    return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d*(fx+fz-1)+b*(1-fz)+c*(1-fx);
  });
  const clip = (vertices: V[]) => {
    const polygon: V[] = [];
    vertices.forEach((a, i) => {
      const b = vertices[(i + 1) % vertices.length];
      const edge=coastal?-.45:0;
      if (a.d > edge) polygon.push(a);
      if ((a.d > edge) !== (b.d > edge)) { const t = (a.d-edge) / (a.d - b.d); polygon.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, d: edge }); }
    });
    const base = out.positions.length / 3;
    for (const v of polygon) { out.positions.push(v.x, v.y, v.z); out.normals.push(0, 1, 0); out.uvs.push((v.x + origin.x) / 6, (v.z + origin.z) / 6); out.colors.push(Math.round(Math.min(1, Math.max(0, v.d) / 4) * 255),Math.round(shore(v.x+origin.x,v.z+origin.z)/24*255),255,255); }
    for (let i = 1; i < polygon.length - 1; i++) out.indices.push(base, base + i, base + i + 1);
  };
  for (let z = 0; z < g.resolution; z++) for (let x = 0; x < g.resolution; x++) {
    const a = at(x, z), b = at(x + 1, z), c = at(x + 1, z + 1), d = at(x, z + 1);
    clip([a, d, b]); clip([b, d, c]);
  }
  return out;
}

/** Older recipes store a wetness proxy in dry depth samples and a surface
 * 12 cm above dry ground. That data is suitable for clipping, not run-up.
 * Recover the displayed bed and extend the adjacent wet surface instead. */
export function coastalWaterGeometry(map:GameMap,g:WorldWaterGeometry,shared?:ReturnType<typeof createWaterPatchSampler>):WorldWaterGeometry {
  const terrain=map.entities.find(e=>e.worldGeometry?.kind==="terrain"&&e.worldGeometry.originX===g.originX&&e.worldGeometry.originZ===g.originZ&&e.worldGeometry.size===g.size)?.worldGeometry;
  if(terrain?.kind!=="terrain")return g;
  const field=createHeightfield(terrain,Math.min(257,terrain.heightfield?.resolution??33)),stride=field.resolution;
  const wet=(g.depthField??g.wetCells.map(v=>v ? .5 : -.5)).map((d,i)=>d>0?i:-1).filter(i=>i>=0);
  const original=g.depthField??g.wetCells.map(v=>v ? .5 : -.5),originalStride=g.resolution+1;
  const originalShore=shared?.shore??shoreDistanceField(g.originX,g.originZ,g.size,g.size/g.resolution,(x,z)=>{
    const u=Math.max(0,Math.min(g.resolution,(x-g.originX)/g.size*g.resolution)),v=Math.max(0,Math.min(g.resolution,(z-g.originZ)/g.size*g.resolution));
    const ix=Math.min(g.resolution-1,Math.floor(u)),iz=Math.min(g.resolution-1,Math.floor(v)),fx=u-ix,fz=v-iz,i=iz*originalStride+ix;
    const a=original[i],b=original[i+1],c=original[i+originalStride],d=original[i+originalStride+1];
    return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d*(fx+fz-1)+b*(1-fz)+c*(1-fx);
  });
  const depthField:number[]=[],surfaceHeights:number[]=[];
  for(let z=0;z<=g.resolution;z++)for(let x=0;x<=g.resolution;x++){
    const i=z*(g.resolution+1)+x,u=x/g.resolution*(stride-1),v=z/g.resolution*(stride-1),ix=Math.min(stride-2,Math.floor(u)),iz=Math.min(stride-2,Math.floor(v)),fx=u-ix,fz=v-iz,j=iz*stride+ix;
    const a=field.heights[j],b=field.heights[j+1],c=field.heights[j+stride],d=field.heights[j+stride+1];
    const bed=fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d*(fx+fz-1)+b*(1-fz)+c*(1-fx);
    let surface=g.surfaceHeights?.[i]??g.waterLevel;
    if(!g.wetCells[i]&&surface-bed>-.001){
      let closest=-1,distance=Infinity;
      if(!shared)for(const w of wet){const dx=x-w%(g.resolution+1),dz=z-Math.floor(w/(g.resolution+1)),dist=dx*dx+dz*dz;if(dist<distance){distance=dist;closest=w;}}
      if(closest>=0)surface=g.surfaceHeights?.[closest]??g.waterLevel;
      surface=shared?.wetSurface(g.originX+x*g.size/g.resolution,g.originZ+z*g.size/g.resolution)??surface;
    }
    // Hydrology can deliberately exclude low ground (for example a protected
    // road). Preserve that dry footprint at mean level; only a bounded swash
    // strip may cross it. Never turn a mask proxy into a new flooded basin.
    const exclusion=g.wetCells[i]?32:-Math.max(.025,originalShore(g.originX+x*g.size/g.resolution,g.originZ+z*g.size/g.resolution)*.12);
    surfaceHeights.push(surface);depthField.push(Math.min(surface-bed,exclusion));
  }
  return {...g,depthField,surfaceHeights};
}

export function prepareSceneWater(map:GameMap) {
  const geometries=map.entities.filter(e=>!e.hidden&&e.rotation?.x===0&&e.rotation?.y===0&&e.rotation?.z===0&&e.scale?.x===1&&e.scale?.y===1&&e.scale?.z===1).flatMap(e=>e.worldGeometry?.kind==="water"?[e.worldGeometry]:[]);
  const original=createWaterPatchSampler(geometries),prepared=new Map(geometries.map(g=>[g,coastalWaterGeometry(map,g,original)]));
  return {prepared,...createWaterPatchSampler([...prepared.values()])};
}

function leafMesh(tree: ReturnType<typeof generateSpaceColonizedTree>, lod: number): AssemblyBuffers {
  const out = empty(), leaves = [40, 20, 10][lod];
  tree.leafClusters.forEach((cluster, index) => {
    const random = (i: number, k: number) => { const v = Math.sin((index * 137 + i * 71 + k * 31 + cluster.phase) * 12.9898) * 43758.5453; return v - Math.floor(v); };
    for (let leaf = 0; leaf < leaves; leaf++) {
      const azimuth = random(leaf, 0) * Math.PI * 2, elevation = random(leaf, 1) * 2 - 1, radial = Math.sqrt(1 - elevation * elevation);
      const center = new pc.Vec3(cluster.position.x + Math.cos(azimuth) * radial * cluster.radius.x * .8, cluster.position.y + elevation * cluster.radius.y * .8, cluster.position.z + Math.sin(azimuth) * radial * cluster.radius.z * .8);
      const evergreen = tree.style === "pine" || tree.style === "cypress";
      const length = (evergreen ? .48 : .3) * Math.sqrt(40 / leaves) * (.75 + random(leaf, 2) * .65);
      const direction = new pc.Vec3(Math.cos(azimuth), .2 + random(leaf, 3) * .55, Math.sin(azimuth)).normalize();
      const side = new pc.Vec3(-Math.sin(azimuth), 0, Math.cos(azimuth)).mulScalar(length * (evergreen ? .72 : .58));
      const tip = direction.clone().mulScalar(length), base = out.positions.length / 3, normal = new pc.Vec3().cross(side, direction).normalize();
      const color = new pc.Color().fromString(tree.leafColors[(index + leaf) % 2]);
      [center.clone().sub(tip).sub(side), center.clone().sub(tip).add(side), center.clone().add(tip).sub(side), center.clone().add(tip).add(side)].forEach((p, i) => {
        out.positions.push(p.x, p.y, p.z); out.normals.push(normal.x, normal.y, normal.z); out.uvs.push(i % 2, i < 2 ? 0 : 1);
        out.colors.push(...[color.r, color.g, color.b].map(v => Math.round(v ** 2.2 * 255)), 255);
      });
      out.indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  });
  return out;
}

function grassMesh(): AssemblyBuffers {
  const out = empty();
  for (let i = 0; i < 5; i++) {
    const angle = i * 2.399963, x = Math.cos(angle) * .13, z = Math.sin(angle) * .13, h = .24 + (i % 3) * .09, base = out.positions.length / 3;
    out.positions.push(x - .025, 0, z, x + .025, 0, z, x + .09, h, z + .04);
    out.uvs.push(0, 0, 1, 0, .5, 1); out.indices.push(base, base + 1, base + 2);
  }
  out.normals = Array.from(pc.calculateNormals(out.positions, out.indices)); return white(out);
}

export function exportUnrealScene(map: GameMap, campaign?: Campaign, models: Record<string, NativeGlb> = {}): UnrealScene {
  map=refreshSettlementFacades(map);
  const terrainPatches=createTerrainPatchSampler(map.entities.filter(e=>!e.hidden).flatMap(e=>e.worldGeometry?.kind==="terrain"?[e.worldGeometry]:[]));
  const sceneWater=prepareSceneWater(map);
  const scene: UnrealScene = { format: "dndrom.scene", version: 1, coordinates: "right-handed-y-up-metres", name: map.name, source: { map, ...(campaign ? { campaign: snapshotActiveScene(campaign) } : {}) }, meshes: [], instances: [], warnings: [] };
  const ids = new Set<string>();
  const warn = (entity: MapEntity, message: string) => scene.warnings.push({ entityId: entity.id, message });
  const add = (entity: MapEntity, key: string, material: string, collision: boolean, build: () => AssemblyBuffers[], placements?: Array<{ x: number; y: number; z: number; rotation: number; scale: number }>, generatedMaterial?:string) => {
    const sourceMaterial = material;
    material = entity.materialSlots?.[material as keyof NonNullable<MapEntity["materialSlots"]>] ?? entity.materialAssetId ?? generatedMaterial ?? material;
    const id = `${key}/${sourceMaterial}/${material}`;
    if (!ids.has(id)) { const lods = build(); if (!lods[0]?.indices.length) return; scene.meshes.push({ id, material, collision, lods }); ids.add(id); }
    const parent = new pc.Mat4().setTRS(new pc.Vec3(entity.position.x, entity.position.y, entity.position.z), new pc.Quat(...quat(entity.rotation)), new pc.Vec3(entity.scale.x, entity.scale.y, entity.scale.z));
    if (placements) for (const p of placements) {
      // Generated foliage placements are absolute world coordinates. The
      // renderer stores their transforms relative to the batch's parent.
      const position = parent.transformPoint(new pc.Vec3(p.x - entity.position.x, p.y - entity.position.y, p.z - entity.position.z));
      // Current generated batches have identity parent rotation/scale. Reject
      // sheared TRS rather than silently moving foliage in an edited batch.
      if ((entity.scale.x !== entity.scale.y || entity.scale.y !== entity.scale.z) && p.rotation !== 0) throw new Error(`Cannot export sheared instance batch ${entity.id}`);
      const q = new pc.Quat(...quat(entity.rotation)).mul(new pc.Quat().setFromEulerAngles(0, p.rotation, 0));
      scene.instances.push({ entityId: entity.id, meshId: id, position: { x: position.x, y: position.y, z: position.z }, rotation: [q.x, q.y, q.z, q.w], scale: { x: entity.scale.x * p.scale, y: entity.scale.y * p.scale, z: entity.scale.z * p.scale } });
    } else scene.instances.push({ entityId: entity.id, meshId: id, position: entity.position, rotation: quat(entity.rotation), scale: entity.scale, routeMotion:entity.routeMotion });
  };
  for (const entity of map.entities) {
    if (entity.hidden) continue;
    const g = entity.worldGeometry;
    if (models[entity.id] ?? models[entity.assetId]) {
      const model = models[entity.id] ?? models[entity.assetId];
      model.parts.forEach((part, index) => add(entity, `${model.cacheKey ?? entity.assetId}:${index}`, part.material, true, () => [part.geometry]));
      if (model.animated) warn(entity, "Animated source model is preserved; native import currently shows its authored bind pose.");
      continue;
    }
    if (g?.kind === "terrain") add(entity, entity.id, "terrain", true, () => [terrainMesh(entity,terrainPatches,map.world?.site)]);
    else if (g?.kind === "water") {
      // Procedurally placed water has identity rotation/scale. Edited water
      // retains ordinary geometry; never register an incorrectly located bed.
      const coastal=entity.rotation.x===0&&entity.rotation.y===0&&entity.rotation.z===0&&entity.scale.x===1&&entity.scale.y===1&&entity.scale.z===1;
      const waterGeometry=coastal?(sceneWater.prepared.get(g)??coastalWaterGeometry(map,g)):g;
      add(entity, entity.id, "water", false, () => [waterMesh(waterGeometry, entity.position,coastal,coastal?sceneWater.shore:undefined)]);
      if(coastal){
        const sample=(values:number[]|undefined,x:number,z:number,fallback:number)=>{
          const u=Math.max(0,Math.min(waterGeometry.resolution,(x-waterGeometry.originX)/waterGeometry.size*waterGeometry.resolution)),v=Math.max(0,Math.min(waterGeometry.resolution,(z-waterGeometry.originZ)/waterGeometry.size*waterGeometry.resolution));
          const ix=Math.min(waterGeometry.resolution-1,Math.floor(u)),iz=Math.min(waterGeometry.resolution-1,Math.floor(v)),fx=u-ix,fz=v-iz,i=iz*(waterGeometry.resolution+1)+ix;
          const at=(n:number)=>values?.[n]??fallback,a=at(i),b=at(i+1),c=at(i+waterGeometry.resolution+1),d=at(i+waterGeometry.resolution+2);
          return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d*(fx+fz-1)+b*(1-fz)+c*(1-fx);
        };
        const depths=waterGeometry.depthField??waterGeometry.wetCells.map(v=>v ? .5 : -.5),depth=(x:number,z:number)=>sample(depths,x,z,0);
        const shore=sceneWater.shore;
        (scene.waterFields??=[]).push(nativeWaterField(waterGeometry.originX,waterGeometry.originZ,waterGeometry.size,waterGeometry.resolution,depth,shore,(x,z)=>sample(waterGeometry.surfaceHeights,x,z,waterGeometry.waterLevel)));
      }
    }
    else if (g?.kind === "river-ribbon" || g?.kind === "road-ribbon") add(entity, entity.id, g.kind === "river-ribbon" ? "water" : g.surface === "wood" ? "timber" : "road", g.kind === "road-ribbon", () => [white(buildContinuousRiverSurface(g.paths, entity.position, g.bankDepth))]);
    else if (g?.kind === "assembly" || g?.kind === "cga-building") {
      const parts = (g.kind === "assembly" ? g.parts : buildingAssemblyParts(g)).map(p=>entity.materialAssetId||entity.materialSlots?.[p.material]?{...p,settlementSurface:undefined}:p);
      const lods = [0, 1, 2].map(lod => buildAssemblyMeshes(parts, lod));
      for (const role of lods[0].keys()) add(entity, entity.id, role, true, () => lods.map(l => l.get(role)!),undefined,settlementMaterial(role,parts[0]?.settlementSurface));
      const profile=parts[0]?.settlementSurface;
      if(profile&&!entity.materialAssetId&&!map.world?.sharedWorld?.authoredEntities?.some(e=>e.id===entity.id)){
        const matrix=new pc.Mat4().setTRS(new pc.Vec3(entity.position.x,entity.position.y,entity.position.z),new pc.Quat(...quat(entity.rotation)),new pc.Vec3(entity.scale.x,entity.scale.y,entity.scale.z));
        const worldPoint=(x:number,y:number,z:number)=>matrix.transformPoint(new pc.Vec3(x,y,z));
        const growth=settlementGrowth(entity.id,parts,profile,(x,z)=>{
          const p=worldPoint(x,0,z);if(!terrainPatches.at(p.x,p.z))return undefined;
          return (terrainPatches.height(p.x,p.z)-entity.position.y)/entity.scale.y;
        },p=>{
          const q=worldPoint(p.x,p.y,p.z);if(sceneWater.depth(q.x,q.z)>0)return true;
          const m=map.world?.sharedWorld,site=map.world?.site;if(!m||!site)return false;
          const w={x:q.x+site.x,z:q.z+site.z};
          return [...m.transport,...m.locations.flatMap(l=>l.settlement.streets)].some(r=>r.mode==='road'&&r.points.some((b,i)=>i>0&&Math.hypot(w.x-nearestOnSegment(w,r.points[i-1],b).x,w.z-nearestOnSegment(w,r.points[i-1],b).z)<r.width/2+.22));
        });
        if(growth.vines.length)add({...entity,materialSlots:undefined,materialAssetId:undefined},entity.id+'/vines','settlement-flora',false,()=>[0,1,2].map(l=>settlementVineMesh(growth.vines,l)));
        for(const kind of [0,1,2]){
          const plants=growth.herbs.filter(p=>p.kind===kind);if(!plants.length)continue;
          const placements=plants.map(p=>{const point=worldPoint(p.x,p.y,p.z);return {...point,rotation:p.rotation+entity.rotation.y,scale:p.scale*entity.scale.x};});
          add({...entity,id:entity.id+'/herbs',position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},materialSlots:undefined,materialAssetId:undefined},'settlement-herb-v1-'+kind,'settlement-flora',false,()=>[0,1,2].map(l=>settlementHerbMesh(kind,l)),placements);
        }
      }
    } else if (g?.kind === "space-colonized-tree") {
      const key = g.prototypeSeed === undefined ? entity.id : `tree:${g.style}:${g.prototypeSeed}`;
      const tree = () => g.prototypeSeed === undefined ? g : generateSpaceColonizedTree(g.prototypeSeed, g.style);
      add(entity, key, "bark", false, () => { const t = tree(); return [0, 1, 2].map(lod => buildTreeBarkMesh(t, lod, [255, 255, 255, 255])); }, g.instances);
      add(entity, key, `leaves-${g.style}`, false, () => { const t = tree(); return [0, 1, 2].map(lod => leafMesh(t, lod)); }, g.instances);
    } else if (g?.kind === "ground-cover") add(entity, "grass", "grass-blades", false, () => [grassMesh()], g.instances.map(p => ({ ...p, rotation: p.rotation * 180 / Math.PI })));
    else {
      const asset = ASSET_BY_ID.get(entity.assetId);
      if (asset?.editorOnly || entity.light) continue; // Native environment bridge imports resolved light behaviors.
      if (!asset?.parts || asset.modelUrl) { warn(entity, "External mesh, token or splat retained in source; native asset import is pending."); continue; }
      // Preserve all primitive types, emissive and shader information in source.
      // Unsupported shapes are reported instead of being replaced by a box.
      if (asset.parts.some(p => p.primitive === "capsule" || p.primitive === "plane")) { warn(entity, "Primitive needs native conversion; retained in source."); continue; }
      const parts = asset.parts.map(p => ({ shape: p.primitive as "box" | "sphere" | "cylinder" | "cone", position: p.position, rotation: p.rotation ?? { x: 0, y: 0, z: 0 }, size: p.scale, color: entity.tint ?? p.color, material: (p.surface === "wood" ? "timber" : "masonry") as "timber" | "masonry" }));
      const lods = [0, 1, 2].map(lod => buildAssemblyMeshes(parts, lod));
      for (const role of lods[0].keys()) add(entity, `${entity.assetId}:${entity.tint ?? "default"}`, role, true, () => lods.map(l => l.get(role)!));
    }
  }
  return scene;
}
