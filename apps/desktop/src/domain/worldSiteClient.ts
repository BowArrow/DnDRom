import type {WorldBlueprintV1} from "./types";
import {prepareWorldSite,inferSiteIntent} from "./worldSite";
export async function prepareWorldSiteAsync(blueprint:WorldBlueprintV1,signal?:AbortSignal):Promise<WorldBlueprintV1>{
  signal?.throwIfAborted();
  if(blueprint.site||blueprint.kind==="interior"||blueprint.kind==="dungeon")return blueprint;
  blueprint={...blueprint,siteIntent:blueprint.siteIntent??inferSiteIntent(blueprint.description,blueprint.biome.id)};
  if(typeof Worker==="undefined"||import.meta.env.MODE==="test")return prepareWorldSite(blueprint);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("./worldSite.worker.ts",import.meta.url),{type:"module"});
    const finish=()=>{worker.terminate();signal?.removeEventListener("abort",abort);};
    const abort=()=>{finish();reject(new DOMException("Site selection cancelled","AbortError"));};
    signal?.addEventListener("abort",abort,{once:true});
    worker.onmessage=event=>{finish();if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.blueprint);};
    worker.onerror=event=>{finish();reject(new Error(event.message));};
    worker.postMessage(blueprint);
  });
}
