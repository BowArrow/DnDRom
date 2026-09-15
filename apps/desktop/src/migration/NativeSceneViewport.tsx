import { nativeSceneChanges } from "./nativeSceneChanges";
import { NativeEditorOverlay } from "./NativeEditorOverlay";
import { useEffect, useRef, useState } from "react";
import type { SceneViewportProps } from "../components/SceneViewport";
import { bindNativeNavigation } from "./nativeNavigation";
import { nativeCall, nativeUpload } from "./nativeBridge";
import type { Vec3 } from "../domain/types";
import { streamNativeWorld, type WorldStream } from "./nativeWorld";
import { resolvePracticalLight } from "../domain/practicalLights";
import { sendNativeMaterials } from "./nativeMaterials";
import { loadNativeModels, sendNativeModelMaterials } from "./nativeModels";

export function NativeSceneViewport(props: SceneViewportProps) {
  const element = useRef<HTMLDivElement>(null);
  const latest = useRef(props); latest.current = props;
  const [status, setStatus] = useState("Preparing native scene…");
  const stream=useRef<WorldStream|undefined>(undefined);
  const worldIdentity = `${props.map.id}/${props.map.world?.sharedWorld?.id ?? ''}/${props.map.world?.seed ?? ''}/${props.map.world?.site?.x ?? 0}/${props.map.world?.site?.z ?? 0}/${props.map.world?.environment?.stratum ?? 'surface'}`;
  useEffect(() => () => { stream.current?.(); stream.current=undefined; }, [worldIdentity]);
  const reconcile=useRef<(()=>void)|undefined>(undefined);
  useEffect(() => {
    let dead=false,busy=false,accepted:SceneViewportProps|undefined;
    const transfer=new AbortController(),streamId=crypto.randomUUID();
    const worker=new Worker(new URL("./unrealScene.worker.ts",import.meta.url),{type:"module"});
    const compile=(p:SceneViewportProps,entityId?:string)=>new Promise<any>((resolve,reject)=>{
      worker.onmessage=e=>e.data.error?reject(Error(e.data.error)):resolve(e.data);
      worker.onerror=e=>reject(Error(e.message));
      void loadNativeModels(p).then(models=>{if(!dead)worker.postMessage({map:p.map,models,streamId,entityId});}).catch(reject);
    });
    const waitReady=async(id?:string)=>{for(let i=0;i<1800;i++){transfer.signal.throwIfAborted();const d=await nativeCall<{streamId:string;importComplete:boolean;readyTiles:string[]}>("app.diagnostics");if(d.streamId===streamId&&d.importComplete&&(!id||d.readyTiles.includes(id)))return;await new Promise(r=>setTimeout(r,100));}throw Error("Scene import timed out");};
    const run=async()=>{
      if(dead||busy)return;busy=true;
      const p=latest.current;let rendered=p;
      try {
        const refresh=accepted&&["tokenAssets","propAssets","basePlateAssets","campaignBasePlateAssignments","sceneBasePlateAssignments","tokenCharacterLinks"].some(k=>JSON.stringify(accepted![k as keyof SceneViewportProps])!==JSON.stringify(p[k as keyof SceneViewportProps]));
        const changes=accepted?nativeSceneChanges(accepted.map,p.map,!!refresh):undefined;
        if(!accepted||changes?.rebuild){
          Object.assign(window,{dndromSceneImport:{mapId:p.map.id,streamId,cacheReady:false}});
          const exterior=!!p.map.world&&p.map.world.environment?.stratum!=="underground"&&p.map.entities.some(e=>e.worldGeometry?.kind==="terrain");
          if(exterior)rendered={...p,map:{...p.map,entities:p.map.entities.filter(e=>!!e.worldGeometry)}};
          setStatus("Loading scene...");const data=await compile(rendered);transfer.signal.throwIfAborted();
          Object.assign(window,{dndromLocalTimings:{cacheHit:!!data.cacheHit,exportMs:data.totalMs}});
          await sendNativeModelMaterials(data.materials??[]);await sendNativeMaterials(p.materialAssets??[]);
          if(!accepted)await nativeCall("world.reveal",{enabled:exterior,identity:worldIdentity});
          await nativeUpload(data.batches[0],"scene","",transfer.signal);await waitReady();
          for(let i=1;i<data.batches.length;i++){const id=`local:${streamId}:${i}`;await nativeUpload(data.batches[i],"tile",id,transfer.signal);await waitReady(id);}
          if(!stream.current&&exterior)stream.current=streamNativeWorld(p.map,setStatus,worldIdentity);
          Object.assign(window,{dndromSceneImport:{mapId:p.map.id,streamId,cacheReady:!p.map.sharedCacheOmitted}});
        }else if(changes){
          if(changes.remove.length||changes.transforms.length)await nativeCall("scene.input",{kind:"entities",streamId,remove:changes.remove,transforms:changes.transforms.map(t=>({id:t.id,before:{position:t.before.position,rotation:t.before.rotation,scale:t.before.scale},after:{position:t.after.position,rotation:t.after.rotation,scale:t.after.scale}}))});
          for(const entity of changes.replace){
            const data=await compile({...p,map:{...p.map,entities:[entity]}},entity.id);transfer.signal.throwIfAborted();
            await sendNativeModelMaterials(data.materials??[]);await sendNativeMaterials(p.materialAssets??[]);
            // Replacement becomes visible atomically; the old object stays until then.
            const id=`edit:${entity.id}`;await nativeUpload(data.json,"tile",id,transfer.signal);await waitReady(id);
          }
        }
        if(!accepted||p.map.lighting!==accepted.map.lighting||p.map.weather!==accepted.map.weather||p.map.entities!==accepted.map.entities&&JSON.stringify(p.map.entities.map(resolvePracticalLight).filter(Boolean))!==JSON.stringify(accepted.map.entities.map(resolvePracticalLight).filter(Boolean))){
          await nativeCall("scene.environment",{lighting:p.map.lighting??{},weather:p.map.weather??{},coastalSediment:p.map.theme==="coast",interior:/tavern|dungeon|interior|crypt|cavern/.test(p.map.theme),lights:p.map.entities.map(resolvePracticalLight).filter(Boolean).slice(0,128)});
        }
        stream.current?.update?.(p.map);accepted=rendered;setStatus("");
      }catch(error){if(!dead)setStatus(error instanceof Error?error.message:String(error));}
      finally{busy=false;}
      if(!dead&&accepted===rendered&&(rendered!==p||latest.current!==p))void run();
    };
    reconcile.current=()=>void run();const timer=setTimeout(()=>void run(),50);
    return()=>{dead=true;transfer.abort();clearTimeout(timer);worker.terminate();reconcile.current=undefined;};
  },[worldIdentity]);
  useEffect(()=>{reconcile.current?.();},[props.map,props.tokenAssets,props.propAssets,props.materialAssets,props.basePlateAssets,props.campaignBasePlateAssignments,props.sceneBasePlateAssignments,props.tokenCharacterLinks]);
  useEffect(() => {
    const node = element.current!;
    // Every ancestor of this viewport must reveal the underlying native surface.
    const parents: HTMLElement[] = []; let parent: HTMLElement | null = node;
    while (parent) { parents.push(parent); parent.classList.add("native-surface-parent"); parent = parent.parentElement; }
    const masks = Array.from({ length: 4 }, () => { const mask = document.createElement("div"); mask.className = "native-app-mask"; document.body.append(mask); return mask; });
    const resize = () => { const r = node.getBoundingClientRect();
      const rects = [[0, 0, innerWidth, Math.max(0, r.top)], [0, r.bottom, innerWidth, Math.max(0, innerHeight - r.bottom)], [0, r.top, Math.max(0, r.left), r.height], [r.right, r.top, Math.max(0, innerWidth - r.right), r.height]];
      rects.forEach(([left, top, width, height], i) => Object.assign(masks[i].style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` }));
      void nativeCall("scene.viewport", { x: r.x / innerWidth, y: r.y / innerHeight, width: r.width / innerWidth, height: r.height / innerHeight }).catch(error => setStatus(String(error))); };
    const observer = new ResizeObserver(resize); observer.observe(node); window.addEventListener("resize", resize); window.addEventListener("scroll", resize, true); resize();
    const unbindNavigation = bindNativeNavigation(node, input => nativeCall("scene.input", input), error => setStatus(String(error)));
    return () => { unbindNavigation(); observer.disconnect(); window.removeEventListener("resize", resize); window.removeEventListener("scroll", resize, true); masks.forEach(mask => mask.remove()); parents.forEach(p => p.classList.remove("native-surface-parent")); };
  }, []);
  return <div ref={element} tabIndex={0} aria-label="3D scene viewport" className="scene-viewport native-scene-viewport" onContextMenu={event => event.preventDefault()} onClick={event => {
    if (event.button !== 0) return;
    element.current?.focus({ preventScroll: true });
    void nativeCall<{ hit: boolean; entityId?: string; position?: Vec3 }>("scene.input", { kind: "pick", x: event.clientX / innerWidth, y: event.clientY / innerHeight }).then(hit => {
      const p = latest.current;
      if (p.activeAssetId && hit.hit && hit.position) p.onPlace({ position: hit.position, rotationY: 0, snapped: false, valid: true });
      else if(p.activeAssetId)setStatus("No loaded surface under the pointer. Click visible terrain or a building floor.");
      else p.onSelect(hit.entityId || null);
    }).catch(error => setStatus(String(error)));
  }}><NativeEditorOverlay {...props} viewport={element}/><div className="native-view-help">MMB orbit | Shift + MMB pan | Wheel zoom | Home frame all | RMB + WASD fly</div>{status && <div className="native-view-status" role="status">{status}</div>}</div>;
}
