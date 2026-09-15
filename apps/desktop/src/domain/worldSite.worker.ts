/// <reference lib="webworker" />
import {prepareWorldSite} from "./worldSite";
import {openNativeErosionCache,flushNativeErosionCache} from "../migration/nativeErosionCache";
import type {WorldBlueprintV1} from "./types";
self.onmessage=async(event:MessageEvent<WorldBlueprintV1>)=>{
  try{
    await Promise.race([openNativeErosionCache(event.data.seed),new Promise<void>(r=>setTimeout(r,2000))]);
    const blueprint=prepareWorldSite(event.data);
    await flushNativeErosionCache();
    self.postMessage({blueprint});
  }catch(error){self.postMessage({error:String(error)});}
};
