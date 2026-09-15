import {readRenderCache,writeRenderCache} from "./nativeRenderCache";
import {nativeSceneBatches} from "./nativeSceneBatches";
import { exportUnrealScene } from "./unrealScene";
import type { Campaign } from "../domain/types";
import { parseNativeGlb, type NativeModel, type NativeGlb } from "./nativeGlb";
self.onmessage = async (event: MessageEvent<Campaign & { models?: Record<string, NativeModel>; streamId?:string; entityId?:string }>) => {
  try {
    const started=performance.now();
    const digest=async(bytes:BufferSource)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    const modelKeys=await Promise.all(Object.entries(event.data.models??{}).map(async([id,m])=>[id,{...m,bytes:await digest(m.bytes),scenicBase:m.scenicBase?{...m.scenicBase,bytes:await digest(m.scenicBase.bytes)}:undefined}]));
    const key='local-0312/'+await digest(new TextEncoder().encode(JSON.stringify([{id:event.data.map.id,name:event.data.map.name,width:event.data.map.width,depth:event.data.map.depth,theme:event.data.map.theme,entities:event.data.map.entities,world:event.data.map.world?{...event.data.map.world,sharedWorld:event.data.map.world.sharedWorld?{...event.data.map.world.sharedWorld,revision:0,authoredEntities:event.data.map.world.sharedWorld.authoredEntities?.filter(e=>e.worldGeometry),removedEntityIds:event.data.map.world.sharedWorld.removedEntityIds?.filter(id=>event.data.map.entities.some(e=>e.id===id))}:undefined}:undefined},modelKeys])));
    let cached=!event.data.entityId?await readRenderCache<any>(key):undefined;
    if(cached?.batchKeys){const parts=await Promise.all(cached.batchKeys.map((k:string)=>readRenderCache<{json:string}>(k)));cached=parts.every(Boolean)?{...cached,batches:parts.map((p:any)=>p.json)}:undefined;}
    if(cached){self.postMessage({...cached,batches:cached.batches.map((b:string)=>b.replace(JSON.stringify(cached.streamId),JSON.stringify(event.data.streamId))),cacheHit:true,totalMs:performance.now()-started});return;}
    const variants = new Map<string,NativeGlb>();
    const models = Object.fromEntries(Object.entries(event.data.models ?? {}).map(([id, model]) => {const key=model.cacheKey??id;let parsed=variants.get(key);if(!parsed){parsed=parseNativeGlb(model,id);variants.set(key,parsed);}return [id,parsed];}));
    const scene = exportUnrealScene(event.data.map, "schemaVersion" in event.data ? event.data : undefined, models);
    const batches=event.data.streamId&&!event.data.entityId?nativeSceneBatches(scene,event.data.streamId):undefined;
    // Serialize in the worker as well; large worlds must not stall the UI.
    const result={ ...(batches?{batches,playablePart:batches.playablePart}:{json:JSON.stringify({...scene,source:{map:{id:event.data.map.id}},streamId:event.data.streamId,replaceEntityId:event.data.entityId})}), warnings: scene.warnings.length, materials: Object.values(models).flatMap(model => model.materials),streamId:event.data.streamId,totalMs:performance.now()-started };
    if(batches&&'batches' in result){
      // Large settlements exceed a single cache entry even though every native
      // import is bounded. Persist the same bounded batches, then their index.
      const batchKeys=batches.map((_,i)=>`${key}/part-${i}`);
      for(let i=0;i<batches.length;i++)await writeRenderCache(batchKeys[i],{json:batches[i]},batches[i].length*2);
      const {batches:_,...metadata}=result;
      await writeRenderCache(key,{...metadata,batchKeys},result.materials.reduce((n,m)=>n+Object.values(m.maps).reduce((sum,image)=>sum+image.bytes.byteLength,0),0)+4096);
    }
    self.postMessage(result);
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
