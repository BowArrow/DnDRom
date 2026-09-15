import { isTauri } from "../platform/desktop";
import type { CampaignSettings } from "../domain/types";
import { ensureLocalRuntime, type LocalRuntimeProgress } from "./localRuntime";

/** Missing legacy settings migrate to the app-owned runtime on desktop. */
export async function prepareLanguageSettings(settings: CampaignSettings, signal?: AbortSignal, onProgress?:(progress:LocalRuntimeProgress)=>void): Promise<CampaignSettings> {
  signal?.throwIfAborted();
  if (!isTauri() || settings.localAiRuntime === "external") return settings;
  if (settings.localAiRuntime === "disabled") return { ...settings, useLocalAiForMaps: false, localAiEndpoint: "" };
  const startup = ensureLocalRuntime("languageModel", p=>{if(!signal?.aborted)onProgress?.(p);});
  // Stop this planning request promptly without terminating a shared runtime
  // download/start that another creation task may still need.
  const runtime = signal ? await new Promise<Awaited<typeof startup>>((resolve,reject)=>{
    const cancelled=()=>{signal.removeEventListener('abort',cancelled);reject(signal.reason??new DOMException('Cancelled','AbortError'));};
    signal.addEventListener('abort',cancelled,{once:true});
    startup.then(value=>{signal.removeEventListener('abort',cancelled);resolve(value);},error=>{signal.removeEventListener('abort',cancelled);reject(error);});
    if(signal.aborted)cancelled();
  }) : await startup;
  signal?.throwIfAborted();
  return { ...settings, useLocalAiForMaps: true, localAiEndpoint: runtime.endpoint, localAiModel: "dndrom-director" };
}
