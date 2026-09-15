import {readRenderCache,writeRenderCache} from "./nativeRenderCache";
import {erosionStatistics} from "../domain/worldErosion";
import { nativeAtlasTerrain } from "./nativeAtlasTerrain";
import { atlasContext, buildAtlasMesh, createAtlasSampler, createAtlasHydrologySampler, tileSize, tileKey, type AtlasTile } from "../domain/worldAtlas";
import { nativeAtlasWater } from "./nativeAtlasWater";
import {nativeCanopyCrown,nativeCanopyPlacements} from "./nativeAtlasCanopy";
import type { GameMap } from "../domain/types";
import { exportUnrealScene,prepareSceneWater } from "./unrealScene";
import { generateSpaceColonizedTree } from "../domain/worldArchitecture";
import { nativeForestVolume } from "./nativeForestVolume";
import type { NativeGlbMaterial } from "./nativeGlb";
import { openNativeErosionCache,prepareNativeErosionRegion } from "./nativeErosionCache";
import {sharedWorldEntities} from '../domain/sharedWorldScene';
import {nativeWorldRoads} from './nativeWorldRoads';
const nearPrototypes = new Map<string, ReturnType<typeof exportUnrealScene>>();
const prototypes = new Map<string, ReturnType<typeof nativeForestVolume>[]>();
let context: ReturnType<typeof atlasContext>, sample: ReturnType<typeof createAtlasSampler>, fineSample: ReturnType<typeof createAtlasSampler>;
let cacheReady=Promise.resolve();
let authoredWater:ReturnType<typeof prepareSceneWater>;
const handle = async (event: MessageEvent<{ map?: GameMap; tile?: AtlasTile; stitchLevels?: number[]; signature?:string; cacheOnly?:boolean; knownPrototypes?:string[] }>) => {
  if (event.data.map) { context = atlasContext(event.data.map); sample = createAtlasSampler(context); fineSample=createAtlasSampler(context,true,true);
    authoredWater=prepareSceneWater(event.data.map);
    // Some CEF storage backends can leave an IndexedDB open pending. Disk
    // persistence is optional. Time out opening the DB, not a healthy read:
    // starting synchronous erosion mid-read prevents the cache from completing.
    cacheReady=openNativeErosionCache(context.seed,context.site);return; }
  const tile = event.data.tile; if (!tile || !context) return;
  try {
    const started=performance.now();
    const cacheKey=`atlas-v0312/${context.seed}/${context.width}/${context.depth}/${context.site?.x??0}/${context.site?.z??0}/${tileKey(tile)}/${event.data.signature??JSON.stringify(context.patches)}`;
    const cached=await readRenderCache<{json:string;materials:NativeGlbMaterial[]}>(cacheKey);
    if(cached){self.postMessage({id:tileKey(tile),signature:event.data.signature,...cached,timings:{totalMs:performance.now()-started,bytes:cached.json.length,cacheHit:true,erosion:{...erosionStatistics}}});return;}
    if(event.data.cacheOnly){self.postMessage({id:tileKey(tile),signature:event.data.signature,cacheMiss:true});return;}
    await cacheReady;
    await prepareNativeErosionRegion(tile.x*tileSize(tile)+(context.site?.x??0),tile.z*tileSize(tile)+(context.site?.z??0),tileSize(tile),tile.level<=5);
    const mesh = buildAtlasMesh(tile, context, tile.level<=5?fineSample:sample,event.data.stitchLevels,level=>level<=5?fineSample:sample), id = tileKey(tile);
    const scene = nativeAtlasTerrain(mesh, context);
    const roads=nativeWorldRoads(mesh,context);if(roads){const size=tileSize(tile);scene.meshes.push(roads);scene.instances.push({entityId:`world-roads:${id}`,meshId:roads.id,position:{x:(tile.x+.5)*size,y:0,z:(tile.z+.5)*size},rotation:[0,0,0,1],scale:{x:1,y:1,z:1}});}
    if(context.sharedWorld&&context.site){const size=tileSize(tile),entities=sharedWorldEntities(context.sharedWorld,{x:context.site.x,y:context.site.datum,z:context.site.z},{minX:tile.x*size,minZ:tile.z*size,maxX:(tile.x+1)*size,maxZ:(tile.z+1)*size},tile.level<=2,{minX:-context.width/2,minZ:-context.depth/2,maxX:context.width/2,maxZ:context.depth/2});if(entities.length){const structures=exportUnrealScene({name:'World structures',entities} as GameMap);scene.meshes.push(...structures.meshes);scene.instances.push(...structures.instances);}}
    const flow=createAtlasHydrologySampler(context,tile.level<=5),water=nativeAtlasWater(mesh,flow,context.site?context.site.seaLevel-context.site.datum:undefined,{width:context.width,depth:context.depth,shore:authoredWater.shore,waterDepth:authoredWater.depth,surface:authoredWater.surface});
    if(water){const size=tileSize(tile);const {waterField,...geometry}=water;scene.meshes.push(geometry);if(waterField)scene.waterFields=[waterField];scene.instances.push({entityId:`world-water:${id}`,meshId:water.id,position:{x:(tile.x+.5)*size,y:0,z:(tile.z+.5)*size},rotation:[0,0,0,1],scale:{x:1,y:1,z:1}});}
    const materials: NativeGlbMaterial[] = [];
    const canopy=nativeCanopyPlacements(mesh,flow,context);
    for(const pine of [false,true]){
      const group=canopy.filter(p=>p.pine===pine);if(!group.length)continue;
      const key=`native-tree-v2/canopy033-${pine?"pine":"broadleaf"}`;
      scene.meshes.push({id:key,material:"forest-crown",collision:false,castShadow:false,lods:[nativeCanopyCrown(pine)]});
      for(const p of group)scene.instances.push({entityId:`forest:${id}`,meshId:key,position:{x:p.x,y:p.y,z:p.z},rotation:[0,0,0,1],scale:{x:p.scale,y:p.scale,z:p.scale}});
    }
    for (const [styleIndex, style] of [[0, "broadleaf"], [1, "pine"]] as const) {
      if(tile.level>=5)break;
      const seed = context.seed + 619 + styleIndex * 977;
      const plants = [];
      for (let i = 0; i < mesh.vegetation.length; i += 6) if (mesh.vegetation[i + 5] === styleIndex&&flow(mesh.vegetation[i],mesh.vegetation[i+2])<.22) plants.push({ x: mesh.vegetation[i], y: mesh.vegetation[i + 1], z: mesh.vegetation[i + 2], rotation: mesh.vegetation[i + 3], scale: mesh.vegetation[i + 4] });
      if (!plants.length) continue;
      if (tile.level === 0) {
        const key = `forest-prototype-${seed}-${style}`;
        if (!nearPrototypes.has(key)) {
          const tree = generateSpaceColonizedTree(seed, style);
          const entity = { id:key, assetId:`tree-${style}`, position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},worldGeometry:{...tree,prototypeSeed:seed} };
          const forest=exportUnrealScene({name:"Forest",entities:[entity]} as unknown as GameMap);
          forest.meshes.forEach(m=>{m.lods=m.lods.slice(1);m.id=`native-tree-v2/${m.id}`;});forest.instances.forEach(i=>{i.meshId=`native-tree-v2/${i.meshId}`;}); nearPrototypes.set(key,forest);
        }
        const forest=nearPrototypes.get(key)!; scene.meshes.push(...forest.meshes);
        for(const prototype of forest.instances)for(const p of plants){const angle=p.rotation*Math.PI/360;scene.instances.push({...prototype,entityId:`forest:${id}`,position:{x:p.x,y:p.y,z:p.z},rotation:[0,Math.sin(angle),0,Math.cos(angle)],scale:{x:p.scale,y:p.scale,z:p.scale}});}
      } else {
        // Three persistent shapes per species, all instanced and shared across
        // tiles. Geometry and normals respond to the scene's actual sunlight.
        for(let variant=0;variant<3;variant++){
          const key=`native-tree-v2/volume033-${seed+variant*193}-${style}`;
          if(!prototypes.has(key)){const tree=generateSpaceColonizedTree(seed+variant*193,style);prototypes.set(key,[0,1,2].map(lod=>nativeForestVolume(tree,lod)));}
          const group=plants.filter(p=>Math.floor(p.rotation/120)===variant);if(!group.length)continue;
          scene.meshes.push({id:key,material:"forest-crown",collision:false,castShadow:tile.level<=3,lods:prototypes.get(key)!});
          for(const p of group){const angle=p.rotation*Math.PI/360;scene.instances.push({entityId:`forest:${id}`,meshId:key,position:{x:p.x,y:p.y,z:p.z},rotation:[0,Math.sin(angle),0,Math.cos(angle)],scale:{x:p.scale,y:p.scale,z:p.scale}});}
        }
      }
    }
    const fullJson=JSON.stringify(scene);
    await writeRenderCache(cacheKey,{json:fullJson,materials},fullJson.length*2);
    const known=new Set(event.data.knownPrototypes??[]);
    const json=JSON.stringify({...scene,meshes:scene.meshes.map(m=>known.has(m.id)?{id:m.id,prototypeRef:m.id}:m)});
    self.postMessage({ id, signature:event.data.signature, json, materials, timings:{totalMs:performance.now()-started,bytes:json.length,erosion:{...erosionStatistics}} });
  } catch (error) { self.postMessage({ id: tileKey(tile), signature:event.data.signature,error: String(error) }); }
};

let queue=Promise.resolve();self.onmessage=event=>{queue=queue.then(()=>handle(event)).catch(error=>self.postMessage({error:String(error)}));};
