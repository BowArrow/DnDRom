import { configureWorldTerrainMaterial } from "./tabletopShaders";
import * as pc from "playcanvas";
import type { GameMap } from "../domain/types";
import { atlasContext, createAtlasSampler, selectAtlasTiles, tileKey, tileSize, tileChildren, type AtlasTile, type AtlasMesh } from "../domain/worldAtlas";
interface TileRecord { surface:Float32Array; plants?:pc.Entity; entity: pc.Entity; lastUsed: number; mesh: pc.Mesh; morph?: { fine:Float32Array; current:Float32Array; parent:Float32Array; started?:number } }
interface AtlasScene { patches: ReturnType<typeof atlasContext>["patches"]; id: string; root: pc.Entity; sample: (x:number,z:number)=>number; ready: boolean }
const scenes = new WeakMap<pc.Application, AtlasScene>();
export function worldHeight(app: pc.Application,x:number,z:number):number | undefined { return scenes.get(app)?.sample(x,z); }
export function horizonReady(app:pc.Application):boolean { return scenes.get(app)?.ready ?? true; }
/** Sparse, camera-centred terrain hierarchy. Parents stay resident until all
 * replacement children have uploaded; bounded worker queues never gate input. */
export function syncWorldHorizon(app: pc.Application,camera:pc.Entity,map:GameMap,sunlight:pc.Entity,decorate?:(parent:pc.Entity,plants:Float32Array,lod:0|1|2,grass:Float32Array)=>void):void {
  const previous=scenes.get(app),patches=map.entities.flatMap(e=>e.worldGeometry?.kind==="terrain"?[e.worldGeometry]:[]);
  if(previous?.id===map.id && previous.patches.length===patches.length && patches.every((p,i)=>p===previous.patches[i]))return;
  previous?.root.destroy();scenes.delete(app);
  const canvas=app.graphicsDevice.canvas as HTMLCanvasElement;
  if(!map.world || ["interior","dungeon"].includes(map.generation?.blueprint.kind ?? "")){delete canvas.dataset.worldHorizon;return;}
  const context=atlasContext(map),root=new pc.Entity("Streaming world terrain");app.root.addChild(root);
  const fallbackSample=createAtlasSampler(context,false);
  const state:AtlasScene={patches,id:map.id,root,sample:fallbackSample,ready:false};scenes.set(app,state);
  const worker=new Worker(new URL("../domain/worldAtlasWorker.ts",import.meta.url),{type:"module",name:"World terrain LOD"});
  worker.postMessage({context});
  const resident=new Map<string,TileRecord>(),pending=new Set<string>(),completed:AtlasMesh[]=[];
  // Camera grounding reads uploaded triangles. Never run erosion synchronously
  // on the UI thread in response to a mouse move or camera-height query.
  state.sample=(x,z)=>{
    if(Math.abs(x)<map.width/2 && Math.abs(z)<map.depth/2)return fallbackSample(x,z);
    for(let level=0;level<=10;level++){
      const size=32*2**level,tx=Math.floor(x/size),tz=Math.floor(z/size),record=resident.get(`${level}/${tx}/${tz}`);
      if(!record?.entity.enabled)continue;
      const u=(x/size-tx)*16,v=(z/size-tz)*16,ix=Math.min(15,Math.floor(u)),iz=Math.min(15,Math.floor(v)),fx=u-ix,fz=v-iz;
      const p=record.surface,i=iz*17+ix,a=p[i*3+1],b=p[(i+1)*3+1],c=p[(i+17)*3+1],d=p[(i+18)*3+1];
      return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d*(fx+fz-1)+b*(1-fz)+c*(1-fx);
    }
    return fallbackSample(x,z);
  };
  let selection=selectAtlasTiles(0,0,context),wanted=new Map<string,AtlasTile>(),desiredKeys=new Set<string>(),clock=0,lastSelect=-1,dead=false;
  const material=new pc.StandardMaterial();configureWorldTerrainMaterial(material,app.graphicsDevice,map.generation?.blueprint.biome.id ?? "forest");
  if(camera.camera){camera.camera.farClip=50000;camera.camera.nearClip=.15;}
  const inside=(tile:AtlasTile)=>{const s=tileSize(tile);return tile.x*s>=-map.width/2&&tile.z*s>=-map.depth/2&&(tile.x+1)*s<=map.width/2&&(tile.z+1)*s<=map.depth/2;};
  const intersects=(tile:AtlasTile)=>{const s=tileSize(tile);return tile.x*s<map.width/2&&(tile.x+1)*s>-map.width/2&&tile.z*s<map.depth/2&&(tile.z+1)*s>-map.depth/2;};
  const requestTree=(tile:AtlasTile)=>{
    if(inside(tile))return;
    wanted.set(tileKey(tile),tile);
    if(tile.level>0&&!desiredKeys.has(tileKey(tile)))tileChildren(tile).forEach(requestTree);
  };
  const covered=(tile:AtlasTile):boolean=>inside(tile)||(!intersects(tile)&&resident.has(tileKey(tile)))||(tile.level>0&&wanted.has(tileKey(tile))&&tileChildren(tile).every(covered));
  const display=(tile:AtlasTile)=>{
    if(inside(tile))return;
    const key=tileKey(tile),record=resident.get(key);
    const finer=tile.level>0&&!desiredKeys.has(key)&&(!record?.morph || record.morph.started===undefined)&&tileChildren(tile).every(covered);
    if(finer)tileChildren(tile).forEach(display);
    else if(record&&!intersects(tile)){record.entity.enabled=true;record.lastUsed=clock;if(record.morph && record.morph.started===undefined)record.morph.started=clock;}
  };
  worker.onmessage=(event:MessageEvent<AtlasMesh>)=>{if(!dead)completed.push(event.data);};
  worker.onerror=()=>{canvas.dataset.worldHorizonError="Terrain worker failed";};
  const update=(dt:number)=>{
    clock+=Math.min(dt,.1);
    if(clock-lastSelect>.5){lastSelect=clock;const p=camera.getPosition();selection=selectAtlasTiles(p.x,p.z,context);desiredKeys=new Set(selection.desired.map(tileKey));wanted=new Map();selection.roots.forEach(requestTree);}
    for(const [key,record] of resident) if(!record.entity.enabled&&!wanted.has(key)&&(clock-record.lastUsed>2||resident.size>=1024)){record.entity.destroy();resident.delete(key);}
    const start=performance.now();let uploaded=0;
    while(completed.length&&uploaded<2&&resident.size<1024&&performance.now()-start<4){
      const data=completed.shift()!,key=tileKey(data.tile);pending.delete(key);if(!wanted.has(key)||resident.has(key))continue;
      const current=new Float32Array(data.positions);for(let i=0;i<data.parentHeights.length;i++)current[i*3+1]=data.parentHeights[i];
      const mesh=new pc.Mesh(app.graphicsDevice);mesh.setPositions(current);mesh.setNormals(data.normals);mesh.setColors32(data.colors);mesh.setIndices(data.indices);mesh.update(pc.PRIMITIVE_TRIANGLES);
      const entity=new pc.Entity(`Terrain ${key}`),size=tileSize(data.tile);entity.setPosition((data.tile.x+.5)*size,0,(data.tile.z+.5)*size);
      entity.addComponent("render",{meshInstances:[new pc.MeshInstance(mesh,material)],castShadows:false,receiveShadows:true});root.addChild(entity);entity.enabled=false;
      let plants:pc.Entity|undefined;
      if(decorate&&(data.vegetation.length||data.grass.length)){plants=new pc.Entity(`Forest ${key}`);entity.addChild(plants);decorate(plants,data.vegetation,Math.min(2,data.tile.level) as 0|1|2,data.grass);plants.enabled=false;}
      resident.set(key,{surface:current,entity,plants,lastUsed:clock,mesh,morph:{fine:data.positions,current,parent:data.parentHeights}});uploaded++;
    }
    // Bounded in-flight work, coarse coverage first. Obsolete camera requests
    // cannot leave seconds of inaccessible work queued in the worker.
    const queue=[...wanted.values()].filter(t=>!resident.has(tileKey(t))&&!pending.has(tileKey(t))).sort((a,b)=>b.level-a.level);
    for(const tile of queue.slice(0,Math.max(0,4-pending.size))){pending.add(tileKey(tile));worker.postMessage({tile});}
    for(const record of resident.values()) {
      const morph=record.morph;
      if(morph?.started!==undefined && record.entity.enabled) {
        const t=Math.min(1,(clock-morph.started)/.65),blend=t*t*(3-2*t);
        for(let i=0;i<morph.parent.length;i++)morph.current[i*3+1]=morph.parent[i]+(morph.fine[i*3+1]-morph.parent[i])*blend;
        record.mesh.setPositions(morph.current);record.mesh.update(pc.PRIMITIVE_TRIANGLES);if(t===1){record.morph=undefined;if(record.plants)record.plants.enabled=true;}
      }
      record.entity.enabled=false;
    }
    selection.roots.forEach(display);state.ready=selection.roots.every(covered);
    canvas.dataset.worldHorizon="streamed-quadtree";canvas.dataset.worldTerrainTiles=String(resident.size);canvas.dataset.worldTerrainPending=String(pending.size);canvas.dataset.worldTerrainReady=String(state.ready);
  };
  app.on("update",update);update(0);
  root.once("destroy",()=>{dead=true;app.off("update",update);worker.terminate();completed.length=0;resident.clear();material.destroy();if(scenes.get(app)===state)scenes.delete(app);});
  void sunlight;
}
