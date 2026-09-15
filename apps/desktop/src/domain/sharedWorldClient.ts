import type { WorldPlan, GameMap } from './types';
import { buildSharedWorld, reviseSettlement, type PipelineProgress } from './worldPipeline';
import { compileSharedScene } from './sharedWorldScene';
async function run<T>(world:WorldPlan,operation:'plan'|'scene'|'settlement',locationId?:string,signal?:AbortSignal,progress?:(p:PipelineProgress)=>void):Promise<T>{
  signal?.throwIfAborted();
  if(typeof Worker==='undefined')return (operation==='plan'?buildSharedWorld(world,progress):operation==='settlement'?reviseSettlement(world,locationId!,progress):compileSharedScene(world,locationId)) as T;
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./sharedWorld.worker.ts',import.meta.url),{type:'module',name:'DnDRom shared world'}),id=crypto.randomUUID();
    const clean=()=>{worker.terminate();signal?.removeEventListener('abort',abort);},abort=()=>{clean();reject(new DOMException('World generation cancelled','AbortError'));};
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=event=>{if(event.data.id!==id)return;if(event.data.progress){progress?.(event.data.progress);return;}clean();if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.result);};
    worker.onerror=event=>{clean();reject(new Error(event.message));};worker.postMessage({id,world,operation,locationId});
  });
}
export const planSharedWorld=(world:WorldPlan,signal?:AbortSignal,progress?:(p:PipelineProgress)=>void)=>run<WorldPlan>(world,'plan',undefined,signal,progress);
export const generateSharedScene=(world:WorldPlan,locationId?:string,signal?:AbortSignal)=>run<GameMap>(world,'scene',locationId,signal);


export const rebuildSharedSettlement=(world:WorldPlan,locationId:string,signal?:AbortSignal,progress?:(p:PipelineProgress)=>void)=>run<WorldPlan>(world,'settlement',locationId,signal,progress);
