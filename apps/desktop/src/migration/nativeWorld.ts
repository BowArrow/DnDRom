import {readyRevealRadius,revealVisibleCoverageComplete} from "./nativeReveal";
import { visibleAtlasTiles } from "./nativeAtlasVisibility";
import type { GameMap } from "../domain/types";
import { atlasStitchLevels, atlasContext, selectAtlasTiles, tileKey, tileChildren, tileSize, type AtlasTile } from "../domain/worldAtlas";
import { nativeCall, nativeUpload, nativeTransferStatistics } from "./nativeBridge";
import { sendNativeModelMaterials } from "./nativeModels";
import {worldRegionFingerprint} from '../domain/sharedWorld';
export type WorldStream=(()=>void)&{update?:(map:GameMap)=>void};

/** Coarse coverage stays resident until all requested children are available. */
export function streamNativeWorld(map: GameMap, onError: (message: string) => void, revealIdentity?:string): WorldStream {
  if (!map.world || map.world.environment?.stratum==='underground' || !map.entities.some(e => e.worldGeometry?.kind === "terrain")) return () => {};
  let context = atlasContext(map);const worker = new Worker(new URL("./nativeAtlas.worker.ts", import.meta.url), { type: "module" });
  worker.postMessage({ map });
  const timings={transfer:nativeTransferStatistics,tiles:0,cacheHits:0,computeMs:0,transferMs:0,bytes:0,erosion:{simulationMs:0,fieldsBuilt:0,cacheHits:0}};
  Object.assign(window,{dndromWorldTimings:timings});
  const resident = new Map<string, {used:number;signature:string}>(), pending = new Set<string>();
  const cacheProbed=new Set<string>();
  const failures=new Map<string,{signature:string;attempts:number;retryAt:number}>();
  const transfers = new AbortController();
  const renderManifest=()=>context.sharedWorld?{...context.sharedWorld,authoredEntities:context.sharedWorld.authoredEntities?.filter(e=>e.worldGeometry&&!e.tags?.includes('token'))}:undefined;
  let terrainManifest=renderManifest();
  const generationIdentity=(tile:AtlasTile)=>terrainManifest?worldRegionFingerprint(terrainManifest,tile.x*tileSize(tile)+(context.site?.x??0),tile.z*tileSize(tile)+(context.site?.z??0),tileSize(tile))+`/${context.site?.x}/${context.site?.z}`:'';
  let selection = selectAtlasTiles(0, 0, context), wanted = new Map<string, AtlasTile>(), desired = new Set<string>(), ready = new Set<string>(), dead = false, busy = false;
  let lastSelectionAt=0;
  let selectionKey="", initialCoverageComplete=false, requests: Array<{tile:AtlasTile;stitchLevels:number[];signature:string}>=[];
  let revealed=0,canSync=false, nextVisibility:{visible:string[];remove:string[];revealRadius:number;revealComplete:boolean;revealIdentity?:string}|undefined;
  function local(tile: AtlasTile) { const size = tileSize(tile); return tile.x * size >= -context.width / 2 && (tile.x + 1) * size <= context.width / 2 && tile.z * size >= -context.depth / 2 && (tile.z + 1) * size <= context.depth / 2; }
  function request(tile: AtlasTile) { if (local(tile)) return; const id = tileKey(tile); wanted.set(id, tile); if (!desired.has(id) && tile.level > 0) tileChildren(tile).forEach(request); }
  function covered(tile: AtlasTile): boolean { const id = tileKey(tile); return local(tile) || ready.has(id) || (!desired.has(id) && tile.level > 0 && tileChildren(tile).every(covered)); }
  worker.onmessage = async event => {
    const { id, json, error, signature } = event.data;
    if(event.data.cacheMiss){cacheProbed.add(id+signature);pending.delete(id);return;}
    cacheProbed.add(id+signature);
    if(event.data.timings){const t=event.data.timings;timings.tiles++;if(t.cacheHit)timings.cacheHits++;timings.computeMs+=t.totalMs;timings.bytes+=t.bytes;timings.erosion=t.erosion;}
    if (dead) return;
    try {
      if (error) throw new Error(error);
      if (wanted.has(id)&&requests.some(r=>tileKey(r.tile)===id&&r.signature===signature)) { const transferStart=performance.now(); await sendNativeModelMaterials(event.data.materials ?? []); await nativeUpload(json, "tile", id, transfers.signal); timings.transferMs+=performance.now()-transferStart; if (!dead) resident.set(id, {used:Date.now(),signature}); }
    } catch (error) { if (!dead){const previous=failures.get(id),attempts=previous&&previous.signature===signature?previous.attempts+1:1;failures.set(id,{signature,attempts,retryAt:Date.now()+attempts*2000});if(json?.length<8_000_000)Object.assign(window,{dndromRejectedWorldTile:{id,json,error:String(error)}});onError(`Distant terrain could not load: ${String(error)}`);} }
    finally { pending.delete(id); }
  };
  worker.onerror = event => onError(event.message);
  const update = async () => {
    if (dead || busy) return; busy = true;
    try {
      const camera = await nativeCall<{ cameraX: number; cameraZ: number; readyTiles: string[]; cachedPrototypes?:string[]; importComplete:boolean; worldSync?:boolean }>(canSync?"world.sync":"app.diagnostics",canSync?(nextVisibility??{}):{});
      if (dead) return;
      canSync=camera.worldSync===true;
      // Scene import reframes the camera on completion. Sampling the previous
      // scene's camera can queue kilometres of irrelevant erosion first.
      if(!camera.importComplete)return;
      ready = new Set(camera.readyTiles);
      const key=`${Math.floor(camera.cameraX/64)}:${Math.floor(camera.cameraZ/64)}`;
      // Finish a fixed initial cohort. Orbiting changes the camera's X/Z even
      // when its focus stays still; retargeting here kept rebuilding stitch
      // variants and moved the reveal's finish line on every mouse movement.
      if(!selectionKey || initialCoverageComplete && key!==selectionKey && Date.now()-lastSelectionAt>1500){
        selectionKey=key; lastSelectionAt=Date.now(); selection = selectAtlasTiles(camera.cameraX, camera.cameraZ, context);
        desired = new Set(selection.desired.map(tileKey)); wanted = new Map(); selection.roots.forEach(request);
        // Generate selected leaves first. Building every ancestor samples vast
        // regions that will immediately be discarded and hides completed nearby
        // detail under kilometre-sized fallback triangles during startup.
        requests=selection.desired.map(tile=>{const stitchLevels=atlasStitchLevels(tile,selection.desired);return {tile,stitchLevels,signature:generationIdentity(tile)+':'+stitchLevels.join(",")};});
        if(context.sharedWorld){const coarse=new Map<string,AtlasTile>();for(const tile of selection.desired)if(tile.level<=4){const level=Math.min(5,tile.level+2),factor=2**(level-tile.level),parent={x:Math.floor(tile.x/factor),z:Math.floor(tile.z/factor),level};if(wanted.has(tileKey(parent))&&!desired.has(tileKey(parent)))coarse.set(tileKey(parent),parent);}requests.unshift(...[...coarse.values()].map(tile=>({tile,stitchLevels:[],signature:generationIdentity(tile)+':coverage'})));}
      }
      const visible=visibleAtlasTiles(selection.roots,desired,ready,local),show=new Set(visible);
      const remove: string[] = [];
      for (const [id, {used}] of resident) if (!wanted.has(id) && !show.has(id) && Date.now() - used > 15000) { remove.push(id); resident.delete(id); ready.delete(id); }
      // Release replaced parents so their cache entries cannot starve near LODs.
      for (const [id, tile] of wanted) if (resident.has(id) && !show.has(id) && !desired.has(id) && tile.level > 0 && tileChildren(tile).every(covered)) { remove.push(id); resident.delete(id); ready.delete(id); }
      // Uncover only geometry included in this same visibility transaction.
      // Covering parents are already visible landscape. Refining them must not
      // hold the fog until every high-detail leaf across the horizon has loaded.
      initialCoverageComplete ||= revealVisibleCoverageComplete(selection.roots,desired,show,context.width,context.depth,12000);
      revealed=Math.max(revealed,readyRevealRadius(selection.roots,desired,show,context.width,context.depth));nextVisibility={visible,remove,revealRadius:revealed,revealComplete:initialCoverageComplete,revealIdentity};
      Object.assign(timings,{reveal:{requested:desired.size,ready:[...desired].filter(id=>show.has(id)).length,pending:pending.size,failed:failures.size,complete:initialCoverageComplete,radius:revealed}});
      if(!canSync)await nativeCall("world.visible", nextVisibility);
      const priority=(tile:AtlasTile)=>{const size=tileSize(tile),x=tile.x*size,z=tile.z*size,cx=revealed<512?0:camera.cameraX,cz=revealed<512?0:camera.cameraZ;return Math.hypot(Math.max(x-cx,0,cx-x-size),Math.max(z-cz,0,cz-z-size));};
      const queue=requests.filter(({tile,signature})=>{const failure=failures.get(tileKey(tile));return !(failure?.signature===signature&&(failure.attempts>=3||Date.now()<failure.retryAt))&&!pending.has(tileKey(tile)) && (resident.has(tileKey(tile)) ? resident.get(tileKey(tile))!.signature!==signature : !covered(tile));}).sort((a,b)=>(context.sharedWorld?Number(priority(a.tile)>512)-Number(priority(b.tile)>512):0)||(priority(a.tile)+(revealed<512&&a.signature.endsWith(':coverage')?256:0))-(priority(b.tile)+(revealed<512&&b.signature.endsWith(':coverage')?256:0))||Number(!a.signature.endsWith(':coverage'))-Number(!b.signature.endsWith(':coverage'))||b.tile.level-a.tile.level);
      // Probe completed payloads before any missing tile starts synchronous
      // geological work. One cache miss must not block all saved scenery.
      const probes=queue.filter(r=>!cacheProbed.has(tileKey(r.tile)+r.signature));
      const work=probes.length?probes:queue;
      for (const request of work) {
        if(pending.size>=(probes.length?8:2))break;
        if(!resident.has(tileKey(request.tile))&&resident.size+pending.size>=512){
          // Permit the bounded replacement to exist before releasing its
          // children. A strict full-cache check otherwise deadlocks coarsening.
          const parent=request.tile;
          const replaced=[...ready].filter(id=>{const [level,x,z]=id.split("/").map(Number),scale=2**(parent.level-level);return level<parent.level&&Math.floor(x/scale)===parent.x&&Math.floor(z/scale)===parent.z;}).length;
          if(replaced<2||resident.size+pending.size>=515)continue;
        }
        pending.add(tileKey(request.tile));worker.postMessage({...request,cacheOnly:probes.length>0,knownPrototypes:camera.cachedPrototypes??[]});
      }
    } catch (error) { if (!dead) onError(String(error)); }
    finally { busy = false; }
  };
  const timer = setInterval(() => void update(), 200); void update();
  const stop:WorldStream=() => { dead = true; transfers.abort(); clearInterval(timer); worker.terminate(); void nativeCall("world.clear").catch(() => {}); };
  const structural=(m:GameMap['world'])=>{const w=m?.sharedWorld;return w?JSON.stringify([w.terrain,w.styles,w.locations,w.transport,w.removedEntityIds,(w.authoredEntities??[]).filter(e=>e.worldGeometry&&!e.tags?.includes('token'))]):'';};
  let structuralKey=structural(map.world);
  stop.update=next=>{if(!context.sharedWorld||next.world?.sharedWorld===context.sharedWorld)return;const key=structural(next.world);if(key===structuralKey)return;structuralKey=key;context=atlasContext(next);terrainManifest=renderManifest();selectionKey='';requests=[];worker.postMessage({map:next});};
  return stop;
}


